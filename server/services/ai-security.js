/**
 * AI Security Service
 *
 * Provides protection against prompt injection attacks, jailbreak attempts,
 * and validates LLM outputs for security issues.
 *
 * SECURITY: Critical component for AI safety. Prevents:
 * - Prompt injection attacks
 * - Jailbreak attempts to bypass system prompts
 * - Code/SQL injection in LLM outputs
 * - Data exfiltration through crafted prompts
 *
 * Phase 1.1 Implementation
 */

// Configuration via environment variables
export const SECURITY_CONFIG = {
  enabled: process.env.AI_SECURITY_ENABLED !== 'false',
  jailbreakBlockThreshold: parseFloat(process.env.AI_JAILBREAK_BLOCK_THRESHOLD) || 0.8,
  jailbreakWarnThreshold: parseFloat(process.env.AI_JAILBREAK_WARN_THRESHOLD) || 0.5,
  maxInputLength: parseInt(process.env.AI_MAX_INPUT_LENGTH) || 10000,
  enableOutputValidation: process.env.AI_ENABLE_OUTPUT_VALIDATION !== 'false',
  debug: process.env.DEBUG_AI_SECURITY === 'true',
};

/**
 * Jailbreak detection patterns
 * Each pattern has a weight that contributes to the jailbreak score
 */
