import { buildAvatarSrc, buildAvatarSrcSet } from "@/lib/cropSizes";
// Header "Na czasie / Trending" - compact bar of posts.
// Sources: trending | latest | pinned | selected | mixed.
// Modes: scroll (marquee) | fade | slide | flip | typewriter.
// Colors and label overridable per light/dark via CSS custom properties.
import { memo, useEffect, useId, useRef, useState } from "react";
import { useIsomorphicLayoutEffect } from "@/lib/react/useIsomorphicLayoutEffect";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Flame } from "lucide-react";
import {
  headerTickerQueryOptions,
  type TickerMode,
  type TickerSource,
} from "@/lib/views/headerTickerQuery";
import {
  DEFAULT_TICKER_COLORS,
  type IconAnimation,
  type LayoutStyle,
  type LiveDirection,
  type MixedFill,
  type TickerColorScheme,
} from "@/lib/views/tickerVariants";
import { AppLink } from "@/components/atoms/AppLink";
import {
  tickerBandGeometry,
  tickerCardRows,
  tickerPerView,
  type TickerGlassSkin,
} from "@/components/header/headerGeometry";
import { prefersReducedMotion } from "@/lib/a11y/reducedMotion";
import { StyleSink } from "@/components/theme/StyleSink";
import { useMotionGate } from "@/lib/performance/motionGate";

export type { TickerMode };

export interface TickerProps {
  source?: TickerSource;
  mode?: TickerMode;
  layoutStyle?: LayoutStyle;
  days?: number;
  limit?: number;
  visibleCount?: number;
  intervalSec?: number;
  /** Horizontal marquee layouts: scroll speed in px/s. */
  scrollSpeed?: number;
  /** `glassLive`: pionowy slide (domyślnie) albo poziomy marquee. */
  liveDirection?: LiveDirection;
  pinnedPostId?: string;
  pinnedUntil?: string | null;
  selectedPostIds?: string[];
  mixedFill?: MixedFill;
  labelPl?: string;
  labelEn?: string;
  iconAnimation?: IconAnimation;
  colors?: TickerColorScheme;
  fullWidth?: boolean;
  variantId?: string;
  className?: string;
}

/**
 * Tryb `rotate` to nazwa historyczna (zapisana w ustawieniach tenantów), która
 * oznacza dokładnie to samo, co `slide`. Eksport, bo to mapowanie jest jedyną
 * rzeczą stojącą między starą konfiguracją a pustym paskiem.
 */
export function normalizeMode(
  mode: TickerMode,
): "scroll" | "fade" | "slide" | "flip" | "typewriter" {
  if (mode === "rotate") return "slide";
  return mode;
}

/**
 * Bezpieczny fragment selektora atrybutu dla identyfikatora wariantu.
 * Identyfikator pochodzi z ustawień i ląduje w selektorze CSS wstrzykiwanym
 * przez `dangerouslySetInnerHTML` - stąd biała lista znaków, a nie ucieczka.
 */
export function safeAttr(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_") || "default";
}

/*
 * RUCH PASKA (P2.3 F10, P3.5). Cały ruch paska - ozdobny i treści - stoi do
 * otwarcia wspólnej bramki ruchu (`motionGate.ts`: pierwsza interakcja albo
 * punkt ciszy strony):
 *  a/b. porcje wpisów silnika pasma (`fade`/`slide`/`flip`/`typewriter`) -
 *       timer zakłada się dopiero po otwarciu, więc pierwsza zmiana porcji =
 *       otwarcie + pełne `intervalSec`;
 *  c/d. marquee i karty szklane - nieskończona animacja inline jest w HTML z
 *       SSR, więc tor nosi `data-motion-loop` (pauza z `styles.css` od
 *       pierwszego malowania do `data-motion="on"` na `<html>`); to samo
 *       mrugający kursor `typewriter`;
 *  e.   ruch OZDOBNY (płomień etykiety, pulsowanie skórki `live`, przesuw
 *       gradientu `ribbon`) - atrybut `data-tt-motion` na korzeniu paska
 *       włącza go w `TICKER_CSS`; zostaje jako alias bramki, bo podnosi
 *       specyficzność reguł, które wyłącza ostatni blok reduced motion.
 * Start animacji CSS przy ładowaniu to osobne zadanie głównego wątku (K8 w
 * księdze P0.5), a każda zmiana porcji w kadrze odsuwa Speed Index - bez
 * korzyści dla czytelnika, który jeszcze niczego nie dotknął. Serwer i render
 * hydratacji dają `false`: atrybutów bramki nie ma w HTML-u.
 */

