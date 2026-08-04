// Cookie banner: compact floating consent card (bottom-right) with inline
// preferences, plus a full details modal carrying the per-category vendor
// tables. Copy and colors come from site_settings via useCookieBannerConfig();
// every color resolves through --cb-* custom properties with semantic-token
// fallbacks, so light and dark themes are covered without a second palette.
// Consent state persists in localStorage + cookie and (when signed-in) syncs to
// profiles.prefs.consent - refresh is automatic because useConsent() re-reads
// on the consent-change event.
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Cookie, ChevronDown, ChevronUp, Check, X, Settings2 } from "lucide-react";
import { GpcCategoryBadgeSlot, GpcNoticeSlot } from "@/components/consent/GpcSurfaceSlots";
import { useTheme } from "@/components/ThemeProvider";
import {
  useConsent,
  useGpcSignal,
  OPEN_PREFS_EVENT,
  type ConsentCategory,
} from "@/lib/ads/consent";
import { isGpcClampedCategory, isGpcOverrideValid } from "@/lib/consent/gpc";
import { useFocusTrap } from "@/lib/a11y/useFocusTrap";
import { useBrandMarkUrl } from "@/lib/brand/useBrandLogoUrl";
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

// Exit animation length for the compact card - the decision is written first,
// the card only lingers long enough to slide out. Keep in sync with the
// `duration-300` utility on the card itself.
const EXIT_MS = 300;

// Design tokens for the banner - one shared scale for the compact card and the
// details modal, desktop and mobile. Change here to change everywhere.
// Colors are always `--cb-*` first (admin override) with a semantic theme token
// as fallback, which is what keeps light/dark working with zero extra config.
const TX = {
  body: "text-[12px] leading-[1.5]",
  meta: "text-[11px] leading-[1.4]",
  heading: "text-[13px] font-semibold leading-snug",
  title: "text-[14px] sm:text-[15px] font-semibold leading-snug",
} as const;

const CB_BORDER = "border-[color:var(--cb-border,var(--border))]";
const CB_SURFACE = "bg-[color:var(--cb-surface,var(--card))]";
const CB_FG = "text-[color:var(--cb-fg,var(--card-foreground))]";
const CB_DIM = "text-[color:var(--cb-fg,var(--muted-foreground))]/85";
const CB_ACCENT_BAR = "bg-[color:var(--cb-accent,var(--primary))]";

const LINK = cn(
  "font-medium underline underline-offset-4 transition-colors",
  "text-[color:var(--cb-accent,var(--primary))]",
  "decoration-[color:var(--cb-accent,var(--primary))]/40 hover:decoration-[color:var(--cb-accent,var(--primary))]",
);

const BTN_BASE = cn(
  "inline-flex items-center justify-center gap-1.5 rounded-md border text-[12px] font-medium",
  "cursor-pointer whitespace-nowrap transition-colors",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cb-accent,var(--primary))]/50",
);
const BTN_MD = "h-9 px-3.5";
const BTN_SM = "h-8 px-2.5";

const BTN_PRIMARY = cn(
  BTN_BASE,
  "border-transparent shadow-sm",
  "bg-[color:var(--cb-accent,var(--primary))] text-[color:var(--cb-accent-fg,var(--primary-foreground))]",
  "hover:bg-[color:var(--cb-accent,var(--primary))]/90",
);
const BTN_OUTLINE = cn(
  BTN_BASE,
  "border-[color:var(--cb-border,var(--border))] text-[color:var(--cb-fg,var(--foreground))]",
  "bg-transparent hover:bg-[color:var(--cb-accent,var(--primary))]/12 hover:border-[color:var(--cb-accent,var(--primary))]/40",
);
const BTN_GHOST = cn(
  BTN_BASE,
  "border-transparent text-[color:var(--cb-fg,var(--muted-foreground))]",
  "bg-transparent hover:bg-[color:var(--cb-accent,var(--primary))]/12 hover:text-[color:var(--cb-fg,var(--foreground))]",
);

const ICON_BTN = cn(
  "inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors",
  "text-[color:var(--cb-fg,var(--muted-foreground))] hover:bg-[color:var(--cb-accent,var(--primary))]/12",
  "hover:text-[color:var(--cb-fg,var(--foreground))]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cb-accent,var(--primary))]/50",
);

