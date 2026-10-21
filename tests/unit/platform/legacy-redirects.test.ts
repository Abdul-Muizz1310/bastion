import { describe, expect, it } from "vitest";
import { legacyRedirects } from "@/platform/legacy-redirects";

/** Spec 21 §3.2 "Redirects": v1's /dashboard and /services/<id> point at their v2 pages. */

describe("legacyRedirects", () => {
  it("builds the two permanent rules from the product ids", () => {
    expect(legacyRedirects(["magpie", "paper-trail"])).toEqual([
      { source: "/dashboard", destination: "/platform", permanent: true },
      { source: "/services/:id(magpie|paper-trail)", destination: "/tools/:id", permanent: true },
    ]);
  });

  it.each([["(a|b)"], ["a.b"], [""], ["A"], ["a/b"]])(
    "refuses a product id that is not a plain slug (%s): it would change the pattern",
    (id) => {
      expect(() => legacyRedirects(["magpie", id])).toThrow(RangeError);
    },
  );

  it("refuses no products at all", () => {
    expect(() => legacyRedirects([])).toThrow(RangeError);
  });
});
