// Sticky condensed reading header for single-post pages.
// Appears when the user scrolls past the article hero.
// Layout: [search] [current article title] [theme | login/register | lang]
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Search as SearchIcon, LogIn, UserPlus } from "@/lib/lucide-shim";
import { ThemeToggle } from "@/components/atoms/ThemeToggle";
import { LangToggle } from "@/components/atoms/LangToggle";

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
  },
  en: {
    reading: "READING",
    search: "Search",
    login: "Sign in",
    register: "Sign up",
  },
} as const;

export function ReadingHeader({ title, showAfter = 320 }: Props) {
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = (i18n.language ?? "pl").startsWith("en") ? "en" : "pl";
  const t = COPY[lang];

  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const onScroll = (): void => setVisible(window.scrollY > showAfter);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [showAfter]);

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    void navigate({ to: "/search", search: { q } });
  };

  return (
    <div
      data-reading-header
      aria-hidden={!visible}
      className={[
        "fixed inset-x-0 top-0 z-30",
        "border-b border-border/70 bg-background/95 backdrop-blur-xl",
        "shadow-[0_4px_20px_-12px_rgba(0,0,0,0.25)]",
        "transition-all duration-300 ease-out",
        visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-full pointer-events-none",
      ].join(" ")}
    >
      <div className="mx-auto max-w-[1400px] px-3 sm:px-5 h-12 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 sm:gap-5">
        {/* Search */}
        <form
          onSubmit={onSubmit}
          role="search"
          className="flex items-center gap-1.5 h-8 px-2.5 rounded-[5px] border border-border bg-muted/40 focus-within:bg-background focus-within:border-brand/60 transition w-[160px] sm:w-[220px] lg:w-[280px]"
        >
          <SearchIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.search}
            aria-label={t.search}
            className="bg-transparent outline-none text-[12.5px] w-full min-w-0 placeholder:text-muted-foreground"
          />
        </form>

        {/* Reading: title */}
        <div className="min-w-0 flex items-center gap-2">
          <span className="hidden sm:inline text-[10px] font-bold tracking-[0.18em] text-brand shrink-0">
            {t.reading}:
          </span>
          <span className="truncate font-display text-[13.5px] sm:text-[14.5px] font-semibold text-foreground" title={title}>
            {title}
          </span>
        </div>

        {/* Right cluster */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          <ThemeToggle className="h-8 w-8 grid place-items-center" />
          <span className="hidden sm:block h-4 w-px bg-border" aria-hidden />
          <div className="hidden md:flex items-center gap-2 text-[12px] font-semibold">
            <Link
              to="/login"
              className="inline-flex items-center gap-1 text-foreground hover:text-brand transition"
            >
              <LogIn className="w-3.5 h-3.5" />
              {t.login}
            </Link>
            <span className="text-muted-foreground/60" aria-hidden>|</span>
            <Link
              to="/login"
              className="inline-flex items-center gap-1 text-brand hover:opacity-80 transition"
            >
              <UserPlus className="w-3.5 h-3.5" />
              {t.register}
            </Link>
          </div>
          <span className="hidden md:block h-4 w-px bg-border" aria-hidden />
          <LangToggle />
        </div>
      </div>
    </div>
  );
}
