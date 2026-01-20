#!/usr/bin/env node

/**
 * Test Script for Phase 4: Smart Reminders
 *
 * Tests the full reminder flow including:
 * - Creating tasks with due dates
 * - Running the deadline scanner
 * - Verifying reminder notifications are created
 * - Testing snooze functionality
 * - Testing escalation rules
 * - Testing notification preferences
 *
 * Run with: node server/scripts/test-reminders.mjs
 */

const BASE_URL = process.env.BFF_URL || 'http://localhost:8787';
const TEST_USER_ID = 'test-user-123';
const TEST_DEAL_ID = 'test-deal-456';

// Helper for API requests
async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': TEST_USER_ID,
      'x-user-name': 'Test User',
      'x-actor-role': 'GP',
      ...options.headers
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status}: ${text}`);
  }

  return response.json();
}

// Test results tracking
let passed = 0;
let failed = 0;

function test(name, fn) {
  return async () => {
    try {
      await fn();
      console.log(`✓ ${name}`);
      passed++;
    } catch (error) {
      console.log(`✗ ${name}`);
      console.log(`  Error: ${error.message}`);
      failed++;
    }
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

// ==================== Tests ====================

const tests = [
  // Test 1: API health check
  test('Server is running', async () => {
    const response = await fetch(`${BASE_URL}/api/email-intake`);
    assert(response.status === 200 || response.status === 403, 'Server should respond');
  }),

  // Test 2: Create a task with due date (tomorrow)
  test('Create task with due date tomorrow', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const result = await request('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Test Task - Due Tomorrow',
        description: 'This task is due tomorrow for testing reminders',
        priority: 'high',
        assigneeId: TEST_USER_ID,
        assigneeName: 'Test User',
        dealId: TEST_DEAL_ID,
        dueDate: tomorrow.toISOString()
      })
    });

    assert(result.task, 'Should return task object');
    assert(result.task.id, 'Task should have ID');
    assert(result.task.dueDate, 'Task should have due date');

    // Store for later tests
    globalThis.testTaskId = result.task.id;
  }),

  // Test 3: Create overdue task (for escalation testing)
  test('Create overdue task', async () => {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const result = await request('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Test Task - Overdue',
        description: 'This task is overdue for testing escalation',
        priority: 'high',
        assigneeId: TEST_USER_ID,
        assigneeName: 'Test User',
        dealId: TEST_DEAL_ID,
        dueDate: threeDaysAgo.toISOString()
      })
    });

    assert(result.task, 'Should return task object');
    globalThis.overdueTaskId = result.task.id;
  }),

  // Test 4: Test notification preferences - get defaults
  test('Get notification preferences (defaults)', async () => {
    const result = await request('/api/notification-preferences');

    assert(result.emailEnabled === true, 'Email should be enabled by default');
    assert(result.inAppEnabled === true, 'In-app should be enabled by default');
    assert(Array.isArray(result.reminderDays), 'Reminder days should be array');
    assert(result.reminderDays.includes(7), 'Should include 7 day reminder');
    assert(result.reminderDays.includes(3), 'Should include 3 day reminder');
    assert(result.reminderDays.includes(1), 'Should include 1 day reminder');
  }),

  // Test 5: Update notification preferences
  test('Update notification preferences', async () => {
    const result = await request('/api/notification-preferences', {
      method: 'PATCH',
      body: JSON.stringify({
        emailEnabled: false,
        reminderDays: [5, 2, 1],
        quietStart: '22:00',
        quietEnd: '08:00'
      })
    });

    assert(result.emailEnabled === false, 'Email should be disabled');
    assert(result.reminderDays.includes(5), 'Should include 5 day reminder');
    assert(result.quietStart === '22:00', 'Quiet start should be set');
    assert(result.quietEnd === '08:00', 'Quiet end should be set');
  }),

  // Test 6: Reset notification preferences
  test('Reset notification preferences', async () => {
    const result = await request('/api/notification-preferences', {
      method: 'PATCH',
      body: JSON.stringify({
        emailEnabled: true,
        reminderDays: [7, 3, 1],
        quietStart: null,
        quietEnd: null
      })
    });

    assert(result.emailEnabled === true, 'Email should be re-enabled');
  }),

  // Test 7: List notifications
  test('List notifications', async () => {
    const result = await request('/api/notifications');

    assert(Array.isArray(result.notifications), 'Should return notifications array');
  }),

  // Test 8: Create a test notification for snooze testing
  test('Snooze notification (1 hour)', async () => {
    // First, create a notification by triggering an action that creates one
    // We'll use the task reminder system for this

    // Get existing notifications
    const listResult = await request('/api/notifications');

    if (listResult.notifications.length === 0) {
      console.log('  (Skipping - no notifications to snooze)');
      return;
    }

    const notificationId = listResult.notifications[0].id;

    const result = await request(`/api/notifications/${notificationId}/snooze`, {
      method: 'PATCH',
      body: JSON.stringify({ duration: '1h' })
    });

    assert(result.id === notificationId, 'Should return same notification ID');
    assert(result.snoozedUntil, 'Should have snoozedUntil timestamp');

    // Verify snooze time is approximately 1 hour from now
    const snoozedUntil = new Date(result.snoozedUntil);
    const expectedTime = new Date(Date.now() + 60 * 60 * 1000);
    const diffMinutes = Math.abs(snoozedUntil - expectedTime) / (1000 * 60);
    assert(diffMinutes < 5, 'Snooze time should be ~1 hour from now');
  }),

  // Test 9: Dismiss notification
  test('Dismiss notification', async () => {
    const listResult = await request('/api/notifications');

    if (listResult.notifications.length === 0) {
      console.log('  (Skipping - no notifications to dismiss)');
      return;
    }

    const notificationId = listResult.notifications[0].id;

    const result = await request(`/api/notifications/${notificationId}/dismiss`, {
      method: 'PATCH',
      body: JSON.stringify({ reason: 'completed' })
    });

    assert(result.id === notificationId, 'Should return same notification ID');
    assert(result.isRead === true, 'Should be marked as read');
  }),

  // Test 10: Snooze with custom date
  test('Snooze notification with custom date', async () => {
    const listResult = await request('/api/notifications?unreadOnly=false');

    if (listResult.notifications.length === 0) {
      console.log('  (Skipping - no notifications for custom snooze)');
      return;
    }

    // Find an unread notification or use any
    const notification = listResult.notifications[0];

    const customDate = new Date();
    customDate.setDate(customDate.getDate() + 2);

    const result = await request(`/api/notifications/${notification.id}/snooze`, {
      method: 'PATCH',
      body: JSON.stringify({ until: customDate.toISOString() })
    });

    assert(result.snoozedUntil, 'Should have custom snoozed time');
  }),

  // Test 11: Validate snooze duration limits
  test('Reject snooze beyond 30 days', async () => {
    const listResult = await request('/api/notifications?unreadOnly=false');

    if (listResult.notifications.length === 0) {
      console.log('  (Skipping - no notifications)');
      return;
    }

    const notification = listResult.notifications[0];

    const tooFar = new Date();
    tooFar.setDate(tooFar.getDate() + 35);

    try {
      await request(`/api/notifications/${notification.id}/snooze`, {
        method: 'PATCH',
        body: JSON.stringify({ until: tooFar.toISOString() })
      });
      throw new Error('Should have rejected');
    } catch (error) {
      assert(error.message.includes('400') || error.message.includes('30 days'),
        'Should reject with 400 error about 30 day limit');
    }
  }),

  // Test 12: Validate preference update constraints
  test('Reject invalid reminder days', async () => {
    try {
      await request('/api/notification-preferences', {
        method: 'PATCH',
        body: JSON.stringify({
          reminderDays: [100] // Invalid - > 30
        })
      });
      throw new Error('Should have rejected');
    } catch (error) {
      assert(error.message.includes('400'), 'Should reject with 400 error');
    }
  }),

  // Test 13: Validate quiet hours format
  test('Reject invalid quiet hours format', async () => {
    try {
      await request('/api/notification-preferences', {
        method: 'PATCH',
        body: JSON.stringify({
          quietStart: '25:00' // Invalid time
        })
      });
      throw new Error('Should have rejected');
    } catch (error) {
      assert(error.message.includes('400'), 'Should reject with 400 error');
    }
  })
];

// ==================== Unit Tests for Escalation Rules ====================

console.log('\n========== Unit Tests: Escalation Rules ==========\n');

// Import and test escalation rules directly
const testEscalationRules = async () => {
  try {
    const {
      evaluateTaskEscalation,
      evaluateReviewEscalation,
      evaluateSubmissionEscalation,
      isQuietHours,
      ESCALATION_LEVELS
    } = await import('../services/escalation-rules.js');

    // Test 1: Task not overdue
    await test('Task not overdue - no escalation', async () => {
      const task = {
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
        status: 'OPEN',
        createdById: 'creator-1',
        assigneeId: 'assignee-1'
      };
      const result = evaluateTaskEscalation(task);
      assert(result.shouldEscalate === false, 'Should not escalate');
    })();

    // Test 2: Task 3 days overdue - escalate to creator
    await test('Task 3 days overdue - escalate to creator', async () => {
      const task = {
        dueDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        status: 'OPEN',
        createdById: 'creator-1',
        assigneeId: 'assignee-1'
      };
      const result = evaluateTaskEscalation(task);
      assert(result.shouldEscalate === true, 'Should escalate');
      assert(result.level === ESCALATION_LEVELS.CREATOR, 'Should be CREATOR level');
      assert(result.escalateTo.includes('creator-1'), 'Should include creator');
    })();

    // Test 3: Task 6 days overdue - escalate to deal team
    await test('Task 6 days overdue - escalate to deal team', async () => {
      const task = {
        dueDate: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
        status: 'OPEN',
        createdById: 'creator-1',
        assigneeId: 'assignee-1',
        dealId: 'deal-1'
      };
      const result = evaluateTaskEscalation(task);
      assert(result.shouldEscalate === true, 'Should escalate');
      assert(result.level === ESCALATION_LEVELS.DEAL_TEAM, 'Should be DEAL_TEAM level');
    })();

    // Test 4: Completed task - no escalation
    await test('Completed task - no escalation', async () => {
      const task = {
        dueDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        status: 'DONE',
        createdById: 'creator-1'
      };
      const result = evaluateTaskEscalation(task);
      assert(result.shouldEscalate === false, 'Should not escalate completed task');
    })();

    // Test 5: Cool-off period
    await test('Respect cool-off period', async () => {
      const task = {
        dueDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        status: 'OPEN',
        createdById: 'creator-1',
        assigneeId: 'assignee-1',
        escalatedAt: new Date(Date.now() - 12 * 60 * 60 * 1000) // 12 hours ago
      };
      const result = evaluateTaskEscalation(task);
      assert(result.shouldEscalate === false, 'Should not escalate during cool-off');
      assert(result.reason === 'cool_off', 'Should indicate cool-off reason');
    })();

    // Test 6: Quiet hours - overnight
    await test('Quiet hours (overnight 22:00-08:00)', async () => {
      const prefs = { quietStart: '22:00', quietEnd: '08:00' };

      // Test 23:00 - should be quiet
      const late = new Date();
      late.setHours(23, 0, 0, 0);
      assert(isQuietHours(prefs, late) === true, '23:00 should be quiet');

      // Test 07:00 - should be quiet
      const early = new Date();
      early.setHours(7, 0, 0, 0);
      assert(isQuietHours(prefs, early) === true, '07:00 should be quiet');

      // Test 12:00 - should not be quiet
      const noon = new Date();
      noon.setHours(12, 0, 0, 0);
      assert(isQuietHours(prefs, noon) === false, '12:00 should not be quiet');
    })();

    // Test 7: Review escalation
    await test('Review request pending 3 days - escalate', async () => {
      const review = {
        status: 'pending',
        requestedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
      };
      const result = evaluateReviewEscalation(review);
      assert(result.shouldEscalate === true, 'Should escalate pending review');
      assert(result.escalateTo.includes('gp-team'), 'Should escalate to GP team');
    })();

    // Test 8: Submission escalation
    await test('Submission no response 6 days - escalate', async () => {
      const submission = {
        status: 'PENDING',
        submittedAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
        submittedByUserId: 'submitter-1'
      };
      const result = evaluateSubmissionEscalation(submission);
      assert(result.shouldEscalate === true, 'Should escalate');
      assert(result.escalateTo.includes('submitter-1'), 'Should notify submitter');
    })();

    console.log('\n✓ All escalation rule unit tests passed\n');
  } catch (error) {
    console.log(`\n✗ Escalation rules unit tests failed: ${error.message}\n`);
    failed++;
  }
};

// ==================== Run Tests ====================

async function runTests() {
  console.log('========== Phase 4: Smart Reminders Test Suite ==========\n');
  console.log(`Target: ${BASE_URL}\n`);

  // Check server first
  try {
    await fetch(`${BASE_URL}/api/email-intake`);
  } catch (error) {
    console.log('✗ Server is not running. Please start with: npm run bff\n');
    process.exit(1);
  }

  console.log('========== API Tests ==========\n');

  // Run API tests
  for (const testFn of tests) {
    await testFn();
  }

  // Run unit tests for escalation rules
  await testEscalationRules();

  // Summary
  console.log('\n========== Summary ==========');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
