/**
 * Skill discovery system for finding and loading SKILL.md manifests.
 * Scans project directories and loads skill metadata from markdown files.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { SkillDefinition, SkillManifest, SkillId, SkillSource } from './types';
import { SkillStatus } from './types';

interface ParsedFrontMatter {
  metadata: Partial<SkillManifest>;
  content: string;
}

/**
 * Parses YAML frontmatter from markdown files.
 * Expects format: ---\nkey: value\n---\ncontent
 */
function parseFrontMatter(content: string): ParsedFrontMatter {
  const lines = content.split('\n');
  
  if (lines[0] !== '---') {
    throw new Error('SKILL.md must start with frontmatter delimiter ---');
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    throw new Error('SKILL.md frontmatter must be closed with ---');
  }

  const yamlLines = lines.slice(1, endIndex);
  const metadata: Partial<SkillManifest> = {};

  for (const line of yamlLines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.substring(0, colonIndex).trim();
    const value = line.substring(colonIndex + 1).trim();

    // Parse simple YAML values
    if (value.startsWith('[') && value.endsWith(']')) {
      try {
        metadata[key as keyof SkillManifest] = JSON.parse(value);
      } catch {
        metadata[key as keyof SkillManifest] = value as any;
      }
    } else if (value === 'true') {
      metadata[key as keyof SkillManifest] = true as any;
    } else if (value === 'false') {
      metadata[key as keyof SkillManifest] = false as any;
    } else if (!Number.isNaN(Number(value))) {
      metadata[key as keyof SkillManifest] = Number(value) as any;
    } else {
      metadata[key as keyof SkillManifest] = value as any;
    }
  }

  const mdContent = lines.slice(endIndex + 1).join('\n').trim();

  return { metadata, content: mdContent };
}

/**
 * Discovers and loads skills from SKILL.md files in a directory.
 */
export class SkillDiscovery {
  private discoveredSkills: Map<SkillId, SkillDefinition> = new Map();
  private discoveryPaths: string[] = [];

  /**
   * Discovers skills in a directory and its subdirectories.
   * @param rootDir - Root directory to search
   * @param source - Skill source type
   * @param recursive - Whether to search subdirectories
   * @returns Array of discovered skill definitions
   */
  discoverSkills(
    rootDir: string,
    source: SkillSource = 'project',
    recursive = true
  ): SkillDefinition[] {
    if (!this.discoveryPaths.includes(rootDir)) {
      this.discoveryPaths.push(rootDir);
    }

    const skills: SkillDefinition[] = [];

    if (!existsSync(rootDir)) {
      return skills;
    }

    const findSkills = (dir: string, depth = 0): void => {
      if (depth > 10) return; // Limit recursion depth

      try {
        const entries = readdirSync(dir);

        for (const entry of entries) {
          if (entry.startsWith('.')) continue;

          const entryPath = join(dir, entry);
          const stat = statSync(entryPath);

          if (stat.isDirectory() && recursive) {
            // Skip common non-skill directories
            if (['node_modules', 'dist', 'build', '.git', '.vscode'].includes(entry)) {
              continue;
            }
            findSkills(entryPath, depth + 1);
          } else if (entry === 'SKILL.md') {
            const skill = this.loadSkillFromFile(entryPath, source);
            if (skill) {
              skills.push(skill);
              this.discoveredSkills.set(skill.manifest.id, skill);
            }
          }
        }
      } catch (err) {
        // Silently skip unreadable directories
      }
    };

    findSkills(rootDir);
    return skills;
  }

