# CallScript V2 – Active Task Scratchpad

## Last Session Summary (Dec 17, 2025)

### Completed
- Fixed multi-tenant data isolation (SECURITY INVOKER on views)
- Fixed credential storage for new orgs (settings fallback)
- Granted authenticated role access to core tables
- Pipeline health now showing "Operational"
- Ingest worker syncing 2 organizations

### Current State
- **Production:** https://callscript.io (Vercel)
- **Worker Server:** 213.192.2.124 port 40040 (RunPod)
- **Database:** Supabase (migrations up to 37)

### Known Issues
- Both orgs (CallScript Default + upbeat.chat) share same Ringba account
- upbeat.chat has 0 calls because calls go to first org that syncs
- If upbeat.chat needs separate data, they need different Ringba credentials

### Key Files Changed
- `supabase/migrations/30-37*.sql` - Security and permission fixes
- `app/api/health/route.ts` - Added detailed logging
- `app/api/settings/org/route.ts` - Multi-tenant settings with vault fallback

## Current Objective

(No active task)

## Plan

- [ ] Step 1:
- [ ] Step 2:
- [ ] Step 3:

## Immediate Next Step

(Awaiting user instructions)
