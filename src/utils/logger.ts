import * as vscode from 'vscode';

enum LogLevel {
    ERROR = 0,
    WARN = 1,
    INFO = 2,
    DEBUG = 3
}

class Logger {
    private outputChannel: vscode.OutputChannel | undefined;
    private logLevel: LogLevel = LogLevel.ERROR; // Default to ERROR only

    initialize() {
        if (!this.outputChannel) {
            this.outputChannel = vscode.window.createOutputChannel('RepoGate');
        }
        
        // Read log level from configuration
        const config = vscode.workspace.getConfiguration('repogate');
        const configLevel = config.get<string>('logLevel', 'error');
        this.setLogLevel(configLevel);
    }

    setLogLevel(level: string) {
        switch (level.toLowerCase()) {
            case 'debug':
                this.logLevel = LogLevel.DEBUG;
                break;
            case 'info':
                this.logLevel = LogLevel.INFO;
                break;
            case 'warn':
                this.logLevel = LogLevel.WARN;
                break;
            case 'error':
            default:
                this.logLevel = LogLevel.ERROR;
                break;
        }
    }

    private log(level: string, levelValue: LogLevel, message: string, ...args: any[]) {
        // Skip if log level is below current threshold
        if (levelValue > this.logLevel) {
            return;
        }

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
        this.log('INFO', LogLevel.INFO, message, ...args);
    }

    warn(message: string, ...args: any[]) {
        this.log('WARN', LogLevel.WARN, message, ...args);
    }

    error(message: string, ...args: any[]) {
        this.log('ERROR', LogLevel.ERROR, message, ...args);
        console.error(message, ...args);
    }

    debug(message: string, ...args: any[]) {
        this.log('DEBUG', LogLevel.DEBUG, message, ...args);
    }

    show() {
        this.outputChannel?.show();
    }

    dispose() {
        this.outputChannel?.dispose();
    }
}

export const logger = new Logger();
