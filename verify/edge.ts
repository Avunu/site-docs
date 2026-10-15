// Checks the built site of the edge-case project of the fixture workspace (fixtures/workspace/projects/edge:
// a README that starts with a comment and a badge, links written from the repository root, a page whose
// title and tags look like template expressions, a second level-one heading, folder pages) against what a
// reader would see.
//
//   bun edge.ts <workspace root>        (a built copy of fixtures/workspace; `bun run.ts` does all of this)
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.argv[2] ?? "");
const dist = join(root, "dist");
if (!process.argv[2] || !existsSync(dist)) {
  console.error("usage: bun edge.ts <workspace root, built>");
  process.exit(2);
}
let failures = 0;
const check = (ok: boolean, what: string, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${!ok && detail ? `  (${detail})` : ""}`);
};
const read = (route: string) => readFileSync(join(dist, route, "index.html"), "utf8");
const text = (html: string) =>
  html
    .replaceAll(/<[^>]*>/g, "")
    .replaceAll("&#36;", "$")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .trim();
const h1s = (html: string) =>
  [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => text(m[1]!));
const h2s = (html: string) =>
  [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => text(m[1]!));
const hrefs = (html: string) => [...html.matchAll(/\shref="([^"]*)"/g)].map((m) => m[1]!);
const base = "https://github.com/Example/edge";
const P = "/edge/docs"; // where the project's documentation is published

// every page
const pages: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) walk(file);
    else if (name === "index.md") check(false, `no Markdown copy of a page is published (${file})`);
    else if (name.endsWith(".html")) pages.push(file);
  }
};
walk(dist);
for (const file of pages) {
  const count = (readFileSync(file, "utf8").match(/<h1[\s>]/g) ?? []).length;
  check(count === 1, `exactly one h1 on ${file.slice(dist.length)}`, `${count}`);
}
check(existsSync(join(dist, "404.html")), "404.html is published");

// the README: a comment, a badge, then the title
const home = read("edge/docs");
check(
  JSON.stringify(h1s(home)) === JSON.stringify(["Sandbox App"]),
  "the README's title is the h1",
  JSON.stringify(h1s(home)),
);
check(
  h2s(home).includes("A second level-one heading") && h2s(home).includes("Links"),
  "a second level-one heading is a section heading",
  JSON.stringify(h2s(home)),
);
check(
  /<title>Sandbox App · Sandbox<\/title>/.test(home),
  "the page title is the heading and the site",
  home.match(/<title>.*?<\/title>/)?.[0],
);
const links = hrefs(home);
for (const [what, href] of [
  ["a folder README written from the root", `${base}/blob/main/worker/README.md`],
  ["a source file with a line anchor", `${base}/blob/main/lib/x.nix#L3`],
  ["the licence", `${base}/blob/main/LICENSE`],
  ["a file written for docs/ (../)", `${base}/blob/main/CONTRIBUTING.md`],
  ["a folder", `${base}/tree/main/lib`],
  ["a page of docs/ written from the root, with its anchor", `${P}/chat/#top`],
  ["another page written from the root", `${P}/templated/`],
  ["the badge's target", `${base}/actions`],
] as const)
  check(links.includes(href), `link: ${what}`, href);
