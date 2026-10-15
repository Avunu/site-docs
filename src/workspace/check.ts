// `check` of the workspace: what CI runs. A strict build, then the contrast gate on the
// design tokens the site resolved to, then a crawl of every link, anchor, asset, search result and
// sidebar entry of the published site, then (with `ci`) the job summary and the step outputs.
//
// The contrast gate needs only the root the build assembled, so it runs after a failed build too (a red
// run then shows both problems at once); the crawl needs the published site, so it runs only after a
// passing build.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  annotation,
  appendStepOutputs,
  appendStepSummary,
  renderSummary,
  versionsOf,
  type SummaryStep,
} from "../lib/ci.js";
import { contrastFailures, highlightOf } from "../lib/contrast.js";
import { checkLinks, formatIssues } from "../lib/links.js";
import type { Problem } from "../lib/types.js";
import { buildWorkspace, type WorkspaceOptions } from "./build.js";
import { docsPrefix } from "./registry.js";

/** `style` of the root's project.json, and the search highlight of its docs-search component. */
function readTokens(root: string): {
  style: Record<string, unknown>;
  highlight: ReturnType<typeof highlightOf>;
} {
  const project = JSON.parse(readFileSync(join(root, "project.json"), "utf8")) as {
    style?: Record<string, unknown>;
  };
  if (project.style === undefined || typeof project.style !== "object") {
    throw new Error("project.json has no style object");
  }
  let rule: Record<string, unknown> | undefined;
  try {
    const search = JSON.parse(
      readFileSync(join(root, "components", "docs-search.json"), "utf8"),
    ) as {
      style?: Record<string, Record<string, unknown>>;
    };
    rule = search.style?.["& .hl"];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { style: project.style, highlight: highlightOf(rule) };
}

export interface CheckResult {
  ok: boolean;
  pages: number;
  dist?: string;
}

export async function checkWorkspace(o: WorkspaceOptions): Promise<CheckResult> {
  const log = o.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const error = o.error ?? log;
  const ci = o.ci === true;
  const env = { ...o.env };
  delete env.DOCS_LENIENT;

  const build = await buildWorkspace({ ...o, env, strict: true, lenient: false });
  const problems: Problem[] = [...build.problems];
  const steps: SummaryStep[] = [
    {
      name: "Build",
      ok: build.ok,
      detail: build.ok
        ? `${build.pages} page(s) of ${build.projects.length} project(s) written`
        : `${build.problems.filter((p) => p.level === "error").length} error(s), nothing was published`,
    },
  ];
  let failed = !build.ok;

  if (build.jxRoot !== undefined) {
    let tokens: ReturnType<typeof readTokens> | undefined;
    try {
      tokens = readTokens(build.jxRoot);
    } catch (caught) {
      const message = `cannot read the resolved design tokens: ${(caught as Error).message}`;
      error(`contrast: error: ${message}`);
      if (ci) log(annotation("error", message, undefined, undefined, "contrast"));
      problems.push({ level: "error", message: `contrast: ${message}` });
      steps.push({ name: "Contrast", ok: false, detail: message });
      failed = true;
    }
    if (tokens !== undefined) {
      const contrast = contrastFailures(tokens.style, tokens.highlight);
      log(
        `contrast: ${contrast.checked} color pair(s) checked, ${contrast.failures.length} below the minimum`,
      );
      for (const failure of contrast.failures) {
        const message = `${failure.theme}: ${failure.label} is ${failure.ratio}:1, needs ${failure.minimum}:1`;
        error(`contrast: error: ${message}`);
        if (ci) log(annotation("error", message, undefined, undefined, "contrast"));
        problems.push({ level: "error", message: `contrast: ${message}` });
      }
      steps.push({
        name: "Contrast",
        ok: contrast.failures.length === 0,
        detail: `${contrast.checked} color pair(s), ${contrast.failures.length} below the minimum`,
      });
      if (contrast.failures.length > 0) failed = true;
    }
  }

  if (build.ok && build.dist !== undefined) {
    const report = checkLinks(build.dist, {
      ...(build.nav === undefined ? {} : { nav: build.nav }),
      docsPrefixes: build.projects.map((project) => `${docsPrefix(project)}/`),
    });
    log(`links: ${report.pages} page(s), ${report.checked} reference(s) checked`);
    for (const line of formatIssues(report.warnings).split("\n").filter(Boolean)) {
      error(`links: warning: ${line}`);
    }
    for (const line of formatIssues(report.errors).split("\n").filter(Boolean)) {
      error(`links: error: ${line}`);
    }
    for (const issue of report.errors) {
      const message = `${issue.page}  ${issue.message}`;
      if (ci) log(annotation("error", message, undefined, undefined, "links"));
      problems.push({ level: "error", message: `links: ${message}` });
    }
    for (const issue of report.warnings) {
      problems.push({ level: "warning", message: `links: ${issue.page}  ${issue.message}` });
    }
    steps.push({
      name: "Links",
      ok: report.errors.length === 0,
      detail: `${report.pages} page(s), ${report.checked} reference(s), ${report.errors.length} error(s), ${report.warnings.length} warning(s)`,
    });
    if (report.errors.length > 0) failed = true;
  }

  if (ci) {
    appendStepSummary(
      env,
      renderSummary({
        passed: !failed,
        domain: build.workspace?.domain,
        steps,
        versions: versionsOf(),
        problems,
      }),
    );
    if (!failed && build.dist !== undefined) {
      appendStepOutputs(env, { dist: build.dist, pages: String(build.pages) });
    }
  }
  log(failed ? "check: FAILED" : "check: all steps passed");
  return {
    ok: !failed,
    pages: build.pages,
    ...(build.dist === undefined ? {} : { dist: build.dist }),
  };
}
