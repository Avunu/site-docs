// Running the real, pinned Jx on an assembled root, and reading what came out. The root itself is
// made by workspace.ts, with the real workspace build.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../../support/index.js";
import { JX_PACKAGES, type Json } from "./site.js";

/** The directory of an installed Jx package, from this repository's own `node_modules`. */
export function jxPackage(name: string): string {
  const dir = realpathSync(join(REPO_ROOT, "node_modules", ...name.split("/")));
  const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name: string };
  if (manifest.name !== name) throw new Error(`${dir} is ${manifest.name}, not ${name}`);
  return dir;
}

/** The compiler's CLI script, run with `process.execPath` as the package does. */
export const jxCli = (): string => join(jxPackage("@jxsuite/compiler"), "bin", "jx.js");

/** The versions of the Jx packages this repository has installed. */
export function jxVersions(): Record<string, string> {
  return Object.fromEntries(
    JX_PACKAGES.map((name) => [
      name,
      (JSON.parse(readFileSync(join(jxPackage(name), "package.json"), "utf8")) as Json).version,
    ]),
  );
}

export interface JxRun {
  status: number | null;
  /** Standard output and standard error, in that order. */
  output: string;
  /** The `N` of `Done: N routes`, or null. */
  routes: number | null;
}

/** Runs the pinned Jx on a root: `process.execPath <compiler>/bin/jx.js build <root>`, cwd the root. */
export function runJx(root: string): JxRun {
  const result = spawnSync(process.execPath, [jxCli(), "build", root], {
    cwd: root,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: root, CI: "true", NO_COLOR: "1" },
    timeout: 50_000,
  });
  const output = `${result.stdout}${result.stderr}`;
  const done = /^Done:\s+(\d+)\s+routes?/m.exec(output);
  return { status: result.status, output, routes: done ? Number(done[1]) : null };
}

/** The output of a Jx run, `<root>/dist`. */
export const distOf = (root: string): string => join(root, "dist");

/** Every file under a folder, `/`-separated and sorted (dot files included). */
export function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const visit = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) visit(join(current, entry.name), `${prefix}${entry.name}/`);
      else out.push(`${prefix}${entry.name}`);
    }
  };
  if (existsSync(dir)) visit(dir, "");
  return out.sort();
}

/** The text of a file of a built site. */
export const readDist = (root: string, rel: string): string =>
  readFileSync(join(distOf(root), ...rel.split("/")), "utf8");
