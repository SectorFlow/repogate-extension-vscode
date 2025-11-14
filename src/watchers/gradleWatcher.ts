import * as vscode from 'vscode';
import * as path from 'path';
import { RepoGateApiClient, RequestPayload, CheckPayload, UpdatePayload } from '../api/client';
import { AuthManager } from '../auth/authManager';
import { logger } from '../utils/logger';
import { DiagnosticsProvider } from '../ui/diagnostics/diagnosticsProvider';
import { NotificationManager } from '../ui/notifications/notificationManager';
import { GradleDependencyParser } from '../parsers/GradleDependencyParser';
import { DependencyInfo } from '../models/DependencyInfo';
import { GitDetector } from '../utils/gitDetector';

export class GradleWatcher {
    private watcher: vscode.FileSystemWatcher | undefined;
    private parser: GradleDependencyParser;
    private fileCache: Map<string, string> = new Map();
    private statusCache: Map<string, Map<string, DependencyInfo>> = new Map();
    private pollingIntervals: Map<string, NodeJS.Timeout> = new Map();
    private pendingNotifications: Set<string> = new Set();
    private hasRepository: boolean = false;

    constructor(
        private context: vscode.ExtensionContext,
        private authManager: AuthManager,
        private diagnostics: DiagnosticsProvider,
        private notifications: NotificationManager
    ) {
        this.parser = new GradleDependencyParser();
    }

    /**
     * Start watching package.json files
     */
    async start() {
        // Check if workspace has a Git repository
        this.hasRepository = await GitDetector.hasRepository();
        
        this.watcher = vscode.workspace.createFileSystemWatcher('**/{build.gradle,build.gradle.kts}');

        this.watcher.onDidChange(uri => this.handleFileChange(uri));
        this.watcher.onDidCreate(uri => this.handleFileChange(uri));
        this.watcher.onDidDelete(uri => this.handleFileDelete(uri));

        logger.info('Gradle watcher started');
    }

    /**
     * Handle file change
     */
    private async handleFileChange(uri: vscode.Uri) {
        // Ignore node_modules
        if (uri.fsPath.includes('node_modules')) {
            return;
        }

        try {
            const content = await vscode.workspace.fs.readFile(uri);
            const currentContent = content.toString();
            const previousContent = this.fileCache.get(uri.fsPath) || '';

            // Parse new dependencies
            const newDependencies = this.parser.parseNewDependencies(currentContent, previousContent);

            if (newDependencies.length > 0) {
                logger.info(`Detected ${newDependencies.length} new dependencies in ${uri.fsPath}`);
                
                for (const dep of newDependencies) {
                    await this.handleNewDependency(uri, dep);
                }
            }

            // Detect removed dependencies
            const currentDeps = this.parser.parseAllDependencies(currentContent);
            const currentDepNames = new Set(currentDeps.map(d => d.packageName));

            const statusMap = this.statusCache.get(uri.fsPath);
            if (statusMap) {
                for (const [depName, depInfo] of statusMap) {
                    if (!currentDepNames.has(depName)) {
                        await this.handleRemovedDependency(uri, depInfo);
                        statusMap.delete(depName);
                    }
                }
            }

            // Update cache
            this.fileCache.set(uri.fsPath, currentContent);
        } catch (error) {
            logger.error(`Error handling file change for ${uri.fsPath}:`, error);
        }
    }

    /**
     * Handle file deletion
     */
    private handleFileDelete(uri: vscode.Uri) {
        this.fileCache.delete(uri.fsPath);
        this.statusCache.delete(uri.fsPath);
        this.diagnostics.clearFile(uri);
        logger.info(`File deleted: ${uri.fsPath}`);
    }

    /**
     * Handle new dependency
     */
    private async handleNewDependency(uri: vscode.Uri, dep: DependencyInfo) {
        const config = await this.authManager.getConfig();
        if (!config) return;
        const client = new RepoGateApiClient(config.apiUrl, config.apiToken);
        const workspaceId = this.getWorkspaceId();

        // Initialize status cache
        if (!this.statusCache.has(uri.fsPath)) {
            this.statusCache.set(uri.fsPath, new Map());
        }
        const statusMap = this.statusCache.get(uri.fsPath)!;
        statusMap.set(dep.packageName, dep);

        try {
            // Send to /request
            const payload: RequestPayload = {
                projectName: workspaceId,
                ecosystem: 'gradle',
                name: dep.packageName,
                version: dep.version,
                path: vscode.workspace.asRelativePath(uri.fsPath),
                repository: this.hasRepository
            };

            const response = await client.request(payload);
            
            // Update status
            dep.status = response.status as any;
            
            // Handle response
            await this.handleDependencyResponse(uri, dep, response);

            // Start polling if not final status
            if (response.status !== 'approved' && response.status !== 'denied') {
                this.startPolling(uri, dep);
            }
        } catch (error) {
            logger.error(`Failed to request dependency ${dep.packageName}:`, error);
            this.notifications.showError(`Failed to validate ${dep.packageName}`);
        }
    }

