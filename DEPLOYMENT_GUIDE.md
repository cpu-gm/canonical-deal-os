# LP Onboarding Deployment & Operations Guide

## Overview

This guide covers deploying the LP Onboarding feature to staging and production environments, including email/webhook configuration, testing procedures, and operational monitoring.

---

## Pre-Deployment Checklist

### Code Quality
- [ ] All npm tests pass: `npm test`
- [ ] No linting errors: `npm run lint`
- [ ] No TypeScript errors: `npm run type-check`
- [ ] All syntax validated

### Configuration
- [ ] `.env` file created with all required variables
- [ ] Sendgrid/email endpoint configured
- [ ] Webhook endpoint configured (if using)
- [ ] Database credentials verified
- [ ] Kernel API URL verified

### Database
- [ ] Prisma schema reviewed: `npx prisma schema validate`
- [ ] Migrations created: `npx prisma migrate dev --name lp_onboarding`
- [ ] Test migration successful: `npm run prisma:migrate:test`
- [ ] Database backups configured

### Security
- [ ] API keys rotated and stored securely
- [ ] CORS headers verified
- [ ] Rate limiting configured (if applicable)
- [ ] SSL/TLS certificates valid

---

## Environment Configuration

### Required Variables

Add these to your `.env` file:

```env
# Public URLs
BFF_PUBLIC_URL=https://staging.dealos.io
BFF_LP_INVITATION_BASE_URL=https://staging.dealos.io

# Email Configuration (Sendgrid)
BFF_LP_INVITATION_EMAIL_ENDPOINT=https://api.sendgrid.com/v3/mail/send
BFF_LP_INVITATION_EMAIL_API_KEY=SG.your-sendgrid-api-key
BFF_LP_INVITATION_EMAIL_FROM=Canonical LP Portal <noreply@dealos.io>

# Webhook Configuration
BFF_LP_NOTIFICATION_WEBHOOK_URL=https://your-webhook-handler.example.com/webhooks/lp
BFF_LP_NOTIFICATION_WEBHOOK_SECRET=your-webhook-secret-key
BFF_LP_NOTIFICATION_WEBHOOK_HEADER=X-LP-Webhook-Secret

# Caching
BFF_LP_PORTAL_TTL_MS=5000
BFF_LP_INVITATION_EXPIRY_DAYS=30

# Database
BFF_DB_URL=file:./server/.data/llm-airlock.db

# Kernel
KERNEL_API_URL=https://kernel-api.example.com
```

### Optional Variables

```env
# Development/Debug
BFF_EMAIL_DEV_MODE=false  # Set to true to log emails instead of sending
BFF_LOG_LEVEL=info

# Feature Flags
BFF_LP_BULK_IMPORT_ENABLED=true
BFF_LP_CUSTOM_REPORTS_ENABLED=true
```

---

## Staging Deployment

### 1. Database Migration

```bash
# Connect to staging database
export BFF_DB_URL="file:./server/.data/staging-llm-airlock.db"

# Run migrations
npx prisma db push --schema server/prisma/schema.prisma

# Verify schema
npx prisma db execute --stdin < verify_schema.sql
```

### 2. Build & Deploy

```bash
# Build BFF
npm run build

# Deploy to staging (example with Node.js)
npm run start:staging
# or with PM2
pm2 start ecosystem.config.js --only staging

# Verify startup
curl https://staging.dealos.io/health
# Expected: { status: "ok", kernelStatus: 200 }
```

### 3. Email Configuration Testing

```bash
# Test Sendgrid connection
curl -X POST https://api.sendgrid.com/v3/mail/send \
  -H "Authorization: Bearer $BFF_LP_INVITATION_EMAIL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "personalizations": [{"to": [{"email": "test@example.com"}], "subject": "Test"}],
    "from": {"email": "noreply@dealos.io"},
    "content": [{"type": "text/html", "value": "<p>Test</p>"}]
  }'
```

