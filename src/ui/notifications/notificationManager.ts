import * as vscode from 'vscode';
import { logger } from '../../utils/logger';

export class NotificationManager {
    /**
     * Show denial notification with actions
     */
    async showDenied(
        packageName: string,
        version: string | undefined,
        message: string,
        reasonUrl?: string
    ): Promise<void> {
        const pkgDisplay = version ? `${packageName}@${version}` : packageName;
        const buttons: string[] = ['View Details'];
        
        if (reasonUrl) {
            buttons.push('Learn More');
        }

        const result = await vscode.window.showErrorMessage(
            `❌ RepoGate: Package '${pkgDisplay}' has been denied\n${message}`,
            ...buttons
        );

        if (result === 'View Details') {
            vscode.commands.executeCommand('workbench.action.problems.focus');
        } else if (result === 'Learn More' && reasonUrl) {
            vscode.env.openExternal(vscode.Uri.parse(reasonUrl));
        }

        logger.warn(`Package denied: ${pkgDisplay} - ${message}`);
    }

    /**
     * Show pending notification
     */
    showPending(packageName: string, version: string | undefined): void {
        const pkgDisplay = version ? `${packageName}@${version}` : packageName;
        vscode.window.showInformationMessage(
            `⏳ RepoGate: Package '${pkgDisplay}' is pending review by your security team`
        );
        logger.info(`Package pending: ${pkgDisplay}`);
    }

    /**
     * Show scanning notification
     */
    showScanning(packageName: string, version: string | undefined): void {
        const pkgDisplay = version ? `${packageName}@${version}` : packageName;
        vscode.window.showInformationMessage(
            `🔍 RepoGate: Package '${pkgDisplay}' is being scanned for vulnerabilities`
        );
        logger.info(`Package scanning: ${pkgDisplay}`);
    }

    /**
     * Show approved notification (optional, can be silent)
     */
    showApproved(packageName: string, version: string | undefined, silent: boolean = true): void {
        const pkgDisplay = version ? `${packageName}@${version}` : packageName;
        
        if (!silent) {
            vscode.window.showInformationMessage(
                `✓ RepoGate: Package '${pkgDisplay}' is approved for use`
            );
        }
        
        logger.info(`Package approved: ${pkgDisplay}`);
    }

    /**
     * Show not found notification
     */
    showNotFound(packageName: string, version: string | undefined): void {
        const pkgDisplay = version ? `${packageName}@${version}` : packageName;
        vscode.window.showWarningMessage(
            `❓ RepoGate: Package '${pkgDisplay}' not found. A request will be submitted for review.`
        );
        logger.info(`Package not found: ${pkgDisplay}`);
    }

    /**
     * Show removal confirmation (for denied packages)
     */
    showRemovalConfirmed(packageName: string, version: string | undefined): void {
        const pkgDisplay = version ? `${packageName}@${version}` : packageName;
        vscode.window.showInformationMessage(
            `✓ RepoGate: Removed denied package '${pkgDisplay}' - Platform has been notified`
        );
        logger.info(`Package removed: ${pkgDisplay}`);
    }

    /**
     * Show connection error
     */
    async showConnectionError(error: string): Promise<void> {
        const result = await vscode.window.showErrorMessage(
            `❌ RepoGate: Connection failed\n${error}`,
            'Test Connection',
            'Open Settings'
        );

        if (result === 'Test Connection') {
            vscode.commands.executeCommand('repogate.testConnection');
        } else if (result === 'Open Settings') {
            vscode.commands.executeCommand('workbench.action.openSettings', 'repogate');
        }

        logger.error(`Connection error: ${error}`);
    }

    /**
     * Show success notification
     */
    showSuccess(message: string): void {
        vscode.window.showInformationMessage(`✓ RepoGate: ${message}`);
        logger.info(message);
    }

    /**
     * Show error notification
     */
    showError(message: string): void {
        vscode.window.showErrorMessage(`❌ RepoGate: ${message}`);
        logger.error(message);
    }

    /**
     * Show warning notification
     */
    showWarning(message: string): void {
        vscode.window.showWarningMessage(`⚠️ RepoGate: ${message}`);
        logger.warn(message);
    }
}
