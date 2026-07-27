import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { memo, useEffect, useRef } from "react";
import { resolveSetting, siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { BuilderRenderer } from "@/components/admin/builder/BuilderRenderer";
import { defaultDocFor } from "@/lib/builder/chromeDefaults";
import type { BuilderDocument } from "@/lib/builder/types";
import {
  FooterChromeSchema,
  defaultFooterChrome,
  type FooterChrome,
} from "@/lib/theme/footerSettings";
import { BackToTop } from "@/components/footer/BackToTop";
import { CopyrightBar } from "@/components/footer/CopyrightBar";
import { trackFooterLink, trackFooterNewsletterSubmit } from "@/lib/analytics/footerTracking";
import { FOOTER_LINKS, type FooterLinkGroup } from "@/lib/seo/footerNavigation";

type FooterSettings = {
  builder_data?: BuilderDocument | null;
  chrome?: Partial<FooterChrome>;
};

interface FooterProps {
  compact?: boolean;
}

export const Footer = memo(function Footer({ compact }: FooterProps) {
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

  const footerRef = useRef<HTMLElement | null>(null);



  useEffect(() => {
    const el = footerRef.current;
    if (!el) return;
    const onClick = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
        return;
      }
      const isExternal = /^https?:\/\//i.test(href) && !href.includes(window.location.host);
      const registry = FOOTER_LINKS.find((l) => l.href === href);
      const group: FooterLinkGroup | "unknown" = registry?.group ?? "unknown";
      const label = anchor.textContent?.trim() || href;
      trackFooterLink({ href, label, group, external: isExternal });
    };
    const onSubmit = (ev: SubmitEvent) => {
      const form = ev.target as HTMLFormElement | null;
      if (!form) return;
      const isNewsletter =
        form.matches("[data-newsletter-form]") ||
        form.querySelector("input[type='email']") != null;
      if (!isNewsletter) return;
      trackFooterNewsletterSubmit("success", { form_id: form.id || undefined });
    };
    el.addEventListener("click", onClick, { capture: true });
    el.addEventListener("submit", onSubmit, { capture: true });
    return () => {
      el.removeEventListener("click", onClick, { capture: true } as EventListenerOptions);
      el.removeEventListener("submit", onSubmit, { capture: true } as EventListenerOptions);
    };
  }, []);

  return (
    <>
      <footer
        ref={footerRef}
        data-site-footer
        data-footer-layout={chromeCfg.layout}
        // cv-auto: the footer is below the fold on load - skipping its
        // layout/paint until the reader nears it is a real first-paint win on
        // every page (the footer is a full builder document of its own).
        className="cv-auto"
        style={{ viewTransitionName: "site-footer" }}
      >
        <BuilderRenderer doc={doc} lang={isPl ? "pl" : "en"} />
        <CopyrightBar chrome={chromeCfg} lang={isPl ? "pl" : "en"} />
      </footer>
      {chromeCfg.back_to_top ? (
        <BackToTop thresholdPx={chromeCfg.back_to_top_threshold_px} />
      ) : null}
    </>
  );
});

Footer.displayName = "Footer";