export function TrendingTicker({
  source = "trending",
  mode = "scroll",
  layoutStyle = "classic",
  days = 7,
  limit = 8,
  visibleCount = 1,
  intervalSec = 6,
  scrollSpeed = 60,
  liveDirection = "vertical",
  pinnedPostId,
  pinnedUntil,
  selectedPostIds,
  mixedFill = "trending",
  labelPl,
  labelEn,
  iconAnimation = "none",
  colors,
  fullWidth = true,
  variantId = "default",
  className,
}: TickerProps) {
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const kind = normalizeMode(mode);
  const palette = colors ?? DEFAULT_TICKER_COLORS;
  const vid = safeAttr(variantId);
  const isBadge = layoutStyle === "badge";
  const motion = useMotionGate();
  const motionAttr = motion ? "" : undefined;

  const { data, isLoading } = useQuery(
    headerTickerQueryOptions({
      source,
      days,
      limit,
      pinnedPostId,
      pinnedUntil,
      selectedPostIds,
      mixedFill,
    }),
  );

  const posts = data ?? [];
  const perView = tickerPerView(visibleCount);
  const totalBatches = kind === "scroll" ? 1 : Math.max(1, Math.ceil(posts.length / perView));

  const [batch, setBatch] = useState(0);
  useEffect(() => {
    if (!motion || kind === "scroll" || totalBatches < 2) return;
    const ms = Math.max(2, intervalSec) * 1000;
    const t = window.setInterval(() => setBatch((b) => (b + 1) % totalBatches), ms);
    return () => window.clearInterval(t);
  }, [motion, kind, intervalSec, totalBatches]);

  // REZERWA W HTML Z SERWERA. Pasek stoi NAD całą stroną, a montuje się dopiero
  // z danymi - dopóki zwracał tu `null`, jego ~40 px doskakiwało po hydratacji
  // i spychało `<main>` w dół (0,03 CLS na artefakcie produkcyjnym, fixture
  // `first-visit`). Dopóki zapytanie nie wróciło, trzymamy więc JEGO pudełko:
  // ta sama ramka, ta sama klasa wysokości DANEJ SKÓRKI, zero treści. Pusty
  // wynik zwija pasek tak jak dotąd - wtedy nie ma czego trzymać, a
  // `HeaderSkeleton` czyta ten sam wpis cache'a i też pasa nie rezerwuje.
  if (isLoading)
    return (
      <TickerHeightReserve
        className={className}
        layoutStyle={layoutStyle}
        liveDirection={liveDirection}
        rows={tickerCardRows(perView)}
      />
    );
  if (!posts.length) return null;

  // Ramka, silnik i klasa wysokości z JEDNEGO mapowania (`headerGeometry`) -
  // tego samego, z którego składają się rezerwa i pas szkieletu nagłówka.
  const rows = tickerCardRows(perView, posts.length);
  const geometry = tickerBandGeometry(layoutStyle, { liveDirection, rows });

  const defaultLabel = t("trendingTicker.badge");
  const label =
    lang === "en"
      ? (labelEn && labelEn.trim()) || (labelPl && labelPl.trim()) || defaultLabel
      : (labelPl && labelPl.trim()) || (labelEn && labelEn.trim()) || defaultLabel;
  const innerMax = fullWidth ? "max-w-none" : "max-w-[1400px] mx-auto";

  const currentBatch =
    kind === "scroll" ? posts : posts.slice(batch * perView, batch * perView + perView);

  const iconClass = `tt-flame tt-flame-${iconAnimation}`;

  if (geometry.engine !== "band") {
    const skin = geometry.skin ?? "marquee";
    return (
      <div
        className={`${geometry.frameClass} ${className ?? ""}`}
        data-testid="trending-ticker"
        data-tt-vid={vid}
        data-tt-layout={layoutStyle}
        data-tt-motion={motionAttr}
        style={{ background: "var(--tt-bg)", borderColor: "var(--tt-border)" }}
      >
        <TickerPaletteStyle vid={vid} palette={palette} />
        <div className={`${innerMax} px-4 lg:px-8`}>
          {geometry.engine === "cards" ? (
            <TickerGlassCards
              label={label}
              posts={posts}
              lang={lang}
              intervalSec={intervalSec}
              scrollSpeed={scrollSpeed}
              perView={perView}
              rows={rows}
              bandClass={geometry.bandClass}
              iconClass={iconClass}
              skin={skin}
            />
          ) : (
            <TickerGlassMarquee
              label={label}
              posts={posts}
              lang={lang}
              intervalSec={intervalSec}
              scrollSpeed={scrollSpeed}
              perView={perView}
              bandClass={geometry.bandClass}
              iconClass={iconClass}
              skin={skin}
            />
          )}
        </div>
        <TickerStyles />
      </div>
    );
  }

  return (
    <div
      className={`${geometry.frameClass} ${className ?? ""}`}
      data-testid="trending-ticker"
      data-tt-vid={vid}
      data-tt-layout={layoutStyle}
      data-tt-motion={motionAttr}
      style={{
        background: "var(--tt-bg)",
        borderColor: "var(--tt-border)",
      }}
    >
      <TickerPaletteStyle vid={vid} palette={palette} />
      <div
        data-tt-band=""
        className={`${innerMax} ${isBadge ? "pr-4 lg:pr-8 pl-0" : "px-4 lg:px-8"} ${geometry.bandClass} flex items-stretch gap-0 overflow-hidden`}
      >
        {isBadge ? (
          <span
            className="inline-flex items-center h-10 px-2 sm:px-4 text-[12px] leading-none font-bold uppercase tracking-[0.14em] shrink-0 whitespace-nowrap mr-4"
            style={{
              background: "var(--tt-label-bg)",
              color: "var(--tt-label-fg)",
            }}
          >
            <Flame
              className={`w-4 h-4 shrink-0 ${iconClass}`}
              style={{ color: "var(--tt-label-fg)" }}
              aria-hidden
            />
            <span className="hidden sm:inline leading-none">{label}</span>
          </span>
        ) : (
          <>
            <span
              className="inline-flex items-center h-10 gap-1.5 text-[12px] leading-none font-bold uppercase tracking-[0.14em] shrink-0 whitespace-nowrap mr-4"
              style={{ color: "var(--tt-label)" }}
            >
              <Flame
                className={`w-4 h-4 shrink-0 ${iconClass}`}
                style={{ color: "var(--tt-label)" }}
                aria-hidden
              />
              <span className="hidden sm:inline leading-none">{label}</span>
            </span>
            <span
              className="hidden sm:block self-center h-4 w-px shrink-0 mr-4"
              aria-hidden
              style={{ background: "var(--tt-border)" }}
            />
          </>
        )}
        <div
          className={`flex-1 min-w-0 flex items-center gap-6 ${
            kind === "scroll" ? "overflow-x-auto scrollbar-none" : "overflow-hidden"
          }`}
          style={{ scrollbarWidth: "none" }}
        >
          {kind === "scroll" ? (
            currentBatch.map((p, i) => (
              <div key={`${p.id}-${i}`} className="inline-flex items-center gap-6 shrink-0">
                <TickerItem
                  post={p}
                  index={i}
                  lang={lang}
                  animation="none"
                  showCounter={!isBadge}
                />
                {isBadge && i < currentBatch.length - 1 && (
                  <span
                    className="tt-dot inline-block w-1 h-1 rounded-full shrink-0"
                    style={{ background: "var(--tt-dot)" }}
                    aria-hidden
                  />
                )}
              </div>
            ))
          ) : (
            <div className="flex-1 min-w-0 flex items-center gap-6" key={`batch-${batch}`}>
              {currentBatch.map((p, i) => (
                <div
                  key={`${p.id}-${batch}-${i}`}
                  className="inline-flex items-center gap-6 shrink-0"
                >
                  <TickerItem
                    post={p}
                    index={batch * perView + i}
                    lang={lang}
                    animation={kind}
                    delayMs={i * 90}
                    showCounter={!isBadge}
                  />
                  {isBadge && i < currentBatch.length - 1 && (
                    <span
                      className="tt-dot inline-block w-1 h-1 rounded-full shrink-0"
                      style={{ background: "var(--tt-dot)" }}
                      aria-hidden
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <TickerStyles />
    </div>
  );
}

/**
 * Puste pudełko paska „na czasie" na czas ładowania jego danych.
 *
 * Renderuje DOKŁADNIE tę samą ramkę (`cms-trending` + dolna krawędź) i tę samą
 * klasę wysokości, co pasek AKTYWNEJ SKÓRKI (`tickerBandGeometry`), więc
 * podmiana rezerwy na treść nie zmienia wysokości nagłówka ani o piksel - także
 * dla skórek szklanych, które są wyższe od klasycznej. `--hdr-tt` (pomiar w
 * `Header.tsx`) trafia wtedy od razu na właściwą liczbę; przy rezerwie
 * klasycznej pod skórką szklaną pomiar zamykał prawdziwy pasek w za niskim
 * pudełku (`styles.css` narzuca `.cms-trending` wysokość z `--hdr-tt`).
 *
 * Jedyna niewiadoma to liczba wpisów: pionowa rotacja ma tyle wierszy, ile
 * wpisów, ale nie więcej niż `visibleCount` - bez danych rezerwa zakłada pełne
 * okno (`rows` od wołającego).
 */
export function TickerHeightReserve({
  className,
  layoutStyle = "classic",
  liveDirection = "vertical",
  rows = 1,
}: {
  className?: string;
  layoutStyle?: LayoutStyle;
  liveDirection?: LiveDirection;
  rows?: number;
}) {
  const geometry = tickerBandGeometry(layoutStyle, { liveDirection, rows });
  return (
    <div
      className={`${geometry.frameClass} ${className ?? ""}`}
      data-testid="trending-ticker-reserve"
      data-tt-layout={layoutStyle}
      aria-hidden
      style={{ background: "var(--tt-bg)", borderColor: "var(--tt-border)" }}
    >
      <div data-tt-band="" className={`${geometry.bandClass} w-full`} />
    </div>
  );
}

interface TickerItemProps {
  post: {
    id: string;
    slug?: string;
    href?: string;
    title_pl: string | null;
    title_en: string | null;
    author_display_name?: string | null;
    author_avatar_url?: string | null;
  };
  index: number;
  lang: "pl" | "en";
  animation: "none" | "fade" | "slide" | "flip" | "typewriter";
  delayMs?: number;
  showCounter?: boolean;
}

function TickerItem({
  post,
  index,
  lang,
  animation,
  delayMs = 0,
  showCounter = true,
}: TickerItemProps) {
  const title =
    lang === "en" ? post.title_en || post.title_pl || "" : post.title_pl || post.title_en || "";
  const displayIdx = index + 1;
  const cls =
    animation === "fade"
      ? "tt-anim-fade"
      : animation === "slide"
        ? "tt-anim-slide"
        : animation === "flip"
          ? "tt-anim-flip"
          : "";
  const href = post.href ?? (post.slug ? `/post/${post.slug}` : "#");

  return (
    <AppLink
      href={href}
      className={`tt-item group inline-flex items-center gap-2 h-10 text-[13px] leading-none whitespace-nowrap transition shrink-0 ${cls}`}
      style={{ animationDelay: `${delayMs}ms`, color: "var(--tt-item)" }}
      title={title}
    >
      {showCounter && (
        <span
          className="hidden sm:inline text-[12px] leading-none font-bold tabular-nums"
          style={{ color: "var(--tt-counter)" }}
        >
          {String(displayIdx).padStart(2, "0")}
        </span>
      )}
      {animation === "typewriter" ? (
        // `key` = tytuł: nowy tytuł montuje pisanie od zera. Bez tego pierwszy
        // commit po zmianie pokazywał NOWY tekst ucięty do STAREJ długości
        // (zerowanie licznika dzieje się dopiero w efekcie po commicie).
        <TypewriterText key={title} text={title} delayMs={delayMs} />
      ) : (
        <span className="font-medium truncate max-w-[220px] sm:max-w-none sm:whitespace-nowrap leading-none">
          {title}
        </span>
      )}
    </AppLink>
  );
}

/** Odstęp między kolejnymi znakami trybu `typewriter` (ms). */
export const TYPEWRITER_STEP_MS = 22;

/**
 * Tytuł wypisywany znak po znaku: opóźnienie `delayMs`, potem jeden znak co
 * `TYPEWRITER_STEP_MS`.
 *
 * DLACZEGO OBA UCHWYTY W DOMKNIĘCIU EFEKTU. Do 2026-10-03 identyfikator
 * interwału był doklejany jako właściwość do uchwytu `setTimeout`
 * (`start._iv = iv`) i stamtąd czytany w sprzątaniu. W przeglądarce
 * `window.setTimeout` zwraca LICZBĘ, a moduł ES działa w trybie ścisłym, więc
 * przypisanie rzucało `TypeError` w callbacku timera - już PO utworzeniu
 * interwału. Interwał był wtedy nieosiągalny dla sprzątania: tykał po
 * odmontowaniu i po zmianie tytułu (setState na martwym komponencie, dwa
 * interwały piszące jeden licznik), a każdy wpis zgłaszał nieobsłużony błąd.
 * W Node uchwyt jest obiektem, więc testy niczego nie widziały. Zmienne
 * lokalne efektu działają tak samo dla obu kształtów uchwytu.
 *
 * `prefers-reduced-motion`: pełny tytuł od razu i zero timerów - czytane
 * w efekcie, nie w renderze (patrz `lib/a11y/reducedMotion`).
 *
 * BRAMKA RUCHU (P3.5). Tytuł zamontowany przed otwarciem bramki - w tym
 * pierwsza porcja z HTML-a serwera i z renderu hydratacji - stoi w CAŁOŚCI
 * od pierwszego malowania i nie pisze się wcale (także po otwarciu): pisanie
 * po hydratacji było zmianą wizualną w oknie śladu Lighthouse'a. Piszą się
 * wyłącznie tytuły montowane po otwarciu, czyli kolejne porcje (timer porcji
 * startuje dopiero po otwarciu, a `key` = tytuł montuje każdy tytuł od nowa).
 */
export function TypewriterText({ text, delayMs }: { text: string; delayMs: number }) {
  const motion = useMotionGate();
  // Stan z PIERWSZEGO renderu: `false` na serwerze i w hydratacji
  // (`getServerSnapshot`), `true` dla montażu po otwarciu.
  const [types] = useState(motion);
  const [n, setN] = useState(types ? 0 : text.length);
  useEffect(() => {
    // Pusty tytuł nie ma czego wypisywać, ograniczony ruch nie chce animacji
    // w ogóle, a tytuł sprzed otwarcia bramki stoi - stan końcowy od razu i
    // żadnego timera.
    if (!types || text.length === 0 || prefersReducedMotion()) {
      setN(text.length);
      return;
    }
    setN(0);
    let interval: number | undefined;
    const timeout = window.setTimeout(() => {
      let typed = 0;
      interval = window.setInterval(() => {
        typed += 1;
        setN(typed);
        // Pełny tytuł = koniec pracy: interwał nie tyka dalej na próżno.
        if (typed >= text.length && interval !== undefined) {
          window.clearInterval(interval);
          interval = undefined;
        }
      }, TYPEWRITER_STEP_MS);
    }, delayMs);
    return () => {
      window.clearTimeout(timeout);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [types, text, delayMs]);
  return (
    <span className="font-medium truncate max-w-[220px] sm:max-w-none sm:whitespace-nowrap leading-none">
      {text.slice(0, n)}
      <span className="tt-caret" data-motion-loop="" aria-hidden>
        |
      </span>
    </span>
  );
}

/** Inicjały jako zapas, gdy profil nie ma awatara - autor MA być zawsze widoczny. */
export function authorInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** Inline'owy autor (awatar + nazwisko) - używany przez skin `live`. */
function TickerAuthor({ post }: { post: TickerItemProps["post"] }) {
  const name = post.author_display_name?.trim() ?? "";
  const avatar = post.author_avatar_url?.trim() ?? "";
  if (!name && !avatar) return null;
  return (
    <span className="tt-live-author inline-flex shrink-0 items-center gap-[5px]">
      {avatar ? (
        <img
          src={buildAvatarSrc(avatar, 20)}
          srcSet={buildAvatarSrcSet(avatar, 20)}
          decoding="async"
          alt=""
          loading="lazy"
          width={20}
          height={20}
          className="tt-live-avatar h-5 w-5 rounded-[5px] object-cover"
        />
      ) : name ? (
        <span
          className="tt-live-avatar inline-flex h-5 w-5 items-center justify-center rounded-[5px] text-[9px] font-bold"
          aria-hidden
        >
          {authorInitials(name)}
        </span>
      ) : null}
      {name ? (
        <span className="tt-live-name hidden sm:inline-flex items-center whitespace-nowrap text-[12px] font-semibold">
          {name}
        </span>
      ) : null}
    </span>
  );
}

interface MarqueeLayoutProps {
  label: string;
  posts: readonly TickerItemProps["post"][];
  lang: "pl" | "en";
  intervalSec: number;
  /** Horizontal engine: px per second. */
  scrollSpeed: number;
  /** How many items are visible at once in the viewport. */
  perView: number;
  /**
   * Klasa wysokości `.tt-glass` z `tickerBandGeometry` - ta sama, którą
   * powtarzają rezerwa i szkielet nagłówka.
   */
  bandClass: string;
  iconClass: string;
  /** Visual skin applied to the two marquee engines (horizontal / vertical). */
  skin: TickerGlassSkin;
}

export function itemTitle(post: TickerItemProps["post"], lang: "pl" | "en"): string {
  return lang === "en"
    ? post.title_en || post.title_pl || ""
    : post.title_pl || post.title_en || "";
}

export function itemHref(post: TickerItemProps["post"]): string {
  return post.href ?? (post.slug ? `/post/${post.slug}` : "#");
}

/** Horizontal marquee engine - skins: marquee (v7), ribbon (v9), tape (v13). */
function TickerGlassMarquee({
  label,
  posts,
  lang,
  intervalSec,
  scrollSpeed,
  perView,
  bandClass,
  iconClass,
  skin,
}: MarqueeLayoutProps) {
  const anim = `tt-marquee-${useId().replace(/:/g, "")}`;
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [lapPx, setLapPx] = useState(0);

  // One lap = half of the duplicated track. Measuring it keeps the configured
  // speed honest (px/s) no matter how many posts or how long the titles are.
  // This bar is server-rendered on every page, so the measurement branch is
  // stated explicitly: the layout hook on the client (the correction lands
  // before paint), plain useEffect on the server, where no effect body runs at
  // all. The server therefore keeps lapPx === 0 and falls back to `estimated`
  // below - a deterministic value, identical in the SSR HTML and in the
  // client's first pass.
  useIsomorphicLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => setLapPx(el.scrollWidth / 2);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [posts, lang, perView]);

  const speed = Math.max(10, Math.min(400, scrollSpeed || 60));
  // Fallback before measurement: assume ~220px per item.
  const estimated = posts.length * 220;
  const durationSec = Math.max(4, (lapPx || estimated) / speed);
  const loop = [...posts, ...posts];
  // Ten sam zwarty napis co przed `StyleSink` (F11): HTML paska bez zmian.
  const marqueeKeyframes = `@keyframes ${anim}{0%{transform:translate3d(0,0,0)}100%{transform:translate3d(-50%,0,0)}}`;
  // "Items visible at once" caps each pill so exactly `perView` fit the viewport.
  const pillMax = perView > 1 ? `calc((100% - ${(perView - 1) * 12}px) / ${perView})` : undefined;

  return (
    <div
      data-tt-band=""
      className={`tt-glass tt-glass--marquee tt-skin--${skin} ${bandClass} flex items-center gap-3 overflow-hidden`}
      data-tt-interval={intervalSec}
    >
      <span className="tt-glass-label tt-glass-chip inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap">
        <span className="tt-chip-icon relative inline-flex items-center justify-center shrink-0">
          <Flame
            className={`w-3.5 h-3.5 shrink-0 ${iconClass}`}
            style={{ color: "inherit" }}
            aria-hidden
          />
        </span>
        <span className="tt-chip-text hidden sm:inline">{label}</span>
      </span>

      <div className="tt-glass-track relative min-w-0 flex-1 overflow-hidden">
        <div
          ref={trackRef}
          className="flex w-max items-center gap-3 py-2"
          data-motion-loop=""
          style={{ animation: `${anim} ${durationSec}s linear infinite` }}
          onMouseEnter={(e) => {
            e.currentTarget.style.animationPlayState = "paused";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.animationPlayState = "running";
          }}
        >
          {loop.map((p, i) => (
            <AppLink
              key={`${p.id}-${i}`}
              href={itemHref(p)}
              className="tt-item tt-glass-pill inline-flex items-center gap-2 whitespace-nowrap text-[13px] leading-none font-medium shrink-0"
              style={{ color: "var(--tt-item)", maxWidth: pillMax }}
              title={itemTitle(p, lang)}
              aria-hidden={i >= posts.length ? true : undefined}
              tabIndex={i >= posts.length ? -1 : undefined}
            >
              {skin === "live" ? (
                <span
                  className="tt-live-index hidden sm:inline shrink-0 text-[13px] font-bold tabular-nums"
                  style={{ color: "var(--tt-label)" }}
                  aria-hidden
                >
                  {String((i % posts.length) + 1).padStart(2, "0")}
                </span>
              ) : (
                <span
                  className="tt-glass-dot inline-block w-1 h-1 rounded-full shrink-0"
                  style={{ background: "var(--tt-dot)" }}
                  aria-hidden
                />
              )}
              <span className="tt-live-title min-w-0 truncate">{itemTitle(p, lang)}</span>
              <span
                aria-hidden
                className="tt-live-separator inline-block w-px h-3.5 shrink-0 self-center"
              />
              {skin === "live" ? <TickerAuthor post={p} /> : null}
            </AppLink>
          ))}
        </div>
      </div>
      <StyleSink css={marqueeKeyframes} />
    </div>
  );
}

/** Vertical rotation engine - skins: cards (v5), spotlight (v11). */
function TickerGlassCards({
  label,
  posts,
  lang,
  intervalSec,
  rows,
  bandClass,
  iconClass,
  skin,
}: MarqueeLayoutProps & {
  /** Wiersze okna - `tickerCardRows(perView, posts.length)`, liczone raz przez rodzica. */
  rows: number;
}) {
  const anim = `tt-cards-${useId().replace(/:/g, "")}`;
  // Duplicate the first `rows` cards so the loop never shows an empty slot.
  const track = [...posts, ...posts.slice(0, rows)];
  const slots = track.length;
  const steps = posts.length; // one hold per real post
  const durationSec = Math.max(2, posts.length * Math.max(2, intervalSec));
  const keyframes = buildVerticalKeyframes(slots, anim, steps);

  return (
    <div
      data-tt-band=""
      className={`tt-glass tt-glass--cards tt-skin--${skin} ${bandClass} flex items-center gap-3 overflow-hidden`}
    >
      <span className="tt-glass-label tt-glass-chip inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap">
        <span className="tt-chip-icon relative inline-flex items-center justify-center shrink-0">
          <Flame
            className={`w-3.5 h-3.5 shrink-0 ${iconClass}`}
            style={{ color: "inherit" }}
            aria-hidden
          />
        </span>
        <span className="tt-chip-text hidden sm:inline">{label}</span>
      </span>

      <div
        className="tt-glass-viewport relative min-w-0 flex-1 overflow-hidden"
        style={{ ["--tt-rows" as string]: String(rows) }}
      >
        <div
          className="flex flex-col"
          data-motion-loop=""
          style={{ animation: `${anim} ${durationSec}s cubic-bezier(.65,0,.35,1) infinite` }}
          onMouseEnter={(e) => {
            e.currentTarget.style.animationPlayState = "paused";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.animationPlayState = "running";
          }}
        >
          {track.map((p, i) => (
            <div
              key={`${p.id}-${i}`}
              className="tt-glass-card flex h-11 shrink-0 items-center gap-2.5"
              aria-hidden={i >= posts.length ? true : undefined}
            >
              <span
                className={`${skin === "live" ? "tt-live-index " : ""}hidden sm:inline text-[10px] font-bold tabular-nums opacity-70`}
                style={{ color: "var(--tt-counter)" }}
              >
                {String((i % posts.length) + 1).padStart(2, "0")}
              </span>
              <AppLink
                href={itemHref(p)}
                className="tt-item flex min-w-0 items-center gap-2.5 text-[13px] leading-none font-medium"
                style={{ color: "var(--tt-item)" }}
                title={itemTitle(p, lang)}
                tabIndex={i >= posts.length ? -1 : undefined}
              >
                <span className="tt-live-title min-w-0 truncate">{itemTitle(p, lang)}</span>
                <span
                  aria-hidden
                  className="tt-live-separator inline-block w-px h-3.5 shrink-0 self-center"
                />
                {skin === "live" ? <TickerAuthor post={p} /> : null}
              </AppLink>
            </div>
          ))}
        </div>
      </div>
      <KeyframesStyle keyframes={keyframes} />
    </div>
  );
}

/**
 * Klatki pionowej rotacji jako liść `memo` po napisie (F11, P2.3) - ta sama
 * mechanika co `StyleSink`: re-render paska z identycznym tekstem (np. zmiana
 * porcji wpisów co `intervalSec`) nie przepisuje `innerHTML` bloku. Osobny
 * liść zamiast `StyleSink`, bo ten sink ma imienny wpis w allowliście
 * `check:dangerous-html` (`keyframes` - liczby i nazwa z `useId()`), której
 * w tej fali nie zmieniamy.
 */
const KeyframesStyle = memo(function KeyframesStyle({ keyframes }: { keyframes: string }) {
  return <style dangerouslySetInnerHTML={{ __html: keyframes }} />;
});

/** Hold-then-advance vertical keyframes for `slots` stacked rows. */
export function buildVerticalKeyframes(
  slots: number,
  animName: string,
  stepCount = slots - 1,
): string {
  if (slots < 2) return "";
  const steps = Math.max(1, Math.min(stepCount, slots - 1));
  const slot = 100 / slots;
  const transition = 100 / (slots * steps);
  const hold = slot - transition;
  let frames = "";
  for (let i = 0; i < steps; i += 1) {
    const start = i * ((100 - transition) / steps);
    const end = start + Math.max(0, hold);
    const y = -((i * 100) / slots);
    frames += `${start.toFixed(2)}%,${end.toFixed(2)}%{transform:translate3d(0,${y.toFixed(2)}%,0)}`;
  }
  frames += `100%{transform:translate3d(0,${(-((steps * 100) / slots)).toFixed(2)}%,0)}`;
  return `@keyframes ${animName}{0%{transform:translate3d(0,0,0)}${frames}}`;
}

function TickerPaletteStyle({ vid, palette }: { vid: string; palette: TickerColorScheme }) {
  const sel = `[data-tt-vid="${vid}"]`;
  const L = palette.light;
  const D = palette.dark;
  const css = `
    ${sel} {
      --tt-bg: ${L.bg};
      --tt-border: ${L.border};
      --tt-label: ${L.label};
      --tt-item: ${L.item};
      --tt-item-hover: ${L.itemHover};
      --tt-counter: ${L.counter};
      --tt-label-bg: ${L.labelBg || L.label};
      --tt-label-fg: ${L.labelFg || "#ffffff"};
      --tt-dot: ${L.dot || L.label};
    }
    :root.dark ${sel}, .dark ${sel} {
      --tt-bg: ${D.bg};
      --tt-border: ${D.border};
      --tt-label: ${D.label};
      --tt-item: ${D.item};
      --tt-item-hover: ${D.itemHover};
      --tt-counter: ${D.counter};
      --tt-label-bg: ${D.labelBg || D.label};
      --tt-label-fg: ${D.labelFg || "#ffffff"};
      --tt-dot: ${D.dot || D.label};
    }
    ${sel} .tt-item:hover { color: var(--tt-item-hover) !important; }
  `;
  // `StyleSink` (P1.2): utwardzenie w miejscu renderu i `memo` po napisie -
  // zmiana porcji wpisów nie przepisuje bloku (F11).
  return <StyleSink css={css} />;
}

/**
 * Arkusz paska - STAŁY tekst modułu (F11, P2.3). Dawniej literał w JSX:
 * każdy re-render paska (zmiana porcji wpisów co `intervalSec`, efekty
 * hydratacji) dawał nowy obiekt `{__html}`, więc React przepisywał `innerHTML`
 * 300-liniowego bloku (`ParseHTML` w commicie hydratacji, K12 w P0.5) i
 * przeliczał style. Przez `StyleSink` identyczny napis nie dochodzi do DOM-u.
 *
 * F9: `transform-origin` stoi w regule `.tt-anim-flip`, nie w klatkach
 * kluczowych `tt-flip` - właściwość spoza transform/opacity w `@keyframes`
 * zdejmowała animację z kompozytora (`unsupportedProperties:
 * ["transform-origin"]` w śladzie P0.5). Oś obrotu jest teraz stała (dolna
 * krawędź) przez cały obrót.
 *
 * F10: płomień etykiety bez `will-change` (warstwa kompozytora trzymana przez
 * całe życie strony, także gdy ikona stoi), a nieskończone animacje ozdobne
 * (płomień, pulsowanie `live`, gradient `ribbon`) tylko pod
 * `[data-tt-motion]` - patrz RUCH PASKA nad `TrendingTicker`. Atrybut podnosi
 * specyficzność tych reguł, więc wyłącza je dopiero ostatni blok
 * `prefers-reduced-motion` (z `!important`, ten sam selektor z atrybutem) -
 * zwykła reguła `.tt-skin--live .tt-chip-icon::before` już by nie wygrała.
 */
const TICKER_CSS = /* @nes-static-css */ `
        .cms-trending, .cms-trending *,
        .tt-glass, .tt-glass * {
          font-family: var(--font-display, "Red Hat Display", system-ui, sans-serif);
        }
        @keyframes tt-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes tt-slide {
          from { opacity: 0; transform: translateY(60%) }
          to   { opacity: 1; transform: translateY(0) }
        }
        @keyframes tt-flip {
          from { opacity: 0; transform: perspective(600px) rotateX(-85deg) }
          to   { opacity: 1; transform: perspective(600px) rotateX(0deg) }
        }
        .tt-anim-fade  { animation: tt-fade  360ms ease both }
        .tt-anim-slide { animation: tt-slide 420ms cubic-bezier(.22,.61,.36,1) both }
        .tt-anim-flip  { transform-origin: 50% 100%; animation: tt-flip 520ms cubic-bezier(.22,.61,.36,1) both }
        .tt-caret { display:inline-block; margin-left:2px; opacity:.6; animation: tt-fade 800ms steps(2) infinite alternate }

        /* Flame animations */
        @keyframes tt-flame-pulse {
          0%,100% { transform: scale(1) }
          50%     { transform: scale(1.18) }
        }
        @keyframes tt-flame-flicker {
          0%,100% { transform: scale(1) rotate(-2deg); opacity: 1 }
          20%     { transform: scale(1.12) rotate(3deg); opacity: .92 }
          40%     { transform: scale(0.94) rotate(-4deg); opacity: .85 }
          60%     { transform: scale(1.08) rotate(2deg); opacity: 1 }
          80%     { transform: scale(0.98) rotate(-1deg); opacity: .95 }
        }
        @keyframes tt-flame-spin {
          from { transform: rotate(0deg) } to { transform: rotate(360deg) }
        }
        @keyframes tt-flame-wave {
          0%,100% { transform: translateY(0) scale(1) }
          50%     { transform: translateY(-2px) scale(1.06) }
        }
        .tt-flame { transform-origin: 50% 90% }
        [data-tt-motion] .tt-flame-pulse   { animation: tt-flame-pulse    1.8s ease-in-out infinite }
        [data-tt-motion] .tt-flame-flicker { animation: tt-flame-flicker  1.4s ease-in-out infinite }
        [data-tt-motion] .tt-flame-spin    { animation: tt-flame-spin     3.2s linear infinite }
        [data-tt-motion] .tt-flame-wave    { animation: tt-flame-wave     1.6s ease-in-out infinite }

        /* Glass marquee / cards (v7 / v5) */
        .tt-glass { position: relative; padding: 6px 0 }
        .tt-glass-label {
          font-size: 11px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase;
          color: var(--tt-label);
        }
        .tt-glass-chip {
          height: 28px; padding: 0 12px; border-radius: 999px;
          border: 1px solid color-mix(in srgb, var(--tt-label) 34%, transparent);
          background: linear-gradient(135deg,
            color-mix(in srgb, var(--tt-label) 18%, transparent),
            color-mix(in srgb, var(--tt-label) 4%, transparent));
          backdrop-filter: blur(10px) saturate(140%);
          -webkit-backdrop-filter: blur(10px) saturate(140%);
        }
        .tt-glass-pill {
          height: 28px; padding: 0 14px; border-radius: 999px;
          border: 1px solid color-mix(in srgb, var(--tt-border) 90%, transparent);
          background: linear-gradient(135deg,
            color-mix(in srgb, #fff 12%, transparent),
            color-mix(in srgb, #fff 3%, transparent));
          box-shadow: 0 1px 0 color-mix(in srgb, #fff 18%, transparent) inset;
          backdrop-filter: blur(8px) saturate(130%);
          -webkit-backdrop-filter: blur(8px) saturate(130%);
          transition: transform .25s cubic-bezier(.22,.61,.36,1), border-color .25s, box-shadow .25s;
        }
        .tt-glass-pill:hover {
          transform: translateY(-1px);
          border-color: color-mix(in srgb, var(--tt-label) 55%, transparent);
          box-shadow: 0 10px 24px -16px color-mix(in srgb, var(--tt-label) 90%, transparent);
        }
        .tt-glass--marquee .tt-glass-track::before,
        .tt-glass--marquee .tt-glass-track::after {
          content: ""; position: absolute; top: 0; bottom: 0; width: 56px; z-index: 2;
          pointer-events: none;
        }
        .tt-glass--marquee .tt-glass-track::before {
          left: 0; background: linear-gradient(to right, var(--tt-bg), transparent);
        }
        .tt-glass--marquee .tt-glass-track::after {
          right: 0; background: linear-gradient(to left, var(--tt-bg), transparent);
        }
        .tt-glass--cards .tt-glass-viewport {
          height: calc(44px * var(--tt-rows, 1)); border-radius: 12px;
          border: 1px solid color-mix(in srgb, var(--tt-border) 90%, transparent);
          background: linear-gradient(135deg,
            color-mix(in srgb, #fff 10%, transparent),
            color-mix(in srgb, #fff 2%, transparent));
          box-shadow: 0 1px 0 color-mix(in srgb, #fff 16%, transparent) inset,
                      0 12px 28px -22px color-mix(in srgb, var(--tt-label) 80%, transparent);
          backdrop-filter: blur(10px) saturate(140%);
          -webkit-backdrop-filter: blur(10px) saturate(140%);
        }
        .tt-glass--cards .tt-glass-card { padding: 0 14px }
        .tt-glass--cards .tt-glass-card + .tt-glass-card {
          border-top: 1px solid color-mix(in srgb, var(--tt-border) 60%, transparent);
        }

        /* v9 - animated gradient ribbon */
        @keyframes tt-ribbon-shift { to { background-position: 200% 50% } }
        .tt-skin--ribbon .tt-glass-track {
          border-radius: 999px; padding: 0 10px;
          background: linear-gradient(90deg,
            color-mix(in srgb, var(--tt-label) 22%, transparent),
            color-mix(in srgb, var(--tt-label) 4%, transparent),
            color-mix(in srgb, var(--tt-label) 22%, transparent));
          background-size: 200% 100%;
          box-shadow: 0 0 0 1px color-mix(in srgb, var(--tt-label) 26%, transparent) inset;
        }
        [data-tt-motion] .tt-skin--ribbon .tt-glass-track { animation: tt-ribbon-shift 9s linear infinite }
        .tt-skin--ribbon .tt-glass-pill {
          background: none; border: none; box-shadow: none; backdrop-filter: none;
          -webkit-backdrop-filter: none; padding: 0 6px; letter-spacing: .02em;
        }
        .tt-skin--ribbon .tt-glass-pill:hover { transform: none; text-decoration: underline }
        .tt-skin--ribbon .tt-glass-dot {
          width: 5px; height: 5px; transform: rotate(45deg); border-radius: 1px;
        }

        /* v13 - ticker tape */
        .tt-skin--tape .tt-glass-chip {
          border-radius: 0; clip-path: polygon(0 0, 100% 0, calc(100% - 8px) 100%, 0 100%);
          background: var(--tt-label); color: var(--tt-label-fg);
        }
        .tt-skin--tape .tt-glass-track {
          border-top: 1px dashed color-mix(in srgb, var(--tt-border) 90%, transparent);
          border-bottom: 1px dashed color-mix(in srgb, var(--tt-border) 90%, transparent);
        }
        .tt-skin--tape .tt-glass-pill {
          border-radius: 0;
          font-size: 12px; font-variant-numeric: tabular-nums; letter-spacing: .04em; text-transform: uppercase;
          background: none; box-shadow: none; backdrop-filter: none;
          -webkit-backdrop-filter: none;
          border: 1px solid color-mix(in srgb, var(--tt-border) 90%, transparent);
          clip-path: polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%);
        }
        .tt-skin--tape .tt-glass-pill:hover { transform: none }

        /* Widget "Na czasie" - subtelny, mniejszy badge brandowy
           (nie przytłaczający, pasuje do headera zamiast go dominować). */
        .tt-skin--live { gap: 8px }
        .tt-skin--live .tt-glass-chip {
          position: relative;
          overflow: hidden;
          height: 26px;
          padding: 0 10px;
          border-radius: 3px;
          border-left: 2px solid color-mix(in srgb, white 45%, transparent);
          clip-path: none;
          transform: skewX(-8deg);
          transform-origin: center;
          background: linear-gradient(90deg,
            color-mix(in srgb, var(--tt-label) 78%, transparent),
            color-mix(in srgb, var(--tt-label) 92%, transparent));
          color: var(--tt-label-fg);
          font-weight: 800;
          font-size: 10px;
          letter-spacing: .06em;
          text-transform: uppercase;
          transition: transform .25s ease;
          gap: 6px;
          /* skew wysuwa lewą krawędź w lewo - dodajemy margines, żeby nie być obciętym przez overflow-hidden rodzica */
          margin-left: 4px;
        }
        .tt-skin--live .tt-glass-chip:active { transform: skewX(-8deg) scale(.97) }
        .tt-skin--live .tt-chip-icon,
        .tt-skin--live .tt-chip-text {
          transform: skewX(8deg);
        }
        .tt-skin--live .tt-chip-text { user-select: none }
        .tt-skin--live .tt-chip-icon {
          width: 16px; height: 16px;
        }
        /* Ikona flame w badge „Na czasie" ma być nieruchoma - wyłączamy globalne animacje. */
        .tt-skin--live .tt-flame {
          animation: none !important;
          transform: none !important;
          will-change: auto;
        }
        /* Delikatna pulsacja za ikoną - zawsze widoczna, nienarzucająca się. */
        .tt-skin--live .tt-chip-icon::before,
        .tt-skin--live .tt-chip-icon::after {
          content: "";
          position: absolute;
          border-radius: 9999px;
          background: color-mix(in srgb, #fff 18%, transparent);
          opacity: .55;
          pointer-events: none;
        }
        [data-tt-motion] .tt-skin--live .tt-chip-icon::before,
        [data-tt-motion] .tt-skin--live .tt-chip-icon::after {
          animation: tt-live-ping 2.6s cubic-bezier(0,0,.2,1) infinite;
        }
        .tt-skin--live .tt-chip-icon::before { width: 18px; height: 18px }
        .tt-skin--live .tt-chip-icon::after {
          width: 14px; height: 14px;
          background: color-mix(in srgb, #fff 10%, transparent);
        }
        [data-tt-motion] .tt-skin--live .tt-chip-icon::after { animation-delay: .9s }
        @keyframes tt-live-ping {
          75%, 100% { transform: scale(1.6); opacity: 0 }
        }
        /* Delikatny refleks na hover. */
        .tt-skin--live .tt-glass-chip::after {
          content: "";
          position: absolute;
          inset: 0 auto 0 -100%;
          width: 100%;
          background: linear-gradient(90deg, transparent,
            color-mix(in srgb, white 18%, transparent), transparent);
          transition: left .8s ease-in-out;
          pointer-events: none;
        }
        .tt-skin--live .tt-glass-chip:hover::after { left: 100% }
        @media (prefers-reduced-motion: reduce) {
          .tt-skin--live .tt-glass-chip::after { transition: none }
        }
        /* Wariant "Na czasie": badge jest samodzielny, bez ciemnego paska nachodzącego na niego */
        .tt-skin--live .tt-glass-track,
        .tt-skin--live .tt-glass-viewport {

          background: transparent;
          border: none;
          border-radius: 0;
          box-shadow: none;
          backdrop-filter: none;
          -webkit-backdrop-filter: none;
          margin-left: 0;
        }
        .tt-skin--live .tt-glass-track::before,
        .tt-skin--live .tt-glass-track::after,
        .tt-skin--live .tt-glass-viewport::before,
        .tt-skin--live .tt-glass-viewport::after {
          display: none;
        }
        .tt-skin--live .tt-glass-card { padding: 0 16px }
        .tt-skin--live .tt-item { font-size: 14px; font-weight: 700; letter-spacing: -.01em }
        .tt-skin--live .tt-glass-pill {
          border-radius: 0; background: none; box-shadow: none; border: 0;
          backdrop-filter: none; -webkit-backdrop-filter: none;
          font-size: 14px; font-weight: 700;
        }
        .tt-skin--live .tt-live-author { color: var(--tt-counter) }
        .tt-skin--live .tt-live-name { color: var(--tt-counter) }

        .tt-skin--live .tt-live-avatar {
          background: color-mix(in srgb, var(--tt-label) 18%, transparent);
          color: var(--tt-label);
        }
        /* Jedna linia bazowa dla całego elementu: wspólny wiersz 24px, każdy
           składnik (numer, tytuł, kreska, awatar, nazwisko) jest wyśrodkowany
           w tej samej wysokości - bez ucinania g/j/y/ą/ę. */
        .tt-skin--live .tt-item.tt-item { column-gap: 0; line-height: 1.5; align-items: center }
        .tt-skin--live .tt-glass-pill.tt-glass-pill { column-gap: 0; line-height: 1.5; align-items: center }
        .tt-skin--live .tt-live-author {
          display: inline-flex; align-items: center;
          height: 24px; line-height: 1.5; padding-block: 0;
        }
        /* Numer i nazwisko autora tylko od sm w górę - na mobile zostaje
           awatar i pełna szerokość dla tytułu (klasa hidden z Tailwinda
           nie może być nadpisywana przez display z tego bloku). */

        @media (min-width: 640px) {
          .tt-skin--live .tt-live-index {
            display: inline-flex; align-items: center;
            height: 24px; line-height: 1.5; padding-block: 0;
            margin-right: 10px;
          }
          .tt-skin--live .tt-live-name {
            align-items: center;
            height: 24px; line-height: 1.5; padding-block: 0;
          }
        }

        .tt-skin--live .tt-live-title.tt-live-title {
          display: inline-block; height: 24px; line-height: 24px;
          padding-block: 0; align-self: center;
        }
        .tt-live-separator {
          width: 1px; height: 14px; margin: 0 10px;
          background: currentColor;
          opacity: 0.35;
          flex-shrink: 0; align-self: center;
        }
        .tt-skin--live .tt-live-avatar { align-self: center }

        /* Pionowy slide: numer w kolorze brandu, jak w poziomym marquee */
        .tt-skin--live .tt-glass-card > .tt-live-index {
          font-size: 13px; opacity: 1; color: var(--tt-label);
        }

        /* v11 - spotlight rotation */
        .tt-skin--spotlight .tt-glass-viewport {
          border-radius: 0; border-left: 2px solid var(--tt-label);
          border-top: none; border-right: none; border-bottom: none;
          background: radial-gradient(120% 140% at 0% 50%,
            color-mix(in srgb, var(--tt-label) 20%, transparent), transparent 70%);
          box-shadow: none;
        }
        .tt-skin--spotlight .tt-glass-card + .tt-glass-card { border-top: none }
        .tt-skin--spotlight .tt-glass-card > span:first-child {
          font-size: 18px; opacity: 1; color: var(--tt-label);
        }
        .tt-skin--spotlight .tt-item { font-size: 14px; font-weight: 600 }



        @media (prefers-reduced-motion: reduce) {
          .tt-glass [style*="animation"] { animation: none !important }
          .tt-anim-fade, .tt-anim-slide, .tt-anim-flip { animation: none !important }
          .tt-caret, .tt-flame-pulse, .tt-flame-flicker, .tt-flame-spin, .tt-flame-wave {
            animation: none !important
          }
          [data-tt-motion] .tt-skin--ribbon .tt-glass-track,
          [data-tt-motion] .tt-skin--live .tt-chip-icon::before,
          [data-tt-motion] .tt-skin--live .tt-chip-icon::after { animation: none !important }
        }
      `;

function TickerStyles() {
  return <StyleSink css={TICKER_CSS} />;
}
