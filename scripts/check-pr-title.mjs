#!/usr/bin/env node
// A pull request is squash-merged, so its title becomes the commit message: it must be a Conventional
// Commit (`type(scope)!: subject`), so that the history reads the same everywhere and the type says what
// kind of change it was.
//
//   PR_TITLE='feat: add search' node scripts/check-pr-title.mjs
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The Conventional Commit types. */
export const TYPES = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
];
const SUBJECT = new RegExp(`^(?:${TYPES.join("|")})(?:\\([a-z0-9._/-]+\\))?!?: \\S.*$`);

/** Problems with a pull request title, one sentence each. */
export function problemsWith(title) {
  return SUBJECT.test(title)
    ? []
    : [
        `the title "${title}" is not a Conventional Commit (type(scope)!: subject, type one of ${TYPES.join(", ")})`,
      ];
}

// `import.meta.main` exists only on Node 24.2+; this must also run (and not silently pass) on 22.
if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const problems = problemsWith(process.env.PR_TITLE ?? "");
  for (const problem of problems) console.error(`::error title=Pull request title::${problem}`);
  process.exit(problems.length > 0 ? 1 : 0);
}
