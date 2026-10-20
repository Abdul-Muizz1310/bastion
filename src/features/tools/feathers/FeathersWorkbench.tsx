"use client";

import { useEffect, useId, useRef, useState } from "react";
import { type FeathersUser, feathers } from "@/capabilities/feathers";
import { AuditLink } from "@/components/tools/AuditLink";
import { BudgetedAction } from "@/components/tools/BudgetedAction";
import { CopyButton } from "@/components/tools/CopyButton";
import { FieldError } from "@/components/tools/FieldError";
import { Outcome } from "@/components/tools/Outcome";
import { Panel, WithReceipt } from "@/components/tools/Panel";
import { BUTTON_QUIET, INPUT, LABEL, MONO_BLOCK } from "@/components/tools/styles";
import { ToolReceipt } from "@/components/tools/ToolReceipt";
import { useWakeReady } from "@/components/tools/WakeGate";
import { useBudgets } from "../BudgetProvider";
import { callTool, postRoute } from "../client";
import { plural, utc } from "../format";
import type { ToolOutcome } from "../outcome";
import { needsLoad } from "../run-action";
import { useAction } from "../use-action";
import { contractOf } from "./contract";
import { type ProofAnswer, type ProofStepAnswer, proofAnswerSchema } from "./proof-answer";
import { FEATHERS_YAML, FEATHERS_YAML_SHA256, FEATHERS_YAML_SOURCE } from "./schema";

/**
 * feathers' workbench (spec 21 §5, §5.1): the YAML schema feathers-cli generated feathers-demo from,
 * the contract read from it (each endpoint and its role gate), live CRUD on the generated service
 * (budget `feathers.write`), and the soft-delete proof: create a user → delete it → read it, which
 * must answer 404. The proof runs on the server (`POST /api/platform/feathers-proof`), which deletes
 * only the user it created itself; deleting is not a tool.
 */

export type FeathersState = {
  users?: ToolOutcome<FeathersUser[]>;
  created?: ToolOutcome<FeathersUser>;
  proof?: ProofAnswer;
};

const P = "feathers-demo";
const CONTRACT = contractOf(FEATHERS_YAML);
const ROLES = ["viewer", "editor", "admin"] as const;

const GATE_MEANING: Readonly<Record<string, string>> = {
  any: "any valid platform token",
  viewer: "a viewer token or above",
  editor: "an editor token or above",
  admin: "an admin token only",
};

const STEP_CALL: Readonly<Record<ProofStepAnswer["step"], string>> = {
  create: "POST /users",
  delete: "DELETE /users/{id}",
  read: "GET /users/{id}",
};

function stepAnswer(s: ProofStepAnswer): string {
  if (s.ok) return `${s.status ?? ""}${s.step === "read" ? " — the user is still readable" : ""}`;
  if (s.kind === "downstream_error") return `${s.status ?? ""}${s.detail ? ` — ${s.detail}` : ""}`;
  return (s.kind ?? "failed").replaceAll("_", " ");
}

