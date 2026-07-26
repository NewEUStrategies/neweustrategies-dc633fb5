// Small site-chrome widgets (header/footer), extracted from SimpleWidgets.

import { useTranslation } from "react-i18next";
import { useRouter } from "@tanstack/react-router";
import * as LucideIcons from "@/lib/lucide-shim";
import { useTheme } from "@/components/ThemeProvider";
import { localizedPath, stripLangPrefix, type AppLang } from "@/lib/i18n/localePath";
import { setClientLang } from "@/lib/i18n/localeRuntime";

type FlagCode = "pl" | "gb";

function FlagSvg({ code }: { code: FlagCode }) {
  if (code === "pl") {
    return (
      <svg viewBox="0 0 30 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect width="30" height="10" fill="#ffffff" />
        <rect y="10" width="30" height="10" fill="#dc143c" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 60 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <clipPath id="uj-diag">
          <polygon points="0,0 30,20 60,0 60,4 34,20 60,36 60,40 30,20 0,40 0,36 26,20 0,4" />
        </clipPath>
      </defs>
      <rect width="60" height="40" fill="#012169" />
      <path d="M0,0 L60,40 M60,0 L0,40" stroke="#ffffff" strokeWidth="8" />
      <path
        d="M0,0 L60,40 M60,0 L0,40"
        stroke="#C8102E"
        strokeWidth="4"
        clipPath="url(#uj-diag)"
      />
      <path d="M30,0 v40 M0,20 h60" stroke="#ffffff" strokeWidth="10" />
      <path d="M30,0 v40 M0,20 h60" stroke="#C8102E" strokeWidth="6" />
    </svg>
  );
}

export function LangSwitcherDropdown({ label }: { label: string }) {
  const { i18n } = useTranslation();
  const router = useRouter({ warn: false });
  const current: AppLang = (i18n.language ?? "pl").startsWith("en") ? "en" : "pl";

  const switchTo = (target: AppLang) => {
    if (target === current) return;
    setClientLang(target);
    void i18n.changeLanguage(target);
    try {
      localStorage.setItem("i18nextLng", target);
      document.documentElement.lang = target;
    } catch {
      /* noop */
    }
    const currentPath =
      router?.state?.location?.pathname ??
      (typeof window !== "undefined" ? window.location.pathname : "/");
    const internal = stripLangPrefix(currentPath).pathname;
    const href = localizedPath(internal, target);
    if (router) {
      try {
        void router.navigate({ href, replace: true, resetScroll: false });
        return;
      } catch {
        /* fallthrough */
      }
    }
    if (typeof window !== "undefined") window.location.href = href;
  };

  const tiles: ReadonlyArray<{ lang: AppLang; flag: FlagCode; name: string }> = [
    { lang: "pl", flag: "pl", name: "Polski" },
    { lang: "en", flag: "gb", name: "English" },
  ];

  return (
    <div
      className="lang-switch-tiles inline-flex items-center gap-2"
      role="group"
      aria-label={label}
    >
      {tiles.map(({ lang, flag, name }) => {
        const active = current === lang;
        return (
          <button
            key={lang}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              switchTo(lang);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={name}
            aria-pressed={active}
            title={name}
            className={`lang-tile block overflow-hidden transition-[filter,opacity,transform] duration-300 ease-out motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--brand,#2563eb)] ${
              active
                ? "opacity-100 scale-105"
                : "opacity-45 grayscale hover:opacity-75"
            }`}
            style={{
              width: 30,
              height: 20,
              borderRadius: 6,
              boxShadow: "inset 0 0 0 1px rgba(0,0,0,.14)",
            }}
          >
            <FlagSvg code={flag} />
          </button>
        );
      })}
    </div>
  );
}

export function ThemeToggleWidget() {
  const { theme, toggle } = useTheme();
  const { t } = useTranslation();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={isDark ? t("common.preview.lightMode") : t("common.preview.darkMode")}
      title={isDark ? t("common.preview.lightMode") : t("common.preview.darkMode")}
      className="inline-flex items-center justify-center w-8 h-8 rounded-full text-foreground hover:text-brand transition-colors duration-200 ease-out active:scale-95"
    >
      <span
        key={isDark ? "sun" : "moon"}
        className="inline-flex items-center justify-center transition-transform duration-300 ease-out"
      >
        {isDark ? (
          <LucideIcons.Sun className="w-4 h-4" aria-hidden="true" />
        ) : (
          <LucideIcons.Moon className="w-4 h-4" aria-hidden="true" />
        )}
      </span>
    </button>
  );
}
