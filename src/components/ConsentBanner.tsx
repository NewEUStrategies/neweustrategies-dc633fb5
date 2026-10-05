// Cookie banner: compact floating consent card (bottom-right) with inline
// preferences, plus a full details modal carrying the per-category vendor
// tables. Copy and colors come from site_settings via useCookieBannerConfig();
// every color resolves through --cb-* custom properties with semantic-token
// fallbacks, so light and dark themes are covered without a second palette.
// Consent state persists in localStorage + cookie and (when signed-in) syncs to
// profiles.prefs.consent - refresh is automatic because useConsent() re-reads
// on the consent-change event.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { useTranslation } from "react-i18next";
import { GpcCategoryBadgeSlot, GpcNoticeSlot } from "@/components/consent/GpcSurfaceSlots";
import {
  BTN_GHOST,
  BTN_MD,
  BTN_OUTLINE,
  BTN_PRIMARY,
  BTN_SM,
  CB_ACCENT_BAR,
  CB_BORDER,
  CB_DIM,
  CB_FG,
  CB_SURFACE,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ConsentCompactCard,
  ConsentLangSwitcher,
  ConsentMarkFrame,
  ConsentMarkImage,
  ConsentPolicySentence,
  consentCardStyle,
  consentPolicyHrefs,
  CookieIcon,
  ICON_BTN,
  PRIVACY_DEFAULTS,
  TX,
  XIcon,
  type PrivacyConfig,
} from "@/components/consent/ConsentShell";
import { useTheme } from "@/components/ThemeProvider";
import {
  useConsent,
  useGpcSignal,
  OPEN_PREFS_EVENT,
  consumeOpenPrefsRequest,
  type ConsentCategory,
} from "@/lib/ads/consent";
import type { ConsentShellAction } from "@/lib/consent/consentInitScript";
import { isGpcClampedCategory, isGpcOverrideValid } from "@/lib/consent/gpc";
import { useFocusTrap } from "@/lib/a11y/useFocusTrap";
import { useBrandMarkUrl } from "@/lib/brand/useBrandLogoUrl";
import { reportConsentSurface, setConsentOverlayVisible } from "@/lib/overlayCoordinator";
import { useSiteSetting } from "@/lib/useSiteSetting";
import {
  useCookieBannerConfig,
  bannerStyleVars,
  resolveBannerCopy,
  clampCookieBannerLogoSize,
  type CookieBannerCopy,
  type CookieBannerConfig,
} from "@/lib/cookieBanner/config";
import {
  detectCollectedElements,
  REGISTRY_BY_CATEGORY,
  type DataElement,
} from "@/lib/cookieBanner/registry";
import { cn } from "@/lib/utils";

type Cats = Record<ConsentCategory, boolean>;

type Vendor = DataElement;

const CATEGORY_ORDER: ConsentCategory[] = ["necessary", "functional", "analytics", "marketing"];

// Exit animation length for the compact card - the decision is written first,
// the card only lingers long enough to slide out. Keep in sync with the
// `duration-300` utility on the card itself.
const EXIT_MS = 300;

// Tokeny wyglądu (TX, CB_*, BTN_*, ICON_BTN, LINK), ikony i kompaktowa karta
// żyją w `components/consent/ConsentShell.tsx` - TEN SAM markup renderuje
// powłoka SSR (P1.3), więc karta powłoki i karta banera nie mogą się rozjechać.

/**
 * Znak marki w kaflu ikony. Gdy logo nie jest skonfigurowane (albo plik nie
 * wstaje), zostaje ciasteczko - baner nigdy nie pokazuje pustej ramki.
 */
