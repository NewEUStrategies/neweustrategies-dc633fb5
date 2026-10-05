// Powłoka banera zgód (P1.3) i wspólne klocki kompaktowej karty.
//
// PO CO. Interaktywny baner (`components/ConsentBanner.tsx`) był malowany
// 1-2,5 s po treści - na mobile 27 pp histogramu ostatniej klatki filmstripu
// (PLAN.md P1.3, werdykt LP-4). Teraz serwer wysyła STATYCZNĄ powłokę tej samej
// kompaktowej karty (ten sam komponent `ConsentCompactCard`, więc te same
// klasy, geometria, role i etykiety ARIA), a interaktywny baner zastępuje ją
// w jednym commicie dopiero po pierwszej interakcji (`__root.tsx`,
// `ConsentSurface`). Decyzję klikniętą w powłoce zapisuje skrypt inline
// `CONSENT_INIT_SCRIPT` (`lib/consent/consentInitScript.ts`) przez delegowany
// `click` na `[data-consent-shell] [data-consent-action]` - także przed bootem.
//
// GDZIE TO ŻYJE (graf chunków). `ConsentShell` renderuje WYŁĄCZNIE serwer:
// `__root.tsx` sięga po niego w gałęzi `.server()` `createIsomorphicFn`, którą
// kompilator Start wycina z bundla przeglądarki razem z importem (wzorzec
// `DesignTokensStyle`). Przeglądarka przy hydratacji zostawia HTML powłoki
// nietknięty (gniazdo z `dangerouslySetInnerHTML` = migawka tego samego węzła,
// patrz `__root.tsx`), więc ten moduł NIE jest w zamknięciu bootu - w
// przeglądarce dociąga go dopiero leniwy chunk banera, który używa stąd
// `ConsentCompactCard`, ikon i klas. Dzięki temu karta powłoki i karta banera
// mają jedno źródło markupu, a koszt bootu powłoki to zero bajtów JS.
//
// UKRYWANIE (`SHELL_HIDE_CLASSES`). Powłoka jest widoczna WYŁĄCZNIE wtedy, gdy
// skrypt inline zadziałał (`html[data-consent-js]` - bez JavaScriptu nie ma
// martwej karty), w przeglądarce nie ma decyzji (`html[data-consent-decided]`,
// ustawiany przed pierwszym malowaniem i po kliknięciu decyzji) i nie ma
// sygnału GPC (`html[data-consent-gpc]` - karta banera ma wtedy notę, której
// powłoka nie ma, więc baner wchodzi od razu po boocie). Bez `:has()` i bez
// edycji `styles.css` (Tailwind generuje reguły `html[data-consent-decided]
// .klasa{display:none}` itd.).
// `data-nosnippet`: tekst cookies stoi w HTML każdej strony, nie może trafić
// do fragmentów wyników wyszukiwania (krytyka planu m4a).
//
// IKONY. Inline SVG z danymi ścieżek lucide (te same kształty, `currentColor`,
// `aria-hidden`), bez importu `lucide-react` - powłoka nie może ciągnąć
// `vendor-lucide`, a baner przestaje go potrzebować do pierwszego montażu.
import type { CSSProperties, ReactNode, Ref } from "react";
import { useTranslation } from "react-i18next";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { localizedPath, type AppLang } from "@/lib/i18n/localePath";
import { useSiteSetting } from "@/lib/useSiteSetting";
import { useBrandMarkUrl } from "@/lib/brand/useBrandLogoUrl";
import {
  bannerLinkHref,
  bannerStyleVars,
  clampCookieBannerLogoSize,
  resolveBannerCopy,
  useCookieBannerConfig,
  type CookieBannerLink,
} from "@/lib/cookieBanner/config";
import type { ConsentShellAction } from "@/lib/consent/consentInitScript";
import { cn } from "@/lib/utils";

/**
 * Warianty ukrywania korzenia powłoki (nagłówek pliku, „UKRYWANIE"). Atrybuty
 * ustawia `CONSENT_INIT_SCRIPT` (`lib/consent/consentInitScript.ts`).
 */
