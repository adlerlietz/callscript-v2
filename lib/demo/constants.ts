/**
 * Demo Mode Constants
 *
 * Used by /demo routes and /api/demo endpoints to provide
 * a public demo experience with isolated sample data.
 */

// Demo organization UUID - matches 62_demo_org_seed_data.sql
export const DEMO_ORG_ID = "00000000-0000-0000-0000-000000000002";

// Demo org metadata
export const DEMO_ORG_NAME = "Demo Company";
export const DEMO_ORG_SLUG = "demo";

// Demo auth context (used in place of real auth for demo API routes)
export const DEMO_AUTH_CONTEXT = {
  userId: "demo-user-001",
  orgId: DEMO_ORG_ID,
  orgSlug: DEMO_ORG_SLUG,
  orgName: DEMO_ORG_NAME,
  role: "reviewer" as const,
  isDemo: true,
};