### 4. Webhook Configuration Testing

```bash
# Send test webhook
curl -X POST https://your-webhook-handler.example.com/webhooks/lp \
  -H "X-LP-Webhook-Secret: your-webhook-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "LP_TEST_EVENT",
    "detail": {"test": true},
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "source": "canonical-bff"
  }'
```

### 5. Run Staging Tests

```bash
# Run full test suite
npm test

# Run LP-specific tests
npm test -- --testPathPattern=lp-onboarding

# Run integration tests against staging
./test-lp-endpoints.sh staging
```

---

## Production Deployment

### 1. Pre-Deployment Review

```bash
# Create deployment checklist
# [ ] All staging tests passed
# [ ] Security audit completed
# [ ] Performance baseline established
# [ ] Database backups automated
# [ ] Rollback procedure documented
# [ ] Team notified
```

### 2. Database Migration (Production)

```bash
# Backup production database FIRST
pg_dump $PROD_DATABASE_URL > backup-$(date +%Y%m%d-%H%M%S).sql

# Run migration with transaction isolation
export BFF_DB_URL=$PROD_DATABASE_URL
npx prisma db push --schema server/prisma/schema.prisma --skip-generate

# Verify migration
npx prisma db query "SELECT COUNT(*) FROM lpinvitation" > /dev/null && echo "Success"
```

### 3. Deploy Production

```bash
# Production deployment (example)
NODE_ENV=production npm run build

# Use production PM2 config
pm2 start ecosystem.config.js --only production

# Health check
for i in {1..5}; do
  curl https://dealos.io/health && echo "OK" && break
  sleep 2
done
```

### 4. Smoke Tests (Production)

```bash
# Test core endpoints
./test-lp-endpoints.sh production

# Check logs
tail -f /var/log/bff/production.log | grep -i "error\|warning\|lp"

# Monitor response times
curl -w "@curl-format.txt" -o /dev/null -s https://dealos.io/api/lp/portal \
  -H "X-User-Id: test@example.com"
```

### 5. Monitoring & Alerts

```bash
# Set up monitoring (example with DataDog)
# Track these metrics:
# - lp.portal.landing.request_count
# - lp.portal.landing.response_time_ms
# - lp.invitation.created_count
# - lp.invitation.accepted_count
# - lp.webhook.success_rate
# - lp.email.success_rate
# - bff.error_rate

# Alert thresholds:
# - Email delivery failure rate > 5%
# - Webhook failure rate > 10%
# - Portal response time > 2 seconds
# - Database connection pool exhausted
```

---

## Testing & Validation

### Unit Tests

```bash
# Run all unit tests
npm test

# Run with coverage
npm test -- --coverage

# Run LP tests only
npm test -- lp-onboarding
```

### Integration Tests

```bash
# Start services
npm run dev:api &
npm run dev:bff &

# Run curl test script
chmod +x test-lp-endpoints.sh
./test-lp-endpoints.sh

# Expected output: All tests pass with HTTP 200/201
```

### Load Testing

```bash
# Install Apache Bench
apt-get install apache2-utils

# Test portal landing endpoint
ab -n 1000 -c 10 \
  -H "X-User-Id: test@example.com" \
  http://localhost:8787/api/lp/portal

# Expected: >95% success rate, <500ms average response time
```

### API Test Examples

#### 1. Send LP Invitation

```bash
curl -X POST http://localhost:8787/api/lp/invitations \
  -H "Content-Type: application/json" \
  -H "X-User-Id: gp-user-123" \
  -d '{
    "lpEntityName": "Acme Capital Partners",
    "lpEmail": "invest@acme.example.com",
    "dealId": "11111111-1111-1111-1111-111111111111",
    "commitment": 5000000,
    "ownershipPct": 10
  }'
```

#### 2. List Invitations

