import * as vscode from 'vscode';
import * as os from 'os';
import { DependencyParser } from '../parsers/DependencyParser';
import { NpmDependencyParser } from '../parsers/NpmDependencyParser';
import { MavenDependencyParser } from '../parsers/MavenDependencyParser';
import { GradleDependencyParser } from '../parsers/GradleDependencyParser';
import { DependencyValidator } from './DependencyValidator';
import { DiagnosticsManager } from './DiagnosticsManager';
import { RepoGateApiClient } from '../api/RepoGateApiClient';
import { DependencyInfo, ApprovalStatus } from '../models/DependencyInfo';

export class DependencyMonitor {
    private parsers: DependencyParser[];
    private validator: DependencyValidator;
    private diagnosticsManager: DiagnosticsManager;
    private fileWatcher: vscode.FileSystemWatcher | undefined;
    private fileContentsCache: Map<string, string> = new Map();
    private dependencyStatusCache: Map<string, Map<string, DependencyInfo>> = new Map();
    private disposables: vscode.Disposable[] = [];
    private statusBarItem: vscode.StatusBarItem;
    private initialScanCompleted: boolean = false;

    constructor(private context: vscode.ExtensionContext) {
        this.parsers = [
            new NpmDependencyParser(),
            new MavenDependencyParser(),
            new GradleDependencyParser()
        ];
        this.validator = new DependencyValidator(context, this);
        this.diagnosticsManager = new DiagnosticsManager();
        
        // Create status bar item
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.command = 'repogate.showStatus';
        this.disposables.push(this.statusBarItem);
    }

    start(): void {
        // Watch for changes to dependency files
        const patterns = [
            '**/package.json',
            '**/pom.xml',
            '**/build.gradle',
            '**/build.gradle.kts'
        ];

        for (const pattern of patterns) {
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);

            watcher.onDidChange(uri => this.handleFileChange(uri));
            watcher.onDidCreate(uri => this.handleFileChange(uri));

            this.disposables.push(watcher);
        }

