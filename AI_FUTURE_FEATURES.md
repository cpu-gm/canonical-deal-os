# AI Future Features (Cost-Adding)

These features would add additional OpenAI API costs. Implement when ready to invest in AI capabilities.

---

## Estimated Monthly Costs

| Feature Set | Est. Monthly Cost |
|-------------|-------------------|
| Current state (gpt-4o-mini) | ~$50-200 |
| + Sensitivity Analysis | +$50-100 |
| + Automated LP Updates | +$50-100 |
| + Multi-Document Synthesis | +$50-100 |
| + Vector RAG Upgrade | +$50-100 (embeddings) |
| + Portfolio Analytics | +$100-200 |
| **Full feature set** | **$400-800/month** |

---

## Phase 1: Security Hardening (No Additional Cost)

### 1.1 Prompt Injection Protection
- Input sanitization before LLM
- System prompt isolation
- Output validation for code/SQL injection
- Jailbreak attempt detection

**Files**:
- New: `server/services/ai-security.js`
- `server/routes/ai-assistant.js` - wrap all LLM calls

### 1.2 User Consent Management (GDPR)
- `AIConsent` table for tracking
- Consent UI in settings
- Block AI if consent not given
- Version tracking for policy changes

**Files**:
- Schema: Add AIConsent model
- New: `server/routes/ai-consent.js`
- Frontend: Settings consent toggle

### 1.3 Data Retention Policy
- Configurable retention periods
- Automated cleanup job for old AI logs
- Anonymization option
- Legal hold override

**Files**:
- New: `server/jobs/ai-data-cleanup.js`
- `ai-audit-logger.js` - add retention metadata

---

## Phase 2: High-Value GP Features

### 2.1 Sensitivity Analysis Automation
**Est. Cost**: +$50-100/month

**What**: Auto-generate sensitivity tables for cap rate, NOI, exit cap. Export to Excel.

**Value**: Saves 1-2 hours per deal. Every GP does this manually today.

**Files**:
- New: `server/services/sensitivity-analysis.js`
- New endpoint in `ai-assistant.js`
- Frontend: Sensitivity table component

### 2.2 Multi-Document Synthesis
**Est. Cost**: +$50-100/month

**What**: Cross-document data reconciliation. Identify discrepancies between:
- Rent roll vs T12 income
- OM figures vs actuals
- Broker claims vs verification

**Value**: Critical for due diligence. Catches misrepresentations.

**Files**:
- Extend: `server/services/conflict-detector.js`
- New: `server/services/document-synthesizer.js`

### 2.3 Automated LP Updates
**Est. Cost**: +$50-100/month

**What**: Template-based monthly/quarterly update generation with GP review workflow.

**Value**: LP communication is time-consuming. Improves LP satisfaction.

**Files**:
- New: `server/services/lp-update-generator.js`
- `server/routes/investor-updates.js` - add generation endpoint

---

## Phase 3: Advanced Features

### 3.1 Vector-Based RAG Upgrade
**Est. Cost**: +$50-100/month (embedding generation)

**What**: Replace keyword search with vector embeddings. Semantic search, chunk-level retrieval.

**Options**:
- pgvector (PostgreSQL extension) - free, self-hosted
- Pinecone/Weaviate (managed) - $70-200/month
- FAISS/Chroma (local) - free

**Value**: Much better answer quality. Finds relevant data keyword search misses.

**Files**:
- Rewrite: `server/services/rag-citation-service.js`
- New: `server/services/embedding-service.js`
- New: `server/jobs/document-embedding.js`

### 3.2 Portfolio Analytics AI
**Est. Cost**: +$100-200/month

**What**: Cross-deal aggregation, portfolio metrics, natural language queries across portfolio.

**Value**: GPs with 10+ deals need portfolio view. Currently requires Excel consolidation.

**Files**:
- New: `server/services/portfolio-analytics.js`
- New: `server/routes/portfolio-ai.js`

### 3.3 Compliance Monitoring
**Est. Cost**: +$50-100/month

**What**: Loan covenant tracking, DSCR/LTV threshold alerts, automated compliance reports.

**Value**: Covenant violations are expensive. Early warning enables corrective action.

**Files**:
- New: `server/services/covenant-monitor.js`
- New: `server/jobs/covenant-check.js`

### 3.4 Market Data Integration
**Est. Cost**: +$100-500/month (data provider fees + LLM calls)

**What**: Integration with market data providers (CoStar, REIS, etc.)
- Market comp analysis
- Submarket trend interpretation
- Auto-populate market section of memos
- Cap rate comparisons to recent trades

**Value**: Currently manual market research. Faster underwriting.

**Files**:
- New: `server/integrations/market-data/`
- `server/services/deal-context-builder.js` - add market context
- `server/services/deal-insights.js` - market-based insights

---

## Pricing Considerations

If you want to charge users for AI features:

### Option 1: Tiered Plans
- **Basic**: No AI features
- **Pro**: Core AI (chat, insights, summaries) - +$50-100/seat/month
- **Enterprise**: Full AI + portfolio analytics - +$150-300/seat/month

### Option 2: Usage-Based
- Per AI request pricing (complex to implement)
- Token-based pricing passed through

### Option 3: Feature Add-ons
- Sensitivity Analysis: +$25/deal
- LP Updates: +$50/month per fund
- Portfolio Analytics: +$200/month

---

## Implementation Priority (When Ready)

1. **Sensitivity Analysis** - High value, moderate cost, reusable
2. **Automated LP Updates** - High value for LP satisfaction
3. **Vector RAG** - Improves all existing AI quality
4. **Portfolio Analytics** - For multi-deal GPs
5. **Market Integration** - Requires data provider contracts
