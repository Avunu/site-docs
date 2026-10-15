#!/usr/bin/env node
// The command line of the docs workspace: `build` and `check`, run from the folder that holds
// projects.json (or with --root).
//
//   node build/cli.js build [--only <path>]... [--source <path>=<dir>]... [--lenient|--strict]
//   node build/cli.js check [--only <path>]... [--source <path>=<dir>]... [--ci]
//
// Exit codes: 0 done, 1 a problem was found (the build did not publish), 2 a usage error, 70 a crash.
// The code is set on the process rather than passed to process.exit, so that what the command printed
// to a pipe is flushed first.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildWorkspace, type WorkspaceOptions } from "./workspace/build.js";
import { checkWorkspace } from "./workspace/check.js";

const USAGE = `usage: docs <command> [options]

commands:
  build   Build every project's documentation into ./dist
  check   What CI runs: a strict build, the contrast gate and a link crawl

options:
  --root <dir>             The workspace (the folder with projects.json). Default: the current folder.
  --only <path>            Build only this project (repeatable). The site is partial: for a quick look.
  --source <path>=<dir>    Use <dir> as the repository of that project instead of projects/<path>
                           (a project's own pull request is checked against its own checkout).
  --strict | --lenient     Fail on any document problem (implied by CI=true) / report them as warnings.
  --ci                     GitHub Actions annotations, summary and step outputs (implied by GITHUB_ACTIONS=true).
`;

/** `path=dir` pairs into a record; throws on a malformed pair. */
export function parseSources(values: readonly string[]): Record<string, string> {
  const sources: Record<string, string> = {};
  for (const value of values) {
    const at = value.indexOf("=");
    if (at <= 0 || at === value.length - 1) {
      throw new Error(`--source takes <path>=<dir> (got ${JSON.stringify(value)})`);
    }
    sources[value.slice(0, at)] = value.slice(at + 1);
  }
  return sources;
}

/** Where the command line prints; the tests give their own. */
export interface Output {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

const processOutput: Output = {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
};

export async function main(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
  io: Output = processOutput,
): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        root: { type: "string" },
        only: { type: "string", multiple: true },
        source: { type: "string", multiple: true },
        strict: { type: "boolean" },
        lenient: { type: "boolean" },
        ci: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    io.stderr(`docs: ${(error as Error).message}\n${USAGE.trimEnd()}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help === true || positionals.length === 0) {
    io.stdout(USAGE.trimEnd());
    return values.help === true ? 0 : 2;
  }
  const command = positionals[0];
  if (positionals.length > 1 || (command !== "build" && command !== "check")) {
    io.stderr(`docs: unknown command ${JSON.stringify(positionals.join(" "))}\n${USAGE.trimEnd()}`);
    return 2;
  }
  if (values.strict === true && values.lenient === true) {
    io.stderr("docs: --strict and --lenient cannot be used together");
    return 2;
  }
  let sources: Record<string, string>;
  try {
    sources = parseSources((values.source as string[] | undefined) ?? []);
  } catch (error) {
    io.stderr(`docs: ${(error as Error).message}`);
    return 2;
  }
  const options: WorkspaceOptions = {
    root: resolve(cwd, (values.root as string | undefined) ?? "."),
    env,
    sources,
    ci: values.ci === true || env.GITHUB_ACTIONS === "true",
    log: io.stdout,
    error: io.stderr,
    ...(values.only === undefined ? {} : { only: values.only as string[] }),
    ...(values.strict === true ? { strict: true } : {}),
    ...(values.lenient === true ? { lenient: true } : {}),
  };
  const ok =
    command === "build" ? (await buildWorkspace(options)).ok : (await checkWorkspace(options)).ok;
  return ok ? 0 : 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // A reader that went away (`docs build | head -1`) is not an error of ours: drop what it no longer
  // wants and keep the exit code the command earned. Any other stream error is still fatal.
  for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") throw error;
    });
  }
  main(process.argv.slice(2), process.env, process.cwd()).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`docs: ${(error as Error).stack ?? String(error)}\n`);
      process.exitCode = 70;
    },
  );
}
