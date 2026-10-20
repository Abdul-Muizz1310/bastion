import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The accessibility baseline (convention-frontend-conventions): text contrast ≥ 4.5:1. Every colour
 * token in globals.css is classified as a surface, a text colour or a decoration; every text colour
 * must reach 4.5:1 on every surface it can sit on, and decoration colours are never used as text.
 */

const ROOT = resolve(__dirname, "../../..");
const CSS = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");

const SURFACES = ["background", "surface", "surface-hover"] as const;
const TEXT = [
  "foreground",
  "fg-muted",
  "fg-faint",
  "accent-violet",
  "accent-rose",
  "accent-cyan",
  "success",
  "warning",
  "error",
] as const;
const DECORATION = [
  "border",
  "border-bright",
  "line-faint",
  "accent-violet-soft",
  "mac-red",
  "mac-yellow",
  "mac-green",
] as const;

function rootTokens(css: string): Map<string, string> {
  const block = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
  return new Map([...block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1] ?? "", (m[2] ?? "").trim()]));
}

function themeColours(css: string): string[] {
  const block = /@theme inline\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
  return [...block.matchAll(/--color-([a-z0-9-]+):/g)].map((m) => m[1] ?? "");
}

function luminance(hex: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`not a #rrggbb colour: ${hex}`);
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const tokens = rootTokens(CSS);

describe("WCAG contrast of the design tokens", () => {
  it("computes the WCAG ratio (black on white is 21:1, a colour on itself 1:1)", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#a78bfa", "#a78bfa")).toBe(1);
  });

  it("classifies every colour token the theme exposes", () => {
    const known = new Set<string>([...SURFACES, ...TEXT, ...DECORATION]);
    for (const name of themeColours(CSS)) expect(known.has(name), `unclassified --color-${name}`).toBe(true);
  });

  for (const text of TEXT) {
    for (const surface of SURFACES) {
      it(`${text} on ${surface} reaches 4.5:1`, () => {
        const fg = tokens.get(text);
        const bg = tokens.get(surface);
        expect(fg, `--${text}`).toBeTruthy();
        expect(bg, `--${surface}`).toBeTruthy();
        expect(contrast(fg ?? "", bg ?? "")).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("keeps the faint text a step dimmer than the muted text", () => {
    const bg = tokens.get("background") ?? "";
    expect(contrast(tokens.get("fg-faint") ?? "", bg)).toBeLessThan(
      contrast(tokens.get("fg-muted") ?? "", bg),
    );
  });

  it("never sets text in a decoration colour", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(tsx?|css)$/.test(entry)) files.push(path);
      }
    };
    walk(join(ROOT, "src"));
    // Shapes may be filled with a decoration colour (the map's dot grid); text never is.
    const pattern = new RegExp(`\\btext-(${DECORATION.join("|")})\\b`);
    for (const file of files) {
      expect(pattern.test(readFileSync(file, "utf8")), file).toBe(false);
    }
  });
});
