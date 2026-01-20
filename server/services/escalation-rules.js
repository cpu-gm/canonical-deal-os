/**
 * Escalation Rules Service
 *
 * Defines and evaluates rules for escalating overdue items.
 */

/**
 * Escalation levels and their thresholds
 */
export const ESCALATION_LEVELS = {
  NONE: 0,
  CREATOR: 1,      // Notify task creator
  DEAL_TEAM: 2,    // Notify all deal assignees
  MANAGER: 3       // Notify manager (future)
};

/**
 * Default escalation rules by item type
 */
export const ESCALATION_RULES = {
  task: {
    // Days overdue -> escalation level
    thresholds: [
      { daysOverdue: 2, level: ESCALATION_LEVELS.CREATOR },
      { daysOverdue: 5, level: ESCALATION_LEVELS.DEAL_TEAM }
    ],
    // Max reminders per day per task
    maxRemindersPerDay: 3,
    // Cool-off period between escalations (hours)
    coolOffHours: 24
  },
  reviewRequest: {
    thresholds: [
      { daysPending: 2, level: ESCALATION_LEVELS.CREATOR },
      { daysPending: 5, level: ESCALATION_LEVELS.DEAL_TEAM }
    ],
    maxRemindersPerDay: 2,
    coolOffHours: 48
  },
  dealSubmission: {
    thresholds: [
      { daysNoResponse: 5, level: ESCALATION_LEVELS.CREATOR },
      { daysNoResponse: 10, level: ESCALATION_LEVELS.DEAL_TEAM }
    ],
    maxRemindersPerDay: 1,
    coolOffHours: 72
  }
};

/**
 * Calculate days between two dates
 */
function daysBetween(date1, date2) {
  const ms = Math.abs(date2.getTime() - date1.getTime());
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/**
 * Evaluate escalation rules for a task
 * @param {Object} task - The task to evaluate
 * @param {Date} now - Current time
 * @returns {Object} - { shouldEscalate, level, escalateTo }
 */
export function evaluateTaskEscalation(task, now = new Date()) {
  if (!task.dueDate || task.status === 'DONE' || task.status === 'CANCELLED') {
    return { shouldEscalate: false };
  }

  const dueDate = new Date(task.dueDate);
  if (dueDate > now) {
    return { shouldEscalate: false }; // Not overdue yet
  }

  const daysOverdue = daysBetween(dueDate, now);
  const rules = ESCALATION_RULES.task;

  // Check cool-off period
  if (task.escalatedAt) {
    const hoursSinceLastEscalation = (now.getTime() - new Date(task.escalatedAt).getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastEscalation < rules.coolOffHours) {
      return { shouldEscalate: false, reason: 'cool_off' };
    }
  }

  // Find applicable escalation level
  let applicableLevel = ESCALATION_LEVELS.NONE;
  for (const threshold of rules.thresholds) {
    if (daysOverdue >= threshold.daysOverdue) {
      applicableLevel = threshold.level;
    }
  }

  if (applicableLevel === ESCALATION_LEVELS.NONE) {
    return { shouldEscalate: false };
  }

  // Determine who to escalate to
  let escalateTo = [];

  if (applicableLevel >= ESCALATION_LEVELS.CREATOR) {
    escalateTo.push(task.createdById);
  }

  if (applicableLevel >= ESCALATION_LEVELS.DEAL_TEAM && task.dealId) {
    // In production, would query deal assignments
    // For now, just escalate to creator
    escalateTo.push(task.createdById);
  }

  // Remove duplicates and the assignee (they already know)
  escalateTo = [...new Set(escalateTo)].filter(id => id !== task.assigneeId);

  if (escalateTo.length === 0) {
    return { shouldEscalate: false, reason: 'no_recipients' };
  }

  return {
    shouldEscalate: true,
    level: applicableLevel,
    escalateTo,
    daysOverdue
  };
}

/**
 * Evaluate escalation rules for a review request
 * @param {Object} review - The review request to evaluate
 * @param {Date} now - Current time
 * @returns {Object} - { shouldEscalate, level, escalateTo }
 */
export function evaluateReviewEscalation(review, now = new Date()) {
  if (review.status !== 'pending') {
    return { shouldEscalate: false };
  }

  const requestedAt = new Date(review.requestedAt);
  const daysPending = daysBetween(requestedAt, now);
  const rules = ESCALATION_RULES.reviewRequest;

  // Find applicable escalation level
  let applicableLevel = ESCALATION_LEVELS.NONE;
  for (const threshold of rules.thresholds) {
    if (daysPending >= threshold.daysPending) {
      applicableLevel = threshold.level;
    }
  }

  if (applicableLevel === ESCALATION_LEVELS.NONE) {
    return { shouldEscalate: false };
  }

  // Escalate to GP team
  return {
    shouldEscalate: true,
    level: applicableLevel,
    escalateTo: ['gp-team'], // Broadcast to GP team
    daysPending
  };
}

/**
 * Evaluate escalation rules for a deal submission
 * @param {Object} submission - The submission to evaluate
 * @param {Date} now - Current time
 * @returns {Object} - { shouldEscalate, level, escalateTo }
 */
export function evaluateSubmissionEscalation(submission, now = new Date()) {
  if (submission.status !== 'PENDING') {
    return { shouldEscalate: false };
  }

  const submittedAt = new Date(submission.submittedAt);
  const daysNoResponse = daysBetween(submittedAt, now);
  const rules = ESCALATION_RULES.dealSubmission;

  // Find applicable escalation level
  let applicableLevel = ESCALATION_LEVELS.NONE;
  for (const threshold of rules.thresholds) {
    if (daysNoResponse >= threshold.daysNoResponse) {
      applicableLevel = threshold.level;
    }
  }

  if (applicableLevel === ESCALATION_LEVELS.NONE) {
    return { shouldEscalate: false };
  }

  return {
    shouldEscalate: true,
    level: applicableLevel,
    escalateTo: [submission.submittedByUserId],
    daysNoResponse
  };
}

/**
 * Check if we're within quiet hours for a user
 * @param {Object} preferences - User's notification preferences
 * @param {Date} now - Current time
 * @returns {boolean} - True if in quiet hours
 */
export function isQuietHours(preferences, now = new Date()) {
  if (!preferences?.quietStart || !preferences?.quietEnd) {
    return false;
  }

  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentTime = currentHour * 60 + currentMinute;

  const [startHour, startMin] = preferences.quietStart.split(':').map(Number);
  const [endHour, endMin] = preferences.quietEnd.split(':').map(Number);
  const startTime = startHour * 60 + startMin;
  const endTime = endHour * 60 + endMin;

  // Handle overnight quiet hours (e.g., 22:00 - 08:00)
  if (startTime > endTime) {
    return currentTime >= startTime || currentTime < endTime;
  }

  return currentTime >= startTime && currentTime < endTime;
}

/**
 * Get escalation level label
 */
export function getEscalationLevelLabel(level) {
  const labels = {
    [ESCALATION_LEVELS.NONE]: 'None',
    [ESCALATION_LEVELS.CREATOR]: 'Creator Notified',
    [ESCALATION_LEVELS.DEAL_TEAM]: 'Deal Team Notified',
    [ESCALATION_LEVELS.MANAGER]: 'Manager Notified'
  };
  return labels[level] || 'Unknown';
}
