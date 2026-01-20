/**
 * Reminder Scheduler Service
 *
 * Handles automated deadline reminders, escalation checks, and snooze processing.
 * Uses node-cron for scheduled jobs.
 */

import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { sendEmail } from './email-service.js';

const prisma = new PrismaClient();

// Default reminder days (7, 3, 1 days before deadline)
const DEFAULT_REMINDER_DAYS = [7, 3, 1];

// Escalation thresholds (days overdue)
const ESCALATION_THRESHOLDS = {
  LEVEL_1: 2,  // Notify creator
  LEVEL_2: 5   // Notify all deal assignees
};

/**
 * Start all scheduled jobs
 */
export function startScheduler() {
  console.log('[Scheduler] Starting reminder scheduler...');

  // Job 1: Daily deadline scanner (runs at 8 AM)
  cron.schedule('0 8 * * *', async () => {
    console.log('[Scheduler] Running daily deadline scan...');
    try {
      await scanUpcomingDeadlines();
    } catch (error) {
      console.error('[Scheduler] Deadline scan failed:', error);
    }
  });

  // Job 2: Escalation check (runs every 4 hours)
  cron.schedule('0 */4 * * *', async () => {
    console.log('[Scheduler] Running escalation check...');
    try {
      await processEscalations();
    } catch (error) {
      console.error('[Scheduler] Escalation check failed:', error);
    }
  });

  // Job 3: Snooze processor (runs every hour)
  cron.schedule('0 * * * *', async () => {
    console.log('[Scheduler] Processing snoozed notifications...');
    try {
      await processSnoozedNotifications();
    } catch (error) {
      console.error('[Scheduler] Snooze processing failed:', error);
    }
  });

  console.log('[Scheduler] All jobs scheduled');
}

/**
 * Scan for upcoming deadlines and create reminder notifications
 */
export async function scanUpcomingDeadlines() {
  const now = new Date();
  const results = {
    tasksScanned: 0,
    remindersCreated: 0,
    reviewsScanned: 0,
    submissionsScanned: 0
  };

  // 1. Find tasks with upcoming due dates
  for (const daysAhead of DEFAULT_REMINDER_DAYS) {
    const targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + daysAhead);

    // Set to start and end of that day
    const dayStart = new Date(targetDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(targetDate);
    dayEnd.setHours(23, 59, 59, 999);

    const tasks = await prisma.chatTask.findMany({
      where: {
        dueDate: {
          gte: dayStart,
          lte: dayEnd
        },
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        // Don't remind if already reminded today
        OR: [
          { reminderSentAt: null },
          { reminderSentAt: { lt: new Date(now.setHours(0, 0, 0, 0)) } }
        ]
      }
    });

    results.tasksScanned += tasks.length;

    for (const task of tasks) {
      if (task.assigneeId) {
        await createTaskReminderNotification(task, daysAhead);
        results.remindersCreated++;

        // Update task reminder tracking
        await prisma.chatTask.update({
          where: { id: task.id },
          data: { reminderSentAt: new Date() }
        });
      }
    }
  }

  // 2. Find pending review requests older than 2 days
  const twoDaysAgo = new Date(now);
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

  const pendingReviews = await prisma.reviewRequest.findMany({
    where: {
      status: 'pending',
      requestedAt: { lt: twoDaysAgo }
    }
  });

  results.reviewsScanned = pendingReviews.length;

  for (const review of pendingReviews) {
    // Check if we already sent a reminder recently
    const existingReminder = await prisma.notification.findFirst({
      where: {
        type: 'review_reminder',
        reviewRequestId: review.id,
        createdAt: { gt: twoDaysAgo }
      }
    });

    if (!existingReminder) {
      await createReviewReminderNotification(review);
      results.remindersCreated++;
    }
  }

  // 3. Find deal submissions with no response in 5+ days
  const fiveDaysAgo = new Date(now);
  fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

  const pendingSubmissions = await prisma.dealSubmission.findMany({
    where: {
      status: 'PENDING',
      submittedAt: { lt: fiveDaysAgo }
    }
  });

  results.submissionsScanned = pendingSubmissions.length;

  for (const submission of pendingSubmissions) {
    const existingReminder = await prisma.notification.findFirst({
      where: {
        type: 'submission_reminder',
        dealId: submission.dealId,
        createdAt: { gt: fiveDaysAgo }
      }
    });

    if (!existingReminder) {
      await createSubmissionReminderNotification(submission);
      results.remindersCreated++;
    }
  }

  console.log('[Scheduler] Deadline scan results:', results);
  return results;
}

/**
 * Process escalations for overdue tasks
 */