const SHELL_HIDE_CLASSES =
  "[html:not([data-consent-js])_&]:hidden [html[data-consent-decided]_&]:hidden [html[data-consent-gpc]_&]:hidden";

// ---------- Ustawienia prywatności (site_settings["privacy"]) ----------

export type PrivacyConfig = { privacy_page_slug: string; cookie_banner: boolean };
/** Stały obiekt modułu - memoizacja `useSiteSetting` trzyma tożsamość. */
export const PRIVACY_DEFAULTS: PrivacyConfig = { privacy_page_slug: "", cookie_banner: true };

/** Adresy zdania o politykach w języku banera. */
export function consentPolicyHrefs(
  privacy: PrivacyConfig,
  lang: AppLang,
): { privacyHref: string | null; dataProcessingHref: string } {
  return {
    privacyHref: privacy.privacy_page_slug
      ? localizedPath(`/${privacy.privacy_page_slug.replace(/^\/+/, "")}`, lang)
      : null,
    dataProcessingHref: localizedPath("/privacy", lang),
  };
}

// ---------- Tokeny wyglądu (jedna skala dla karty i modala) ----------
// Kolory zawsze `--cb-*` (nadpisanie z panelu) z semantycznym tokenem motywu
// jako zapasem - to trzyma jasny/ciemny motyw bez drugiej palety.
//
// ALIASY KOLORÓW (P1.3, poprawka 9). Karta stoi w HTML-u KAŻDEJ strony (powłoka
// SSR), a każda klasa `text-[color:var(--cb-fg,var(--muted-foreground))]` to
// ok. 50 bajtów surowego HTML-a - powtarzane łańcuchy z zapasami były większością
// 6,3 KB powłoki (dowód P1.3, §3: `check-document-weight` czerwony). Dlatego
// pary „nadpisanie + zapas" używane wielokrotnie są zdefiniowane RAZ, jako
// krótkie zmienne na korzeniu karty i modala (`consentCardStyle`), a klasy
// czytają alias skrótem Tailwinda `text-(--cbm)`. Wartość wyliczona jest ta sama:
// zmienna z `var()` rozwiązuje się na korzeniu (tam też leżą `--cb-*`
// z `bannerStyleVars`) i dziedziczy jako wartość obliczona, a w karcie nikt
// nie nadpisuje ani `--cb-*`, ani tokenów motywu. Reguła wygenerowana przez
// Tailwinda jest tej samej postaci (`color-mix(in oklab, var(--cbm) 85%, …)`
// zamiast `color-mix(in oklab, var(--cb-fg,var(--muted-foreground)) 85%, …)`).
// Pary użyte w karcie raz (`--cb-surface`, `--cb-muted`) zostają w pełnej
// postaci - alias kosztowałby więcej, niż oszczędza.

/** Aliasy kolorów karty (nagłówek sekcji). Kolejność = kolejność w atrybucie `style`. */
const CARD_COLOR_VARS = {
  /** Akcent (przyciski główne, pierścienie fokusu, podkreślenia). */
  "--cba": "var(--cb-accent,var(--primary))",
  /** Tekst na akcencie. */
  "--cbo": "var(--cb-accent-fg,var(--primary-foreground))",
  /** Tekst karty. */
  "--cbf": "var(--cb-fg,var(--card-foreground))",
  /** Tekst przygaszony (akapit, przyciski-duchy, „X"). */
  "--cbm": "var(--cb-fg,var(--muted-foreground))",
  /** Tekst mocny (przycisk obrysowany, najechanie). */
  "--cbt": "var(--cb-fg,var(--foreground))",
  /** Obramowanie. */
  "--cbb": "var(--cb-border,var(--border))",
} as const;

/** Nazwy aliasów - test pilnuje, że każda klasa `-(--cb…)` czyta zdefiniowany alias. */
export const CARD_COLOR_VAR_NAMES = Object.keys(CARD_COLOR_VARS);

/**
 * Styl korzenia karty i modala: aliasy kolorów + zmienne `--cb-*` z panelu
 * (`bannerStyleVars`). Tokeny niżej działają WYŁĄCZNIE pod takim korzeniem.
 */
