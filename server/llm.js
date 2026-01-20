import { createClient } from "@base44/sdk";
import {
  sanitizeUserInput,
  detectJailbreakAttempt,
  escapePromptDelimiters,
  SecurityError,
  SECURITY_CONFIG
} from './services/ai-security.js';

let base44Client = null;

const OPENAI_API_KEY =
  process.env.BFF_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? null;
const OPENAI_MODEL =
  process.env.BFF_OPENAI_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const OPENAI_BASE_URL =
  process.env.BFF_OPENAI_BASE_URL ?? "https://api.openai.com/v1";
const OPENAI_ORG =
  process.env.BFF_OPENAI_ORG ?? process.env.OPENAI_ORG_ID ?? null;
const OPENAI_PROJECT =
  process.env.BFF_OPENAI_PROJECT ?? process.env.OPENAI_PROJECT ?? null;
const OPENAI_TEMPERATURE = Number(process.env.BFF_OPENAI_TEMPERATURE ?? 0);

function resolveBase44Config() {
  return {
    appId: process.env.BFF_BASE44_APP_ID ?? process.env.VITE_BASE44_APP_ID ?? null,
    token:
      process.env.BFF_BASE44_TOKEN ??
      process.env.VITE_BASE44_TOKEN ??
      process.env.BASE44_TOKEN ??
      null,
    functionsVersion:
      process.env.BFF_BASE44_FUNCTIONS_VERSION ??
      process.env.VITE_BASE44_FUNCTIONS_VERSION ??
      null,
    appBaseUrl:
      process.env.BFF_BASE44_APP_BASE_URL ??
      process.env.VITE_BASE44_APP_BASE_URL ??
      null
  };
}

function isBase44Configured(config) {
  return Boolean(config.appId && config.functionsVersion && config.appBaseUrl);
}

function getBase44Client() {
  if (base44Client) {
    return base44Client;
  }
  const config = resolveBase44Config();
  if (!isBase44Configured(config)) {
    const error = new Error("Base44 LLM not configured");
    error.status = 502;
    throw error;
  }
  base44Client = createClient({
    appId: config.appId,
    token: config.token ?? undefined,
    functionsVersion: config.functionsVersion,
    serverUrl: "",
    requiresAuth: false,
    appBaseUrl: config.appBaseUrl
  });
  return base44Client;
}

export const PROMPT_VERSION = "deal-parse.v1";
export const SCHEMA_VERSION = "deal-parse.v1";

export const dealParseSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    asset_type: { type: "string" },
    asset_address: { type: "string" },
    asset_city: { type: "string" },
    asset_state: { type: "string" },
    square_footage: { type: "number" },
    unit_count: { type: "number" },
    year_built: { type: "number" },
    purchase_price: { type: "number" },
    noi: { type: "number" },
    cap_rate: { type: "number" },
    senior_debt: { type: "number" },
    mezzanine_debt: { type: "number" },
    preferred_equity: { type: "number" },
    common_equity: { type: "number" },
    gp_name: { type: "string" },
    lender_name: { type: "string" },
    deal_summary: { type: "string" }
  }
};

/**
 * Build the deal parse prompt with security sanitization
 *
 * SECURITY: User text is sanitized to prevent prompt injection.
 * Jailbreak attempts are detected and logged.
 *
 * @param {string} text - Raw deal information text
 * @param {string} variant - Prompt variant (BASE or STRICT_REPAIR)
 * @returns {Object} { prompt: string, securityContext: Object }
 * @throws {SecurityError} If jailbreak attempt is blocked
 */
function buildDealParsePrompt(text, variant) {
  // SECURITY: Sanitize user input
  const sanitizeResult = sanitizeUserInput(text, {
    maxLength: SECURITY_CONFIG.maxInputLength,
    escapeDelimiters: true,
    normalizeUnicode: true
  });

  // SECURITY: Check for jailbreak attempts
  const jailbreakResult = detectJailbreakAttempt(text);

  if (jailbreakResult.isBlocked) {
    const error = new SecurityError(
      'Input rejected by security filter',
      { score: jailbreakResult.score, patterns: jailbreakResult.patterns }
    );
    throw error;
  }

  const header =
    variant === "STRICT_REPAIR"
      ? "Repair the prior JSON output to match the schema exactly. Return ONLY the JSON object, no other text."
      : "Parse this real estate deal information and extract structured data. Return ONLY the JSON object, no other text.";

  const prompt = `${header}

Deal Information:
${sanitizeResult.sanitized}

Extract these fields (use null for unknown):
- name: Deal name/title
- asset_type: One of [Multifamily, Office, Industrial, Retail, Mixed-Use, Hospitality, Healthcare]
- asset_address: Street address
- asset_city: City
- asset_state: State abbreviation
- square_footage: Number
- unit_count: Number (for multifamily)
- year_built: Number
- purchase_price: Number (in dollars)
- noi: Net Operating Income (number)
- cap_rate: Number (as decimal, e.g., 0.05 for 5%)
- senior_debt: Number
- mezzanine_debt: Number
- preferred_equity: Number
- common_equity: Number
- gp_name: General Partner name
- lender_name: Lender name
- deal_summary: Brief summary`;

  // Return both prompt and security context for logging
  return {
    prompt,
    securityContext: {
      sanitizationApplied: sanitizeResult.wasModified,
      sanitizationModifications: sanitizeResult.modifications,
      jailbreakScore: jailbreakResult.score,
      jailbreakPatterns: jailbreakResult.patterns,
      jailbreakWarning: jailbreakResult.isWarning
    }
  };
}

