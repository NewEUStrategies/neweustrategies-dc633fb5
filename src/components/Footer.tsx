import { useTranslation } from "react-i18next";
import { useSiteSetting } from "@/lib/useSiteSetting";
import { BuilderRenderer } from "@/components/admin/builder/BuilderRenderer";
import type { BuilderDocument } from "@/lib/builder/types";

type FooterSettings = {
  builder_data?: BuilderDocument | null;
};

export function Footer() {
  const { i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");

  const cfg = useSiteSetting<FooterSettings>("footer", {});

  if (!cfg.builder_data || !cfg.builder_data.sections?.length) return null;

  return (
    <footer>
      <BuilderRenderer doc={cfg.builder_data} lang={isPl ? "pl" : "en"} />
    </footer>
  );
}