  /**
   * Loads a single SKILL.md file.
   * @param filePath - Path to SKILL.md
   * @param source - Skill source type
   * @returns Skill definition or undefined if loading fails
   */
  private loadSkillFromFile(filePath: string, source: SkillSource): SkillDefinition | undefined {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const { metadata, content: mdContent } = parseFrontMatter(content);

      // Validate required fields
      if (!metadata.name || !metadata.version) {
        throw new Error('SKILL.md must define name and version in frontmatter');
      }

      const basePath = resolve(filePath, '..');
      const skillId = this.generateSkillId(metadata.name, source);

      // Count files in skill directory
      const fileCount = this.countFilesInDirectory(basePath);
      const totalBytes = this.calculateDirectorySize(basePath);

      const manifest: SkillManifest = {
        id: skillId,
        name: metadata.name,
        version: metadata.version,
        description: metadata.description || mdContent.split('\n')[0] || 'No description',
        author: metadata.author,
        license: metadata.license,
        homepage: metadata.homepage,
        repository: metadata.repository,
        documentation: metadata.documentation,
        parameters: metadata.parameters as any,
        capabilities: metadata.capabilities as any,
        environment: metadata.environment as any,
        dependencies: metadata.dependencies as any,
        tags: metadata.tags,
        experimental: metadata.experimental,
        disabled: metadata.disabled || false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const skillDef: SkillDefinition = {
        manifest,
        source,
        basePath,
        status: SkillStatus.Loaded,
        metadata: {
          fileCount,
          totalBytes,
          readmeFound: existsSync(join(basePath, 'README.md')),
          scriptFiles: this.findScriptFiles(basePath),
        },
      };

      return skillDef;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      return {
        manifest: {
          id: `skl_error_${Date.now()}` as SkillId,
          name: 'Unknown',
          version: '0.0.0',
          description: 'Failed to load skill',
        },
        source,
        basePath: resolve(filePath, '..'),
        status: SkillStatus.Failed,
        error: {
          code: 'LOAD_ERROR',
          message: error.message,
          stack: error.stack,
        },
        metadata: {
          fileCount: 0,
          totalBytes: 0,
          readmeFound: false,
        },
      };
    }
  }

  /**
   * Generates a unique skill ID from name and source.
   */
  private generateSkillId(name: string, source: SkillSource): SkillId {
    const normalized = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    const hash = Math.random().toString(36).substring(2, 8);
    return `skl_${source}_${normalized}_${hash}` as SkillId;
  }

  /**
   * Counts files in a directory recursively.
   */
  private countFilesInDirectory(dir: string): number {
    let count = 0;

    const count_recursive = (path: string): void => {
      try {
        const entries = readdirSync(path);
        for (const entry of entries) {
          if (entry.startsWith('.')) continue;
          const entryPath = join(path, entry);
          const stat = statSync(entryPath);

          if (stat.isFile()) {
            count++;
          } else if (stat.isDirectory() && !['node_modules', 'dist', '.git'].includes(entry)) {
            count_recursive(entryPath);
          }
        }
      } catch {
        // Silently fail
      }
    };

    count_recursive(dir);
    return count;
  }

  /**
   * Calculates total directory size in bytes.
   */
  private calculateDirectorySize(dir: string): number {
    let size = 0;

    const calc_recursive = (path: string): void => {
      try {
        const entries = readdirSync(path);
        for (const entry of entries) {
          if (entry.startsWith('.')) continue;
          const entryPath = join(path, entry);
          const stat = statSync(entryPath);

          if (stat.isFile()) {
            size += stat.size;
          } else if (stat.isDirectory() && !['node_modules', 'dist', '.git'].includes(entry)) {
            calc_recursive(entryPath);
          }
        }
      } catch {
        // Silently fail
      }
    };

    calc_recursive(dir);
    return size;
  }

  /**
   * Finds script files in a skill directory.
   */
  private findScriptFiles(dir: string): string[] {
    const scripts: string[] = [];

    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        if (['.ts', '.js', '.sh', '.py'].some((ext) => entry.endsWith(ext))) {
          scripts.push(entry);
        }
      }
    } catch {
      // Silently fail
    }

    return scripts;
  }

  /**
   * Gets all discovered skills.
   */
  getDiscoveredSkills(): SkillDefinition[] {
    return Array.from(this.discoveredSkills.values());
  }

  /**
   * Gets a specific skill by ID.
   */
  getSkill(skillId: SkillId): SkillDefinition | undefined {
    return this.discoveredSkills.get(skillId);
  }

  /**
   * Finds skills matching a predicate.
   */
  findSkills(predicate: (skill: SkillDefinition) => boolean): SkillDefinition[] {
    return Array.from(this.discoveredSkills.values()).filter(predicate);
  }

  /**
   * Gets discovery statistics.
   */
  getStats(): {
    total: number;
    loaded: number;
    failed: number;
    bySource: Record<SkillSource, number>;
  } {
    const stats = {
      total: this.discoveredSkills.size,
      loaded: 0,
      failed: 0,
      bySource: { library: 0, project: 0, remote: 0 },
    };

    for (const skill of this.discoveredSkills.values()) {
      if (skill.status === SkillStatus.Loaded) {
        stats.loaded++;
      } else if (skill.status === SkillStatus.Failed) {
        stats.failed++;
      }
      stats.bySource[skill.source]++;
    }

    return stats;
  }

  /**
   * Clears all discovered skills.
   */
  clear(): void {
    this.discoveredSkills.clear();
    this.discoveryPaths = [];
  }
}
