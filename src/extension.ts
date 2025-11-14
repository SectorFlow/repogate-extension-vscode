import * as vscode from 'vscode';
import { AuthManager } from './auth/authManager';
import { logger } from './utils/logger';
import { StatusBarManager, RepoGateStatus } from './ui/status/statusBar';
import { DiagnosticsProvider } from './ui/diagnostics/diagnosticsProvider';
import { NotificationManager } from './ui/notifications/notificationManager';
import { BootstrapService } from './services/bootstrap';
import { NpmWatcher } from './watchers/npmWatcher';
import { MavenWatcher } from './watchers/mavenWatcher';
import { GradleWatcher } from './watchers/gradleWatcher';
import { RepoGateApiClient } from './api/client';

let authManager: AuthManager;
let statusBar: StatusBarManager;
let diagnostics: DiagnosticsProvider;
let notifications: NotificationManager;
let bootstrap: BootstrapService;
let npmWatcher: NpmWatcher | undefined;
let mavenWatcher: MavenWatcher | undefined;
let gradleWatcher: GradleWatcher | undefined;

export async function activate(context: vscode.ExtensionContext) {
    logger.initialize();
    logger.info('RepoGate extension activating...');

    // Initialize managers
    authManager = new AuthManager(context);
    statusBar = new StatusBarManager();
    diagnostics = new DiagnosticsProvider();
    notifications = new NotificationManager();
    bootstrap = new BootstrapService(context);

    // Register commands
    registerCommands(context);

    // Check if extension is enabled
    const config = vscode.workspace.getConfiguration('repogate');
    const enabled = config.get<boolean>('enabled', true);

    if (!enabled) {
        logger.info('RepoGate is disabled in settings');
        statusBar.setStatus(RepoGateStatus.DISABLED);
        return;
    }

    // Ensure authentication
    const repoGateConfig = await authManager.ensureAuthOrPrompt();
    if (!repoGateConfig) {
        logger.info('No API token configured, extension will remain passive');
        statusBar.setStatus(RepoGateStatus.DISABLED, 'No API token');
        return;
    }

    statusBar.setStatus(RepoGateStatus.PENDING, 'Initializing...');

    // Check if bootstrap is needed
    if (!bootstrap.isBootstrapCompleted()) {
        logger.info('First run detected, starting bootstrap...');
        const success = await bootstrap.bootstrapQueue(repoGateConfig);
        
        if (!success) {
            statusBar.setStatus(RepoGateStatus.ERROR, 'Bootstrap failed');
            notifications.showError('Failed to scan existing packages. Please check your API connection.');
            return;
        }
    } else {
        logger.info('Bootstrap already completed, skipping...');
    }

    // Start watchers only after successful bootstrap
    await startWatchers(context);

    statusBar.setStatus(RepoGateStatus.CONNECTED, 'Watching for changes');
    logger.info('RepoGate extension activated successfully');

    // Update status bar with diagnostic counts
    updateStatusBarCounts();
}

/**
 * Start file watchers
 */
async function startWatchers(context: vscode.ExtensionContext) {
    logger.info('Starting file watchers...');

    // Start NPM watcher
    npmWatcher = new NpmWatcher(context, authManager, diagnostics, notifications);
    await npmWatcher.start();

    // Start Maven watcher
    mavenWatcher = new MavenWatcher(context, authManager, diagnostics, notifications);
    await mavenWatcher.start();

    // Start Gradle watcher
    gradleWatcher = new GradleWatcher(context, authManager, diagnostics, notifications);
    await gradleWatcher.start();

    logger.info('File watchers started');
}

/**
 * Register extension commands
 */
function registerCommands(context: vscode.ExtensionContext) {
    // Set Token command
    context.subscriptions.push(
        vscode.commands.registerCommand('repogate.setToken', async () => {
            await setToken();
        })
    );

    // Clear Token command
    context.subscriptions.push(
        vscode.commands.registerCommand('repogate.clearToken', async () => {
            await clearToken();
        })
    );

    // Test Connection command
    context.subscriptions.push(
        vscode.commands.registerCommand('repogate.testConnection', async () => {
            await testConnection();
        })
    );

    // Scan Now command
    context.subscriptions.push(
        vscode.commands.registerCommand('repogate.scanNow', async () => {
            await scanNow();
        })
    );

    // Show Output command
    context.subscriptions.push(
        vscode.commands.registerCommand('repogate.showOutput', () => {
            logger.show();
        })
    );

    // Clear Diagnostics command
    context.subscriptions.push(
        vscode.commands.registerCommand('repogate.clearDiagnostics', () => {
            diagnostics.clearAll();
            notifications.showSuccess('Cleared all diagnostics');
        })
    );

    logger.info('Commands registered');
}

/**
 * Set Token command implementation
 */