export async function processEscalations() {
  const now = new Date();
  const results = {
    tasksChecked: 0,
    escalated: 0
  };

  // Find overdue tasks that haven't been escalated yet
  const overdueTasks = await prisma.chatTask.findMany({
    where: {
      dueDate: { lt: now },
      status: { in: ['OPEN', 'IN_PROGRESS'] },
      escalatedAt: null
    }
  });

  results.tasksChecked = overdueTasks.length;

  for (const task of overdueTasks) {
    const daysOverdue = Math.floor((now.getTime() - task.dueDate.getTime()) / (1000 * 60 * 60 * 24));

    // Level 1 escalation: notify creator
    if (daysOverdue >= ESCALATION_THRESHOLDS.LEVEL_1 && !task.escalatedAt) {
      await createEscalationNotification(task, 1, task.createdById);

      await prisma.chatTask.update({
        where: { id: task.id },
        data: {
          escalatedAt: new Date(),
          escalatedToUserId: task.createdById
        }
      });

      results.escalated++;
    }
  }

  console.log('[Scheduler] Escalation results:', results);
  return results;
}

/**
 * Process snoozed notifications that have expired
 */
export async function processSnoozedNotifications() {
  const now = new Date();
  const results = {
    processed: 0
  };

  // Find notifications where snooze has expired
  const expiredSnoozes = await prisma.notification.findMany({
    where: {
      snoozedUntil: { lte: now },
      isRead: false
    }
  });

  for (const notification of expiredSnoozes) {
    // Clear the snooze and optionally send email
    await prisma.notification.update({
      where: { id: notification.id },
      data: {
        snoozedUntil: null,
        reminderCount: notification.reminderCount + 1,
        lastReminderAt: new Date()
      }
    });

    // Get user preferences
    const prefs = await getUserPreferences(notification.userId);

    if (prefs.emailEnabled) {
      await sendSnoozeExpiredEmail(notification);
    }

    results.processed++;
  }

  console.log('[Scheduler] Snooze processing results:', results);
  return results;
}

/**
 * Create a task reminder notification
 */
async function createTaskReminderNotification(task, daysUntilDue) {
  const dueLabel = daysUntilDue === 1 ? 'tomorrow' : `in ${daysUntilDue} days`;

  const notification = await prisma.notification.create({
    data: {
      userId: task.assigneeId,
      type: 'task_reminder',
      title: `Task due ${dueLabel}`,
      body: task.title,
      taskId: task.id,
      dealId: task.dealId,
      deadlineAt: task.dueDate,
      actionUrl: task.dealId ? `/DealOverview?id=${task.dealId}` : '/Tasks'
    }
  });

  // Get user preferences for email
  const prefs = await getUserPreferences(task.assigneeId);

  if (prefs.emailEnabled) {
    await sendTaskReminderEmail(task, daysUntilDue);
  }

  return notification;
}

/**
 * Create a review request reminder notification
 */
async function createReviewReminderNotification(review) {
  // Find GPs to notify (anyone with GP role could review)
  const notification = await prisma.notification.create({
    data: {
      userId: 'gp-team', // Broadcast to GP team
      type: 'review_reminder',
      title: 'Review request pending',
      body: `Review requested by ${review.requestedByName || 'Analyst'} is awaiting response`,
      reviewRequestId: review.id,
      dealId: review.dealId,
      actionUrl: `/DealOverview?id=${review.dealId}`
    }
  });

  return notification;
}

/**
 * Create a submission reminder notification
 */
async function createSubmissionReminderNotification(submission) {
  const notification = await prisma.notification.create({
    data: {
      userId: submission.submittedByUserId,
      type: 'submission_reminder',
      title: 'Deal submission awaiting response',
      body: `Your submission to ${submission.recipientName || submission.recipientEmail} has not received a response`,
      dealId: submission.dealId,
      actionUrl: `/DealOverview?id=${submission.dealId}`
    }
  });

  return notification;
}

/**
 * Create an escalation notification
 */
async function createEscalationNotification(task, level, escalateToUserId) {
  const notification = await prisma.notification.create({
    data: {
      userId: escalateToUserId,
      type: 'task_escalated',
      title: `[Escalated] Task overdue: ${task.title}`,
      body: `Task assigned to ${task.assigneeName || 'team member'} is overdue`,
      taskId: task.id,
      dealId: task.dealId,
      escalationLevel: level,
      deadlineAt: task.dueDate,
      actionUrl: task.dealId ? `/DealOverview?id=${task.dealId}` : '/Tasks'
    }
  });

  // Get user preferences for email
  const prefs = await getUserPreferences(escalateToUserId);

  if (prefs.emailEnabled) {
    await sendEscalationEmail(task, escalateToUserId);
  }

  return notification;
}

/**
 * Get user notification preferences
 */
