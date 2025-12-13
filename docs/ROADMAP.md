# CallScript V2 – Project Roadmap

## Current Status Overview

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 0 | ✅ Complete | Repo & Governance |
| Phase 1 | ✅ Complete | Database Schema & Migrations |
| Phase 2 | ✅ Complete | Ingest + Vault Edge Functions |
| Phase 3 | ✅ Complete | Multi-Tenant Architecture |
| Phase 4 | 🚧 Partial | Factory Lane (GPU Workers) |
| Phase 5 | ❌ Not Started | Judge Lane (QA Analysis) |
| Phase 6 | 🚧 Partial | Frontend (Basic skeleton exists) |
| Phase 7 | ❌ Not Started | Auth & User Management |
| Phase 8 | ❌ Not Started | Polish & Launch |

---

## What's Working Now

| Component | Status | Notes |
|-----------|--------|-------|
| Ringba Ingest | ✅ Working | `sync-ringba-realtime` - syncs call metadata |
| Audio Vault | ✅ Working | `recording-watcher` - downloads audio to storage |
| Multi-Tenant DB | ✅ Working | RLS, org isolation, credential storage |
| Auth Hook | ✅ Deployed | Needs dashboard config to activate |
| Onboarding API | ✅ Deployed | User signup with Ringba validation |
| Dashboard | 🚧 Basic | Shows recording coverage only |
| Transcription | ❌ Not Working | Worker code exists but not deployed |
| QA Flagging | ❌ Not Working | `analyze-qa` function not built |

---

## Phase 4: Factory Lane (GPU Workers)

**Goal:** Transcribe downloaded audio using WhisperX + Pyannote on RunPod GPU

### Tasks

| Task | Priority | Complexity | Description |
|------|----------|------------|-------------|
| 4.1 RunPod Setup | High | Medium | Provision RTX 3090, configure network storage |
| 4.2 Worker Script | High | High | Integrate WhisperX + Pyannote for transcription |
| 4.3 Queue Integration | High | Medium | LIFO polling with `FOR UPDATE SKIP LOCKED` |
| 4.4 Multi-Tenant Support | High | Medium | Workers must respect org_id context |
| 4.5 Startup Scripts | Medium | Low | `start_factory.sh` for 4x concurrent workers |
| 4.6 Health Monitoring | Medium | Medium | Integrate with watchdog/alerts |

### Files to Create/Update

```
workers/
├── factory/
│   ├── transcribe.py      # WhisperX integration
│   ├── diarize.py         # Pyannote speaker detection
│   └── worker.py          # Main processing loop
├── start_factory.sh       # Launch script
└── requirements.txt       # Dependencies
```

### Exit Criteria

- [ ] Worker pulls `status='downloaded'` calls (LIFO)
- [ ] Transcribes audio with WhisperX
- [ ] Diarizes speakers with Pyannote
- [ ] Updates DB: `status='transcribed'`, `transcript_text`, `transcript_segments`
- [ ] Handles errors gracefully (retry_count, failed status)

---

## Phase 5: Judge Lane (QA Analysis)

**Goal:** Analyze transcripts with GPT-4o-mini to detect compliance violations

### Tasks

| Task | Priority | Complexity | Description |
|------|----------|------------|-------------|
| 5.1 analyze-qa Function | High | Medium | Edge function calling OpenAI |
| 5.2 QA Rules Engine | High | Medium | Per-vertical rule injection |
| 5.3 Flag Schema | High | Low | Define qa_flags JSONB structure |
| 5.4 Batch Processing | Medium | Medium | Process multiple transcripts per invocation |
| 5.5 Cost Tracking | Low | Low | Log token usage per call |

### Files to Create

```
supabase/functions/analyze-qa/
└── index.ts               # GPT-4o-mini QA analysis

supabase/migrations/
└── 18_qa_rules.sql        # QA rules table (optional)
```

### QA Flag Structure

```typescript
interface QAFlag {
  rule_id: string;           // e.g., "TCPA_CONSENT"
  severity: "critical" | "warning" | "info";
  confidence: number;        // 0-100
  evidence: string;          // Quote from transcript
  timestamp_start?: number;  // Audio timestamp
  timestamp_end?: number;
}
```

### Exit Criteria

- [ ] Function processes `status='transcribed'` calls
- [ ] Sends transcript + rules to GPT-4o-mini
- [ ] Parses response into structured flags
- [ ] Updates DB: `status='flagged'|'safe'`, `qa_flags`
- [ ] Respects rate limits and handles errors

---

## Phase 6: Frontend - Core Pages

**Goal:** Build the main user interface for reviewing flagged calls

### Tasks

| Task | Priority | Complexity | Description |
|------|----------|------------|-------------|
| 6.1 Auth Pages | High | Medium | Login, logout, session management |
| 6.2 Dashboard Upgrade | High | Medium | KPIs, queue health, charts |
| 6.3 Flags Queue | High | High | Table of flagged calls with actions |
| 6.4 Call Workspace | High | High | Audio player, transcript viewer, flag cards |
| 6.5 Settings Page | Medium | Medium | Rule editor, campaign mapping |
| 6.6 Responsive Design | Medium | Low | Mobile-friendly layouts |