async function setToken() {
    try {
        const token = await vscode.window.showInputBox({
            prompt: 'Enter your RepoGate API token',
            password: true,  // Masked input
            placeHolder: 'ghp_...',
            ignoreFocusOut: true,
            validateInput: (value) => {
                if (!value || value.trim() === '') {
                    return 'Token cannot be empty';
                }
                return null;
            }
        });

        if (token) {
            await authManager.setToken(token);
            await updateTokenStatus();
            notifications.showSuccess('API token saved securely');
            logger.info('API token updated');
            
            // Prompt to test connection
            const result = await vscode.window.showInformationMessage(
                'Token saved! Would you like to test the connection?',
                'Test Now',
                'Later'
            );
            
            if (result === 'Test Now') {
                await testConnection();
            }
        }
    } catch (error) {
        notifications.showError(`Failed to save token: ${error}`);
        logger.error('Set token error:', error);
    }
}

/**
 * Clear Token command implementation
 */
async function clearToken() {
    try {
        const result = await vscode.window.showWarningMessage(
            'Are you sure you want to clear your API token? The extension will stop monitoring dependencies.',
            { modal: true },
            'Clear Token',
            'Cancel'
        );

        if (result === 'Clear Token') {
            await authManager.clearToken();
            await updateTokenStatus();
            statusBar.setStatus(RepoGateStatus.DISABLED, 'No API token');
            notifications.showSuccess('API token cleared');
            logger.info('API token cleared');
        }
    } catch (error) {
        notifications.showError(`Failed to clear token: ${error}`);
        logger.error('Clear token error:', error);
    }
}

/**
 * Update token status in settings
 */
async function updateTokenStatus() {
    const config = vscode.workspace.getConfiguration('repogate');
    const hasToken = await authManager.getToken();
    const status = hasToken ? '✅ Configured' : '❌ Not configured';
    await config.update('tokenStatus', status, vscode.ConfigurationTarget.Global);
}

/**
 * Test Connection command implementation
 */
async function testConnection() {
    try {
        statusBar.setStatus(RepoGateStatus.PENDING, 'Testing connection...');
        
        const config = await authManager.getConfig();
        if (!config) {
            notifications.showError('No API token configured');
            statusBar.setStatus(RepoGateStatus.ERROR, 'No API token');
            return;
        }

        const client = new RepoGateApiClient(config.apiUrl, config.apiToken);
        const result = await client.testConnection();

        if (result.success) {
            notifications.showSuccess(`Connection successful!\n\nAPI URL: ${config.apiUrl}\nStatus: Connected`);
            statusBar.setStatus(RepoGateStatus.CONNECTED, 'Connected');
            logger.info('Connection test successful');
        } else {
            notifications.showError(`Connection failed!\n\n${result.message}\n\nPlease verify:\n1. RepoGate service is running\n2. API URL is correct\n3. API token is valid`);
            statusBar.setStatus(RepoGateStatus.ERROR, 'Connection failed');
            logger.error(`Connection test failed: ${result.message}`);
        }
    } catch (error) {
        notifications.showError(`Connection test failed: ${error}`);
        statusBar.setStatus(RepoGateStatus.ERROR, 'Connection failed');
        logger.error('Connection test error:', error);
    }
}

/**
 * Scan Now command implementation
 */
async function scanNow() {
    try {
        statusBar.setStatus(RepoGateStatus.PENDING, 'Scanning...');
        
        const config = await authManager.getConfig();
        if (!config) {
            notifications.showError('No API token configured');
            statusBar.setStatus(RepoGateStatus.ERROR, 'No API token');
            return;
        }

        // Reset bootstrap state to force re-scan
        bootstrap.resetBootstrap();
        
        const success = await bootstrap.bootstrapQueue(config);
        
        if (success) {
            statusBar.setStatus(RepoGateStatus.CONNECTED, 'Scan complete');
            logger.info('Manual scan completed successfully');
        } else {
            statusBar.setStatus(RepoGateStatus.ERROR, 'Scan failed');
            logger.error('Manual scan failed');
        }
    } catch (error) {
        notifications.showError(`Scan failed: ${error}`);
        statusBar.setStatus(RepoGateStatus.ERROR, 'Scan failed');
        logger.error('Scan error:', error);
    }
}

/**
 * Update status bar with diagnostic counts
 */
function updateStatusBarCounts() {
    setInterval(() => {
        const counts = diagnostics.getCounts();
        statusBar.setPendingCount(counts.pending + counts.scanning);
        statusBar.setDeniedCount(counts.denied);
    }, 2000);
}

export function deactivate() {
    logger.info('RepoGate extension deactivating...');
    
    npmWatcher?.dispose();
    mavenWatcher?.dispose();
    gradleWatcher?.dispose();
    statusBar.dispose();
    diagnostics.dispose();
    logger.dispose();
    
    logger.info('RepoGate extension deactivated');
}
