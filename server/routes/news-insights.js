/**
 * News Insights Route
 *
 * Provides AI-curated news feed tailored to the user's role and portfolio.
 * Initially uses mock data, with infrastructure for real news sources later.
 */

import { getPrisma } from "../db.js";
import { readStore } from "../store.js";
import { getCache, setCache } from "../runtime.js";
import {
  getMockNewsForRole,
  getMockNewsForDeal,
  getMockFollowupAnswer
} from "../mocks/news-insights.js";

const NEWS_CACHE_TTL_MS = Number(process.env.BFF_NEWS_TTL_MS ?? 300000); // 5 minutes
const USE_MOCK_DATA = process.env.NEWS_USE_MOCK !== 'false';

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, message, details) {
  sendJson(res, status, { message, details: details ?? null });
}

/**
 * Get news insights for homepage (portfolio-wide)
 *
 * GET /api/news-insights
 * Query params:
 *   - dealId (optional): Filter to deal-specific news
 *   - limit (optional): Number of items (default 10)
 */
/**
 * SECURITY: authUser is required and must come from validated JWT at dispatch level
 */
export async function handleNewsInsights(req, res, authUser) {
  if (!authUser) {
    return sendJson(res, 401, { message: "Not authenticated" });
  }
  const url = new URL(req.url, "http://localhost");
  const dealId = url.searchParams.get("dealId");
  const limit = parseInt(url.searchParams.get("limit") || "10", 10);
  // SECURITY: Use validated authUser instead of spoofable headers
  const role = authUser.role;

  const cacheKey = `news:${role}:${dealId || 'portfolio'}:${limit}`;

  // Check cache
  const cached = getCache(cacheKey);
  if (cached) {
    return sendJson(res, 200, cached);
  }

  try {
    let insights = [];

    if (USE_MOCK_DATA) {
      // Use mock data for initial development
      if (dealId) {
        // Get deal profile for context
        const store = await readStore();
        const dealProfile = store.dealProfiles?.find(p => p.dealId === dealId);
        const profile = dealProfile?.profile || {};

        const mockNews = getMockNewsForDeal(dealId, profile);
        insights = mockNews.map(insight => ({
          ...insight,
          roleSpecificInsight: insight.roleSpecificInsights?.[role] || insight.roleSpecificInsights?.GP
        }));
      } else {
        insights = getMockNewsForRole(role);
      }
    } else {
      // Production: Fetch from real news sources
      // TODO: Implement real news fetching
      insights = getMockNewsForRole(role);
    }

    const response = {
      insights: insights.slice(0, limit),
      lastUpdated: new Date().toISOString(),
      role,
      dealId: dealId || null,
      _mock: USE_MOCK_DATA
    };

    // Cache the response
    setCache(cacheKey, response, NEWS_CACHE_TTL_MS);

    return sendJson(res, 200, response);

  } catch (error) {
    console.error("[NewsInsights] Error fetching news:", error);
    return sendError(res, 500, "Failed to fetch news insights", error.message);
  }
}

/**
 * Ask a follow-up question about a news insight
 *
 * POST /api/news-insights/ask
 * Body: { insightId, question }
 * SECURITY: authUser is required and must come from validated JWT at dispatch level
 */
export async function handleNewsAsk(req, res, readJsonBody, authUser) {
  if (!authUser) {
    return sendJson(res, 401, { message: "Not authenticated" });
  }

  const body = await readJsonBody(req);

  if (!body) {
    return sendError(res, 400, "Request body required");
  }

  const { insightId, question } = body;

  if (!insightId) {
    return sendError(res, 400, "insightId is required");
  }

  if (!question || typeof question !== 'string' || question.trim().length === 0) {
    return sendError(res, 400, "question is required");
  }

  // SECURITY: Use validated authUser instead of spoofable headers
  const userId = authUser.id;
  const role = authUser.role;

  try {
    const prisma = getPrisma();

    // Get portfolio context for more relevant answers
    const store = await readStore();
    const portfolioContext = {
      dealCount: store.dealIndex?.length || 0,
      deals: store.dealIndex?.slice(0, 5).map(d => d.name) || []
    };

    let answer, sources;

    if (USE_MOCK_DATA) {
      // Use mock follow-up answers
      const mockResponse = getMockFollowupAnswer(insightId, question, role, portfolioContext);
      answer = mockResponse.answer;
      sources = mockResponse.sources;
    } else {
      // Production: Call LLM for intelligent response
      // TODO: Implement LLM-based follow-up
      const mockResponse = getMockFollowupAnswer(insightId, question, role, portfolioContext);
      answer = mockResponse.answer;
      sources = mockResponse.sources;
    }

    // Log the interaction
    try {
      await prisma.newsInteraction.create({
        data: {
          insightId,
          userId,
          action: 'asked',
          question: question.trim(),
          answer
        }
      });
    } catch (dbError) {
      // Don't fail the request if logging fails
      console.error("[NewsInsights] Failed to log interaction:", dbError.message);
    }

    return sendJson(res, 200, {
      answer,
      sources,
      insightId,
      question: question.trim(),
      role,
      timestamp: new Date().toISOString(),
      _mock: USE_MOCK_DATA
    });

  } catch (error) {
    console.error("[NewsInsights] Error processing follow-up:", error);
    return sendError(res, 500, "Failed to process question", error.message);
  }
}

/**
 * Dismiss a news insight (hide from feed)
 *
 * POST /api/news-insights/:insightId/dismiss
 */
export async function handleNewsDismiss(req, res, insightId, resolveUserId) {
  const userId = resolveUserId(req);

  try {
    const prisma = getPrisma();

    // Log the dismissal
    await prisma.newsInteraction.create({
      data: {
        insightId,
        userId,
        action: 'dismissed'
      }
    });

    return sendJson(res, 200, {
      success: true,
      insightId,
      action: 'dismissed'
    });

  } catch (error) {
    console.error("[NewsInsights] Error dismissing insight:", error);
    return sendError(res, 500, "Failed to dismiss insight", error.message);
  }
}
