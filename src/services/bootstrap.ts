import * as vscode from 'vscode';
import * as path from 'path';
import { RepoGateApiClient, QueueRequest } from '../api/client';
import { RepoGateConfig } from '../auth/authManager';
import { logger } from '../utils/logger';
import { GitDetector } from '../utils/gitDetector';
import { DependencyParser } from '../parsers/DependencyParser';
import { NpmDependencyParser } from '../parsers/NpmDependencyParser';
import { MavenDependencyParser } from '../parsers/MavenDependencyParser';
import { GradleDependencyParser } from '../parsers/GradleDependencyParser';

const BOOTSTRAP_KEY = 'repogate.bootstrapCompleted';

export class BootstrapService {
    private parsers: DependencyParser[];

    constructor(private context: vscode.ExtensionContext) {
        this.parsers = [
            new NpmDependencyParser(),
            new MavenDependencyParser(),
            new GradleDependencyParser()
        ];
    }

    /**
     * Check if bootstrap has been completed for this workspace
     */
    isBootstrapCompleted(): boolean {
        const workspaceId = this.getWorkspaceId();
        const completed = this.context.workspaceState.get<string[]>(BOOTSTRAP_KEY) || [];
        return completed.includes(workspaceId);
    }

    /**
     * Mark bootstrap as completed for this workspace
     */
    private markBootstrapCompleted(): void {
        const workspaceId = this.getWorkspaceId();
        const completed = this.context.workspaceState.get<string[]>(BOOTSTRAP_KEY) || [];
        if (!completed.includes(workspaceId)) {
            completed.push(workspaceId);
            this.context.workspaceState.update(BOOTSTRAP_KEY, completed);
        }
    }

    /**
     * Reset bootstrap state (for testing or manual re-scan)
     */
    resetBootstrap(): void {
        const workspaceId = this.getWorkspaceId();
        const completed = this.context.workspaceState.get<string[]>(BOOTSTRAP_KEY) || [];
        const index = completed.indexOf(workspaceId);
        if (index >= 0) {
            completed.splice(index, 1);
            this.context.workspaceState.update(BOOTSTRAP_KEY, completed);
        }
    }

    /**
     * Perform initial scan and send to /queue
     * Returns true if successful, false otherwise
     */
    async bootstrapQueue(config: RepoGateConfig): Promise<boolean> {
        try {
            logger.info('Starting bootstrap queue process...');

            const client = new RepoGateApiClient(config.apiUrl, config.apiToken);
            const workspaceId = this.getWorkspaceId();
            
            // Check if workspace has a Git repository
            const hasRepository = await GitDetector.hasRepository();

            // Find all dependency files
            const files = await this.findDependencyFiles();
            
            if (files.length === 0) {
                logger.info('No dependency files found, skipping bootstrap');
                this.markBootstrapCompleted();
                return true;
            }

            logger.info(`Found ${files.length} dependency files`);

            // Group by ecosystem
            const ecosystemPackages = new Map<string, Array<{ name: string; version?: string; path: string }>>();

            for (const file of files) {
                const fileName = path.basename(file.fsPath);
                const parser = this.findParser(fileName);

                if (!parser) {
                    continue;
                }

                try {
                    const content = await vscode.workspace.fs.readFile(file);
                    const dependencies = parser.parseAllDependencies(content.toString());

                    const ecosystem = this.getEcosystem(fileName);
                    if (!ecosystemPackages.has(ecosystem)) {
                        ecosystemPackages.set(ecosystem, []);
                    }

                    const packages = ecosystemPackages.get(ecosystem)!;
                    for (const dep of dependencies) {
                        packages.push({
                            name: dep.packageName,
                            version: dep.version,
                            path: vscode.workspace.asRelativePath(file.fsPath)
                        });
                    }
                } catch (error) {
                    logger.error(`Failed to parse ${file.fsPath}:`, error);
                }
            }

            // Send to /queue for each ecosystem
            let totalPackages = 0;
            for (const [ecosystem, packages] of ecosystemPackages) {
                if (packages.length === 0) {
                    continue;
                }

                const payload: QueueRequest = {
                    projectName: workspaceId,
                    ecosystem,
                    packages,
                    timestamp: new Date().toISOString(),
                    repository: hasRepository
                };

                await client.queue(payload);
                totalPackages += packages.length;
                logger.info(`Queued ${packages.length} ${ecosystem} packages`);
            }

            this.markBootstrapCompleted();
            logger.info(`Bootstrap completed: ${totalPackages} total packages queued`);
            
            vscode.window.showInformationMessage(
                `✓ RepoGate: Successfully queued ${totalPackages} packages for review`
            );

            return true;
        } catch (error) {
            logger.error('Bootstrap failed:', error);
            vscode.window.showErrorMessage(
                `❌ RepoGate: Failed to scan existing packages. Please check your API connection.`
            );
            return false;
        }
    }

    /**
     * Find all dependency files in workspace
     */
    private async findDependencyFiles(): Promise<vscode.Uri[]> {
        const patterns = [
            '**/package.json',
            '**/pom.xml',
            '**/build.gradle',
            '**/build.gradle.kts'
        ];

        const files: vscode.Uri[] = [];

        for (const pattern of patterns) {
            const found = await vscode.workspace.findFiles(
                pattern,
                '**/node_modules/**' // Exclude node_modules
            );
            files.push(...found);
        }

        return files;
    }

    /**
     * Find parser for file
     */
    private findParser(fileName: string): DependencyParser | undefined {
        return this.parsers.find(parser => parser.supports(fileName));
    }

    /**
     * Get ecosystem from file name
     */
    private getEcosystem(fileName: string): string {
        if (fileName === 'package.json') return 'npm';
        if (fileName === 'pom.xml') return 'maven';
        if (fileName.includes('build.gradle')) return 'gradle';
        return 'unknown';
    }

    /**
     * Get workspace ID (folder name or path)
     */
    private getWorkspaceId(): string {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            return workspaceFolders[0].name;
        }
        return 'unknown-workspace';
    }
}
