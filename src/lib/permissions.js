/**
 * Centralized permission system for role-based access control
 */

// Permission constants
export const PERMISSIONS = {
  // Deal permissions
  DEAL_VIEW_ALL: 'deal:view_all',         // View all deals (GP only)
  DEAL_VIEW_ASSIGNED: 'deal:view_assigned', // View only assigned deals
  DEAL_CREATE: 'deal:create',
  DEAL_EDIT: 'deal:edit',
  DEAL_SUBMIT: 'deal:submit',             // Submit for external review
  DEAL_APPROVE: 'deal:approve',           // Approve deal transitions
  DEAL_OVERRIDE: 'deal:override',         // Override gate blocks
  DEAL_ASSIGN_ANALYST: 'deal:assign_analyst', // Assign analysts to deals

  // LP permissions
  LP_INVITE: 'lp:invite',
  LP_APPROVE: 'lp:approve',
  LP_VIEW_OWN: 'lp:view_own',             // View own LP investments

  // Task permissions
  TASK_CREATE: 'task:create',
  TASK_ASSIGN: 'task:assign',
  TASK_VIEW_ALL: 'task:view_all',
  TASK_VIEW_ASSIGNED: 'task:view_assigned',

  // Document permissions
  DOC_UPLOAD: 'doc:upload',
  DOC_APPROVE: 'doc:approve',

  // Review permissions
  REQUEST_REVIEW: 'review:request',       // Request senior review
  APPROVE_REVIEW: 'review:approve',       // Approve junior's work

  // Admin permissions
  ADMIN_MANAGE_USERS: 'admin:manage_users',         // Manage organization users
  ADMIN_VERIFY_USERS: 'admin:verify_users',         // Verify pending users
  ADMIN_VIEW_ALL_ORGS: 'admin:view_all_orgs',       // View all organizations (super admin)

  // LP Document permissions
  LP_DOC_UPLOAD: 'lp_doc:upload',                   // Upload LP documents (GP/Admin)
  LP_DOC_DELETE: 'lp_doc:delete',                   // Delete LP documents (GP/Admin)
  LP_DOC_SET_PERMISSIONS: 'lp_doc:set_permissions', // Set per-LP document permissions
  LP_DOC_VIEW_ALL: 'lp_doc:view_all',               // View all LP documents
  LP_DOC_VIEW_OWN: 'lp_doc:view_own',               // View own permitted documents (LP)
  LP_PORTAL_MANAGE: 'lp_portal:manage',             // Manage LP portal access (GP/Admin)
  LP_PORTAL_ACCESS: 'lp_portal:access',             // Access LP portal (LP)
};

// Role permission mappings
export const ROLE_PERMISSIONS = {
  'GP': [
    PERMISSIONS.DEAL_VIEW_ALL,
    PERMISSIONS.DEAL_CREATE,
    PERMISSIONS.DEAL_EDIT,
    PERMISSIONS.DEAL_SUBMIT,
    PERMISSIONS.DEAL_APPROVE,
    PERMISSIONS.DEAL_OVERRIDE,
    PERMISSIONS.DEAL_ASSIGN_ANALYST,
    PERMISSIONS.LP_INVITE,
    PERMISSIONS.LP_APPROVE,
    PERMISSIONS.TASK_CREATE,
    PERMISSIONS.TASK_ASSIGN,
    PERMISSIONS.TASK_VIEW_ALL,
    PERMISSIONS.DOC_UPLOAD,
    PERMISSIONS.DOC_APPROVE,
    PERMISSIONS.APPROVE_REVIEW,
    PERMISSIONS.LP_DOC_UPLOAD,
    PERMISSIONS.LP_DOC_DELETE,
    PERMISSIONS.LP_DOC_SET_PERMISSIONS,
    PERMISSIONS.LP_DOC_VIEW_ALL,
    PERMISSIONS.LP_PORTAL_MANAGE,
  ],

  'GP Analyst': [
    PERMISSIONS.DEAL_VIEW_ASSIGNED,       // Only assigned deals
    PERMISSIONS.DEAL_CREATE,              // Can draft, needs approval
    PERMISSIONS.DEAL_EDIT,                // Only on assigned deals
    PERMISSIONS.LP_INVITE,                // Can invite, GP must approve
    PERMISSIONS.TASK_CREATE,
    PERMISSIONS.TASK_VIEW_ASSIGNED,
    PERMISSIONS.DOC_UPLOAD,
    PERMISSIONS.REQUEST_REVIEW,           // Request GP review
  ],

  'Lender': [
    PERMISSIONS.DEAL_VIEW_ALL,            // See all deals submitted to them
    PERMISSIONS.DEAL_APPROVE,
    PERMISSIONS.TASK_VIEW_ALL,
  ],

  'Counsel': [
    PERMISSIONS.DEAL_VIEW_ASSIGNED,       // Task-based access
    PERMISSIONS.DOC_APPROVE,              // Approve legal docs
    PERMISSIONS.TASK_VIEW_ASSIGNED,
  ],

  'Regulator': [
    PERMISSIONS.DEAL_VIEW_ALL,
    PERMISSIONS.TASK_VIEW_ALL,
    // Read-only - no action permissions
  ],

  'Auditor': [
    PERMISSIONS.DEAL_VIEW_ALL,
    PERMISSIONS.TASK_VIEW_ALL,
    // Read-only - no action permissions
  ],

  'LP': [
    PERMISSIONS.LP_VIEW_OWN,
    PERMISSIONS.LP_DOC_VIEW_OWN,
    PERMISSIONS.LP_PORTAL_ACCESS,
    // View own investment data and permitted documents only
  ],

  'Admin': [
    // Admin has all GP permissions plus admin-specific ones
    PERMISSIONS.DEAL_VIEW_ALL,
    PERMISSIONS.DEAL_CREATE,
    PERMISSIONS.DEAL_EDIT,
    PERMISSIONS.DEAL_SUBMIT,
    PERMISSIONS.DEAL_APPROVE,
    PERMISSIONS.DEAL_OVERRIDE,
    PERMISSIONS.DEAL_ASSIGN_ANALYST,
    PERMISSIONS.LP_INVITE,
    PERMISSIONS.LP_APPROVE,
    PERMISSIONS.TASK_CREATE,
    PERMISSIONS.TASK_ASSIGN,
    PERMISSIONS.TASK_VIEW_ALL,
    PERMISSIONS.DOC_UPLOAD,
    PERMISSIONS.DOC_APPROVE,
    PERMISSIONS.APPROVE_REVIEW,
    // Admin-specific permissions
    PERMISSIONS.ADMIN_MANAGE_USERS,
    PERMISSIONS.ADMIN_VERIFY_USERS,
    // LP Document management
    PERMISSIONS.LP_DOC_UPLOAD,
    PERMISSIONS.LP_DOC_DELETE,
    PERMISSIONS.LP_DOC_SET_PERMISSIONS,
    PERMISSIONS.LP_DOC_VIEW_ALL,
    PERMISSIONS.LP_PORTAL_MANAGE,
  ],
};

