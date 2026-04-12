import { describe, expect, it } from "vitest";
import { events, magicLinks, sessions, users } from "./schema";
import { insertUserSchema } from "./validation";

describe("00-schema: Drizzle schema", () => {
  it("exports users, sessions, magicLinks, events tables", () => {
    expect(users).toBeDefined();
    expect(sessions).toBeDefined();
    expect(magicLinks).toBeDefined();
    expect(events).toBeDefined();
  });

  it("users table has id, email, name, role, createdAt, deletedAt columns", () => {
    const cols = Object.keys(users);
    expect(cols).toContain("id");
    expect(cols).toContain("email");
    expect(cols).toContain("name");
    expect(cols).toContain("role");
    expect(cols).toContain("createdAt");
    expect(cols).toContain("deletedAt");
  });

  it("sessions table has id, userId, expiresAt, ip, userAgent columns", () => {
    const cols = Object.keys(sessions);
    expect(cols).toContain("id");
    expect(cols).toContain("userId");
    expect(cols).toContain("expiresAt");
    expect(cols).toContain("ip");
    expect(cols).toContain("userAgent");
  });

  it("magicLinks table has token, email, expiresAt, usedAt columns", () => {
    const cols = Object.keys(magicLinks);
    expect(cols).toContain("token");
    expect(cols).toContain("email");
    expect(cols).toContain("expiresAt");
    expect(cols).toContain("usedAt");
  });

  it("events table has all required columns", () => {
    const cols = Object.keys(events);
    expect(cols).toContain("id");
    expect(cols).toContain("actorId");
    expect(cols).toContain("action");
    expect(cols).toContain("entityType");
    expect(cols).toContain("entityId");
    expect(cols).toContain("service");
    expect(cols).toContain("requestId");
    expect(cols).toContain("before");
    expect(cols).toContain("after");
    expect(cols).toContain("metadata");
    expect(cols).toContain("createdAt");
  });
});

describe("00-schema: table structure validation", () => {
  it.todo("events table defines 4 indexes (integration: migration SQL check)");
  it.todo("migration SQL applies cleanly to empty database (integration)");
});

describe("00-schema: edge and failure cases", () => {
  it.todo("inserting duplicate email fails with unique constraint (integration)");

  it("Zod schema rejects invalid role value", () => {
    const result = insertUserSchema.safeParse({
      email: "test@example.com",
      role: "superadmin",
    });
    expect(result.success).toBe(false);
  });

  it("Zod schema accepts valid role values", () => {
    for (const role of ["admin", "editor", "viewer"]) {
      const result = insertUserSchema.safeParse({
        email: "test@example.com",
        role,
      });
      expect(result.success).toBe(true);
    }
  });

  it.todo("inserting session with non-existent userId fails (integration)");
  it.todo("events.metadata defaults to empty object when not provided (integration)");
});

describe("00-schema: security — append-only events", () => {
  it.todo("UPDATE on events table is rejected by database (integration)");
  it.todo("DELETE on events table is rejected by database (integration)");
  it.todo("TRUNCATE on events table is rejected by database (integration)");
});
