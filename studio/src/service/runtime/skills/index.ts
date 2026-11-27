/**
 * Skill system manager and integration layer.
 * Central hub for skill discovery, loading, caching, and execution.
 */

import type {
  SkillDefinition,
  SkillId,
  SkillIndex,
  SkillExecutionInput,
  SkillExecutionContext,
  SkillExecutionResult,
  SkillSource,
} from './types.js';
import { SkillStatus } from './types.js';
import { SkillDiscovery } from './discovery.js';
import { SkillValidator } from './validator.js';
import { SkillExecutor } from './executor.js';

export interface SkillSystemConfig {
  discoveryPaths?: string[];
  enableCaching?: boolean;
  autoDiscover?: boolean;
  sandboxLevel?: string;
}

/**
 * Main skill system manager.
 * Orchestrates skill lifecycle: discovery → loading → validation → execution.
 */
export class SkillManager {
  private static instance: SkillManager;

  private discovery = new SkillDiscovery();
  private validator = new SkillValidator();
  private executor = new SkillExecutor();

  private skills: Map<SkillId, SkillDefinition> = new Map();
  private cache: Map<string, SkillIndex> = new Map();
  private config: SkillSystemConfig;

  private constructor(config: SkillSystemConfig = {}) {
    this.config = {
      enableCaching: true,
      autoDiscover: true,
      ...config,
    };
  }

  /**
   * Gets or creates the skill manager singleton.
   */
  static getInstance(config?: SkillSystemConfig): SkillManager {
    if (!SkillManager.instance) {
      SkillManager.instance = new SkillManager(config);
    }
    return SkillManager.instance;
  }

  /**
   * Discovers skills in discovery paths.
   */
  discoverSkills(paths: string[]): SkillDefinition[] {
    const discoveredSkills: SkillDefinition[] = [];

    for (const path of paths) {
      const skills = this.discovery.discoverSkills(path, 'project', true);
      discoveredSkills.push(...skills);

      for (const skill of skills) {
        this.skills.set(skill.manifest.id, skill);
      }
    }

    return discoveredSkills;
  }

  /**
   * Discovers skills from a specific directory.
   */
  discoverInDirectory(dir: string, source: SkillSource = 'project'): SkillDefinition[] {
    const skills = this.discovery.discoverSkills(dir, source, true);

    for (const skill of skills) {
      this.skills.set(skill.manifest.id, skill);
    }

    return skills;
  }

  /**
   * Gets a skill by ID.
   */
  getSkill(skillId: SkillId): SkillDefinition | undefined {
    return this.skills.get(skillId);
  }

  /**
   * Gets a skill by name.
   */
  getSkillByName(name: string): SkillDefinition | undefined {
    for (const skill of this.skills.values()) {
      if (skill.manifest.name === name) {
        return skill;
      }
    }
    return undefined;
  }

  /**
   * Lists all loaded skills.
   */
  listSkills(filter?: (skill: SkillDefinition) => boolean): SkillDefinition[] {
    const skills = Array.from(this.skills.values());
    if (filter) {
      return skills.filter(filter);
    }
    return skills;
  }

  /**
   * Finds skills matching a predicate.
   */
  findSkills(predicate: (skill: SkillDefinition) => boolean): SkillDefinition[] {
    return this.listSkills(predicate);
  }

  /**
   * Lists enabled skills only.
   */
  getEnabledSkills(): SkillDefinition[] {
    return this.listSkills((skill) => !skill.manifest.disabled && skill.status === SkillStatus.Loaded);
  }

  /**
   * Lists failed skills.
   */
  getFailedSkills(): SkillDefinition[] {
    return this.listSkills((skill) => skill.status === SkillStatus.Failed);
  }

  /**
   * Validates a skill manifest.
   */
  validateSkill(skill: SkillDefinition): { valid: boolean; errors: string[] } {
    return this.validator.validateManifest(skill);
  }

  /**
   * Validates skill input before execution.
   */
  validateInput(skill: SkillDefinition, input: SkillExecutionInput): { valid: boolean; errors: any[] } {
    const result = this.validator.validateInput(skill, input);
    return {
      valid: result.valid,
      errors: result.errors,
    };
  }

