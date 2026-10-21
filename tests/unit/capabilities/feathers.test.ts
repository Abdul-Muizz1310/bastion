import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { feathers } from "@/capabilities/feathers";
import {
  base,
  call,
  expectInvalidInput,
  expectMissingFieldRejected,
  expectParses,
  fixture,
  json,
  sent,
  stubGateway,
} from "./harness";

/**
 * feathers-demo through the gateway (spec 21 §5: live CRUD on the generated service — create, list,
 * soft-delete, then a 404). Schemas mirror feathers_demo's contract-v2 `UserResponse`/`UserCreate`;
 * its `feathers.yaml` gates `POST /users` and `DELETE /users/{id}` to `admin`.
 */

const { appendEvent } = vi.hoisted(() => ({ appendEvent: vi.fn() }));
vi.mock("@/platform/ratelimit", () => ({
  createRateLimiter: () => ({ check: async () => ({ success: true, limit: 30, remaining: 29 }) }),
}));
vi.mock("@/platform/audit/write", () => ({ appendEvent }));

const USER = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const users = fixture("feathers-demo", "users.json");
const user = fixture("feathers-demo", "user.json");
const created = fixture("feathers-demo", "user-created.json");

beforeEach(() => {
  stubGateway();
  appendEvent.mockReset().mockResolvedValue(1);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("feathers.users and user", () => {
  it("GETs /users with keyset paging", async () => {
    await expectParses(feathers.users, { limit: "2", cursor: USER }, users);
    expect(sent().url).toBe(`${base("feathers-demo")}/users?limit=2&cursor=${USER}`);
  });

  it("refuses a user without its role", async () => {
    await expectMissingFieldRejected(feathers.users, {}, users, [1, "role"]);
  });

  it("GETs /users/{id}", async () => {
    expect(await expectParses(feathers.user, { id: USER }, user)).toMatchObject({
      deleted_at: null,
    });
    expect(sent().url).toBe(`${base("feathers-demo")}/users/${USER}`);
  });

  it("reports a soft-deleted user's 404 as feathers-demo's own answer", async () => {
    const result = await call(feathers.user, { id: USER }, json({ detail: "User not found" }, 404));
    expect(result).toMatchObject({
      ok: false,
      error: "downstream_error",
      status: 404,
      detail: "User not found",
    });
  });

  it.each([["../users"], ["a/b"], ["7"]])("refuses the user id %s", async (id) => {
    await expectInvalidInput(feathers.user, { id });
  });
});

describe("feathers.createUser and deleteUser", () => {
  const input = { email: "grace@example.com", full_name: "Grace Hopper", role: "viewer" };

  it("POSTs /users and parses the 201 user", async () => {
    await expectParses(feathers.createUser, input, created, 201);
    expect(sent()).toMatchObject({
      url: `${base("feathers-demo")}/users`,
      method: "POST",
      body: input,
    });
  });

  it("lets feathers-demo default the role", async () => {
    await expectParses(feathers.createUser, { email: "a@b.co", full_name: "A" }, created, 201);
    expect(sent().body).toStrictEqual({ email: "a@b.co", full_name: "A" });
  });

  it("refuses a created user without its id", async () => {
    await expectMissingFieldRejected(feathers.createUser, input, created, ["id"]);
  });

  it.each([
    ["an address that is not an email", { ...input, email: "grace" }],
    ["an email over 255 characters", { ...input, email: `${"a".repeat(250)}@b.com` }],
    ["a blank name", { ...input, full_name: " " }],
    ["a name over 100 characters", { ...input, full_name: "x".repeat(101) }],
    ["an unknown role", { ...input, role: "owner" }],
  ])("refuses %s", async (_label, bad) => {
    await expectInvalidInput(feathers.createUser, bad);
  });

  it("DELETEs /users/{id} and parses the empty 204", async () => {
    const result = await call(feathers.deleteUser, { id: USER }, new Response(null, { status: 204 }));
    expect(result).toMatchObject({ ok: true, data: null, status: 204 });
    expect(sent()).toMatchObject({ url: `${base("feathers-demo")}/users/${USER}`, method: "DELETE" });
  });

  it("refuses a delete that answers with a body", async () => {
    const result = await call(feathers.deleteUser, { id: USER }, json({ deleted: true }));
    expect(result).toMatchObject({ ok: false, error: "invalid_response" });
  });

  it("shares one daily budget between creates and deletes", async () => {
    vi.stubEnv("BUDGET_FEATHERS_WRITE", "1");
    await call(feathers.createUser, input, json(created, 201));
    expect(await call(feathers.deleteUser, { id: USER })).toMatchObject({
      error: "budget_exhausted",
    });
  });
});
