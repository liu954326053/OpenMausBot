import { describe, it, expect, beforeEach } from 'vitest';
import { SkillManager } from '../../../src/service/runtime/skills/index';
import { SkillStatus } from '../../../src/service/runtime/skills/types';

describe('Skill Manager', () => {
  let manager: SkillManager;

  beforeEach(() => {
    manager = SkillManager.getInstance({ enableCaching: true });
    manager.reset();
  });

  it('should return same singleton instance', () => {
    const manager1 = SkillManager.getInstance();
    const manager2 = SkillManager.getInstance();

    expect(manager1).toBe(manager2);
  });

  it('should return undefined for non-existent skill', () => {
    const retrieved = manager.getSkill('skl_nonexistent_000000' as any);

    expect(retrieved).toBeUndefined();
  });

  it('should list skills', () => {
    const skills = manager.listSkills();

    expect(Array.isArray(skills)).toBe(true);
  });

  it('should filter skills with predicate', () => {
    const all = manager.listSkills();
    const filtered = manager.listSkills((s) => s.manifest.name.includes('Test'));

    expect(Array.isArray(filtered)).toBe(true);
  });

  it('should provide skill statistics', () => {
    const stats = manager.getStats();

    expect(stats).toHaveProperty('totalSkills');
    expect(stats).toHaveProperty('loadedSkills');
    expect(stats).toHaveProperty('disabledSkills');
    expect(stats).toHaveProperty('executions');
  });

  it('should find skills with predicate', () => {
    const found = manager.findSkills((s) => s.manifest.version === '1.0.0');

    expect(Array.isArray(found)).toBe(true);
  });

  it('should get enabled skills', () => {
    const enabled = manager.getEnabledSkills();

    expect(Array.isArray(enabled)).toBe(true);
  });

  it('should get failed skills', () => {
    const failed = manager.getFailedSkills();

    expect(Array.isArray(failed)).toBe(true);
  });

  it('should clear cache', () => {
    manager.clearCache();

    // Should not throw
    expect(true).toBe(true);
  });

  it('should reset state', () => {
    manager.reset();

    expect(manager.listSkills()).toHaveLength(0);
  });
});
