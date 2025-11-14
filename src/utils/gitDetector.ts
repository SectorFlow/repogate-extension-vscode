import * as vscode from 'vscode';
import { logger } from './logger';

export class GitDetector {
    /**
     * Check if the workspace is linked to a Git repository
     * Returns true if a Git repository is detected, false otherwise
     */
    static async hasRepository(): Promise<boolean> {
        try {
            const gitExtension = vscode.extensions.getExtension('vscode.git');
            if (!gitExtension) {
                logger.debug('Git extension not found');
                return false;
            }

            if (!gitExtension.isActive) {
                await gitExtension.activate();
            }

            const git = gitExtension.exports.getAPI(1);
            if (!git || git.repositories.length === 0) {
                logger.debug('No Git repositories found');
                return false;
            }

            logger.debug('Git repository detected');
            return true;
        } catch (error) {
            logger.error('Failed to detect Git repository:', error);
            return false;
        }
    }
}
