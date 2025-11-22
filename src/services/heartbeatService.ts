import * as vscode from 'vscode';
import { RepoGateApiClient, HeartbeatResponse } from '../api/client';
import { AuthManager } from '../auth/authManager';
import { logger } from '../utils/logger';
import { NotificationManager } from '../ui/notifications/notificationManager';

export class HeartbeatService {
    private interval: NodeJS.Timeout | undefined;
    private readonly HEARTBEAT_INTERVAL_MS = 60000; // 1 minute
    private isRunning = false;
    private notifiedPackages: Set<string> = new Set(); // Track packages we've already notified about

    constructor(
        private context: vscode.ExtensionContext,
        private authManager: AuthManager,
        private notifications: NotificationManager
    ) {}

    /**
     * Start heartbeat service
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            logger.warn('Heartbeat service is already running');
            return;
        }

        logger.info('Starting heartbeat service...');
        this.isRunning = true;

        // Send initial heartbeat immediately
        await this.sendHeartbeat();

        // Schedule periodic heartbeats
        this.interval = setInterval(async () => {
            await this.sendHeartbeat();
        }, this.HEARTBEAT_INTERVAL_MS);

        this.context.subscriptions.push({
            dispose: () => this.stop()
        });

        logger.info(`Heartbeat service started (interval: ${this.HEARTBEAT_INTERVAL_MS / 1000}s)`);
    }

    /**
     * Stop heartbeat service
     */
    stop(): void {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = undefined;
        }
        this.isRunning = false;
        logger.info('Heartbeat service stopped');
    }

    /**
     * Send heartbeat to server
     */
    private async sendHeartbeat(): Promise<void> {
        try {
            const config = await this.authManager.getConfig();
            if (!config || config.authMode === 'UNAUTHENTICATED') {
                logger.debug('Skipping heartbeat: not authenticated');
                return;
            }

            logger.debug(`Sending heartbeat to: ${config.apiUrl}/heartbeat`);
            const client = new RepoGateApiClient(config.apiUrl, this.authManager);
            const response = await client.heartbeat();

            logger.debug(`Heartbeat response received:`, JSON.stringify(response, null, 2));
            logger.debug(`Heartbeat status: ${response?.status}, message: ${response?.message}`);

            // Handle response
            if (response) {
                await this.handleHeartbeatResponse(response);
            } else {
                logger.warn('Heartbeat response is undefined - backend may not be returning proper response');
            }
        } catch (error) {
            logger.error('Heartbeat failed:', error);
            // Don't show error to user - heartbeat failures should be silent
        }
    }

    /**
     * Handle heartbeat response
     */
    private async handleHeartbeatResponse(response: HeartbeatResponse): Promise<void> {
        if (response.status === 'healthy') {
            // All good, nothing to do
            return;
        }

        if (response.status === 'warning' && response.alert) {
            // Denied packages detected
            await this.handleDeniedPackagesAlert(response.alert);
        }
    }

    /**
     * Handle denied packages alert
     */
    private async handleDeniedPackagesAlert(alert: {
        severity: 'warning';
        title: string;
        message: string;
        packages: string[];
    }): Promise<void> {
        // Filter out packages we've already notified about
        const newDeniedPackages = alert.packages.filter(pkg => !this.notifiedPackages.has(pkg));

        if (newDeniedPackages.length === 0) {
            logger.debug('No new denied packages to notify about');
            return;
        }

        // Mark these packages as notified
        newDeniedPackages.forEach(pkg => this.notifiedPackages.add(pkg));

        logger.warn(`Denied packages detected: ${newDeniedPackages.join(', ')}`);

        // Show notification with action buttons
        const packageList = newDeniedPackages.map(pkg => `• ${pkg}`).join('\n');
        const fullMessage = `${alert.message}\n\n${packageList}`;

        const action = await vscode.window.showWarningMessage(
            alert.title,
            {
                modal: true,
                detail: fullMessage
            },
            'View Details',
            'Dismiss'
        );

        if (action === 'View Details') {
            // Open output panel to show more details
            logger.info('=== DENIED PACKAGES DETECTED ===');
            logger.info(alert.message);
            logger.info('Packages:');
            newDeniedPackages.forEach(pkg => logger.info(`  - ${pkg}`));
            logger.info('================================');
            
            // Show output panel
            vscode.commands.executeCommand('workbench.action.output.show');
        }

        // Also show notification via NotificationManager
        this.notifications.showWarning(
            `${alert.title}: ${newDeniedPackages.length} package(s) detected`
        );
    }

    /**
     * Reset notification tracking (for testing)
     */
    resetNotifications(): void {
        this.notifiedPackages.clear();
        logger.info('Heartbeat notification tracking reset');
    }

    /**
     * Check if service is running
     */
    isActive(): boolean {
        return this.isRunning;
    }
}
