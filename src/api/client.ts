import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../utils/logger';

export interface QueueRequest {
    projectName: string;
    ecosystem: string;
    packages: Array<{
        name: string;
        version?: string;
        path: string;
    }>;
    timestamp: string;
    repository?: boolean;
}

export interface RequestPayload {
    projectName: string;
    ecosystem: string;
    name: string;
    version?: string;
    path: string;
    repository?: boolean;
}

export interface CheckPayload {
    projectName: string;
    ecosystem: string;
    name: string;
    version?: string;
    repository?: boolean;
}

export interface CheckResponse {
    status: 'approved' | 'denied' | 'pending' | 'scanning' | 'not_found';
    approved: boolean;
    message: string;
    packageName: string;
    packageManager: string;
    reasonUrl?: string;
}

export interface UpdatePayload {
    projectName: string;
    ecosystem: string;
    name: string;
    fromVersion?: string;
    toVersion?: string;
    action: string;
    timestamp: string;
    repository?: boolean;
}

export class RepoGateApiClient {
    private client: AxiosInstance;
    private maxRetries = 3;
    private baseDelay = 1000; // 1 second

    constructor(baseURL: string, token: string) {
        this.client = axios.create({
            baseURL,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });
    }

    /**
     * POST /queue - Submit initial inventory
     */
    async queue(payload: QueueRequest): Promise<void> {
        await this.retryRequest(async () => {
            logger.info(`Queuing ${payload.packages.length} packages for ${payload.ecosystem}`);
            await this.client.post('/queue', payload);
            logger.info(`Successfully queued packages`);
        });
    }

    /**
     * POST /dependencies/request - Request approval for new dependency
     */
    async request(payload: RequestPayload): Promise<CheckResponse> {
        return await this.retryRequest(async () => {
            logger.info(`Requesting approval for ${payload.name}@${payload.version || 'latest'}`);
            const response = await this.client.post('/dependencies/request', payload);
            return response.data;
        });
    }

    /**
     * POST /dependencies/check - Check approval status
     */
    async check(payload: CheckPayload): Promise<CheckResponse> {
        return await this.retryRequest(async () => {
            const response = await this.client.post('/dependencies/check', {
                packageName: payload.name,
                packageManager: payload.ecosystem,
                packageVersion: payload.version
            });
            return response.data;
        });
    }

    /**
     * POST /dependencies/update - Notify of dependency changes
     */
    async update(payload: UpdatePayload): Promise<void> {
        await this.retryRequest(async () => {
            logger.info(`Updating dependency status: ${payload.name} (${payload.action})`);
            await this.client.post('/dependencies/update', payload);
        });
    }

    /**
     * Test connection to API
     */
    async testConnection(): Promise<{ success: boolean; message: string }> {
        try {
            await this.client.post('/dependencies/check', {
                packageName: 'test-package',
                packageManager: 'npm'
            });
            return {
                success: true,
                message: 'Connection successful'
            };
        } catch (error) {
            const axiosError = error as AxiosError;
            if (axiosError.response?.status === 401) {
                return {
                    success: false,
                    message: 'Authentication failed: Invalid API token'
                };
            } else if (axiosError.code === 'ECONNREFUSED') {
                return {
                    success: false,
                    message: 'Cannot connect to server: Connection refused'
                };
            } else {
                return {
                    success: false,
                    message: `Connection failed: ${axiosError.message}`
                };
            }
        }
    }

    /**
     * Retry logic with exponential backoff
     */
    private async retryRequest<T>(
        fn: () => Promise<T>,
        attempt: number = 0
    ): Promise<T> {
        try {
            return await fn();
        } catch (error) {
            const axiosError = error as AxiosError;
            
            // Don't retry on 4xx errors (client errors)
            if (axiosError.response && axiosError.response.status >= 400 && axiosError.response.status < 500) {
                logger.error(`Client error (${axiosError.response.status}): ${axiosError.message}`);
                throw error;
            }

            // Retry on 5xx errors or network errors
            if (attempt < this.maxRetries) {
                const delay = this.baseDelay * Math.pow(2, attempt) + Math.random() * 1000; // Add jitter
                logger.warn(`Request failed, retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${this.maxRetries})`);
                await this.sleep(delay);
                return this.retryRequest(fn, attempt + 1);
            }

            logger.error(`Request failed after ${this.maxRetries} retries: ${axiosError.message}`);
            throw error;
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