export function consentCardStyle(styleVars: CSSProperties): CSSProperties {
  return { ...CARD_COLOR_VARS, ...styleVars } as CSSProperties;
}

export const TX = {
  body: "text-[12px] leading-[1.5]",
  meta: "text-[11px] leading-[1.4]",
  heading: "text-[13px] font-semibold leading-snug",
  title: "text-[14px] sm:text-[15px] font-semibold leading-snug",
} as const;

export const CB_BORDER = "border-(--cbb)";
export const CB_SURFACE = "bg-[color:var(--cb-surface,var(--card))]";
export const CB_FG = "text-(--cbf)";
export const CB_DIM = "text-(--cbm)/85";
export const CB_ACCENT_BAR = "bg-(--cba)";

export const LINK = cn(
  "font-medium underline underline-offset-4 transition-colors",
  "text-(--cbf) decoration-(--cba)/40 hover:decoration-(--cba)",
);

const BTN_BASE = cn(
  "inline-flex items-center justify-center gap-1.5 rounded-md border text-[12px] font-medium",
  "cursor-pointer whitespace-nowrap transition-colors",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--cba)/50",
);
export const BTN_MD = "h-9 px-3.5";
export const BTN_SM = "h-8 px-2.5";

export const BTN_PRIMARY = cn(
  BTN_BASE,
  "border-transparent shadow-sm bg-(--cba) text-(--cbo) hover:bg-(--cba)/90",
);
export const BTN_OUTLINE = cn(
  BTN_BASE,
  "border-(--cbb) text-(--cbt) bg-transparent hover:bg-(--cba)/12 hover:border-(--cba)/40",
);
export const BTN_GHOST = cn(
  BTN_BASE,
  "border-transparent text-(--cbm) bg-transparent hover:bg-(--cba)/12 hover:text-(--cbt)",
);

export const ICON_BTN = cn(
  "inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors",
  "text-(--cbm) hover:bg-(--cba)/12 hover:text-(--cbt)",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--cba)/50",
);

// ---------- Ikony (inline SVG, ścieżki lucide 0.577) ----------

interface IconProps {
  className?: string;
}

// Bez `xmlns` (SVG w HTML-u dostaje przestrzeń nazw od parsera) i bez
// `width`/`height` 24 (każda ikona ma klasę rozmiaru `size-*`, która i tak
// nadpisuje atrybuty) - powłoka niesie te bajty w HTML-u każdej strony.
// Ścieżki lucide złączone w jedną `<path>` z podścieżkami `M` tam, gdzie było ich
// kilka: obrys każdej podścieżki rysuje się osobno, więc kształt jest ten sam.
const SVG_PROPS = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export function CookieIcon({ className }: IconProps) {
  return (
    <svg {...SVG_PROPS} className={className}>
      <path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5M8.5 8.5v.01M16 15.5v.01M12 12v.01M11 17v.01M7 14v.01" />
    </svg>
  );
}

export function XIcon({ className }: IconProps) {
  return (
    <svg {...SVG_PROPS} className={className}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <svg {...SVG_PROPS} className={className}>
      <path d="M14 17H5M19 7h-9" />
      <circle cx="17" cy="17" r="3" />
      <circle cx="7" cy="7" r="3" />
    </svg>
  );
}

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <svg {...SVG_PROPS} className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function ChevronUpIcon({ className }: IconProps) {
  return (
    <svg {...SVG_PROPS} className={className}>
      <path d="m18 15-6-6-6 6" />
    </svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg {...SVG_PROPS} className={className}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

// ---------- Znak marki w kaflu ikony ----------

/** Bok kafla w px (24-72), ten sam co atrybuty `width`/`height` obrazu. */
function consentMarkPx(size: number): number {
  return Math.min(72, Math.max(24, Math.round(size)));
}

/** Kafel znaku - ramka wspólna dla powłoki i banera. */
export function ConsentMarkFrame({ size, children }: { size: number; children: ReactNode }) {
  const px = consentMarkPx(size);
  return (
    <span
      aria-hidden
      style={{ width: px, height: px }}
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden rounded-lg",
        "bg-(--cba)/10 text-(--cbf) ring-1 ring-(--cba)/20",
      )}
    >
      {children}
    </span>
  );
}

