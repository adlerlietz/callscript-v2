-- =============================================================================
-- Migration 45: Grant USAGE on core schema to authenticated role
-- =============================================================================
-- Tables grants (SELECT, UPDATE, etc.) require USAGE on the schema first.
-- Without this, authenticated users get "permission denied for schema core".
-- =============================================================================

-- Grant USAGE on core schema to authenticated role
GRANT USAGE ON SCHEMA core TO authenticated;

-- Also grant to anon for any public views that query core
GRANT USAGE ON SCHEMA core TO anon;
