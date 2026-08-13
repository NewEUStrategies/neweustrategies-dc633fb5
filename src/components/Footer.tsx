import { useQuery } from "@tanstack/react-query";
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
import { useLang } from "@/lib/i18n/useLang";

type FooterSettings = {
  builder_data?: BuilderDocument | null;
  chrome?: Partial<FooterChrome>;
};

interface FooterProps {
  compact?: boolean;
}

export const Footer = memo(function Footer({ compact }: FooterProps) {
  // URL-seeded language: SSR-safe first render + synchronous re-render on
  // language switch, without the i18n.language hydration-flicker window.
  const lang = useLang();

  const { data: settingsMap, isLoading } = useQuery(siteSettingsQueryOptions);
  const cfg = resolveSetting<FooterSettings>(settingsMap, "footer", {});

  // While settings are loading (should be rare - __root prefetches them via
  // ensureQueryData), render the built-in default footer instead of a blank
  // gap. This keeps SSR HTML stable and avoids a "no footer -> real footer"
  // layout shift after hydration.
  const doc =
    cfg.builder_data && cfg.builder_data.sections?.length
      ? cfg.builder_data
      : isLoading
        ? defaultDocFor("footer")
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
        form.matches("[data-newsletter-form]") || form.querySelector("input[type='email']") != null;
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

  if (compact) {
    return (
      <footer className="shrink-0 border-t border-border bg-card">
        <CopyrightBar chrome={chromeCfg} lang={lang} />
      </footer>
    );
  }

  if (!doc?.sections?.length) {
    return chromeCfg.back_to_top ? (
      <BackToTop thresholdPx={chromeCfg.back_to_top_threshold_px} />
    ) : null;
  }

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
        <BuilderRenderer doc={doc} lang={lang} />
        <CopyrightBar chrome={chromeCfg} lang={lang} />
      </footer>
      {chromeCfg.back_to_top ? (
        <BackToTop thresholdPx={chromeCfg.back_to_top_threshold_px} />
      ) : null}
    </>
  );
});

Footer.displayName = "Footer";