async function getUserPreferences(userId) {
  const prefs = await prisma.notificationPreference.findUnique({
    where: { userId }
  });

  // Return defaults if no preferences set
  return prefs || {
    emailEnabled: true,
    inAppEnabled: true,
    reminderDays: '[7,3,1]',
    escalateAfterDays: 2
  };
}

/**
 * Send task reminder email
 */
async function sendTaskReminderEmail(task, daysUntilDue) {
  const dueLabel = daysUntilDue === 1 ? 'tomorrow' : `in ${daysUntilDue} days`;

  await sendEmail({
    to: task.assigneeId, // In production, resolve to actual email
    subject: `Reminder: "${task.title}" due ${dueLabel}`,
    text: `
You have a task due ${dueLabel}:

Task: ${task.title}
${task.description ? `Description: ${task.description}` : ''}
Due: ${task.dueDate?.toLocaleDateString()}
Priority: ${task.priority}

View task in platform to complete it.
    `,
    html: `
<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #171717;">Task Reminder</h2>
  <p>You have a task due <strong>${dueLabel}</strong>:</p>

  <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0;">
    <p><strong>Task:</strong> ${task.title}</p>
    ${task.description ? `<p><strong>Description:</strong> ${task.description}</p>` : ''}
    <p><strong>Due:</strong> ${task.dueDate?.toLocaleDateString()}</p>
    <p><strong>Priority:</strong> ${task.priority}</p>
  </div>

  <p style="color: #737373; font-size: 12px;">
    View task in platform to complete it.
  </p>
</div>
    `,
    metadata: {
      event: 'TASK_REMINDER',
      taskId: task.id,
      daysUntilDue
    }
  });
}

/**
 * Send escalation email
 */
async function sendEscalationEmail(task, escalateToUserId) {
  const now = new Date();
  const daysOverdue = Math.floor((now.getTime() - task.dueDate.getTime()) / (1000 * 60 * 60 * 24));

  await sendEmail({
    to: escalateToUserId, // In production, resolve to actual email
    subject: `[Escalated] Task overdue: "${task.title}"`,
    text: `
A task assigned to ${task.assigneeName || 'a team member'} is overdue:

Task: ${task.title}
${task.description ? `Description: ${task.description}` : ''}
Due: ${task.dueDate?.toLocaleDateString()} (${daysOverdue} days ago)
Assignee: ${task.assigneeName || 'Unknown'}
Priority: ${task.priority}

Please follow up on this task.
    `,
    html: `
<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #dc2626;">[Escalated] Task Overdue</h2>
  <p>A task assigned to <strong>${task.assigneeName || 'a team member'}</strong> is overdue:</p>

  <div style="background: #fef2f2; padding: 16px; border-radius: 8px; margin: 16px 0; border-left: 4px solid #dc2626;">
    <p><strong>Task:</strong> ${task.title}</p>
    ${task.description ? `<p><strong>Description:</strong> ${task.description}</p>` : ''}
    <p><strong>Due:</strong> ${task.dueDate?.toLocaleDateString()} <span style="color: #dc2626;">(${daysOverdue} days overdue)</span></p>
    <p><strong>Assignee:</strong> ${task.assigneeName || 'Unknown'}</p>
    <p><strong>Priority:</strong> ${task.priority}</p>
  </div>

  <p>Please follow up on this task.</p>
</div>
    `,
    metadata: {
      event: 'TASK_ESCALATED',
      taskId: task.id,
      daysOverdue
    }
  });
}

/**
 * Send snooze expired notification email
 */
async function sendSnoozeExpiredEmail(notification) {
  await sendEmail({
    to: notification.userId,
    subject: `Reminder: ${notification.title}`,
    text: `
Your snoozed reminder is back:

${notification.title}
${notification.body || ''}

This reminder was snoozed and has now expired.
    `,
    html: `
<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #171717;">Snoozed Reminder</h2>
  <p>Your snoozed reminder is back:</p>

  <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0;">
    <p><strong>${notification.title}</strong></p>
    ${notification.body ? `<p>${notification.body}</p>` : ''}
  </div>
</div>
    `,
    metadata: {
      event: 'SNOOZE_EXPIRED',
      notificationId: notification.id
    }
  });
}

/**
 * Manually trigger deadline scan (for testing)
 */
export async function triggerDeadlineScan() {
  console.log('[Scheduler] Manual deadline scan triggered');
  return scanUpcomingDeadlines();
}

/**
 * Manually trigger escalation check (for testing)
 */
export async function triggerEscalationCheck() {
  console.log('[Scheduler] Manual escalation check triggered');
  return processEscalations();
}

/**
 * Manually trigger snooze processing (for testing)
 */
export async function triggerSnoozeProcessing() {
  console.log('[Scheduler] Manual snooze processing triggered');
  return processSnoozedNotifications();
}
