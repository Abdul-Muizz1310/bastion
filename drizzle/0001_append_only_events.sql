-- Append-only enforcement for `events` (spec 00, cases 12-14).
--
-- Two layers, because neither alone is sufficient here:
--
--   1. Privileges. Revoking UPDATE/DELETE/TRUNCATE from PUBLIC stops any role
--      granted access to this schema later from mutating the log. It does NOT
--      constrain the table owner, which is the role the app connects as on
--      Neon (`neondb_owner`).
--
--   2. Triggers. A BEFORE UPDATE/DELETE/TRUNCATE trigger that RAISEs applies
--      to every role including the owner, and -- unlike a role-scoped GRANT --
--      needs no environment-specific role name, so it behaves identically on
--      Neon, on a CI service container, and locally.
--
-- Inserting and selecting are untouched: the log is append-only, not read-only.

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "events" FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "events_reject_mutation"() RETURNS trigger
	LANGUAGE plpgsql
	AS $$
BEGIN
	RAISE EXCEPTION 'events is append-only: % is not permitted', TG_OP
		USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "events_no_update" ON "events";
--> statement-breakpoint
CREATE TRIGGER "events_no_update"
	BEFORE UPDATE ON "events"
	FOR EACH ROW EXECUTE FUNCTION "events_reject_mutation"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "events_no_delete" ON "events";
--> statement-breakpoint
CREATE TRIGGER "events_no_delete"
	BEFORE DELETE ON "events"
	FOR EACH ROW EXECUTE FUNCTION "events_reject_mutation"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "events_no_truncate" ON "events";
--> statement-breakpoint
CREATE TRIGGER "events_no_truncate"
	BEFORE TRUNCATE ON "events"
	FOR EACH STATEMENT EXECUTE FUNCTION "events_reject_mutation"();
