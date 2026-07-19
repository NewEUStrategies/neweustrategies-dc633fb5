// Sticky condensed reading header for single-post pages.
// Uses the SAME SearchButtonWidget as the builder header so the input is
// visually and behaviourally identical (live results, popover, clear button).
// Layout: [search] [current article title] [theme | account/login | lang]
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Bookmark, ChevronDown, LogIn, LogOut, Settings, User } from "@/lib/lucide-shim";
import { ThemeToggle } from "@/components/atoms/ThemeToggle";
import { LangSwitcherDropdown } from "@/components/admin/builder/ui/organisms/widget-view/chromeWidgets";
import { SearchButtonWidget } from "@/components/admin/builder/ui/organisms/widget-view/SearchButtonWidget";
import { NotificationsBell } from "@/components/notifications/NotificationsBell";
import { ChatBell } from "@/components/chat/ChatBell";
import { useAuth } from "@/hooks/useAuth";
import { useHeaderProfile } from "@/lib/profile/useHeaderProfile";
import { useHasMounted } from "@/hooks/useHasMounted";

interface Props {
  title: string;
  /** Reveal once the user has scrolled past this many pixels. */
  showAfter?: number;
}

const COPY = {
  pl: {
    reading: "aktualnie czytasz",
    search: "Szukaj",
    login: "Zaloguj",
    register: "Zarejestruj",
    profile: "Profil",
    account: "Konto",
    bookmarks: "Zapisane",
    settings: "Ustawienia",
    logout: "Wyloguj",
    lang: "Język",
    menu: "Menu konta",
  },
  en: {
    reading: "currently reading",
    search: "Search",
    login: "Sign in",
    register: "Sign up",
    profile: "Profile",
    account: "Account",
    bookmarks: "Bookmarks",
    settings: "Settings",
    logout: "Sign out",
    lang: "Language",
    menu: "Account menu",
  },
} as const;

export function ReadingHeader({ title, showAfter = 320 }: Props) {
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = (i18n.language ?? "pl").startsWith("en") ? "en" : "pl";
  const t = COPY[lang];
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

  const [visible, setVisible] = useState(false);
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

  useEffect(() => {
    const onScroll = (): void => setVisible(window.scrollY > showAfter);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [showAfter]);

  return (
    <div
      data-reading-header
      aria-hidden={!visible}
      // `inert` removes the hidden bar's links/inputs from the tab order -
      // an aria-hidden element must not contain focusable elements (axe:
      // aria-hidden-focus), otherwise keyboard users tab into invisible UI.
      inert={!visible}
      className={[
        "fixed inset-x-0 top-0 z-30",
        "border-b border-border/70 bg-background/95 backdrop-blur-xl",
        "shadow-[0_4px_20px_-12px_rgba(0,0,0,0.25)]",
        "transition-all duration-300 ease-out",
        visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-full pointer-events-none",
      ].join(" ")}
    >
      <style>{`
        /* Safe-space rules for the condensed reading header.
           The search mega-box popover is wider than the input; every ancestor
           of the widget must stay visible so it is never clipped by columns or
           sections with overflow:hidden in the builder/public wrapper. */
        [data-reading-header] :has(> .builder-search-widget),
        [data-reading-header] :has(.builder-search-widget) {
          overflow: visible !important;
        }
        [data-reading-header] .builder-search-widget {
          position: relative;
          z-index: 50;
        }
      `}</style>
      <div className="mx-auto max-w-[1400px] px-4 sm:px-5 lg:px-6 h-12 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 sm:gap-4 lg:gap-5">
        {/* Search - same widget as builder header, smaller in the condensed reading bar */}
        <div className="relative z-50 min-w-0 overflow-visible w-[160px] sm:w-[220px] lg:w-[280px]">
          <SearchButtonWidget
            label={t.search}
            mode="dropdown"
            heading={t.search}
            liveResults
            limit={8}
            lang={lang}
            height={28}
            radius={6}
            fontSize={12}
          />
        </div>

        {/* Reading: title */}
        <div className="min-w-0 flex items-center gap-2">
          <span className="hidden sm:inline text-[10px] font-bold tracking-[0.18em] text-brand shrink-0">
            {t.reading}:
          </span>
          <span
            className="truncate font-display text-[13.5px] sm:text-[14.5px] font-semibold text-foreground"
            title={title}
          >
            {title}
          </span>
        </div>

        {/* Right cluster */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          <ThemeToggle className="h-8 w-8 grid place-items-center" />
          <NotificationsBell panelWidth={320} />
          <ChatBell panelWidth={340} />
          <span className="hidden sm:block h-4 w-px bg-border" aria-hidden />
          <div className="hidden md:flex items-center gap-2 text-[12px] font-semibold">
            {isAuthed ? (
              <div ref={menuRef} className="relative">
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label={t.menu}
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
                      {t.profile}
                    </Link>
                    <Link
                      to="/profile/bookmarks"
                      role="menuitem"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-muted transition text-foreground"
                    >
                      <Bookmark className="w-3.5 h-3.5 opacity-70" />
                      {t.bookmarks}
                    </Link>
                    <Link
                      to="/profile/account"
                      role="menuitem"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-muted transition text-foreground"
                    >
                      <Settings className="w-3.5 h-3.5 opacity-70" />
                      {t.settings}
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
                      {t.logout}
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
                  {t.login}
                </Link>
                <span className="text-muted-foreground/60" aria-hidden>
                  |
                </span>
                <Link
                  to="/login"
                  className="inline-flex items-center gap-1 text-brand hover:opacity-80 transition"
                >
                  <User className="w-3.5 h-3.5" />
                  {t.register}
                </Link>
              </>
            )}
          </div>
          <span className="hidden md:block h-4 w-px bg-border" aria-hidden />
          <LangSwitcherDropdown label={t.lang} />
        </div>
      </div>
    </div>
  );
}
