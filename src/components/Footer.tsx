import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { resolveSetting, siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { BuilderRenderer } from "@/components/admin/builder/BuilderRenderer";
import { defaultDocFor } from "@/lib/builder/chromeDefaults";
import type { BuilderDocument } from "@/lib/builder/types";
import { FooterChromeSchema, defaultFooterChrome, type FooterChrome } from "@/lib/theme/footerSettings";
import { BackToTop } from "@/components/footer/BackToTop";
import { CopyrightBar } from "@/components/footer/CopyrightBar";

type FooterSettings = {
  builder_data?: BuilderDocument | null;
  chrome?: Partial<FooterChrome>;
};

export function Footer() {
  const { i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");

  const { data: settingsMap, isLoading } = useQuery(siteSettingsQueryOptions);
  const cfg = resolveSetting<FooterSettings>(settingsMap, "footer", {});

  const doc =
    cfg.builder_data && cfg.builder_data.sections?.length
      ? cfg.builder_data
      : isLoading
        ? null
        : defaultDocFor("footer");

  const chrome = FooterChromeSchema.safeParse({ ...defaultFooterChrome(), ...(cfg.chrome ?? {}) });
  const chromeCfg = chrome.success ? chrome.data : defaultFooterChrome();

  if (!doc?.sections?.length) {
    return chromeCfg.back_to_top ? <BackToTop thresholdPx={chromeCfg.back_to_top_threshold_px} /> : null;
  }

  return (
    <>
      <footer data-site-footer data-footer-layout={chromeCfg.layout} style={{ viewTransitionName: "site-footer" }}>
        <BuilderRenderer doc={doc} lang={isPl ? "pl" : "en"} />
        <CopyrightBar chrome={chromeCfg} lang={isPl ? "pl" : "en"} />
      </footer>
      {chromeCfg.back_to_top ? <BackToTop thresholdPx={chromeCfg.back_to_top_threshold_px} /> : null}
    </>
  );
}
