import { BaseDependencyParser } from './DependencyParser';
import { DependencyInfo } from '../models/DependencyInfo';

export class MavenDependencyParser extends BaseDependencyParser {
    private readonly DEPENDENCY_PATTERN = /<dependency>\s*<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>\s*(?:<version>([^<]+)<\/version>)?/gs;

    supports(fileName: string): boolean {
        return fileName === 'pom.xml';
    }

    parseNewDependencies(content: string, previousContent: string): DependencyInfo[] {
        const newDeps: DependencyInfo[] = [];

        try {
            const previousDeps = this.extractDependencies(previousContent);
            const currentDeps = this.extractDependencies(content);

            const matches = content.matchAll(this.DEPENDENCY_PATTERN);
            for (const match of matches) {
                const groupId = match[1].trim();
                const artifactId = match[2].trim();
                const version = match[3] ? match[3].trim() : '';
                const fullName = `${groupId}:${artifactId}`;

                if (!previousDeps.has(fullName) && currentDeps.has(fullName)) {
                    newDeps.push(this.createDependencyInfo(fullName, version));
                }
            }
        } catch (error) {
            console.error('Error parsing Maven dependencies:', error);
        }

        return newDeps;
    }

    private extractDependencies(content: string): Set<string> {
        const deps = new Set<string>();

        if (!content || content.trim() === '') {
            return deps;
        }

        try {
            const matches = content.matchAll(this.DEPENDENCY_PATTERN);
            for (const match of matches) {
                const groupId = match[1].trim();
                const artifactId = match[2].trim();
                deps.add(`${groupId}:${artifactId}`);
            }
        } catch (error) {
            // Ignore parsing errors
        }

        return deps;
    }

    parseAllDependencies(content: string): DependencyInfo[] {
        const allDeps: DependencyInfo[] = [];

        try {
            const matches = content.matchAll(this.DEPENDENCY_PATTERN);
            for (const match of matches) {
                const groupId = match[1].trim();
                const artifactId = match[2].trim();
                const version = match[3] ? match[3].trim() : '';
                const fullName = `${groupId}:${artifactId}`;
                allDeps.push(this.createDependencyInfo(fullName, version));
            }
        } catch (error) {
            console.error('Error parsing all Maven dependencies:', error);
        }

        return allDeps;
    }

    getPackageManager(): string {
        return 'maven';
    }
}
