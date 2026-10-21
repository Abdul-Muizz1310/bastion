import { expect, type Page, test } from "@playwright/test";
import { SITE } from "../../src/lib/site/config";

/**
 * E2E — spec 20, site metadata (case 12). There is no sign-in (spec 21 §2), so crawlers and
 * link-preview bots read the home page's head like any visitor.
 */

const content = (page: Page, selector: string) =>
  page.locator(`head ${selector}`).first().getAttribute("content");

test.describe("20-e2e: site metadata", () => {
  test("case 12: / carries the site's head tags", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(SITE.title);
    expect(await content(page, 'meta[name="description"]')).toBe(SITE.description);
    expect(await content(page, 'meta[property="og:title"]')).toBe(SITE.title);
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

  test("case 12: / can be indexed", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('head meta[name="robots"]')).toHaveCount(0);
  });

  test("case 17: / carries the site's structured data", async ({ page }) => {
    await page.goto("/");
    const scripts = page.locator('script[type="application/ld+json"]');
    await expect(scripts).toHaveCount(1);
    const graph = JSON.parse((await scripts.textContent()) ?? "")["@graph"];
    expect(graph.map((node: { "@type": string }) => node["@type"])).toEqual([
      "WebSite",
      "WebApplication",
      "Person",
    ]);
    expect(graph[0]).toMatchObject({ url: `${SITE.url}/`, name: SITE.name });
  });

  test("case 17: a workbench describes itself, names itself as canonical and has its own card", async ({
    page,
    request,
  }) => {
    await page.goto("/tools/magpie");
    await expect(page).toHaveTitle("magpie workbench — bastion");
    const description = await content(page, 'meta[name="description"]');
    expect(description).toMatch(/^YAML scrapers that self-heal/);
    expect(await content(page, 'meta[property="og:description"]')).toBe(description);
    expect(await content(page, 'meta[name="twitter:description"]')).toBe(description);
    await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute(
      "href",
      `${SITE.url}/tools/magpie`,
    );
    const image = await content(page, 'meta[property="og:image"]');
    expect(image).toMatch(new RegExp(`^${SITE.url}/tools/magpie/opengraph-image`));
    expect(await content(page, 'meta[name="twitter:image"]')).toBe(image);
    expect(await content(page, 'meta[property="og:image:alt"]')).toBe(
      "bastion — operate magpie live, keep the receipt.",
    );

    const card = await request.get("/tools/magpie/opengraph-image");
    expect(card.status()).toBe(200);
    expect(card.headers()["content-type"]).toMatch(/^image\/png/);
  });

  test("case 17: a request trace stays out of search", async ({ page }) => {
    test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "the golden request is seeded only in the stub run");
    await page.goto("/audit/req-dossier-1");
    // Its own h1, so this is the trace and not a 404 (which Next marks noindex by itself).
    await expect(page.getByRole("heading", { level: 1 })).toContainText("request");
    expect(await content(page, 'meta[name="robots"]')).toBe("noindex");
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
