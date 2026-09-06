import { rmSync } from "node:fs";
import { resolve } from "node:path";

// Both adapters use these generated directories. A second build must not
// publish old hashed chunks or count two versions of the boot graph/CSS.
const root = resolve(import.meta.dirname, "..");
for (const path of [".output", ".nitro", "node_modules/.nitro"]) {
  rmSync(resolve(root, path), { recursive: true, force: true });
}