        // Watch for active editor changes to update decorations
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                this.updateVisualIndicators(editor.document.uri);
            }
        }, null, this.disposables);

        // Perform initial scan and queue packages
        this.performInitialScan();

        // Register commands
        this.registerCommands();
    }

    private registerCommands(): void {
        this.disposables.push(
            vscode.commands.registerCommand('repogate.showStatus', () => {
                this.showStatusReport();
            })
        );

        this.disposables.push(
            vscode.commands.registerCommand('repogate.checkDependency', () => {
                this.checkCurrentDependency();
            })
        );
    }

    private async performInitialScan(): Promise<void> {
        // Check if initial scan was already completed
        const scanCompleted = this.context.globalState.get<boolean>('repogate.initialScanCompleted', false);
        
        if (scanCompleted) {
            console.log('RepoGate: Initial scan already completed, skipping...');
            this.initialScanCompleted = true;
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return;
        }

        vscode.window.showInformationMessage('RepoGate: Scanning existing packages...');

        const allPackages: Array<{packageName: string, packageVersion?: string, packageManager: string, projectName?: string}> = [];
        const patterns = [
            '**/package.json',
            '**/pom.xml',
            '**/build.gradle',
            '**/build.gradle.kts'
        ];

        for (const folder of workspaceFolders) {
            const projectName = folder.name;
            
            for (const pattern of patterns) {
                const files = await vscode.workspace.findFiles(
                    new vscode.RelativePattern(folder, pattern),
                    '**/node_modules/**'
                );

                for (const file of files) {
                    try {
                        const content = await vscode.workspace.fs.readFile(file);
                        const contentStr = content.toString();
                        this.fileContentsCache.set(file.fsPath, contentStr);

                        // Parse all existing dependencies
                        const fileName = file.path.split('/').pop() || '';
                        const parser = this.findParser(fileName);
                        
                        if (parser) {
                            const deps = parser.parseAllDependencies(contentStr);
                            
                            // Add to packages list for queue
                            deps.forEach(dep => {
                                allPackages.push({
                                    packageName: dep.packageName,
                                    packageVersion: dep.version,
                                    packageManager: dep.packageManager,
                                    projectName: projectName
                                });
                            });
                            
                            // Initialize status cache
                            if (!this.dependencyStatusCache.has(file.fsPath)) {
                                this.dependencyStatusCache.set(file.fsPath, new Map());
                            }
                            const statusMap = this.dependencyStatusCache.get(file.fsPath)!;
                            deps.forEach(dep => {
                                statusMap.set(dep.packageName, dep);
                            });
                        }
                    } catch (error) {
                        console.error(`Error reading file ${file.fsPath}:`, error);
                    }
                }
            }
        }

        // Send packages to queue endpoint
        if (allPackages.length > 0) {
            await this.queuePackages(allPackages);
            vscode.window.showInformationMessage(`RepoGate: Queued ${allPackages.length} existing packages for review`);
        }

        // Mark initial scan as completed
        await this.context.globalState.update('repogate.initialScanCompleted', true);
        this.initialScanCompleted = true;

        // Update status bar
        this.updateStatusBar();
    }

    private async queuePackages(packages: Array<{packageName: string, packageVersion?: string, packageManager: string, projectName?: string}>): Promise<void> {
        const config = vscode.workspace.getConfiguration('repogate');
        const enabled = config.get<boolean>('enabled');
        const apiToken = config.get<string>('apiToken');
        const apiUrl = config.get<string>('apiUrl') || 'https://app.repogate.io/api/v1';

        if (!enabled || !apiToken || apiToken.trim() === '') {
            console.log('RepoGate: Skipping queue - extension not configured');
            return;
        }

        try {
            const client = new RepoGateApiClient(apiUrl, apiToken);
            await client.queuePackages(packages);
            console.log(`RepoGate: Successfully queued ${packages.length} packages`);
        } catch (error) {
            console.error('RepoGate: Failed to queue packages:', error);
            // Don't show error to user - this is a background operation
        }
    }

    private async handleFileChange(uri: vscode.Uri): Promise<void> {
        const fileName = uri.path.split('/').pop() || '';
        const parser = this.findParser(fileName);

        if (!parser) {
            return;
        }

        try {
            const content = await vscode.workspace.fs.readFile(uri);
            const currentContent = content.toString();
            const previousContent = this.fileContentsCache.get(uri.fsPath) || '';

            // Initialize status cache for this file if needed
            if (!this.dependencyStatusCache.has(uri.fsPath)) {
                this.dependencyStatusCache.set(uri.fsPath, new Map());
            }
            const statusMap = this.dependencyStatusCache.get(uri.fsPath)!;

            // Get project name from workspace folder
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
            const projectName = workspaceFolder?.name;

            // Parse new dependencies
            const newDependencies = parser.parseNewDependencies(currentContent, previousContent);

            if (newDependencies.length > 0) {
                // Validate each new dependency
                for (const dependency of newDependencies) {
                    statusMap.set(dependency.packageName, dependency);
                    await this.validator.validateDependency(dependency, projectName);
                }
            }

            // Detect removed dependencies
            const currentDeps = parser.parseAllDependencies(currentContent);
            const currentDepNames = new Set(currentDeps.map(d => d.packageName));

            // Check for removed dependencies
            for (const [depName, depInfo] of statusMap) {
                if (!currentDepNames.has(depName)) {
                    // Dependency was removed
                    await this.notifyDependencyRemoval(depInfo, projectName);
                    statusMap.delete(depName);
                }
            }

            // Update cache
            this.fileContentsCache.set(uri.fsPath, currentContent);

            // Update visual indicators
            this.updateVisualIndicators(uri);
            this.updateStatusBar();
        } catch (error) {
            console.error(`Error handling file change for ${uri.fsPath}:`, error);
        }
    }

    updateDependencyStatus(packageName: string, packageManager: string, status: ApprovalStatus): void {
        // Update status in all files
        for (const [filePath, statusMap] of this.dependencyStatusCache) {
            for (const [depName, depInfo] of statusMap) {
                if (depInfo.packageName === packageName && depInfo.packageManager === packageManager) {
                    depInfo.status = status;
                    this.updateVisualIndicators(vscode.Uri.file(filePath));
                }
            }
        }
        this.updateStatusBar();
    }

    private updateVisualIndicators(uri: vscode.Uri): void {
        const statusMap = this.dependencyStatusCache.get(uri.fsPath);
        if (statusMap) {
            this.diagnosticsManager.updateDiagnostics(uri, statusMap);
        }
    }

    private updateStatusBar(): void {
        let pendingCount = 0;
        let deniedCount = 0;

        for (const statusMap of this.dependencyStatusCache.values()) {
            for (const depInfo of statusMap.values()) {
                if (depInfo.status === ApprovalStatus.PENDING) {
                    pendingCount++;
                } else if (depInfo.status === ApprovalStatus.DENIED) {
                    deniedCount++;
                }
            }
        }

        if (deniedCount > 0) {
            this.statusBarItem.text = `$(error) RepoGate: ${deniedCount} denied`;
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        } else if (pendingCount > 0) {
            this.statusBarItem.text = `$(clock) RepoGate: ${pendingCount} pending`;
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else {
            this.statusBarItem.text = `$(check) RepoGate: All approved`;
            this.statusBarItem.backgroundColor = undefined;
        }

        this.statusBarItem.show();
    }

    private showStatusReport(): void {
        const report: string[] = ['RepoGate Dependency Status\n'];

        for (const [filePath, statusMap] of this.dependencyStatusCache) {
            const fileName = filePath.split('/').pop() || filePath;
            report.push(`\n${fileName}:`);

            for (const [packageName, depInfo] of statusMap) {
                const statusIcon = depInfo.status === ApprovalStatus.APPROVED ? '✓' :
                                  depInfo.status === ApprovalStatus.DENIED ? '✗' : '⏳';
                const version = depInfo.version ? ` v${depInfo.version}` : '';
                report.push(`  ${statusIcon} ${packageName}${version} (${depInfo.status})`);
            }
        }

        const panel = vscode.window.createWebviewPanel(
            'repogateStatus',
            'RepoGate Status',
            vscode.ViewColumn.One,
            {}
        );

        panel.webview.html = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: monospace; padding: 20px; }
                    pre { white-space: pre-wrap; }
                </style>
            </head>
            <body>
                <pre>${report.join('\n')}</pre>
            </body>
            </html>
        `;
    }

    private async checkCurrentDependency(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor');
            return;
        }

        const position = editor.selection.active;
        const line = editor.document.lineAt(position.line).text;

        // Try to extract package name from current line
        // This is a simple implementation - could be enhanced
        vscode.window.showInformationMessage('RepoGate: Checking dependency...');
    }

    private findParser(fileName: string): DependencyParser | undefined {
        return this.parsers.find(parser => parser.supports(fileName));
    }

    /**
     * Notify RepoGate platform when a dependency is removed
     */
    private async notifyDependencyRemoval(dependency: DependencyInfo, projectName?: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('repogate');
        const enabled = config.get<boolean>('enabled');
        const apiToken = config.get<string>('apiToken');
        const apiUrl = config.get<string>('apiUrl') || 'https://app.repogate.io/api/v1';

        if (!enabled || !apiToken || apiToken.trim() === '') {
            return;
        }

        try {
            const client = new RepoGateApiClient(apiUrl, apiToken);
            
            // Get developer info
            const username = os.userInfo().username;
            const hostname = os.hostname();
            const osInfo = `${os.type()} ${os.release()}`;

            await client.updateDependency({
                packageName: dependency.packageName,
                packageManager: dependency.packageManager,
                action: 'removed',
                status: dependency.status,
                projectName: projectName,
                timestamp: new Date().toISOString(),
                developer: {
                    username: username,
                    hostname: hostname,
                    os: osInfo
                }
            });

            console.log(`RepoGate: Notified platform of removal: ${dependency.packageName}`);
            
            // Show notification if it was a denied package
            if (dependency.status === ApprovalStatus.DENIED) {
                vscode.window.showInformationMessage(
                    `✓ RepoGate: Removed denied package '${dependency.packageName}' - Platform has been notified`
                );
            }
        } catch (error) {
            console.error('RepoGate: Failed to notify platform of removal:', error);
            // Don't show error to user - this is a background operation
        }
    }

    /**
     * Manually trigger a scan of all packages and send to /queue
     * Can be called multiple times (doesn't check initialScanCompleted flag)
     */
    async manualScan(): Promise<void> {
        const config = vscode.workspace.getConfiguration('repogate');
        const apiToken = config.get<string>('apiToken');
        
        if (!apiToken || apiToken.trim() === '') {
            vscode.window.showErrorMessage(
                'RepoGate: API Token is required. Please configure it in settings.',
                'Open Settings'
            ).then(selection => {
                if (selection === 'Open Settings') {
                    vscode.commands.executeCommand('workbench.action.openSettings', 'repogate');
                }
            });
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showWarningMessage('RepoGate: No workspace folder open');
            return;
        }

        vscode.window.showInformationMessage('RepoGate: Scanning all packages...');

        const allPackages: Array<{packageName: string, packageVersion?: string, packageManager: string, projectName?: string}> = [];
        const patterns = [
            '**/package.json',
            '**/pom.xml',
            '**/build.gradle',
            '**/build.gradle.kts'
        ];

        for (const folder of workspaceFolders) {
            const projectName = folder.name;
            
            for (const pattern of patterns) {
                const files = await vscode.workspace.findFiles(
                    new vscode.RelativePattern(folder, pattern),
                    '**/node_modules/**'
                );

                for (const file of files) {
                    try {
                        const content = await vscode.workspace.fs.readFile(file);
                        const contentStr = content.toString();

                        const fileName = file.path.split('/').pop() || '';
                        const parser = this.findParser(fileName);
                        
                        if (parser) {
                            const deps = parser.parseAllDependencies(contentStr);
                            
                            deps.forEach(dep => {
                                allPackages.push({
                                    packageName: dep.packageName,
                                    packageVersion: dep.version,
                                    packageManager: dep.packageManager,
                                    projectName: projectName
                                });
                            });
                        }
                    } catch (error) {
                        console.error(`Error reading file ${file.fsPath}:`, error);
                    }
                }
            }
        }

        if (allPackages.length > 0) {
            await this.queuePackages(allPackages);
            vscode.window.showInformationMessage(
                `✓ RepoGate: Successfully scanned and queued ${allPackages.length} packages for review`
            );
        } else {
            vscode.window.showInformationMessage('RepoGate: No packages found in workspace');
        }
    }

    dispose(): void {
        this.validator.dispose();
        this.diagnosticsManager.dispose();
        this.statusBarItem.dispose();
        this.disposables.forEach(d => d.dispose());
        this.fileContentsCache.clear();
        this.dependencyStatusCache.clear();
    }
}