/**
 * Check if a role has a specific permission
 * @param {string} role - The user's role
 * @param {string} permission - The permission to check
 * @returns {boolean}
 */
export function canPerform(role, permission) {
  const rolePerms = ROLE_PERMISSIONS[role];
  if (!rolePerms) return false;
  return rolePerms.includes(permission);
}

/**
 * Check if a role can view all deals or only assigned ones
 * @param {string} role - The user's role
 * @returns {'all' | 'assigned' | 'none'}
 */
export function getDealVisibility(role) {
  if (canPerform(role, PERMISSIONS.DEAL_VIEW_ALL)) {
    return 'all';
  }
  if (canPerform(role, PERMISSIONS.DEAL_VIEW_ASSIGNED)) {
    return 'assigned';
  }
  return 'none';
}

/**
 * Check if a role is an internal team role
 * @param {string} role - The user's role
 * @returns {boolean}
 */
export function isInternalRole(role) {
  return ['GP', 'GP Analyst', 'Admin'].includes(role);
}

/**
 * Check if a role is an admin role
 * @param {string} role - The user's role
 * @returns {boolean}
 */
export function isAdminRole(role) {
  return role === 'Admin';
}

/**
 * Check if a role is an external party
 * @param {string} role - The user's role
 * @returns {boolean}
 */
export function isExternalRole(role) {
  return ['Lender', 'Counsel', 'LP'].includes(role);
}

/**
 * Check if a role is an oversight role (read-only)
 * @param {string} role - The user's role
 * @returns {boolean}
 */
export function isOversightRole(role) {
  return ['Regulator', 'Auditor'].includes(role);
}

/**
 * Get the label for a role
 * @param {string} role - The role ID
 * @returns {string}
 */
export function getRoleLabel(role) {
  const labels = {
    'GP': 'General Partner',
    'GP Analyst': 'GP Analyst',
    'Lender': 'Lender',
    'Counsel': 'External Counsel',
    'Regulator': 'Regulator',
    'Auditor': 'Auditor',
    'LP': 'Limited Partner',
    'Admin': 'Administrator',
  };
  return labels[role] || role;
}

/**
 * Get allowed actions for a role on a deal
 * @param {string} role - The user's role
 * @returns {string[]} - Array of allowed action types
 */
export function getAllowedDealActions(role) {
  const actions = [];

  if (canPerform(role, PERMISSIONS.DEAL_EDIT)) {
    actions.push('edit');
  }
  if (canPerform(role, PERMISSIONS.DEAL_SUBMIT)) {
    actions.push('submit', 'sendToLender');
  }
  if (canPerform(role, PERMISSIONS.DEAL_APPROVE)) {
    actions.push('approve', 'reject');
  }
  if (canPerform(role, PERMISSIONS.DEAL_OVERRIDE)) {
    actions.push('override');
  }
  if (canPerform(role, PERMISSIONS.DOC_UPLOAD)) {
    actions.push('uploadDocument');
  }
  if (canPerform(role, PERMISSIONS.REQUEST_REVIEW)) {
    actions.push('requestReview');
  }
  if (canPerform(role, PERMISSIONS.DEAL_ASSIGN_ANALYST)) {
    actions.push('assignAnalyst');
  }

  return actions;
}
