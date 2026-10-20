import type { FeathersUser } from "@/capabilities/feathers";
import type { ToolOutcome } from "../outcome";

/**
 * feathers' soft-delete proof (spec 21 §5, §5.1): create a user → delete it → read it back.
 * `feathers.yaml` declares `soft_delete: true`, so the deleted row must be invisible: the read must
 * answer 404. A user still readable is the product leaking. A step that fails for any other reason
 * stops the proof there (spending nothing more) and leaves it inconclusive.
 */

export type ProofCalls = {
  create: (input: ProofInput) => Promise<ToolOutcome<FeathersUser>>;
  remove: (id: string) => Promise<ToolOutcome<null>>;
  read: (id: string) => Promise<ToolOutcome<FeathersUser>>;
};

export type ProofInput = { email: string; full_name: string };

export type ProofStep =
  | { step: "create"; outcome: ToolOutcome<FeathersUser> }
  | { step: "delete"; outcome: ToolOutcome<null> }
  | { step: "read"; outcome: ToolOutcome<FeathersUser> };

export type ProofVerdict = "honoured" | "leaked" | "incomplete";

export type Proof = { verdict: ProofVerdict; steps: ProofStep[]; user: FeathersUser | null };

export async function runSoftDeleteProof(
  calls: ProofCalls,
  input: ProofInput,
  onStep?: (step: ProofStep) => void,
): Promise<Proof> {
  const steps: ProofStep[] = [];
  const record = (step: ProofStep) => {
    steps.push(step);
    onStep?.(step);
  };

  const created = await calls.create(input);
  record({ step: "create", outcome: created });
  if (!created.ok) return { verdict: "incomplete", steps, user: null };
  const user = created.data;

  const removed = await calls.remove(user.id);
  record({ step: "delete", outcome: removed });
  if (!removed.ok) return { verdict: "incomplete", steps, user };

  const read = await calls.read(user.id);
  record({ step: "read", outcome: read });
  if (read.ok) return { verdict: "leaked", steps, user };
  const notFound = read.kind === "downstream_error" && read.status === 404;
  return { verdict: notFound ? "honoured" : "incomplete", steps, user };
}
