import { describe, it, expect, beforeEach } from 'vitest';
import { SkillValidator } from '../../../src/service/runtime/skills/validator';
import type { SkillDefinition, SkillExecutionInput } from '../../../src/service/runtime/skills/types';
import { SkillStatus } from '../../../src/service/runtime/skills/types';

describe('Skill Validator', () => {
  let validator: SkillValidator;

  const createMockSkill = (overrides: any = {}): SkillDefinition => ({
    manifest: {
      id: 'skl_test_mock_abc123' as any,
      name: 'Test Skill',
      version: '1.0.0',
      description: 'A test skill',
      parameters: [
        { name: 'input', type: 'string', required: true, description: 'Input text' },
        { name: 'count', type: 'number', required: false, minimum: 1, maximum: 100 },
      ],
      ...overrides.manifest,
    },
    source: 'project',
    basePath: '/test/skill',
    status: SkillStatus.Loaded,
    metadata: {
      fileCount: 3,
      totalBytes: 1024,
      readmeFound: true,
      ...overrides.metadata,
    },
    ...overrides,
  });

  beforeEach(() => {
    validator = new SkillValidator();
  });

  it('should validate correct input parameters', () => {
    const skill = createMockSkill();
    const input: SkillExecutionInput = {
      skillId: skill.manifest.id,
      skillName: skill.manifest.name,
      skillVersion: skill.manifest.version,
      parameters: { input: 'test', count: 5 },
    };

    const result = validator.validateInput(skill, input);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should detect missing required parameters', () => {
    const skill = createMockSkill();
    const input: SkillExecutionInput = {
      skillId: skill.manifest.id,
      skillName: skill.manifest.name,
      skillVersion: skill.manifest.version,
      parameters: { count: 5 },
    };

    const result = validator.validateInput(skill, input);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'input')).toBe(true);
  });

  it('should validate parameter types', () => {
    const skill = createMockSkill();
    const input: SkillExecutionInput = {
      skillId: skill.manifest.id,
      skillName: skill.manifest.name,
      skillVersion: skill.manifest.version,
      parameters: { input: 123 },
    };

    const result = validator.validateInput(skill, input);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'TYPE_MISMATCH')).toBe(true);
  });

  it('should validate manifest structure', () => {
    const skill = createMockSkill();
    const result = validator.validateManifest(skill);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should detect invalid version format', () => {
    const skill = createMockSkill({
      manifest: { ...createMockSkill().manifest, version: 'invalid' },
    });

    const result = validator.validateManifest(skill);

    expect(result.valid).toBe(false);
  });

  it('should perform pre-execution checks', () => {
    const skill = createMockSkill();
    const input: SkillExecutionInput = {
      skillId: skill.manifest.id,
      skillName: skill.manifest.name,
      skillVersion: skill.manifest.version,
      parameters: { input: 'test' },
    };

    const result = validator.preCheckExecution(skill, input);

    expect(result.valid).toBe(true);
  });
});
