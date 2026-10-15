// Keyboard and behaviour test of the project switcher in a real browser.
//
//   bun switcher.ts <dist> [route]        (<dist> is <root>/.site-docs/site/dist of a workspace build)
//
// The list is built into every page at build time from the catalog that projects.json produces and
// is never fetched. Covers: without script the two avunu.net links still work, the list is complete and
// grouped, the current project is marked, projects with documentation here link to their own pages,
// the disclosure pattern (Enter or Space opens it, focus stays on the button, Tab walks the links and
// out of the list, which closes it, Shift+Tab goes back, Escape closes it and focus is on the
// button), light dismiss, no layout shift, no request to another site, a list that fits a phone
// screen, and reduced motion.
import { resolve } from "node:path";
import type { Page } from "playwright-core";
import { defaultDocsRoute, launch, serve, snapshotOf, watch } from "./lib.ts";

const [distArg, routeGiven] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!distArg) {
  console.error("usage: bun switcher.ts <dist> [route]");
  process.exit(2);
}
const dist = resolve(distArg);
const routeArg = routeGiven ?? defaultDocsRoute(dist);
const snapshot = JSON.parse(snapshotOf(dist)) as {
  projects: Array<{ slug: string; docs: string | null }>;
};
const hereSlug = /^\/([^/]+)\//.exec(routeArg)?.[1] ?? "";
const withDocs = snapshot.projects.filter((p) => typeof p.docs === "string" && p.docs !== "");

let failures = 0;
const check = (ok: boolean, what: string, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${!ok && detail ? `  (${detail})` : ""}`);
};

const server = serve(dist);
const origin = `http://localhost:${server.port}`;
const url = `${origin}${routeArg}`;
const browser = await launch();

const links = (page: Page) => page.locator("project-switcher .menu a");
const isOpen = (page: Page) =>
  page.locator("project-switcher .menu").evaluate((el) => el.matches(":popover-open"));
const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el
      ? `${el.tagName.toLowerCase()}|${(el.textContent ?? "").trim().replace(/\s+/g, " ")}`
      : "";
  });

// 1. Without JavaScript the two avunu.net links still work and the button still opens the list.
{
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(url);
  const items = await links(page).count();
  check(
    items === 2,
    "without JavaScript the list still offers the two avunu.net links",
    `${items} items`,
  );
  await page.locator("project-switcher button.trigger").click();
  check(await isOpen(page), "without JavaScript the button still opens the list");
  await context.close();
}

