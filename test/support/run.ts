import { main } from "../../src/cli.js";

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs the command line in-process, as `node build/cli.js <argv>` would, and returns the exit code and
 * what was printed. The environment is empty unless given, so a developer's CI=true does not leak into
 * a test.
 */
export async function runCli(
  argv: string[],
  o: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<CliResult> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, o.env ?? {}, o.cwd ?? process.cwd(), {
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
  });
  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}