/** Obraz znaku w kaflu (leniwy - poza zbiorem LCP, niski priorytet). */
export function ConsentMarkImage({
  src,
  size,
  className,
  onError,
}: {
  src: string;
  size: number;
  className?: string;
  onError?: () => void;
}) {
  const px = consentMarkPx(size);
  return (
    <img
      src={src}
      alt=""
      width={px}
      height={px}
      loading="lazy"
      decoding="async"
      className={cn("size-full object-contain p-1", className)}
      onError={onError}
    />
  );
}

/**
 * Znak powłoki. Serwer nie zna motywu (rozstrzyga go skrypt w `<head>` klasą
 * `.dark`), więc przy różnych wariantach jasnym/ciemnym oba stoją w kaflu
 * i przełącza je CSS (`dark:`). Ukryty obraz `loading="lazy"` nie jest
 * pobierany. Bez logo - ciasteczko, jak w banerze.
 */
function ConsentStaticMark({
  light,
  dark,
  size,
}: {
  light: string | null;
  dark: string | null;
  size: number;
}) {
  const variant = (src: string | null, className?: string) =>
    src ? (
      <ConsentMarkImage src={src} size={size} className={className} />
    ) : (
      <CookieIcon className={cn("size-[18px]", className)} />
    );
  return (
    <ConsentMarkFrame size={size}>
      {light === dark ? (
        variant(light)
      ) : (
        <>
          {variant(light, "dark:hidden")}
          {variant(dark, "hidden dark:block")}
        </>
      )}
    </ConsentMarkFrame>
  );
}

// ---------- Zdanie o politykach ----------

export interface ConsentPolicySentenceProps {
  privacyHref: string | null;
  dataProcessingHref: string;
  policyLabel: string;
  andLabel: string;
  dataProcessingLabel: string;
  links: readonly CookieBannerLink[] | undefined;
  lang: AppLang;
}

/** Zdanie o politykach - identyczne w karcie, w modalu i w powłoce. */
export function ConsentPolicySentence({
  privacyHref,
  dataProcessingHref,
  policyLabel,
  andLabel,
  dataProcessingLabel,
  links,
  lang,
}: ConsentPolicySentenceProps) {
  return (
    <>
      {privacyHref ? (
        <a href={privacyHref} className={LINK}>
          {policyLabel}
        </a>
      ) : (
        <span className="font-medium text-(--cbf)">{policyLabel}</span>
      )}
      {/* Jeden węzeł tekstu zamiast trzech - bez separatorów `<!-- -->` w HTML-u powłoki. */}
      {` ${andLabel} `}
      <a href={dataProcessingHref} className={LINK}>
        {dataProcessingLabel}
      </a>
      .{/* Dodatkowe odnośniki z panelu admina (np. regulamin, RODO, kontakt). */}
      {/* Adres idzie przez `bannerLinkHref`: ścieżka wewnętrzna dostaje prefiks
          języka banera (jak polityka i zasady obok), niedozwolony schemat
          wypada w całości. */}
      {(links ?? []).flatMap((l) => {
        const href = bannerLinkHref(l.url, lang);
        const label = pickLocalized(l, "label", lang);
        if (!href || !label) return [];
        return [
          <span key={l.id}>
            {" "}
            <a href={href} className={LINK}>
              {label}
            </a>
            .
          </span>,
        ];
      })}
    </>
  );
}

// ---------- Przełącznik języka ----------

/**
 * Przełącznik PL/EN. W powłoce bez `onSelect` - kliknięcie jest intencją
 * (`lang-pl`/`lang-en`), którą baner odtwarza po montażu.
 */