export function FeathersWorkbench({ initial = {} }: { initial?: FeathersState }) {
  const ready = useWakeReady();
  const { refresh } = useBudgets();
  const users = useAction(initial.users ?? null);
  const created = useAction(initial.created ?? null);
  const proof = useAction<ProofAnswer>(
    initial.proof
      ? { ok: true, data: initial.proof, status: 200, requestId: initial.proof.requestId }
      : null,
  );
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("viewer");
  const [formError, setFormError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const ids = useId();

  const list = () =>
    void users.run((signal) => callTool(feathers.users, { limit: 20 }, { signal }));

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, when the gate opens
  useEffect(() => {
    if (ready && needsLoad(users.outcome)) list();
  }, [ready]);

  const create = async () => {
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 255;
    const nameOk = fullName.trim() !== "" && fullName.length <= 100;
    if (!emailOk || !nameOk) {
      setFormError(
        !emailOk
          ? "Enter an email address, e.g. ada@example.com."
          : "Enter a name of up to 100 characters.",
      );
      (!emailOk ? emailRef : nameRef).current?.focus();
      return;
    }
    setFormError(null);
    await created.run((signal) =>
      callTool(feathers.createUser, { email, full_name: fullName, role }, { signal }),
    );
    refresh();
    list();
  };

  const prove = async () => {
    await proof.run((signal) =>
      postRoute("/api/platform/feathers-proof", {}, proofAnswerSchema, { signal }),
    );
    refresh();
    list();
  };

  return (
    <div className="space-y-8">
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel
          id="feathers-schema"
          title="the schema"
          hint="feathers.yaml — what feathers-cli generated feathers-demo from"
        >
          <pre className={`${MONO_BLOCK} max-h-[26rem]`} translate="no">
            {FEATHERS_YAML}
          </pre>
          <div className="flex flex-wrap items-center justify-between gap-3 font-mono text-[11px] text-fg-muted">
            <span>
              {FEATHERS_YAML_SOURCE} · sha256 {FEATHERS_YAML_SHA256.slice(0, 12)}…
            </span>
            <CopyButton text={FEATHERS_YAML} label="feathers.yaml" />
          </div>
        </Panel>

        <Panel
          id="feathers-contract"
          title="the generated contract"
          hint="read from the YAML, not written by hand"
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse font-mono text-xs">
              <caption className="sr-only">
                feathers-demo’s endpoints and the role each one requires
              </caption>
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.14em] text-fg-muted">
                  <th scope="col" className="py-2 pr-3 font-normal">
                    method
                  </th>
                  <th scope="col" className="py-2 pr-3 font-normal">
                    path
                  </th>
                  <th scope="col" className="py-2 pr-3 font-normal">
                    handler
                  </th>
                  <th scope="col" className="py-2 font-normal">
                    role gate
                  </th>
                </tr>
              </thead>
              <tbody>
                {CONTRACT.endpoints.map((e) => (
                  <tr key={`${e.method} ${e.path}`} className="border-b border-border/70 align-top">
                    <td className="py-2 pr-3 text-accent-violet">{e.method}</td>
                    <td className="py-2 pr-3 text-foreground" translate="no">
                      {e.path}
                    </td>
                    <td className="py-2 pr-3 text-fg-muted" translate="no">
                      {e.handler}
                    </td>
                    <td className="py-2">
                      <span className="text-foreground">{e.auth}</span>
                      <span className="block text-fg-muted">
                        {GATE_MEANING[e.auth]}
                        {e.paginate ? ` · ${e.paginate} pages` : ""}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-1 font-mono text-xs text-fg-muted">
            {CONTRACT.models.map((m) => (
              <li key={m.name}>
                <span className="text-foreground">{m.name}</span>:{" "}
                {m.softDelete
                  ? "soft delete — a deleted row is hidden from every read, never erased"
                  : "hard delete"}
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel
        id="feathers-proof"
        title="the soft-delete proof"
        hint="create a user → delete it → read it back: it must answer 404"
      >
        <BudgetedAction
          budget="feathers.write"
          units={2}
          label="run the proof: create, delete, read"
          busyLabel="proving…"
          busy={proof.busy}
          onRun={() => void prove()}
        />
        <Outcome state={proof} product={P} what="the proof">
          {(answer) => <ProofView proof={answer} />}
        </Outcome>
      </Panel>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel
          id="feathers-create"
          title="create a user"
          hint="POST /users needs an admin token; bastion mints one"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor={`${ids}-email`} className={LABEL}>
                email
              </label>
              <input
                ref={emailRef}
                id={`${ids}-email`}
                name="email"
                aria-describedby={`${ids}-error`}
                type="email"
                autoComplete="off"
                spellCheck={false}
                placeholder="ada@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value.trim())}
                className={INPUT}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${ids}-name`} className={LABEL}>
                full name
              </label>
              <input
                ref={nameRef}
                id={`${ids}-name`}
                name="full_name"
                aria-describedby={`${ids}-error`}
                autoComplete="off"
                placeholder="Ada Lovelace"
                maxLength={100}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className={INPUT}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${ids}-role`} className={LABEL}>
                role
              </label>
              <select
                id={`${ids}-role`}
                value={role}
                onChange={(e) => setRole(ROLES.find((r) => r === e.target.value) ?? "viewer")}
                className={INPUT}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <BudgetedAction
            budget="feathers.write"
            label="create the user"
            busyLabel="creating…"
            busy={created.busy}
            onRun={() => void create()}
          />
          <FieldError id={`${ids}-error`} message={formError} />
          <Outcome state={created} product={P} what="the new user">
            {(u, requestId) => (
              <ToolReceipt
                kind="feathers create"
                serial={u.id.slice(0, 8)}
                title={u.email}
                lines={[
                  { label: "name", value: u.full_name },
                  { label: "role", value: u.role },
                  { label: "created", value: utc(u.created_at) },
                  { label: "id", value: u.id },
                ]}
                requestId={requestId}
              />
            )}
          </Outcome>
        </Panel>

        <Panel id="feathers-users" title="users" hint="GET /users — soft-deleted rows never appear">
          <button
            type="button"
            onClick={list}
            disabled={!ready || users.busy}
            className={BUTTON_QUIET}
          >
            list again
          </button>
          <Outcome state={users} product={P} what="the users">
            {(rows, requestId) => (
              <div className="space-y-3">
                {rows.length === 0 ? (
                  <p className="font-mono text-xs text-fg-muted">No users yet.</p>
                ) : (
                  <ul className="divide-y divide-border font-mono text-xs">
                    {rows.map((u) => (
                      <li
                        key={u.id}
                        className="flex flex-wrap items-baseline justify-between gap-x-4 py-2"
                      >
                        <span className="min-w-0">
                          <span className="text-foreground [overflow-wrap:anywhere]">
                            {u.email}
                          </span>
                          <span className="block text-fg-muted">
                            {u.full_name} · {u.role}
                          </span>
                        </span>
                        <span className="text-fg-muted tabular-nums">{utc(u.created_at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="flex flex-wrap items-center justify-between gap-3 font-mono text-[11px] text-fg-muted">
                  <span>{plural(rows.length, "user")}</span>
                  <AuditLink requestId={requestId} />
                </p>
              </div>
            )}
          </Outcome>
        </Panel>
      </div>
    </div>
  );
}

function ProofSteps({ steps }: { steps: readonly ProofStepAnswer[] }) {
  return (
    <ol className="space-y-1.5 font-mono text-xs">
      {steps.map((s) => (
        <li key={s.step}>
          <span className="text-foreground">{s.step}</span>{" "}
          <span className="text-fg-muted">· {STEP_CALL[s.step]} →</span>{" "}
          <span className={s.ok || s.step === "read" ? "text-foreground" : "text-warning"}>
            {stepAnswer(s)}
          </span>
        </li>
      ))}
    </ol>
  );
}

const VERDICT: Readonly<
  Record<ProofAnswer["verdict"], { stamp: string; tone: "pass" | "fail" | "neutral"; says: string }>
> = {
  honoured: {
    stamp: "soft delete honoured",
    tone: "pass",
    says: "The read answers 404: the deleted user is hidden from every read, as feathers.yaml’s soft_delete: true promises. That proves soft delete is honoured.",
  },
  leaked: {
    stamp: "deleted user leaked",
    tone: "fail",
    says: "The user is still readable after its delete: the generated service does not honour the soft delete its schema declares.",
  },
  incomplete: {
    stamp: "inconclusive",
    tone: "neutral",
    says: "A step did not complete, so the proof proves nothing either way. Try again once feathers-demo is awake.",
  },
};

function ProofView({ proof }: { proof: ProofAnswer }) {
  const v = VERDICT[proof.verdict];
  return (
    <WithReceipt
      receipt={
        <ToolReceipt
          kind="feathers soft-delete proof"
          serial={proof.user?.id.slice(0, 8)}
          title={proof.user?.email ?? "no user was created"}
          stamp={{ text: v.stamp, tone: v.tone }}
          lines={proof.steps.map((s) => ({
            label: s.step,
            value: `${STEP_CALL[s.step]} → ${stepAnswer(s)}`,
          }))}
          extra={proof.user ? [`user: ${proof.user.id}`] : []}
          requestId={proof.requestId}
        />
      }
    >
      <div className="space-y-4">
        <ProofSteps steps={proof.steps} />
        <p className="font-mono text-xs leading-relaxed text-foreground/90">{v.says}</p>
      </div>
    </WithReceipt>
  );
}