function ConsentMark({ src, size = 36 }: { src: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const showLogo = !!src && !failed;
  return (
    <ConsentMarkFrame size={size}>
      {showLogo ? (
        <ConsentMarkImage src={src} size={size} onError={() => setFailed(true)} />
      ) : (
        <CookieIcon className="size-[18px]" />
      )}
    </ConsentMarkFrame>
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
          {checked && <CheckIcon className="size-3.5" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className={TX.heading}>{name}</p>
            {locked && (
              <span className="rounded bg-[color:var(--cb-accent,var(--primary))]/12 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[color:var(--cb-fg,var(--card-foreground))]">
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

/**
 * Przejęcie powłoki SSR (P1.3): baner montowany po interakcji w miejsce
 * `ConsentShell` (`__root.tsx`, `ConsentSurface`). Nigdy nie renderuje się na
 * serwerze ani w hydratacji, więc od PIERWSZEGO renderu pokazuje kartę (bez
 * przebiegu `mounted === false`, który dałby klatkę bez karty) i podmienia
 * powłokę w jednym commicie.
 */
export interface ConsentBannerTakeover {
  /** Intencja kliknięta w powłoce (`customize`, `lang-pl`, `lang-en`) - odtwarzana po montażu. */
  intent: ConsentShellAction | null;
  /** Akcja kontrolki powłoki, która miała fokus - fokus przechodzi na tę samą kontrolkę banera. */
  focus: ConsentShellAction | null;
}

export interface ConsentBannerProps {
  /**
   * Podgląd w adminie: niezapisany szkic konfiguracji zamiast wartości z bazy.
   */
  configOverride?: CookieBannerConfig;
  /** Podgląd wymusza motyw kafla logo (jasny/ciemny) niezależnie od strony. */
  themeOverride?: "light" | "dark";
  /** Montaż w miejsce powłoki SSR (patrz `ConsentBannerTakeover`). */
  takeover?: ConsentBannerTakeover;
  /**
   * Wołane po commicie montażu (efekt warstwy) - korzeń rozstrzyga nim promise
   * zadania kolejki P0.3 (KONTRAKT ZADANIA: „P1.3 - po montażu banera").
   */
  onReady?: () => void;
}

export function ConsentBanner({
  configOverride,
  themeOverride,
  takeover,
  onReady,
}: ConsentBannerProps = {}) {
  const { i18n, t: tr } = useTranslation();
  // Kod języka bierzemy z kanonicznego `uiLang` - ta sama normalizacja co
  // w `formatDate`/`uiLocale`, zamiast własnego `startsWith` w komponencie.
  const uiLanguage = uiLang(i18n.language);
  const privacy = useSiteSetting<PrivacyConfig>("privacy", PRIVACY_DEFAULTS);
  const saved = useCookieBannerConfig();
  const banner = configOverride ?? saved;
  // Puste pole treści z panelu wraca do brzmienia domyślnego - patrz
  // `resolveBannerCopy` (panel pokazuje to brzmienie jako podpowiedź).
  const t: CookieBannerCopy = resolveBannerCopy(banner.copy?.[uiLanguage], uiLanguage);
  const { theme } = useTheme();
  const effectiveTheme = themeOverride ?? (theme === "dark" ? "dark" : "light");
  const brandMark = useBrandMarkUrl(effectiveTheme);
  const logoSrc =
    (effectiveTheme === "dark" ? banner.logo.dark || banner.logo.light : banner.logo.light) ||
    brandMark;
  const logoSize = clampCookieBannerLogoSize(banner.logo.size);

  // Deklaracja elementów: rejestr + realnie wykryte klucze przeglądarki.
  // Skan biegnie po stronie klienta, dopiero gdy użytkownik otworzy szczegóły.
  const [inventory, setInventory] = useState<Record<ConsentCategory, DataElement[]>>(
    () => REGISTRY_BY_CATEGORY,
  );

  const { privacyHref, dataProcessingHref } = consentPolicyHrefs(privacy, uiLanguage);

  const consent = useConsent();
  const { state, save, acceptAll, rejectAll } = consent;
  // Przejęcie powłoki: komponent żyje wyłącznie w przeglądarce, więc „zamontowany"
  // jest od pierwszego renderu, a decyzja to po prostu stan z magazynu.
  const mounted = consent.mounted || !!takeover;
  const decided = takeover ? !!state : consent.decided;
  // Sygnał GPC: `gpcActive` steruje widocznością noty (użytkownik musi wiedzieć,
  // że sygnał został zauważony - także gdy sam go nadpisał), `gpcHonored` steruje
  // klamrą na przełącznikach.
  const gpc = useGpcSignal(!!takeover);
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

  // Skan uruchamiamy dopiero przy otwarciu szczegółów - baner kompaktowy nie
  // dotyka wtedy storage'u i nie płaci za to na starcie strony.
  useEffect(() => {
    if (!detailsOpen || !banner.autoInventory) return;
    setInventory(detectCollectedElements().byCategory);
  }, [detailsOpen, banner.autoInventory]);

  useEffect(() => {
    setDraft({
      necessary: true,
      functional: state?.categories.functional ?? false,
      analytics: (state?.categories.analytics ?? false) && !gpcHonored,
      marketing: (state?.categories.marketing ?? false) && !gpcHonored,
    });
  }, [state, gpcHonored]);

  useEffect(() => {
    const open = () => {
      // Konsumpcja także na drodze zdarzeniowej: odłożone żądanie nie może
      // otworzyć panelu drugi raz przy ponownym montażu baneru.
      consumeOpenPrefsRequest();
      setDetailsOpen(true);
    };
    window.addEventListener(OPEN_PREFS_EVENT, open);
    // Klik sprzed pobrania chunku (baner jest React.lazy w __root): żądanie
    // czeka w stanie modułu consent.ts - odtwórz je zaraz po montażu.
    if (consumeOpenPrefsRequest()) setDetailsOpen(true);
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
  }, [prefsOpen, uiLanguage, gpcHonored, draft, t]);

  // PRZEJĘCIE POWŁOKI (P1.3). Efekt warstwy, czyli w tym samym commicie, w którym
  // baner zastąpił powłokę - przed malowaniem: intencja kliknięta w powłoce
  // (`customize` rozwija panel, `lang-*` przełącza język) i fokus na tej samej
  // kontrolce, którą miał w powłoce (klawiatura nie gubi miejsca, krytyka m4b).
  // `onReady` rozstrzyga promise zadania kolejki P0.3 („po montażu banera").
  const cardRef = useRef<HTMLDivElement>(null);
  const handoff = useRef({ takeover, onReady, i18n, uiLanguage });
  useLayoutEffect(() => {
    const { takeover: shell, onReady: ready, i18n: lang, uiLanguage: current } = handoff.current;
    if (shell?.intent === "customize") setPrefsOpen(true);
    const wanted =
      shell?.intent === "lang-pl" ? "pl" : shell?.intent === "lang-en" ? "en" : current;
    if (wanted !== current) void lang.changeLanguage(wanted);
    if (shell?.focus) {
      cardRef.current
        ?.querySelector<HTMLElement>(`[data-consent-action="${shell.focus}"]`)
        ?.focus();
    }
    ready?.();
  }, []);

  const consentSurfaceVisible = mounted && (!decided || detailsOpen || dismissing);
  useEffect(() => {
    if (!mounted) return;
    // Close the gate before applying consent; publish the decision before
    // opening it again (`reportConsentSurface`). Effect cleanup must not pump
    // a queue using the OLD consent while React is committing a rejection.
    reportConsentSurface(
      consentSurfaceVisible,
      state ? state.categories.marketing && !gpcHonored : null,
    );
  }, [mounted, consentSurfaceVisible, state, gpcHonored]);

  useEffect(() => () => setConsentOverlayVisible(false), []);

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
    if (l !== uiLanguage) void i18n.changeLanguage(l);
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

  const langSwitcher = banner.languageSwitcher ? (
    <ConsentLangSwitcher lang={uiLanguage} onSelect={setLang} />
  ) : null;

  // Zdanie o politykach - identyczne w karcie, w modalu i w powłoce SSR.
  const policySentence = (
    <ConsentPolicySentence
      privacyHref={privacyHref}
      dataProcessingHref={dataProcessingHref}
      policyLabel={t.policyLabel}
      andLabel={tr("common.and")}
      dataProcessingLabel={tr("common.dataProcessingTerms")}
      links={banner.links}
      lang={uiLanguage}
    />
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
  // Markup wspólny z powłoką SSR (`ConsentCompactCard`), więc podmiana powłoki
  // na baner nie zmienia ani piksela, ani drzewa dostępności.
  if (!detailsOpen) {
    return (
      <ConsentCompactCard
        rootRef={cardRef}
        title={t.title}
        closeLabel={closeLabel}
        rejectLabel={t.rejectAll}
        acceptLabel={t.acceptAll}
        customizeLabel={t.customize}
        styleVars={styleVars}
        mark={<ConsentMark src={logoSrc} size={logoSize} />}
        message={
          <>
            {`${t.compactMessage} `}
            {policySentence}
          </>
        }
        gpcNotice={
          <GpcNoticeSlot
            active={gpc.active}
            source={gpc.source}
            overridden={gpcOverridden}
            onRestore={restoreGpc}
            variant="compact"
          />
        }
        langSwitcher={langSwitcher}
        dismissing={dismissing}
        onClose={() => decide(() => rejectAll())}
        onReject={() => decide(() => rejectAll())}
        onAccept={() => decide(() => acceptAll())}
        onCustomize={() => setPrefsOpen((p) => !p)}
        prefsOpen={prefsOpen}
        prefsRef={prefsRef}
        prefsHeight={prefsHeight}
        prefsPanel={
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
                  <CheckIcon className="size-3.5" />
                  {t.saveSelection}
                </button>
              </div>
            </div>
          </div>
        }
      />
    );
  }

  // ---------- Details modal with per-category vendor tables ----------
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-title"
      style={consentCardStyle(styleVars)}
      className="no-print fixed inset-0 z-[80] flex items-end justify-center bg-foreground/60 p-3 backdrop-blur-sm animate-in fade-in sm:items-center"
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
            <ConsentMark src={logoSrc} size={logoSize} />
            <h2 id="consent-title" className={cn(TX.title, "min-w-0 flex-1")}>
              {t.title}
            </h2>
            <div className="flex shrink-0 items-center gap-1.5 self-start">
              {langSwitcher}
              <button
                type="button"
                onClick={() => setDetailsOpen(false)}
                aria-label={decided ? tr("common.close") : t.hideDetails}
                title={decided ? tr("common.close") : t.hideDetails}
                className={cn(ICON_BTN, "-mt-1 -mr-1")}
              >
                <XIcon className="size-4" />
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
            const vendors: Vendor[] = inventory[cat] ?? [];
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
                    <ChevronUpIcon className="size-3.5" />
                  ) : (
                    <ChevronDownIcon className="size-3.5" />
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
                            <tr key={`${v.kind}:${v.name}`} className="align-top">
                              <td className="max-w-[10rem] break-words whitespace-normal px-3 py-2 font-mono text-[color:var(--cb-fg,var(--card-foreground))]">
                                {v.name}
                                {v.auto && (
                                  <span className="ml-1 rounded bg-[color:var(--cb-accent,var(--primary))]/12 px-1 py-0.5 font-sans text-[9px] uppercase">
                                    {"auto"}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2">{pickLocalized(v, "party", uiLanguage)}</td>
                              <td className={cn("px-3 py-2", CB_DIM)}>
                                {pickLocalized(v, "purpose", uiLanguage)}
                              </td>
                              <td className={cn("px-3 py-2 whitespace-nowrap", CB_DIM)}>
                                {pickLocalized(v, "ttl", uiLanguage)}
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
            <XIcon className="size-3.5" />
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
            <CheckIcon className="size-3.5" />
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
            <CheckIcon className="size-3.5" />
            {t.acceptAll}
          </button>
        </div>
      </div>
    </div>
  );
}