```bash
curl -X GET 'http://localhost:8787/api/lp/deals/11111111-1111-1111-1111-111111111111/invitations' \
  -H "X-User-Id: gp-user-123"
```

#### 3. Accept Invitation

```bash
curl -X POST http://localhost:8787/api/lp/invitations/{invitationId}/accept \
  -H "Content-Type: application/json" \
  -d '{}'
```

#### 4. LP Portal Landing

```bash
curl -X GET http://localhost:8787/api/lp/portal \
  -H "X-User-Id: invest@acme.example.com"
```

#### 5. Bulk Import

```bash
curl -X POST http://localhost:8787/api/lp/bulk-import \
  -H "Content-Type: application/json" \
  -H "X-User-Id: gp-user-123" \
  -d '{
    "dealId": "11111111-1111-1111-1111-111111111111",
    "investors": [
      {
        "lpEntityName": "Fund A",
        "lpEmail": "funda@example.com",
        "commitment": 2000000,
        "ownershipPct": 4
      },
      {
        "lpEntityName": "Fund B",
        "lpEmail": "fundb@example.com",
        "commitment": 3000000,
        "ownershipPct": 6
      }
    ]
  }'
```

#### 6. Generate Report

```bash
curl -X POST http://localhost:8787/api/lp/reports/generate \
  -H "Content-Type: application/json" \
  -H "X-User-Id: gp-user-123" \
  -d '{
    "dealId": "11111111-1111-1111-1111-111111111111",
    "reportType": "capital_statement",
    "filters": {
      "startDate": "2026-01-01T00:00:00Z",
      "endDate": "2026-12-31T23:59:59Z"
    }
  }' \
  -o capital-statement.json
```

---

## Monitoring & Observability

### Key Metrics to Track

```javascript
// In your monitoring system:
{
  // LP Portal Metrics
  "lp.portal.landing.hits": 0,
  "lp.portal.landing.response_time_ms": 0,
  "lp.portal.detail.hits": 0,
  "lp.portal.detail.response_time_ms": 0,
  
  // Invitation Metrics
  "lp.invitations.created": 0,
  "lp.invitations.accepted": 0,
  "lp.invitations.expired": 0,
  
  // Email Metrics
  "lp.email.sent": 0,
  "lp.email.failed": 0,
  "lp.email.latency_ms": 0,
  
  // Webhook Metrics
  "lp.webhook.sent": 0,
  "lp.webhook.failed": 0,
  "lp.webhook.latency_ms": 0,
  
  // Cache Metrics
  "lp.cache.hits": 0,
  "lp.cache.misses": 0,
  "lp.cache.hit_rate_pct": 0,
  
  // Database Metrics
  "lp.db.query_count": 0,
  "lp.db.query_time_ms": 0,
  "lp.db.connection_pool.available": 0
}
```

### Log Aggregation

Configure logs to capture:

```
[LP Onboarding] Invitation sent to {email} for deal {dealId}
[LP Onboarding] Invitation {id} accepted by {email}
[LP Onboarding] Email notification queued for {email}
[LP Onboarding] Webhook {eventType} failed ({status}): {error}
[LP Onboarding] Bulk import completed: {succeeded}/{total} succeeded
```

---

## Troubleshooting

### Email Not Sending

```bash
# Check if email endpoint is configured
echo $BFF_LP_INVITATION_EMAIL_ENDPOINT

# Check Sendgrid API key format
echo $BFF_LP_INVITATION_EMAIL_API_KEY | grep -o "^SG\."

# Test Sendgrid connectivity
curl -s https://api.sendgrid.com/v3/mail/send \
  -H "Authorization: Bearer $BFF_LP_INVITATION_EMAIL_API_KEY" \
  | jq '.errors'

# Check BFF logs
grep -i "email" /var/log/bff/production.log | tail -20
```

### Webhook Not Firing

