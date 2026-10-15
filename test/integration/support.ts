// Helpers for the integration tests: a temporary workspace made from a fixture tree (projects.json and
// the Markdown of its projects), built by the real command line with the real pinned Jx.
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll } from "vitest";
import { fixture, git, tempDir } from "../support/index.js";

export interface Workspace {
  /** The workspace root (a fresh `git init`): the folder with projects.json. */
  dir: string;
  /** The Markdown folder of the project `demo`. */
  docsDir: string;
  /** The assembled Jx project root: where Jx runs. */
  root: string;
  /** What a passing build publishes. */
  dist: string;
}

/**
 * A temporary git repository holding a copy of `test/fixtures/workspace/<fixtureDir>` (a projects.json
 * and `projects/demo/docs/`). `files` are written on top of it (`projects/demo/docs/x.md`: text), so that
 * a test can break a clean tree. The folder is removed after the test; with `shared` it lives until the
 * end of the file, for tests that read one build.
 */
export function workspaceFrom(
  fixtureDir: string,
  files: Record<string, string> = {},
  o: { shared?: boolean } = {},
): Workspace {
  let dir: string;
  if (o.shared === true) {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "docs-it-")));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));
  } else {
    dir = tempDir("docs-it-");
  }
  cpSync(fixture("workspace", fixtureDir), dir, { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    const file = join(dir, ...path.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  git(dir, "init", "--initial-branch", "main");
  return {
    dir,
    docsDir: join(dir, "projects", "demo", "docs"),
    root: join(dir, ".site-docs", "site"),
    dist: join(dir, "dist"),
  };
}

/** The environment of a real Jx run: this process's own (the native image library may need its library path), CI off. */
export function jxEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CI;
  delete env.DOCS_LENIENT;
  delete env.GITHUB_ACTIONS;
  return { ...env, ...extra };
}
