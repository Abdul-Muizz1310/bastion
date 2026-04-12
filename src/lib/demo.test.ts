import { describe, expect, it } from "vitest";

// Demo workflow requires running services — all integration except role check

describe("10-demo: role enforcement", () => {
  it("viewer role cannot start demo run", async () => {
    const { startDemoRun } = await import("./demo");
    await expect(startDemoRun({ userId: "user-1", role: "viewer" })).rejects.toThrow(
      "Viewer role cannot run demos",
    );
  });

  it("demo requires admin or editor role", async () => {
    const { startDemoRun } = await import("./demo");
    await expect(startDemoRun({ userId: "user-1", role: "viewer" })).rejects.toThrow();
  });
});

describe("10-demo: workflow", () => {
  it.todo("startDemoRun returns a run_id (integration: needs running services)");
  it.todo("demo run executes 5 steps in order (integration)");
  it.todo("each step event includes step name, status, and data (integration)");
  it.todo("successful run produces 3 artifact cards (integration)");
  it.todo("run includes timeline with timestamps and latency (integration)");
  it.todo("all demo events share the same requestId (integration)");
  it.todo("demo results are retrievable by runId (integration)");
});

describe("10-demo: edge and failure cases", () => {
  it.todo("magpie failure stops the run with partial result (integration)");
  it.todo("inkprint failure preserves magpie result (integration)");
  it.todo("concurrent demo runs get independent run_ids (integration)");
  it.todo("SSE reconnection gets remaining events (client-side test)");
});

describe("10-demo: security", () => {
  it.todo("all downstream calls use the gateway proxy (integration)");
  it.todo("demo run events appear in audit log (integration)");
});
