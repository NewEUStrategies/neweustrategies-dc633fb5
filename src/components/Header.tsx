import { useTranslation } from "react-i18next";
import "@/lib/i18n-mobile-drawer";
import { useSuspenseQuery } from "@tanstack/react-query";
import { memo, Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Menu, Moon, Search, Sun, X } from "lucide-react";
import { resolveSetting, siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { cn } from "@/lib/utils";
import { BuilderRenderer } from "@/components/builder/organisms/BuilderRenderer";
import type { BuilderDocument } from "@/lib/builder/types";
import type { TickerConfig } from "@/lib/views/headerTickerQuery";
import { resolveActiveTickerConfig } from "@/lib/views/tickerVariants";
import { useTickerDraft } from "@/lib/views/tickerDraftBridge";
import { AlertBar } from "@/components/AlertBar";
import { AdZone } from "@/components/AdSlot";
import type { AdPageType } from "@/lib/ads/types";
import { TrendingTicker } from "@/components/header/TrendingTicker";
import { HeaderSkeleton } from "@/components/header/HeaderSkeleton";
import { MobileDrawerBody } from "@/components/header/mobile/MobileDrawerBody";
import { SearchOverlay } from "@/components/SearchOverlay";
import { AppLink } from "@/components/atoms/AppLink";
import { LangReelSwitcher } from "@/components/atoms/LangReelSwitcher";

import { useRouterState } from "@tanstack/react-router";
import { useTheme } from "@/components/ThemeProvider";
import { useFocusTrap } from "@/lib/a11y/useFocusTrap";
import { useLang } from "@/lib/i18n/useLang";
import { resolveHeaderMode, type ContentKind } from "@/lib/layout/headerMode";

type ThemeLogoCfg = {
  logo?: {
    main?: string;
    main_dark?: string;
    mobile?: string;
    mobile_dark?: string;
  };
};

// Shared with the root loader (SSR prefetch of the ticker) - keep in sync.
export type HeaderSettings = {
  builder_data?: BuilderDocument | null;
  // Legacy TickerConfig OR new TickerSettings shape - resolveActiveTickerConfig normalizes both.
  trending?: TickerConfig | Record<string, unknown>;
};

type GeneralSettings = { site_name?: string };

interface HeaderProps {
  /**
   * Typ strony dla banera nagłówka (SiteChrome wylicza go z lokalizacji);
   * bez niego baner emituje wyłącznie placementy z page_type="all".
   */
  adPageType?: AdPageType;
  /** Czy header renderuje się na stronie głównej (wpływa na efekty scroll). */
  isHome?: boolean;
  /**
   * `kind` z loaderData dopasowanej trasy. Rozstrzyga, czy górną krawędź
   * przejmuje pasek czytania wpisu (patrz lib/layout/headerMode) - po ścieżce
   * tego rozpoznać nie można, bo wpisy mają adresy `<rodzic>/<slug>`.
   */
  contentKind?: ContentKind;
}

function HeaderInner({ adPageType = "all", isHome = false }: HeaderProps) {
  const { t } = useTranslation();
  // URL-seeded language (SSR-safe, no hydration flicker) - see useLang docs.
  const lang = useLang();

  // Loader in __root.tsx prefetches this query, so useSuspenseQuery resolves
  // synchronously on hydration and on every client navigation - the header
  // never flashes a skeleton in steady state.
  const { data: settingsMap } = useSuspenseQuery(siteSettingsQueryOptions);
  const cfg = resolveSetting<HeaderSettings>(settingsMap, "header", {});
  const general = resolveSetting<GeneralSettings>(settingsMap, "general", {});
  const theme = resolveSetting<ThemeLogoCfg>(settingsMap, "theme_options", {});
  const draft = useTickerDraft();
  const trending = draft ?? resolveActiveTickerConfig(cfg.trending);
  const siteName = (general.site_name && general.site_name.trim()) || "Menu";
  const { theme: mode, toggle } = useTheme();
  const isDark = mode === "dark";
  const themeLogo = theme.logo ?? {};
  // Dark mode na mobile/tablecie ma pokazywać ten sam (jasny napis) wariant co
  // desktop: dedykowane mobile_dark -> desktopowe main_dark -> dopiero potem
  // warianty jasne jako awaryjny fallback.
  const mobileLogo = isDark
    ? themeLogo.mobile_dark || themeLogo.main_dark || themeLogo.mobile || themeLogo.main || ""
    : themeLogo.mobile || themeLogo.main || themeLogo.mobile_dark || themeLogo.main_dark || "";

  const [open, setOpen] = useState(false);
  // Jedno-tapowa szukajka na mobilnym pasku (audyt: szukanie było schowane za
  // hamburgerem -> drawer -> tap). Otwiera ten sam fullscreenowy SearchOverlay.
  const [searchOpen, setSearchOpen] = useState(false);
  const drawerPanelRef = useRef<HTMLDivElement>(null);
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  useFocusTrap(drawerPanelRef, open);

  // Close the drawer on route change and lock body scroll while open.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const prev = document.body.style.overflow;
    if (open) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Bridge: ReadingHeader (na wpisach po scrollu) nie zawiera hamburgera ani
  // lupy - główny pasek mobilny jest wtedy poza ekranem. Nasłuchujemy zdarzeń
  // okna aby otworzyć drawer / SearchOverlay bez duplikowania stanu.
  useEffect(() => {
    const openMenu = () => setOpen(true);
    const openSearch = () => setSearchOpen(true);
    window.addEventListener("neus:open-mobile-menu", openMenu);
    window.addEventListener("neus:open-mobile-search", openSearch);
    return () => {
      window.removeEventListener("neus:open-mobile-menu", openMenu);
      window.removeEventListener("neus:open-mobile-search", openSearch);
    };
  }, []);

  if (!cfg.builder_data || !cfg.builder_data.sections?.length) return null;

  const openA11y = t("common.openMenu");
  const closeA11y = t("common.closeMenu");

  return (
    <>
      {/* Jeden kontener na całe chrome headera - to on jest skalowany przy
          zwijaniu (patrz styles.css). Wcześniej `zoom` siedział na każdym
          dziecku <header> z osobna, co mnożyło przeliczenia layoutu w każdej
          klatce animacji i przy okazji skalowało też fullscreenowy
          SearchOverlay, który jest renderowany poniżej - poza tym kontenerem. */}
      <div className="site-header-chrome">
        <AlertBar />
        {trending.enabled !== false && (
          <TrendingTicker
            source={trending.source ?? "trending"}
            mode={trending.mode ?? "scroll"}
            layoutStyle={trending.layoutStyle ?? "classic"}
            days={trending.days ?? 7}
            limit={trending.limit ?? 8}
            visibleCount={trending.visibleCount ?? 1}
            intervalSec={trending.intervalSec ?? 6}
            scrollSpeed={trending.scrollSpeed ?? 60}
            liveDirection={trending.liveDirection ?? "vertical"}
            pinnedPostId={trending.pinnedPostId}
            pinnedUntil={trending.pinnedUntil ?? null}
            selectedPostIds={trending.selectedPostIds}
            mixedFill={trending.mixedFill}
            labelPl={trending.labelPl}
            labelEn={trending.labelEn}
            iconAnimation={trending.iconAnimation}
            colors={trending.colors}
            fullWidth={trending.fullWidth ?? true}
          />
        )}
        <AdZone position="header_banner" pageType={adPageType} className="py-2 text-center" />

        {/* Mobile compact bar: horizontal logo (super-admin -> Branding -> Logo -> Mobile) + hamburger.
            Logo jest wyśrodkowane względem pełnej szerokości paska; lewy/prawy cluster
            pozostaje przy krawędziach dzięki kolumnom 1fr-auto-1fr. */}
        <div className="lg:hidden sticky top-0 z-[9998] grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-3 border-b border-border bg-background">
          <div className="flex items-center gap-2 justify-self-start">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label={t("common.openSearch")}
              className="inline-flex items-center justify-center h-10 w-10 rounded-md text-foreground hover:bg-muted transition shrink-0"
            >
              <Search className="w-5 h-5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={toggle}
              aria-label={t("common.toggleTheme")}
              className="inline-flex items-center justify-center h-10 w-10 rounded-md text-foreground hover:bg-muted transition shrink-0"
            >
              {isDark ? (
                <Sun className="w-5 h-5" aria-hidden />
              ) : (
                <Moon className="w-5 h-5" aria-hidden />
              )}
            </button>
          </div>
          <AppLink
            href="/"
            aria-label={siteName}
            className="flex items-center justify-center min-w-0 text-foreground justify-self-center"
          >
            {mobileLogo ? (
              <img
                src={mobileLogo}
                alt={siteName}
                className="h-8 w-auto max-w-[180px] object-contain"
                loading="eager"
                decoding="async"
              />
            ) : (
              <span className="text-base font-bold tracking-tight truncate min-w-0 max-w-[180px]">
                {siteName}
              </span>
            )}
          </AppLink>
          <div className="flex items-center gap-2 justify-self-end">
            <LangReelSwitcher label={t("mobileDrawer.language")} />
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label={openA11y}
              aria-expanded={open}
              aria-controls="mobile-header-drawer"
              className="inline-flex items-center justify-center h-10 w-10 rounded-md text-foreground hover:bg-muted transition shrink-0"
            >
              <Menu className="w-5 h-5" aria-hidden />
            </button>
          </div>
        </div>

        {/* Full builder-authored header - visible from lg up. */}
        <div className={cn("hidden lg:block", isHome && "home-header-grow")}>
          <BuilderRenderer doc={cfg.builder_data} lang={lang} />
        </div>
      </div>

      {/* Mobile/Tablet drawer: portalowany do <body>, żeby uciec ze stacking
          contextu <header> (view-transition-name). Zawartość składana z
          klocków wg konfiguracji zarządzanej przez super-admina. */}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            id="mobile-header-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={siteName}
            className="fixed inset-0 z-[9999] lg:hidden"
          >
            <button
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              onClick={() => setOpen(false)}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in"
            />
            <div
              ref={drawerPanelRef}
              className="absolute inset-y-0 right-0 w-[min(88vw,360px)] bg-background shadow-2xl border-l border-border flex flex-col animate-in slide-in-from-right"
            >
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
                <span className="text-sm font-bold tracking-wider uppercase text-muted-foreground">
                  {t("common.menu")}
                </span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={closeA11y}
                  className="inline-flex items-center justify-center h-9 w-9 rounded-md text-foreground hover:bg-muted transition"
                >
                  <X className="w-5 h-5" aria-hidden />
                </button>
              </div>
              <MobileDrawerBody builderDoc={cfg.builder_data} onNavigate={() => setOpen(false)} />
            </div>
          </div>,
          document.body,
        )}
      <SearchOverlay
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        mode="fullscreen"
        heading={t("common.search")}
        liveResults
        limit={8}
        lang={lang}
      />
    </>
  );
}

