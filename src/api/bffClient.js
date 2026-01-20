import { z } from "zod";
import {
  actionResponseSchema,
  dealSchema,
  dealHomeResponseSchema,
  dealListResponseSchema,
  dealRecordsResponseSchema,
  eventsResponseSchema,
  explainBlockSchema,
  explainResponseSchema,
  llmParseDealResponseSchema,
  llmForceAcceptRequestSchema,
  correctionsRequestSchema,
  dataTrustResponseSchema,
  inboxResponseSchema
} from "@/lib/contracts";
import { createApiError } from "@/lib/api-error";
import { debugLog } from "@/lib/debug";
import {
  ClaimVerifyRequest,
  ConflictResolveRequest,
  DealDraft,
  DealDraftListResponse,
  DocumentMetadata,
  IntakeBroker,
  IntakeClaimVerificationResponse,
  IntakeClaimsResponse,
  IntakeConflict,
  IntakeConflictsResponse,
  IntakeDocumentsUploadResponse,
  IntakePasteResult,
  IntakeSeller,
  IntakeStatsResponse
} from "@/lib/contracts/intake";
import {
  OMGenerateRequest,
  OMRequestChangesRequest,
  OMSectionsResponse,
  OMUpdateSectionRequest,
  OMVersion,
  OMVersionListResponse
} from "@/lib/contracts/om";
import {
  AddRecipientsRequest,
  AddRecipientsResponse,
  BuyerResponse as DistributionBuyerResponse,
  CreateDistributionRequest,
  CreateDistributionResponse,
  DealDistribution,
  DistributionListResponse,
  DistributionRecipient,
  DistributionResponsesResponse,
  RecordViewRequest
} from "@/lib/contracts/distribution";
import {
  BuyerAnonymity,
  BuyerCriteria,
  BuyerCriteriaRequest,
  BuyerDealResponse,
  BuyerInboxResponse,
  BuyerTriageResult
} from "@/lib/contracts/buyer";
import {
  BuyerAuthorization,
  GateAuthorizationResponse,
  GateAuthorizeRequest,
  GateDeclineRequest,
  GateGrantAccessRequest,
  GateProgress,
  GateRecordNDASignedRequest,
  GateReviewQueueResponse,
  GateRevokeRequest
} from "@/lib/contracts/gate";

const API_BASE = "/api";

// Error reporting for dev overlay
let reportApiError = null;
if (import.meta.env.DEV) {
  import('@/components/dev/ApiErrorOverlay').then(module => {
    reportApiError = module.reportApiError;
  }).catch(() => {});
}

// Get auth token from localStorage (set by AuthContext)
function getAuthToken() {
  return localStorage.getItem('auth_token');
}

async function requestJson(path, options = {}) {
  const authToken = getAuthToken();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers ?? {})
  };

  // Add Authorization header if auth token is available
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    headers,
    ...options
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const errorMessage = data?.message || data?.error || `Request failed (${response.status})`;
    const error = new Error(errorMessage);
    error.status = response.status;
    error.data = data;

    debugLog("bff", "Request failed", {
      method: options.method || "GET",
      path,
      status: response.status,
      message: errorMessage
    });

    // Report to dev overlay
    if (reportApiError) {
      reportApiError({
        method: options.method || 'GET',
        path,
        status: response.status,
        message: errorMessage,
        details: data?.details || null,
      });
    }

    throw error;
  }

  return data;
}

function buildQuery(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `?${query}` : "";
}

function parseWithSchema(schema, data, context = {}) {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const debugDetails = {
    schema: context.schemaName || schema?._def?.typeName || "schema",
    issues: result.error.issues
  };

  debugLog("bff", "Contract mismatch", {
    endpoint: context.endpoint,
    schema: debugDetails.schema,
    issueCount: debugDetails.issues?.length ?? 0
  });

  const apiError = createApiError({
    message: "Contract mismatch",
    status: 502,
    endpoint: context.endpoint,
    code: "CONTRACT_MISMATCH",
    userSafeMessage: "We ran into a data issue. Please try again.",
    debugDetails
  });

  if (reportApiError) {
    reportApiError({
      method: context.method || "GET",
      path: context.endpoint || "unknown",
      status: apiError.status,
      message: apiError.message,
      details: debugDetails
    });
  }

  throw apiError;
}

