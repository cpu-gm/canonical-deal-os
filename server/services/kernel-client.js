/**
 * Kernel Client
 *
 * Helper for fetching Deal and Artifact data from the kernel API.
 * The kernel is the system of record for Deal/Artifact data.
 *
 * This module provides a centralized way to access kernel data,
 * replacing direct Prisma Deal/Artifact model calls which
 * don't exist in the BFF schema.
 */

export const KERNEL_API_URL = process.env.KERNEL_API_URL || 'http://localhost:3001';

/**
 * Fetch JSON from kernel with error handling
 */
export async function kernelFetch(path, options = {}) {
  const url = `${KERNEL_API_URL}${path}`;

  try {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    });

    if (!response.ok) {
      const error = new Error(`Kernel request failed: ${response.status} ${response.statusText}`);
      error.status = response.status;
      error.url = url;
      throw error;
    }

    return response.json();
  } catch (error) {
    if (error.status) {
      throw error;
    }
    // Network error
    const networkError = new Error(`Kernel unavailable: ${error.message}`);
    networkError.type = 'KERNEL_UNAVAILABLE';
    networkError.originalError = error;
    throw networkError;
  }
}

/**
 * Get deal by ID from kernel
 * @param {string} dealId - The deal ID
 * @returns {Promise<Object>} Deal data
 */
export async function getDeal(dealId) {
  return kernelFetch(`/deals/${dealId}`);
}

/**
 * Get deal snapshot (aggregated state)
 * @param {string} dealId - The deal ID
 * @returns {Promise<Object>} Deal snapshot
 */
export async function getDealSnapshot(dealId) {
  return kernelFetch(`/deals/${dealId}/snapshot`);
}

/**
 * Get artifacts for a deal
 * @param {string} dealId - The deal ID
 * @param {string} [artifactType] - Optional filter by type
 * @returns {Promise<Array>} Array of artifacts
 */
export async function getArtifacts(dealId, artifactType = null) {
  let path = `/deals/${dealId}/artifacts`;
  if (artifactType) {
    path += `?type=${encodeURIComponent(artifactType)}`;
  }

  try {
    return await kernelFetch(path);
  } catch (error) {
    if (error.status === 404) {
      return [];
    }
    throw error;
  }
}

/**
 * Get a specific artifact by ID
 * @param {string} dealId - The deal ID
 * @param {string} artifactId - The artifact ID
 * @returns {Promise<Object>} Artifact data
 */
export async function getArtifact(dealId, artifactId) {
  return kernelFetch(`/deals/${dealId}/artifacts/${artifactId}`);
}

/**
 * Get deal events
 * @param {string} dealId - The deal ID
 * @param {Object} [options] - Query options
 * @param {number} [options.limit] - Max events to return
 * @param {string} [options.type] - Filter by event type
 * @returns {Promise<Array>} Array of events
 */
export async function getDealEvents(dealId, options = {}) {
  let path = `/deals/${dealId}/events`;
  const params = new URLSearchParams();

  if (options.limit) params.set('limit', options.limit.toString());
  if (options.type) params.set('type', options.type);

  if (params.toString()) {
    path += `?${params.toString()}`;
  }

  try {
    return await kernelFetch(path);
  } catch (error) {
    if (error.status === 404) {
      return [];
    }
    throw error;
  }
}

/**
 * Get deal materials (documents)
 * @param {string} dealId - The deal ID
 * @returns {Promise<Array>} Array of materials
 */
export async function getDealMaterials(dealId) {
  try {
    return await kernelFetch(`/deals/${dealId}/materials`);
  } catch (error) {
    if (error.status === 404) {
      return [];
    }
    throw error;
  }
}

/**
 * Get deal actors
 * @param {string} dealId - The deal ID
 * @returns {Promise<Array>} Array of actors
 */
export async function getDealActors(dealId) {
  try {
    return await kernelFetch(`/deals/${dealId}/actors`);
  } catch (error) {
    if (error.status === 404) {
      return [];
    }
    throw error;
  }
}

/**
 * Build a comprehensive deal context for document generation
 * Aggregates data from multiple kernel endpoints
 * @param {string} dealId - The deal ID
 * @returns {Promise<Object>} Aggregated deal context
 */
export async function buildDealContext(dealId) {
  const [deal, snapshot, artifacts, events, materials] = await Promise.all([
    getDeal(dealId),
    getDealSnapshot(dealId).catch(() => null),
    getArtifacts(dealId),
    getDealEvents(dealId, { limit: 100 }),
    getDealMaterials(dealId)
  ]);

  return {
    deal,
    snapshot,
    artifacts,
    events,
    materials,
    // Convenience accessors
    dealId: deal.id,
    dealName: deal.name,
    dealType: deal.type,
    createdAt: deal.createdAt,
    updatedAt: deal.updatedAt
  };
}

/**
 * Check if kernel is available
 * @returns {Promise<boolean>}
 */
export async function isKernelAvailable() {
  try {
    await kernelFetch('/health');
    return true;
  } catch {
    return false;
  }
}

// Default export for backward compatibility
export default {
  KERNEL_API_URL,
  kernelFetch,
  getDeal,
  getDealSnapshot,
  getArtifacts,
  getArtifact,
  getDealEvents,
  getDealMaterials,
  getDealActors,
  buildDealContext,
  isKernelAvailable
};
