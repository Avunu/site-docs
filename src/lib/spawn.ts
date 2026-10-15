// Runs a child process and collects what it prints: the build runs the pinned Jx this way.
import { spawn } from "node:child_process";

/** What a run of a command left: its exit code and everything it printed, in order. */
export interface CommandRun {
  code: number;
  output: string;
}

export interface SpawnOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Gets each line as it is printed, with the stream it came on. */
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
}

/**
 * Runs a command and collects what it prints. Standard output and standard error are merged in the
 * order the chunks arrive, so the log reads as the terminal would have; standard input is closed, so a
 * prompt cannot hang a build. Rejects only when the process cannot be started.
 */
export function spawnCommand(command: string[], o: SpawnOptions): Promise<CommandRun> {
  return new Promise((resolve, reject) => {
    const [program, ...args] = command;
    if (program === undefined) {
      reject(new Error("no command to run"));
      return;
    }
    const child = spawn(program, args, {
      cwd: o.cwd,
      env: o.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: string[] = [];
    const partial = { stdout: "", stderr: "" };
    const feed = (stream: "stdout" | "stderr", data: string): void => {
      chunks.push(data);
      if (o.onLine === undefined) return;
      partial[stream] += data;
      for (let end = partial[stream].indexOf("\n"); end >= 0; end = partial[stream].indexOf("\n")) {
        o.onLine(partial[stream].slice(0, end).replace(/\r$/, ""), stream);
        partial[stream] = partial[stream].slice(end + 1);
      }
    };
    child.stdout.setEncoding("utf8").on("data", (data: string) => feed("stdout", data));
    child.stderr.setEncoding("utf8").on("data", (data: string) => feed("stderr", data));
    child.once("error", reject);
    child.once("close", (code) => {
      for (const stream of ["stdout", "stderr"] as const) {
        if (partial[stream] !== "") o.onLine?.(partial[stream], stream);
      }
      resolve({ code: code ?? 1, output: chunks.join("") });
    });
  });
}