    /**
     * Handle dependency response
     */
    private async handleDependencyResponse(uri: vscode.Uri, dep: DependencyInfo, response: any) {
        const line = await this.findDependencyLine(uri, dep.packageName);

        // Update diagnostics
        this.diagnostics.addDiagnostic(uri, {
            name: dep.packageName,
            version: dep.version,
            status: response.status,
            message: response.message,
            line,
            reasonUrl: response.reasonUrl
        });

        // Show notifications
        switch (response.status) {
            case 'approved':
                this.notifications.showApproved(dep.packageName, dep.version, true);
                break;
            case 'denied':
                this.notifications.showDenied(dep.packageName, dep.version, response.message, response.reasonUrl);
                break;
            case 'pending':
                // Only show pending notification once
                if (!this.pendingNotifications.has(dep.packageName)) {
                    this.notifications.showPending(dep.packageName, dep.version);
                    this.pendingNotifications.add(dep.packageName);
                }
                break;
            case 'scanning':
                // Only show scanning notification once
                if (!this.pendingNotifications.has(dep.packageName)) {
                    this.notifications.showScanning(dep.packageName, dep.version);
                    this.pendingNotifications.add(dep.packageName);
                }
                break;
            case 'not_found':
                // Only show not_found notification once
                if (!this.pendingNotifications.has(dep.packageName)) {
                    this.notifications.showNotFound(dep.packageName, dep.version);
                    this.pendingNotifications.add(dep.packageName);
                }
                break;
        }
    }

    /**
     * Start polling for dependency status
     */
    private async startPolling(uri: vscode.Uri, dep: DependencyInfo) {
        const key = `${uri.fsPath}:${dep.packageName}`;
        
        // Clear existing interval
        if (this.pollingIntervals.has(key)) {
            clearInterval(this.pollingIntervals.get(key)!);
        }

        // Get poll interval from config
        const config = await this.authManager.getConfig();
        const pollInterval = config?.pollIntervalMs || 10000;

        const interval = setInterval(async () => {
            await this.checkDependencyStatus(uri, dep);
        }, pollInterval);

        this.pollingIntervals.set(key, interval);
        logger.debug(`Started polling for ${dep.packageName}`);
    }

    /**
     * Stop polling for dependency
     */
    private stopPolling(uri: vscode.Uri, dep: DependencyInfo) {
        const key = `${uri.fsPath}:${dep.packageName}`;
        
        if (this.pollingIntervals.has(key)) {
            clearInterval(this.pollingIntervals.get(key)!);
            this.pollingIntervals.delete(key);
            logger.debug(`Stopped polling for ${dep.packageName}`);
        }
        
        // Clear pending notification tracking
        this.pendingNotifications.delete(dep.packageName);
    }

    /**
     * Check dependency status via /check endpoint
     */
    private async checkDependencyStatus(uri: vscode.Uri, dep: DependencyInfo) {
        const config = await this.authManager.getConfig();
        if (!config) return;
        const client = new RepoGateApiClient(config.apiUrl, config.apiToken);
        const workspaceId = this.getWorkspaceId();

        try {
            const payload: CheckPayload = {
                projectName: workspaceId,
                ecosystem: 'gradle',
                name: dep.packageName,
                version: dep.version,
                repository: this.hasRepository
            };

            const response = await client.check(payload);
            
            // Update status
            dep.status = response.status as any;
            
            // Update diagnostics
            await this.handleDependencyResponse(uri, dep, response);

            // Stop polling if final status
            if (response.status === 'approved' || response.status === 'denied') {
                this.stopPolling(uri, dep);
            }
        } catch (error) {
            logger.error(`Failed to check dependency ${dep.packageName}:`, error);
        }
    }

    /**
     * Handle removed dependency
     */
    private async handleRemovedDependency(uri: vscode.Uri, dep: DependencyInfo) {
        const config = await this.authManager.getConfig();
        if (!config) return;
        const client = new RepoGateApiClient(config.apiUrl, config.apiToken);
        const workspaceId = this.getWorkspaceId();

        // Stop polling
        this.stopPolling(uri, dep);

        // Remove diagnostic
        this.diagnostics.removeDiagnostic(uri, dep.packageName);

        // Notify platform
        try {
            const payload: UpdatePayload = {
                projectName: workspaceId,
                ecosystem: 'gradle',
                name: dep.packageName,
                fromVersion: dep.version,
                toVersion: undefined,
                action: 'removed',
                timestamp: new Date().toISOString(),
                repository: this.hasRepository
            };

            await client.update(payload);

            // Show notification if it was denied
            if (dep.status === 'denied') {
                this.notifications.showRemovalConfirmed(dep.packageName, dep.version);
            }
        } catch (error) {
            logger.error(`Failed to notify removal of ${dep.packageName}:`, error);
        }
    }

    /**
     * Find line number of dependency in file
     */
    private async findDependencyLine(uri: vscode.Uri, packageName: string): Promise<number> {
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            const text = document.getText();
            const lines = text.split('\n');

            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes(`"${packageName}"`)) {
                    return i + 1;
                }
            }
        } catch (error) {
            logger.error(`Failed to find line for ${packageName}:`, error);
        }

        return 0;
    }

    /**
     * Get workspace ID
     */
    private getWorkspaceId(): string {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            return workspaceFolders[0].name;
        }
        return 'unknown-workspace';
    }

    /**
     * Stop watching
     */
    dispose() {
        this.watcher?.dispose();
        
        // Clear all polling intervals
        for (const interval of this.pollingIntervals.values()) {
            clearInterval(interval);
        }
        this.pollingIntervals.clear();

        logger.info('Gradle watcher stopped');
    }
}
