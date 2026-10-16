import { expect, type Page, test } from "@playwright/test";
import { SITE } from "../../src/lib/site/config";

/**
 * E2E — spec 20, site metadata (case 12). Anonymous visitors (crawlers, link-preview bots)
 * are redirected from every gated page to /login, so /login is the page whose head they read.
 */

const content = (page: Page, selector: string) =>
  page.locator(`head ${selector}`).first().getAttribute("content");

test.describe("20-e2e: site metadata", () => {
  test("case 12: /login carries the site's head tags", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveTitle("sign in — bastion");
    expect(await content(page, 'meta[name="description"]')).toBe(SITE.description);
    expect(await content(page, 'meta[property="og:title"]')).toBe("sign in — bastion");
    expect(await content(page, 'meta[property="og:image"]')).toMatch(
      new RegExp(`^${SITE.url}/opengraph-image`),
    );
    expect(await content(page, 'meta[name="twitter:card"]')).toBe("summary_large_image");
    expect(await content(page, 'meta[name="twitter:image"]')).toMatch(
      new RegExp(`^${SITE.url}/opengraph-image`),
    );
    expect(await content(page, 'meta[name="theme-color"]')).toBe("#0a0a0a");
    await expect(page.locator('head link[rel="icon"][type="image/svg+xml"]')).toHaveCount(1);
    await expect(page.locator('head link[rel="apple-touch-icon"]')).toHaveCount(1);
    await expect(page.locator('head link[rel="manifest"]')).toHaveCount(1);
  });

  test("case 12: /login can be indexed", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('head meta[name="robots"]')).toHaveCount(0);
  });

  test("case 12: every metadata route answers with its content type, without a session", async ({
    request,
  }) => {
    const routes: [string, RegExp][] = [
      ["/opengraph-image", /^image\/png/],
      ["/icon.svg", /^image\/svg\+xml/],
      ["/apple-icon.png", /^image\/png/],
      ["/favicon.ico", /^image\/(x-icon|vnd\.microsoft\.icon)/],
      ["/icon-192.png", /^image\/png/],
      ["/icon-512.png", /^image\/png/],
      ["/icon-maskable-512.png", /^image\/png/],
      ["/manifest.webmanifest", /^application\/manifest\+json/],
      ["/robots.txt", /^text\/plain/],
      ["/sitemap.xml", /^application\/xml/],
    ];
    for (const [path, type] of routes) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(200);
      expect(response.headers()["content-type"], path).toMatch(type);
    }
  });
});
