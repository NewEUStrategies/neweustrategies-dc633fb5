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
    reading: "CZYTASZ",
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
    reading: "READING",
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
      <div className="mx-auto max-w-[1400px] px-3 sm:px-5 h-12 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 sm:gap-5">
        {/* Search - same widget as builder header */}
        <div className="w-[180px] sm:w-[240px] lg:w-[300px]">
          <SearchButtonWidget
            label={t.search}
            mode="dropdown"
            heading={t.search}
            liveResults
            limit={8}
            lang={lang}
            height={32}
            radius={5}
            fontSize={13}
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
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          <ThemeToggle className="h-8 w-8 grid place-items-center" />
          <span className="hidden sm:block h-4 w-px bg-border" aria-hidden />
          <div className="hidden md:flex items-center gap-2 text-[12px] font-semibold">
            {isAuthed ? (
              <>
                <Link
                  to="/profile"
                  className="inline-flex items-center gap-1.5 text-foreground hover:text-brand transition"
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
                </Link>
                <span className="text-muted-foreground/60" aria-hidden>
                  |
                </span>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="inline-flex items-center gap-1 text-muted-foreground hover:text-brand transition"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  {t.logout}
                </button>
              </>
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
