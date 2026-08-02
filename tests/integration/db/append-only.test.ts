import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Spec 00 — cases 12, 13, 14.
 *
 * The append-only guarantee sold by README/WHY/ARCHITECTURE is a *database*
 * guarantee, so it can only be proven against a real database. This tier runs
 * against whatever Postgres `DATABASE_URL` points at, after
 * `pnpm drizzle-kit migrate` has applied drizzle/0001_append_only_events.sql.
 *
 * Two properties of this spec matter:
 *   - it SKIPS when DATABASE_URL is unset, so a checkout without a database
 *     still runs a green suite;
 *   - every statement runs inside one transaction that is rolled back, so it
 *     is safe to point at a shared branch — the audit log it probes is never
 *     actually written to.
 */

const DATABASE_URL = process.env.DATABASE_URL;

const REJECTED = /append-only|permission denied/i;

describe.skipIf(!DATABASE_URL)("00-schema: events is append-only at the database level", () => {
  let sql: ReturnType<typeof postgres>;
  let tx: Awaited<ReturnType<ReturnType<typeof postgres>["reserve"]>>;
  let probeId: string;

  /** Run a statement expected to be rejected, without poisoning the outer transaction. */
  async function rejectedBy(run: () => Promise<unknown>): Promise<unknown> {
    await tx`SAVEPOINT attempt`;
    try {
      const result = await run();
      await tx`RELEASE SAVEPOINT attempt`;
      return result;
    } catch (err) {
      await tx`ROLLBACK TO SAVEPOINT attempt`;
      throw err;
    }
  }

  beforeAll(async () => {
    sql = postgres(DATABASE_URL as string, { max: 1, onnotice: () => {} });
    tx = await sql.reserve();
    await tx`BEGIN`;
    const rows = await tx<{ id: string }[]>`
      INSERT INTO events (action, entity_type, entity_id, service, metadata)
      VALUES ('test.append_only_probe', 'test', ${`probe-${Date.now()}`}, 'bastion', '{}'::jsonb)
      RETURNING id
    `;
    probeId = String(rows[0].id);
  });

  afterAll(async () => {
    if (tx) {
      await tx`ROLLBACK`;
      tx.release();
    }
    await sql?.end({ timeout: 5 });
  });

  it("INSERT still works — the log is append-only, not read-only", () => {
    expect(probeId).toBeTruthy();
  });

  it("SELECT still works", async () => {
    const rows = await tx`SELECT id, action FROM events WHERE id = ${probeId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("test.append_only_probe");
  });

  it("case 12: UPDATE on events is rejected by the database", async () => {
    await expect(
      rejectedBy(() => tx`UPDATE events SET action = 'tampered' WHERE id = ${probeId}`),
    ).rejects.toThrow(REJECTED);

    const rows = await tx`SELECT action FROM events WHERE id = ${probeId}`;
    expect(rows[0].action).toBe("test.append_only_probe");
  });

  it("case 13: DELETE on events is rejected by the database", async () => {
    await expect(
      rejectedBy(() => tx`DELETE FROM events WHERE id = ${probeId}`),
    ).rejects.toThrow(REJECTED);

    const rows = await tx`SELECT id FROM events WHERE id = ${probeId}`;
    expect(rows).toHaveLength(1);
  });

  it("case 14: TRUNCATE on events is rejected by the database", async () => {
    await expect(rejectedBy(() => tx`TRUNCATE TABLE events`)).rejects.toThrow(REJECTED);

    const rows = await tx`SELECT id FROM events WHERE id = ${probeId}`;
    expect(rows).toHaveLength(1);
  });

  it("a bulk UPDATE with no WHERE clause is rejected too", async () => {
    await expect(rejectedBy(() => tx`UPDATE events SET service = 'tampered'`)).rejects.toThrow(
      REJECTED,
    );
  });

  it("the guard is installed as triggers on the events table", async () => {
    const rows = await tx<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'public.events'::regclass AND NOT tgisinternal
      ORDER BY tgname
    `;
    expect(rows.map((r) => r.tgname)).toEqual([
      "events_no_delete",
      "events_no_truncate",
      "events_no_update",
    ]);
  });
});
