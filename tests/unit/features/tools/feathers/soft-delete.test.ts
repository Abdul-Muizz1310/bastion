import { describe, expect, it, vi } from "vitest";
import type { FeathersUser } from "@/capabilities/feathers";
import { runSoftDeleteProof, type ProofCalls } from "@/features/tools/feathers/soft-delete";
import type { ToolOutcome } from "@/features/tools/outcome";
import { fixture } from "../../../capabilities/harness";

/**
 * feathers' soft-delete proof (spec 21 §5.1): create a user → delete it → read it. feathers.yaml
 * promises soft delete, so the read must answer 404; a user still readable is the product leaking.
 */

const created = fixture("feathers-demo", "user-created.json") as FeathersUser;
const input = { email: "proof-1a2b3c4d@example.com", full_name: "Soft-delete proof" };

const ok = <T,>(data: T, requestId: string, status = 200): ToolOutcome<T> => ({
  ok: true,
  data,
  status,
  requestId,
});

function calls(over: Partial<ProofCalls> = {}): ProofCalls {
  return {
    create: vi.fn(async () => ok(created, "req-create", 201)),
    remove: vi.fn(async () => ok(null, "req-delete", 204)),
    read: vi.fn(
      async (): Promise<ToolOutcome<FeathersUser>> => ({
        ok: false,
        kind: "downstream_error",
        status: 404,
        detail: "User not found",
        requestId: "req-read",
      }),
    ),
    ...over,
  };
}

describe("runSoftDeleteProof", () => {
  it("creates, deletes and reads back: a 404 proves soft delete is honoured", async () => {
    const c = calls();
    const steps: string[] = [];
    const proof = await runSoftDeleteProof(c, input, (s) => steps.push(s.step));
    expect(c.create).toHaveBeenCalledWith(input);
    expect(c.remove).toHaveBeenCalledWith(created.id);
    expect(c.read).toHaveBeenCalledWith(created.id);
    expect(proof.verdict).toBe("honoured");
    expect(proof.steps.map((s) => [s.step, s.outcome.requestId])).toEqual([
      ["create", "req-create"],
      ["delete", "req-delete"],
      ["read", "req-read"],
    ]);
    expect(steps).toEqual(["create", "delete", "read"]);
  });

  it("calls a user still readable after its delete a leak", async () => {
    const proof = await runSoftDeleteProof(
      calls({ read: vi.fn(async () => ok(created, "req-read")) }),
      input,
    );
    expect(proof.verdict).toBe("leaked");
  });

  it("stops after a refused create, spending nothing more, and is inconclusive", async () => {
    const c = calls({
      create: vi.fn(
        async (): Promise<ToolOutcome<FeathersUser>> => ({
          ok: false,
          kind: "budget_exhausted",
          retryAfterS: 3600,
          requestId: "req-create",
        }),
      ),
    });
    const proof = await runSoftDeleteProof(c, input);
    expect(proof.verdict).toBe("incomplete");
    expect(proof.steps).toHaveLength(1);
    expect(c.remove).not.toHaveBeenCalled();
  });

  it("stops after a failed delete without reading", async () => {
    const c = calls({
      remove: vi.fn(
        async (): Promise<ToolOutcome<null>> => ({ ok: false, kind: "asleep", requestId: "r" }),
      ),
    });
    const proof = await runSoftDeleteProof(c, input);
    expect(proof.verdict).toBe("incomplete");
    expect(c.read).not.toHaveBeenCalled();
  });

  it("is inconclusive when the read fails for another reason than 404", async () => {
    const proof = await runSoftDeleteProof(
      calls({
        read: vi.fn(
          async (): Promise<ToolOutcome<FeathersUser>> => ({
            ok: false,
            kind: "asleep",
            requestId: "req-read",
          }),
        ),
      }),
      input,
    );
    expect(proof.verdict).toBe("incomplete");
    expect(proof.steps).toHaveLength(3);
  });
});
