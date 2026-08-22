// Sticky condensed reading header for single-post pages.
// Uses the SAME SearchButtonWidget as the builder header so the input is
// visually and behaviourally identical (live results, popover, clear button).
// Layout: [search] [current article title] [theme | account/login | lang]
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
// Słownik powłoki czytania - efekt uboczny trzyma go w chunku, który go czyta.
import "@/lib/i18n-share";
import {
  Bookmark,
  ChevronDown,
  LogIn,
  LogOut,
  Menu,
  Search,
  Settings,
  User,
} from "@/lib/lucide-shim";
import { ThemeToggle } from "@/components/atoms/ThemeToggle";
import { SaveArticleButton } from "@/components/atoms/SaveArticleButton";
import { LangSwitcherDropdown } from "@/components/builder/organisms/widget-view/chromeWidgets";
import { LangReelSwitcher } from "@/components/atoms/LangReelSwitcher";
import { SearchButtonWidget } from "@/components/builder/organisms/widget-view/SearchButtonWidget";
import { NotificationsBell } from "@/components/notifications/NotificationsBell";
import { ChatBell } from "@/components/chat/ChatBell";
import { useAuth } from "@/hooks/useAuth";
import { useHeaderProfile } from "@/lib/profile/useHeaderProfile";
import { useHasMounted } from "@/hooks/useHasMounted";
import type { BookmarkEntityType } from "@/hooks/useBookmarks";
import { useSiteSetting } from "@/lib/useSiteSetting";
import { useTheme } from "@/components/ThemeProvider";
import { rafThrottle } from "@/lib/rafThrottle";

type ReadingHeaderThemeLogo = {
  logo?: {
    main?: string;
    main_dark?: string;
    mobile?: string;
    mobile_dark?: string;
  };
};

interface Props {
  title: string;
  /** Reveal once the user has scrolled past this many pixels. */
  showAfter?: number;
  /** Identifier of the current post/page for the "save for later" action. */
  entityId?: string;
  /** Type of entity being saved (post or page). Defaults to post. */
  entityType?: BookmarkEntityType;
  /**
   * Pasek jest widoczny od pierwszej klatki i nie zależy od przewijania.
   * Używane na jednoekranowych landingach (np. /quiz), gdzie ten minimalny
   * pasek jest JEDYNYM chrome'em strony.
   */
  pinned?: boolean;
  /**
   * Wyświetl logo marki w środkowej kolumnie zamiast etykiety
   * „aktualnie czytasz" + tytułu. Przydatne na landingach takich jak /quiz,
   * gdzie środkowy tytuł jest zbędny, a logo ma być bardziej widoczne.
   */
  centerLogo?: boolean;
  /**
   * Ukryj logo w lewej kolumnie (nad search widgetem). Używane razem z
   * `centerLogo`, żeby uniknąć podwójnego logo na stronach typu /quiz.
   */
  hideLeftLogo?: boolean;
}