export const bff = {
  home: {
    getData: async () => {
      const data = await requestJson("/home");
      return data;
    }
  },
  newsInsights: {
    list: async (dealId = null) => {
      const params = dealId ? `?dealId=${encodeURIComponent(dealId)}` : '';
      const data = await requestJson(`/news-insights${params}`);
      return data;
    },
    ask: async (insightId, question) => {
      const data = await requestJson("/news-insights/ask", {
        method: "POST",
        body: JSON.stringify({ insightId, question })
      });
      return data;
    },
    dismiss: async (insightId) => {
      const data = await requestJson(`/news-insights/${insightId}/dismiss`, {
        method: "POST",
        body: JSON.stringify({})
      });
      return data;
    }
  },
  deals: {
    list: async () => {
      const path = "/deals";
      const data = await requestJson(path);
      return parseWithSchema(dealListResponseSchema, data, {
        endpoint: path,
        method: "GET",
        schemaName: "dealListResponse"
      });
    },
    create: async (payload) => {
      const path = "/deals";
      const data = await requestJson(path, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      return parseWithSchema(dealSchema, data, {
        endpoint: path,
        method: "POST",
        schemaName: "deal"
      });
    },
    corrections: async (dealId, payload) => {
      const body = correctionsRequestSchema.parse(payload);
      const data = await requestJson(`/deals/${dealId}/corrections`, {
        method: "POST",
        body: JSON.stringify(body)
      });
      return data;
    },
    dataTrust: async (dealId) => {
      const path = `/deals/${dealId}/data-trust`;
      const data = await requestJson(path);
      return parseWithSchema(dataTrustResponseSchema, data, {
        endpoint: path,
        method: "GET",
        schemaName: "dataTrustResponse"
      });
    },
    markDoc: async (dealId, fieldPath, artifactId) => {
      const data = await requestJson(`/deals/${dealId}/provenance`, {
        method: "POST",
        body: JSON.stringify({ fieldPath, artifactId })
      });
      return data;
    },
    home: async (dealId) => {
      const path = `/deals/${dealId}/home`;
      const data = await requestJson(path);
      return parseWithSchema(dealHomeResponseSchema, data, {
        endpoint: path,
        method: "GET",
        schemaName: "dealHomeResponse"
      });
    },
    records: async (dealId) => {
      const path = `/deals/${dealId}/records`;
      const data = await requestJson(path);
      return parseWithSchema(dealRecordsResponseSchema, data, {
        endpoint: path,
        method: "GET",
        schemaName: "dealRecordsResponse"
      });
    },
    explain: async (dealId, actionType, payload = {}) => {
      const path = `/deals/${dealId}/explain`;
      const data = await requestJson(path, {
        method: "POST",
        body: JSON.stringify({ actionType, payload })
      });
      return parseWithSchema(explainResponseSchema, data, {
        endpoint: path,
        method: "POST",
        schemaName: "explainResponse"
      });
    },
    action: async (dealId, actionType) => {
      try {
        const path = `/deals/${dealId}/actions/${actionType}`;
        const data = await requestJson(path, {
          method: "POST",
          body: JSON.stringify({})
        });
        return parseWithSchema(actionResponseSchema, data, {
          endpoint: path,
          method: "POST",
          schemaName: "actionResponse"
        });
      } catch (error) {
        if (error.status === 409 && error.data?.explain) {
          const explain = parseWithSchema(explainBlockSchema, error.data.explain, {
            endpoint: `/deals/${dealId}/actions/${actionType}`,
            method: "POST",
            schemaName: "explainBlock"
          });
          const blocked = new Error("BLOCKED");
          blocked.status = 409;
          blocked.explain = explain;
          throw blocked;
        }
        throw error;
      }
    },
    override: async (dealId, targetAction, reason) => {
      const data = await requestJson(`/deals/${dealId}/events`, {
        method: "POST",
        body: JSON.stringify({
          type: "OverrideAttested",
          payload: {
            action: targetAction,
            reason: reason
          }
        })
      });
      return data;
    },
    draft: {
      start: async (dealId) => {
        const data = await requestJson(`/deals/${dealId}/draft/start`, {
          method: "POST",
          body: JSON.stringify({})
        });
        return data;
      },
      simulateEvent: async (dealId, eventData) => {
        const data = await requestJson(`/deals/${dealId}/draft/simulate-event`, {
          method: "POST",
          body: JSON.stringify(eventData)
        });
        return data;
      },
      gates: async (dealId) => {
        const data = await requestJson(`/deals/${dealId}/draft/gates`);
        return data;
      },
      diff: async (dealId) => {
        const data = await requestJson(`/deals/${dealId}/draft/diff`);
        return data;
      },
      revert: async (dealId) => {
        const data = await requestJson(`/deals/${dealId}/draft/revert`, {
          method: "POST",
          body: JSON.stringify({})
        });
        return data;
      },
      commit: async (dealId) => {
        const data = await requestJson(`/deals/${dealId}/draft/commit`, {
          method: "POST",
          body: JSON.stringify({})
        });
        return data;
      }
    },
    // Deal Assignments (GP Analyst access control)
    assignments: {
      list: async (dealId) => {
        const data = await requestJson(`/deals/${dealId}/assignments`);
        return data;
      },
      assign: async (dealId, userId, userName, role = 'analyst') => {
        const data = await requestJson(`/deals/${dealId}/assignments`, {
          method: "POST",
          body: JSON.stringify({ userId, userName, role })
        });
        return data;
      },
      unassign: async (dealId, userId) => {
        const data = await requestJson(`/deals/${dealId}/assignments/${userId}`, {
          method: "DELETE"
        });
        return data;
      }
    },
    // Review Requests (Analyst → GP approval workflow)
    reviewRequests: {
      // Create a new review request for a deal
      create: async (dealId, message = null) => {
        const data = await requestJson(`/deals/${dealId}/review-requests`, {
          method: "POST",
          body: JSON.stringify({ message })
        });
        return data;
      },
      // Get pending review for a deal (if any)
      getPending: async (dealId) => {
        const data = await requestJson(`/deals/${dealId}/review-requests/pending`);
        return data;
      },
      // Get all review history for a deal
      getHistory: async (dealId) => {
        const data = await requestJson(`/deals/${dealId}/review-requests`);
        return data;
      }
    },
    // Deal Submissions (GP → Lender workflow)
    submissions: {
      // Submit deal to external party (Lender, Counsel)
      create: async (dealId, { recipientEmail, recipientName, recipientRole, message }) => {
        const data = await requestJson(`/deals/${dealId}/submit`, {
          method: "POST",
          body: JSON.stringify({ recipientEmail, recipientName, recipientRole, message })
        });
        return data;
      },
      // List submissions for a deal
      list: async (dealId) => {
        const data = await requestJson(`/deals/${dealId}/submissions`);
        return data;
      },
      // Get a single submission
      get: async (submissionId) => {
        const data = await requestJson(`/submissions/${submissionId}`);
        return data;
      },
      // Resend submission magic link
      resend: async (submissionId) => {
        const data = await requestJson(`/submissions/${submissionId}/resend`, {
          method: "POST",
          body: JSON.stringify({})
        });
        return data;
      },
      // Cancel a submission
      cancel: async (submissionId) => {
        const data = await requestJson(`/submissions/${submissionId}/cancel`, {
          method: "POST",
          body: JSON.stringify({})
        });
        return data;
      }
    }
  },
  dealIntake: {
    createDraft: async (payload) => {
      const path = "/intake/draft";
      const data = await requestJson(path, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      return parseWithSchema(DealDraft, data, {
        endpoint: path,
        method: "POST",
        schemaName: "DealDraft"
      });
    },
    listDrafts: async (params = {}) => {
      const path = `/intake/drafts${buildQuery(params)}`;
      const data = await requestJson(path);
      return parseWithSchema(DealDraftListResponse, data, {
        endpoint: path,
        method: "GET",
        schemaName: "DealDraftListResponse"
      });
    },
    getDraft: async (id) => {
      const path = `/intake/draft/${id}`;
      const data = await requestJson(path);
      return parseWithSchema(DealDraft, data, {
        endpoint: path,
        method: "GET",
        schemaName: "DealDraft"
      });
    },
    uploadDocuments: async (id, documents) => {
      z.array(DocumentMetadata).parse(documents);
      const path = `/intake/draft/${id}/documents`;
      const data = await requestJson(path, {
        method: "POST",
        body: JSON.stringify({ documents })
      });
      return parseWithSchema(IntakeDocumentsUploadResponse, data, {
        endpoint: path,
        method: "POST",
        schemaName: "IntakeDocumentsUploadResponse"
      });
    },
    pasteText: async (id, text, sourceName = null) => {
      const path = `/intake/draft/${id}/paste`;
      const data = await requestJson(path, {
        method: "POST",
        body: JSON.stringify({ text, sourceName })
      });
      return parseWithSchema(IntakePasteResult, data, {
        endpoint: path,
        method: "POST",
        schemaName: "IntakePasteResult"
      });
    },
    addBroker: async (id, broker) => {
      const path = `/intake/draft/${id}/brokers`;
      const data = await requestJson(path, {
        method: "POST",
        body: JSON.stringify(broker)
      });
      return parseWithSchema(IntakeBroker, data, {
        endpoint: path,
        method: "POST",
        schemaName: "IntakeBroker"
      });
    },
    setSeller: async (id, seller) => {
      const path = `/intake/draft/${id}/seller`;
      const data = await requestJson(path, {
        method: "POST",
        body: JSON.stringify(seller)
      });
      return parseWithSchema(IntakeSeller, data, {
        endpoint: path,
        method: "POST",
        schemaName: "IntakeSeller"
      });
    },
    getClaims: async (id, params = {}) => {
      const path = `/intake/draft/${id}/claims${buildQuery(params)}`;
      const data = await requestJson(path);
      return parseWithSchema(IntakeClaimsResponse, data, {
        endpoint: path,
        method: "GET",
        schemaName: "IntakeClaimsResponse"
      });
    },
    verifyClaim: async (draftId, claimId, payload) => {
      ClaimVerifyRequest.parse(payload);
      const path = `/intake/draft/${draftId}/claims/${claimId}/verify`;
      const data = await requestJson(path, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      return parseWithSchema(IntakeClaimVerificationResponse, data, {
        endpoint: path,
        method: "POST",
        schemaName: "IntakeClaimVerificationResponse"
      });
    },
    getConflicts: async (id, status = "OPEN") => {
      const path = `/intake/draft/${id}/conflicts${buildQuery({ status })}`;
      const data = await requestJson(path);
      return parseWithSchema(IntakeConflictsResponse, data, {
        endpoint: path,
        method: "GET",
        schemaName: "IntakeConflictsResponse"
      });
    },
    resolveConflict: async (draftId, conflictId, payload) => {
      ConflictResolveRequest.parse(payload);
      const path = `/intake/draft/${draftId}/conflicts/${conflictId}/resolve`;
      const data = await requestJson(path, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      return parseWithSchema(IntakeConflict, data, {
        endpoint: path,
        method: "POST",
        schemaName: "IntakeConflict"
      });
    },
    advanceStatus: async (id, status) => {
      const path = `/intake/draft/${id}/advance`;
      const data = await requestJson(path, {
        method: "POST",
        body: JSON.stringify({ status })
      });
      return parseWithSchema(DealDraft, data, {
        endpoint: path,
        method: "POST",
        schemaName: "DealDraft"
      });
    },
    getStats: async (id) => {
      const path = `/intake/draft/${id}/stats`;
      const data = await requestJson(path);
      return parseWithSchema(IntakeStatsResponse, data, {
        endpoint: path,
        method: "GET",
        schemaName: "IntakeStatsResponse"
      });
    }
  },
  om: {
    generate: async (dealDraftId, regenerate = false) => {
      OMGenerateRequest.parse({ regenerate });
      const path = `/om/draft/${dealDraftId}/generate`;
      const data = await requestJson(path, {
        method: "POST",
        body: JSON.stringify({ regenerate })
      });
      return parseWithSchema(OMVersion, data, {
        endpoint: path,
        method: "POST",
        schemaName: "OMVersion"
      });
    },
    getLatest: async (dealDraftId) => {
      const path = `/om/draft/${dealDraftId}/latest`;
      const data = await requestJson(path);
      return parseWithSchema(OMVersion, data, {
        endpoint: path,
        method: "GET",
        schemaName: "OMVersion"
      });
    },
    listVersions: async (dealDraftId) => {
      const path = `/om/draft/${dealDraftId}/versions`;
      const data = await requestJson(path);
      return parseWithSchema(OMVersionListResponse, data, {
        endpoint: path,
        method: "GET",
        schemaName: "OMVersionListResponse"
      });
    },
    getVersion: async (omVersionId) => {
      const path = `/om/version/${omVersionId}`;
      const data = await requestJson(path);
      return parseWithSchema(OMVersion, data, {
        endpoint: path,
        method: "GET",
        schemaName: "OMVersion"
      });
    },
    updateSection: async (omVersionId, sectionId, content) => {
      OMUpdateSectionRequest.parse({ content });
      const path = `/om/version/${omVersionId}/section/${sectionId}`;
      const data = await requestJson(path, {
        method: "PUT",
        body: JSON.stringify({ content })
      });
      return parseWithSchema(OMVersion, data, {
        endpoint: path,
        method: "PUT",
        schemaName: "OMVersion"
      });
    },
    brokerApprove: async (omVersionId) => {
      const path = `/om/version/${omVersionId}/broker-approve`;
      const data = await requestJson(path, {
        method: "POST",
        body: JSON.stringify({})
      });
      return parseWithSchema(OMVersion, data, {
        endpoint: path,
        method: "POST",
        schemaName: "OMVersion"
      });
    },
    sellerApprove: async (omVersionId) => {
      const path = `/om/version/${omVersionId}/seller-approve`;
      const data = await requestJson(path, {
        method: "POST",
        body: JSON.stringify({})
      });
      return parseWithSchema(OMVersion, data, {
        endpoint: path,
        method: "POST",
        schemaName: "OMVersion"
      });
    },
    requestChanges: async (omVersionId, feedback) => {
      OMRequestChangesRequest.parse({ feedback });
      const path = `/om/version/${omVersionId}/request-changes`;
      const data = await requestJson(path, {
        method: "POST",
        body: JSON.stringify({ feedback })
      });
      return parseWithSchema(OMVersion, data, {
        endpoint: path,
        method: "POST",
        schemaName: "OMVersion"
      });
    },
    getSections: async () => {
      const path = "/om/sections";
      const data = await requestJson(path);
      return parseWithSchema(OMSectionsResponse, data, {
        endpoint: path,
        method: "GET",
        schemaName: "OMSectionsResponse"
      });
    }
  },
  distribution: {
    create: async (dealDraftId, payload) => {
      CreateDistributionRequest.parse(payload);
      const path = `/distribution/create/${dealDraftId}`;
      const data = await requestJson(path, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      return parseWithSchema(CreateDistributionResponse, data, {
        endpoint: path,
        method: "POST",
        schemaName: "CreateDistributionResponse"
      });
    },
    addRecipients: async (distributionId, recipientIds) => {
      AddRecipientsRequest.parse({ recipientIds });
      const path = `/distribution/${distributionId}/add-recipients`;
      const data = await requestJson(path, {
        method: "POST",
        body: JSON.stringify({ recipientIds })
      });
      return parseWithSchema(AddRecipientsResponse, data, {
        endpoint: path,
        method: "POST",
        schemaName: "AddRecipientsResponse"
      });
    },
    get: async (distributionId) => {
      const path = `/distribution/${distributionId}`;
      const data = await requestJson(path);
      return parseWithSchema(DealDistribution, data, {
        endpoint: path,
        method: "GET",
        schemaName: "DealDistribution"
      });
    },
    getForDeal: async (dealDraftId) => {
      const path = `/distribution/deal/${dealDraftId}`;
      const data = await requestJson(path);
      return parseWithSchema(DistributionListResponse, data, {
        endpoint: path,
        method: "GET",
        schemaName: "DistributionListResponse"
      });
    },
    recordView: async (recipientId, payload) => {
      RecordViewRequest.parse(payload ?? {});
      const path = `/distribution/recipient/${recipientId}/view`;
      const data = await requestJson(path, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      return parseWithSchema(DistributionRecipient, data, {
        endpoint: path,
        method: "POST",
        schemaName: "DistributionRecipient"
      });
    },
    submitResponse: async (dealDraftId, payload) => {
      const path = `/distribution/respond/${dealDraftId}`;
      const data = await requestJson(path, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      return parseWithSchema(DistributionBuyerResponse, data, {
        endpoint: path,
        method: "POST",
        schemaName: "BuyerResponse"
      });
    },
    getResponses: async (dealDraftId) => {
      const path = `/distribution/responses/${dealDraftId}`;
      const data = await requestJson(path);
      return parseWithSchema(DistributionResponsesResponse, data, {
        endpoint: path,
        method: "GET",
        schemaName: "DistributionResponsesResponse"
      });
    }
  },
  buyer: {
    getInbox: async (params = {}) => {
      const path = `/buyer/inbox${buildQuery(params)}`;
      const data = await requestJson(path);
      return parseWithSchema(BuyerInboxResponse, data, {
        endpoint: path,
        method: "GET",
        schemaName: "BuyerInboxResponse"
      });
    },
    getDeal: async (dealDraftId) => {
      const path = `/buyer/deal/${dealDraftId}`;
      const data = await requestJson(path);
      return parseWithSchema(BuyerDealResponse, data, {
        endpoint: path,
        method: "GET",
        schemaName: "BuyerDealResponse"
      });
    },
    getCriteria: async () => {
      const path = "/buyer/criteria";
      const data = await requestJson(path);
      return parseWithSchema(BuyerCriteria.nullable(), data, {
        endpoint: path,
        method: "GET",
        schemaName: "BuyerCriteria"
      });
    },
    updateCriteria: async (criteria) => {
      BuyerCriteriaRequest.parse(criteria);
      const path = "/buyer/criteria";
      const data = await requestJson(path, {
        method: "PUT",
        body: JSON.stringify(criteria)
      });
      return parseWithSchema(BuyerCriteria, data, {
        endpoint: path,
        method: "PUT",
        schemaName: "BuyerCriteria"
      });
    },
    deleteCriteria: async () => {
      const data = await requestJson("/buyer/criteria", {
        method: "DELETE"
      });
      return data;
    },
    scoreDeal: async (dealDraftId) => {
      const path = `/buyer/score/${dealDraftId}`;
      const data = await requestJson(path, {
        method: "POST",
        body: JSON.stringify({})
      });
      return parseWithSchema(BuyerTriageResult, data, {
        endpoint: path,
        method: "POST",
        schemaName: "BuyerTriageResult"
      });
    },
    scoreAllDeals: async () => {
      const path = "/buyer/score-all";
      const data = await requestJson(path, {
        method: "POST",
        body: JSON.stringify({})
      });
      return parseWithSchema(z.array(BuyerTriageResult), data, {
        endpoint: path,
        method: "POST",
        schemaName: "BuyerTriageResult[]"
      });
    },
    getTriage: async (dealDraftId) => {
      const path = `/buyer/triage/${dealDraftId}`;
      const data = await requestJson(path);
      return parseWithSchema(BuyerTriageResult, data, {
        endpoint: path,
        method: "GET",
        schemaName: "BuyerTriageResult"
      });
    },
    submitResponse: async (dealDraftId, payload) => {
      const path = `/buyer/respond/${dealDraftId}`;
      const data = await requestJson(path, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      return parseWithSchema(DistributionBuyerResponse, data, {
        endpoint: path,
        method: "POST",
        schemaName: "BuyerResponse"
      });
    },
    getResponses: async () => {
      const path = "/buyer/responses";
      const data = await requestJson(path);
      return parseWithSchema(DistributionResponsesResponse, data, {
        endpoint: path,
        method: "GET",
        schemaName: "BuyerResponses"
      });
    },
    getAnonymity: async () => {
      const path = "/buyer/anonymity";
      const data = await requestJson(path);
      return parseWithSchema(BuyerAnonymity, data, {
        endpoint: path,
        method: "GET",
        schemaName: "BuyerAnonymity"
      });
    },
    updateAnonymity: async (settings) => {
      const path = "/buyer/anonymity";
      const data = await requestJson(path, {
        method: "PUT",
        body: JSON.stringify(settings)
      });
      return parseWithSchema(BuyerAnonymity, data, {
        endpoint: path,
        method: "PUT",
        schemaName: "BuyerAnonymity"
      });
    }
  },
  gate: {
    getReviewQueue: async (dealDraftId, params = {}) => {
      const path = `/gate/queue/${dealDraftId}${buildQuery(params)}`;
      const data = await requestJson(path);
      return parseWithSchema(GateReviewQueueResponse, data, {
        endpoint: path,
        method: "GET",
        schemaName: "GateReviewQueueResponse"
      });
    },
    authorize: async (dealDraftId, buyerUserId, payload = {}) => {
      GateAuthorizeRequest.parse(payload);
      const path = `/gate/authorize/${dealDraftId}/${buyerUserId}`;
      const data = await requestJson(path, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      return parseWithSchema(BuyerAuthorization, data, {
        endpoint: path,
        method: "POST",
        schemaName: "BuyerAuthorization"
      });
    },
    decline: async (dealDraftId, buyerUserId, reason) => {
      GateDeclineRequest.parse({ reason });
      const path = `/gate/decline/${dealDraftId}/${buyerUserId}`;
      const data = await requestJson(path, {
        method: "POST",
        body: JSON.stringify({ reason })
      });
      return parseWithSchema(BuyerAuthorization, data, {
        endpoint: path,
        method: "POST",
        schemaName: "BuyerAuthorization"
      });
    },
    revoke: async (dealDraftId, buyerUserId, reason) => {
      GateRevokeRequest.parse({ reason });
      const path = `/gate/revoke/${dealDraftId}/${buyerUserId}`;
      const data = await requestJson(path, {
        method: "POST",
        body: JSON.stringify({ reason })
      });
      return parseWithSchema(BuyerAuthorization, data, {
        endpoint: path,
        method: "POST",
        schemaName: "BuyerAuthorization"
      });
    },
    sendNDA: async (dealDraftId, buyerUserId) => {
      const path = `/gate/nda/send/${dealDraftId}/${buyerUserId}`;
      const data = await requestJson(path, {
        method: "POST",
        body: JSON.stringify({})
      });
      return parseWithSchema(BuyerAuthorization, data, {
        endpoint: path,
        method: "POST",
        schemaName: "BuyerAuthorization"
      });
    },
    recordNDASigned: async (dealDraftId, buyerUserId, ndaDocumentId) => {
      GateRecordNDASignedRequest.parse({ ndaDocumentId });
      const path = `/gate/nda/signed/${dealDraftId}/${buyerUserId}`;
      const data = await requestJson(path, {
        method: "POST",
        body: JSON.stringify({ ndaDocumentId })
      });
      return parseWithSchema(BuyerAuthorization, data, {
        endpoint: path,
        method: "POST",
        schemaName: "BuyerAuthorization"
      });
    },
    grantAccess: async (dealDraftId, buyerUserId, accessLevel) => {
      GateGrantAccessRequest.parse({ accessLevel });
      const path = `/gate/access/${dealDraftId}/${buyerUserId}`;
      const data = await requestJson(path, {
        method: "POST",
        body: JSON.stringify({ accessLevel })
      });
      return parseWithSchema(BuyerAuthorization, data, {
        endpoint: path,
        method: "POST",
        schemaName: "BuyerAuthorization"
      });
    },
    getStatus: async (dealDraftId, buyerUserId) => {
      const path = `/gate/status/${dealDraftId}/${buyerUserId}`;
      const data = await requestJson(path);
      return parseWithSchema(GateAuthorizationResponse, data, {
        endpoint: path,
        method: "GET",
        schemaName: "GateAuthorizationResponse"
      });
    },
    getAuthorizations: async (dealDraftId, status = null) => {
      const path = `/gate/authorizations/${dealDraftId}${buildQuery({ status })}`;
      const data = await requestJson(path);
      return parseWithSchema(z.array(BuyerAuthorization), data, {
        endpoint: path,
        method: "GET",
        schemaName: "BuyerAuthorization[]"
      });
    },
    getProgress: async (dealDraftId) => {
      const path = `/gate/progress/${dealDraftId}`;
      const data = await requestJson(path);
      return parseWithSchema(GateProgress, data, {
        endpoint: path,
        method: "GET",
        schemaName: "GateProgress"
      });
    },
    advanceToActiveDD: async (dealDraftId) => {
      const data = await requestJson(`/gate/advance/${dealDraftId}`, {
        method: "POST",
        body: JSON.stringify({})
      });
      return data;
    }
  },
  // Global Review Requests (for GP inbox)
  reviewRequests: {
    // List all review requests (with optional status filter)
    list: async (status = null) => {
      const params = status ? `?status=${encodeURIComponent(status)}` : '';
      const data = await requestJson(`/review-requests${params}`);
      return data;
    },
    // Get a single review request
    get: async (requestId) => {
      const data = await requestJson(`/review-requests/${requestId}`);
      return data;
    },
    // Respond to a review request (GP action)
    respond: async (requestId, action, message = null) => {
      const data = await requestJson(`/review-requests/${requestId}/respond`, {
        method: "POST",
        body: JSON.stringify({ action, message })
      });
      return data;
    }
  },
  events: {
    list: async ({ dealId, order = "desc", limit = 200 } = {}) => {
      const params = new URLSearchParams();
      if (dealId) {
        params.set("dealId", dealId);
      }
      if (order) {
        params.set("order", order);
      }
      if (limit) {
        params.set("limit", String(limit));
      }
      const query = params.toString();
      const path = `/events${query ? `?${query}` : ""}`;
      const data = await requestJson(path);
      return parseWithSchema(eventsResponseSchema, data, {
        endpoint: path,
        method: "GET",
        schemaName: "eventsResponse"
      });
    }
  },
  inbox: {
    list: async (scope = "mine") => {
      const path = `/inbox?scope=${encodeURIComponent(scope)}`;
      const data = await requestJson(path);
      return parseWithSchema(inboxResponseSchema, data, {
        endpoint: path,
        method: "GET",
        schemaName: "inboxResponse"
      });
    }
  },
  llm: {
    parseDeal: async ({ inputText, inputSource }) => {
      try {
        const path = "/llm/parse-deal";
        const data = await requestJson(path, {
          method: "POST",
          body: JSON.stringify({ inputText, inputSource })
        });
        return parseWithSchema(llmParseDealResponseSchema, data, {
          endpoint: path,
          method: "POST",
          schemaName: "llmParseDealResponse"
        });
      } catch (error) {
        // 422 means validation/eval failed but we got valid data back
        if (error.status === 422 && error.data) {
          try {
            return parseWithSchema(llmParseDealResponseSchema, error.data, {
              endpoint: "/llm/parse-deal",
              method: "POST",
              schemaName: "llmParseDealResponse"
            });
          } catch (parseError) {
            console.error("Failed to parse 422 response:", parseError);
            throw new Error("AI parse returned invalid data format");
          }
        }
        throw error;
      }
    },
    forceAccept: async (payload) => {
      const body = llmForceAcceptRequestSchema.parse(payload);
      const data = await requestJson("/llm/parse-deal/force-accept", {
        method: "POST",
        body: JSON.stringify(body)
      });
      return data;
    }
  },
  chat: {
    listConversations: async () => {
      const data = await requestJson("/chat/conversations");
      return data;
    },
    createConversation: async (payload) => {
      const data = await requestJson("/chat/conversations", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      return data;
    },
    getConversation: async (conversationId) => {
      const data = await requestJson(`/chat/conversations/${conversationId}`);
      return data;
    },
    listMessages: async (conversationId, { cursor, limit } = {}) => {
      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);
      if (limit) params.set("limit", String(limit));
      const query = params.toString();
      const data = await requestJson(`/chat/conversations/${conversationId}/messages${query ? `?${query}` : ""}`);
      return data;
    },
    sendMessage: async (conversationId, { content, contentType, parentId, attachments }) => {
      const data = await requestJson(`/chat/conversations/${conversationId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content, contentType, parentId, attachments })
      });
      return data;
    },
    markRead: async (conversationId) => {
      const data = await requestJson(`/chat/conversations/${conversationId}/read`, {
        method: "PATCH",
        body: JSON.stringify({})
      });
      return data;
    },
    joinConversation: async (conversationId) => {
      const data = await requestJson(`/chat/conversations/${conversationId}/join`, {
        method: "POST",
        body: JSON.stringify({})
      });
      return data;
    },
    getUpdates: async (since) => {
      const data = await requestJson(`/chat/updates?since=${encodeURIComponent(since)}`);
      return data;
    },
    getDealThread: async (dealId, dealName) => {
      const params = dealName ? `?dealName=${encodeURIComponent(dealName)}` : '';
      const data = await requestJson(`/chat/deals/${dealId}/thread${params}`);
      return data;
    }
  },
  notifications: {
    list: async ({ unreadOnly, limit } = {}) => {
      const params = new URLSearchParams();
      if (unreadOnly) params.set("unreadOnly", "true");
      if (limit) params.set("limit", String(limit));
      const query = params.toString();
      const data = await requestJson(`/notifications${query ? `?${query}` : ""}`);
      return data;
    },
    markRead: async (notificationId) => {
      const data = await requestJson(`/notifications/${notificationId}/read`, {
        method: "PATCH",
        body: JSON.stringify({})
      });
      return data;
    },
    markAllRead: async () => {
      const data = await requestJson("/notifications/read-all", {
        method: "PATCH",
        body: JSON.stringify({})
      });
      return data;
    },
    snooze: async (notificationId, { duration, until } = {}) => {
      const data = await requestJson(`/notifications/${notificationId}/snooze`, {
        method: "PATCH",
        body: JSON.stringify({ duration, until })
      });
      return data;
    },
    dismiss: async (notificationId, { reason } = {}) => {
      const data = await requestJson(`/notifications/${notificationId}/dismiss`, {
        method: "PATCH",
        body: JSON.stringify({ reason })
      });
      return data;
    }
  },
  notificationPreferences: {
    get: async () => {
      const data = await requestJson("/notification-preferences");
      return data;
    },
    update: async (preferences) => {
      const data = await requestJson("/notification-preferences", {
        method: "PATCH",
        body: JSON.stringify(preferences)
      });
      return data;
    }
  },
  activityFeed: {
    get: async ({ limit, dealId } = {}) => {
      const params = new URLSearchParams();
      if (limit) params.set("limit", String(limit));
      if (dealId) params.set("dealId", dealId);
      const query = params.toString();
      const data = await requestJson(`/activity-feed${query ? `?${query}` : ""}`);
      return data;
    }
  },
  tasks: {
    list: async ({ status, dealId, assignedToMe, limit } = {}) => {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (dealId) params.set("dealId", dealId);
      if (assignedToMe) params.set("assignedToMe", "true");
      if (limit) params.set("limit", String(limit));
      const query = params.toString();
      const data = await requestJson(`/tasks${query ? `?${query}` : ""}`);
      return data;
    },
    create: async (payload) => {
      const data = await requestJson("/tasks", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      return data;
    },
    update: async (taskId, payload) => {
      const data = await requestJson(`/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      return data;
    }
  },
  aiAssistant: {
    ask: async ({ question, conversationId, dealId }) => {
      const data = await requestJson("/ai-assistant/ask", {
        method: "POST",
        body: JSON.stringify({ question, conversationId, dealId })
      });
      return data;
    },
    getSuggestions: async () => {
      const data = await requestJson("/ai-assistant/suggestions");
      return data;
    }
  },
  // Email-to-Deal Integration
  emailIntake: {
    // List email intakes (admin view)
    list: async (status = null) => {
      const params = status ? `?status=${encodeURIComponent(status)}` : '';
      const data = await requestJson(`/email-intake${params}`);
      return data;
    },
    // Get single email intake details
    get: async (intakeId) => {
      const data = await requestJson(`/email-intake/${intakeId}`);
      return data;
    },
    // Retry failed email intake
    retry: async (intakeId) => {
      const data = await requestJson(`/email-intake/${intakeId}/retry`, {
        method: "POST",
        body: JSON.stringify({})
      });
      return data;
    },
    // Simulate email intake (for testing without SendGrid)
    simulate: async ({ from, subject, text, attachments = [] }) => {
      const data = await requestJson("/email-intake/simulate", {
        method: "POST",
        body: JSON.stringify({ from, subject, text, attachments })
      });
      return data;
    }
  },

  // Underwriting Intelligence
  underwriting: {
    // Get underwriting model for a deal
    getModel: async (dealId) => {
      const data = await requestJson(`/deals/${dealId}/underwriting`);
      return data;
    },
    // Update underwriting model inputs
    updateModel: async (dealId, updates) => {
      const data = await requestJson(`/deals/${dealId}/underwriting`, {
        method: "PATCH",
        body: JSON.stringify(updates)
      });
      return data;
    },
    // Recalculate model returns
    calculate: async (dealId) => {
      const data = await requestJson(`/deals/${dealId}/underwriting/calculate`, {
        method: "POST",
        body: JSON.stringify({})
      });
      return data;
    },

    // Document Extractions
    listExtractions: async (dealId) => {
      const data = await requestJson(`/deals/${dealId}/extractions`);
      return data;
    },
    extractDocument: async (dealId, { artifactId, documentType }) => {
      const data = await requestJson(`/deals/${dealId}/extract`, {
        method: "POST",
        body: JSON.stringify({ artifactId, documentType })
      });
      return data;
    },
    applyExtraction: async (dealId, extractionId) => {
      const data = await requestJson(`/deals/${dealId}/underwriting/apply-extraction`, {
        method: "POST",
        body: JSON.stringify({ extractionId })
      });
      return data;
    },

    // Conflicts
    listConflicts: async (dealId, status = null) => {
      const params = status ? `?status=${encodeURIComponent(status)}` : '';
      const data = await requestJson(`/deals/${dealId}/conflicts${params}`);
      return data;
    },
    resolveConflict: async (dealId, conflictId, { resolution, note }) => {
      const data = await requestJson(`/deals/${dealId}/conflicts/${conflictId}/resolve`, {
        method: "POST",
        body: JSON.stringify({ resolution, note })
      });
      return data;
    },

    // Scenarios
    listScenarios: async (dealId) => {
      const data = await requestJson(`/deals/${dealId}/scenarios`);
      return data;
    },
    createScenario: async (dealId, { name, description, assumptions }) => {
      const data = await requestJson(`/deals/${dealId}/scenarios`, {
        method: "POST",
        body: JSON.stringify({ name, description, assumptions })
      });
      return data;
    },
    updateScenario: async (dealId, scenarioId, updates) => {
      const data = await requestJson(`/deals/${dealId}/scenarios/${scenarioId}`, {
        method: "PATCH",
        body: JSON.stringify(updates)
      });
      return data;
    },
    deleteScenario: async (dealId, scenarioId) => {
      const data = await requestJson(`/deals/${dealId}/scenarios/${scenarioId}`, {
        method: "DELETE"
      });
      return data;
    },
    compareScenarios: async (dealId) => {
      const data = await requestJson(`/deals/${dealId}/scenarios/compare`);
      return data;
    },

    // IC Memo
    getMemo: async (dealId) => {
      const data = await requestJson(`/deals/${dealId}/memo`);
      return data;
    },
    generateMemo: async (dealId) => {
      const data = await requestJson(`/deals/${dealId}/memo/generate`, {
        method: "POST",
        body: JSON.stringify({})
      });
      return data;
    },
    updateMemo: async (dealId, { content, analystNotes }) => {
      const data = await requestJson(`/deals/${dealId}/memo`, {
        method: "PATCH",
        body: JSON.stringify({ content, analystNotes })
      });
      return data;
    },

    // Year-by-Year Cash Flows
    getCashFlows: async (dealId, years = null) => {
      const params = years ? `?years=${years}` : '';
      const data = await requestJson(`/deals/${dealId}/underwriting/cash-flows${params}`);
      return data;
    },
    getScenarioCashFlows: async (dealId, assumptions) => {
      const data = await requestJson(`/deals/${dealId}/underwriting/cash-flows/scenario`, {
        method: "POST",
        body: JSON.stringify({ assumptions })
      });
      return data;
    },

    // Input Provenance
    getInputProvenance: async (dealId) => {
      const data = await requestJson(`/deals/${dealId}/inputs/provenance`);
      return data;
    },
    getInputHistory: async (dealId, fieldPath) => {
      const data = await requestJson(`/deals/${dealId}/inputs/${encodeURIComponent(fieldPath)}/history`);
      return data;
    },

    // Equity Waterfall
    getWaterfall: async (dealId) => {
      const data = await requestJson(`/deals/${dealId}/waterfall`);
      return data;
    },
    createWaterfall: async (dealId, structure) => {
      const data = await requestJson(`/deals/${dealId}/waterfall`, {
        method: "POST",
        body: JSON.stringify(structure)
      });
      return data;
    },
    updateWaterfall: async (dealId, updates) => {
      const data = await requestJson(`/deals/${dealId}/waterfall`, {
        method: "PATCH",
        body: JSON.stringify(updates)
      });
      return data;
    },
    calculateWaterfall: async (dealId, scenarioId = null) => {
      const data = await requestJson(`/deals/${dealId}/waterfall/calculate`, {
        method: "POST",
        body: JSON.stringify({ scenarioId })
      });
      return data;
    },
    listWaterfallDistributions: async (dealId) => {
      const data = await requestJson(`/deals/${dealId}/waterfall/distributions`);
      return data;
    },
    compareWaterfalls: async (dealId) => {
      const data = await requestJson(`/deals/${dealId}/waterfall/compare`, {
        method: "POST",
        body: JSON.stringify({})
      });
      return data;
    },

    // Sensitivity Analysis
    getSensitivityOptions: async (dealId) => {
      const data = await requestJson(`/deals/${dealId}/sensitivity/options`);
      return data;
    },
    calculateSensitivityMatrix: async (dealId, xField, yField, outputMetric, options = {}) => {
      const data = await requestJson(`/deals/${dealId}/sensitivity/matrix`, {
        method: "POST",
        body: JSON.stringify({ xField, yField, outputMetric, ...options })
      });
      return data;
    },
    getHoldPeriodSensitivity: async (dealId, maxYears = 10) => {
      const data = await requestJson(`/deals/${dealId}/sensitivity/hold-period?maxYears=${maxYears}`);
      return data;
    },
    getQuickSensitivity: async (dealId) => {
      const data = await requestJson(`/deals/${dealId}/sensitivity/quick`);
      return data;
    },
    createScenarioFromSensitivity: async (dealId, xField, xValue, yField, yValue, customName = null) => {
      const data = await requestJson(`/deals/${dealId}/sensitivity/create-scenario`, {
        method: "POST",
        body: JSON.stringify({ xField, xValue, yField, yValue, customName })
      });
      return data;
    },

    // Excel Import
    getMappableFields: async () => {
      const data = await requestJson("/excel/mappable-fields");
      return data;
    },
    listExcelImports: async (dealId) => {
      const data = await requestJson(`/deals/${dealId}/excel-imports`);
      return data;
    },
    getExcelImport: async (importId) => {
      const data = await requestJson(`/excel-imports/${importId}`);
      return data;
    },
    applyExcelImport: async (importId) => {
      const data = await requestJson(`/excel-imports/${importId}/apply`, {
        method: "POST",
        body: JSON.stringify({})
      });
      return data;
    },
    updateExcelMappings: async (importId, mappings) => {
      const data = await requestJson(`/excel-imports/${importId}/mappings`, {
        method: "PATCH",
        body: JSON.stringify({ mappings })
      });
      return data;
    },

    // Excel Export
    getExportTemplates: async () => {
      const data = await requestJson("/excel/templates");
      return data;
    },
    exportToExcel: async (dealId, options = {}) => {
      // Build query params
      const params = new URLSearchParams();
      if (options.template) params.set('template', options.template);
      if (options.formulas !== undefined) params.set('formulas', options.formulas);
      if (options.waterfall !== undefined) params.set('waterfall', options.waterfall);
      if (options.sensitivity !== undefined) params.set('sensitivity', options.sensitivity);
      if (options.xAxis) params.set('xAxis', options.xAxis);
      if (options.yAxis) params.set('yAxis', options.yAxis);
      if (options.metric) params.set('metric', options.metric);

      const queryString = params.toString();
      const url = `/deals/${dealId}/excel-export${queryString ? '?' + queryString : ''}`;

      // For file download, we need to handle the blob response
      const authToken = getAuthToken();
      const headers = {};
      if (authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      }
      const response = await fetch(`${API_BASE}${url}`, { headers });
      if (!response.ok) {
        const text = await response.text();
        let error;
        try {
          error = JSON.parse(text);
        } catch {
          error = { message: text };
        }
        throw new Error(error.message || 'Export failed');
      }

      // Return the blob for download
      const blob = await response.blob();
      const filename = response.headers.get('Content-Disposition')
        ?.match(/filename="([^"]+)"/)?.[1] || 'underwriting-model.xlsx';

      return { blob, filename };
    },
    // Helper to trigger download
    downloadExcel: async (dealId, options = {}) => {
      const { blob, filename } = await bff.underwriting.exportToExcel(dealId, options);

      // Create download link
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      return { filename };
    }
  },

  // Deal AI - Context-aware chat, insights, and summaries
  dealAI: {
    // Send a message to the deal-aware AI chat
    chat: async (dealId, { message, conversationHistory = [] }) => {
      const data = await requestJson(`/deals/${dealId}/chat`, {
        method: "POST",
        body: JSON.stringify({ message, conversationHistory })
      });
      return data;
    },
    // Get chat history for a deal
    getChatHistory: async (dealId, { limit = 50 } = {}) => {
      const params = limit ? `?limit=${limit}` : '';
      const data = await requestJson(`/deals/${dealId}/chat/history${params}`);
      return data;
    },
    // Get auto-generated insights for a deal
    getInsights: async (dealId) => {
      const data = await requestJson(`/deals/${dealId}/insights`);
      return data;
    },
    // Get full deal context (for debugging/advanced use)
    getContext: async (dealId) => {
      const data = await requestJson(`/deals/${dealId}/context`);
      return data;
    },
    // Generate executive summary for a deal
    summarize: async (dealId) => {
      const data = await requestJson(`/deals/${dealId}/summarize`, {
        method: "POST",
        body: JSON.stringify({})
      });
      return data;
    },
    // Generate complete deal package (model, memo, summary, provenance)
    exportPackage: async (dealId) => {
      const data = await requestJson(`/deals/${dealId}/export-package`, {
        method: "POST",
        body: JSON.stringify({})
      });
      return data;
    }
  },

  // Verification Queue - Extraction claim verification
  verificationQueue: {
    // Get all claims for a deal
    getClaims: async (dealId, { status, fieldPath, documentId, limit } = {}) => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (fieldPath) params.set('fieldPath', fieldPath);
      if (documentId) params.set('documentId', documentId);
      if (limit) params.set('limit', String(limit));
      const query = params.toString();
      const data = await requestJson(`/deals/${dealId}/claims${query ? `?${query}` : ''}`);
      return data;
    },
    // Get pending claims for verification queue
    getPendingClaims: async (dealId, { sortBy, order, documentType } = {}) => {
      const params = new URLSearchParams();
      if (sortBy) params.set('sortBy', sortBy);
      if (order) params.set('order', order);
      if (documentType) params.set('documentType', documentType);
      const query = params.toString();
      const data = await requestJson(`/deals/${dealId}/claims/pending${query ? `?${query}` : ''}`);
      return data;
    },
    // Get verification statistics
    getStats: async (dealId) => {
      const data = await requestJson(`/deals/${dealId}/claims/stats`);
      return data;
    },
    // Get a single claim
    getClaim: async (claimId) => {
      const data = await requestJson(`/claims/${claimId}`);
      return data;
    },
    // Verify (approve) a claim
    verifyClaim: async (claimId, { correctedValue } = {}) => {
      const data = await requestJson(`/claims/${claimId}/verify`, {
        method: "POST",
        body: JSON.stringify({ correctedValue })
      });
      return data;
    },
    // Reject a claim
    rejectClaim: async (claimId, reason) => {
      const data = await requestJson(`/claims/${claimId}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason })
      });
      return data;
    },
    // Bulk verify claims
    bulkVerify: async (dealId, { claimIds, minConfidence }) => {
      const data = await requestJson(`/deals/${dealId}/claims/bulk-verify`, {
        method: "POST",
        body: JSON.stringify({ claimIds, minConfidence })
      });
      return data;
    },
    // Bulk reject claims
    bulkReject: async (dealId, { claimIds, reason }) => {
      const data = await requestJson(`/deals/${dealId}/claims/bulk-reject`, {
        method: "POST",
        body: JSON.stringify({ claimIds, reason })
      });
      return data;
    },
    // Get claim history for a field
    getFieldHistory: async (dealId, fieldPath) => {
      const data = await requestJson(`/deals/${dealId}/claims/field/${encodeURIComponent(fieldPath)}/history`);
      return data;
    }
  },

  // Deal State Machine - Workflow management
  dealState: {
    // Get current deal state
    getState: async (dealId) => {
      const data = await requestJson(`/deals/${dealId}/state`);
      return data;
    },
    // Get available transitions
    getTransitions: async (dealId) => {
      const data = await requestJson(`/deals/${dealId}/state/transitions`);
      return data;
    },
    // Get current blockers
    getBlockers: async (dealId) => {
      const data = await requestJson(`/deals/${dealId}/state/blockers`);
      return data;
    },
    // Perform state transition
    transition: async (dealId, { toState, reason, approvals, force }) => {
      const data = await requestJson(`/deals/${dealId}/state/transition`, {
        method: "POST",
        body: JSON.stringify({ toState, reason, approvals, force })
      });
      return data;
    },
    // Get event history
    getEvents: async (dealId, { limit, eventType } = {}) => {
      const params = new URLSearchParams();
      if (limit) params.set('limit', String(limit));
      if (eventType) params.set('eventType', eventType);
      const query = params.toString();
      const data = await requestJson(`/deals/${dealId}/events${query ? `?${query}` : ''}`);
      return data;
    },
    // Get single event
    getEvent: async (dealId, eventId) => {
      const data = await requestJson(`/deals/${dealId}/events/${eventId}`);
      return data;
    },
    // Verify event chain integrity
    verifyChain: async (dealId) => {
      const data = await requestJson(`/deals/${dealId}/events/verify-chain`);
      return data;
    },
    // Get all valid states
    getValidStates: async () => {
      const data = await requestJson('/states');
      return data;
    },
    // Get all roles
    getRoles: async () => {
      const data = await requestJson('/roles');
      return data;
    }
  },

  // Document Generation - Generate, manage, and export deal documents
  documents: {
    // Generate a new document
    generate: async (dealId, { documentType, watermark, status }) => {
      const data = await requestJson(`/deals/${dealId}/documents/generate`, {
        method: "POST",
        body: JSON.stringify({ documentType, watermark, status })
      });
      return data;
    },
    // Get all document versions
    getVersions: async (dealId, documentType = null) => {
      const params = documentType ? `?documentType=${encodeURIComponent(documentType)}` : '';
      const data = await requestJson(`/deals/${dealId}/documents${params}`);
      return data;
    },
    // Get latest versions
    getLatest: async (dealId) => {
      const data = await requestJson(`/deals/${dealId}/documents/latest`);
      return data;
    },
    // Get versions of specific document type
    getTypeVersions: async (dealId, documentType) => {
      const data = await requestJson(`/deals/${dealId}/documents/${documentType}/versions`);
      return data;
    },
    // Get document version details
    getVersion: async (versionId) => {
      const data = await requestJson(`/documents/${versionId}`);
      return data;
    },
    // Promote document status
    promote: async (versionId, toStatus) => {
      const data = await requestJson(`/documents/${versionId}/promote`, {
        method: "POST",
        body: JSON.stringify({ toStatus })
      });
      return data;
    },
    // Get document provenance
    getProvenance: async (versionId) => {
      const data = await requestJson(`/documents/${versionId}/provenance`);
      return data;
    },
    // Get available document types
    getDocumentTypes: async () => {
      const data = await requestJson('/document-types');
      return data;
    },
    // Download PDF
    downloadPDF: async (versionId) => {
      const authToken = getAuthToken();
      const headers = {};
      if (authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      }
      const response = await fetch(`${API_BASE}/documents/${versionId}/pdf`, { headers });
      if (!response.ok) {
        const text = await response.text();
        let error;
        try {
          error = JSON.parse(text);
        } catch {
          error = { message: text };
        }
        throw new Error(error.message || 'Download failed');
      }
      const blob = await response.blob();
      const filename = response.headers.get('Content-Disposition')
        ?.match(/filename="([^"]+)"/)?.[1] || 'document.pdf';
      return { blob, filename };
    }
  },

  // Evidence Packs - Generate audit-ready document bundles
  evidencePacks: {
    // Generate a new evidence pack
    generate: async (dealId, packType) => {
      const data = await requestJson(`/deals/${dealId}/evidence-pack/generate`, {
        method: "POST",
        body: JSON.stringify({ packType })
      });
      return data;
    },
    // List evidence packs for a deal
    list: async (dealId, packType = null) => {
      const params = packType ? `?packType=${encodeURIComponent(packType)}` : '';
      const data = await requestJson(`/deals/${dealId}/evidence-packs${params}`);
      return data;
    },
    // Get pack details
    get: async (packId) => {
      const data = await requestJson(`/evidence-packs/${packId}`);
      return data;
    },
    // Validate pack integrity
    validate: async (packId) => {
      const data = await requestJson(`/evidence-packs/${packId}/validate`, {
        method: "POST",
        body: JSON.stringify({})
      });
      return data;
    },
    // Download pack ZIP
    download: async (packId) => {
      const authToken = getAuthToken();
      const headers = {};
      if (authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      }
      const response = await fetch(`${API_BASE}/evidence-packs/${packId}/download`, { headers });
      if (!response.ok) {
        const text = await response.text();
        let error;
        try {
          error = JSON.parse(text);
        } catch {
          error = { message: text };
        }
        throw new Error(error.message || 'Download failed');
      }
      const blob = await response.blob();
      const filename = response.headers.get('Content-Disposition')
        ?.match(/filename="([^"]+)"/)?.[1] || 'evidence-pack.zip';
      return { blob, filename };
    },
    // Get available pack types
    getPackTypes: async () => {
      const data = await requestJson('/evidence-pack-types');
      return data;
    }
  },

  // Sector-Specific Underwriting
  sectors: {
    // Get all available property sectors
    getAll: async () => {
      const data = await requestJson("/sectors");
      return data;
    },
    // Get full configuration for a specific sector
    getConfig: async (sectorCode) => {
      const data = await requestJson(`/sectors/${sectorCode}`);
      return data;
    },
    // Get input fields for a sector
    getInputs: async (sectorCode) => {
      const data = await requestJson(`/sectors/${sectorCode}/inputs`);
      return data;
    },
    // Get benchmarks for a sector
    getBenchmarks: async (sectorCode) => {
      const data = await requestJson(`/sectors/${sectorCode}/benchmarks`);
      return data;
    },
    // Get risk factors for a sector
    getRisks: async (sectorCode) => {
      const data = await requestJson(`/sectors/${sectorCode}/risks`);
      return data;
    },
    // Detect sector from deal data
    detectSector: async (dealId) => {
      const data = await requestJson(`/deals/${dealId}/detect-sector`, {
        method: "POST",
        body: JSON.stringify({})
      });
      return data;
    },
    // Get sector-specific metrics for a deal
    getMetrics: async (dealId, forceSector = null) => {
      const params = forceSector ? `?sector=${encodeURIComponent(forceSector)}` : '';
      const data = await requestJson(`/deals/${dealId}/sector-metrics${params}`);
      return data;
    },
    // Update sector-specific inputs for a deal
    updateInputs: async (dealId, sector, inputs) => {
      const data = await requestJson(`/deals/${dealId}/sector-inputs`, {
        method: "PATCH",
        body: JSON.stringify({ sector, inputs })
      });
      return data;
    },
    // Validate deal metrics against sector benchmarks
    validateBenchmarks: async (dealId, sector = null, metrics = null) => {
      const data = await requestJson(`/deals/${dealId}/validate-benchmarks`, {
        method: "POST",
        body: JSON.stringify({ sector, metrics })
      });
      return data;
    }
  }
};