export const Header = memo(function Header({ adPageType, contentKind = null }: HeaderProps) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const isHome = pathname === "/" || pathname === "/en" || pathname === "/en/";
  // Wpisy mają własny ReadingHeader po scrollu - tam nie robimy sticky/shrink,
  // żeby nie duplikować chrome'u (dwa przyklejone paski = pasek czytania i jego
  // akcje znikają pod mobilnym paskiem headera). Wszystkie pozostałe strony
  // (statyczne, archiwa, kategorie, profile itd.) zachowują się tak samo jak
  // home: sticky top-0 + shrink na scroll.
  //
  // Rozpoznanie wpisu idzie z loaderData (`contentKind`), a nie ze ścieżki -
  // kanoniczny adres wpisu to `<rodzic>/<slug>`, więc stary warunek
  // `pathname.startsWith("/post/")` nie łapał ŻADNEGO realnego wpisu.
  const headerMode = resolveHeaderMode({ pathname, contentKind });
  // Landing quizu jest jednoekranowy (iframe wypełnia widok), więc nie ma czego
  // przewijać - header startuje od razu w wersji minimalnej, dokładnie takiej,
  // jaką strona wpisu pokazuje po przewinięciu.
  const forceCompact = /^\/(en\/)?quiz\/?$/.test(pathname);
  const stickyShrink = headerMode === "sticky-shrink";
  const [scrolled, setScrolled] = useState(forceCompact);

  const headerRef = useRef<HTMLElement | null>(null);
  // `transform: scale()` rasteryzuje tekst w skali warstwy, więc zwinięty header
  // trzymał rozmyte napisy tak długo, jak długo strona była przewinięta.
  // Transform zostaje TYLKO na czas animacji (płynny, bez przeliczania układu),
  // a po jej ustaniu przełączamy się na `zoom`, które skaluje układ - litery
  // wracają do pełnej rozdzielczości urządzenia i są idealnie ostre.
  const [settled, setSettled] = useState(true);
  useEffect(() => {
    if (!stickyShrink || forceCompact) return;
    setSettled(false);
    const HDR_DURATION_MS = 460;
    const timer = window.setTimeout(() => setSettled(true), HDR_DURATION_MS + 40);
    return () => window.clearTimeout(timer);
  }, [scrolled, stickyShrink, forceCompact]);
  useEffect(() => {
    if (!stickyShrink || forceCompact) return;

    // Histereza + koalescencja w rAF: bez tego stan przełącza się wielokrotnie
    // na granicy progu (i przy każdym zdarzeniu scroll), co przerywa trwającą
    // tranzycję i daje efekt "poklatkowy".
    const SHRINK_AT = 96;
    const EXPAND_AT = 56;
    // Zwinięcie headera skraca dokument. Na krótkich stronach (wątek klubu bez
    // odpowiedzi, wąskie archiwum) ten ubytek potrafi być większy niż cały
    // zapas przewijania: przeglądarka przycina wtedy `scrollY` do zera, header
    // się rozwija, strona znów staje się przewijalna - i całość wpada w pętlę
    // widoczną jako drganie paska i podskakiwanie treści. Zwijamy więc wyłącznie
    // wtedy, gdy po zwinięciu nadal zostaje realny zapas przewijania.
    const MIN_SLACK = 240;
    let frame = 0;
    let current = false;
    const evaluate = () => {
      frame = 0;
      const y = window.scrollY;
      const slack = document.documentElement.scrollHeight - window.innerHeight;
      const next = slack < MIN_SLACK ? false : current ? y > EXPAND_AT : y > SHRINK_AT;
      if (next === current) return;
      current = next;
      setScrolled(next);
    };
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(evaluate);
    };
    evaluate();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [stickyShrink, forceCompact]);

  // Wymiary spoczynkowe headera potrzebne CSS-owi do zwijania (patrz styles.css):
  //   --hdr-nat   wysokość chrome'u w układzie (skala 1, ticker rozwinięty)
  //   --hdr-tt    wysokość paska "na czasie" (zwija się do zera)
  //   --hdr-extra to, co header ma ponad chrome (obramowanie)
  //
  // Zawartość skalujemy `transform`em, a ten nie zmienia wysokości w układzie -
  // header musi więc znać swoją docelową wysokość sam. Przy okazji daje to
  // rzecz najważniejszą dla wrażenia spokoju: `height` maleje o dokładnie tyle,
  // o ile rośnie `margin-bottom`, więc ślad headera w układzie strony jest
  // stały i treść pod nim ani drgnie (wcześniej podskakiwała o ~77 px, a każda
  // klatka animacji przeliczała pozycje całego dokumentu).
  //
  // Pomiar jest rzadki: montaż, resize okna, załadowanie fontów i realna zmiana
  // zawartości headera. ResizeObserver tylko odracza go do ustabilizowania się
  // rozmiaru, więc nigdy nie wypada w trakcie animacji. Gdy się nie uda (header
  // ukryty na landingach, chrome jeszcze nie zamontowany), data-metrics znika
  // i header po prostu się nie zmniejsza - lepiej brak efektu niż rozjechany
  // układ.
  useEffect(() => {
    const el = headerRef.current;
    if (!stickyShrink || !el) return;
    const SETTLE_MS = 160;
    let raf = 0;
    let timer = 0;

    const measure = () => {
      raf = 0;
      const chrome = el.querySelector<HTMLElement>(".site-header-chrome");
      if (!chrome) {
        delete el.dataset.metrics;
        return;
      }
      // Zdejmujemy data-metrics na czas odczytu: bez niego nie działa ani
      // skalowanie, ani zwijanie tickera, ani narzucona wysokość, więc mierzymy
      // wartości naturalne niezależnie od tego, czy header jest właśnie
      // zwinięty. Wszystko dzieje się synchronicznie, bez malowania pomiędzy,
      // a żadna z tych właściwości nie ma tranzycji - nic nie zdąży drgnąć.
      const previous = el.dataset.metrics;
      delete el.dataset.metrics;
      // offsetHeight to wysokość w układzie - `transform` jej nie zmienia,
      // więc odczyt jest odporny na trwającą animację.
      const natural = chrome.offsetHeight;
      const ticker = chrome.querySelector<HTMLElement>(".cms-trending");
      const tickerHeight = ticker ? ticker.offsetHeight : 0;
      const extra = el.offsetHeight - natural;

      if (natural > 0 && tickerHeight >= 0 && tickerHeight < natural && extra >= 0) {
        el.style.setProperty("--hdr-nat", `${natural}px`);
        el.style.setProperty("--hdr-tt", `${tickerHeight}px`);
        el.style.setProperty("--hdr-extra", `${extra}px`);
        el.dataset.metrics = "ready";
      } else if (previous) {
        el.dataset.metrics = previous;
      }
    };

    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (raf) return;
        raf = window.requestAnimationFrame(measure);
      }, SETTLE_MS);
    };

    measure();

    // Obserwujemy chrome, nie header: wysokość headera jest teraz narzucona
    // przez zmienne, więc obserwowanie jej wprost byłoby zapętleniem.
    //
    // Świadomie NIE ma tu drugiego, "żywego" obserwatora publikującego bieżącą
    // wysokość chrome'u w każdej klatce. Razem z animowaną szerokością tworzył
    // pętlę: skala -> nowa szerokość -> nawigacja przelewa się do 2 rzędu ->
    // większa wysokość -> --hdr-live -> skok wysokości paska. Szerokość chrome'u
    // jest teraz stała, więc pomiar spoczynkowy w zupełności wystarcza.
    const ro = new ResizeObserver(schedule);
    let chrome: Element | null = null;
    const attachChrome = () => {
      const next = el.querySelector(".site-header-chrome");
      if (next === chrome) return;
      if (chrome) ro.unobserve(chrome);
      chrome = next;
      if (chrome) {
        ro.observe(chrome);
        schedule();
      }
    };
    attachChrome();

    // Chrome montuje się dopiero gdy rozwiąże się <Suspense> nad HeaderInner.
    const mo = new MutationObserver(attachChrome);
    mo.observe(el, { childList: true });
    window.addEventListener("resize", schedule);
    if (document.fonts?.ready) void document.fonts.ready.then(schedule).catch(() => undefined);

    return () => {
      window.clearTimeout(timer);
      if (raf) window.cancelAnimationFrame(raf);
      ro.disconnect();

      mo.disconnect();
      window.removeEventListener("resize", schedule);
      delete el.dataset.metrics;
      el.style.removeProperty("--hdr-nat");
      el.style.removeProperty("--hdr-tt");
      el.style.removeProperty("--hdr-extra");
    };
  }, [stickyShrink]);

  // Kotwice (#newsletter itd.) nie mogą chować się pod sticky headerem -
  // mierzymy realną wysokość i publikujemy ją jako --sticky-header-h.
  //
  // KLUCZOWE DLA PŁYNNOŚCI ANIMACJI ZWIJANIA. Ta zmienna żyje na :root i czyta
  // ją reguła `[id] { scroll-margin-top: calc(var(--sticky-header-h) + 15px) }`,
  // czyli potencjalnie każdy element strony. Każdy zapis unieważnia więc style
  // CAŁEGO dokumentu. Poprzednia wersja robiła to w każdej klatce zwijania
  // (ResizeObserver widzi zmieniającą się wysokość headera), bo próg 1px nic nie
  // blokował - w szybkiej fazie animacji header zmienia się o kilka px na
  // klatkę. Pomiar nagrania pokazał dokładnie tam spadek do 30 fps ("poklatkowy"
  // ruch), podczas gdy w wygasającym ogonie animacji było równe 60 fps.
  //
  // Dlatego nie publikujemy nic w trakcie ruchu: ResizeObserver tylko odracza
  // pomiar, a wartość trafia na :root dopiero gdy wysokość ustabilizuje się na
  // SETTLE_MS. Dla kotwic to bez znaczenia (liczy się stan spoczynkowy), a
  // animacja dostaje wolne klatki. Pierwszy pomiar leci od razu, żeby wartość
  // była gotowa zanim ktokolwiek kliknie link do kotwicy.
  useEffect(() => {
    const root = document.documentElement;
    if (!stickyShrink) {
      root.style.setProperty("--sticky-header-h", "0px");
      return () => root.style.removeProperty("--sticky-header-h");
    }
    const el = headerRef.current;
    if (!el) return;
    const SETTLE_MS = 140;
    let frame = 0;
    let settle = 0;
    let last = -1;
    const apply = () => {
      frame = 0;
      const height = Math.round(el.getBoundingClientRect().height);
      if (height <= 0 || Math.abs(height - last) < 2) return;
      last = height;
      root.style.setProperty("--sticky-header-h", `${height}px`);
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(apply);
    };
    const scheduleAfterSettle = () => {
      window.clearTimeout(settle);
      settle = window.setTimeout(schedule, SETTLE_MS);
    };
    apply();
    const ro = new ResizeObserver(scheduleAfterSettle);
    ro.observe(el);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      ro.disconnect();
      root.style.removeProperty("--sticky-header-h");
    };
  }, [stickyShrink]);

  return (
    <header
      ref={headerRef}
      data-site-header
      data-header-mode={headerMode}
      data-scrolled={scrolled ? "true" : "false"}
      data-settled={settled ? "true" : "false"}
      className={
        (stickyShrink ? "sticky top-0 " : "relative ") +
        "z-40 bg-background border-b border-border site-header-shrink"
      }
      style={{ viewTransitionName: "site-header" }}
    >
      <Suspense fallback={<HeaderSkeleton />}>
        <HeaderInner adPageType={adPageType} isHome={isHome} />
      </Suspense>
    </header>
  );
});

Header.displayName = "Header";
