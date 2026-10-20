import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

import type { BranchSwitch, QueryDetail, QueryRow } from "@/capabilities/slowquery";
import { SlowqueryWorkbench } from "@/features/tools/slowquery/SlowqueryWorkbench";
import { fixture } from "../../../capabilities/harness";
import { buttonNamed, isDisabled, Seeded } from "../../../components/tools/gate-fixtures";
import { textOf } from "../../../helpers/html";
import { auditHrefs, copyButtons, ok, RID } from "../outcomes";

/**
 * slowquery's workbench (spec 21 §5, §5.1): the fleet's slowest fingerprints across five hosts, a
 * fingerprint's EXPLAIN plan and exact CREATE INDEX, and the demo's branch switch.
 */

const library = fixture("slowquery", "queries.json") as QueryRow[];
const demo = fixture("slowquery", "queries-demo.json") as QueryRow[];
const detail = fixture("slowquery", "query.json") as QueryDetail;
const switched = fixture("slowquery", "switch.json") as BranchSwitch;

const fleet = [
  { service: "magpie", outcome: ok(library, "rid-magpie") },
  { service: "slowquery", outcome: ok(demo, "rid-demo") },
  { service: "inkprint", outcome: { ok: false, kind: "asleep", requestId: "rid-ink" } },
  {
    service: "paper-trail",
    outcome: { ok: false, kind: "downstream_error", status: 404, detail: "Not Found", requestId: "rid-pt" },
  },
];

function render(initial: object, opts: Partial<Parameters<typeof Seeded>[0]> = {}) {
  return renderToStaticMarkup(
    <Seeded name="slowquery" services={["slowquery"]} {...opts}>
      <SlowqueryWorkbench initial={initial} />
    </Seeded>,
  );
}

describe("SlowqueryWorkbench", () => {
  it("renders without crashing when the wake fails, with the fleet and the switch disabled", () => {
    const html = render({}, { gate: "failed" });
    expect(html).toContain('data-gate="unknown"');
    expect(isDisabled(buttonNamed(html, /read the fleet/))).toBe(true);
    expect(isDisabled(buttonNamed(html, /switch to/))).toBe(true);
  });

  it("ranks the fleet's queries, each with its host, and says which host is asleep", () => {
    const text = textOf(render({ fleet }));
    expect(text).toContain("select * from orders where user_id = ?");
    expect(text).toMatch(/inkprint\s*◌?\s*asleep/);
    expect(text).toMatch(/magpie · 2 fingerprints/);
  });

  it("says a host that answers 404 has no /_slowquery yet, rather than calling it down", () => {
    expect(textOf(render({ fleet }))).toMatch(/paper-trail\s*\??\s*unknown · no \/_slowquery here yet/);
  });

  it("shows a fingerprint's EXPLAIN plan and its exact CREATE INDEX, with the receipt", () => {
    const html = render({ fleet, chosen: { service: "magpie", id: detail.fingerprint.id }, detail: ok(detail, RID) });
    const text = textOf(html);
    expect(text).toContain("Seq Scan");
    expect(text).toContain("CREATE INDEX IF NOT EXISTS ix_orders_created_at ON orders(created_at);");
    expect(text).toMatch(/slowquery plan/);
    expect(auditHrefs(html)).toContain(`/audit/${RID}`);
    expect(copyButtons(html)).toContain("copy the slowquery plan receipt");
  });

  it("shows the demo's branch after a switch", () => {
    const text = textOf(render({ branch: ok({ active: "slow" }, "rid-b"), switched: ok(switched, "rid-s") }));
    expect(text).toMatch(/fast/);
    expect(text).toMatch(/840 ms/);
  });
});
