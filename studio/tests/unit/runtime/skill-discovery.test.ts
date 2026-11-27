import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillDiscovery } from '../../../src/service/runtime/skills/discovery';
import { SkillStatus } from '../../../src/service/runtime/skills/types';

describe('Skill Discovery', () => {
  let tempDir: string;
  let discovery: SkillDiscovery;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'skill-discovery-'));
    discovery = new SkillDiscovery();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    discovery.clear();
  });

  const createSkillMd = (skillDir: string, name: string, version: string) => {
    require('fs').mkdirSync(skillDir, { recursive: true });
    const skillMd = `---
id: skl_project_${name}_abc123
name: ${name}
version: ${version}
description: A test skill for ${name}
---

# ${name}

Test skill description
`;
    writeFileSync(join(skillDir, 'SKILL.md'), skillMd);
  };

  it('should discover a single SKILL.md file', () => {
    const skillDir = join(tempDir, 'test-skill');
    createSkillMd(skillDir, 'TestSkill', '1.0.0');

    const skills = discovery.discoverSkills(tempDir, 'project');

    expect(skills.length).toBeGreaterThan(0);
    expect(skills[0].manifest.name).toBe('TestSkill');
    expect(skills[0].status).toBe(SkillStatus.Loaded);
  });

  it('should discover multiple skills in nested directories', () => {
    const skill1Dir = join(tempDir, 'skill-one');
    const skill2Dir = join(tempDir, 'nested', 'skill-two');

    createSkillMd(skill1Dir, 'SkillOne', '1.0.0');
    createSkillMd(skill2Dir, 'SkillTwo', '2.0.0');

    const skills = discovery.discoverSkills(tempDir, 'project', true);

    expect(skills.length).toBe(2);
  });

  it('should skip node_modules directories', () => {
    const skillDir = join(tempDir, 'valid-skill');
    const nodeModulesDir = join(tempDir, 'node_modules', 'invalid');

    createSkillMd(skillDir, 'Valid', '1.0.0');
    createSkillMd(nodeModulesDir, 'Invalid', '1.0.0');

    const skills = discovery.discoverSkills(tempDir, 'project', true);

    expect(skills).toHaveLength(1);
    expect(skills[0].manifest.name).toBe('Valid');
  });

  it('should track file count and size', () => {
    const skillDir = join(tempDir, 'file-skill');
    createSkillMd(skillDir, 'FileSkill', '1.0.0');
    writeFileSync(join(skillDir, 'script.ts'), 'console.log("test");');

    const skills = discovery.discoverSkills(tempDir, 'project');

    expect(skills.length).toBeGreaterThan(0);
    expect(skills[0].metadata.fileCount).toBeGreaterThan(0);
    expect(skills[0].metadata.totalBytes).toBeGreaterThan(0);
  });

  it('should provide discovery statistics', () => {
    const skillDir = join(tempDir, 'test-skill');
    createSkillMd(skillDir, 'StatSkill', '1.0.0');

    discovery.discoverSkills(tempDir, 'project');
    const stats = discovery.getStats();

    expect(stats.total).toBeGreaterThan(0);
    expect(stats.loaded).toBeGreaterThan(0);
  });
});
