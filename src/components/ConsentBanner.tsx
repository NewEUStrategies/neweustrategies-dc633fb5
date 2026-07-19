// Cookie banner with unified typography, PL/EN switcher and admin-controlled
// copy + color overrides. Reads runtime config from site_settings via
// useCookieBannerConfig(). Consent state persists in localStorage + cookie and
// (when signed-in) syncs to profiles.prefs.consent - refresh is automatic
// because useConsent() re-reads on the consent-change event.
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Cookie,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Check,
  X,
  Settings2,
  Languages,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useConsent, OPEN_PREFS_EVENT, type ConsentCategory } from "@/lib/ads/consent";
import { useFocusTrap } from "@/lib/a11y/useFocusTrap";
import { setConsentOverlayVisible, setMarketingConsent } from "@/lib/overlayCoordinator";
import { useSiteSetting } from "@/lib/useSiteSetting";
import { localizedPath } from "@/lib/i18n/localePath";
import {
  useCookieBannerConfig,
  bannerStyleVars,
  type CookieBannerCopy,
} from "@/lib/cookieBanner/config";
import { cn } from "@/lib/utils";

type Cats = Record<ConsentCategory, boolean>;

// Admin-controlled privacy settings (site_settings["privacy"]). Stable module-
// level default so useSiteSetting memoization holds.
type PrivacyConfig = { privacy_page_slug: string; cookie_banner: boolean };
const PRIVACY_DEFAULTS: PrivacyConfig = { privacy_page_slug: "", cookie_banner: true };

type Vendor = {
  name: string;
  party_pl: string;
  party_en: string;
  purpose_pl: string;
  purpose_en: string;
  ttl_pl: string;
  ttl_en: string;
};

const VENDORS: Record<ConsentCategory, Vendor[]> = {
  necessary: [
    {
      name: "sb-access-token / sb-refresh-token",
      party_pl: "Lovable Cloud (backend)",
      party_en: "Lovable Cloud (backend)",
      purpose_pl: "Token sesji uwierzytelniającej użytkownika",
      purpose_en: "User authentication session token",
      ttl_pl: "1 h / 7 dni",
      ttl_en: "1 h / 7 days",
    },
    {
      name: "PKCE code verifier",
      party_pl: "Backend Auth",
      party_en: "Backend Auth",
      purpose_pl: "Zabezpieczenie przepływu autoryzacji OAuth (PKCE)",
      purpose_en: "Securing the OAuth authorization flow (PKCE)",
      ttl_pl: "Sesja",
      ttl_en: "Session",
    },
    {
      name: "consent:v2",
      party_pl: "Platforma (1st party)",
      party_en: "Platform (1st party)",
      purpose_pl: "Zapis decyzji o zgodzie na pliki cookie",
      purpose_en: "Storage of the cookie consent decision",
      ttl_pl: "365 dni",
      ttl_en: "365 days",
    },
    {
      name: "lovable_lang",
      party_pl: "Platforma (1st party)",
      party_en: "Platform (1st party)",
      purpose_pl: "Preferencja języka interfejsu (PL/EN)",
      purpose_en: "UI language preference (PL/EN)",
      ttl_pl: "365 dni",
      ttl_en: "365 days",
    },
  ],
  functional: [
    {
      name: "theme",
      party_pl: "Platforma (1st party)",
      party_en: "Platform (1st party)",
      purpose_pl: "Wybrany motyw (jasny/ciemny/systemowy)",
      purpose_en: "Selected theme (light/dark/system)",
      ttl_pl: "Bez limitu",
      ttl_en: "Persistent",
    },
    {
      name: "layout:*",
      party_pl: "Platforma (1st party)",
      party_en: "Platform (1st party)",
      purpose_pl: "Preferencje układu list, gęstości widoku",
      purpose_en: "List layout and view density preferences",
      ttl_pl: "Bez limitu",
      ttl_en: "Persistent",
    },
    {
      name: "reading:prefs",
      party_pl: "Platforma (1st party)",
      party_en: "Platform (1st party)",
      purpose_pl: "Rozmiar tekstu, TTS, tryb czytania",
      purpose_en: "Text size, TTS, reading mode",
      ttl_pl: "Bez limitu",
      ttl_en: "Persistent",
    },
  ],
  analytics: [
    {
      name: "web-vitals",
      party_pl: "Platforma (1st party)",
      party_en: "Platform (1st party)",
      purpose_pl: "Pomiar wydajności strony (LCP, CLS, INP)",
      purpose_en: "Page performance metrics (LCP, CLS, INP)",
      ttl_pl: "Sesja",
      ttl_en: "Session",
    },
    {
      name: "session_id",
      party_pl: "Platforma (1st party)",
      party_en: "Platform (1st party)",
      purpose_pl: "Zliczanie unikalnych sesji (zagregowane)",
      purpose_en: "Aggregated unique-session counting",
      ttl_pl: "30 min",
      ttl_en: "30 min",
    },
  ],
  marketing: [
    {
      name: "nl_click / nl_open",
      party_pl: "Platforma (1st party)",
      party_en: "Platform (1st party)",
      purpose_pl: "Pomiar otwarć i kliknięć newslettera",
      purpose_en: "Newsletter opens and click-through measurement",
      ttl_pl: "365 dni",
      ttl_en: "365 days",
    },
    {
      name: "ad_event",
      party_pl: "Platforma (1st party)",
      party_en: "Platform (1st party)",
      purpose_pl: "Pomiar odsłon i kliknięć reklam własnych",
      purpose_en: "Own-ad impression and click measurement",
      ttl_pl: "180 dni",
      ttl_en: "180 days",
    },
  ],
};

