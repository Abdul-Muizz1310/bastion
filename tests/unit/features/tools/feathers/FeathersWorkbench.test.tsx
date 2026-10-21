import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

import type { FeathersUser } from "@/capabilities/feathers";
import { FeathersWorkbench } from "@/features/tools/feathers/FeathersWorkbench";
import type { ProofAnswer } from "@/features/tools/feathers/proof-answer";
import { fixture } from "../../../capabilities/harness";
import { budgetsWith, buttonNamed, isDisabled, Seeded } from "../../../components/tools/gate-fixtures";
import { textOf } from "../../../helpers/html";
import { auditHrefs, copyButtons, ok } from "../outcomes";

/**
 * feathers' workbench (spec 21 §5, §5.1): the YAML that generated feathers-demo, the contract read
 * from it, live CRUD, and the soft-delete proof — create, delete, then a 404.
 */

const users = fixture("feathers-demo", "users.json") as FeathersUser[];
const created = fixture("feathers-demo", "user-created.json") as FeathersUser;

const proof: ProofAnswer = {
  verdict: "honoured",
  user: created,
  requestId: "rid-proof",
  steps: [
    { step: "create", ok: true, status: 201, kind: null, detail: null },
    { step: "delete", ok: true, status: 204, kind: null, detail: null },
    { step: "read", ok: false, status: 404, kind: "downstream_error", detail: "User not found" },
  ],
};

function render(initial: object, opts: Partial<Parameters<typeof Seeded>[0]> = {}) {
  return renderToStaticMarkup(
    <Seeded name="feathers" services={["feathers-demo"]} {...opts}>
      <FeathersWorkbench initial={initial} />
    </Seeded>,
  );
}

describe("FeathersWorkbench", () => {
  it("renders without crashing when the wake fails, with every write disabled", () => {
    const html = render({}, { gate: "failed" });
    expect(isDisabled(buttonNamed(html, /create the user/))).toBe(true);
    expect(isDisabled(buttonNamed(html, /run the proof/))).toBe(true);
  });

  it("disables the proof when fewer than its 2 writes are left, and both at 0", () => {
    const one = render({}, { budgets: budgetsWith({ "feathers.write": { limit: 50, left: 1 } }) });
    expect(isDisabled(buttonNamed(one, /run the proof/))).toBe(true);
    expect(isDisabled(buttonNamed(one, /create the user/))).toBe(false);
    const none = render({}, { budgets: budgetsWith({ "feathers.write": { limit: 50, left: 0 } }) });
    expect(isDisabled(buttonNamed(none, /create the user/))).toBe(true);
  });

  it("shows the YAML schema with its source, and the contract read from it", () => {
    const text = textOf(render({}));
    expect(text).toContain("soft_delete: true");
    expect(text).toMatch(/contract-v2/);
    expect(text).toMatch(/DELETE\s*\/users\/\{id\}\s*users\.delete\s*admin/);
  });

  it("lists the users with their audit link, without claiming an order the API does not keep", () => {
    const html = render({ users: ok(users, "rid-users") });
    for (const u of users) expect(textOf(html)).toContain(u.email);
    expect(auditHrefs(html)).toContain("/audit/rid-users");
    expect(textOf(html)).not.toMatch(/newest/);
  });

  it("shows the 404 after the soft delete, and says it proves soft delete is honoured", () => {
    const html = render({ proof });
    const text = textOf(html);
    expect(text).toMatch(/read\s.*404/);
    expect(text).toMatch(/soft delete honoured/i);
    expect(text).toMatch(/proves soft delete is honoured/);
    expect(auditHrefs(html)).toContain("/audit/rid-proof");
    expect(text).not.toMatch(/still in the table/);
    expect(copyButtons(html)).toContain("copy the feathers soft-delete proof receipt");
  });

  it("calls a user still readable after its delete a leak", () => {
    const leaked: ProofAnswer = {
      ...proof,
      verdict: "leaked",
      steps: [...proof.steps.slice(0, 2), { step: "read", ok: true, status: 200, kind: null, detail: null }],
    };
    expect(textOf(render({ proof: leaked }))).toMatch(/still readable/);
  });
});
