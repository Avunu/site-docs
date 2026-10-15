// Types for tests and editors; the script itself is plain JavaScript.
import type { Environment, Io, Runner } from "./bump-submodules.mjs";

export interface Entry {
  path: string;
  slug: string;
  name: string;
  tagline: string;
  platform: string;
  repo: string;
  license: string;
  branch: string;
  docs: string;
  local?: true;
  [key: string]: unknown;
}

export interface Registry {
  domain: string;
  name: string;
  tagline: string;
  org: string;
  projects: Entry[];
}

export const DEFAULT_HEADER: {
  domain: string;
  name: string;
  tagline: string;
  org: string;
};
export const SELF_PATH: string;
export function pathFromDomain(domain: unknown): string;
export function projectFromConfig(
  text: string,
  options: { branch: string; pathOverride?: string },
): Entry;
export function mergeRegistry(
  existing: Partial<Registry> | null,
  entries: Entry[],
  options?: { refresh?: boolean },
): Registry;
export function renderRegistry(registry: Registry): string;
export function renderGitmodules(
  existing: string | null,
  projects: { path: string; repo: string; branch: string; local?: boolean }[],
): string;
export function repoFromRemote(url: string): string | null;
export function readProject(
  fullName: string,
  run: Runner,
  options?: { pathOverride?: string },
): Entry;
export function main(argv: string[], io?: Io, env?: Environment): number;