export function ReadingHeader({
  title,
  showAfter = 320,
  entityId,
  entityType = "post",
  pinned = false,
  centerLogo = false,
  hideLeftLogo = false,
}: Props) {
  const { t: translate, i18n } = useTranslation();
  const lang: "pl" | "en" = (i18n.language ?? "pl").startsWith("en") ? "en" : "pl";
  // Napisy powłoki idą w języku, w którym czytelnik ma interfejs - `lang` jest
  // rozwiązany z instancji i18n wyżej, więc `lng` trzyma je zgodne z resztą.
  //
  // KLUCZ W CAŁOŚCI przy wywołaniu - patrz komentarz w `FloatingShareBar.tsx`:
  // wrapper doklejający prefiks oślepia bramkę `i18nKeyDrift`.
  const t = (key: string) => translate(key, { lng: lang });
  const mounted = useHasMounted();
  const { session, user, signOut } = useAuth();
  const { data: profile } = useHeaderProfile(user?.id);
  const displayName =
    profile?.display_name ||
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    user?.email?.split("@")[0] ||
    "";
  const initials = (displayName || "?")
    .split(" ")
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const isAuthed = mounted && !!session;

  // Horizontal logo (mobile variant = horizontal wordmark) resolved from
  // Branding → Logo settings, with dark-mode fallback chain identical to
  // the main site header, so the reading bar matches theme + tenant.
  const themeSettings = useSiteSetting<ReadingHeaderThemeLogo>("theme_options", {});
  const { theme: themeMode } = useTheme();
  const isDark = themeMode === "dark";
  const themeLogo = themeSettings.logo ?? {};
  const horizontalLogo = isDark
    ? themeLogo.mobile_dark || themeLogo.main_dark || themeLogo.mobile || themeLogo.main || ""
    : themeLogo.mobile || themeLogo.main || themeLogo.mobile_dark || themeLogo.main_dark || "";

  const [visible, setVisible] = useState(pinned);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // Close the menu automatically when the header hides on scroll-up.
  useEffect(() => {
    if (!visible) setMenuOpen(false);
  }, [visible]);

  // Przekazanie górnej krawędzi: pasek czytania pojawia się DOKŁADNIE wtedy, gdy
  // pasek serwisu wyjedzie z ekranu. Dwa efekty tego jednego warunku:
  //   * nigdy nie ma dwóch pasków naraz - gdy header jest sticky (strony, home),
  //     nie wyjeżdża, więc pasek czytania po prostu się nie pokazuje. Wcześniej
  //     próg 320 px odpalał go „w ciemno" i na wpisie leżał niewidoczny pod
  //     paskiem mobilnym razem ze swoimi akcjami;
  //   * nie ma dziury bez chrome'u - przejęcie następuje w tej samej klatce, w
  //     której header znika, niezależnie od jego wysokości (alert + „na czasie"
  //     + baner potrafią mieć razem grubo ponad 320 px).
  // IntersectionObserver zamiast matematyki na scrollu: zero odczytów layoutu w
  // handlerze scrolla (INP/TBT strony artykułu). Próg pikselowy zostaje jako
  // zapas dla widoków bez paska serwisu (np. własne chrome trasy).
  useEffect(() => {
    if (pinned) {
      setVisible(true);
      return;
    }
    const siteHeader = document.querySelector<HTMLElement>("[data-site-header]");
    if (siteHeader) {
      const io = new IntersectionObserver(
        (entries) => {
          const entry = entries[entries.length - 1];
          if (entry) setVisible(!entry.isIntersecting);
        },
        { threshold: 0 },
      );
      io.observe(siteHeader);
      return () => io.disconnect();
    }
    // rAF-throttle: przy szybkim scrollu handler odpala raz na klatkę,
    // nie raz na zdarzenie (INP/TBT strony artykułu).
    const onScroll = rafThrottle((): void => setVisible(window.scrollY > showAfter));
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      onScroll.cancel();
    };
  }, [showAfter, pinned]);

  return (
    <div
      data-reading-header
      aria-hidden={!visible}
      // `inert` removes the hidden bar's links/inputs from the tab order -
      // an aria-hidden element must not contain focusable elements (axe:
      // aria-hidden-focus), otherwise keyboard users tab into invisible UI.
      inert={!visible}
      className={[
        // z-[9990]: pasek czytania jest jedynym chrome'em na wpisie, więc musi
        // leżeć NAD mobilnym paskiem headera (z-9998 tylko gdy header jest
        // sticky - patrz lib/layout/headerMode) i pod overlayami, które mają go
        // przykrywać: drawer (9999) i SearchOverlay (10000). Przy z-30 dawał się
        // schować pod paskiem mobilnym - wtedy jego akcje były niedostępne.
        "fixed top-0 z-[9990]",
        pinned
          ? "inset-x-0 border-b border-border/70"
          : "left-2 right-2 sm:left-4 sm:right-4 lg:left-6 lg:right-6 rounded-b-xl sm:rounded-b-2xl border border-border/70",
        "bg-background/95 backdrop-blur-xl",
        "shadow-[0_4px_20px_-12px_rgba(0,0,0,0.25)]",
        "transition-all duration-300 ease-out",
        visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-full pointer-events-none",
      ].join(" ")}
    >
      <style>{`
        /* Safe-space rules for the condensed reading header.
           The search mega-box popover is wider than the input; every ancestor
           of the widget must stay visible so it is never clipped by columns or
           sections with overflow:hidden in the builder/public wrapper.

           WYJĄTEK: sam wiersz paska (data-reading-row). Reguła :has() łapała
           też jego, bo widget siedzi w środku - i zdejmowała mu poziomy clip,
           czyli dokładnie to zabezpieczenie, które ma trzymać pasek w
           szerokości ekranu. Wiersz przycina więc w poziomie, a w pionie
           zostaje widoczny, żeby popover nadal mógł wyjechać w dół. */
        [data-reading-header] :has(> .builder-search-widget):not([data-reading-row]),
        [data-reading-header] :has(.builder-search-widget):not([data-reading-row]) {
          overflow: visible !important;
        }
        [data-reading-header] [data-reading-row] {
          overflow-x: clip;
          overflow-y: visible;
        }
        [data-reading-header] .builder-search-widget {
          position: relative;
          z-index: 50;
        }
        /* Compact landscape mode: small phones held sideways have very little
           vertical space, so we shrink the bar further and hide non-essential
           chrome to prevent overlaps. */
        @media (max-height: 500px) and (orientation: landscape) {
          [data-reading-header] {
            height: 36px !important;
            overflow: hidden !important;
          }
          [data-reading-header] > div {
            height: 36px !important;
            padding-left: 0.5rem !important;
            padding-right: 0.5rem !important;
            gap: 0.375rem !important;
          }
          [data-reading-header] .builder-search-widget {
            max-width: 130px !important;
          }
          [data-reading-header] [data-reading-title] {
            font-size: 11px !important;
          }
          [data-reading-header] [data-reading-label],
          [data-reading-header] [data-reading-auth] {
            display: none !important;
          }
          [data-reading-header] button,
          [data-reading-header] [data-reading-icon] {
            height: 24px !important;
            width: 24px !important;
          }
          [data-reading-header] svg {
            width: 14px !important;
            height: 14px !important;
          }
        }
      `}</style>
      <div
        data-reading-row
        className="mx-auto w-full px-2.5 sm:px-4 lg:px-6 h-10 sm:h-11 lg:h-12 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 sm:gap-3 lg:gap-5"
      >
        {/* Kolumna 1 - nawigacja. Oba klastry (desktop + mobile) siedzą w tym
            samym torze gridu; tylko jeden z nich jest w danej chwili widoczny
            (`hidden sm:flex` / `flex sm:hidden`), więc tor ma zawsze szerokość
            dokładnie jednego z nich. */}
        <div className="flex min-w-0 items-center">
          {/* Search + horizontal logo cluster. Logo uses the same theme-aware
              Branding → Logo → Mobile asset as the main header, so dark/light
              variants align automatically. */}
          <div className="hidden sm:flex items-center gap-2 lg:gap-3 min-w-0">
            {!hideLeftLogo && (
              <Link
                to="/"
                aria-label="New European Strategies"
                data-reading-icon
                className="shrink-0 inline-flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded"
              >
                {horizontalLogo ? (
                  <img
                    src={horizontalLogo}
                    alt=""
                    className="h-6 lg:h-7 w-auto max-w-[140px] lg:max-w-[180px] object-contain"
                    loading="eager"
                    decoding="async"
                  />
                ) : (
                  <span className="font-display text-[12px] lg:text-[13px] font-bold tracking-tight text-foreground">
                    New European Strategies
                  </span>
                )}
              </Link>
            )}
            <div className="relative z-50 min-w-0 overflow-visible w-[160px] md:w-[200px] lg:w-[240px]">
              <SearchButtonWidget
                label={t("share.header.search")}
                mode="dropdown"
                heading={t("share.header.search")}
                liveResults
                limit={8}
                lang={lang}
                height={24}
                radius={6}
                fontSize={11}
              />
            </div>
          </div>

          {/* Mobile-only icon cluster replacing the search widget.
              Zawiera lupę i hamburger, które przez zdarzenia okna otwierają ten
              sam SearchOverlay i drawer co główny pasek mobilny - bez tego po
              scrollu na wpisie użytkownik traci dostęp do menu i szukania. */}
          <div className="flex sm:hidden items-center gap-1 min-w-0">
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event("neus:open-mobile-search"))}
              aria-label={t("share.header.search")}
              title={t("share.header.search")}
              className="h-7 w-7 grid place-items-center rounded-md transition shrink-0 text-foreground hover:text-brand hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            >
              <Search className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event("neus:open-mobile-menu"))}
              aria-label={t("share.header.menu")}
              title={t("share.header.menu")}
              className="h-7 w-7 grid place-items-center rounded-md transition shrink-0 text-foreground hover:text-brand hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            >
              <Menu className="w-4 h-4" />
            </button>
            {/* Dzwonki (powiadomienia/czat) na wąskich ekranach są dostępne w
                drawerze i profilu - w pasku czytania poszerzały wiersz ponad
                szerokość viewportu. Język i konto zostają: pasek czytania jest
                na wpisie JEDYNYM chrome'em, więc musi je udostępniać. */}
            <LangReelSwitcher label={t("share.header.lang")} className="[--ls-h:28px]" />
            <Link
              to={isAuthed ? "/profile" : "/login"}
              aria-label={t("share.header.profile")}
              title={t("share.header.profile")}
              className="hidden min-[400px]:grid h-7 w-7 place-items-center rounded-md transition shrink-0 text-foreground hover:text-brand hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            >
              {profile?.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt=""
                  className="h-5 w-5 rounded-full object-cover"
                />
              ) : (
                <User className="w-4 h-4" />
              )}
            </Link>
          </div>
        </div>

        {/* Reading: title (or centered logo for single-screen landings) */}
        <div className="min-w-0 flex items-center justify-center gap-1.5 sm:gap-2">
          {centerLogo ? (
            <Link
              to="/"
              aria-label="New European Strategies"
              data-reading-title
              className="inline-flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded"
            >
              {horizontalLogo ? (
                <img
                  src={horizontalLogo}
                  alt=""
                  className="h-6 sm:h-7 lg:h-8 w-auto max-w-[160px] sm:max-w-[200px] lg:max-w-[240px] object-contain"
                  loading="eager"
                  decoding="async"
                />
              ) : (
                <span className="font-display text-[13px] sm:text-[14px] lg:text-[15px] font-bold tracking-tight text-foreground">
                  New European Strategies
                </span>
              )}
            </Link>
          ) : (
            <>
              <span
                data-reading-label
                className="hidden sm:inline text-[9px] sm:text-[10px] font-bold tracking-[0.18em] text-brand shrink-0"
              >
                {t("share.header.reading")}:
              </span>
              <span
                data-reading-title
                className="truncate font-display text-[12px] sm:text-[13.5px] lg:text-[14.5px] font-semibold text-foreground"
                title={title}
              >
                {title}
              </span>
            </>
          )}
        </div>

        {/* Right cluster - akcje czytania.
            „Zapisz na później" idzie PIERWSZE: to główna akcja paska czytania i
            po wyjściu z ukrycia (wcześniej cały pasek leżał pod paskiem
            mobilnym) ma być najbliżej kciuka. Współdzielony atom trzyma ten sam
            stan zapisu co panel czytania i arkusz mobilny. */}
        <div className="flex items-center gap-1 sm:gap-1.5 lg:gap-2 shrink-0">
          {entityId && (
            <SaveArticleButton
              title={title}
              lang={lang}
              entityId={entityId}
              entityType={entityType}
              className="sm:h-8 sm:w-8"
            />
          )}
          <ThemeToggle
            data-reading-icon
            className="h-7 w-7 sm:h-8 sm:w-8 grid place-items-center"
          />
          <div data-reading-icon className="hidden sm:flex h-7 sm:h-8 items-center">
            <NotificationsBell panelWidth={280} />
          </div>
          <div data-reading-icon className="hidden sm:flex h-7 sm:h-8 items-center">
            <ChatBell panelWidth={300} />
          </div>
          <span className="hidden sm:block h-4 w-px bg-border" aria-hidden />
          <div
            data-reading-auth
            className="hidden md:flex items-center gap-2 text-[12px] font-semibold"
          >
            {isAuthed ? (
              <div ref={menuRef} className="relative">
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label={t("share.header.menu")}
                  onClick={() => setMenuOpen((s) => !s)}
                  className="inline-flex items-center gap-1.5 rounded-md pl-1 pr-2 py-1 text-foreground hover:bg-muted transition"
                  title={displayName}
                >
                  {profile?.avatar_url ? (
                    <img
                      src={profile.avatar_url}
                      alt=""
                      className="h-6 w-6 rounded-md object-cover"
                    />
                  ) : (
                    <span className="h-6 w-6 rounded-md bg-muted grid place-items-center text-[10px] font-bold text-muted-foreground">
                      {initials}
                    </span>
                  )}
                  <span className="max-w-[10rem] truncate">{displayName}</span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 opacity-60 transition-transform ${menuOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {menuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 top-full mt-1 z-50 min-w-[13rem] rounded-md border border-border bg-popover shadow-lg py-1 text-[12.5px]"
                  >
                    <div className="px-3 py-2 border-b border-border/70">
                      <p className="truncate font-semibold text-foreground">{displayName}</p>
                      {user?.email && (
                        <p className="truncate text-[11px] font-normal text-muted-foreground">
                          {user.email}
                        </p>
                      )}
                    </div>
                    <Link
                      to="/profile"
                      role="menuitem"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-muted transition text-foreground"
                    >
                      <User className="w-3.5 h-3.5 opacity-70" />
                      {t("share.header.profile")}
                    </Link>
                    <Link
                      to="/profile/bookmarks"
                      role="menuitem"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-muted transition text-foreground"
                    >
                      <Bookmark className="w-3.5 h-3.5 opacity-70" />
                      {t("share.header.bookmarks")}
                    </Link>
                    <Link
                      to="/profile/edit"
                      role="menuitem"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-muted transition text-foreground"
                    >
                      <Settings className="w-3.5 h-3.5 opacity-70" />
                      {t("share.header.settings")}
                    </Link>
                    <div className="my-1 border-t border-border/70" aria-hidden />
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        void signOut();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted transition text-muted-foreground hover:text-brand"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      {t("share.header.logout")}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <Link
                  to="/login"
                  className="inline-flex items-center gap-1 text-foreground hover:text-brand transition"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  {t("share.header.login")}
                </Link>
                <span className="text-muted-foreground/60" aria-hidden>
                  |
                </span>
                <Link
                  to="/login"
                  className="inline-flex items-center gap-1 text-brand hover:opacity-80 transition"
                >
                  <User className="w-3.5 h-3.5" />
                  {t("share.header.register")}
                </Link>
              </>
            )}
          </div>
          <span className="hidden md:block h-4 w-px bg-border" aria-hidden />
          <div className="hidden sm:flex h-7 sm:h-8 items-center">
            <LangSwitcherDropdown label={t("share.header.lang")} />
          </div>
        </div>
      </div>
    </div>
  );
}
