import { describe, expect, test } from "vitest";
import { main, parseSources } from "../../src/cli.js";
import { runCli } from "../support/index.js";

describe("parseSources", () => {
  test("reads path=dir pairs, keeping an equals sign that is part of the folder", () => {
    expect(parseSources(["frappe-nix=/tmp/checkout", "odoo-nix=/a=b/c"])).toEqual({
      "frappe-nix": "/tmp/checkout",
      "odoo-nix": "/a=b/c",
    });
    expect(parseSources([])).toEqual({});
  });

  test("a pair without a path or without a folder is a usage error", () => {
    for (const bad of ["nodir", "=/x", "path="]) {
      expect(() => parseSources([bad]), bad).toThrow("--source takes <path>=<dir>");
    }
  });
});

describe("the command line", () => {
  test("--help prints the usage and exits 0; no command prints it and exits 2", async () => {
    const help = await runCli(["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("usage: docs <command> [options]");
    for (const command of ["build", "check"]) expect(help.stdout).toContain(`  ${command}`);
    const none = await runCli([]);
    expect(none.code).toBe(2);
    expect(none.stdout).toContain("usage: docs");
  });

  test("an unknown command, an unknown option and a command with extras are usage errors", async () => {
    for (const argv of [["deploy"], ["build", "extra"], ["build", "--nope"], ["lint"]]) {
      const { code, stderr } = await runCli(argv);
      expect(code, argv.join(" ")).toBe(2);
      expect(stderr, argv.join(" ")).toContain("usage: docs");
    }
  });

  test("--strict and --lenient cannot be combined, and a bad --source is refused before any work", async () => {
    expect(await runCli(["build", "--strict", "--lenient"])).toMatchObject({
      code: 2,
      stderr: "docs: --strict and --lenient cannot be used together",
    });
    const bad = await runCli(["build", "--source", "nodir"]);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("--source takes <path>=<dir>");
  });

  test("a folder that is not a workspace is a problem of the build, exit 1", async () => {
    const out: string[] = [];
    const code = await main(["build", "--root", "/nonexistent-docs-workspace"], {}, "/", {
      stdout: (line) => out.push(line),
      stderr: (line) => out.push(line),
    });
    expect(code).toBe(1);
    expect(out.join("\n")).toContain("is not a docs workspace");
  });
});
