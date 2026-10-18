-- Safe rollback for manual_test schema
-- Removes ONLY objects created by migration.sql. No CASCADE on unrelated objects.
-- Run AFTER verifying no active sessions use manual_test_role.

-- Step 1: Verify what will be removed (read-only, run first)
-- SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'manual_test' ORDER BY tablename;
-- SELECT rolname FROM pg_roles WHERE rolname = 'manual_test_role';

-- Step 2: Terminate active sessions (requires privileged role)
-- SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'manual_test_role';

-- Step 3: Drop objects in dependency order (reverse of creation)
-- NOTE: Replace <table_list> with actual tables from migration.sql, in reverse FK dependency order.
-- Example pattern (DO NOT run without verifying against migration.sql):

-- DROP TABLE IF EXISTS manual_test.refund CASCADE;
-- DROP TABLE IF EXISTS manual_test.payment CASCADE;
-- DROP TABLE IF EXISTS manual_test.reservation CASCADE;
-- ... (all 29 tables in reverse dependency order)

-- Step 4: Drop schema (only if empty after table drops)
-- DROP SCHEMA IF EXISTS manual_test;

-- Step 5: Drop role (only after all objects removed)
-- DROP ROLE IF EXISTS manual_test_role;

-- Verification after rollback:
-- SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'manual_test'; -- should return 0 rows
-- SELECT rolname FROM pg_roles WHERE rolname = 'manual_test_role'; -- should return 0 rows
-- Verify public schema objects are untouched: compare pg_tables count before/after.