function resolveProvider() {
  if (OPENAI_API_KEY) {
    return { name: "openai", model: OPENAI_MODEL, request: requestDealParseFromOpenAI };
  }

  const base44Config = resolveBase44Config();
  if (isBase44Configured(base44Config)) {
    return { name: "base44", model: null, request: requestDealParseFromBase44 };
  }

  const error = new Error("LLM not configured");
  error.status = 502;
  throw error;
}

export function getLLMProviderMeta() {
  const provider = resolveProvider();
  return { provider: provider.name, model: provider.model ?? null };
}

async function requestDealParseFromBase44(text, variant = "BASE") {
  const client = getBase44Client();
  try {
    // SECURITY: buildDealParsePrompt now returns { prompt, securityContext }
    const { prompt, securityContext } = buildDealParsePrompt(text, variant);

    const response = await client.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: dealParseSchema
    });
    return { output: response, raw: response, model: null, securityContext };
  } catch (error) {
    // Re-throw security errors as-is
    if (error.isSecurityError) {
      throw error;
    }
    const wrapped = new Error("Base44 LLM request failed");
    wrapped.status = 502;
    wrapped.cause = error;
    throw wrapped;
  }
}

async function requestDealParseFromOpenAI(text, variant = "BASE") {
  if (!OPENAI_API_KEY) {
    const error = new Error("OpenAI not configured");
    error.status = 502;
    throw error;
  }

  // SECURITY: buildDealParsePrompt now returns { prompt, securityContext }
  const { prompt, securityContext } = buildDealParsePrompt(text, variant);

  const url = `${OPENAI_BASE_URL.replace(/\/$/, "")}/chat/completions`;
  const payload = {
    model: OPENAI_MODEL,
    temperature: OPENAI_TEMPERATURE,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You extract structured deal data. Return only JSON. Use null for unknowns."
      },
      {
        role: "user",
        content: prompt
      }
    ]
  };

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${OPENAI_API_KEY}`
  };
  if (OPENAI_ORG) {
    headers["OpenAI-Organization"] = OPENAI_ORG;
  }
  if (OPENAI_PROJECT) {
    headers["OpenAI-Project"] = OPENAI_PROJECT;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message = data?.error?.message ?? "OpenAI request failed";
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    const error = new Error("OpenAI response missing content");
    error.status = 502;
    throw error;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    const error = new Error("OpenAI response was not valid JSON");
    error.status = 502;
    error.data = { content };
    throw error;
  }

  return { output: parsed, raw: data, model: data?.model ?? OPENAI_MODEL, securityContext };
}

export async function requestDealParse(text, variant = "BASE") {
  const provider = resolveProvider();
  const result = await provider.request(text, variant);
  return {
    provider: provider.name,
    model: result.model ?? provider.model ?? null,
    output: result.output,
    raw: result.raw,
    securityContext: result.securityContext ?? null
  };
}

/**
 * Smart Document Parse
 *
 * Extracts specific field values from a document description/content.
 * Used for the "smart upload" feature where users can upload docs
 * and have the system auto-fill missing fields.
 */
export async function requestSmartDocParse(documentContent, filename, targetFields, currentProfile = {}) {
  const provider = resolveProvider();

  // SECURITY: buildSmartDocParsePrompt now returns { prompt, securityContext }
  const { prompt, securityContext } = buildSmartDocParsePrompt(documentContent, filename, targetFields, currentProfile);

  let result;
  if (provider.name === "openai") {
    result = await requestSmartDocParseFromOpenAI(prompt, targetFields);
  } else if (provider.name === "base44") {
    result = await requestSmartDocParseFromBase44(prompt, targetFields);
  } else {
    throw new Error("No LLM provider configured for smart parse");
  }

  // Include security context in result
  return { ...result, securityContext };
}

/**
 * Build the smart document parse prompt with security sanitization
 *
 * SECURITY: Document content and filename are sanitized.
 *
 * @param {string} documentContent - Document content/description
 * @param {string} filename - Document filename
 * @param {Array} targetFields - Fields to extract
 * @param {Object} currentProfile - Current profile values
 * @returns {Object} { prompt: string, securityContext: Object }
 * @throws {SecurityError} If jailbreak attempt is blocked
 */
function buildSmartDocParsePrompt(documentContent, filename, targetFields, currentProfile) {
  // SECURITY: Sanitize document content
  const contentResult = sanitizeUserInput(documentContent, {
    maxLength: SECURITY_CONFIG.maxInputLength,
    escapeDelimiters: true
  });

  // SECURITY: Sanitize filename (shorter limit)
  const filenameResult = sanitizeUserInput(filename, {
    maxLength: 255,
    escapeDelimiters: true
  });

  // SECURITY: Check for jailbreak in document content
  const jailbreakResult = detectJailbreakAttempt(documentContent);

  if (jailbreakResult.isBlocked) {
    throw new SecurityError(
      'Document content rejected by security filter',
      { score: jailbreakResult.score, patterns: jailbreakResult.patterns }
    );
  }

  const fieldsWithCurrent = targetFields.map(field => {
    const current = currentProfile[field];
    return current !== undefined && current !== null
      ? `- ${field}: (current value: ${current})`
      : `- ${field}: (no current value)`;
  }).join('\n');

  const prompt = `You are extracting structured data from a real estate document.