const CATEGORY_ORDER: ConsentCategory[] = ["necessary", "functional", "analytics", "marketing"];

// Design tokens for the banner — one shared scale for compact and expanded
// view, desktop and mobile. Change here to change everywhere.
const TX = {
  body: "text-[12px] leading-[1.5]",
  meta: "text-[11px] leading-[1.4]",
  heading: "text-[14px] font-semibold leading-snug",
  title: "text-[15px] sm:text-[16px] font-semibold leading-snug",
} as const;

const BTN_BASE =
  "inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-md text-[12px] font-medium transition-colors whitespace-nowrap border";

// Uses --cb-* CSS vars when set; otherwise falls back to theme tokens.
const BTN_PRIMARY = cn(
  BTN_BASE,
  "border-transparent",
  "bg-[color:var(--cb-accent,var(--primary))] text-[color:var(--cb-accent-fg,var(--primary-foreground))]",
  "hover:bg-[color:var(--cb-accent,var(--primary))]/90",
);
const BTN_OUTLINE = cn(
  BTN_BASE,
  "border-[color:var(--cb-border,var(--border))] text-[color:var(--cb-fg,var(--foreground))]",
  "bg-transparent hover:bg-[color:var(--cb-accent,var(--primary))]/15 hover:border-[color:var(--cb-accent,var(--primary))]/40",
);
const BTN_GHOST = cn(
  BTN_BASE,
  "border-transparent text-[color:var(--cb-fg,var(--foreground))]",
  "bg-transparent hover:bg-[color:var(--cb-accent,var(--primary))]/12",
);

