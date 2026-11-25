// Post-build fixes for what the Jx HTML emitter does to whitespace (step 11 of the pipeline, section
// 5.1). Same approach as avunu.net's scripts/tidy-html.ts, plus the highlighted-code case that pages
// here hit because every article body sits inside a component (docs-prose).
//
// 1. Between sibling nodes the emitter writes a newline (and, on pages, two spaces of indent).
//    Between block elements that is harmless; between inline siblings it renders, so `[link](/x/).`
//    comes out as "link ." and `` `code`, `` as "code ,". tidyHtml removes exactly that separator
//    and keeps every space the author wrote.
// 2. Highlighted code needs no fix. Jx 8 wrote a separator around every newline of a code block
//    inside a component, and this file took those back out. Jx 11 writes no whitespace between inline
//    siblings (jxsuite/jx#697), so the newlines in a block are the code's own and <pre> keeps them as
//    written. verify/fences.ts compares every block with its source, which is what would catch a Jx
//    that writes the separators again.
// 3. Component expansion leaves empty <slot></slot> elements behind: dropEmptySlots.
// 4. GitHub Pages serves a top-level 404.html for any unknown address. Jx 7 writes it there; Jx
//    before 7 wrote 404/index.html, and publishNotFoundPage moves that one.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { copyFile, removeInside } from "./fsutil.js";

const PROTECTED = /<(pre|textarea|script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;
const RUN = /([ \t]*)(\n[ \t\n]*)/g;

function fixRun(match: string, lead: string, rest: string, offset: number, whole: string): string {
  const prev = whole[offset - 1] ?? "";
  const next = whole[offset + lead.length + rest.length] ?? "";
  // Only whitespace at a tag boundary can be the emitter's. A newline between two words is the
  // author's soft line break and stays.
  if (prev !== ">" && next !== "<" && next !== "") return match;
  const newlines = rest.split("\n").length - 1;
  if (newlines >= 2) return " ";
  const trailing = rest.length - 1; // spaces after the newline
  if (next === "<" || next === "") return lead; // before a tag the whole tail is indent
  return lead + " ".repeat(trailing >= 2 ? trailing - 2 : trailing);
}

/** Removes the emitter's separators between inline siblings. <pre>, <textarea>, <script> and <style> are never touched. */
export function tidyHtml(html: string): string {
  let out = "";
  let last = 0;
  for (const m of html.matchAll(PROTECTED)) {
    out += html.slice(last, m.index).replace(RUN, fixRun);
    out += m[0];
    last = m.index + m[0].length;
  }
  return out + html.slice(last).replace(RUN, fixRun);
}

/** Component expansion leaves an unfilled <slot></slot> behind; it renders nothing and says nothing. */
export function dropEmptySlots(html: string): string {
  return html.replace(/<slot(?:\s[^>]*)?><\/slot>/g, "");
}

export function tidyPage(html: string): string {
  return dropEmptySlots(tidyHtml(html));
}

/**
 * GitHub Pages answers an unknown URL with a top-level `404.html`, where Jx 7 writes the page
 * `pages/404.json`. Jx before 7 wrote it to `404/index.html`, so that one is moved to `404.html`; the
 * `404/` folder goes, because `/404/` would otherwise be a real, indexable-looking URL. Returns
 * whether it moved a page.
 */
export function publishNotFoundPage(root: string): boolean {
  const built = join(root, "404", "index.html");
  if (!existsSync(built)) return false;
  copyFile(built, join(root, "404.html"));
  removeInside(join(root, "404"), root);
  return true;
}