  /**
   * Executes a skill.
   */
  async executeSkill(
    skillId: SkillId,
    input: SkillExecutionInput,
    context: SkillExecutionContext
  ): Promise<SkillExecutionResult> {
    const skill = this.getSkill(skillId);
    if (!skill) {
      return {
        skillId,
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Skill not found: ${skillId}`,
        },
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    }

    // Validate before execution
    const validation = this.validator.preCheckExecution(skill, input);
    if (!validation.valid) {
      return {
        skillId,
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: validation.errors[0]?.message || 'Validation failed',
        },
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    }

    // Execute
    return this.executor.execute(skill, input, context);
  }

  /**
   * Executes a skill by name.
   */
  async executeSkillByName(
    name: string,
    input: SkillExecutionInput,
    context: SkillExecutionContext
  ): Promise<SkillExecutionResult> {
    const skill = this.getSkillByName(name);
    if (!skill) {
      return {
        skillId: `skl_error_${Date.now()}` as SkillId,
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Skill not found: ${name}`,
        },
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    }

    return this.executeSkill(skill.manifest.id, input, context);
  }

  /**
   * Executes multiple skills in sequence.
   */
  async executeSequence(
    skillIds: SkillId[],
    input: SkillExecutionInput,
    context: SkillExecutionContext
  ): Promise<SkillExecutionResult[]> {
    const skills = skillIds
      .map((id) => this.getSkill(id))
      .filter((skill) => !!skill) as SkillDefinition[];

    return this.executor.executeSequence(skills, input, context);
  }

  /**
   * Executes multiple skills in parallel.
   */
  async executeParallel(
    skillIds: SkillId[],
    input: SkillExecutionInput,
    context: SkillExecutionContext
  ): Promise<SkillExecutionResult[]> {
    const skills = skillIds
      .map((id) => this.getSkill(id))
      .filter((skill) => !!skill) as SkillDefinition[];

    return this.executor.executeParallel(skills, input, context);
  }

  /**
   * Executes a skill with retry logic.
   */
  async executeWithRetry(
    skillId: SkillId,
    input: SkillExecutionInput,
    context: SkillExecutionContext,
    maxAttempts = 3
  ): Promise<SkillExecutionResult> {
    const skill = this.getSkill(skillId);
    if (!skill) {
      return {
        skillId,
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Skill not found: ${skillId}`,
        },
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    }

    return this.executor.executeWithRetry(skill, input, context, maxAttempts);
  }

  /**
   * Reloads a specific skill.
   */
  reloadSkill(skillId: SkillId): SkillDefinition | undefined {
    const skill = this.getSkill(skillId);
    if (!skill) {
      return undefined;
    }

    // Trigger re-discovery
    const rediscovered = this.discovery.findSkills((s) => s.manifest.id === skillId);
    if (rediscovered.length > 0) {
      this.skills.set(skillId, rediscovered[0]);
      return rediscovered[0];
    }

    return skill;
  }

  /**
   * Creates a skill index snapshot.
   */
  createIndex(label?: string): SkillIndex {
    const skills = this.listSkills();
    const index: SkillIndex = {
      seq: Date.now(),
      timestamp: new Date().toISOString(),
      skills,
      discoveryPaths: this.config.discoveryPaths || [],
      stats: {
        total: skills.length,
        loaded: skills.filter((s) => s.status === SkillStatus.Loaded).length,
        failed: skills.filter((s) => s.status === SkillStatus.Failed).length,
        disabled: skills.filter((s) => s.manifest.disabled).length,
      },
    };

    if (this.config.enableCaching && label) {
      this.cache.set(label, index);
    }

    return index;
  }

  /**
   * Gets execution statistics.
   */
  getExecutionStats(): {
    total: number;
    succeeded: number;
    failed: number;
    averageDuration: number;
  } {
    return this.executor.getExecutionStats();
  }

  /**
   * Gets skill system statistics.
   */
  getStats(): {
    totalSkills: number;
    loadedSkills: number;
    failedSkills: number;
    disabledSkills: number;
    executions: { total: number; succeeded: number; failed: number; averageDuration: number };
  } {
    const skills = this.listSkills();
    const execStats = this.getExecutionStats();

    return {
      totalSkills: skills.length,
      loadedSkills: skills.filter((s) => s.status === SkillStatus.Loaded).length,
      failedSkills: skills.filter((s) => s.status === SkillStatus.Failed).length,
      disabledSkills: skills.filter((s) => s.manifest.disabled).length,
      executions: execStats,
    };
  }

  /**
   * Clears all cached data.
   */
  clearCache(): void {
    this.cache.clear();
    this.executor.clearExecutionLog();
  }

  /**
   * Resets the skill manager.
   */
  reset(): void {
    this.skills.clear();
    this.cache.clear();
    this.discovery.clear();
    this.executor.clearExecutionLog();
  }
}

export { SkillDiscovery, SkillValidator, SkillExecutor };
export type { SkillDefinition, SkillExecutionInput, SkillExecutionContext, SkillExecutionResult };