Document name: ${filenameResult.sanitized}
Document content/description: ${contentResult.sanitized}

Extract values for these fields if found in the document:
${fieldsWithCurrent}

For each field, return the extracted value or null if not found.
Use appropriate data types:
- Currency values (purchase_price, noi, senior_debt, etc.) should be numbers in dollars
- Percentages (cap_rate, ltv, occupancy) should be decimals (e.g., 0.05 for 5%)
- Counts (unit_count, square_footage, year_built) should be integers
- Text fields (asset_address, gp_name, etc.) should be strings

Return a JSON object with the field names as keys and extracted values.`;

  return {
    prompt,
    securityContext: {
      sanitizationApplied: contentResult.wasModified || filenameResult.wasModified,
      jailbreakScore: jailbreakResult.score,
      jailbreakPatterns: jailbreakResult.patterns,
      jailbreakWarning: jailbreakResult.isWarning
    }
  };
}

async function requestSmartDocParseFromOpenAI(prompt, targetFields) {
  if (!OPENAI_API_KEY) {
    const error = new Error("OpenAI not configured");
    error.status = 502;
    throw error;
  }

  const schema = {
    type: "object",
    properties: {}
  };

  for (const field of targetFields) {
    // Determine field type based on name
    if (['purchase_price', 'noi', 'senior_debt', 'mezzanine_debt', 'preferred_equity', 'common_equity'].includes(field)) {
      schema.properties[field] = { type: ["number", "null"] };
    } else if (['cap_rate', 'ltv', 'occupancy', 'dscr'].includes(field)) {
      schema.properties[field] = { type: ["number", "null"] };
    } else if (['unit_count', 'square_footage', 'year_built'].includes(field)) {
      schema.properties[field] = { type: ["integer", "null"] };
    } else {
      schema.properties[field] = { type: ["string", "null"] };
    }
  }

  const url = `${OPENAI_BASE_URL.replace(/\/$/, "")}/chat/completions`;
  const payload = {
    model: OPENAI_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You extract structured data from real estate documents. Return only JSON with the requested fields."
      },
      {
        role: "user",
        content: prompt
      }
    ]
  };

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${OPENAI_API_KEY}`
  };
  if (OPENAI_ORG) {
    headers["OpenAI-Organization"] = OPENAI_ORG;
  }
  if (OPENAI_PROJECT) {
    headers["OpenAI-Project"] = OPENAI_PROJECT;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message = data?.error?.message ?? "OpenAI request failed";
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI response missing content");
  }

  let parsed = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("OpenAI response was not valid JSON");
  }

  return { extracted: parsed, raw: data };
}

async function requestSmartDocParseFromBase44(prompt, targetFields) {
  const client = getBase44Client();

  const schema = {
    type: "object",
    properties: {}
  };

  for (const field of targetFields) {
    schema.properties[field] = { type: ["string", "number", "null"] };
  }

  try {
    const response = await client.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: schema
    });
    return { extracted: response, raw: response };
  } catch (error) {
    const wrapped = new Error("Base44 smart parse failed");
    wrapped.status = 502;
    wrapped.cause = error;
    throw wrapped;
  }
}

/**
 * Generic OpenAI call for chat completions
 * Used by AI assistant and other features
 */
export async function callOpenAI(messages, options = {}) {
  if (!OPENAI_API_KEY) {
    const error = new Error("OpenAI not configured");
    error.status = 502;
    throw error;
  }

  const url = `${OPENAI_BASE_URL.replace(/\/$/, "")}/chat/completions`;
  const payload = {
    model: options.model || OPENAI_MODEL,
    temperature: options.temperature ?? OPENAI_TEMPERATURE,
    messages,
    ...(options.response_format && { response_format: options.response_format }),
    ...(options.max_tokens && { max_tokens: options.max_tokens })
  };

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${OPENAI_API_KEY}`
  };
  if (OPENAI_ORG) {
    headers["OpenAI-Organization"] = OPENAI_ORG;
  }
  if (OPENAI_PROJECT) {
    headers["OpenAI-Project"] = OPENAI_PROJECT;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message = data?.error?.message ?? "OpenAI request failed";
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

// Re-export SecurityError for consumers
export { SecurityError };