### Files to Create/Update

```
app/
├── login/
│   └── page.tsx           # Login form
├── dashboard/
│   └── page.tsx           # KPI dashboard (upgrade)
├── flags/
│   └── page.tsx           # Flagged calls queue
├── calls/
│   └── [id]/
│       └── page.tsx       # Call workspace
├── settings/
│   └── page.tsx           # Configuration
├── components/
│   ├── AudioPlayer.tsx    # Waveform player
│   ├── TranscriptView.tsx # Searchable transcript
│   ├── FlagCard.tsx       # QA flag display
│   ├── CallsTable.tsx     # Sortable data table
│   └── KPICard.tsx        # Metric display
└── lib/
    ├── supabase.ts        # Client setup
    └── hooks/
        ├── useAuth.ts     # Auth state
        └── useCalls.ts    # Data fetching
```

### Page Specifications

#### `/flags` - Work Queue

| Column | Description |
|--------|-------------|
| Severity | Critical/Warning badge |
| Campaign | Campaign name |
| Duration | Call length |
| Flag Summary | First flag evidence snippet |
| Time | When flagged |
| Actions | Mark Safe / Confirm Bad |

#### `/calls/[id]` - Workspace

| Section | Description |
|---------|-------------|
| Header | Campaign, duration, revenue, status |
| Audio Player | Waveform with playhead, skip to timestamp |
| Transcript | Speaker-labeled, searchable, click-to-seek |
| QA Flags | List of flags with evidence highlights |
| Actions | Mark Safe / Confirm Bad / Add Note |

### Exit Criteria

- [ ] Login works with Supabase Auth
- [ ] Dashboard shows real KPIs from database
- [ ] Flags page lists all `status='flagged'` calls
- [ ] Call workspace plays audio and shows transcript
- [ ] Actions update call status in database

---

## Phase 7: Auth & User Management

**Goal:** Secure multi-tenant authentication and user onboarding

### Tasks

| Task | Priority | Complexity | Description |
|------|----------|------------|-------------|
| 7.1 Enable Auth Hook | High | Low | Dashboard config for JWT injection |
| 7.2 Signup Flow | High | Medium | Email invite or open signup |
| 7.3 Onboarding UI | High | Medium | Org creation wizard |
| 7.4 Role Management | Medium | Medium | Owner/Admin/Reviewer permissions |
| 7.5 Team Invites | Low | Medium | Invite members by email |

### Files to Create

```
app/
├── signup/
│   └── page.tsx           # New user registration
├── onboarding/
│   └── page.tsx           # Org setup wizard
├── team/
│   └── page.tsx           # Member management
└── components/
    └── OnboardingWizard.tsx
```

### Exit Criteria

- [ ] Users can sign up and create organization
- [ ] Ringba credentials validated during onboarding
- [ ] JWT contains org_id after login
- [ ] RLS enforces data isolation
- [ ] Users see only their org's calls

---

## Phase 8: Polish & Launch

**Goal:** Production hardening, monitoring, and deployment

### Tasks

| Task | Priority | Complexity | Description |
|------|----------|------------|-------------|
| 8.1 Error Handling | High | Medium | Global error boundaries, logging |
| 8.2 Loading States | High | Low | Skeletons, spinners everywhere |
| 8.3 Performance | Medium | Medium | Query optimization, caching |
| 8.4 Monitoring | Medium | Medium | Sentry, Vercel Analytics |
| 8.5 Documentation | Low | Low | User guide, API docs |
| 8.6 Domain Setup | Low | Low | Custom domain, SSL |

### Exit Criteria

- [ ] No unhandled errors in production
- [ ] All pages have proper loading/error states
- [ ] Database queries are optimized
- [ ] Monitoring alerts configured
- [ ] Live on production domain

---

## Recommended Execution Order

```
Phase 4 (Factory) ─┬─→ Phase 5 (Judge) ─→ Phase 8 (Launch)
                   │
Phase 6 (Frontend) ┴─→ Phase 7 (Auth) ──→
```

### Sprint Plan

| Sprint | Duration | Focus |
|--------|----------|-------|
| Sprint 1 | 3-5 days | Phase 4: Get transcription working |
| Sprint 2 | 2-3 days | Phase 5: Build QA analysis |
| Sprint 3 | 5-7 days | Phase 6: Core frontend pages |
| Sprint 4 | 2-3 days | Phase 7: Auth and onboarding |
| Sprint 5 | 2-3 days | Phase 8: Polish and launch |

**Total Estimated Effort: 2-3 weeks**

---

## Quick Start Commands

```bash
# Frontend development
npm run dev

# Deploy Edge Function
supabase functions deploy <function-name>

# Run database migration
supabase db push

# Check Supabase logs
supabase functions logs <function-name>
```

---

## Key Decisions Needed

1. **Signup Model:** Open signup or invite-only?
2. **Pricing Tiers:** What limits per plan (calls/month)?
3. **QA Rules:** Start with generic rules or vertical-specific?
4. **GPU Provider:** RunPod vs Modal vs self-hosted?
5. **Domain:** What's the production URL?
