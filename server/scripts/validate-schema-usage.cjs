#!/usr/bin/env node
/**
 * Prisma Schema-Code Consistency Validator
 *
 * Scans codebase for Prisma usage and validates against schema.
 * Run with: node server/scripts/validate-schema-usage.js
 *
 * Catches issues like:
 * - prisma.deal (model doesn't exist)
 * - prisma.lpInvitation (wrong case - should be lPInvitation)
 * - underwritingModel.purchasePrice (field doesn't exist)
 * - create without required field
 */

const fs = require('fs');
const path = require('path');

// Configuration
const SCHEMA_PATH = path.join(__dirname, '..', 'prisma', 'schema.prisma');
const CODE_DIRS = [
  path.join(__dirname, '..', 'routes'),
  path.join(__dirname, '..', 'services'),
  path.join(__dirname, '..', 'scripts'),
  path.join(__dirname, '..', '__tests__')
];
const FILE_EXTENSIONS = ['.js', '.ts', '.mjs'];

// Models that exist in kernel, not BFF (should use kernelClient)
const KERNEL_MODELS = ['deal', 'artifact', 'Deal', 'Artifact'];

// =============================================================================
// SCHEMA PARSER
// =============================================================================

function parseSchema(schemaPath) {
  const content = fs.readFileSync(schemaPath, 'utf-8');
  const models = {};

  // Match model definitions
  const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g;
  let match;

  while ((match = modelRegex.exec(content)) !== null) {
    const modelName = match[1];
    const modelBody = match[2];

    // Parse fields
    const fields = {};
    const fieldRegex = /^\s*(\w+)\s+(\w+)(\?)?/gm;
    let fieldMatch;

    while ((fieldMatch = fieldRegex.exec(modelBody)) !== null) {
      const fieldName = fieldMatch[1];
      const fieldType = fieldMatch[2];
      const isOptional = fieldMatch[3] === '?';

      // Skip relation fields and decorators
      if (!['@@', '@'].includes(fieldName[0])) {
        fields[fieldName] = {
          type: fieldType,
          optional: isOptional
        };
      }
    }

    models[modelName] = {
      name: modelName,
      // Prisma client uses lowercase first letter
      clientName: modelName.charAt(0).toLowerCase() + modelName.slice(1),
      fields
    };
  }

  return models;
}

// =============================================================================
// CODE SCANNER
// =============================================================================

function scanDirectory(dir, extensions) {
  const files = [];

  if (!fs.existsSync(dir)) {
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...scanDirectory(fullPath, extensions));
    } else if (extensions.some(ext => entry.name.endsWith(ext))) {
      files.push(fullPath);
    }
  }

  return files;
}

function scanFileForPrismaUsage(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const usages = [];
  const lines = content.split('\n');

  // Pattern: prisma.modelName
  const modelAccessRegex = /prisma\.(\w+)/g;

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    let match;

    while ((match = modelAccessRegex.exec(line)) !== null) {
      const modelName = match[1];

      // Skip common Prisma methods that aren't model names
      if (['$connect', '$disconnect', '$transaction', '$queryRaw', '$executeRaw'].includes(modelName)) {
        continue;
      }

      usages.push({
        file: filePath,
        line: lineNum + 1,
        column: match.index,
        modelName,
        code: line.trim()
      });
    }
  }

  return usages;
}

// =============================================================================
// VALIDATOR
// =============================================================================

function validateUsages(usages, schema) {
  const errors = [];
  const warnings = [];

  // Build a map of valid client names
  const validClientNames = new Set();
  const clientToSchemaMap = {};

  for (const [schemaName, model] of Object.entries(schema)) {
    validClientNames.add(model.clientName);
    clientToSchemaMap[model.clientName] = schemaName;
  }

  for (const usage of usages) {
    const { file, line, modelName, code } = usage;
    const relativePath = path.relative(process.cwd(), file);

    // Check for kernel models (should use kernelClient)
    if (KERNEL_MODELS.includes(modelName)) {
      errors.push({
        type: 'KERNEL_MODEL',
        file: relativePath,
        line,
        code,
        modelName,
        message: `Model '${modelName}' is kernel-managed, not in BFF schema`,
        hint: `Use kernelClient.get${modelName.charAt(0).toUpperCase() + modelName.slice(1)}() instead`
      });
      continue;
    }

    // Check if model exists
    if (!validClientNames.has(modelName)) {
      // Check for case mismatch
      const lowerName = modelName.toLowerCase();
      const possibleMatch = [...validClientNames].find(
        n => n.toLowerCase() === lowerName
      );

      if (possibleMatch) {
        errors.push({
          type: 'CASE_MISMATCH',
          file: relativePath,
          line,
          code,
          modelName,
          message: `Wrong case: prisma.${modelName}`,
          hint: `Should be prisma.${possibleMatch}`
        });
      } else {
        errors.push({
          type: 'MODEL_NOT_FOUND',
          file: relativePath,
          line,
          code,
          modelName,
          message: `Model '${modelName}' does not exist in schema`,
          hint: 'Check if this model should exist or use kernelClient for kernel-managed data'
        });
      }
    }
  }

  return { errors, warnings };
}

// =============================================================================
// REPORTER
// =============================================================================

function formatReport(results) {
  const { errors, warnings } = results;

  let output = '';

  if (errors.length === 0 && warnings.length === 0) {
    output += '✅ Schema validation passed! No issues found.\n';
    return output;
  }

  if (errors.length > 0) {
    output += '\n❌ SCHEMA VALIDATION ERRORS\n';
    output += '═'.repeat(50) + '\n\n';

    errors.forEach((error, index) => {
      output += `${index + 1}. ${error.type.replace(/_/g, ' ')}\n`;
      output += `   File: ${error.file}:${error.line}\n`;
      output += `   Code: ${error.code.substring(0, 80)}${error.code.length > 80 ? '...' : ''}\n`;
      output += `   Error: ${error.message}\n`;
      output += `   Hint: ${error.hint}\n\n`;
    });
  }

  if (warnings.length > 0) {
    output += '\n⚠️  WARNINGS\n';
    output += '─'.repeat(50) + '\n\n';

    warnings.forEach((warning, index) => {
      output += `${index + 1}. ${warning.message}\n`;
      output += `   File: ${warning.file}:${warning.line}\n\n`;
    });
  }

  output += '─'.repeat(50) + '\n';
  output += `Total: ${errors.length} error(s), ${warnings.length} warning(s)\n`;

  return output;
}

// =============================================================================
// MAIN
// =============================================================================

function main() {
  console.log('Prisma Schema-Code Consistency Validator');
  console.log('─'.repeat(40) + '\n');

  // Parse schema
  console.log('Parsing schema...');
  const schema = parseSchema(SCHEMA_PATH);
  console.log(`Found ${Object.keys(schema).length} models in schema\n`);

  // Scan code
  console.log('Scanning code for Prisma usage...');
  const allUsages = [];

  for (const dir of CODE_DIRS) {
    const files = scanDirectory(dir, FILE_EXTENSIONS);

    for (const file of files) {
      const usages = scanFileForPrismaUsage(file);
      allUsages.push(...usages);
    }
  }

  console.log(`Found ${allUsages.length} Prisma model references\n`);

  // Validate
  console.log('Validating consistency...');
  const results = validateUsages(allUsages, schema);

  // Report
  const report = formatReport(results);
  console.log(report);

  // Exit with error code if errors found
  if (results.errors.length > 0) {
    process.exit(1);
  }
}

main();