export function ConsentBanner() {
  const { i18n, t: tr } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
  const privacy = useSiteSetting<PrivacyConfig>("privacy", PRIVACY_DEFAULTS);
  const banner = useCookieBannerConfig();
  const t: CookieBannerCopy = isPl ? banner.copy.pl : banner.copy.en;

  const privacyHref = privacy.privacy_page_slug
    ? localizedPath(`/${privacy.privacy_page_slug.replace(/^\/+/, "")}`, isPl ? "pl" : "en")
    : null;
  const dataProcessingHref = localizedPath("/privacy", isPl ? "pl" : "en");

  const { state, decided, mounted, save, acceptAll, rejectAll } = useConsent();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [expandedVendors, setExpandedVendors] = useState<Record<ConsentCategory, boolean>>({
    necessary: false,
    functional: false,
    analytics: false,
    marketing: false,
  });
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, detailsOpen);

  const [draft, setDraft] = useState<Cats>(() => ({
    necessary: true,
    functional: state?.categories.functional ?? false,
    analytics: state?.categories.analytics ?? false,
    marketing: state?.categories.marketing ?? false,
  }));

  useEffect(() => {
    setDraft({
      necessary: true,
      functional: state?.categories.functional ?? false,
      analytics: state?.categories.analytics ?? false,
      marketing: state?.categories.marketing ?? false,
    });
  }, [state]);

  useEffect(() => {
    const open = () => setDetailsOpen(true);
    window.addEventListener(OPEN_PREFS_EVENT, open);
    return () => window.removeEventListener(OPEN_PREFS_EVENT, open);
  }, []);

  useEffect(() => {
    if (!detailsOpen || !decided) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetailsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailsOpen, decided]);

  const consentSurfaceVisible = mounted && (!decided || detailsOpen);
  useEffect(() => {
    setConsentOverlayVisible(consentSurfaceVisible);
    return () => setConsentOverlayVisible(false);
  }, [consentSurfaceVisible]);

  useEffect(() => {
    if (!mounted) return;
    setMarketingConsent(state ? state.categories.marketing : null);
  }, [mounted, state]);

  const bannerEnabled = privacy.cookie_banner && banner.enabled;
  const styleVars = useMemo(() => bannerStyleVars(banner.colors), [banner.colors]);
  if (!mounted) return null;
  if (decided && !detailsOpen) return null;
  if (!bannerEnabled && !detailsOpen) return null;

  const toggleVendors = (cat: ConsentCategory) =>
    setExpandedVendors((v) => ({ ...v, [cat]: !v[cat] }));

  const setLang = (l: "pl" | "en") => {
    if (l !== (isPl ? "pl" : "en")) void i18n.changeLanguage(l);
  };

  const categoryName = (cat: ConsentCategory): string => {
    switch (cat) {
      case "necessary":
        return t.categoryNecessary;
      case "functional":
        return t.categoryFunctional;
      case "analytics":
        return t.categoryAnalytics;
      case "marketing":
        return t.categoryMarketing;
    }
  };
  const categoryDesc = (cat: ConsentCategory): string => {
    switch (cat) {
      case "necessary":
        return t.descNecessary;
      case "functional":
        return t.descFunctional;
      case "analytics":
        return t.descAnalytics;
      case "marketing":
        return t.descMarketing;
    }
  };

  const LangSwitcher = banner.languageSwitcher ? (
    <div
      role="group"
      aria-label="PL / EN"
      className={cn(
        "inline-flex items-center rounded-full border p-0.5",
        "border-[color:var(--cb-border,var(--border))] bg-[color:var(--cb-muted,var(--muted))]/40",
      )}
    >
      {(["pl", "en"] as const).map((l) => {
        const active = (isPl ? "pl" : "en") === l;
        return (
          <button
            key={l}
            type="button"
            onClick={() => setLang(l)}
            aria-pressed={active}
            className={cn(
              "min-w-[1.75rem] px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide transition-colors",
              active
                ? "bg-[color:var(--cb-accent,var(--primary))] text-[color:var(--cb-accent-fg,var(--primary-foreground))]"
                : "text-[color:var(--cb-fg,var(--muted-foreground))]/70 hover:text-[color:var(--cb-fg,var(--foreground))]",
            )}
          >
            {l.toUpperCase()}
          </button>
        );
      })}
    </div>
  ) : null;

  // ---------- Compact editorial bar (bottom) ----------
  if (!detailsOpen) {
    return (
      <div
        role="dialog"
        aria-modal="false"
        aria-label={t.title}
        style={styleVars}
        className={cn(
          "fixed inset-x-3 bottom-3 z-[60] mx-auto w-auto sm:inset-x-4 sm:bottom-4",
          "sm:max-w-4xl",
          "border shadow-2xl backdrop-blur-md rounded-none sm:rounded-sm",
          "bg-[color:var(--cb-surface,var(--card))]/98 text-[color:var(--cb-fg,var(--card-foreground))]",
          "border-[color:var(--cb-border,var(--border))]",
          "animate-in fade-in slide-in-from-bottom-2 duration-300",
        )}
      >
        {/* Accent hairline top-edge for editorial feel */}
        <div aria-hidden className="h-[2px] w-full bg-[color:var(--cb-accent,var(--primary))]" />
        <div className="p-5 md:p-6 flex flex-col md:flex-row md:items-center gap-5 md:gap-8">
          {/* Left: content */}
          <div className="flex-1 min-w-0 space-y-2.5">
            <div className="flex items-center justify-between md:justify-start gap-4 flex-wrap">
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  aria-hidden
                  className="shrink-0 grid place-items-center h-6 w-6 rounded-sm bg-[color:var(--cb-accent,var(--primary))]/12 text-[color:var(--cb-accent,var(--primary))]"
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                </span>
                <h2
                  id="consent-title"
                  className="text-[13px] md:text-[14px] font-bold uppercase tracking-[0.14em] leading-tight text-[color:var(--cb-fg,var(--foreground))]"
                >
                  {t.title}
                </h2>
              </div>
              {LangSwitcher}
            </div>
            <p
              className={cn(
                "text-[12.5px] md:text-[13px] leading-relaxed max-w-2xl",
                "text-[color:var(--cb-fg,var(--muted-foreground))]/85",
              )}
            >
              {t.compactMessage}{" "}
              {privacyHref ? (
                <a
                  href={privacyHref}
                  className="font-semibold text-[color:var(--cb-accent,var(--primary))] underline underline-offset-4 decoration-[color:var(--cb-accent,var(--primary))]/40 hover:decoration-[color:var(--cb-accent,var(--primary))] transition-colors"
                >
                  {t.policyLabel}
                </a>
              ) : (
                <span className="font-semibold text-[color:var(--cb-accent,var(--primary))]">
                  {t.policyLabel}
                </span>
              )}
              .
            </p>
          </div>

          {/* Right: actions */}
          <div className="flex flex-wrap md:flex-nowrap items-center gap-2 md:gap-3 md:shrink-0">
            <button
              type="button"
              onClick={() => setDetailsOpen(true)}
              aria-label={t.showDetails}
              className={cn(
                "text-[11px] font-bold uppercase tracking-[0.15em] px-3 py-3 transition-colors",
                "text-[color:var(--cb-fg,var(--muted-foreground))] hover:text-[color:var(--cb-fg,var(--foreground))]",
              )}
            >
              <Settings2 className="inline-block h-3.5 w-3.5 mr-1.5 -mt-0.5" aria-hidden />
              {t.showDetails}
            </button>
            <button
              type="button"
              onClick={rejectAll}
              aria-label={t.rejectAll}
              className={cn(
                "text-[11px] font-bold uppercase tracking-[0.15em] px-5 py-3 whitespace-nowrap transition-colors",
                "border border-[color:var(--cb-border,var(--border))] text-[color:var(--cb-fg,var(--foreground))]",
                "hover:bg-[color:var(--cb-muted,var(--muted))]/60",
              )}
            >
              {t.rejectAll}
            </button>
            <button
              type="button"
              onClick={acceptAll}
              aria-label={t.acceptAll}
              className={cn(
                "text-[11px] font-bold uppercase tracking-[0.15em] px-6 py-3 whitespace-nowrap transition-all shadow-sm",
                "bg-[color:var(--cb-accent,var(--primary))] text-[color:var(--cb-accent-fg,var(--primary-foreground))]",
                "hover:bg-[color:var(--cb-accent,var(--primary))]/90 hover:shadow-[0_0_24px_-4px_color-mix(in_oklab,var(--cb-accent,var(--primary))_45%,transparent)]",
              )}
            >
              {t.acceptAll}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- Expanded modal with per-category vendor tables ----------
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-title"
      style={styleVars}
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-3 bg-foreground/60 backdrop-blur-sm animate-in fade-in"
      onClick={() => {
        if (decided) setDetailsOpen(false);
      }}
    >
      <div
        ref={dialogRef}
        className={cn(
          "w-full max-w-3xl max-h-[92vh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden",
          "bg-[color:var(--cb-surface,var(--card))] text-[color:var(--cb-fg,var(--foreground))] border-[color:var(--cb-border,var(--border))]",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-[color:var(--cb-border,var(--border))]">
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="shrink-0 grid place-items-center h-9 w-9 rounded-full bg-[color:var(--cb-accent,var(--primary))]/12 text-[color:var(--cb-accent,var(--primary))]"
            >
              <Cookie className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <h2 id="consent-title" className={cn(TX.title, "min-w-0")}>
                  {t.title}
                </h2>
                <div className="flex items-center gap-1.5 shrink-0">{LangSwitcher}</div>
              </div>
              <p
                className={cn(
                  TX.body,
                  "mt-1.5 text-[color:var(--cb-fg,var(--muted-foreground))]/90",
                )}
              >
                {t.intro}{" "}
                {privacyHref ? (
                  <a
                    href={privacyHref}
                    className="text-[color:var(--cb-accent,var(--primary))] underline underline-offset-2 hover:opacity-80"
                  >
                    {t.policyLabel}
                  </a>
                ) : (
                  <span className="text-[color:var(--cb-accent,var(--primary))]">
                    {t.policyLabel}
                  </span>
                )}{" "}
                {tr("common.and")}{" "}
                <a
                  href={dataProcessingHref}
                  className="text-[color:var(--cb-accent,var(--primary))] underline underline-offset-2 hover:opacity-80"
                >
                  {tr("common.dataProcessingTerms")}
                </a>
                .
              </p>
              <button
                type="button"
                onClick={() => setDetailsOpen(false)}
                className={cn(BTN_OUTLINE, "mt-3")}
              >
                <Settings2 className="h-3.5 w-3.5" />
                {t.hideDetails}
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Categories */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
          {CATEGORY_ORDER.map((cat) => {
            const locked = cat === "necessary";
            const vendors = VENDORS[cat];
            const vendorsOpen = expandedVendors[cat];
            return (
              <section
                key={cat}
                className={cn(
                  "rounded-xl border p-3 sm:p-4",
                  "bg-[color:var(--cb-surface,var(--card))]/60 border-[color:var(--cb-border,var(--border))]",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex items-start gap-2.5">
                    <span
                      aria-hidden
                      className="shrink-0 grid place-items-center h-7 w-7 rounded-md bg-[color:var(--cb-muted,var(--muted))] text-[color:var(--cb-fg,var(--muted-foreground))]"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className={TX.heading}>{categoryName(cat)}</p>
                        {locked && (
                          <span className="text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded bg-[color:var(--cb-accent,var(--primary))]/12 text-[color:var(--cb-accent,var(--primary))]">
                            {isPl ? "Wymagane" : "Required"}
                          </span>
                        )}
                        <span
                          className={cn(
                            TX.meta,
                            "font-mono text-[color:var(--cb-fg,var(--muted-foreground))]/70",
                          )}
                        >
                          {vendors.length}
                        </span>
                      </div>
                      <p
                        className={cn(
                          TX.body,
                          "mt-1 text-[color:var(--cb-fg,var(--muted-foreground))]/85",
                        )}
                      >
                        {categoryDesc(cat)}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={locked ? true : draft[cat]}
                    disabled={locked}
                    onCheckedChange={(v) => setDraft((d) => ({ ...d, [cat]: !!v }))}
                    aria-label={categoryName(cat)}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => toggleVendors(cat)}
                  aria-expanded={vendorsOpen}
                  className={cn(BTN_OUTLINE, "mt-3")}
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {vendorsOpen ? t.hideVendors : t.showVendors}
                  {vendorsOpen ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </button>

                {vendorsOpen && (
                  <div className="mt-3 rounded-lg border border-[color:var(--cb-border,var(--border))] bg-[color:var(--cb-muted,var(--muted))]/25 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="text-[color:var(--cb-fg,var(--muted-foreground))]/80 border-b border-[color:var(--cb-border,var(--border))]">
                            <th className="text-left font-medium px-3 py-2">
                              {isPl ? "Nazwa" : "Name"}
                            </th>
                            <th className="text-left font-medium px-3 py-2">
                              {isPl ? "Podmiot" : "Party"}
                            </th>
                            <th className="text-left font-medium px-3 py-2">
                              {isPl ? "Cel" : "Purpose"}
                            </th>
                            <th className="text-left font-medium px-3 py-2">
                              {isPl ? "Wygasa" : "Expires"}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[color:var(--cb-border,var(--border))]">
                          {vendors.map((v) => (
                            <tr key={v.name} className="align-top">
                              <td className="px-3 py-2 font-mono text-[color:var(--cb-accent,var(--primary))] whitespace-normal break-words max-w-[10rem]">
                                {v.name}
                              </td>
                              <td className="px-3 py-2">{isPl ? v.party_pl : v.party_en}</td>
                              <td className="px-3 py-2 text-[color:var(--cb-fg,var(--muted-foreground))]/90">
                                {isPl ? v.purpose_pl : v.purpose_en}
                              </td>
                              <td className="px-3 py-2 text-[color:var(--cb-fg,var(--muted-foreground))]/90 whitespace-nowrap">
                                {isPl ? v.ttl_pl : v.ttl_en}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>

        {/* Footer actions */}
        <div className="flex flex-wrap items-center justify-end gap-2 p-3 sm:p-4 border-t border-[color:var(--cb-border,var(--border))] bg-[color:var(--cb-muted,var(--muted))]/25">
          <button
            type="button"
            className={BTN_GHOST}
            onClick={() => {
              rejectAll();
              setDetailsOpen(false);
            }}
          >
            <X className="h-3.5 w-3.5" />
            {t.rejectAll}
          </button>
          <button
            type="button"
            className={BTN_OUTLINE}
            onClick={() => {
              save(draft);
              setDetailsOpen(false);
            }}
          >
            <Check className="h-3.5 w-3.5" />
            {t.saveSelection}
          </button>
          <button
            type="button"
            className={BTN_PRIMARY}
            onClick={() => {
              acceptAll();
              setDetailsOpen(false);
            }}
          >
            <Check className="h-3.5 w-3.5" />
            {t.acceptAll}
          </button>
        </div>
      </div>
    </div>
  );
}