check(
  home.includes(`src="${base}/raw/main/assets/logo.png"`),
  "an image of the repository is a raw GitHub address",
);
check(
  !links.some((h) => !/^https?:/.test(h) && /\.md(#|$)/.test(h)),
  "no link of the site itself ends in .md",
);
check(home.includes("[x](worker/README.md)"), "a link in a code span is left as written");
check(
  /<a href="https:\/\/github\.com\/Example\/edge\/actions"[^>]*><img/.test(home),
  "the badge keeps its image and its link",
);
const code = [...home.matchAll(/<pre[\s\S]*?<\/pre>/g)].map((m) => text(m[0])).join("\n");
check(
  code.includes('echo "${HOME}" && cat worker/README.md'),
  "code with ${...} comes out as written",
  code,
);
check(
  text(home).includes("Set ${HOME} and run"),
  "text with ${...} in a code span comes out as written",
);

// a page whose frontmatter sits under a comment, with template-looking text
const templated = read("edge/docs/templated");
check(
  JSON.stringify(h1s(templated)) === JSON.stringify(["Set ${HOME} safely"]),
  "a title with ${...} is text",
  JSON.stringify(h1s(templated)),
);
check(
  /<title>Set \$\{HOME\} safely · Sandbox<\/title>/.test(templated),
  "and so is the <title>",
  templated.match(/<title>.*?<\/title>/)?.[0],
);
const tags = [...templated.matchAll(/class="tags"[\s\S]*?<\/ul>/g)]
  .map((m) => [...m[0].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((x) => text(x[1]!)))
  .flat();
check(
  JSON.stringify(tags) === JSON.stringify(["t${1+1}", "a&b"]),
  "tags with ${...} and & are text",
  JSON.stringify(tags),
);
const toc = [...templated.matchAll(/class="d2">([\s\S]*?)<\/a>/g)].map((m) => text(m[1]!));
check(
  toc.length > 0 && toc.every((t) => t.startsWith("Heading ${1+1} and")),
  "the contents list shows a heading with ${...} as text",
  JSON.stringify(toc),
);
check(
  /name="description" content="Use \$\{HOME\} &amp; &lt;angle brackets(&gt;|>) carefully\."/.test(
    templated,
  ),
  "the description is escaped",
  templated.match(/name="description"[^>]*>/)?.[0],
);
check(
  /<a [^>]*href="\/edge\/docs\/templated\/"[^>]*>Set (\$|&#36;)\{HOME\} safely<\/a>/.test(home),
  "the sidebar shows the title with ${...} as text",
);
const searchIndex = readFileSync(join(dist, "search-index.json"), "utf8");
check(searchIndex.includes("Set ${HOME} safely"), "and so does the search index");
check(!read("edge/docs/chat").includes("moved the comment"), "(the stage note is not in the page)");

// the landing page lists the first pages as cards: a title and a description that look like template
// expressions are text there too (they were once bound at run time, which threw in the browser)
const landing = read("edge");
check(
  /<a class="card" href="\/edge\/docs\/templated\/">[\s\S]*?Set (\$|&#36;)\{HOME\} safely/.test(landing),
  "the landing page's card shows the title with ${...} as text",
);
check(!landing.includes(":text-content="), "and nothing on the landing page is bound at run time");

// folders: a README.md or index.md inside a folder is the folder's page and takes the folder's address
const section = read("edge/docs/guides");
check(
  JSON.stringify(h1s(section)) === JSON.stringify(["Guides"]),
  "docs/guides/README.md is published at /edge/docs/guides/",
  JSON.stringify(h1s(section)),
);
check(!existsSync(join(dist, "edge", "docs", "guides", "readme")), "and not also at /edge/docs/guides/readme/");
const sectionLinks = hrefs(section);
for (const [what, href] of [
  ["a sibling page", `${P}/guides/install/`],
  ["a folder's index.md written as a file", `${P}/guides/advanced/`],
  ["the home page's README written as a file", `${P}/`],
] as const)
  check(sectionLinks.includes(href), `link from a folder page: ${what}`, href);
check(
  text(section).includes("The price is ${price} per seat"),
  "${...} in the prose of a Markdown page is literal text",
);
check(
  /docs-callout/.test(section) && text(section).includes("A tip in a folder page."),
  "a GitHub alert in a folder page is a callout",
);
const advanced = read("edge/docs/guides/advanced");
check(
  JSON.stringify(h1s(advanced)) === JSON.stringify(["Advanced notes"]),
  "docs/guides/advanced/index.md is published at /edge/docs/guides/advanced/",
  JSON.stringify(h1s(advanced)),
);
check(
  hrefs(read("edge/docs/guides/install")).includes(`${P}/guides/`),
  "a link to a folder's README written as a file is the folder's address",
);
const sidebar = hrefs(home);
for (const href of [`${P}/guides/`, `${P}/guides/install/`, `${P}/guides/advanced/`])
  check(sidebar.includes(href), `the sidebar lists ${href}`);
check(
  searchIndex.includes(`"${P}/guides/"`) && searchIndex.includes(`"${P}/guides/advanced/"`),
  "the search index has the folder pages",
);
const searched = (JSON.parse(searchIndex) as { documents: Array<{ title: string; slug: string }> })
  .documents;
check(
  searched.every((doc) => doc.title !== doc.slug && doc.title !== doc.slug.split("/").pop()),
  "and none is titled by its file id",
  JSON.stringify([...new Set(searched.map((doc) => doc.title))]),
);

// the workspace: the project's pages know nothing of the other project, the site's landing page lists both
check(
  !hrefs(home).some((h) => h.startsWith("/example/")),
  "the sidebar of one project does not link to the pages of another",
);
check(
  searched.some((doc) => doc.slug.startsWith("example/")) &&
    searched.some((doc) => doc.slug.startsWith("edge/")),
  "the search index holds the pages of both projects",
  JSON.stringify([...new Set(searched.map((doc) => doc.slug.split("/")[0]))]),
);
const siteHome = hrefs(readFileSync(join(dist, "index.html"), "utf8"));
check(
  siteHome.includes("/edge/") && siteHome.includes("/example/"),
  "the landing page of the site links to each project's landing page",
);

console.log(failures === 0 ? "edge: all checks passed" : `edge: ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