export function ConsentLangSwitcher({
  lang,
  onSelect,
}: {
  lang: AppLang;
  onSelect?: (lang: AppLang) => void;
}) {
  return (
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
        const active = lang === l;
        const action: ConsentShellAction = l === "pl" ? "lang-pl" : "lang-en";
        return (
          <button
            key={l}
            type="button"
            data-consent-action={action}
            onClick={onSelect ? () => onSelect(l) : undefined}
            aria-pressed={active}
            className={cn(
              "min-w-[1.75rem] cursor-pointer rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide transition-colors",
              active ? "bg-(--cba) text-(--cbo)" : "text-(--cbm)/70 hover:text-(--cbt)",
            )}
          >
            {l.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Kompaktowa karta (powłoka i baner) ----------

export interface ConsentCompactCardProps {
  title: string;
  /** Etykieta „X" - INNA niż przycisk odrzucenia (czytnik ekranu). */
  closeLabel: string;
  rejectLabel: string;
  acceptLabel: string;
  customizeLabel: string;
  /** Treść akapitu: komunikat + zdanie o politykach. */
  message: ReactNode;
  mark: ReactNode;
  styleVars: CSSProperties;
  langSwitcher?: ReactNode;
  /** Nota GPC przed przyciskami (tylko baner - sygnał zna dopiero klient). */
  gpcNotice?: ReactNode;
  prefsOpen?: boolean;
  /** Treść panelu preferencji (renderowana tylko przy `prefsOpen`). */
  prefsPanel?: ReactNode;
  prefsRef?: Ref<HTMLDivElement>;
  prefsHeight?: number;
  /** Animacja wyjścia po decyzji; POKAZANIE jest bez animacji (P0.5, F8). */
  dismissing?: boolean;
  onReject?: () => void;
  onAccept?: () => void;
  onClose?: () => void;
  onCustomize?: () => void;
  rootRef?: Ref<HTMLDivElement>;
  /** Wariant powłoki SSR: zakres delegowanego `click`, ukrywanie przed malowaniem, `data-nosnippet`. */
  shell?: boolean;
}

export function ConsentCompactCard({
  title,
  closeLabel,
  rejectLabel,
  acceptLabel,
  customizeLabel,
  message,
  mark,
  styleVars,
  langSwitcher,
  gpcNotice,
  prefsOpen = false,
  prefsPanel,
  prefsRef,
  prefsHeight = 0,
  dismissing = false,
  onReject,
  onAccept,
  onClose,
  onCustomize,
  rootRef,
  shell = false,
}: ConsentCompactCardProps) {
  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="false"
      aria-label={title}
      style={consentCardStyle(styleVars)}
      data-consent-shell={shell ? "" : undefined}
      data-nosnippet={shell ? "" : undefined}
      className={cn(
        "no-print fixed z-[60] right-3 bottom-3 left-3",
        "sm:left-auto sm:right-5 sm:bottom-5 sm:w-[380px]",
        "max-w-[calc(100vw-1.5rem)]",
        shell && SHELL_HIDE_CLASSES,
      )}
    >
      <div
        className={cn(
          "relative flex max-h-[calc(100svh-1.5rem)] flex-col gap-3 overflow-y-auto",
          "rounded-xl border p-4 shadow-2xl backdrop-blur-md",
          CB_SURFACE,
          CB_FG,
          "border-(--cbb)/70",
          // Pokazanie BEZ `animate-in` (P0.5, F8): start animacji `enter` był
          // zadaniem w śladzie, a powłoka i baner mają się podmienić niewidocznie.
          dismissing && "animate-out fade-out slide-out-to-bottom-4 fill-mode-forwards",
          "duration-300 ease-out",
        )}
      >
        <div className="flex items-center gap-3">
          {mark}
          <h2 id="consent-title" className={cn(TX.title, "min-w-0 flex-1")}>
            {title}
          </h2>
          {/* „X" = odmowa (tak jak wytyczne CNIL): zamknięcie nie może być
              łatwiejsze niż odrzucenie, więc jest po prostu odrzuceniem.
              Etykieta mówi to wprost - i jest inna niż na przycisku
              odrzucenia, żeby czytnik ekranu nie ogłaszał dwóch identycznych. */}
          <button
            type="button"
            data-consent-action="close"
            onClick={onClose}
            aria-label={closeLabel}
            title={closeLabel}
            className={cn(ICON_BTN, "-mt-1 -mr-1 self-start")}
          >
            <XIcon className="size-4" />
          </button>
        </div>

        <p className={cn(TX.body, CB_DIM)}>{message}</p>

        {/* Sygnał GPC: nota pojawia się PRZED przyciskami, bo zmienia
            znaczenie „Akceptuj wszystkie" (świadomy override sygnału). */}
        {gpcNotice}

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-consent-action="reject"
              onClick={onReject}
              className={cn(BTN_OUTLINE, BTN_MD, "flex-1")}
            >
              {rejectLabel}
            </button>
            <button
              type="button"
              data-consent-action="accept"
              onClick={onAccept}
              className={cn(BTN_PRIMARY, BTN_MD, "flex-1")}
            >
              {acceptLabel}
            </button>
          </div>

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              data-consent-action="customize"
              onClick={onCustomize}
              aria-expanded={prefsOpen}
              aria-controls="cookie-preferences-inline"
              className={cn(BTN_GHOST, BTN_SM, "-ml-1")}
            >
              <SettingsIcon className="size-3.5" />
              {customizeLabel}
              {prefsOpen ? (
                <ChevronUpIcon className="size-3.5" />
              ) : (
                <ChevronDownIcon className="size-3.5" />
              )}
            </button>
            {langSwitcher}
          </div>
        </div>

        <div
          id="cookie-preferences-inline"
          ref={prefsRef}
          style={{ height: prefsHeight ? `${prefsHeight}px` : 0 }}
          className="overflow-hidden transition-[height] duration-300 ease-out will-change-[height] motion-reduce:transition-none"
        >
          {prefsOpen ? prefsPanel : null}
        </div>
      </div>
    </div>
  );
}

// ---------- Powłoka SSR ----------

/**
 * Statyczna powłoka kompaktowej karty - WYŁĄCZNIE render serwera (patrz
 * nagłówek pliku). Teksty z odwodnionych ustawień (`cookie_banner_config`,
 * `privacy`, `theme_options` - mapa `site_settings` z loadera korzenia) i ze
 * słownika i18n; bez stanu, bez efektów, bez handlerów. Ten sam warunek
 * widoczności co baner: `privacy.cookie_banner && banner.enabled`.
 */
export function ConsentShell() {
  const { i18n, t: tr } = useTranslation();
  const lang = uiLang(i18n.language);
  const privacy = useSiteSetting<PrivacyConfig>("privacy", PRIVACY_DEFAULTS);
  const banner = useCookieBannerConfig();
  const markLight = useBrandMarkUrl("light");
  const markDark = useBrandMarkUrl("dark");
  if (!privacy.cookie_banner || !banner.enabled) return null;

  const t = resolveBannerCopy(banner.copy?.[lang], lang);
  const { privacyHref, dataProcessingHref } = consentPolicyHrefs(privacy, lang);
  return (
    <ConsentCompactCard
      shell
      title={t.title}
      closeLabel={`${tr("common.close")} (${t.rejectAll})`}
      rejectLabel={t.rejectAll}
      acceptLabel={t.acceptAll}
      customizeLabel={t.customize}
      styleVars={bannerStyleVars(banner.colors)}
      mark={
        <ConsentStaticMark
          light={banner.logo.light || markLight}
          dark={banner.logo.dark || banner.logo.light || markDark}
          size={clampCookieBannerLogoSize(banner.logo.size)}
        />
      }
      message={
        <>
          {`${t.compactMessage} `}
          <ConsentPolicySentence
            privacyHref={privacyHref}
            dataProcessingHref={dataProcessingHref}
            policyLabel={t.policyLabel}
            andLabel={tr("common.and")}
            dataProcessingLabel={tr("common.dataProcessingTerms")}
            links={banner.links}
            lang={lang}
          />
        </>
      }
      langSwitcher={banner.languageSwitcher ? <ConsentLangSwitcher lang={lang} /> : null}
    />
  );
}
