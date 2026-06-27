// Sticky condensed reading header for single-post pages.
// Uses the SAME SearchButtonWidget as the builder header so the input is
// visually and behaviourally identical (live results, popover, clear button).
// Layout: [search] [current article title] [theme | login/register | lang]
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { LogIn, User } from "@/lib/lucide-shim";
import { ThemeToggle } from "@/components/atoms/ThemeToggle";
import { LangToggle } from "@/components/atoms/LangToggle";
import { SearchButtonWidget } from "@/components/admin/builder/ui/organisms/widget-view/SearchButtonWidget";

interface Props {
  title: string;
  /** Reveal once the user has scrolled past this many pixels. */
  showAfter?: number;
}

const COPY = {
  pl: { reading: "CZYTASZ", search: "Szukaj", login: "Zaloguj", register: "Zarejestruj" },
  en: { reading: "READING", search: "Search", login: "Sign in", register: "Sign up" },
} as const;

export function ReadingHeader({ title, showAfter = 320 }: Props) {
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = (i18n.language ?? "pl").startsWith("en") ? "en" : "pl";
  const t = COPY[lang];

  const [visible, setVisible] = useState(false);

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
          <span className="truncate font-display text-[13.5px] sm:text-[14.5px] font-semibold text-foreground" title={title}>
            {title}
          </span>
        </div>

        {/* Right cluster */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          <ThemeToggle className="h-8 w-8 grid place-items-center" />
          <span className="hidden sm:block h-4 w-px bg-border" aria-hidden />
          <div className="hidden md:flex items-center gap-2 text-[12px] font-semibold">
            <Link to="/login" className="inline-flex items-center gap-1 text-foreground hover:text-brand transition">
              <LogIn className="w-3.5 h-3.5" />
              {t.login}
            </Link>
            <span className="text-muted-foreground/60" aria-hidden>|</span>
            <Link to="/login" className="inline-flex items-center gap-1 text-brand hover:opacity-80 transition">
              <User className="w-3.5 h-3.5" />
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