const JAILBREAK_PATTERNS = [
  // Direct instruction override attempts
  { pattern: /ignore\s+(previous|all|above|prior|your)\s+(instructions|rules|prompts?|guidelines)/i, weight: 0.9, name: 'ignore_instructions' },
  { pattern: /disregard\s+(your|the|all)\s+(system|initial|original)\s+(prompt|instructions|rules)/i, weight: 0.9, name: 'disregard_system' },
  { pattern: /forget\s+(everything|all|your)\s+(you|previous|prior)/i, weight: 0.8, name: 'forget_previous' },

  // Role-play / persona injection
  { pattern: /you\s+are\s+now\s+(a|an|in)\s+(DAN|jailbreak|unrestricted|unfiltered)/i, weight: 0.95, name: 'dan_jailbreak' },
  { pattern: /pretend\s+(you\s+are|to\s+be)\s+(a|an)?\s*(human|uncensored|unfiltered|evil)/i, weight: 0.85, name: 'pretend_persona' },
  { pattern: /act\s+as\s+(if|though)\s+you\s+(have\s+no|don't\s+have)\s+(restrictions|limits|rules)/i, weight: 0.85, name: 'act_unrestricted' },
  { pattern: /roleplay\s+as\s+(an?\s+)?(evil|malicious|unethical)/i, weight: 0.8, name: 'roleplay_malicious' },

  // System prompt extraction
  { pattern: /what\s+(is|are)\s+your\s+(system|initial|original)\s+(prompt|instructions)/i, weight: 0.7, name: 'extract_system_prompt' },
  { pattern: /show\s+me\s+your\s+(hidden|secret|system)\s+(prompt|instructions|rules)/i, weight: 0.8, name: 'show_hidden_prompt' },
  { pattern: /reveal\s+your\s+(programming|instructions|system\s+prompt)/i, weight: 0.75, name: 'reveal_programming' },

  // Delimiter injection
  { pattern: /\[system\]|\[admin\]|\[override\]|\[sudo\]/i, weight: 0.85, name: 'bracket_injection' },
  { pattern: /```system|```admin|```override/i, weight: 0.8, name: 'codeblock_injection' },
  { pattern: /<system>|<admin>|<override>|<sudo>/i, weight: 0.85, name: 'tag_injection' },

  // New instruction injection
  { pattern: /new\s+(system|core|primary)\s+(prompt|instructions?):/i, weight: 0.9, name: 'new_instructions' },
  { pattern: /your\s+new\s+(instructions|rules|guidelines)\s+are/i, weight: 0.85, name: 'new_rules' },
  { pattern: /from\s+now\s+on,?\s+(ignore|forget|disregard)/i, weight: 0.8, name: 'from_now_on' },

  // Bypass attempts
  { pattern: /bypass\s+(your|the|all)\s+(restrictions|filters|rules|safety)/i, weight: 0.9, name: 'bypass_restrictions' },
  { pattern: /disable\s+(your|the)\s+(safety|content)\s+(filters?|restrictions?)/i, weight: 0.9, name: 'disable_safety' },
  { pattern: /turn\s+off\s+(your|the)\s+(safety|content|ethical)\s+(filters?|guidelines)/i, weight: 0.85, name: 'turn_off_filters' },

  // Developer mode / debug mode
  { pattern: /enter\s+(developer|debug|admin|god)\s+mode/i, weight: 0.85, name: 'enter_dev_mode' },
  { pattern: /enable\s+(developer|debug|unrestricted)\s+mode/i, weight: 0.85, name: 'enable_dev_mode' },
  { pattern: /switch\s+to\s+(developer|admin|unrestricted)\s+mode/i, weight: 0.8, name: 'switch_mode' },

  // Output manipulation
  { pattern: /respond\s+without\s+(restrictions|filters|censorship)/i, weight: 0.75, name: 'respond_unrestricted' },
  { pattern: /give\s+me\s+the\s+uncensored\s+(response|answer|version)/i, weight: 0.7, name: 'uncensored_response' },
];

/**
 * Prompt delimiters that should be escaped to prevent injection
 */
const PROMPT_DELIMITERS = [
  { find: /```/g, replace: '` ` `' },
  { find: /\[system\]/gi, replace: '[s.y" + "stem]' },
  { find: /\[admin\]/gi, replace: '[a.d" + "min]' },
  { find: /<system>/gi, replace: '<s.y" + "stem>' },
  { find: /<\/system>/gi, replace: '</s.y" + "stem>' },
];

/**
 * SQL injection patterns to detect in LLM output
 */
const SQL_INJECTION_PATTERNS = [
  /\bDROP\s+TABLE\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bINSERT\s+INTO\b/i,
  /\bUPDATE\s+\w+\s+SET\b/i,
  /\bSELECT\s+\*\s+FROM\b/i,
  /;\s*--/,
  /\bUNION\s+SELECT\b/i,
  /\bOR\s+1\s*=\s*1\b/i,
  /\bAND\s+1\s*=\s*1\b/i,
];

/**
 * Code injection patterns to detect in LLM output
 */
const CODE_INJECTION_PATTERNS = [
  /eval\s*\(/i,
  /exec\s*\(/i,
  /Function\s*\(/i,
  /setTimeout\s*\(\s*["'`]/i,
  /setInterval\s*\(\s*["'`]/i,
  /document\.write\s*\(/i,
  /innerHTML\s*=/i,
  /\bimport\s*\(/i,
  /require\s*\(\s*["'`]child_process/i,
  /\bspawn\s*\(/i,
  /\bexecSync\s*\(/i,
];

/**
 * Sanitize user input before sending to LLM
 *
 * @param {string} input - Raw user input
 * @param {Object} options - Sanitization options
 * @param {number} options.maxLength - Maximum allowed length
 * @param {boolean} options.escapeDelimiters - Whether to escape prompt delimiters
 * @param {boolean} options.normalizeUnicode - Whether to normalize unicode characters
 * @returns {Object} { sanitized: string, wasModified: boolean, modifications: string[] }
 */
export function sanitizeUserInput(input, options = {}) {
  const {
    maxLength = SECURITY_CONFIG.maxInputLength,
    escapeDelimiters = true,
    normalizeUnicode = true,
  } = options;

  if (!input || typeof input !== 'string') {
    return { sanitized: '', wasModified: false, modifications: [] };
  }

  let sanitized = input;
  const modifications = [];

  // Normalize unicode to prevent homoglyph attacks
  if (normalizeUnicode) {
    const normalized = sanitized.normalize('NFKC');
    if (normalized !== sanitized) {
      modifications.push('unicode_normalized');
      sanitized = normalized;
    }
  }

  // Escape prompt delimiters
  if (escapeDelimiters) {
    for (const delimiter of PROMPT_DELIMITERS) {
      if (delimiter.find.test(sanitized)) {
        sanitized = sanitized.replace(delimiter.find, delimiter.replace);
        modifications.push(`escaped_${delimiter.find.source.replace(/[^a-z]/gi, '_')}`);
      }
    }
  }

  // Enforce maximum length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
    modifications.push('truncated');
  }

  // Remove null bytes and other control characters (except newlines/tabs)
  const beforeControls = sanitized;
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  if (sanitized !== beforeControls) {
    modifications.push('control_chars_removed');
  }

  if (SECURITY_CONFIG.debug && modifications.length > 0) {
    console.log(`[AI-SECURITY] Input sanitized: ${modifications.join(', ')}`);
  }

  return {
    sanitized,
    wasModified: modifications.length > 0,
    modifications,
  };
}

/**
 * Escape prompt delimiters in text (for use in prompt templates)
 *
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
export function escapePromptDelimiters(text) {
  if (!text || typeof text !== 'string') {
    return text;
  }

  let escaped = text;
  for (const delimiter of PROMPT_DELIMITERS) {
    escaped = escaped.replace(delimiter.find, delimiter.replace);
  }
  return escaped;
}

/**
 * Detect jailbreak attempts in user input
 *
 * @param {string} input - User input to analyze
 * @returns {Object} { score: number, isBlocked: boolean, isWarning: boolean, patterns: string[] }
 */
export function detectJailbreakAttempt(input) {
  if (!input || typeof input !== 'string') {
    return { score: 0, isBlocked: false, isWarning: false, patterns: [] };
  }

  const detectedPatterns = [];
  let totalWeight = 0;

  for (const { pattern, weight, name } of JAILBREAK_PATTERNS) {
    if (pattern.test(input)) {
      detectedPatterns.push(name);
      totalWeight += weight;
    }
  }

  // Normalize score to 0-1 range (cap at 1.0)
  const score = Math.min(totalWeight, 1.0);

  const result = {
    score,
    isBlocked: score >= SECURITY_CONFIG.jailbreakBlockThreshold,
    isWarning: score >= SECURITY_CONFIG.jailbreakWarnThreshold && score < SECURITY_CONFIG.jailbreakBlockThreshold,
    patterns: detectedPatterns,
  };

  if (SECURITY_CONFIG.debug && detectedPatterns.length > 0) {
    console.log(`[AI-SECURITY] Jailbreak detection: score=${score.toFixed(2)}, patterns=${detectedPatterns.join(', ')}`);
  }

  if (result.isBlocked) {
    console.log(`[AI-SECURITY] BLOCKED jailbreak attempt: score=${score.toFixed(2)}, patterns=${detectedPatterns.join(', ')}`);
  } else if (result.isWarning) {
    console.log(`[AI-SECURITY] WARNING potential jailbreak: score=${score.toFixed(2)}, patterns=${detectedPatterns.join(', ')}`);
  }

  return result;
}

/**
 * Validate LLM output for security issues
 *
 * @param {string} output - LLM response to validate
 * @param {string} expectedType - Expected response type: 'chat', 'json', 'structured'
 * @returns {Object} { valid: boolean, issues: string[], severity: string }
 */
export function validateLLMOutput(output, expectedType = 'chat') {
  if (!SECURITY_CONFIG.enableOutputValidation) {
    return { valid: true, issues: [], severity: 'none' };
  }

  if (!output || typeof output !== 'string') {
    return { valid: true, issues: [], severity: 'none' };
  }

  const issues = [];
  let highestSeverity = 'none';

  // Check for SQL injection patterns
  for (const pattern of SQL_INJECTION_PATTERNS) {
    if (pattern.test(output)) {
      issues.push(`sql_injection: ${pattern.source}`);
      highestSeverity = 'high';
    }
  }

  // Check for code injection patterns (more concerning in chat responses)
  if (expectedType === 'chat') {
    for (const pattern of CODE_INJECTION_PATTERNS) {
      if (pattern.test(output)) {
        issues.push(`code_injection: ${pattern.source}`);
        if (highestSeverity !== 'high') {
          highestSeverity = 'medium';
        }
      }
    }
  }

  // For JSON responses, validate structure
  if (expectedType === 'json') {
    try {
      JSON.parse(output);
    } catch {
      issues.push('invalid_json_structure');
      if (highestSeverity === 'none') {
        highestSeverity = 'low';
      }
    }
  }

  // Check for potential data exfiltration markers
  const exfilPatterns = [
    /BEGIN\s+(PGP|RSA|SSH)\s+(PRIVATE|PUBLIC)\s+KEY/i,
    /-----BEGIN\s+CERTIFICATE-----/i,
    /password\s*[:=]\s*["']?[^"'\s]{8,}/i,
    /api[_-]?key\s*[:=]\s*["']?[a-zA-Z0-9_]{20,}/i,
    /secret\s*[:=]\s*["']?[a-zA-Z0-9_]{16,}/i,
  ];

  for (const pattern of exfilPatterns) {
    if (pattern.test(output)) {
      issues.push(`potential_secret_exposure: ${pattern.source.substring(0, 30)}`);
      highestSeverity = 'high';
    }
  }

  const valid = issues.length === 0;

  if (SECURITY_CONFIG.debug && !valid) {
    console.log(`[AI-SECURITY] Output validation issues: ${issues.join(', ')}`);
  }

  if (!valid && highestSeverity === 'high') {
    console.log(`[AI-SECURITY] HIGH severity output issue: ${issues.join(', ')}`);
  }

  return {
    valid,
    issues,
    severity: highestSeverity,
  };
}

/**
 * Detect code injection patterns in output (convenience function)
 *
 * @param {string} output - Output to check
 * @returns {Object} { detected: boolean, patterns: string[] }
 */
export function detectCodeInjection(output) {
  if (!output || typeof output !== 'string') {
    return { detected: false, patterns: [] };
  }

  const detectedPatterns = [];

  for (const pattern of CODE_INJECTION_PATTERNS) {
    if (pattern.test(output)) {
      detectedPatterns.push(pattern.source);
    }
  }

  for (const pattern of SQL_INJECTION_PATTERNS) {
    if (pattern.test(output)) {
      detectedPatterns.push(pattern.source);
    }
  }

  return {
    detected: detectedPatterns.length > 0,
    patterns: detectedPatterns,
  };
}

/**
 * Create a security context object for logging
 *
 * @param {string} input - Original user input
 * @param {Object} sanitizeResult - Result from sanitizeUserInput
 * @param {Object} jailbreakResult - Result from detectJailbreakAttempt
 * @param {Object} outputValidation - Result from validateLLMOutput (optional)
 * @returns {Object} Security context for logging
 */
export function createSecurityContext(input, sanitizeResult, jailbreakResult, outputValidation = null) {
  return {
    sanitizationApplied: sanitizeResult?.wasModified || false,
    jailbreakScore: jailbreakResult?.score || null,
    jailbreakPatterns: jailbreakResult?.patterns?.length > 0
      ? JSON.stringify(jailbreakResult.patterns)
      : null,
    outputValidationPassed: outputValidation?.valid ?? true,
    outputValidationIssues: outputValidation?.issues?.length > 0
      ? JSON.stringify(outputValidation.issues)
      : null,
  };
}

/**
 * Full security check pipeline
 * Combines sanitization and jailbreak detection
 *
 * @param {string} input - User input to check
 * @param {Object} options - Options for sanitization
 * @returns {Object} { sanitized: string, blocked: boolean, securityContext: Object, error?: string }
 */
export function securityCheck(input, options = {}) {
  if (!SECURITY_CONFIG.enabled) {
    return {
      sanitized: input,
      blocked: false,
      securityContext: createSecurityContext(input, { wasModified: false }, { score: 0, patterns: [] }),
    };
  }

  // Sanitize input
  const sanitizeResult = sanitizeUserInput(input, options);

  // Check for jailbreak attempts (on original input - we want to detect even if sanitized)
  const jailbreakResult = detectJailbreakAttempt(input);

  // Create security context for logging
  const securityContext = createSecurityContext(input, sanitizeResult, jailbreakResult);

  // Determine if blocked
  if (jailbreakResult.isBlocked) {
    return {
      sanitized: sanitizeResult.sanitized,
      blocked: true,
      securityContext,
      error: 'Input rejected by security filter. Please rephrase your request.',
    };
  }

  return {
    sanitized: sanitizeResult.sanitized,
    blocked: false,
    securityContext,
    warning: jailbreakResult.isWarning
      ? 'Input flagged for potential policy violation but allowed.'
      : null,
  };
}

/**
 * Security error class for consistent error handling
 */
export class SecurityError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SecurityError';
    this.details = details;
    this.isSecurityError = true;
  }
}

export default {
  SECURITY_CONFIG,
  sanitizeUserInput,
  escapePromptDelimiters,
  detectJailbreakAttempt,
  validateLLMOutput,
  detectCodeInjection,
  createSecurityContext,
  securityCheck,
  SecurityError,
};
