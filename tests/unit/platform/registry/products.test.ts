import { describe, expect, it } from "vitest";
import { PRODUCTS, SERVICES } from "@/platform/registry/products";

const NEVER_USE = [
  "bastion.vercel.app",
  "paper-trail-backend.onrender.com",
  "paper-trail-frontend.vercel.app",
  "magpie-backend.onrender.com",
  "magpie-frontend.vercel.app",
  "abdulmuizz.dev",
];

describe("registry", () => {
  it("has the eight products", () => {
    expect(PRODUCTS.map((p) => p.id)).toEqual([
      "bastion",
      "feathers",
      "inkgrid",
      "inkthread",
      "inkprint",
      "magpie",
      "paper-trail",
      "slowquery",
    ]);
  });

  it("has the six services with the contract defaults", () => {
    expect(Object.keys(SERVICES).sort()).toEqual(
      ["feathers-demo", "inkprint", "inkthread", "magpie", "paper-trail", "slowquery"].sort(),
    );
    expect(SERVICES["paper-trail"].baseUrl).toBe("https://paper-trail-backend-jjpf.onrender.com");
    expect(SERVICES["feathers-demo"].baseUrl).toBe("https://feathers-demo-rznj.onrender.com");
    for (const s of Object.values(SERVICES)) {
      expect(s.healthPath).toBe("/health");
      expect(s.versionPath).toBe("/version");
    }
  });

  it("only references services that exist", () => {
    for (const p of PRODUCTS) for (const s of p.services) expect(SERVICES[s]).toBeDefined();
  });

  it("keeps taglines short and receipts present", () => {
    for (const p of PRODUCTS) {
      expect(p.tagline.length).toBeLessThanOrEqual(90);
      expect(p.receipt.length).toBeGreaterThan(0);
    }
  });

  it("contains no never-use host anywhere", () => {
    const blob = JSON.stringify({ PRODUCTS, SERVICES });
    for (const host of NEVER_USE) expect(blob).not.toContain(host);
  });
});
