export enum ApprovalStatus {
    PENDING = 'pending',
    APPROVED = 'approved',
    DENIED = 'denied',
    SCANNING = 'scanning',
    NOT_FOUND = 'not_found',
    ERROR = 'error'
}

export interface DependencyInfo {
    packageName: string;
    packageManager: string;
    version?: string;
    status: ApprovalStatus;
}

export interface DependencyResponse {
    status: 'approved' | 'denied' | 'pending' | 'scanning' | 'not_found';
    approved: boolean;
    message: string;
    packageName: string;
    packageManager: string;
}
