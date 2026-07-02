// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Vendor code-splitting: pull heavy third-party libraries out of the single
// entry chunk into cacheable per-library chunks. This shrinks the largest chunk,
// lets the browser fetch vendors in parallel, and keeps long-lived vendor code
// cached across app deploys. App/route code keeps the router plugin's per-route
// splitting (we only assign node_modules here).
function manualChunks(id: string): string | undefined {
  if (!id.includes("node_modules")) return undefined;
  if (/node_modules\/(react-dom|react|scheduler)\//.test(id)) return "vendor-react";
  if (id.includes("node_modules/@tanstack/")) return "vendor-tanstack";
  if (id.includes("node_modules/@radix-ui/")) return "vendor-radix";
  if (id.includes("node_modules/@supabase/")) return "vendor-supabase";
  if (/node_modules\/(recharts|d3-|victory|internmap)/.test(id)) return "vendor-charts";
  if (/node_modules\/(@tiptap|prosemirror)/.test(id)) return "vendor-editor";
  // Admin-builder-only drag & drop - must never be dragged into first paint.
  if (id.includes("node_modules/@dnd-kit/")) return "vendor-dnd";
  // Forms (auth/contact/newsletter) are lazy widgets - keep their deps lazy too.
  if (/node_modules\/(react-hook-form|@hookform)/.test(id)) return "vendor-forms";
  if (id.includes("node_modules/react-markdown") || id.includes("node_modules/remark") || id.includes("node_modules/micromark") || id.includes("node_modules/mdast") || id.includes("node_modules/unist") || id.includes("node_modules/hast")) return "vendor-markdown";
  if (/node_modules\/(@fortawesome)/.test(id)) return "vendor-fontawesome";
  if (id.includes("node_modules/lucide-react")) return "vendor-icons";
  if (/node_modules\/(isomorphic-)?dompurify/.test(id)) return "vendor-dompurify";
  if (id.includes("node_modules/date-fns")) return "vendor-datefns";
  if (/node_modules\/(embla-carousel|yet-another-react-lightbox|react-day-picker|cmdk|vaul|sonner)/.test(id)) {
    return "vendor-ui";
  }
  if (/node_modules\/(i18next|react-i18next)/.test(id)) return "vendor-i18n";
  return "vendor";
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    // These are only reached through TanStack Start's dev-time SSR/client
    // bridge, so Vite's initial crawl misses them and discovers them during the
    // FIRST page load - "new dependencies optimized: ... reloading" then forces
    // a full page reload mid-session (the page visibly loads twice after every
    // dev-server restart). Pre-bundling them up front removes that reload.
    // (Deliberately NOT @tanstack/react-start itself - see the wrapper's note:
    // its node:async_hooks server entry must stay out of the client bundle.)
    optimizeDeps: {
      include: [
        "@tanstack/history",
        "@tanstack/router-core",
        "@tanstack/router-core/ssr/client",
        "@tanstack/router-core/ssr/server",
        "h3-v2",
        "seroval",
      ],
    },
    build: {
      rollupOptions: {
        output: { manualChunks },
      },
    },
  },
});