/**
 * Znak marki w kaflu ikony. Gdy logo nie jest skonfigurowane (albo plik nie
 * wstaje), zostaje ciasteczko z Lucide - baner nigdy nie pokazuje pustej ramki.
 */
function ConsentMark({ src, className }: { src: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  const showLogo = !!src && !failed;

  return (
    <span
      aria-hidden
      className={cn(
        "grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg",
        "bg-[color:var(--cb-accent,var(--primary))]/10 text-[color:var(--cb-accent,var(--primary))]",
        "ring-1 ring-[color:var(--cb-accent,var(--primary))]/20",
        className,
      )}
    >
      {showLogo ? (
        <img
          src={src}
          alt=""
          width={36}
          height={36}
          loading="lazy"
          decoding="async"
          className="size-full object-contain p-1"
          onError={() => setFailed(true)}
        />
      ) : (
        <Cookie className="size-[18px]" />
      )}
    </span>
  );
}

interface CategoryRowProps {
  name: string;
  desc: string;
  checked: boolean;
  /** Kategoria niezbędna - zawsze włączona, kontrolka wyłączona. */
  locked?: boolean;
  /** Kategoria wyłączona honorowanym sygnałem GPC (znaczek obok nazwy). */
  clamped?: boolean;
  requiredLabel: string;
  onToggle: () => void;
  /** Kompaktowy baner skraca opis do dwóch linii; modal pokazuje pełny. */
  clampDesc?: boolean;
  children?: React.ReactNode;
}

/**
 * Wiersz kategorii - kontrolka typu checkbox (rola ARIA `checkbox`, nie tylko
 * przycisk, żeby czytnik ekranu ogłosił stan zaznaczenia) plus nazwa, opis i
 * opcjonalna sekcja podmiotów pod spodem.
 */
function CategoryRow({
  name,
  desc,
  checked,
  locked = false,
  clamped = false,
  requiredLabel,
  onToggle,
  clampDesc = false,
  children,
}: CategoryRowProps) {
  return (
    <div
      className={cn("rounded-lg border", CB_BORDER, "bg-[color:var(--cb-muted,var(--muted))]/25")}
    >
      <div className="flex items-start gap-2.5 p-2.5">
        <button
          type="button"
          role="checkbox"
          aria-checked={checked}
          aria-label={name}
          disabled={locked}
          onClick={() => !locked && onToggle()}
          className={cn(
            "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded border transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cb-accent,var(--primary))]/50",
            locked
              ? "cursor-not-allowed border-transparent bg-[color:var(--cb-accent,var(--primary))]/40 text-[color:var(--cb-accent-fg,var(--primary-foreground))]"
              : checked
                ? "cursor-pointer border-transparent bg-[color:var(--cb-accent,var(--primary))] text-[color:var(--cb-accent-fg,var(--primary-foreground))]"
                : cn(
                    "cursor-pointer bg-transparent",
                    CB_BORDER,
                    "hover:border-[color:var(--cb-accent,var(--primary))]/50 hover:bg-[color:var(--cb-accent,var(--primary))]/10",
                  ),
          )}
        >
          {checked && <Check className="size-3.5" aria-hidden />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className={TX.heading}>{name}</p>
            {locked && (
              <span className="rounded bg-[color:var(--cb-accent,var(--primary))]/12 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[color:var(--cb-accent,var(--primary))]">
                {requiredLabel}
              </span>
            )}
            <GpcCategoryBadgeSlot clamped={clamped} />
          </div>
          <p className={cn(TX.meta, "mt-1", CB_DIM, clampDesc && "line-clamp-2")}>{desc}</p>
        </div>
      </div>

      {children ? <div className={cn("border-t px-2.5 py-2.5", CB_BORDER)}>{children}</div> : null}
    </div>
  );
}

export function ConsentBanner() {
  const { i18n, t: tr } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
  const privacy = useSiteSetting<PrivacyConfig>("privacy", PRIVACY_DEFAULTS);
  const banner = useCookieBannerConfig();
  const t: CookieBannerCopy = isPl ? banner.copy.pl : banner.copy.en;
  const { theme } = useTheme();
  const brandMark = useBrandMarkUrl(theme === "dark" ? "dark" : "light");

  const privacyHref = privacy.privacy_page_slug
    ? localizedPath(`/${privacy.privacy_page_slug.replace(/^\/+/, "")}`, isPl ? "pl" : "en")
    : null;
  const dataProcessingHref = localizedPath("/privacy", isPl ? "pl" : "en");

  const { state, decided, mounted, save, acceptAll, rejectAll } = useConsent();
  // Sygnał GPC: `gpcActive` steruje widocznością noty (użytkownik musi wiedzieć,
  // że sygnał został zauważony - także gdy sam go nadpisał), `gpcHonored` steruje
  // klamrą na przełącznikach.
  const gpc = useGpcSignal();
  const gpcOverridden = isGpcOverrideValid(state);
  const gpcHonored = gpc.active && !gpcOverridden;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [expandedVendors, setExpandedVendors] = useState<Record<ConsentCategory, boolean>>({
    necessary: false,
    functional: false,
    analytics: false,
    marketing: false,
  });
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, detailsOpen);

  // Szkic startuje od stanu EFEKTYWNEGO, nie zapisanego: przy honorowanym
  // sygnale GPC przełączniki klamrowanych kategorii muszą pokazywać „nie", bo
  // taki jest realny stan bramkowania. Przełącznik zostaje AKTYWNY - użytkownik
  // ma prawo świadomie nadpisać sygnał, a zablokowana kontrolka odebrałaby mu je.
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
      analytics: (state?.categories.analytics ?? false) && !gpcHonored,
      marketing: (state?.categories.marketing ?? false) && !gpcHonored,
    });
  }, [state, gpcHonored]);

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

  // Decyzja zapisuje się NATYCHMIAST, a karta zostaje zamontowana jeszcze przez
  // czas animacji wyjścia - inaczej wybór znikałby skokowo (komponent przestaje
  // się renderować, gdy `decided` robi się prawdą).
  const [dismissing, setDismissing] = useState(false);
  const exitTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
    },
    [],
  );
  const decide = (act: () => void) => {
    act();
    setPrefsOpen(false);
    setDismissing(true);
    if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
    exitTimer.current = window.setTimeout(() => setDismissing(false), EXIT_MS);
  };

  // Wysokość panelu preferencji mierzona z treści - `height: auto` nie da się
  // animować, więc trzymamy piksele i odświeżamy je przy zmianie języka/treści.
  const prefsRef = useRef<HTMLDivElement>(null);
  const [prefsHeight, setPrefsHeight] = useState(0);
  useEffect(() => {
    const el = prefsRef.current;
    if (!prefsOpen || !el) {
      setPrefsHeight(0);
      return;
    }
    const measure = () => setPrefsHeight(el.scrollHeight);
    measure();
    const inner = el.firstElementChild;
    if (!inner || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [prefsOpen, isPl, gpcHonored, draft, t]);

  const consentSurfaceVisible = mounted && (!decided || detailsOpen);
  useEffect(() => {
    setConsentOverlayVisible(consentSurfaceVisible);
    return () => setConsentOverlayVisible(false);
  }, [consentSurfaceVisible]);

  useEffect(() => {
    if (!mounted) return;
    // Koordynator nakładek dostaje wartość EFEKTYWNĄ - inaczej popupy
    // marketingowe wyświetlałyby się osobie, której sygnał GPC właśnie
    // wyłączył kategorię marketingową.
    setMarketingConsent(state ? state.categories.marketing && !gpcHonored : null);
  }, [mounted, state, gpcHonored]);

  /** Powrót do respektowania sygnału: zdejmij klamrowane kategorie i override. */
  const restoreGpc = () =>
    save({ functional: draft.functional, analytics: false, marketing: false });

  const bannerEnabled = privacy.cookie_banner && banner.enabled;
  const styleVars = useMemo(() => bannerStyleVars(banner.colors), [banner.colors]);
  if (!mounted) return null;
  if (decided && !detailsOpen && !dismissing) return null;
  if (!bannerEnabled && !detailsOpen) return null;

  const toggleVendors = (cat: ConsentCategory) =>
    setExpandedVendors((v) => ({ ...v, [cat]: !v[cat] }));

  const setLang = (l: "pl" | "en") => {
    if (l !== (isPl ? "pl" : "en")) void i18n.changeLanguage(l);
  };

  const resetDraft = () =>
    setDraft({
      necessary: true,
      functional: state?.categories.functional ?? false,
      analytics: (state?.categories.analytics ?? false) && !gpcHonored,
      marketing: (state?.categories.marketing ?? false) && !gpcHonored,
    });

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

  const closeLabel = `${tr("common.close")} (${t.rejectAll})`;

  const LangSwitcher = banner.languageSwitcher ? (
    <div
      role="group"
      aria-label="PL / EN"
      className={cn(
        "inline-flex items-center rounded-full border p-0.5",
        CB_BORDER,
        "bg-[color:var(--cb-muted,var(--muted))]/40",
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
              "min-w-[1.75rem] cursor-pointer rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide transition-colors",
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

  // Zdanie o politykach - identyczne w karcie i w modalu, więc jedno miejsce.
  const policySentence = (
    <>
      {privacyHref ? (
        <a href={privacyHref} className={LINK}>
          {t.policyLabel}
        </a>
      ) : (
        <span className="font-medium text-[color:var(--cb-accent,var(--primary))]">
          {t.policyLabel}
        </span>
      )}{" "}
      {tr("common.and")}{" "}
      <a href={dataProcessingHref} className={LINK}>
        {tr("common.dataProcessingTerms")}
      </a>
      .
    </>
  );

  const categoryRows = (clampDesc: boolean) =>
    CATEGORY_ORDER.map((cat) => (
      <CategoryRow
        key={cat}
        name={categoryName(cat)}
        desc={categoryDesc(cat)}
        checked={cat === "necessary" ? true : draft[cat]}
        locked={cat === "necessary"}
        clamped={gpcHonored && isGpcClampedCategory(cat)}
        requiredLabel={tr("common.required")}
        onToggle={() => setDraft((d) => ({ ...d, [cat]: !d[cat] }))}
        clampDesc={clampDesc}
      />
    ));

  // ---------- Compact floating card (bottom-right) ----------
  if (!detailsOpen) {
    return (
      <div
        role="dialog"
        aria-modal="false"
        aria-label={t.title}
        style={styleVars}
        className={cn(
          "fixed z-[60] right-3 bottom-3 left-3",
          "sm:left-auto sm:right-5 sm:bottom-5 sm:w-[380px]",
          "max-w-[calc(100vw-1.5rem)]",
        )}
      >
        <div
          className={cn(
            "relative flex max-h-[calc(100svh-1.5rem)] flex-col gap-3 overflow-y-auto",
            "rounded-xl border p-4 shadow-2xl backdrop-blur-md",
            CB_SURFACE,
            CB_FG,
            "border-[color:var(--cb-border,var(--border))]/70",
            dismissing
              ? "animate-out fade-out slide-out-to-bottom-4 fill-mode-forwards"
              : "animate-in fade-in slide-in-from-bottom-4",
            "duration-300 ease-out",
          )}
        >
          <div className="flex items-center gap-3">
            <ConsentMark src={brandMark} />
            <h2 id="consent-title" className={cn(TX.title, "min-w-0 flex-1")}>
              {t.title}
            </h2>
            {/* „X" = odmowa (tak jak wytyczne CNIL): zamknięcie nie może być
                łatwiejsze niż odrzucenie, więc jest po prostu odrzuceniem.
                Etykieta mówi to wprost - i jest inna niż na przycisku
                odrzucenia, żeby czytnik ekranu nie ogłaszał dwóch identycznych. */}
            <button
              type="button"
              onClick={() => decide(() => rejectAll())}
              aria-label={closeLabel}
              title={closeLabel}
              className={cn(ICON_BTN, "-mt-1 -mr-1 self-start")}
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>

          <p className={cn(TX.body, CB_DIM)}>
            {t.compactMessage} {policySentence}
          </p>

          {/* Sygnał GPC: nota pojawia się PRZED przyciskami, bo zmienia
              znaczenie „Akceptuj wszystkie" (świadomy override sygnału). */}
          <GpcNoticeSlot
            active={gpc.active}
            source={gpc.source}
            overridden={gpcOverridden}
            onRestore={restoreGpc}
            variant="compact"
          />

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => decide(() => rejectAll())}
                className={cn(BTN_OUTLINE, BTN_MD, "flex-1")}
              >
                {t.rejectAll}
              </button>
              <button
                type="button"
                onClick={() => decide(() => acceptAll())}
                className={cn(BTN_PRIMARY, BTN_MD, "flex-1")}
              >
                {t.acceptAll}
              </button>
            </div>

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setPrefsOpen((p) => !p)}
                aria-expanded={prefsOpen}
                aria-controls="cookie-preferences-inline"
                className={cn(BTN_GHOST, BTN_SM, "-ml-1")}
              >
                <Settings2 className="size-3.5" aria-hidden />
                {t.customize}
                {prefsOpen ? (
                  <ChevronUp className="size-3.5" aria-hidden />
                ) : (
                  <ChevronDown className="size-3.5" aria-hidden />
                )}
              </button>
              {LangSwitcher}
            </div>
          </div>

          <div
            id="cookie-preferences-inline"
            ref={prefsRef}
            style={{ height: prefsHeight ? `${prefsHeight}px` : 0 }}
            className="overflow-hidden transition-[height] duration-300 ease-out will-change-[height] motion-reduce:transition-none"
          >
            {prefsOpen && (
              <div className="flex flex-col gap-2">
                {categoryRows(true)}

                <div className="mt-0.5 flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPrefsOpen(false);
                      setDetailsOpen(true);
                    }}
                    className={cn(BTN_GHOST, BTN_SM, "-ml-1")}
                  >
                    {t.showDetails}
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        resetDraft();
                        setPrefsOpen(false);
                      }}
                      className={cn(BTN_OUTLINE, BTN_SM)}
                    >
                      {tr("common.cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={() => decide(() => save(draft))}
                      className={cn(BTN_PRIMARY, BTN_SM)}
                    >
                      <Check className="size-3.5" aria-hidden />
                      {t.saveSelection}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ---------- Details modal with per-category vendor tables ----------
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-title"
      style={styleVars}
      className="fixed inset-0 z-[80] flex items-end justify-center bg-foreground/60 p-3 backdrop-blur-sm animate-in fade-in sm:items-center"
      onClick={() => {
        if (decided) setDetailsOpen(false);
      }}
    >
      <div
        ref={dialogRef}
        className={cn(
          "flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border shadow-2xl",
          CB_SURFACE,
          CB_FG,
          "border-[color:var(--cb-border,var(--border))]/70",
          "animate-in fade-in slide-in-from-bottom-4 duration-300 ease-out",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div aria-hidden className={cn("h-[2px] w-full shrink-0", CB_ACCENT_BAR)} />

        {/* Header - przełącznik języka i „X" siedzą w linii TYTUŁU, nie obok
            całej kolumny tekstu: inaczej na telefonie wstęp zwężałby się do
            połowy szerokości modala. */}
        <div className={cn("border-b p-4 sm:p-5", CB_BORDER)}>
          <div className="flex items-center gap-3">
            <ConsentMark src={brandMark} />
            <h2 id="consent-title" className={cn(TX.title, "min-w-0 flex-1")}>
              {t.title}
            </h2>
            <div className="flex shrink-0 items-center gap-1.5 self-start">
              {LangSwitcher}
              <button
                type="button"
                onClick={() => setDetailsOpen(false)}
                aria-label={decided ? tr("common.close") : t.hideDetails}
                title={decided ? tr("common.close") : t.hideDetails}
                className={cn(ICON_BTN, "-mt-1 -mr-1")}
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          </div>
          <p className={cn(TX.body, "mt-2.5", CB_DIM)}>
            {t.intro} {policySentence}
          </p>
        </div>

        {/* Categories */}
        <div className="flex-1 space-y-2.5 overflow-y-auto p-3 sm:p-4">
          <GpcNoticeSlot
            active={gpc.active}
            source={gpc.source}
            overridden={gpcOverridden}
            onRestore={restoreGpc}
          />
          {CATEGORY_ORDER.map((cat) => {
            const locked = cat === "necessary";
            const vendors = VENDORS[cat];
            const vendorsOpen = expandedVendors[cat];
            return (
              <CategoryRow
                key={cat}
                name={categoryName(cat)}
                desc={categoryDesc(cat)}
                checked={locked ? true : draft[cat]}
                locked={locked}
                clamped={gpcHonored && isGpcClampedCategory(cat)}
                requiredLabel={tr("common.required")}
                onToggle={() => setDraft((d) => ({ ...d, [cat]: !d[cat] }))}
              >
                <button
                  type="button"
                  onClick={() => toggleVendors(cat)}
                  aria-expanded={vendorsOpen}
                  className={cn(BTN_OUTLINE, BTN_SM)}
                >
                  {vendorsOpen ? t.hideVendors : t.showVendors}
                  <span className={cn(TX.meta, "font-mono opacity-70")}>{vendors.length}</span>
                  {vendorsOpen ? (
                    <ChevronUp className="size-3.5" aria-hidden />
                  ) : (
                    <ChevronDown className="size-3.5" aria-hidden />
                  )}
                </button>

                {vendorsOpen && (
                  <div
                    className={cn(
                      "mt-2.5 overflow-hidden rounded-lg border",
                      CB_BORDER,
                      "bg-[color:var(--cb-surface,var(--card))]",
                    )}
                  >
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className={cn("border-b", CB_BORDER, CB_DIM)}>
                            <th className="px-3 py-2 text-left font-medium">{tr("common.name")}</th>
                            <th className="px-3 py-2 text-left font-medium">
                              {tr("common.party")}
                            </th>
                            <th className="px-3 py-2 text-left font-medium">
                              {tr("common.purpose")}
                            </th>
                            <th className="px-3 py-2 text-left font-medium">
                              {tr("common.expires")}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[color:var(--cb-border,var(--border))]">
                          {vendors.map((v) => (
                            <tr key={v.name} className="align-top">
                              <td className="max-w-[10rem] break-words whitespace-normal px-3 py-2 font-mono text-[color:var(--cb-accent,var(--primary))]">
                                {v.name}
                              </td>
                              <td className="px-3 py-2">{isPl ? v.party_pl : v.party_en}</td>
                              <td className={cn("px-3 py-2", CB_DIM)}>
                                {isPl ? v.purpose_pl : v.purpose_en}
                              </td>
                              <td className={cn("px-3 py-2 whitespace-nowrap", CB_DIM)}>
                                {isPl ? v.ttl_pl : v.ttl_en}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </CategoryRow>
            );
          })}
        </div>

        {/* Footer actions */}
        {/* Na telefonie trzy pełnej szerokości przyciski jeden pod drugim -
            zawijany rząd zostawiał „Akceptuj wszystkie" samo w drugiej linii,
            czyli wizualnie mocniejsze od odrzucenia. */}
        <div
          className={cn(
            "grid grid-cols-1 gap-2 border-t p-3 sm:flex sm:flex-wrap sm:items-center sm:justify-end sm:p-4",
            CB_BORDER,
            "bg-[color:var(--cb-muted,var(--muted))]/25",
          )}
        >
          {/* Odrzucenie musi być tak samo łatwe jak akceptacja - stąd ta sama
              waga wizualna co „Zapisz wybrane", nie przycisk-duch. */}
          <button
            type="button"
            className={cn(BTN_OUTLINE, BTN_MD)}
            onClick={() => {
              rejectAll();
              setDetailsOpen(false);
            }}
          >
            <X className="size-3.5" aria-hidden />
            {t.rejectAll}
          </button>
          <button
            type="button"
            className={cn(BTN_OUTLINE, BTN_MD)}
            onClick={() => {
              save(draft);
              setDetailsOpen(false);
            }}
          >
            <Check className="size-3.5" aria-hidden />
            {t.saveSelection}
          </button>
          <button
            type="button"
            className={cn(BTN_PRIMARY, BTN_MD)}
            onClick={() => {
              acceptAll();
              setDetailsOpen(false);
            }}
          >
            <Check className="size-3.5" aria-hidden />
            {t.acceptAll}
          </button>
        </div>
      </div>
    </div>
  );
}
