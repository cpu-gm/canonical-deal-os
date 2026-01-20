import { Readable } from "node:stream";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*"
};

const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

// Structured logging helper
function log(level, category, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[${timestamp}] [${level}] [${category}] ${message}${metaStr}`);
}

function filterHeaders(input) {
  const headers = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if (!hopByHopHeaders.has(key.toLowerCase())) {
      headers[key] = value;
    }
  }
  return headers;
}

async function parseResponseBody(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function kernelRequest(url, options = {}) {
  const method = options.method || 'GET';
  const startTime = Date.now();

  // Extract path from URL for cleaner logging
  const urlPath = url.replace(/^https?:\/\/[^/]+/, '');
  log('INFO', 'KERNEL', `${method} ${urlPath} → started`);

  const headers = filterHeaders(options.headers ?? {});
  if (!headers["Content-Type"] && options.body) {
    headers["Content-Type"] = "application/json";
  }

  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    log('ERROR', 'KERNEL', `${method} ${urlPath} → FAILED (${duration}ms)`, {
      error: error.message,
      code: error.code || 'UNKNOWN'
    });
    const kernelError = new Error("Kernel unavailable");
    kernelError.type = "KERNEL_UNAVAILABLE";
    kernelError.cause = error;
    throw kernelError;
  }

  const data = await parseResponseBody(response);
  const duration = Date.now() - startTime;

  if (response.ok) {
    log('INFO', 'KERNEL', `${method} ${urlPath} → ${response.status} (${duration}ms)`);
  } else {
    log('WARN', 'KERNEL', `${method} ${urlPath} → ${response.status} (${duration}ms)`, {
      error: typeof data === 'object' ? data?.message || data?.error : data
    });
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
    headers: response.headers
  };
}

export async function kernelFetchJson(url, options = {}) {
  const result = await kernelRequest(url, options);
  if (!result.ok) {
    const error = new Error(`Kernel error ${result.status}`);
    error.status = result.status;
    error.data = result.data;
    throw error;
  }
  return result.data;
}

export async function proxyKernelStream(req, res, targetUrl, options = {}) {
  const startTime = Date.now();
  const urlPath = targetUrl.replace(/^https?:\/\/[^/]+/, '');
  log('INFO', 'KERNEL-PROXY', `${req.method} ${urlPath} → started`);

  const headers = filterHeaders(req.headers);
  delete headers.host;

  let response;
  try {
    response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : req,
      duplex: "half"
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    log('ERROR', 'KERNEL-PROXY', `${req.method} ${urlPath} → 502 (${duration}ms)`, {
      error: error.message,
      code: error.code || 'UNKNOWN'
    });
    res.writeHead(502, {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders
    });
    res.end(JSON.stringify({ message: "Kernel unavailable" }));
    return;
  }

  const status = response.status;
  const duration = Date.now() - startTime;
  log('INFO', 'KERNEL-PROXY', `${req.method} ${urlPath} → ${status} (${duration}ms)`);

  const responseHeaders = {};
  for (const [key, value] of response.headers.entries()) {
    if (!hopByHopHeaders.has(key.toLowerCase())) {
      responseHeaders[key] = value;
    }
  }

  res.writeHead(response.status, {
    ...responseHeaders,
    ...corsHeaders
  });

  if (typeof options.onComplete === "function") {
    res.on("finish", () => {
      options.onComplete(status);
    });
  }

  if (!response.body) {
    res.end();
    return;
  }

  Readable.fromWeb(response.body).pipe(res);
}

/**
 * Creates or updates a kernel material with DOC truthClass.
 * If material exists, adds artifactId to evidenceRefs and upgrades truthClass to DOC.
 * If material doesn't exist, creates it with DOC truthClass.
 *
 * @param {string} kernelBaseUrl - Base URL for kernel API
 * @param {string} dealId - Deal UUID
 * @param {string} materialType - Material type (e.g., "UnderwritingSummary")
 * @param {string} artifactId - Artifact UUID to link
 * @param {string} fieldPath - Original field path for audit trail
 * @returns {Promise<Object>} Created or updated material
 */
export async function createOrUpdateMaterial(
  kernelBaseUrl,
  dealId,
  materialType,
  artifactId,
  fieldPath
) {
  // 1. Fetch existing materials
  const materials = await kernelFetchJson(
    `${kernelBaseUrl}/deals/${dealId}/materials`
  );

  // 2. Find material of this type
  const existing = materials.find((m) => m.type === materialType);

  if (existing) {
    // 3. Update existing material
    // - Add artifactId to evidenceRefs (avoid duplicates)
    // - Upgrade truthClass to DOC
    const currentRefs = existing.data?.evidenceRefs ?? [];
    const updatedRefs = currentRefs.includes(artifactId)
      ? currentRefs
      : [...currentRefs, artifactId];

    const updated = await kernelFetchJson(
      `${kernelBaseUrl}/deals/${dealId}/materials/${existing.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          truthClass: "DOC",
          evidenceRefs: updatedRefs,
          meta: {
            ...existing.data?.meta,
            updatedBy: "provenance-sync",
            lastSyncedField: fieldPath,
            lastSyncedAt: new Date().toISOString()
          }
        })
      }
    );

    return { action: "updated", material: updated };
  } else {
    // 4. Create new material
    const created = await kernelFetchJson(
      `${kernelBaseUrl}/deals/${dealId}/materials`,
      {
        method: "POST",
        body: JSON.stringify({
          type: materialType,
          truthClass: "DOC",
          evidenceRefs: [artifactId],
          meta: {
            createdBy: "provenance-sync",
            sourceFieldPath: fieldPath,
            createdAt: new Date().toISOString()
          }
        })
      }
    );

    return { action: "created", material: created };
  }
}
