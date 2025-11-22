import * as vscode from 'vscode';
import { logger } from '../../utils/logger';

export enum RepoGateStatus {
    CONNECTED = 'connected',
    PENDING = 'pending',
    ERROR = 'error',
    DISABLED = 'disabled'
}

export class StatusBarManager {
    private statusBarItem: vscode.StatusBarItem;
    private currentStatus: RepoGateStatus = RepoGateStatus.DISABLED;
    private pendingCount: number = 0;
    private deniedCount: number = 0;
    private userEmail?: string;
    private authMode?: string;

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.statusBarItem.command = 'repogate.showOutput';
        this.updateDisplay();
        this.statusBarItem.show();
    }

    setStatus(status: RepoGateStatus, message?: string) {
        this.currentStatus = status;
        this.updateDisplay();
        
        if (message) {
            logger.info(`Status changed to ${status}: ${message}`);
        }
    }

    setPendingCount(count: number) {
        this.pendingCount = count;
        this.updateDisplay();
    }

    setDeniedCount(count: number) {
        this.deniedCount = count;
        this.updateDisplay();
    }

    setUserInfo(email: string, authMode: string) {
        this.userEmail = email;
        this.authMode = authMode;
        this.updateDisplay();
    }

    private updateDisplay() {
        let icon: string;
        let text: string;
        let tooltip: string;

        switch (this.currentStatus) {
            case RepoGateStatus.CONNECTED:
                icon = '$(check)';
                text = 'RepoGate';
                tooltip = 'RepoGate: Connected';
                break;
            case RepoGateStatus.PENDING:
                icon = '$(sync~spin)';
                text = 'RepoGate';
                tooltip = 'RepoGate: Checking dependencies...';
                break;
            case RepoGateStatus.ERROR:
                icon = '$(error)';
                text = 'RepoGate';
                tooltip = 'RepoGate: Connection error';
                break;
            case RepoGateStatus.DISABLED:
            default:
                icon = '$(circle-slash)';
                text = 'RepoGate';
                tooltip = 'RepoGate: Disabled (no API token)';
                break;
        }

        // Add counts if any
        const counts: string[] = [];
        if (this.pendingCount > 0) {
            counts.push(`${this.pendingCount} pending`);
        }
        if (this.deniedCount > 0) {
            counts.push(`${this.deniedCount} denied`);
        }

        if (counts.length > 0) {
            text += ` (${counts.join(', ')})`;
            tooltip += `\n${counts.join(', ')}`;
        }

        this.statusBarItem.text = `${icon} ${text}`;
        this.statusBarItem.tooltip = tooltip;
    }

    dispose() {
        this.statusBarItem.dispose();
    }
}
