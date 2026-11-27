/**
 * Skill validation system for schema enforcement and lifecycle checks.
 * Validates parameters, capabilities, and pre-execution constraints.
 */

import type {
  SkillDefinition,
  SkillParameter,
  SkillExecutionInput,
  SkillPreCheckResult,
  SkillValidationError,
} from './types';

/**
 * Validates skill parameters against schema.
 */
export class SkillValidator {
  /**
   * Validates execution input parameters against skill manifest.
   * @param skill - Skill definition
   * @param input - Execution input
   * @returns Validation result with errors and warnings
   */
  validateInput(skill: SkillDefinition, input: SkillExecutionInput): SkillPreCheckResult {
    const errors: SkillValidationError[] = [];
    const warnings: Array<{ message: string; field?: string }> = [];

    // Check skill is not disabled
    if (skill.manifest.disabled) {
      errors.push({
        field: 'skill',
        message: 'Skill is disabled',
        code: 'CAPABILITY_MISSING',
      });
    }

    // Validate required parameters
    if (skill.manifest.parameters) {
      const providedKeys = Object.keys(input.parameters || {});

      for (const param of skill.manifest.parameters) {
        if (param.required && !providedKeys.includes(param.name)) {
          errors.push({
            field: param.name,
            message: `Required parameter missing: ${param.name}`,
            code: 'REQUIRED',
          });
        }

        // Validate provided parameters
        if (input.parameters && param.name in input.parameters) {
          const value = input.parameters[param.name];
          const validateResult = this.validateParameter(param, value);

          if (!validateResult.valid) {
            errors.push(...validateResult.errors);
          }

          if (validateResult.warnings) {
            warnings.push(...validateResult.warnings);
          }
        }
      }
    }

    // Check dependencies
    const depErrors = this.validateDependencies(skill);
    errors.push(...depErrors);

    return {
      valid: errors.length === 0,
      errors,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Validates a single parameter value against its schema.
   */
  private validateParameter(
    param: SkillParameter,
    value: unknown
  ): {
    valid: boolean;
    errors: SkillValidationError[];
    warnings?: Array<{ message: string }>;
  } {
    const errors: SkillValidationError[] = [];
    const warnings: Array<{ message: string }> = [];

    // Check type
    const valueType = typeof value;
    if (param.type && !this.typeMatches(param.type, value)) {
      errors.push({
        field: param.name,
        message: `Type mismatch: expected ${param.type}, got ${valueType}`,
        code: 'TYPE_MISMATCH',
      });
    }

    // Check string constraints
    if (param.type === 'string' && typeof value === 'string') {
      if (param.minLength !== undefined && value.length < param.minLength) {
        errors.push({
          field: param.name,
          message: `String too short: minimum length is ${param.minLength}`,
          code: 'INVALID_VALUE',
        });
      }

      if (param.maxLength !== undefined && value.length > param.maxLength) {
        errors.push({
          field: param.name,
          message: `String too long: maximum length is ${param.maxLength}`,
          code: 'INVALID_VALUE',
        });
      }

      if (param.pattern && !new RegExp(param.pattern).test(value)) {
        errors.push({
          field: param.name,
          message: `String does not match pattern: ${param.pattern}`,
          code: 'INVALID_VALUE',
        });
      }
    }

    // Check number constraints
    if (param.type === 'number' && typeof value === 'number') {
      if (param.minimum !== undefined && value < param.minimum) {
        errors.push({
          field: param.name,
          message: `Number too small: minimum is ${param.minimum}`,
          code: 'INVALID_VALUE',
        });
      }

      if (param.maximum !== undefined && value > param.maximum) {
        errors.push({
          field: param.name,
          message: `Number too large: maximum is ${param.maximum}`,
          code: 'INVALID_VALUE',
        });
      }
    }

    // Check enum values
    if (param.enum && !param.enum.includes(value)) {
      errors.push({
        field: param.name,
        message: `Invalid value: must be one of [${param.enum.join(', ')}]`,
        code: 'INVALID_VALUE',
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Checks if a value type matches the parameter type.
   */
  private typeMatches(paramType: string, value: unknown): boolean {
    const valueType = typeof value;

    switch (paramType) {
      case 'string':
        return valueType === 'string';
      case 'number':
        return valueType === 'number' && !Number.isNaN(value);
      case 'integer':
        return valueType === 'number' && Number.isInteger(value);
      case 'boolean':
        return valueType === 'boolean';
      case 'array':
        return Array.isArray(value);
      case 'object':
        return valueType === 'object' && !Array.isArray(value);
      default:
        return true;
    }
  }

  /**
   * Validates skill dependencies.
   */
  private validateDependencies(skill: SkillDefinition): SkillValidationError[] {
    const errors: SkillValidationError[] = [];

    if (!skill.manifest.dependencies) {
      return errors;
    }

    // Check required tools
    if (skill.manifest.dependencies.tools) {
      for (const tool of skill.manifest.dependencies.tools) {
        if (tool.startsWith('required:')) {
          errors.push({
            field: 'dependencies.tools',
            message: `Required tool not available: ${tool}`,
            code: 'DEPENDENCY_MISSING',
          });
        }
      }
    }

    // Check MCP servers
    if (skill.manifest.dependencies.mcp) {
      for (const mcp of skill.manifest.dependencies.mcp) {
        if (mcp.startsWith('required:')) {
          errors.push({
            field: 'dependencies.mcp',
            message: `Required MCP server not available: ${mcp}`,
            code: 'DEPENDENCY_MISSING',
          });
        }
      }
    }

    return errors;
  }

  /**
   * Validates skill manifest structure.
   */
  validateManifest(skill: SkillDefinition): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];
    const { manifest } = skill;

    if (!manifest.id) {
      errors.push('Manifest missing id');
    }

    if (!manifest.name) {
      errors.push('Manifest missing name');
    }

    if (!manifest.version) {
      errors.push('Manifest missing version');
    }

    if (!manifest.description) {
      errors.push('Manifest missing description');
    }

    // Validate version format (semver)
    if (manifest.version && !/^\d+\.\d+\.\d+/.test(manifest.version)) {
      errors.push(`Invalid version format: ${manifest.version} (expected semver)`);
    }

    // Validate parameters
    if (manifest.parameters) {
      for (let i = 0; i < manifest.parameters.length; i++) {
        const param = manifest.parameters[i];
        if (!param.name) {
          errors.push(`Parameter ${i} missing name`);
        }
        if (!param.type) {
          errors.push(`Parameter ${i} (${param.name || 'unknown'}) missing type`);
        }
      }
    }

    // Validate capabilities
    if (manifest.capabilities) {
      for (let i = 0; i < manifest.capabilities.length; i++) {
        const cap = manifest.capabilities[i];
        if (!cap.name) {
          errors.push(`Capability ${i} missing name`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Pre-checks before execution.
   */
  preCheckExecution(skill: SkillDefinition, input: SkillExecutionInput): SkillPreCheckResult {
    const errors: SkillValidationError[] = [];

    // Check skill status
    if (!skill || skill.status === 'failed') {
      errors.push({
        field: 'skill',
        message: 'Skill is in failed state',
        code: 'CAPABILITY_MISSING',
      });
    }

    if (skill.manifest.disabled) {
      errors.push({
        field: 'skill',
        message: 'Skill is disabled',
        code: 'CAPABILITY_MISSING',
      });
    }

    // Check manifest validity
    const manifestCheck = this.validateManifest(skill);
    if (!manifestCheck.valid) {
      errors.push({
        field: 'manifest',
        message: `Invalid manifest: ${manifestCheck.errors.join('; ')}`,
        code: 'INVALID_VALUE',
      });
    }

    // Validate input
    const inputCheck = this.validateInput(skill, input);
    errors.push(...inputCheck.errors);

    return {
      valid: errors.length === 0,
      errors,
      warnings: inputCheck.warnings,
    };
  }

  /**
   * Schema compliance check for a single parameter.
   */
  checkParameterCompliance(param: SkillParameter, value: unknown): {
    compliant: boolean;
    violations: string[];
  } {
    const violations: string[] = [];

    // Type check
    if (!this.typeMatches(param.type, value)) {
      violations.push(`Type mismatch: expected ${param.type}, got ${typeof value}`);
    }

    // Value checks
    if (param.type === 'string' && typeof value === 'string') {
      if (param.minLength && value.length < param.minLength) {
        violations.push(`Length ${value.length} is less than minimum ${param.minLength}`);
      }
      if (param.maxLength && value.length > param.maxLength) {
        violations.push(`Length ${value.length} exceeds maximum ${param.maxLength}`);
      }
      if (param.pattern && !new RegExp(param.pattern).test(value)) {
        violations.push(`Does not match pattern: ${param.pattern}`);
      }
    }

    if (param.enum && !param.enum.includes(value)) {
      violations.push(`Value not in enum: [${param.enum.join(', ')}]`);
    }

    return {
      compliant: violations.length === 0,
      violations,
    };
  }
}
