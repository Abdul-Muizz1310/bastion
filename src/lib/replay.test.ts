import { describe, it } from "vitest";

// Time travel requires DB with seeded events — all integration tests

describe("07-replay: happy path", () => {
  it.todo("rewinding to T2 shows state as of T2, excluding later events (integration)");
  it.todo("rewinding to current time shows latest state (integration)");
  it.todo("slider bounds start at earliest event timestamp (integration)");
  it.todo("slider bounds end at current time (integration)");
  it.todo("filtering by service during time travel works (integration)");
  it.todo("each entity shows its most recent after state (integration)");
});

describe("07-replay: edge and failure cases", () => {
  it.todo("rewinding before any events returns empty state (integration)");
  it.todo("event at exact timestamp T is included (integration)");
  it.todo("database with zero events returns disabled slider state (integration)");
  it.todo("rapid queries are debounced (component test)");
});

describe("07-replay: security", () => {
  it.todo("/time-travel requires admin role (tested in RBAC spec)");
  it.todo("getTimeTravelState only performs SELECT queries (structural)");
});
