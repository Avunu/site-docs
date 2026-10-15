// Types for tests and editors; the script itself is plain JavaScript.
export interface Project {
  path: string;
  repo: string;
  owner: string;
  name: string;
  cloneUrl: string;
  branch: string;
  local: boolean;
}

export interface Refs {
  heads: Map<string, string>;
  tags: Map<string, string>;
}

export type Release = { kind: "release"; tag: string } | { kind: "none" };

export interface Target {
  to: string;
  toTag: string | null;
  reason: "release" | "branch";
}

export interface Changed {
  path: string;
  repo: string;
  from: string;
  to: string;
  fromTag: string | null;
  toTag: string | null;
  reason: "release" | "branch";
}

export interface Skipped {
  path: string;
  repo: string;
  error: string;
}

export interface Report {
  changed: Changed[];
  skipped: Skipped[];
  unchanged: string[];
}

export interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}
export type Runner = (command: string, args: string[], options?: { cwd?: string }) => RunResult;

export interface Environment {
  run?: Runner;
  exists?: (path: string) => boolean;
  cwd?: string;
}

export interface Io {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export const PATH_SEGMENT: RegExp;
export function parseRegistry(text: string): Project[];
export function parseGitlink(lsTree: string): string | null;
export function parseLsRemote(text: string): Refs;
export function parseLatestRelease(text: string): { tag: string };
export function classifyRelease(result: RunResult): Release | { kind: "error"; message: string };
export function chooseTarget(input: { release: Release; refs: Refs; branch: string }): Target;
export function tagForSha(tags: Map<string, string>, sha: string): string | null;
export function clean(message: unknown): string;
export function compareUrl(repo: string, from: string, to: string): string;
export function renderSummary(report: Report): string;
export function systemRunner(
  command: string,
  args: string[],
  options?: { cwd?: string },
): RunResult;
export function lookupProject(project: Project, run: Runner): Target & { refs: Refs };
export function bump(
  input: { projects: Project[]; only?: string; dryRun?: boolean },
  environment: {
    run: Runner;
    exists: (path: string) => boolean;
    cwd: string;
    warn?: (message: string) => void;
  },
): Report;
export function main(argv: string[], io?: Io, env?: Environment): number;
