// Usercentrics-style CMP with nes-quiz.com layout:
// - compact bottom strip with "Szczegóły i podmioty" toggle
// - expanded card lists per-category vendor tables (Nazwa/Podmiot/Cel/Wygasa)
// - decision persisted in localStorage and (when signed-in) profiles.prefs.consent
// Fully bilingual (PL/EN) and follows the app design tokens.
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useConsent, OPEN_PREFS_EVENT, type ConsentCategory } from "@/lib/ads/consent";
import { useFocusTrap } from "@/lib/a11y/useFocusTrap";
import { setConsentOverlayVisible, setMarketingConsent } from "@/lib/overlayCoordinator";
import { useSiteSetting } from "@/lib/useSiteSetting";
import { localizedPath } from "@/lib/i18n/localePath";

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

type CategoryMeta = {
  pl: string;
  en: string;
  desc_pl: string;
  desc_en: string;
  vendors: Vendor[];
};

const CATEGORIES: Record<ConsentCategory, CategoryMeta> = {
  necessary: {
    pl: "Niezbędne",
    en: "Necessary",
    desc_pl:
      "Pliki cookie wymagane do prawidłowego działania platformy - uwierzytelnianie sesji, ochrona CSRF i podstawowe funkcje bezpieczeństwa. Nie można ich wyłączyć zgodnie z art. 5 ust. 3 dyrektywy ePrivacy.",
    desc_en:
      "Cookies required for the platform to function - session authentication, CSRF protection and core security features. Cannot be disabled under Article 5(3) of the ePrivacy Directive.",
    vendors: [
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
  },
  functional: {
    pl: "Funkcjonalne",
    en: "Functional",
    desc_pl:
      "Zapamiętują Twoje preferencje (motyw kolorystyczny, układ interfejsu). Dane przechowywane lokalnie w przeglądarce (localStorage), bez transmisji do podmiotów trzecich.",
    desc_en:
      "Remember your preferences (color theme, interface layout). Stored locally in the browser (localStorage), never sent to third parties.",
    vendors: [
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
  },
  analytics: {
    pl: "Analityczne",
    en: "Analytics",
    desc_pl:
      "Zbierają zanonimizowane dane o sposobie korzystania z platformy (odwiedzane strony, czas sesji, źródła ruchu). Służą optymalizacji treści i funkcjonalności. Żadne dane analityczne nie są zbierane przed wyrażeniem zgody.",
    desc_en:
      "Collect anonymised information on how the platform is used (pages visited, session duration, traffic sources). Used to improve content and features. No analytics is collected before consent is granted.",
    vendors: [
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
  },
  marketing: {
    pl: "Marketingowe",
    en: "Marketing",
    desc_pl:
      "Umożliwiają prowadzenie kampanii e-mailowych, śledzenie konwersji i personalizację komunikacji marketingowej. Dane mogą być przekazywane do podmiotów trzecich wymienionych poniżej.",
    desc_en:
      "Enable email campaigns, conversion tracking and personalised marketing communication. Data may be shared with the third parties listed below.",
    vendors: [
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
  },
};

const CATEGORY_ORDER: ConsentCategory[] = ["necessary", "functional", "analytics", "marketing"];

export function ConsentBanner() {
  const { i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
  const privacy = useSiteSetting<PrivacyConfig>("privacy", PRIVACY_DEFAULTS);
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

  // Sync draft when state changes (e.g. hydrated from profile)
  useEffect(() => {
    setDraft({
      necessary: true,
      functional: state?.categories.functional ?? false,
      analytics: state?.categories.analytics ?? false,
      marketing: state?.categories.marketing ?? false,
    });
  }, [state]);

  // External trigger from footer: opens the details panel.
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

  const t = useMemo(
    () => ({
      title: isPl ? "Zarządzaj swoją prywatnością" : "Manage your privacy",
      intro: isPl
        ? "Nasza platforma wykorzystuje pliki cookie i podobne technologie w celu zapewnienia bezpieczeństwa, personalizacji oraz analizy ruchu. Poniżej znajdziesz szczegółowe informacje o każdej kategorii i podmiotach przetwarzających dane. Pełne informacje zawiera nasza"
        : "Our platform uses cookies and similar technologies to ensure security, personalisation and traffic analysis. Below you will find detailed information about each category and the entities processing the data. Full information is available in our",
      policy: isPl ? "Polityka Prywatności" : "Privacy Policy",
      and: isPl ? "oraz" : "and",
      dataProcessing: isPl ? "Zasady przetwarzania danych" : "Data Processing Terms",
      showDetails: isPl ? "Szczegóły i podmioty" : "Details and vendors",
      hideDetails: isPl ? "Ukryj szczegóły" : "Hide details",
      showVendors: isPl ? "Pokaż podmioty" : "Show vendors",
      hideVendors: isPl ? "Ukryj podmioty" : "Hide vendors",
      required: isPl ? "Wymagane" : "Required",
      acceptAll: isPl ? "Akceptuj wszystkie" : "Accept all",
      rejectAll: isPl ? "Tylko niezbędne" : "Only necessary",
      saveSelection: isPl ? "Zapisz wybrane" : "Save selection",
      colName: isPl ? "Nazwa" : "Name",
      colParty: isPl ? "Podmiot" : "Party",
      colPurpose: isPl ? "Cel" : "Purpose",
      colExpiry: isPl ? "Wygasa" : "Expires",
    }),
    [isPl],
  );

  if (!mounted) return null;
  if (decided && !detailsOpen) return null;
  if (!privacy.cookie_banner && !detailsOpen) return null;

  const toggleVendors = (cat: ConsentCategory) =>
    setExpandedVendors((v) => ({ ...v, [cat]: !v[cat] }));

  // ---------- Compact strip (bottom, no details) ----------
  if (!detailsOpen) {
    return (
      <div
        role="dialog"
        aria-modal="false"
        aria-label={t.title}
        className="fixed inset-x-2 bottom-2 z-[60] mx-auto max-w-xl sm:max-w-2xl rounded-lg border border-border/80 bg-card/95 backdrop-blur-md text-card-foreground shadow-lg p-2.5 sm:p-3"
      >
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="shrink-0 grid place-items-center h-7 w-7 rounded-full bg-primary/10 text-primary"
          >
            <Cookie className="h-3.5 w-3.5" />
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-muted-foreground leading-tight">
              {isPl
                ? "Używamy plików cookie. Dowiedz się więcej w"
                : "We use cookies. Learn more in our"}{" "}
              {privacyHref ? (
                <a
                  href={privacyHref}
                  className="text-primary underline underline-offset-2 hover:opacity-80"
                >
                  {t.policy}
                </a>
              ) : (
                <span className="text-primary">{t.policy}</span>
              )}
              .
            </p>
          </div>

          <div className="shrink-0 flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label={t.showDetails}
              title={t.showDetails}
              onClick={() => setDetailsOpen(true)}
            >
              <Settings2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              className="h-7 w-7 p-0 sm:h-7 sm:px-2 sm:w-auto text-[11px]"
              aria-label={t.acceptAll}
              title={t.acceptAll}
              onClick={acceptAll}
            >
              <Check className="h-3.5 w-3.5" />
              <span className="hidden sm:inline ml-1.5">{t.acceptAll}</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-7 p-0 sm:h-7 sm:px-2 sm:w-auto text-[11px]"
              aria-label={t.rejectAll}
              title={t.rejectAll}
              onClick={rejectAll}
            >
              <X className="h-3.5 w-3.5" />
              <span className="hidden sm:inline ml-1.5">{t.rejectAll}</span>
            </Button>
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
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-3 bg-foreground/60 backdrop-blur-sm animate-in fade-in"
      onClick={() => {
        if (decided) setDetailsOpen(false);
      }}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-3xl max-h-[92vh] bg-card text-foreground rounded-2xl border border-border shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-border">
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="shrink-0 grid place-items-center h-10 w-10 rounded-full bg-primary/10 text-primary"
            >
              <Cookie className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 id="consent-title" className="text-lg font-semibold leading-snug">
                {t.title}
              </h2>
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                {t.intro}{" "}
                {privacyHref ? (
                  <a
                    href={privacyHref}
                    className="text-primary underline underline-offset-2 hover:opacity-80"
                  >
                    {t.policy}
                  </a>
                ) : (
                  <span className="text-primary">{t.policy}</span>
                )}{" "}
                {t.and}{" "}
                <a
                  href={dataProcessingHref}
                  className="text-primary underline underline-offset-2 hover:opacity-80"
                >
                  {t.dataProcessing}
                </a>
                .
              </p>
              <button
                type="button"
                onClick={() => setDetailsOpen(false)}
                className="mt-3 inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border border-border text-primary hover:bg-accent transition-colors"
              >
                <Settings2 className="h-3.5 w-3.5" />
                {t.hideDetails}
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Categories */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
          {CATEGORY_ORDER.map((cat) => {
            const meta = CATEGORIES[cat];
            const locked = cat === "necessary";
            const count = meta.vendors.length;
            const vendorsOpen = expandedVendors[cat];
            return (
              <section
                key={cat}
                className="rounded-xl border border-border bg-card/50 p-4 sm:p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex items-start gap-3">
                    <span
                      aria-hidden
                      className="shrink-0 grid place-items-center h-7 w-7 rounded-md bg-muted text-muted-foreground"
                    >
                      <ShieldCheck className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">{isPl ? meta.pl : meta.en}</p>
                        {locked && (
                          <span className="text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                            {t.required}
                          </span>
                        )}
                        <span className="text-[11px] font-mono text-muted-foreground">{count}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                        {isPl ? meta.desc_pl : meta.desc_en}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={locked ? true : draft[cat]}
                    disabled={locked}
                    onCheckedChange={(v) => setDraft((d) => ({ ...d, [cat]: !!v }))}
                    aria-label={isPl ? meta.pl : meta.en}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => toggleVendors(cat)}
                  aria-expanded={vendorsOpen}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border border-border text-primary hover:bg-accent transition-colors"
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
                  <div className="mt-3 rounded-lg border border-border bg-background/40 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-muted-foreground border-b border-border">
                            <th className="text-left font-medium px-3 py-2">{t.colName}</th>
                            <th className="text-left font-medium px-3 py-2">{t.colParty}</th>
                            <th className="text-left font-medium px-3 py-2">{t.colPurpose}</th>
                            <th className="text-left font-medium px-3 py-2">{t.colExpiry}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {meta.vendors.map((v) => (
                            <tr key={v.name} className="align-top">
                              <td className="px-3 py-2 font-mono text-primary whitespace-normal break-words max-w-[10rem]">
                                {v.name}
                              </td>
                              <td className="px-3 py-2 text-foreground/80">
                                {isPl ? v.party_pl : v.party_en}
                              </td>
                              <td className="px-3 py-2 text-muted-foreground">
                                {isPl ? v.purpose_pl : v.purpose_en}
                              </td>
                              <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
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
        <div className="flex flex-wrap items-center justify-end gap-2 p-4 sm:p-5 border-t border-border bg-muted/30">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              save(draft);
              setDetailsOpen(false);
            }}
          >
            <Check className="h-4 w-4" />
            {t.saveSelection}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              acceptAll();
              setDetailsOpen(false);
            }}
          >
            <Check className="h-4 w-4" />
            {t.acceptAll}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              rejectAll();
              setDetailsOpen(false);
            }}
          >
            <X className="h-4 w-4" />
            {t.rejectAll}
          </Button>
        </div>
      </div>
    </div>
  );
}