// 2. The list: complete, grouped, current project marked, links, nothing fetched, the keyboard.
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const probe = watch(page);
  const foreign: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.origin !== origin && u.protocol.startsWith("http")) foreign.push(r.url());
  });
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as Array<{
        value: number;
        hadRecentInput: boolean;
      }>)
        if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  check(foreign.length === 0, "the page asks no other site for anything", JSON.stringify(foreign));
  check(
    (await links(page).count()) === snapshot.projects.length + 2,
    "the list holds every project of the catalog and two avunu.net links",
  );

  const labels = await page
    .locator("project-switcher .menu ul")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  check(
    JSON.stringify(labels) ===
      JSON.stringify(["Frappe & ERPNext", "Odoo", "WordPress", "NixOS", "General", "Avunu"]),
    "groups are by platform, in order, then Avunu",
    JSON.stringify(labels),
  );
  const current = page.locator('project-switcher [aria-current="true"]');
  const currentText = await current.allTextContents();
  check(
    currentText.length === 1 && currentText[0]!.includes("You are here"),
    "exactly one entry is the current project",
    JSON.stringify(currentText),
  );
  const own = await current.getAttribute("href");
  check(
    new URL(own ?? "", origin).pathname === `/${hereSlug}/`,
    "the current project links to its own landing page",
    String(own),
  );
  const hrefs = await links(page).evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  check(
    withDocs.every((p) =>
      hrefs.some((h) => h !== null && new URL(h, origin).pathname === new URL(p.docs!).pathname),
    ),
    "every project with documentation here links to its landing page",
  );
  check(
    (await page.locator('project-switcher a[href="https://avunu.net/"]').count()) === 1,
    "the list has a Back to avunu.net link",
  );
  check(
    (await page
      .locator("project-switcher [role=menu], project-switcher [role=menuitem]")
      .count()) === 0,
    "it is a disclosure of links: no menu or menuitem roles",
  );
  const button = page.locator("project-switcher button.trigger");
  check(
    (await button.getAttribute("aria-haspopup")) === null,
    "the button does not claim a menu (no aria-haspopup)",
  );

  // The disclosure pattern.
  const before = await button.boundingBox();
  const heightBefore = await page.evaluate(() => document.documentElement.scrollHeight);
  await button.focus();
  check((await button.getAttribute("aria-expanded")) === "false", "the button starts collapsed");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
  check((await button.getAttribute("aria-expanded")) === "true", "Enter on the button opens it");
  check(await isOpen(page), "the list is a popover and is open");
  check(
    (await focused(page)).startsWith("button|"),
    "focus stays on the button when it opens",
    await focused(page),
  );
  await page.keyboard.press("Tab");
  const first = await focused(page);
  check(first.startsWith("a|"), "Tab goes into the first link of the list", first);
  await page.keyboard.press("Tab");
  const second = await focused(page);
  check(second !== first && second.startsWith("a|"), "Tab moves to the next link", second);
  await page.keyboard.press("Shift+Tab");
  check((await focused(page)) === first, "Shift+Tab moves back");
  const grid = await page.locator("project-switcher .menu").boundingBox();
  const vp = page.viewportSize()!;
  check(
    !!grid && grid.x >= 0 && grid.x + grid.width <= vp.width && grid.y >= 0,
    "the open list stays inside the viewport",
    JSON.stringify(grid),
  );
  check(
    JSON.stringify(before) === JSON.stringify(await button.boundingBox()),
    "opening the list does not move the button",
  );
  check(
    (await page.evaluate(() => document.documentElement.scrollHeight)) === heightBefore,
    "opening the list does not change the page height",
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  check((await button.getAttribute("aria-expanded")) === "false", "Escape closes the list");
  check(
    (await focused(page)).startsWith("button|Projects"),
    "Escape from a link returns focus to the button",
    await focused(page),
  );
  await page.keyboard.press("Space");
  await page.waitForTimeout(200);
  check((await button.getAttribute("aria-expanded")) === "true", "Space on the button opens it");
  // Tab through every link: the last Tab leaves the list, which closes it.
  const count = await links(page).count();
  for (let i = 0; i < count; i++) await page.keyboard.press("Tab");
  check(
    (await focused(page)).includes("Back to avunu.net"),
    "Tab reaches the last link after as many presses as there are links",
    await focused(page),
  );
  check(await isOpen(page), "the list is still open on its last link");
  await page.keyboard.press("Tab");
  await page.waitForTimeout(200);
  check((await button.getAttribute("aria-expanded")) === "false", "Tab out of the list closes it");
  await button.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  await page.mouse.click(700, 500);
  await page.waitForTimeout(200);
  check(
    (await button.getAttribute("aria-expanded")) === "false",
    "clicking outside closes the list",
  );
  const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
  check(cls < 0.02, "cumulative layout shift stays under 0.02 across load and use", String(cls));
  check(
    probe.consoleErrors.length === 0,
    "no console errors",
    JSON.stringify(probe.consoleErrors),
  );
  await context.close();
}

// 3. A phone screen.
{
  const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  await page.locator("project-switcher button.trigger").focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
  check(await isOpen(page), "the list opens with the keyboard at 390px");
  const box = await page.locator("project-switcher .menu").boundingBox();
  check(
    !!box && box.x >= 0 && box.x + box.width <= 390,
    "the list fits a phone screen",
    JSON.stringify(box),
  );
  await context.close();
}

// 4. Reduced motion: no animation on the list.
{
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  const duration = await page
    .locator("project-switcher .menu")
    .evaluate((el) => getComputedStyle(el).transitionDuration);
  check(
    duration.split(",").every((d) => Number.parseFloat(d) < 0.001),
    "reduced motion: the list has no transition",
    duration,
  );
  await context.close();
}

await browser.close();
server.stop();
console.log(
  failures === 0 ? "switcher: all checks passed" : `switcher: ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
