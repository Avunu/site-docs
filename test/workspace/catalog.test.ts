import { describe, expect, test } from "vitest";
import type { Catalog } from "../../src/lib/types.js";
import { docsUrl, workspaceCatalog } from "../../src/workspace/catalog.js";
import type { Workspace, WorkspaceProject } from "../../src/workspace/registry.js";

const entry = (slug: string, over: Record<string, unknown> = {}) => ({
  slug,
  title: slug,
  platform: "general" as const,
  summary: `${slug} summary`,
  repo: `https://github.com/Avunu/${slug}`,
  page: `https://avunu.net/open-source/${slug}/`,
  docs: null as string | null,
  license: "MIT",
  status: "active",
  suite: null,
  ...over,
});

const base: Catalog = {
  version: 1,
  generated: "2026-01-01T00:00:00Z",
  site: "https://avunu.net",
  projects: [entry("zed"), entry("frappe-nix", { platform: "nixos", docs: "https://old/" })],
} as unknown as Catalog;

const project = (over: Partial<WorkspaceProject> = {}): WorkspaceProject => ({
  path: "frappe-nix",
  slug: "frappe-nix",
  name: "frappe-nix",
  tagline: "t",
  platform: "nixos",
  repo: "https://github.com/Avunu/frappe-nix",
  license: "MIT",
  branch: "main",
  docs: "docs",
  ...over,
});

const ws = (projects: WorkspaceProject[]): Workspace => ({
  domain: "docs.avunu.net",
  name: "Avunu documentation",
  tagline: "t",
  org: "https://github.com/Avunu",
  projects,
});

describe("workspaceCatalog", () => {
  test("the address of a project's documentation is on the workspace's domain", () => {
    expect(docsUrl({ domain: "docs.avunu.net" }, "frappe-nix")).toBe(
      "https://docs.avunu.net/frappe-nix/",
    );
  });

  test("a project of the registry gets its docs address; every other entry loses the old one", () => {
    const out = workspaceCatalog(base, ws([project()]), "2026-10-15T00:00:00Z");
    expect(out.generated).toBe("2026-10-15T00:00:00Z");
    expect(out.projects.find((p) => p.slug === "frappe-nix")?.docs).toBe(
      "https://docs.avunu.net/frappe-nix/",
    );
    expect(out.projects.find((p) => p.slug === "zed")?.docs).toBeNull();
  });

  test("a project the catalog does not know yet is added from the registry, with its own page", () => {
    const out = workspaceCatalog(
      base,
      ws([project({ path: "renamed", slug: "renamed", name: "Renamed", tagline: "New." })]),
      "g",
    );
    expect(out.projects.find((p) => p.slug === "renamed")).toEqual({
      slug: "renamed",
      title: "Renamed",
      platform: "nixos",
      summary: "New.",
      repo: "https://github.com/Avunu/frappe-nix",
      page: "https://avunu.net/open-source/renamed/",
      docs: "https://docs.avunu.net/renamed/",
      license: "MIT",
      status: "active",
      suite: null,
    });
  });

  test("the entries are sorted by slug, and the catalog it was given is not changed", () => {
    const before = structuredClone(base);
    const out = workspaceCatalog(base, ws([project({ path: "a", slug: "a" })]), "g");
    expect(out.projects.map((p) => p.slug)).toEqual(["a", "frappe-nix", "zed"]);
    expect(base).toEqual(before);
  });
});
