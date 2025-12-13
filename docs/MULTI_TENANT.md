# CallScript V2 – Multi-Tenant Architecture

This document describes the multi-tenant architecture implemented in Phase 3.

---

## Overview

CallScript V2 supports multiple independent organizations, each with:
- Isolated data (calls, campaigns)
- Separate Ringba API credentials
- Role-based access control (owner, admin, reviewer)
- Automatic tenant context via JWT

---

## Database Schema

### Core Tables

```
core.organizations
├── id (UUID, PK)
├── name (TEXT)
├── slug (TEXT, UNIQUE) - URL-safe identifier
├── plan (TEXT) - trial, starter, pro, enterprise
├── is_active (BOOLEAN)
├── created_at, updated_at

core.organization_members
├── id (UUID, PK)
├── org_id (FK → organizations)
├── user_id (UUID → auth.users)
├── role (TEXT) - owner, admin, reviewer
├── invited_by (UUID)
├── accepted_at (TIMESTAMPTZ)
├── created_at

core.organization_credentials
├── id (UUID, PK)
├── org_id (FK → organizations)
├── provider (TEXT) - ringba, etc.
├── account_id (TEXT)
├── vault_secret_name (TEXT) - Reference to Vault
├── is_valid (BOOLEAN)
├── last_sync_at, last_error
├── UNIQUE(org_id, provider)
```

### Modified Tables

```
core.campaigns
├── org_id (UUID, NOT NULL, FK → organizations)
└── ... existing columns

core.calls
├── org_id (UUID, NOT NULL, FK → organizations)
└── ... existing columns
```

---

## Row-Level Security (RLS)

All tables have RLS enabled with policies that enforce tenant isolation:

### Helper Functions

```sql
-- Get org_id from JWT
core.current_org_id() → UUID

-- Check user role
core.user_has_role(required_roles TEXT[]) → BOOLEAN
```

### Policy Summary

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| organizations | Own org only | - | Owner only | - |
| organization_members | Own org | Admin+ | - | Admin+ |
| organization_credentials | Admin+ | Admin+ | Admin+ | Admin+ |
| campaigns | Own org | Admin+ | Admin+ | Admin+ |
| calls | Own org | - | Any member | - |

---

## Credential Management

### Storage Flow

1. User provides Ringba credentials during onboarding
2. `onboard-org` Edge Function validates credentials against Ringba API
3. Token stored in `organization_credentials` table
4. Edge Functions retrieve credentials via `core.get_org_credential()`

### Vault Functions

```sql
-- Store credential (called by onboard-org)
core.store_org_credential(org_id, provider, account_id, token) → UUID

-- Retrieve credential (called by workers)
core.get_org_credential(org_id, provider) → TABLE(account_id, token, is_valid, last_sync_at)

-- Mark invalid on API failure
core.mark_credential_invalid(org_id, provider, error) → VOID

-- Mark synced on success
core.mark_credential_synced(org_id, provider) → VOID

-- Get all active orgs for batch processing
core.get_active_org_credentials(provider) → TABLE(org_id, org_name, account_id, token)
```

---

## Authentication Flow

### JWT Structure

After login, the JWT contains:

```json
{
  "app_metadata": {
    "org_id": "uuid",
    "org_slug": "acme-corp",
    "org_name": "Acme Corp",
    "org_role": "owner"
  }
}
```

### Auth Hook

The `auth-hook` Edge Function runs on every login/token refresh:

1. Looks up user's organization membership
2. Verifies org is active
3. Injects org context into JWT app_metadata
4. RLS policies use this context automatically

**Setup Required:**
```
Supabase Dashboard → Authentication → Hooks → Custom Access Token Hook → auth-hook
```

---

## User Onboarding Flow

### API Endpoint

```
POST /functions/v1/onboard-org
Authorization: Bearer <user_jwt>
Content-Type: application/json

{
  "org_name": "Acme Corp",
  "ringba_account_id": "RAxxxxxxx",
  "ringba_token": "xxxxxxx"
}
```

### Response

```json
{
  "success": true,
  "org_id": "uuid",
  "slug": "acme-corp"
}
```

### Flow

1. Validate user is authenticated
2. Check user doesn't already have an org
3. Validate Ringba credentials (test API call)
4. Create organization
5. Add user as owner
6. Store credentials
7. Update user's JWT claims

---

## Edge Function Updates

### sync-ringba-realtime

Now includes `org_id` in all operations:

```typescript
// Campaign lookup includes org_id
.eq("org_id", orgId)

// Call inserts include org_id
const rows = records.map((r) => ({
  org_id: DEFAULT_ORG_ID,  // TODO: Make dynamic for multi-org ingest
  // ... other fields
}));
```

### Future: Multi-Org Batch Ingest

For production multi-tenant ingest:

```typescript
// Get all active orgs with credentials
const orgs = await supabase.rpc("get_active_org_credentials", { p_provider: "ringba" });

for (const org of orgs) {
  await syncOrgCalls(org.org_id, org.account_id, org.token);
}
```

---

## Indexes

Composite indexes ensure LIFO + tenant isolation is fast:

```sql
-- Primary queue index (tenant-scoped LIFO)
CREATE INDEX idx_calls_org_queue ON core.calls(org_id, status, start_time_utc DESC);

-- Campaign lookup by org
CREATE INDEX idx_campaigns_org ON core.campaigns(org_id);

-- Member lookup
CREATE INDEX idx_org_members_user ON core.organization_members(user_id);
CREATE INDEX idx_org_members_org ON core.organization_members(org_id);

-- Credential lookup
CREATE INDEX idx_org_credentials_org ON core.organization_credentials(org_id, provider);
```

---

## Migration History

| Migration | Description |
|-----------|-------------|
| 13_organizations.sql | Create org tables |
| 14_add_org_id.sql | Add org_id to campaigns/calls |
| 15_org_indexes.sql | Create composite indexes |
| 16_rls_policies.sql | Enable RLS + policies |
| 17_vault_functions.sql | Credential management functions |

---

## Default Organization

For backward compatibility, existing data was migrated to a default org:

```
ID: 00000000-0000-0000-0000-000000000001
Name: Default Organization
Slug: default
```

All 7,390 existing calls and 9 campaigns were backfilled with this org_id.

---

## Security Considerations

1. **Service Role Bypass**: Workers use `service_role` key which bypasses RLS
2. **Credential Isolation**: Each org's Ringba token is stored separately
3. **Role Enforcement**: Admin operations require `owner` or `admin` role
4. **Inactive Orgs**: Auth hook blocks JWT enrichment for disabled orgs

---

## Testing Multi-Tenancy

### Verify RLS

```sql
-- As authenticated user with wrong org_id (should return 0)
SET ROLE authenticated;
SET request.jwt.claims = '{"app_metadata": {"org_id": "00000000-0000-0000-0000-000000000099"}}';
SELECT COUNT(*) FROM core.calls;  -- Should be 0
RESET ROLE;
```

### Test Onboarding

```bash
curl -X POST "https://<project>.supabase.co/functions/v1/onboard-org" \
  -H "Authorization: Bearer <user_jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "org_name": "Test Org",
    "ringba_account_id": "RAtest",
    "ringba_token": "test_token"
  }'
```

---

## Future Enhancements

- [ ] Multi-org batch ingest (loop through all active orgs)
- [ ] Org-specific QA rules and prompts
- [ ] Usage metering per org
- [ ] Billing integration
- [ ] Org switching for users with multiple memberships
