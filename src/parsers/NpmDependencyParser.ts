import { BaseDependencyParser } from './DependencyParser';
import { DependencyInfo } from '../models/DependencyInfo';

export class NpmDependencyParser extends BaseDependencyParser {
    supports(fileName: string): boolean {
        return fileName === 'package.json';
    }

    parseNewDependencies(content: string, previousContent: string): DependencyInfo[] {
        const newDeps: DependencyInfo[] = [];

        try {
            const previousDeps = this.extractDependencies(previousContent);
            const currentDeps = this.extractDependencies(content);
            const currentJson = JSON.parse(content);

            const allDeps = {
                ...currentJson.dependencies,
                ...currentJson.devDependencies
            };

            for (const dep of currentDeps) {
                if (!previousDeps.has(dep)) {
                    const version = allDeps[dep] || '';
                    newDeps.push(this.createDependencyInfo(dep, version));
                }
            }
        } catch (error) {
            console.error('Error parsing npm dependencies:', error);
        }

        return newDeps;
    }

    private extractDependencies(content: string): Set<string> {
        const deps = new Set<string>();

        if (!content || content.trim() === '') {
            return deps;
        }

        try {
            const json = JSON.parse(content);

            if (json.dependencies) {
                Object.keys(json.dependencies).forEach(dep => deps.add(dep));
            }

            if (json.devDependencies) {
                Object.keys(json.devDependencies).forEach(dep => deps.add(dep));
            }
        } catch (error) {
            // Ignore parsing errors
        }

        return deps;
    }

    parseAllDependencies(content: string): DependencyInfo[] {
        const allDeps: DependencyInfo[] = [];

        try {
            const json = JSON.parse(content);
            const dependencies = {
                ...json.dependencies,
                ...json.devDependencies
            };

            for (const [packageName, version] of Object.entries(dependencies)) {
                allDeps.push(this.createDependencyInfo(packageName, version as string));
            }
        } catch (error) {
            console.error('Error parsing all npm dependencies:', error);
        }

        return allDeps;
    }

    getPackageManager(): string {
        return 'npm';
    }
}
