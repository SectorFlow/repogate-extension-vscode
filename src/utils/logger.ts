import * as vscode from 'vscode';

class Logger {
    private outputChannel: vscode.OutputChannel | undefined;

    initialize() {
        if (!this.outputChannel) {
            this.outputChannel = vscode.window.createOutputChannel('RepoGate');
        }
    }

    private log(level: string, message: string, ...args: any[]) {
        if (!this.outputChannel) {
            this.initialize();
        }

        const timestamp = new Date().toISOString();
        const formattedMessage = `[${timestamp}] [${level}] ${message}`;
        
        this.outputChannel?.appendLine(formattedMessage);
        
        if (args.length > 0) {
            this.outputChannel?.appendLine(JSON.stringify(args, this.sanitize, 2));
        }
    }

    /**
     * Sanitize sensitive data from logs
     */
    private sanitize(key: string, value: any): any {
        if (key.toLowerCase().includes('token') || 
            key.toLowerCase().includes('password') ||
            key.toLowerCase().includes('secret')) {
            return '***REDACTED***';
        }
        return value;
    }

    info(message: string, ...args: any[]) {
        this.log('INFO', message, ...args);
    }

    warn(message: string, ...args: any[]) {
        this.log('WARN', message, ...args);
    }

    error(message: string, ...args: any[]) {
        this.log('ERROR', message, ...args);
        console.error(message, ...args);
    }

    debug(message: string, ...args: any[]) {
        this.log('DEBUG', message, ...args);
    }

    show() {
        this.outputChannel?.show();
    }

    dispose() {
        this.outputChannel?.dispose();
    }
}

export const logger = new Logger();
