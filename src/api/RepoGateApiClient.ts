import axios, { AxiosInstance } from 'axios';
import { DependencyResponse, DependencyInfo } from '../models/DependencyInfo';

export class RepoGateApiClient {
    private client: AxiosInstance;
    private apiToken: string;

    constructor(baseUrl: string, apiToken: string) {
        this.apiToken = apiToken;
        this.client = axios.create({
            baseURL: baseUrl,
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiToken}`
            }
        });
    }

    async requestDependency(packageName: string, packageManager: string, packageVersion?: string, projectName?: string): Promise<DependencyResponse> {
        try {
            const response = await this.client.post<DependencyResponse>('/dependencies/request', {
                packageName,
                packageManager,
                packageVersion: packageVersion || undefined,
                projectName: projectName || undefined
            });
            return response.data;
        } catch (error) {
            throw new Error(`Failed to request dependency validation: ${error}`);
        }
    }

    async checkDependency(packageName: string, packageManager: string): Promise<DependencyResponse> {
        try {
            const response = await this.client.post<DependencyResponse>('/dependencies/check', {
                packageName,
                packageManager
            });
            return response.data;
        } catch (error) {
            throw new Error(`Failed to check dependency status: ${error}`);
        }
    }

    async reportInventory(dependencies: DependencyInfo[], developerInfo: any): Promise<void> {
        try {
            await this.client.post('/dependencies/inventory', {
                dependencies: dependencies.map(dep => ({
                    packageName: dep.packageName,
                    packageManager: dep.packageManager,
                    version: dep.version,
                    status: dep.status
                })),
                developer: developerInfo,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Failed to report inventory:', error);
            // Don't throw - inventory reporting is optional
        }
    }

    async queuePackages(packages: Array<{packageName: string, packageVersion?: string, packageManager: string, projectName?: string}>): Promise<void> {
        try {
            await this.client.post('/queue', {
                packages: packages.map(pkg => ({
                    packageName: pkg.packageName,
                    packageVersion: pkg.packageVersion || undefined,
                    packageManager: pkg.packageManager,
                    projectName: pkg.projectName || undefined
                }))
            });
        } catch (error) {
            console.error('Failed to queue packages:', error);
            // Don't throw - queue is optional
        }
    }

    async updateDependency(data: {
        packageName: string,
        packageManager: string,
        action: string,
        status: string,
        projectName?: string,
        timestamp: string,
        developer?: {
            username: string,
            hostname: string,
            os: string
        }
    }): Promise<void> {
        try {
            await this.client.post('/dependencies/update', data);
            console.log(`RepoGate: Notified platform of ${data.action} action for ${data.packageName}`);
        } catch (error) {
            console.error('Failed to update dependency status:', error);
            // Don't throw - this is a notification, not critical
        }
    }
}
