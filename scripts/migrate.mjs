#!/usr/bin/env node
/**
 * Apply drizzle/ migrations — the first half of `pnpm build` (plan Task 1, ruling D).
 *
 *   node scripts/migrate.mjs           migrates only inside a Vercel build (VERCEL_ENV set);
 *                                      anywhere else it logs one line and exits 0
 *   node scripts/migrate.mjs --force   migrates wherever DATABASE_URL points (CI, local)
 *
 * When it runs, any failure exits 1, so a build never deploys against an unmigrated database.
 *
 * Baseline: a database built by `drizzle-kit push` has the v1 tables but no migration journal,
 * and drizzle's migrator would re-run 0000 over them. If `drizzle.__drizzle_migrations` is absent
 * (or empty) while `public.events` exists, 0000 and 0001 are first recorded as applied, using
 * drizzle's own bookkeeping (hash = sha256 of the file text, created_at = journal `when`).
 * Migrations from 0002 on are idempotent, so they apply cleanly on top of either shape.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));
const BASELINE_TAGS = ["0000_colossal_mach_iv", "0001_append_only_events"];
const KNOWN_ARGS = new Set(["--force"]);

/** @param {string[]} args @param {NodeJS.ProcessEnv} env */
function decide(args, env) {
  const unknown = args.filter((arg) => !KNOWN_ARGS.has(arg));
  if (unknown.length > 0) {
    return { kind: "usage", message: `migrate: unknown argument ${unknown.join(" ")}` };
  }
  const forced = args.includes("--force");
  const vercelEnv = env.VERCEL_ENV ?? "";
  if (!forced && vercelEnv === "") {
    return { kind: "skip" };
  }
  const url = env.DATABASE_URL ?? "";
  if (url === "") {
    return { kind: "usage", message: "migrate: DATABASE_URL is not set" };
  }
  return { kind: "run", url, reason: forced ? "--force" : `VERCEL_ENV=${vercelEnv}` };
}

/** @returns {{ tag: string, when: number }[]} */
function readJournal() {
  const raw = readFileSync(`${MIGRATIONS_FOLDER}/meta/_journal.json`, "utf8");
  return JSON.parse(raw).entries.map((/** @type {{ tag: string, when: number }} */ e) => ({
    tag: e.tag,
    when: e.when,
  }));
}

/** drizzle-orm's hash contract (drizzle-orm/migrator.js readMigrationFiles). */
function migrationHash(tag) {
  const text = readFileSync(`${MIGRATIONS_FOLDER}/${tag}.sql`).toString();
  return createHash("sha256").update(text).digest("hex");
}

/** @param {import("postgres").Sql} sql */
async function journalCount(sql) {
  const [{ present }] = await sql`
    SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present`;
  if (!present) return null;
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`;
  return n;
}

/**
 * Record 0000 and 0001 as applied on a push-built database. Returns the tags it recorded.
 * @param {import("postgres").Sql} sql
 */
async function baselinePushBuilt(sql, journal) {
  const [{ hasEvents }] = await sql`
    SELECT to_regclass('public.events') IS NOT NULL AS "hasEvents"`;
  const recorded = await journalCount(sql);
  if (!hasEvents || (recorded !== null && recorded > 0)) return [];

  const rows = BASELINE_TAGS.map((tag) => {
    const entry = journal.find((e) => e.tag === tag);
    if (!entry) throw new Error(`baseline migration ${tag} is missing from the journal`);
    return { hash: migrationHash(tag), createdAt: entry.when };
  });

  await sql.begin(async (tx) => {
    await tx`CREATE SCHEMA IF NOT EXISTS drizzle`;
    await tx`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
               id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`;
    for (const row of rows) {
      await tx`INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
               VALUES (${row.hash}, ${row.createdAt})`;
    }
  });
  return BASELINE_TAGS;
}

async function run(url) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const journal = readJournal();
    const baselined = await baselinePushBuilt(sql, journal);
    if (baselined.length > 0) {
      console.log(
        `migrate: baselined ${baselined.join(", ")} (database built by drizzle-kit push)`,
      );
    }
    const before = (await journalCount(sql)) ?? 0;
    await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS_FOLDER });
    const after = (await journalCount(sql)) ?? 0;
    const applied = after - before;
    console.log(
      applied > 0
        ? `migrate: applied ${applied} migration(s); ${journal.length} in the journal`
        : `migrate: up to date (${journal.length} migrations)`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const decision = decide(process.argv.slice(2), process.env);
if (decision.kind === "skip") {
  console.log("migrate: skipped — VERCEL_ENV is unset (not a Vercel build); pass --force to run");
} else if (decision.kind === "usage") {
  console.error(decision.message);
  process.exitCode = 1;
} else {
  try {
    await run(decision.url);
  } catch (err) {
    // Only the message: a driver error can carry connection details, never print the URL.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`migrate: failed (${decision.reason}): ${message}`);
    process.exitCode = 1;
  }
}
