import * as vscode from 'vscode';

export interface RepoGateConfig {
    apiUrl: string;
    apiToken: string;
    pollIntervalMs: number;
    includeDevDependencies: boolean;
}

const TOKEN_KEY = 'repogate.apiToken';

export class AuthManager {
    constructor(private context: vscode.ExtensionContext) {}

    /**
     * Ensure authentication is configured, prompt if missing
     * Returns config if ready, undefined if not
     */
    async ensureAuthOrPrompt(): Promise<RepoGateConfig | undefined> {
        const config = vscode.workspace.getConfiguration('repogate');
        const apiUrl = config.get<string>('apiUrl') || 'https://api.repogate.io/api/v1';
        const pollIntervalMs = Math.max(config.get<number>('pollIntervalMs') || 10000, 3000);
        const includeDevDependencies = config.get<boolean>('includeDevDependencies') ?? true;

        // Get token from SecretStorage only
        const apiToken = await this.context.secrets.get(TOKEN_KEY);

        if (!apiToken || apiToken.trim() === '') {
            await this.promptForToken();
            return undefined;
        }

        return {
            apiUrl,
            apiToken,
            pollIntervalMs,
            includeDevDependencies
        };
    }

    /**
     * Prompt user to set API token
     */
    private async promptForToken(): Promise<void> {
        const result = await vscode.window.showInformationMessage(
            'RepoGate: API token is required to use this extension.',
            'Set Token',
            'Get Token Help'
        );

        if (result === 'Set Token') {
            vscode.commands.executeCommand('repogate.setToken');
        } else if (result === 'Get Token Help') {
            vscode.env.openExternal(vscode.Uri.parse('https://repogate.io/docs/getting-started'));
        }
    }

    /**
     * Get current token from SecretStorage
     */
    async getToken(): Promise<string | undefined> {
        return await this.context.secrets.get(TOKEN_KEY);
    }

    /**
     * Store token in SecretStorage
     */
    async setToken(token: string): Promise<void> {
        await this.context.secrets.store(TOKEN_KEY, token);
    }

    /**
     * Clear token from SecretStorage
     */
    async clearToken(): Promise<void> {
        await this.context.secrets.delete(TOKEN_KEY);
    }

    /**
     * Get current configuration
     */
    async getConfig(): Promise<RepoGateConfig | undefined> {
        const config = vscode.workspace.getConfiguration('repogate');
        const apiUrl = config.get<string>('apiUrl') || 'https://api.repogate.io/api/v1';
        const pollIntervalMs = Math.max(config.get<number>('pollIntervalMs') || 10000, 3000);
        const includeDevDependencies = config.get<boolean>('includeDevDependencies') ?? true;
        const apiToken = await this.getToken();

        if (!apiToken) {
            return undefined;
        }

        return {
            apiUrl,
            apiToken,
            pollIntervalMs,
            includeDevDependencies
        };
    }
}
