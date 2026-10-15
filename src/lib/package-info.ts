// What this repository knows about itself: its own folder (the one with package.json, site/ and dist/,
// two levels above both src/lib/ and dist/lib/) and the version in its package.json.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const packageRoot: string = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface PackageJson {
  name: string;
  version: string;
}

const info = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as PackageJson;

export const name: string = info.name;
export const version: string = info.version;
