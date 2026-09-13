import { expect, test, type Page, type TestInfo } from "@playwright/test";

async function openHomeWithCards(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="discovery-toolbar"][data-hydrated="true"]').waitFor({
    state: "visible",
    timeout: 30_000,
  });
  const cards = page.getByTestId("youtube-card");
  await expect(cards.first()).toBeVisible({ timeout: 30_000 });
  await expect(cards.nth(1)).toBeVisible({ timeout: 30_000 });
  await expect(cards.first().getByTestId("youtube-card-thumbnail")).toBeVisible({ timeout: 30_000 });
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
}

test.describe("YouTube-style home card body", () => {
  test("serves feed thumbnails without the Vercel image optimizer", async ({ page }) => {
    await openHomeWithCards(page);

    const thumbnail = page
      .getByTestId("youtube-card")
      .first()
      .getByTestId("youtube-card-thumbnail")
      .locator("img");

    await expect(thumbnail).toHaveAttribute("src", "/images/og/og-image.png");
  });

  test("mobile uses one column with 16:9 thumbnails and no overflow", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await openHomeWithCards(page);

    const cards = page.getByTestId("youtube-card");
    const first = await cards.nth(0).boundingBox();
    const second = await cards.nth(1).boundingBox();
    const thumbnail = await cards.nth(0).getByTestId("youtube-card-thumbnail").boundingBox();

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(thumbnail).not.toBeNull();
    expect(Math.abs(first!.x - second!.x)).toBeLessThanOrEqual(1);
    expect(second!.y).toBeGreaterThan(first!.y + first!.height);
    expect(thumbnail!.width / thumbnail!.height).toBeCloseTo(16 / 9, 2);

    const summaryAction = cards.nth(0).getByTestId("youtube-card-summary-action");
    const captureAction = cards.nth(0).getByTestId("youtube-card-capture-action");
    const summaryActionBox = await summaryAction.boundingBox();
    expect(summaryActionBox).not.toBeNull();
    expect(summaryActionBox!.height).toBeGreaterThanOrEqual(44);
    expect(summaryActionBox!.width).toBeLessThan(first!.width / 2);
    await expect(captureAction).toBeVisible();
    const captureBox = await captureAction.boundingBox();
    expect(captureBox).not.toBeNull();
    expect(captureBox!.height).toBeGreaterThanOrEqual(44);
    await summaryAction.click();
    const sheet = page.getByTestId("ai-summary-panel");
    await expect(sheet).toBeVisible();
    const sheetBox = await sheet.boundingBox();
    expect(sheetBox).not.toBeNull();
    expect(sheetBox!.width).toBeCloseTo(393, 0);
    expect(sheetBox!.y + sheetBox!.height).toBeCloseTo(852, 0);
    await sheet.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(sheet).toBeHidden();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await capture(page, testInfo, "home-card-mobile-393");
  });

  test("mobile card opens in-app playback and keeps actions visually connected", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const card = page.getByTestId("youtube-card").first();
    await expect(card).toBeVisible({ timeout: 30_000 });

    const playbackLink = card.locator("a").first();
    await expect(playbackLink).toHaveAttribute("href", /viewMode=longform/);
    await expect(playbackLink).toHaveAttribute("href", /watch=/);
    await expect(playbackLink).toHaveAttribute("href", /source=UC/);
    await expect(playbackLink).not.toHaveAttribute("target", "_blank");

    const summary = card.getByTestId("youtube-card-summary-action");
    const radio = card.getByTestId("youtube-card-mobile-radio");
    const summaryBox = await summary.boundingBox();
    const radioBox = await radio.boundingBox();
    expect(summaryBox).not.toBeNull();
    expect(radioBox).not.toBeNull();
    expect(radioBox!.x - (summaryBox!.x + summaryBox!.width)).toBeLessThanOrEqual(16);
  });

  test("desktop keeps a dense grid and aligned first-row cards", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openHomeWithCards(page);

    const cards = page.getByTestId("youtube-card");
    const count = Math.min(await cards.count(), 8);
    const boxes = await Promise.all(Array.from({ length: count }, (_, index) => cards.nth(index).boundingBox()));
    const visibleBoxes = boxes.filter((box): box is NonNullable<typeof box> => box !== null);
    expect(visibleBoxes.length).toBeGreaterThanOrEqual(3);
    const firstY = visibleBoxes[0]!.y;
    const firstRow = visibleBoxes.filter((box) => Math.abs(box.y - firstY) <= 1);
    const uniqueColumns = new Set(visibleBoxes.map((box) => Math.round(box.x)));

    expect(uniqueColumns.size).toBeGreaterThanOrEqual(3);
    expect(firstRow.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...firstRow.map((box) => box.height)) - Math.min(...firstRow.map((box) => box.height))).toBeLessThanOrEqual(1.5);

    const titleStyle = await cards.nth(0).getByTestId("youtube-card-title").evaluate((node) => {
      const style = getComputedStyle(node);
      return { fontSize: style.fontSize, lineHeight: style.lineHeight, lineClamp: style.webkitLineClamp };
    });
    expect(titleStyle.fontSize).toBe("16px");
    expect(titleStyle.lineClamp).toBe("2");

    const firstCard = cards.nth(0);
    const hoverActions = firstCard.getByTestId("youtube-card-hover-actions");
    await expect(hoverActions).toHaveCSS("opacity", "0");
    await firstCard.hover();
    await expect(hoverActions).toHaveCSS("opacity", "1");

    await firstCard.getByTestId("youtube-card-summary-action").click();
    const panel = page.getByTestId("ai-summary-panel");
    await expect(panel).toBeVisible();
    const panelBox = await panel.boundingBox();
    expect(panelBox).not.toBeNull();
    expect(panelBox!.width).toBeCloseTo(400, 0);
    expect(panelBox!.x + panelBox!.width).toBeCloseTo(1440, 0);
    await capture(page, testInfo, "home-card-desktop-1440");
  });
});
