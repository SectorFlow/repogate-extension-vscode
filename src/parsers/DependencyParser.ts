import { DependencyInfo, ApprovalStatus } from '../models/DependencyInfo';

export interface DependencyParser {
    supports(fileName: string): boolean;
    parseNewDependencies(content: string, previousContent: string): DependencyInfo[];
    parseAllDependencies(content: string): DependencyInfo[];
    getPackageManager(): string;
}

export abstract class BaseDependencyParser implements DependencyParser {
    abstract supports(fileName: string): boolean;
    abstract parseNewDependencies(content: string, previousContent: string): DependencyInfo[];
    abstract parseAllDependencies(content: string): DependencyInfo[];
    abstract getPackageManager(): string;

    protected createDependencyInfo(packageName: string, version: string = ''): DependencyInfo {
        return {
            packageName,
            packageManager: this.getPackageManager(),
            version,
            status: ApprovalStatus.PENDING
        };
    }
}
