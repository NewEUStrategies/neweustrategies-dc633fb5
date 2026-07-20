// TYMCZASOWY config pomiarowy (nie używany w deployu): bez nitro, z pełnymi
// sourcemapami klienta - .output nitro stubuje mapę chunka wejściowego, więc
// atrybucję bajtów robimy na dist/client z tego wariantu.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  nitro: false,
  vite: {
    build: { minify: false, sourcemap: true },
    environments: {
      client: {
        build: {
          minify: false,
          sourcemap: true,
          rollupOptions: {
            output: {
              hoistTransitiveImports: false,
              manualChunks(id: string) {
                if (!id.includes("/node_modules/")) return undefined;
                if (
                  /\/node_modules\/(react|react-dom|scheduler|use-sync-external-store)\//.test(id)
                ) {
                  return "vendor-react";
                }
                if (id.includes("/node_modules/@supabase/")) return "vendor-supabase";
                if (/\/node_modules\/(@radix-ui|@floating-ui)\//.test(id)) return "vendor-radix";
                if (
                  /\/node_modules\/(aria-hidden|react-remove-scroll|react-remove-scroll-bar|react-style-singleton|use-callback-ref|use-sidecar|get-nonce)\//.test(
                    id,
                  )
                ) {
                  return "vendor-radix";
                }
                if (id.includes("/node_modules/@tanstack/")) return "vendor-tanstack";
                if (
                  /\/node_modules\/(i18next|react-i18next|html-parse-stringify|void-elements)\//.test(
                    id,
                  )
                ) {
                  return "vendor-i18n";
                }
                return undefined;
              },
            },
          },
        },
      },
    },
  },
});
