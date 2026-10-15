// Builds the sidebar, the previous/next links and the landing-page cards from the documentation
// files. buildNav is a pure function; writeNav (step 7 of the pipeline) reads the staged copy of the
// Markdown and writes `.generated/nav.json`, which layouts/docs.json and pages/[...path].json read at
// build time as the `nav` content type.
import {
  DOCS_PREFIX,
  descriptionOf,
  labelOf,
  orderOf,
  readDocsWithProblems,
  titleOf,
  urlFor,
} from "./docs.js";
import { writeJson } from "./fsutil.js";
import { neutralizeStrings } from "./inert.js";
import { humanize } from "./slug.js";
import type {
  DocFile,
  SiteConfig,
  NavData,
  NavGroup,
  NavLink,
  NavSection,
  PageInfo,
  Paths,
} from "./types.js";

interface Folder {
  dir: string;
  name: string;
  index: DocFile | null;
  pages: DocFile[];
  folders: Folder[];
}

/** Up to this many pages beyond the home page the sidebar starts with every section open. */
const EXPAND_ALL_LIMIT = 24;
/** How many cards the landing page shows. */
const FEATURED = 6;
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function byOrder<T>(order: (item: T) => number, label: (item: T) => string) {
  return (a: T, b: T) => {
    const oa = order(a);
    const ob = order(b);
    if (oa !== ob) return oa < ob ? -1 : 1;
    return collator.compare(label(a), label(b));
  };
}

/** Drops pages that would share a URL with an earlier one (Jx keeps the first and warns). */
export function dedupe(
  files: DocFile[],
  prefix: string = DOCS_PREFIX,
): { files: DocFile[]; duplicates: string[] } {
  const seen = new Map<string, string>();
  const kept: DocFile[] = [];
  const duplicates: string[] = [];
  for (const file of files) {
    const url = urlFor(file, prefix);
    const first = seen.get(url);
    if (first) {
      duplicates.push(
        `${file.rel} has the same address as ${first} (${url}); only ${first} is published`,
      );
      continue;
    }
    seen.set(url, file.rel);
    kept.push(file);
  }
  return { files: kept, duplicates };
}

function tree(files: DocFile[]): Folder {
  const root: Folder = { dir: "", name: "", index: null, pages: [], folders: [] };
  const folders = new Map<string, Folder>([["", root]]);
  const folderFor = (dir: string): Folder => {
    const known = folders.get(dir);
    if (known) return known;
    const slash = dir.lastIndexOf("/");
    const folder: Folder = { dir, name: dir.slice(slash + 1), index: null, pages: [], folders: [] };
    folders.set(dir, folder);
    folderFor(slash === -1 ? "" : dir.slice(0, slash)).folders.push(folder);
    return folder;
  };
  for (const file of files) {
    const folder = folderFor(file.dir);
    if (file.isIndex) folder.index = folder.index ?? file;
    else folder.pages.push(file);
  }
  return root;
}

const folderOrder = (folder: Folder) =>
  folder.index ? orderOf(folder.index) : Number.POSITIVE_INFINITY;
const folderLabel = (folder: Folder) =>
  folder.index ? labelOf(folder.index) : humanize(folder.name);

/** Every page below a folder in reading order: the folder's pages first, then each subfolder. */
function collect(folder: Folder): DocFile[] {
  const out: DocFile[] = [];
  if (folder.index) out.push(folder.index);
  out.push(...folder.pages.toSorted(byOrder<DocFile>(orderOf, (f) => labelOf(f))));
  for (const sub of folder.folders.toSorted(byOrder(folderOrder, folderLabel)))
    out.push(...collect(sub));
  return out;
}

/** The address of a file; the prefix is the one of the project the navigation is for. */
type UrlOf = (file: Pick<DocFile, "dir" | "base" | "isIndex">) => string;

const link = (url: UrlOf, file: DocFile, label = labelOf(file)): NavLink => ({
  label,
  url: url(file),
});

function group(folder: Folder, visible: (file: DocFile) => boolean, url: UrlOf): NavGroup {
  const files = collect(folder);
  return {
    label: folderLabel(folder),
    url: folder.index ? url(folder.index) : null,
    urls: files.map((file) => url(file)),
    pages: files
      .filter(visible)
      .map((file) => (file === folder.index ? link(url, file, "Overview") : link(url, file))),
  };
}

/**
 * The navigation for a set of published pages. `home` is the README of docs/; every other top-level
 * file is a loose link, every top-level folder a section, and each folder inside a section a group
 * (deeper folders are listed inside their group, so the sidebar is never more than three levels).
 * A page with `hidden: true` is published and reachable, but is left out of the sidebar and of
 * previous/next. Throws when docs/ has no README.md (or index.md): it is the documentation home.
 * `docsFolder` is the Markdown folder relative to the repository root (`docs`, or `documentation` for
 * `"docs": "../documentation"`; "" or "." for the root itself), so that the message names the real file.
 */
