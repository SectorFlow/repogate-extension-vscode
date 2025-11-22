import * as vscode from 'vscode';
import { logger } from '../../utils/logger';

export interface DependencyDiagnostic {
    name: string;
    version?: string;
    status: 'approved' | 'denied' | 'pending' | 'scanning' | 'not_found';
    message: string;
    line: number;
    reasonUrl?: string;
}

export class DiagnosticsProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private fileDiagnostics: Map<string, DependencyDiagnostic[]> = new Map();

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('repogate');
    }

    /**
     * Add or update diagnostic for a dependency
     */
    addDiagnostic(uri: vscode.Uri, diagnostic: DependencyDiagnostic) {
        const filePath = uri.fsPath;
        
        if (!this.fileDiagnostics.has(filePath)) {
            this.fileDiagnostics.set(filePath, []);
        }

        const diagnostics = this.fileDiagnostics.get(filePath)!;
        
        // Remove existing diagnostic for this package
        const index = diagnostics.findIndex(d => d.name === diagnostic.name);
        if (index >= 0) {
            diagnostics.splice(index, 1);
        }

        // Add new diagnostic
        diagnostics.push(diagnostic);
        
        this.updateDiagnostics(uri);
    }

    /**
     * Remove diagnostic for a specific package
     */
    removeDiagnostic(uri: vscode.Uri, packageName: string) {
        const filePath = uri.fsPath;
        const diagnostics = this.fileDiagnostics.get(filePath);
        
        if (diagnostics) {
            const index = diagnostics.findIndex(d => d.name === packageName);
            if (index >= 0) {
                diagnostics.splice(index, 1);
                this.updateDiagnostics(uri);
            }
        }
    }

    /**
     * Clear all diagnostics for a file
     */
    clearFile(uri: vscode.Uri) {
        const filePath = uri.fsPath;
        this.fileDiagnostics.delete(filePath);
        this.diagnosticCollection.delete(uri);
    }

    /**
     * Clear all diagnostics
     */
    clearAll() {
        this.fileDiagnostics.clear();
        this.diagnosticCollection.clear();
    }

    /**
     * Get diagnostics count by status
     */
    getCounts(): { pending: number; denied: number; scanning: number } {
        let pending = 0;
        let denied = 0;
        let scanning = 0;

        for (const diagnostics of this.fileDiagnostics.values()) {
            for (const diag of diagnostics) {
                if (diag.status === 'pending') pending++;
                if (diag.status === 'denied') denied++;
                if (diag.status === 'scanning') scanning++;
            }
        }

        return { pending, denied, scanning };
    }

    /**
     * Update VS Code diagnostics for a file
     */
    private updateDiagnostics(uri: vscode.Uri) {
        const filePath = uri.fsPath;
        const diagnostics = this.fileDiagnostics.get(filePath) || [];

        const vsDiagnostics: vscode.Diagnostic[] = diagnostics.map(diag => {
            const range = new vscode.Range(
                new vscode.Position(Math.max(0, diag.line - 1), 0),
                new vscode.Position(Math.max(0, diag.line - 1), 1000)
            );

            let severity: vscode.DiagnosticSeverity;
            let message: string;

            switch (diag.status) {
                case 'denied':
                    severity = vscode.DiagnosticSeverity.Error;
                    message = `❌ ${diag.name}${diag.version ? `@${diag.version}` : ''}: ${diag.message}`;
                    break;
                case 'pending':
                    severity = vscode.DiagnosticSeverity.Warning;
                    message = `⏳ ${diag.name}${diag.version ? `@${diag.version}` : ''}: ${diag.message}`;
                    break;
                case 'scanning':
                    severity = vscode.DiagnosticSeverity.Information;
                    message = `🔍 ${diag.name}${diag.version ? `@${diag.version}` : ''}: ${diag.message}`;
                    break;
                case 'not_found':
                    severity = vscode.DiagnosticSeverity.Warning;
                    message = `❓ ${diag.name}${diag.version ? `@${diag.version}` : ''}: ${diag.message}`;
                    break;
                default:
                    severity = vscode.DiagnosticSeverity.Information;
                    message = `✓ ${diag.name}${diag.version ? `@${diag.version}` : ''}: ${diag.message}`;
            }

            const vsDiag = new vscode.Diagnostic(range, message, severity);
            vsDiag.source = 'RepoGate';
            
            if (diag.reasonUrl) {
                vsDiag.relatedInformation = [
                    new vscode.DiagnosticRelatedInformation(
                        new vscode.Location(uri, range),
                        `More info: ${diag.reasonUrl}`
                    )
                ];
            }

            return vsDiag;
        });

        this.diagnosticCollection.set(uri, vsDiagnostics);
        logger.debug(`Updated diagnostics for ${uri.fsPath}: ${vsDiagnostics.length} items`);
    }

    /**
     * Get all diagnostics across all files
     */
    getAll(): Map<vscode.Uri, Array<DependencyDiagnostic & { packageName: string }>> {
        const result = new Map<vscode.Uri, Array<DependencyDiagnostic & { packageName: string }>>();
        
        for (const [filePath, diagnostics] of this.fileDiagnostics) {
            const uri = vscode.Uri.file(filePath);
            const diagsWithPackageName = diagnostics.map(d => ({
                ...d,
                packageName: d.name
            }));
            result.set(uri, diagsWithPackageName);
        }
        
        return result;
    }

    dispose() {
        this.diagnosticCollection.dispose();
    }
}
