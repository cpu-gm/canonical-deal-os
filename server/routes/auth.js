import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getPrisma } from "../db.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const JWT_EXPIRES_IN = "7d";
const SALT_ROUNDS = 10;

// Structured logging helper
function log(level, category, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[${timestamp}] [${level}] [${category}] ${message}${metaStr}`);
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS"
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, message, details = null) {
  sendJson(res, status, { message, details });
}

function generateToken(userId, email) {
  return jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * POST /api/auth/signup
 * Create a new user account
 */
export async function handleSignup(req, res, readJsonBody) {
  try {
    const body = await readJsonBody(req);
    const { email, password, name, organizationId, organizationName, role } = body || {};

    if (!email || !password || !name) {
      return sendError(res, 400, "Email, password, and name are required");
    }

    if (password.length < 8) {
      return sendError(res, 400, "Password must be at least 8 characters");
    }

    const prisma = getPrisma();

    // Check if email already exists
    // Exception: allow test emails to create multiple accounts (for role-playing/testing)
    const testEmails = ['gavrielmajeski@gmail.com'];
    const isTestEmail = testEmails.includes(email.toLowerCase());

    if (!isTestEmail) {
      const existingUser = await prisma.authUser.findFirst({
        where: { email: email.toLowerCase() }
      });

      if (existingUser) {
        return sendError(res, 409, "An account with this email already exists");
      }
    }
    // Test emails can create unlimited accounts for role-playing

    let orgId = organizationId;
    let isOrgCreator = false; // Track if this user is creating a new org

    // If no org ID provided, create a new organization
    if (!orgId && organizationName) {
      const slug = slugify(organizationName);
      const existingOrg = await prisma.organization.findUnique({
        where: { slug }
      });

      if (existingOrg) {
        orgId = existingOrg.id;
      } else {
        const newOrg = await prisma.organization.create({
          data: {
            name: organizationName,
            slug,
            status: "ACTIVE"
          }
        });
        orgId = newOrg.id;
        isOrgCreator = true; // This user created the org
      }
    }

    if (!orgId) {
      return sendError(res, 400, "Organization is required");
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Determine user status based on role
    // Admin users are immediately active, others need verification
    // IMPORTANT: If this user is creating a new org, make them Admin automatically
    // (otherwise there's no one to approve them!)
    const userRole = isOrgCreator ? "Admin" : (role || "GP Analyst");
    const isAdmin = userRole === "Admin" || isOrgCreator;
    const status = isAdmin ? "ACTIVE" : "PENDING";

    // Create user
    const user = await prisma.authUser.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
        name,
        organizationId: orgId,
        role: userRole,
        status,
        verifiedAt: isAdmin ? new Date() : null
      },
      include: {
        organization: true
      }
    });

    // Create verification request for non-admin users
    if (!isAdmin) {
      await prisma.userVerificationRequest.create({
        data: {
          userId: user.id,
          requestedRole: userRole,
          status: "PENDING"
        }
      });
    }

    // Generate token
    const token = generateToken(user.id, user.email);

    // Create session
    await prisma.authSession.create({
      data: {
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        userAgent: req.headers["user-agent"],
        ipAddress: req.headers["x-forwarded-for"] || req.socket?.remoteAddress
      }
    });

    return sendJson(res, 201, {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        organization: {
          id: user.organization.id,
          name: user.organization.name
        }
      },
      token,
      requiresVerification: status === "PENDING"
    });
  } catch (error) {
    console.error("Signup error:", error);
    return sendError(res, 500, "Failed to create account");
  }
}

/**
 * POST /api/auth/login
 * Login with email and password
 */
export async function handleLogin(req, res, readJsonBody) {
  try {
    const body = await readJsonBody(req);
    const { email, password } = body || {};

    log('INFO', 'AUTH', `Login attempt`, { email: email || 'not provided' });

    if (!email || !password) {
      log('WARN', 'AUTH', `Login failed - missing credentials`, { email: email || 'not provided' });
      return sendError(res, 400, "Email and password are required");
    }

    const prisma = getPrisma();

    // Find user (use findFirst since test emails can have multiple accounts)
    // For multiple accounts, get the most recently created one
    log('INFO', 'AUTH', `Looking up user in database`, { email: email.toLowerCase() });
    const user = await prisma.authUser.findFirst({
      where: { email: email.toLowerCase() },
      include: {
        organization: true
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!user) {
      log('WARN', 'AUTH', `Login failed - user not found`, { email: email.toLowerCase() });
      return sendError(res, 401, "Invalid email or password");
    }

    log('INFO', 'AUTH', `User found`, { userId: user.id, role: user.role, status: user.status });

    if (!user.passwordHash) {
      log('WARN', 'AUTH', `Login failed - SSO account`, { userId: user.id });
      return sendError(res, 401, "This account uses SSO. Please sign in with your provider.");
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      log('WARN', 'AUTH', `Login failed - invalid password`, { userId: user.id });
      return sendError(res, 401, "Invalid email or password");
    }

    // Check user status
    if (user.status === "SUSPENDED") {
      log('WARN', 'AUTH', `Login failed - account suspended`, { userId: user.id });
      return sendError(res, 403, "Your account has been suspended. Contact your administrator.");
    }

    // Generate token
    const token = generateToken(user.id, user.email);
    log('INFO', 'AUTH', `Token generated`, { userId: user.id });

    // Create session
    await prisma.authSession.create({
      data: {
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        userAgent: req.headers["user-agent"],
        ipAddress: req.headers["x-forwarded-for"] || req.socket?.remoteAddress
      }
    });

    log('INFO', 'AUTH', `Login successful`, { userId: user.id, role: user.role, org: user.organization.name });

    return sendJson(res, 200, {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        organization: {
          id: user.organization.id,
          name: user.organization.name
        }
      },
      token,
      requiresVerification: user.status === "PENDING"
    });
  } catch (error) {
    log('ERROR', 'AUTH', `Login error`, { error: error.message, stack: error.stack });
    console.error("Login error:", error);
    return sendError(res, 500, "Failed to login");
  }
}

/**
 * POST /api/auth/logout
 * Logout and invalidate session
 */
export async function handleLogout(req, res) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return sendJson(res, 200, { message: "Logged out" });
    }

    const token = authHeader.split(" ")[1];
    const prisma = getPrisma();

    // Revoke session
    await prisma.authSession.updateMany({
      where: { token },
      data: { revokedAt: new Date() }
    });

    return sendJson(res, 200, { message: "Logged out successfully" });
  } catch (error) {
    console.error("Logout error:", error);
    return sendJson(res, 200, { message: "Logged out" });
  }
}

/**
 * GET /api/auth/me
 * Get current user info
 */
export async function handleGetMe(req, res) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return sendError(res, 401, "Not authenticated");
    }

    const token = authHeader.split(" ")[1];
    const decoded = verifyToken(token);

    if (!decoded) {
      return sendError(res, 401, "Invalid or expired token");
    }

    const prisma = getPrisma();

    // Verify session is still valid
    const session = await prisma.authSession.findUnique({
      where: { token }
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      return sendError(res, 401, "Session expired");
    }

    // Get user
    const user = await prisma.authUser.findUnique({
      where: { id: decoded.userId },
      include: {
        organization: true
      }
    });

    if (!user) {
      return sendError(res, 401, "User not found");
    }

    return sendJson(res, 200, {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        organization: {
          id: user.organization.id,
          name: user.organization.name
        }
      }
    });
  } catch (error) {
    console.error("Get me error:", error);
    return sendError(res, 500, "Failed to get user info");
  }
}

/**
 * GET /api/organizations/public
 * List public organizations for signup dropdown
 */
export async function handleListOrganizations(req, res) {
  try {
    const prisma = getPrisma();

    const organizations = await prisma.organization.findMany({
      where: { status: "ACTIVE" },
      select: {
        id: true,
        name: true,
        slug: true
      },
      orderBy: { name: "asc" }
    });

    return sendJson(res, 200, { organizations });
  } catch (error) {
    console.error("List organizations error:", error);
    return sendError(res, 500, "Failed to list organizations");
  }
}

/**
 * Middleware to extract user from token
 */
export async function extractAuthUser(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    log('DEBUG', 'AUTH', 'No bearer token in request');
    return null;
  }

  const token = authHeader.split(" ")[1];
  const decoded = verifyToken(token);

  if (!decoded) {
    log('WARN', 'AUTH', 'Invalid or expired JWT token');
    return null;
  }

  const prisma = getPrisma();

  // Verify session
  const session = await prisma.authSession.findUnique({
    where: { token }
  });

  if (!session) {
    log('WARN', 'AUTH', 'Session not found in database', { userId: decoded.userId });
    return null;
  }

  if (session.revokedAt) {
    log('WARN', 'AUTH', 'Session was revoked', { userId: decoded.userId });
    return null;
  }

  if (session.expiresAt < new Date()) {
    log('WARN', 'AUTH', 'Session expired', { userId: decoded.userId });
    return null;
  }

  const user = await prisma.authUser.findUnique({
    where: { id: decoded.userId },
    include: { organization: true }
  });

  // Reject if user not found or not active
  if (!user) {
    log('WARN', 'AUTH', 'User not found', { userId: decoded.userId });
    return null;
  }

  if (user.status !== 'ACTIVE') {
    log('WARN', 'AUTH', 'User not active', { userId: user.id, status: user.status });
    return null;
  }

  return user;
}
