-- Tenant isolation and the append-only audit trail.
-- The API connects as a login role that is a member of app_rw and is not a superuser.
-- Each request runs inside a transaction that sets app.org_id; the policies below compare against it.
-- With no app.org_id set, current_setting returns NULL and no row matches.

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rw;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
--> statement-breakpoint
CREATE FUNCTION app_org_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.org_id', true), '')::uuid
$$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'contractors','memberships','projects','project_members','buildings','locations','issue_counters',
    'issues','templates','inspections','inspection_items','ncrs','comments','attachments','activities',
    'notifications','access_links','daily_reports','custom_fields','custom_field_values','applied_mutations'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id())', t);
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON organizations USING (id = app_org_id()) WITH CHECK (id = app_org_id());
--> statement-breakpoint
-- Audit trail: rows can be added and read, never changed or removed, by any role.
CREATE FUNCTION activities_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'activities is append-only' USING ERRCODE = 'restrict_violation';
END $$;
--> statement-breakpoint
CREATE TRIGGER activities_no_change BEFORE UPDATE OR DELETE ON activities
  FOR EACH ROW EXECUTE FUNCTION activities_append_only();
--> statement-breakpoint
CREATE TRIGGER activities_no_truncate BEFORE TRUNCATE ON activities
  FOR EACH STATEMENT EXECUTE FUNCTION activities_append_only();
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON activities FROM app_rw;