```bash
# Check if webhook URL is configured
echo $BFF_LP_NOTIFICATION_WEBHOOK_URL

# Test webhook connectivity
curl -v -X POST $BFF_LP_NOTIFICATION_WEBHOOK_URL \
  -H "X-LP-Webhook-Secret: $BFF_LP_NOTIFICATION_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"eventType":"TEST","detail":{}}'

# Check webhook logs
tail -100 /var/log/webhooks.log | grep -i "lp\|error"
```

### Portal Slow Performance

```bash
# Check cache hit rate
grep -c "cache:lp-portal:landing" /var/log/bff/production.log

# Check Kernel response time
curl -w "\nTime: %{time_total}s\n" \
  http://kernel-api:3001/deals/test-deal

# Check database query performance
sqlite3 ./server/.data/llm-airlock.db ".mode line"
SELECT * FROM sqlite_stat1 WHERE tbl LIKE '%lp%';
```

### Database Issues

```bash
# Check SQLite database integrity
sqlite3 ./server/.data/llm-airlock.db "PRAGMA integrity_check;"

# Rebuild indices
sqlite3 ./server/.data/llm-airlock.db "REINDEX;"

# Verify schema
npx prisma introspect

# Check Prisma client version
npm list @prisma/client
```

---

## Rollback Procedure

If deployment issues occur:

```bash
# 1. Stop current deployment
pm2 stop all

# 2. Restore previous version
git checkout previous-tag
npm install

# 3. Restore database backup
psql $DATABASE_URL < backup-YYYYMMDD-HHMMSS.sql

# 4. Restart with previous version
pm2 start ecosystem.config.js

# 5. Verify health
curl https://dealos.io/health

# 6. Notify team and investigate
# Document what failed for postmortem
```

---

## Post-Deployment

### Day 1 (24 hours)

- [ ] Monitor error logs closely
- [ ] Check email delivery logs
- [ ] Verify webhook receipts
- [ ] Test all LP endpoints manually
- [ ] Check database connection pool

### Week 1

- [ ] Review performance metrics
- [ ] Check LP portal cache hit rates
- [ ] Verify all invitations sent successfully
- [ ] Review webhook delivery failures
- [ ] Check database growth rate

### Week 4 (Ongoing)

- [ ] Monthly capacity planning review
- [ ] Performance trend analysis
- [ ] Security audit log review
- [ ] Database maintenance (vacuum/analyze)
- [ ] Cost optimization review

---

## Support & Operations

### Escalation Path

1. **Tier 1** (Dev Team): Portal is slow, emails not sending
2. **Tier 2** (DevOps): Database issues, deployment failures
3. **Tier 3** (Architecture): Kernel integration issues, schema changes

### Contact Info

- **On-Call**: [PagerDuty schedule]
- **Slack**: #canonical-lp-onboarding
- **Repository**: [GitHub link]
- **Runbooks**: [Internal wiki]

---

## Appendix: Configuration Examples

### Docker Compose (Local Dev)

```yaml
version: "3.8"
services:
  bff:
    build: .
    ports:
      - "8787:8787"
    environment:
      BFF_DB_URL: file:./server/.data/llm-airlock.db
      KERNEL_API_URL: http://kernel:3001
      BFF_PUBLIC_URL: http://localhost:8787
      BFF_EMAIL_DEV_MODE: "true"
    depends_on:
      - kernel

  kernel:
    image: cre-kernel:latest
    ports:
      - "3001:3001"
    environment:
      DATABASE_URL: postgresql://user:pass@postgres:5432/cre_kernel
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: canonical-bff-lp
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: bff
        image: canonical-bff:v1.0.0
        ports:
        - containerPort: 8787
        env:
        - name: BFF_LP_INVITATION_EMAIL_API_KEY
          valueFrom:
            secretKeyRef:
              name: lp-onboarding
              key: sendgrid-api-key
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
```

---

**Last Updated**: January 14, 2026  
**Version**: 1.0.0  
**Status**: Production Ready
