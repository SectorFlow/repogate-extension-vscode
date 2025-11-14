import * as vscode from 'vscode';
import { RepoGateApiClient } from '../api/RepoGateApiClient';
import { DependencyInfo, ApprovalStatus } from '../models/DependencyInfo';

export class DependencyValidator {
    private pendingDependencies: Map<string, DependencyInfo> = new Map();
    private pollingIntervals: Map<string, NodeJS.Timeout> = new Map();
    private monitor: any; // Reference to DependencyMonitor
    private isConnected: boolean = false;
    private connectionCheckInProgress: boolean = false;

    constructor(private context: vscode.ExtensionContext, monitor: any) {
        this.monitor = monitor;
    }

    async validateDependency(dependency: DependencyInfo, projectName?: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('repogate');
        const enabled = config.get<boolean>('enabled');

        if (!enabled) {
            return;
        }

        const apiToken = config.get<string>('apiToken');
        if (!apiToken || apiToken.trim() === '') {
            vscode.window.showWarningMessage(
                'RepoGate: API Token Required. Please configure your token in settings.',
                'Open Settings'
            ).then(selection => {
                if (selection === 'Open Settings') {
                    vscode.commands.executeCommand('workbench.action.openSettings', 'repogate');
                }
            });
            return;
        }

        const apiUrl = config.get<string>('apiUrl') || 'https://api.repogate.io/api/v1';
        const key = `${dependency.packageName}:${dependency.packageManager}`;
        this.pendingDependencies.set(key, dependency);

        // Show waiting message
        vscode.window.showInformationMessage(
            `⏳ RepoGate: Waiting for RepoGate service to respond...`
        );

        try {
            const client = new RepoGateApiClient(apiUrl, apiToken);
            
            // Try to connect and validate
            const response = await client.requestDependency(
                dependency.packageName,
                dependency.packageManager,
                dependency.version,
                projectName
            );

            // Connection successful!
            if (!this.isConnected) {
                this.isConnected = true;
                vscode.window.showInformationMessage(
                    `✓ RepoGate: Connected successfully to RepoGate service`
                );
            }

            // Handle response based on new status values
            this.handleDependencyResponse(dependency, response, client);
        } catch (error) {
            // Connection failed - show friendly message
            this.isConnected = false;
            
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('Failed to fetch') || errorMessage.includes('Network')) {
                vscode.window.showWarningMessage(
                    `⏳ RepoGate: Waiting for RepoGate service to start... Will retry automatically.`
                );
                
                // Set status to pending and retry
                dependency.status = ApprovalStatus.PENDING;
                this.monitor.updateDependencyStatus(
                    dependency.packageName,
                    dependency.packageManager,
                    ApprovalStatus.PENDING
                );
                
                // Retry connection after 10 seconds
                this.retryConnection(dependency, apiUrl, apiToken, projectName);
            } else {
                vscode.window.showErrorMessage(
                    `RepoGate: Unable to connect - ${errorMessage}`
                );
                dependency.status = ApprovalStatus.ERROR;
                this.monitor.updateDependencyStatus(
                    dependency.packageName,
                    dependency.packageManager,
                    ApprovalStatus.ERROR
                );
            }
        }
    }

    private handleDependencyResponse(dependency: DependencyInfo, response: any, client: RepoGateApiClient): void {
        const key = `${dependency.packageName}:${dependency.packageManager}`;

        switch (response.status) {
            case 'approved':
                dependency.status = ApprovalStatus.APPROVED;
                this.monitor.updateDependencyStatus(
                    dependency.packageName,
                    dependency.packageManager,
                    ApprovalStatus.APPROVED
                );
                vscode.window.showInformationMessage(
                    `✓ RepoGate: ${response.message} - Package '${dependency.packageName}' can be used.`
                );
                this.pendingDependencies.delete(key);
                break;

            case 'denied':
                dependency.status = ApprovalStatus.DENIED;
                this.monitor.updateDependencyStatus(
                    dependency.packageName,
                    dependency.packageManager,
                    ApprovalStatus.DENIED
                );
                vscode.window.showErrorMessage(
                    `✗ RepoGate: ${response.message} - Package '${dependency.packageName}' should not be used.`,
                    'I Understand',
                    'Remove It'
                ).then(action => {
                    if (action === 'Remove It') {
                        vscode.window.showInformationMessage(
                            'RepoGate: Please manually remove the dependency from your configuration file.'
                        );
                    }
                });
                this.pendingDependencies.delete(key);
                break;

            case 'pending':
                dependency.status = ApprovalStatus.PENDING;
                this.monitor.updateDependencyStatus(
                    dependency.packageName,
                    dependency.packageManager,
                    ApprovalStatus.PENDING
                );
                vscode.window.showWarningMessage(
                    `⏳ RepoGate: ${response.message}`
                );
                // Start polling for approval status
                this.startPolling(dependency, client);
                break;

            case 'scanning':
                dependency.status = ApprovalStatus.SCANNING;
                this.monitor.updateDependencyStatus(
                    dependency.packageName,
                    dependency.packageManager,
                    ApprovalStatus.SCANNING
                );
                vscode.window.showInformationMessage(
                    `🔍 RepoGate: ${response.message}`
                );
                // Start polling to check when scanning completes
                this.startPolling(dependency, client);
                break;

            case 'not_found':
                dependency.status = ApprovalStatus.NOT_FOUND;
                this.monitor.updateDependencyStatus(
                    dependency.packageName,
                    dependency.packageManager,
                    ApprovalStatus.NOT_FOUND
                );
                vscode.window.showWarningMessage(
                    `❓ RepoGate: ${response.message}`
                );
                // Start polling in case it gets added
                this.startPolling(dependency, client);
                break;

            default:
                // Fallback for unknown status
                dependency.status = ApprovalStatus.PENDING;
                this.monitor.updateDependencyStatus(
                    dependency.packageName,
                    dependency.packageManager,
                    ApprovalStatus.PENDING
                );
                vscode.window.showWarningMessage(
                    `⏳ RepoGate: ${response.message || 'Package status unknown'}`
                );
                this.startPolling(dependency, client);
                break;
        }
    }

    private retryConnection(dependency: DependencyInfo, apiUrl: string, apiToken: string, projectName?: string): void {
        const key = `${dependency.packageName}:${dependency.packageManager}`;
        
        // Clear any existing interval
        const existingInterval = this.pollingIntervals.get(key);
        if (existingInterval) {
            clearInterval(existingInterval);
        }

        let retryCount = 0;
        const maxRetries = 30; // Try for 5 minutes (30 * 10 seconds)

        const interval = setInterval(async () => {
            retryCount++;
            
            if (retryCount > maxRetries) {
                this.stopPolling(key);
                vscode.window.showWarningMessage(
                    `RepoGate: Could not connect to service after ${maxRetries} attempts. Please check if the service is running.`
                );
                return;
            }

            try {
                const client = new RepoGateApiClient(apiUrl, apiToken);
                const response = await client.requestDependency(
                    dependency.packageName,
                    dependency.packageManager,
                    dependency.version,
                    projectName
                );

                // Connection successful!
                if (!this.isConnected) {
                    this.isConnected = true;
                    vscode.window.showInformationMessage(
                        `✓ RepoGate: Connected successfully to RepoGate service`
                    );
                }

                // Stop retrying
                this.stopPolling(key);

                // Handle response
                this.handleDependencyResponse(dependency, response, client);
            } catch (error) {
                // Still can't connect, will retry on next interval
                console.log(`RepoGate: Retry ${retryCount}/${maxRetries} - still waiting for service...`);
            }
        }, 10000); // Retry every 10 seconds

        this.pollingIntervals.set(key, interval);
    }

    private startPolling(dependency: DependencyInfo, client: RepoGateApiClient): void {
        const key = `${dependency.packageName}:${dependency.packageManager}`;

        // Clear any existing interval
        const existingInterval = this.pollingIntervals.get(key);
        if (existingInterval) {
            clearInterval(existingInterval);
        }

        const interval = setInterval(async () => {
            try {
                const response = await client.checkDependency(
                    dependency.packageName,
                    dependency.packageManager
                );

                // Handle different statuses
                switch (response.status) {
                    case 'approved':
                        dependency.status = ApprovalStatus.APPROVED;
                        this.pendingDependencies.delete(key);
                        this.stopPolling(key);

                        this.monitor.updateDependencyStatus(
                            dependency.packageName,
                            dependency.packageManager,
                            ApprovalStatus.APPROVED
                        );

                        vscode.window.showInformationMessage(
                            `✓ RepoGate: ${response.message} - Package '${dependency.packageName}' can now be used.`
                        );
                        break;

                    case 'denied':
                        dependency.status = ApprovalStatus.DENIED;
                        this.pendingDependencies.delete(key);
                        this.stopPolling(key);

                        this.monitor.updateDependencyStatus(
                            dependency.packageName,
                            dependency.packageManager,
                            ApprovalStatus.DENIED
                        );

                        const action = await vscode.window.showErrorMessage(
                            `✗ RepoGate: ${response.message}\n\nPackage '${dependency.packageName}' should not be used in production code.`,
                            'I Understand',
                            'Remove It'
                        );

                        if (action === 'Remove It') {
                            vscode.window.showInformationMessage(
                                'RepoGate: Please manually remove the dependency from your configuration file.'
                            );
                        }
                        break;

                    case 'pending':
                        // Still pending, continue polling
                        dependency.status = ApprovalStatus.PENDING;
                        this.monitor.updateDependencyStatus(
                            dependency.packageName,
                            dependency.packageManager,
                            ApprovalStatus.PENDING
                        );
                        break;

                    case 'scanning':
                        // Still scanning, continue polling
                        dependency.status = ApprovalStatus.SCANNING;
                        this.monitor.updateDependencyStatus(
                            dependency.packageName,
                            dependency.packageManager,
                            ApprovalStatus.SCANNING
                        );
                        break;

                    case 'not_found':
                        // Package not found, continue polling in case it gets added
                        dependency.status = ApprovalStatus.NOT_FOUND;
                        this.monitor.updateDependencyStatus(
                            dependency.packageName,
                            dependency.packageManager,
                            ApprovalStatus.NOT_FOUND
                        );
                        break;
                }
            } catch (error) {
                // If connection lost during polling, show message
                if (!this.isConnected) {
                    console.error('RepoGate: Lost connection during polling');
                }
            }
        }, 10000); // Poll every 10 seconds

        this.pollingIntervals.set(key, interval);
    }

    private stopPolling(key: string): void {
        const interval = this.pollingIntervals.get(key);
        if (interval) {
            clearInterval(interval);
            this.pollingIntervals.delete(key);
        }
    }

    dispose(): void {
        // Clear all polling intervals
        for (const interval of this.pollingIntervals.values()) {
            clearInterval(interval);
        }
        this.pollingIntervals.clear();
        this.pendingDependencies.clear();
    }
}
