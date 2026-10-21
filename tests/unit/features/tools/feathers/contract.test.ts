import { describe, expect, it } from "vitest";
import { contractOf } from "@/features/tools/feathers/contract";
import {
  FEATHERS_YAML,
  FEATHERS_YAML_SHA256,
  FEATHERS_YAML_SOURCE,
} from "@/features/tools/feathers/schema";
import { sha256Hex } from "@/platform/sha256";

/**
 * The generated contract the feathers workbench shows (spec 21 §5, §5.1): read from the very YAML
 * feathers-cli generated feathers-demo from, so the page cannot drift from it.
 */

describe("the embedded schema", () => {
  it("is feathers-demo's feathers.yaml and says where it came from", () => {
    expect(FEATHERS_YAML_SOURCE).toMatch(/feathers_demo.*contract-v2.*feathers\.yaml/);
    expect(FEATHERS_YAML).toMatch(/^service:\n {2}name: feathers_demo\n/);
    expect(FEATHERS_YAML).toContain("soft_delete: true");
  });

  it("is byte for byte the file it cites (its recorded SHA-256)", () => {
    expect(sha256Hex(FEATHERS_YAML)).toBe(FEATHERS_YAML_SHA256);
  });
});

describe("contractOf", () => {
  it("reads every endpoint and its role gate", () => {
    expect(contractOf(FEATHERS_YAML).endpoints).toEqual([
      { method: "POST", path: "/users", handler: "users.create", auth: "admin" },
      { method: "GET", path: "/users/{id}", handler: "users.get", auth: "any" },
      { method: "GET", path: "/users", handler: "users.list", auth: "any", paginate: "cursor" },
      { method: "PATCH", path: "/users/{id}", handler: "users.update", auth: "admin" },
      { method: "DELETE", path: "/users/{id}", handler: "users.delete", auth: "admin" },
    ]);
  });

  it("reads the soft-delete promise of each model", () => {
    expect(contractOf(FEATHERS_YAML).models).toEqual([{ name: "User", softDelete: true }]);
  });

  it("refuses an endpoint line it cannot read rather than skipping it", () => {
    const broken = FEATHERS_YAML.replace(/handler: users\.get,\s+auth: any/, "handler: users.get");
    expect(broken).not.toBe(FEATHERS_YAML);
    expect(() => contractOf(broken)).toThrow(/endpoint/);
  });

  it("refuses an unknown method or role gate", () => {
    expect(() => contractOf(FEATHERS_YAML.replace("method: PATCH", "method: BREW"))).toThrow();
    const root = FEATHERS_YAML.replace(/auth: admin\s*\}/, "auth: root }");
    expect(root).not.toBe(FEATHERS_YAML);
    expect(() => contractOf(root)).toThrow();
  });

  it("refuses a schema with no endpoints", () => {
    expect(() => contractOf("service:\n  name: x\n")).toThrow(/no endpoints/);
  });
});
