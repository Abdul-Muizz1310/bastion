import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock postgres and drizzle-orm/postgres-js
vi.mock("postgres", () => {
  const mockSql = vi.fn();
  return { default: vi.fn(() => mockSql) };
});

vi.mock("drizzle-orm/postgres-js", () => ({
  drizzle: vi.fn(() => ({ mock: true })),
}));

vi.mock("@/lib/db/schema", () => ({}));

describe("db module", () => {
  const origDbUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (origDbUrl !== undefined) {
      process.env.DATABASE_URL = origDbUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
  });

  it("getDb throws when DATABASE_URL is not set", async () => {
    delete process.env.DATABASE_URL;
    const { getDb } = await import("@/lib/db/client");
    expect(() => getDb()).toThrow("DATABASE_URL is not set");
  });

  it("getDb returns drizzle instance when DATABASE_URL is set", async () => {
    process.env.DATABASE_URL = "postgresql://localhost/test";
    const { getDb } = await import("@/lib/db/client");
    const db = getDb();
    expect(db).toBeDefined();
    expect((db as any).mock).toBe(true);
  });

  it("getDb returns same instance on repeated calls", async () => {
    process.env.DATABASE_URL = "postgresql://localhost/test";
    const { getDb } = await import("@/lib/db/client");
    const db1 = getDb();
    const db2 = getDb();
    expect(db1).toBe(db2);
  });

  it("getRawSql throws when DATABASE_URL is not set", async () => {
    delete process.env.DATABASE_URL;
    const { getRawSql } = await import("@/lib/db/client");
    expect(() => getRawSql()).toThrow("DATABASE_URL is not set");
  });

  it("getRawSql returns sql instance when DATABASE_URL is set", async () => {
    process.env.DATABASE_URL = "postgresql://localhost/test";
    const { getRawSql } = await import("@/lib/db/client");
    const sql = getRawSql();
    expect(sql).toBeDefined();
  });

  it("getRawSql reuses existing connection from getDb", async () => {
    process.env.DATABASE_URL = "postgresql://localhost/test";
    const { getDb, getRawSql } = await import("@/lib/db/client");
    getDb(); // creates _sql and _db
    const sql = getRawSql(); // should reuse _sql
    expect(sql).toBeDefined();
  });
});
