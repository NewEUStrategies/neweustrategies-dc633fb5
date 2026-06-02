import { useTranslation } from "react-i18next";
import { useSiteSetting } from "@/lib/useSiteSetting";
import { BuilderRenderer } from "@/components/admin/builder/BuilderRenderer";
import { defaultDocFor } from "@/lib/builder/chromeDefaults";
import type { BuilderDocument } from "@/lib/builder/types";

type FooterSettings = {
  builder_data?: BuilderDocument | null;
};

export function Footer() {
  const { i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");

  const cfg = useSiteSetting<FooterSettings>("footer", {});

  // Fall back to default chrome when no footer has been saved yet, so the
  // site always renders a usable footer instead of disappearing silently.
  const doc =
    cfg.builder_data && cfg.builder_data.sections?.length
      ? cfg.builder_data
      : defaultDocFor("footer");

  if (!doc.sections?.length) return null;

  return (
    <footer className="builder-footer-public">
      <style
        dangerouslySetInnerHTML={{
          __html: `
            .builder-footer-public { color: var(--foreground); }
            .builder-footer-public a:not(.btn):not([class*="button"]) { color: inherit; text-decoration: none; }
            .builder-footer-public a:not(.btn):not([class*="button"]):hover { color: inherit; opacity: 0.8; }
            .builder-footer-public :is(h1, h2, h3, h4, h5, h6, p, li, small) { color: inherit; }
          `,
        }}
      />
      <BuilderRenderer doc={doc} lang={isPl ? "pl" : "en"} />
    </footer>
  );
}
