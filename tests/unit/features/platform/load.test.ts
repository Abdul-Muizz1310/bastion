import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPlatform } from "@/features/platform/load";
import { DEFAULT_BUDGETS } from "@/platform/budget-keys";
import { ConfigError } from "@/platform/secrets";

/**
 * Spec 21 §3.2 `/platform`: what the page reads on the server — today's budgets, the key id and
 * bastion's own commit. A failure of any is said on the page, never the page failing.
 */

const BUDGETS = Object.fromEntries(
  Object.entries(DEFAULT_BUDGETS).map(([k, limit]) => [k, { limit, left: limit }]),
);

const deps = (more: Partial<Parameters<typeof loadPlatform>[0]> = {}) => ({
  budgetsLeft: vi.fn().mockResolvedValue(BUDGETS),
  keyId: vi.fn().mockReturnValue("bastion-ed25519-2026-04"),
  commitSha: vi.fn().mockReturnValue(undefined),
  ...more,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadPlatform", () => {
  it("reads the budgets, the kid and bastion's commit", async () => {
    const data = await loadPlatform(
      deps({ commitSha: vi.fn().mockReturnValue("3f9c2a1b7e4d5c6f8a9b0c1d2e3f4a5b6c7d8e9f") }),
    );
    expect(data).toEqual({
      budgets: BUDGETS,
      kid: { kind: "ok", kid: "bastion-ed25519-2026-04" },
      bastionCommit: "3f9c2a1b7e4d5c6f8a9b0c1d2e3f4a5b6c7d8e9f",
    });
  });

  it("budgets unavailable: null, logged, the rest still read", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const data = await loadPlatform(
      deps({ budgetsLeft: vi.fn().mockRejectedValue(new Error("budget store down")) }),
    );
    expect(data.budgets).toBeNull();
    expect(data.kid.kind).toBe("ok");
    expect(error).toHaveBeenCalled();
  });

  it("a malformed key id reads 'unreadable' and never carries the value", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const data = await loadPlatform(
      deps({
        keyId: vi.fn(() => {
          throw new ConfigError("BASTION_KEY_ID", "must contain only letters, digits, '.', '_' and '-'");
        }),
      }),
    );
    expect(data.kid).toEqual({ kind: "unreadable" });
  });

  it("an error that is not a configuration error is not swallowed", async () => {
    await expect(
      loadPlatform(
        deps({
          keyId: vi.fn(() => {
            throw new TypeError("bug");
          }),
        }),
      ),
    ).rejects.toThrow("bug");
  });

  it("no commit in the environment: none", async () => {
    expect((await loadPlatform(deps())).bastionCommit).toBeNull();
    expect((await loadPlatform(deps({ commitSha: vi.fn().mockReturnValue("") }))).bastionCommit).toBeNull();
  });
});
