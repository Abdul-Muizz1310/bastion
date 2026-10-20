import { expect, type Page, test } from "@playwright/test";
import { z } from "zod";
import { expectReceiptFooter, firstGate, gateLive, receipt } from "./fixtures/helpers";

/**
 * spec 21 §5, §5.1 and §10.1 case 2: each of the eight workbenches, operated in a real browser
 * against the stub — its main action clicked (or reached by keyboard), and the receipt it hands
 * back with its copy button and its audit link. Every call goes through the gateway.
 */

/** Opens a workbench and waits for its wake gate to answer live. */
async function open(page: Page, product: string): Promise<void> {
  await page.goto(`/tools/${product}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(product);
  await gateLive(firstGate(page));
}

/** The value a claim row of the token inspector shows (`<dt>name</dt><dd>value …</dd>`). */
const claim = (page: Page, name: string) =>
  page.locator(`xpath=//dt[normalize-space()="${name}"]/following-sibling::dd[1]/span[1]`);

test.describe("21-e2e: the workbenches", () => {
  test("magpie: scrape once hands back the items' hashes, and the call is in the audit log", async ({
    page,
  }) => {
    await open(page, "magpie");
    // The first source with items is chosen once its list loads; its items come with it.
    await expect(page.getByRole("radio", { name: /^hackernews/ })).toBeChecked();
    await expect(receipt(page, "magpie items")).toBeVisible();
    await expect(receipt(page, "magpie heals")).toContainText("owner/repo/pull/1");

    await page.getByRole("button", { name: "scrape hackernews once" }).click();
    const card = receipt(page, "magpie scrape");
    await expect(card).toContainText("hackernews · 3 items");
    await expect(card).toContainText("first hash");
    await expectReceiptFooter(card);

    // The receipt's request id is the call's trail in the append-only log.
    await card.getByRole("link", { name: /audit trail/ }).click();
    await expect(page).toHaveURL(/\/audit\/[0-9a-f-]{36}$/);
    await expect(page.getByText("magpie.scrape").first()).toBeVisible();
  });

  test("inkgrid: an uploaded PDF is followed to its reading, the verification report its receipt", async ({
    page,
  }) => {
    const readings: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/tools/inkthread.reading")) readings.push(r.url());
    });
    await open(page, "inkgrid");
    // A sample is read as soon as inkthread is awake.
    await expect(receipt(page, "inkgrid verification")).toBeVisible();

    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "upload and read a PDF" }).click();
    const uploaded = page.waitForResponse(
      (r) => r.url().endsWith("/api/uploads") && r.request().method() === "POST",
    );
    await (await chooser).setFiles({
      name: "fee-schedule.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\n% an e2e upload\n%%EOF\n"),
    });
    const answer = z
      .object({ document_id: z.uuid(), job_id: z.uuid() })
      .parse(await (await uploaded).json());

    // The job is followed every 3 s until it succeeds; then the upload's own reading is read.
    await expect(page.getByText(/inkthread is reading it/)).toBeVisible();
    await expect
      .poll(() => readings.some((u) => u.includes(`documentId=${answer.document_id}`)), {
        timeout: 20_000,
      })
      .toBe(true);
    const card = receipt(page, "inkgrid verification");
    await expect(card).toContainText("disagreements");
    await expectReceiptFooter(card);
    // Each table as a cell grid: the first is open, its header rows marked.
    await expect(page.locator("details[data-table]").first().locator("table thead")).toBeVisible();
  });

  test("inkthread: by keyboard, an element's why and its box on the page", async ({ page }) => {
    await open(page, "inkthread");
    const graph = receipt(page, "inkthread graph");
    await expect(graph).toContainText("0cb34ee971ca076e");
    await expectReceiptFooter(graph);

    // The drawing is one tab stop: Tab reaches it, the arrow keys walk it in reading order.
    const focused = () =>
      page.evaluate(() => document.activeElement?.getAttribute("data-node") ?? null);
    let node: string | null = null;
    for (let i = 0; i < 80 && node === null; i++) {
      await page.keyboard.press("Tab");
      node = await focused();
    }
    expect(node).not.toBeNull();
    const paragraph = "p:c95bca1f83faa250";
    for (let i = 0; i < 10 && node !== paragraph; i++) {
      await page.keyboard.press("ArrowRight");
      node = await focused();
    }
    expect(node).toBe(paragraph);
    await page.keyboard.press("Enter");

    await expect(page.locator(`g[data-node="${paragraph}"]`)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const why = receipt(page, "inkthread why");
    await expect(why).toContainText(paragraph);
    await expectReceiptFooter(why);

    // The page, through the gateway, with the element boxed in PDF points.
    const image = page.getByRole("img", { name: /^page 1 of the document/ });
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
      .toBe(612);
    await expect(page.locator('rect[data-box="self"]')).toHaveCount(1);
  });

  test("inkprint: certify, verify as certified, then watch an altered text fail", async ({
    page,
  }) => {
    await open(page, "inkprint");
    await page.getByRole("button", { name: "certify", exact: true }).click();
    const certificate = receipt(page, "inkprint certificate");
    await expect(certificate).toBeVisible();
    await expectReceiptFooter(certificate);

    // The new certificate's id is pre-filled: load it and verify it as certified.
    await page.getByRole("button", { name: "load it" }).click();
    await expect(page.getByText("the text as certified")).toBeVisible();
    await page.getByRole("button", { name: "verify", exact: true }).click();
    const verification = receipt(page, "inkprint verification");
    await expect(verification.locator("p[data-tone]")).toHaveText("valid");
    await expectReceiptFooter(verification);

    await page.getByLabel("its text — as certified, or as you change it").fill("an altered text");
    await expect(page.getByText("the text has been changed")).toBeVisible();
    await page.getByRole("button", { name: "verify", exact: true }).click();
    await expect(verification.locator("p[data-tone]")).toHaveText("invalid");
    await expect(verification).toContainText("✕ fail");
  });

  test("paper-trail: a debate's rounds arrive, and its signed transcript checks live", async ({
    page,
  }) => {
    await open(page, "paper-trail");
    await page.getByRole("button", { name: "start the debate" }).click();
    // Rounds appear as they finish; the transcript is checked once the debate is done.
    await expect(page.getByText(/the basic filing fee/).first()).toBeVisible({ timeout: 15_000 });
    const card = receipt(page, "paper-trail transcript");
    await expect(card).toBeVisible({ timeout: 20_000 });
    // paper-trail's own code signed this transcript: the hash is recomputed, the signature verified.
    await expect(card).toContainText("✓ recomputed");
    await expect(card).toContainText("✓ verified");
    await expect(card.locator("p[data-tone]")).toHaveText("TRUE");
    await expectReceiptFooter(card);
  });

  test("slowquery: the fleet ranked, a fingerprint's plan and its exact CREATE INDEX", async ({
    page,
  }) => {
    await open(page, "slowquery");
    await page.getByRole("button", { name: "read the fleet" }).click();
    await expect(
      page.getByRole("table", { name: "the slowest query fingerprints across the fleet" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "plan for fingerprint 1" }).click();
    const plan = receipt(page, "slowquery plan");
    await expect(plan).toContainText("CREATE INDEX IF NOT EXISTS ix_orders_created_at");
    await expectReceiptFooter(plan);
  });

  test("feathers: the soft-delete proof creates, deletes, then reads a 404", async ({ page }) => {
    await open(page, "feathers");
    await page.getByRole("button", { name: "run the proof: create, delete, read" }).click();
    const proof = receipt(page, "feathers soft-delete proof");
    await expect(proof.locator("p[data-tone]")).toHaveText("soft delete honoured");
    await expect(proof).toContainText("GET /users/{id} → 404");
    await expectReceiptFooter(proof);
  });

  test("bastion: the token preview names the call's audience, and the call is audited", async ({
    page,
  }) => {
    await open(page, "bastion");
    await page.getByLabel("capability", { exact: true }).selectOption("inkprint.certify");
    await expect(claim(page, "aud")).toHaveText("inkprint");
    await expect(claim(page, "iss")).toHaveText("bastion");
    await expect(claim(page, "role")).toHaveText("editor");
    await expect(claim(page, "cap")).toHaveText("inkprint.certify");
    await expect(claim(page, "kid")).toHaveText("e2e-stub-key");

    await page.getByRole("button", { name: "make the call" }).click();
    const call = receipt(page, "bastion gateway call");
    await expect(call.locator("p[data-tone]")).toHaveText("audited");
    await expectReceiptFooter(call);
    await expect(page.getByText("✓ the inspector’s token names this key")).toBeVisible();
    // Decoded claims only: no compact JWS anywhere on the page.
    expect(await page.content()).not.toMatch(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/);
  });
});
