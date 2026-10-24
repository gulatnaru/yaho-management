-- Read-only diagnostics for manual_test isolation verification
-- Run BEFORE any migration. No DDL, no DML, no ACL changes.
-- Execute as a privileged role (e.g. postgres or existing admin).

-- 1. DB fingerprint
SELECT current_database() AS database,
       current_user AS user,
       version() AS version;

-- 2. PUBLIC effective permissions on public schema
SELECT nspname AS schema,
       nspacl AS acl
FROM pg_namespace
WHERE nspname = 'public';

-- 3. Existing roles and inheritance
SELECT r.rolname AS role,
       r.rolsuper,
       r.rolinherit,
       r.rolcreaterole,
       ARRAY(SELECT b.rolname FROM pg_catalog.pg_auth_members m
             JOIN pg_catalog.pg_roles b ON m.roleid = b.oid
             WHERE m.member = r.oid) AS member_of
FROM pg_catalog.pg_roles r
WHERE r.rolname NOT LIKE 'pg_%'
ORDER BY r.rolname;

-- 4. Default privileges
SELECT * FROM information_schema.role_table_grants
WHERE grantee = 'PUBLIC' AND table_schema = 'public'
LIMIT 20;

-- 5. Table-level grants to PUBLIC in public schema
SELECT table_schema, table_name, privilege_type, grantee
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND grantee = 'PUBLIC'
ORDER BY table_name, privilege_type
LIMIT 50;

-- 6. Check if manual_test schema exists (should NOT exist yet)
SELECT schema_name FROM information_schema.schemata
WHERE schema_name = 'manual_test';

-- 7. Check if manual_test_role exists (should NOT exist yet)
SELECT rolname FROM pg_catalog.pg_roles
WHERE rolname = 'manual_test_role';

-- 8. RLS status on public tables (first 20)
SELECT schemaname, tablename, rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename
LIMIT 20;
