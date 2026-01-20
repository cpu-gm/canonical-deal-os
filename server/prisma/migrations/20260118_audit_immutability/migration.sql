-- Audit Immutability Triggers for BFF (SQLite)
-- Prevents UPDATE and DELETE on audit tables to ensure records are tamper-proof

-- Trigger to prevent UPDATE on DealEvent
CREATE TRIGGER IF NOT EXISTS no_update_deal_event
BEFORE UPDATE ON DealEvent
BEGIN
  SELECT RAISE(ABORT, 'UPDATE not allowed on DealEvent table - audit records are immutable');
END;

-- Trigger to prevent DELETE on DealEvent
CREATE TRIGGER IF NOT EXISTS no_delete_deal_event
BEFORE DELETE ON DealEvent
BEGIN
  SELECT RAISE(ABORT, 'DELETE not allowed on DealEvent table - audit records are immutable');
END;

-- Trigger to prevent UPDATE on Snapshot
CREATE TRIGGER IF NOT EXISTS no_update_snapshot
BEFORE UPDATE ON Snapshot
BEGIN
  SELECT RAISE(ABORT, 'UPDATE not allowed on Snapshot table - audit records are immutable');
END;

-- Trigger to prevent DELETE on Snapshot
CREATE TRIGGER IF NOT EXISTS no_delete_snapshot
BEFORE DELETE ON Snapshot
BEGIN
  SELECT RAISE(ABORT, 'DELETE not allowed on Snapshot table - audit records are immutable');
END;

-- Trigger to prevent UPDATE on ApprovalRecord
CREATE TRIGGER IF NOT EXISTS no_update_approval_record
BEFORE UPDATE ON ApprovalRecord
BEGIN
  SELECT RAISE(ABORT, 'UPDATE not allowed on ApprovalRecord table - audit records are immutable');
END;

-- Trigger to prevent DELETE on ApprovalRecord
CREATE TRIGGER IF NOT EXISTS no_delete_approval_record
BEFORE DELETE ON ApprovalRecord
BEGIN
  SELECT RAISE(ABORT, 'DELETE not allowed on ApprovalRecord table - audit records are immutable');
END;

-- Trigger to prevent UPDATE on PermissionAuditLog
CREATE TRIGGER IF NOT EXISTS no_update_permission_audit_log
BEFORE UPDATE ON PermissionAuditLog
BEGIN
  SELECT RAISE(ABORT, 'UPDATE not allowed on PermissionAuditLog table - audit records are immutable');
END;

-- Trigger to prevent DELETE on PermissionAuditLog
CREATE TRIGGER IF NOT EXISTS no_delete_permission_audit_log
BEFORE DELETE ON PermissionAuditLog
BEGIN
  SELECT RAISE(ABORT, 'DELETE not allowed on PermissionAuditLog table - audit records are immutable');
END;
