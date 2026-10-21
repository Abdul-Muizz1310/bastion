import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Plan Task 1 / spec 21 §6.3 — `scripts/migrate.mjs`, run against a real Postgres.
 *
 * Every scenario gets its own scratch database (created and dropped here), so this spec never
 * touches the tables the other integration specs read. It drives the script the way a build
 * does — as a child process — so the gate, the baseline and drizzle's migrator are tested
 * composed, not in isolation.
 *
 * Skips when DATABASE_URL is unset. Point it at a disposable server (CI's service container
 * or `docker run -p 5433:5432 -e POSTGRES_PASSWORD=pg postgres:16`), never at Neon: the
 * connecting role needs CREATE DATABASE.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const ROOT = resolve(__dirname, "../../..");
const SCRIPT = resolve(ROOT, "scripts/migrate.mjs");
const DRIZZLE = resolve(ROOT, "drizzle");

type JournalEntry = { idx: number; when: number; tag: string };
const journal = JSON.parse(readFileSync(resolve(DRIZZLE, "meta/_journal.json"), "utf8")) as {
  entries: JournalEntry[];
};

const V2_TABLES = [
  "dossier_documents",
  "dossier_events",
  "dossier_steps",
  "dossiers",
  "events",
  "evidence_items",
  "magic_links",
  "receipts",
  "sessions",
  "users",
];

const REJECTED = /append-only/i;

/** The bookkeeping drizzle itself writes: sha256 of the file text, `created_at` = journal `when`. */
function expectedJournal(): { hash: string; created_at: string }[] {
  return journal.entries.map((entry) => ({
    hash: createHash("sha256")
      .update(readFileSync(resolve(DRIZZLE, `${entry.tag}.sql`)).toString())
      .digest("hex"),
    created_at: String(entry.when),
  }));
}

function statementsOf(tag: string): string[] {
  return readFileSync(resolve(DRIZZLE, `${tag}.sql`), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

type Run = { code: number; stdout: string; stderr: string };

function runMigrate(
  url: string,
  args: string[],
  extraEnv: Record<string, string> = {},
): Promise<Run> {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv, DATABASE_URL: url };
  if (!("VERCEL_ENV" in extraEnv)) delete env.VERCEL_ENV;
  return new Promise((done) => {
    execFile(process.execPath, [SCRIPT, ...args], { env, cwd: ROOT }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
      done({ code, stdout, stderr });
    });
  });
}

