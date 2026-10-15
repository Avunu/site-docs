// Runs every browser suite against a docs workspace, and writes the screenshots a person looks at.
//
//   bun run.ts [--root <workspace>] [--out <dir>] [--only axe,csp,drawer,fences,shots,states,switcher,edge] [--keep]
//
//   --root   a workspace to check (the folder with projects.json); it is built in place. Default: a
//            copy of fixtures/workspace in the output folder
//   --out    where the copy and the screenshots go; default: a temporary folder, removed at the end
//            unless --keep
//   --only   run only these suites (comma separated); default: all
//   --keep   keep the temporary folder and print where it is
//
// The repository must be built first (`npm run build` in the folder above): the workspace is built
// with `node ../build/cli.js check`, exactly as CI does (CI=true: every document problem fails). Then
// each suite runs on the Jx output, `<root>/.site-docs/site/dist`:
//
//   axe, csp, drawer, shots, states   the whole site; the suites that open one page open the
//                                     `example` project's documentation (DOCS_HOME)
//   switcher                          the same page: `example` has a real catalog slug, so that
//                                     "You are here" exists
//   fences                            every project: the code blocks of the Markdown against the pages
//   edge                              the `edge` project: a README that starts with a comment and a badge,
//                                     links written from the repository root, template-looking text,
//                                     folder pages, and what the workspace must keep apart
// The screenshots (every page at 1440, 768 and 390 pixels in both colour schemes, and the interactive
// states) are written to <out>/shots, to be uploaded as the artifact `verify-shots`: they are for a person to
// look at, nothing is compared. Exit codes: 0 every suite passed; 1 a suite failed; 2 usage error.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const SUITES = ["axe", "csp", "drawer", "fences", "shots", "states", "switcher", "edge"] as const;
/** The documentation the suites open when they need one page: a project with a real catalog slug. */
const DOCS_HOME = "/example/docs/";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    root: { type: "string" },
    out: { type: "string" },
    only: { type: "string" },
    keep: { type: "boolean" },
  },
});
const wanted = new Set<string>(values.only ? values.only.split(",").map((s) => s.trim()) : SUITES);
for (const name of wanted) {
  if (!(SUITES as readonly string[]).includes(name)) {
    console.error(`run: unknown suite ${name}; the suites are ${SUITES.join(", ")}`);
    process.exit(2);
  }
}
const here = import.meta.dirname;
const cli = resolve(here, "..", "build", "cli.js");
if (!existsSync(cli)) {
  console.error(`run: ${cli} does not exist; build the repository first: npm run build`);
  process.exit(2);
}
const temporary = !values.out && !values.keep;
const out = values.out ? resolve(values.out) : mkdtempSync(join(tmpdir(), "site-docs-verify-"));
mkdirSync(out, { recursive: true });
const shots = join(out, "shots");

let root: string;
if (values.root) {
  root = resolve(values.root);
  if (!existsSync(join(root, "projects.json"))) {
    console.error(`run: ${root} has no projects.json`);
    process.exit(2);
  }
} else {
  root = join(out, "workspace");
  rmSync(root, { recursive: true, force: true });
  cpSync(join(here, "fixtures", "workspace"), root, { recursive: true });
}

// a build that must not depend on how this machine is set up
const env: Record<string, string> = { ...(process.env as Record<string, string>) };
for (const name of ["DOCS_LENIENT", "GITHUB_ACTIONS", "GITHUB_STEP_SUMMARY", "GITHUB_OUTPUT"]) {
  delete env[name];
}
env.CI = "true";
env.DOCS_HOME = DOCS_HOME;

const results: Array<{ name: string; ok: boolean }> = [];
const run = (program: string, args: string[], name: string): boolean => {
  console.log(`\n=== ${name}: ${program} ${args.join(" ")}`);
  const ok = spawnSync(program, args, { cwd: here, stdio: "inherit", env }).status === 0;
  results.push({ name, ok });
  return ok;
};

// the site is built by Node, as the deployed one is (this script runs on Bun)
const built = run("node", [cli, "check", "--root", root], "build");
if (built) {
  const dist = join(root, ".site-docs", "site", "dist");
  if (wanted.has("axe")) run("bun", ["axe.ts", dist], "axe");
  if (wanted.has("csp")) run("bun", ["csp.ts", dist], "csp");
  if (wanted.has("drawer")) run("bun", ["drawer.ts", dist], "drawer");
  if (wanted.has("fences")) run("bun", ["fences.ts", root], "fences");
  if (wanted.has("shots")) run("bun", ["shots.ts", dist, join(shots, "pages")], "shots");
  if (wanted.has("states")) run("bun", ["states.ts", dist, join(shots, "states")], "states");
  if (wanted.has("switcher")) run("bun", ["switcher.ts", dist, DOCS_HOME], "switcher");
  if (wanted.has("edge")) run("bun", ["edge.ts", root], "edge");
}

console.log("\n=== results");
for (const { name, ok } of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
const failed = results.filter((r) => !r.ok);
if (temporary) rmSync(out, { recursive: true, force: true });
else console.log(`run: sandboxes and screenshots are in ${out}`);
process.exit(failed.length === 0 ? 0 : 1);
