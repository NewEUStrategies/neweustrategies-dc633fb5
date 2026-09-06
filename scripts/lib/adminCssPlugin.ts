import { Scanner } from "@tailwindcss/oxide";
import { resolve } from "node:path";
import type { Plugin } from "vite";

const ADMIN_SOURCES = ["components/admin/**", "routes/admin*", "lib/admin/**"];
const TEST_SOURCES = ["**/__tests__/**", "**/*.{test,spec}.{ts,tsx}", "test/**"];

/** Emit only utilities absent from the shared stylesheet. Both surfaces use
 * Tailwind's own scanner, so adding an admin class needs no generated allowlist.
 */
export function adminCssPlugin(): Plugin {
  let root = "";
  return {
    name: "nes:admin-css",
    enforce: "pre",
    configResolved(config) {
      root = config.root;
    },
    transform: {
      order: "pre",
      handler(source, id) {
        if (id.split("?")[0] !== resolve(root, "src/admin-styles.css")) return null;
        const base = resolve(root, "src");
        const scan = (patterns: string[], excluded: string[]) =>
          new Scanner({
            sources: [
              ...patterns.map((pattern) => ({ base, pattern, negated: false })),
              ...excluded.map((pattern) => ({ base, pattern, negated: true })),
            ],
          }).scan();
        const shared = new Set(scan(["**/*"], [...ADMIN_SOURCES, ...TEST_SOURCES]));
        const admin = scan(ADMIN_SOURCES, TEST_SOURCES).filter(
          (candidate) => !shared.has(candidate),
        );
        return source.replace('"__NES_ADMIN_UTILITIES__"', JSON.stringify(admin.join(" ")));
      },
    },
    handleHotUpdate(context) {
      const css = context.server.moduleGraph.getModuleById(resolve(root, "src/admin-styles.css"));
      if (!css || !context.file.startsWith(resolve(root, "src"))) return;
      context.server.moduleGraph.invalidateModule(css);
      return [...context.modules, css];
    },
  };
}