export function buildNav(
  published: DocFile[],
  name = "Documentation",
  docsFolder = "docs",
  prefix: string = DOCS_PREFIX,
): { nav: NavData; warnings: string[] } {
  const urlOf: UrlOf = (file) => urlFor(file, prefix);
  const { files, duplicates } = dedupe(published, prefix);
  const warnings = [...duplicates];
  const root = tree(files);
  if (!root.index) {
    const readme =
      docsFolder === "" || docsFolder === "." ? "README.md" : `${docsFolder}/README.md`;
    throw new Error(
      `${readme} is missing: it is the documentation home (${prefix}/). Add one, or an index.md.`,
    );
  }
  const home = root.index;
  const visible = (file: DocFile) => file.data.hidden !== true;
  const sortPages = (pages: DocFile[]) =>
    pages.filter(visible).sort(byOrder<DocFile>(orderOf, (f) => labelOf(f)));
  const sortFolders = (folders: Folder[]) => folders.toSorted(byOrder(folderOrder, folderLabel));

  const flat: Array<{ title: string; url: string; file: DocFile; section: string }> = [];
  const push = (file: DocFile, section: string) => {
    if (visible(file)) flat.push({ title: titleOf(file, name), url: urlOf(file), file, section });
  };

  push(home, "");
  const loose = sortPages(root.pages);
  for (const file of loose) push(file, "");

  const sections: NavSection[] = [];
  for (const top of sortFolders(root.folders)) {
    const label = folderLabel(top);
    const own = [...(top.index && visible(top.index) ? [top.index] : []), ...sortPages(top.pages)];
    const groups = sortFolders(top.folders)
      .map((folder) => group(folder, visible, urlOf))
      .filter((g) => g.pages.length > 0);
    sections.push({
      label,
      url: top.index ? urlOf(top.index) : null,
      urls: collect(top).map((file) => urlOf(file)),
      pages: own.map((file) =>
        file === top.index ? link(urlOf, file, "Overview") : link(urlOf, file),
      ),
      groups,
    });
    for (const file of collect(top)) push(file, label);
  }

  const sectionOf = new Map<string, string>();
  for (const section of sections) for (const u of section.urls) sectionOf.set(u, section.label);
  const order = new Map(flat.map((entry, i) => [entry.url, i]));
  const pages: Record<string, PageInfo> = {};
  for (const file of files) {
    const address = urlOf(file);
    const at = order.get(address);
    const before = at === undefined ? undefined : flat[at - 1];
    const after = at === undefined ? undefined : flat[at + 1];
    pages[address] = {
      title: titleOf(file, name),
      description: descriptionOf(file),
      section: sectionOf.get(address) ?? "",
      prev: before ? { title: before.title, url: before.url } : null,
      next: after ? { title: after.title, url: after.url } : null,
      edit: file.rel,
    };
  }

  // Everything the sidebar lists besides the home page (which can be hidden itself).
  const others = flat.filter((entry) => entry.file !== home);
  const nav: NavData = {
    home: {
      label: root.index.data.nav_title ? labelOf(root.index, name) : "Overview",
      url: urlOf(home),
    },
    loose: loose.map((file) => link(urlOf, file)),
    sections: sections.filter((s) => s.pages.length > 0 || s.groups.length > 0),
    expandAll: others.length <= EXPAND_ALL_LIMIT,
    pages,
    flat: flat.map(({ title, url }) => ({ title, url })),
    featured: others.slice(0, FEATURED).map(({ title, url, file, section }) => ({
      title,
      description: descriptionOf(file),
      url,
      section,
    })),
  };
  // Titles, labels and descriptions come from files that a pull request can change (frontmatter, a
  // heading, a code span in one, the name of a folder), and the layouts hand some of them to
  // components as props, which Jx evaluates once more. Nothing in here may hold `${` (inert.ts).
  return { nav: neutralizeStrings(nav), warnings };
}

/**
 * Step 7 of the pipeline (5.1): computes the navigation from the staged Markdown
 * (`paths.stagedDocs`) and writes it to `paths.navFile`. `pages` is the number of pages Jx will
 * publish: every published file, once per address (a file that shares an address with an earlier one
 * is left out and named in `warnings`), hidden pages included.
 *
 * A page whose frontmatter is not valid YAML does not stop the step: it is listed as if it had no
 * frontmatter and a warning names the problem (the lint reports it as an error, and Jx refuses the
 * page, so the build does not publish). Throws only when the documentation has no home page;
 * `o.folder` is the Markdown folder as buildNav takes it.
 */
export function writeNav(
  paths: Pick<Paths, "stagedDocs" | "navFile">,
  config: Pick<SiteConfig, "name">,
  o: { folder?: string; prefix?: string } = {},
): { nav: NavData; warnings: string[]; pages: number } {
  const { files, problems } = readDocsWithProblems(paths.stagedDocs);
  const { nav, warnings } = buildNav(files, config.name, o.folder, o.prefix);
  writeJson(paths.navFile, nav);
  return {
    nav,
    warnings: [
      ...problems.map((problem) => `${problem.message}; it is listed as if it had none`),
      ...warnings,
    ],
    pages: Object.keys(nav.pages).length,
  };
}
