import * as vscode from 'vscode';
import { DependencyInfo, ApprovalStatus } from '../models/DependencyInfo';

export class DiagnosticsManager {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private decorationType: vscode.TextEditorDecorationType;
    private approvedDecorationType: vscode.TextEditorDecorationType;
    private deniedDecorationType: vscode.TextEditorDecorationType;
    private pendingDecorationType: vscode.TextEditorDecorationType;

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('repogate');
        
        // Create decoration types for visual indicators
        this.approvedDecorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(0, 255, 0, 0.1)',
            border: '1px solid green',
            overviewRulerColor: 'green',
            overviewRulerLane: vscode.OverviewRulerLane.Left
        });

        this.deniedDecorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(255, 0, 0, 0.1)',
            border: '1px solid red',
            overviewRulerColor: 'red',
            overviewRulerLane: vscode.OverviewRulerLane.Left
        });

        this.pendingDecorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(255, 165, 0, 0.1)',
            border: '1px solid orange',
            overviewRulerColor: 'orange',
            overviewRulerLane: vscode.OverviewRulerLane.Left
        });

        this.decorationType = this.pendingDecorationType;
    }

    updateDiagnostics(uri: vscode.Uri, dependencies: Map<string, DependencyInfo>): void {
        const diagnostics: vscode.Diagnostic[] = [];
        const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());

        if (!document) {
            return;
        }

        const text = document.getText();
        const lines = text.split('\n');

        for (const [packageName, depInfo] of dependencies) {
            // Find the line containing this dependency
            const lineIndex = this.findDependencyLine(lines, packageName, document.fileName);
            
            if (lineIndex >= 0) {
                const line = lines[lineIndex];
                const range = new vscode.Range(lineIndex, 0, lineIndex, line.length);
                
                let severity: vscode.DiagnosticSeverity;
                let message: string;

                switch (depInfo.status) {
                    case ApprovalStatus.APPROVED:
                        severity = vscode.DiagnosticSeverity.Information;
                        message = `✓ RepoGate: Package '${packageName}' is APPROVED`;
                        break;
                    case ApprovalStatus.DENIED:
                        severity = vscode.DiagnosticSeverity.Error;
                        message = `✗ RepoGate: Package '${packageName}' is DENIED - Do not use in production`;
                        break;
                    case ApprovalStatus.PENDING:
                        severity = vscode.DiagnosticSeverity.Warning;
                        message = `⏳ RepoGate: Package '${packageName}' is pending approval`;
                        break;
                    default:
                        continue;
                }

                const diagnostic = new vscode.Diagnostic(range, message, severity);
                diagnostic.source = 'RepoGate';
                diagnostics.push(diagnostic);
            }
        }

        this.diagnosticCollection.set(uri, diagnostics);
        this.updateDecorations(document, dependencies);
    }

    private findDependencyLine(lines: string[], packageName: string, fileName: string): number {
        const baseName = fileName.split('/').pop() || '';
        
        if (baseName === 'package.json') {
            // Look for "packageName": in dependencies or devDependencies
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes(`"${packageName}":`)) {
                    return i;
                }
            }
        } else if (baseName === 'pom.xml') {
            // Look for <artifactId>packageName</artifactId>
            const parts = packageName.split(':');
            const artifactId = parts.length > 1 ? parts[1] : packageName;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes(`<artifactId>${artifactId}</artifactId>`)) {
                    return i;
                }
            }
        } else if (baseName.startsWith('build.gradle')) {
            // Look for implementation/api/etc with packageName
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes(packageName) && 
                    (lines[i].includes('implementation') || 
                     lines[i].includes('api') || 
                     lines[i].includes('compile'))) {
                    return i;
                }
            }
        }

        return -1;
    }

    private updateDecorations(document: vscode.TextDocument, dependencies: Map<string, DependencyInfo>): void {
        const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === document.uri.toString());
        
        if (!editor) {
            return;
        }

        const approvedRanges: vscode.DecorationOptions[] = [];
        const deniedRanges: vscode.DecorationOptions[] = [];
        const pendingRanges: vscode.DecorationOptions[] = [];

        const text = document.getText();
        const lines = text.split('\n');

        for (const [packageName, depInfo] of dependencies) {
            const lineIndex = this.findDependencyLine(lines, packageName, document.fileName);
            
            if (lineIndex >= 0) {
                const line = lines[lineIndex];
                const range = new vscode.Range(lineIndex, 0, lineIndex, line.length);
                const decoration: vscode.DecorationOptions = { range };

                switch (depInfo.status) {
                    case ApprovalStatus.APPROVED:
                        approvedRanges.push(decoration);
                        break;
                    case ApprovalStatus.DENIED:
                        deniedRanges.push(decoration);
                        break;
                    case ApprovalStatus.PENDING:
                        pendingRanges.push(decoration);
                        break;
                }
            }
        }

        editor.setDecorations(this.approvedDecorationType, approvedRanges);
        editor.setDecorations(this.deniedDecorationType, deniedRanges);
        editor.setDecorations(this.pendingDecorationType, pendingRanges);
    }

    clear(uri: vscode.Uri): void {
        this.diagnosticCollection.delete(uri);
    }

    dispose(): void {
        this.diagnosticCollection.dispose();
        this.approvedDecorationType.dispose();
        this.deniedDecorationType.dispose();
        this.pendingDecorationType.dispose();
    }
}