describe.skipIf(!DATABASE_URL)("migrate.mjs: the v2 schema on a real Postgres", () => {
  const suffix = randomBytes(4).toString("hex");
  const names = {
    empty: `mig_empty_${suffix}`,
    pushed: `mig_pushed_${suffix}`,
    emptyJournal: `mig_emptyjournal_${suffix}`,
    gate: `mig_gate_${suffix}`,
  };
  type Db = keyof typeof names;

  let admin: ReturnType<typeof postgres>;
  const conns = new Map<Db, ReturnType<typeof postgres>>();
  const urls = new Map<Db, string>();

  function db(name: Db): ReturnType<typeof postgres> {
    const conn = conns.get(name);
    if (!conn) throw new Error(`no connection for ${name}`);
    return conn;
  }

  function url(name: Db): string {
    const value = urls.get(name);
    if (!value) throw new Error(`no url for ${name}`);
    return value;
  }

  async function tables(name: Db): Promise<string[]> {
    const rows = await db(name)<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`;
    return rows.map((r) => r.table_name);
  }

  async function journalRows(name: Db): Promise<{ hash: string; created_at: string }[]> {
    const rows = await db(name)<{ hash: string; created_at: string }[]>`
      SELECT hash, created_at::text AS created_at FROM drizzle.__drizzle_migrations ORDER BY id`;
    return rows.map((r) => ({ hash: r.hash, created_at: r.created_at }));
  }

  async function columns(name: Db): Promise<string[]> {
    const rows = await db(name)<{ c: string }[]>`
      SELECT table_name || '.' || column_name || ':' || data_type || ':' || is_nullable
             || ':' || coalesce(column_default, '') AS c
      FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1`;
    return rows.map((r) => r.c);
  }

  /** The v1 schema as `drizzle-kit push` left it on Neon: every table, no migration journal. */
  async function buildV1WithoutJournal(name: Db): Promise<void> {
    for (const statement of statementsOf("0000_colossal_mach_iv")) {
      await db(name).unsafe(statement);
    }
  }

  async function seedV1Rows(name: Db): Promise<void> {
    const sql = db(name);
    await sql`INSERT INTO users (id, email, role)
              VALUES ('11111111-1111-4111-8111-111111111111', 'admin@example.com', 'admin')`;
    await sql`INSERT INTO dossiers (id, user_id, claim, sources, mode, status, request_id)
              VALUES ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111',
                      'v1 claim', ARRAY['hn'], 'rapid', 'succeeded', 'req-v1')`;
    await sql`INSERT INTO evidence_items (dossier_id, source, stable_id, url, title, content_hash)
              VALUES ('22222222-2222-4222-8222-222222222222', 'hn', 'hn:1',
                      'https://news.example/1', 'v1 title', 'abc')`;
    await sql`INSERT INTO events (actor_id, action, entity_type, entity_id)
              VALUES ('11111111-1111-4111-8111-111111111111', 'dossier.created', 'dossier',
                      '22222222-2222-4222-8222-222222222222')`;
  }

  beforeAll(async () => {
    admin = postgres(DATABASE_URL as string, { max: 1, onnotice: () => {} });
    for (const [key, dbName] of Object.entries(names) as [Db, string][]) {
      await admin.unsafe(`CREATE DATABASE "${dbName}"`);
      const target = new URL(DATABASE_URL as string);
      target.pathname = `/${dbName}`;
      urls.set(key, target.toString());
      conns.set(key, postgres(target.toString(), { max: 1, onnotice: () => {} }));
    }
  });

  afterAll(async () => {
    for (const conn of conns.values()) await conn.end({ timeout: 5 });
    for (const dbName of Object.values(names)) {
      await admin?.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    }
    await admin?.end({ timeout: 5 });
  });

  describe("an empty database", () => {
    it("migrate creates every table and records every migration", async () => {
      const run = await runMigrate(url("empty"), ["--force"]);
      expect(run.stderr).toBe("");
      expect(run.code).toBe(0);
      expect(run.stdout).not.toMatch(/baseline/i);
      expect(await tables("empty")).toEqual(V2_TABLES);
      expect(await journalRows("empty")).toEqual(expectedJournal());
    });
  });

  describe("a database built by drizzle-kit push of the v1 schema (no journal)", () => {
    beforeAll(async () => {
      await buildV1WithoutJournal("pushed");
      await seedV1Rows("pushed");
    });

    it("starts with the v1 tables and no journal", async () => {
      const [{ journal: present }] = await db("pushed")<{ journal: boolean }[]>`
        SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS journal`;
      expect(present).toBe(false);
      expect(await tables("pushed")).not.toContain("dossier_steps");
    });

    it("baselines 0000 and 0001, then applies 0002", async () => {
      const run = await runMigrate(url("pushed"), ["--force"]);
      expect(run.stderr).toBe("");
      expect(run.code).toBe(0);
      expect(run.stdout).toMatch(/baselined 0000_colossal_mach_iv, 0001_append_only_events/);
      expect(await journalRows("pushed")).toEqual(expectedJournal());
      expect(await tables("pushed")).toEqual(V2_TABLES);
    });

    it("keeps every v1 row as it was", async () => {
      const sql = db("pushed");
      const [dossier] = await sql`SELECT user_id, claim, visitor, error FROM dossiers`;
      expect(dossier).toEqual({
        user_id: "11111111-1111-4111-8111-111111111111",
        claim: "v1 claim",
        visitor: null,
        error: null,
      });
      const [evidence] = await sql`SELECT url, title, kind, locator FROM evidence_items`;
      expect(evidence).toEqual({
        url: "https://news.example/1",
        title: "v1 title",
        kind: null,
        locator: null,
      });
      const [event] = await sql`SELECT actor_id, actor FROM events`;
      expect(event).toEqual({ actor_id: "11111111-1111-4111-8111-111111111111", actor: null });
    });
  });

  describe("a journal table that exists but is empty", () => {
    beforeAll(async () => {
      await buildV1WithoutJournal("emptyJournal");
      const sql = db("emptyJournal");
      await sql`CREATE SCHEMA drizzle`;
      await sql`CREATE TABLE drizzle.__drizzle_migrations (
                  id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`;
    });

    it("is baselined too, instead of re-running 0000 over existing tables", async () => {
      const run = await runMigrate(url("emptyJournal"), ["--force"]);
      expect(run.stderr).toBe("");
      expect(run.code).toBe(0);
      expect(run.stdout).toMatch(/baselined/);
      expect(await journalRows("emptyJournal")).toEqual(expectedJournal());
    });
  });

  describe("the build gate", () => {
    it("runs without --force when VERCEL_ENV is set (a Vercel build)", async () => {
      const run = await runMigrate(url("gate"), [], { VERCEL_ENV: "preview" });
      expect(run.stderr).toBe("");
      expect(run.code).toBe(0);
      expect(await tables("gate")).toEqual(V2_TABLES);
    });
  });

  describe.each(["empty", "pushed", "emptyJournal"] as const)("after migrating (%s)", (name) => {
    it("a second run is a no-op", async () => {
      const journalBefore = await journalRows(name);
      const columnsBefore = await columns(name);
      const run = await runMigrate(url(name), ["--force"]);
      expect(run.stderr).toBe("");
      expect(run.code).toBe(0);
      expect(run.stdout).not.toMatch(/baseline/i);
      expect(await journalRows(name)).toEqual(journalBefore);
      expect(await columns(name)).toEqual(columnsBefore);
    });

    it("events still rejects UPDATE, DELETE and TRUNCATE", async () => {
      const sql = db(name);
      const [{ id }] = await sql<{ id: string }[]>`
        INSERT INTO events (actor, action, entity_type, entity_id)
        VALUES ('bastion', 'test.append_only_probe', 'test', 'probe') RETURNING id`;
      await expect(sql`UPDATE events SET action = 'tampered' WHERE id = ${id}`).rejects.toThrow(
        REJECTED,
      );
      await expect(sql`DELETE FROM events WHERE id = ${id}`).rejects.toThrow(REJECTED);
      await expect(sql`TRUNCATE TABLE events`).rejects.toThrow(REJECTED);
      const rows = await sql`SELECT action FROM events WHERE id = ${id}`;
      expect(rows).toEqual([{ action: "test.append_only_probe" }]);
    });

    it("a v2 dossier needs no user, and its steps, documents and receipts follow it", async () => {
      const sql = db(name);
      const [{ id }] = await sql<{ id: string }[]>`
        INSERT INTO dossiers (visitor, claim, sources, mode, status, request_id)
        VALUES ('v_kk6eooepno', 'v2 claim', ARRAY[]::text[], 'standard', 'pending', ${`req-${name}`})
        RETURNING id`;

      await sql`INSERT INTO dossier_steps (dossier_id, stage, status) VALUES (${id}, 'wake', 'pending')`;
      const [step] = await sql`
        SELECT attempt, lease_until = 'epoch'::timestamptz AS at_epoch,
               not_before <= now() AS due, output, started_at, finished_at, error
        FROM dossier_steps WHERE dossier_id = ${id}`;
      expect(step).toEqual({
        attempt: 0,
        at_epoch: true,
        due: true,
        output: {},
        started_at: null,
        finished_at: null,
        error: null,
      });
      await expect(
        sql`INSERT INTO dossier_steps (dossier_id, stage, status) VALUES (${id}, 'wake', 'pending')`,
      ).rejects.toThrow(/duplicate key/);

      await sql`INSERT INTO dossier_documents (dossier_id, document_id, kind)
                VALUES (${id}, 'doc-1', 'sample')`;
      await expect(
        sql`INSERT INTO dossier_documents (dossier_id, document_id, kind)
            VALUES (${id}, 'doc-1', 'sample')`,
      ).rejects.toThrow(/duplicate key/);
      await sql`INSERT INTO receipts (dossier_id, kind, ref, hash)
                VALUES (${id}, 'certificate', 'cert-1', 'h')`;
      await sql`INSERT INTO evidence_items (dossier_id, source, stable_id, content_hash, kind)
                VALUES (${id}, 'doc-1', 'e1', 'h', 'passage')`;
      const [evidence] = await sql`SELECT url, title FROM evidence_items WHERE dossier_id = ${id}`;
      expect(evidence).toEqual({ url: "", title: "" });

      await sql`DELETE FROM dossiers WHERE id = ${id}`;
      for (const table of ["dossier_steps", "dossier_documents", "receipts", "evidence_items"]) {
        const [{ n }] = await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM ${sql(table)} WHERE dossier_id = ${id}`;
        expect(n, table).toBe(0);
      }
    });

    it("a step, document or receipt cannot point at a dossier that does not exist", async () => {
      const sql = db(name);
      const ghost = "33333333-3333-4333-8333-333333333333";
      await expect(
        sql`INSERT INTO dossier_steps (dossier_id, stage, status) VALUES (${ghost}, 'wake', 'pending')`,
      ).rejects.toThrow(/foreign key/);
      await expect(
        sql`INSERT INTO dossier_documents (dossier_id, document_id, kind)
            VALUES (${ghost}, 'doc-1', 'upload')`,
      ).rejects.toThrow(/foreign key/);
      await expect(
        sql`INSERT INTO receipts (dossier_id, kind) VALUES (${ghost}, 'perf')`,
      ).rejects.toThrow(/foreign key/);
    });
  });
});
