import { useTranslation } from "react-i18next";
import { useSiteSetting } from "@/lib/useSiteSetting";
import { BuilderRenderer } from "@/components/admin/builder/BuilderRenderer";
import type { BuilderDocument } from "@/lib/builder/types";
import { AlertBar } from "@/components/AlertBar";
import { AdZone } from "@/components/AdSlot";

type HeaderSettings = {
  builder_data?: BuilderDocument | null;
};

export function Header() {
  const { i18n } = useTranslation();
  const lang = i18n.language ?? "pl";

  const cfg = useSiteSetting<HeaderSettings>("header", {});

  if (!cfg.builder_data || !cfg.builder_data.sections?.length) return null;

  return (
    <header className="bg-background border-b border-border">
      <AlertBar />
      <AdZone position="header_banner" pageType="all" className="py-2 text-center" />
      <BuilderRenderer doc={cfg.builder_data} lang={lang.startsWith("pl") ? "pl" : "en"} />
    </header>
  );
}
