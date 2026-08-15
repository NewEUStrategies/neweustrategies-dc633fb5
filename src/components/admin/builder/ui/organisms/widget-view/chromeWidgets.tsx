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
      <path d="M0,0 L60,40 M60,0 L0,40" stroke="#C8102E" strokeWidth="4" clipPath="url(#uj-diag)" />
      <path d="M30,0 v40 M0,20 h60" stroke="#ffffff" strokeWidth="10" />
      <path d="M30,0 v40 M0,20 h60" stroke="#C8102E" strokeWidth="6" />
    </svg>
  );
}

/**
 * Przełącznik języka PL/EN.
 *
 * `label` zawsze opisuje kontrolkę czytnikowi ekranu (`aria-label`).
 * Widoczny pozostaje wyłącznie parę flag z animowanym kciukiem - bez
 * tekstowej etykiety obok przełącznika.
 */
export function LangSwitcherDropdown({ label }: { label: string }) {
  const { i18n, t } = useTranslation();
  const router = useRouter({ warn: false });
  const routerPath = router?.state?.location?.pathname ?? "/";
  const pathLang = stripLangPrefix(routerPath).lang;
  const current: AppLang = pathLang ?? ((i18n.language ?? "pl").startsWith("en") ? "en" : "pl");

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

  const options: ReadonlyArray<{ lang: AppLang; flag: FlagCode; name: string }> = [
    { lang: "pl", flag: "pl", name: t("common.lang.pl") },
    { lang: "en", flag: "gb", name: t("common.lang.en") },
  ];

  const isLastActive = current === "en";

  return (
    <div
      className="lang relative inline-flex p-[2px] rounded-[6px] border border-black/10 bg-[#f4f4f2] dark:border-white/10 dark:bg-[#27272a]"
      role="group"
      aria-label={label}
    >
      <div
        className="lang__thumb absolute top-[2px] left-[2px] w-14 h-6 rounded-[6px] bg-white border border-black/[0.08] transition-transform duration-[340ms] ease-[cubic-bezier(.32,.72,0,1)] will-change-transform dark:bg-[#18181b] dark:border-white/[0.08]"
        style={{
          transform: isLastActive ? "translateX(32px)" : "translateX(0)",
        }}
      />
      {options.map(({ lang, flag, name }) => {
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
            className={`lang__opt relative z-[1] h-6 inline-flex items-center justify-center gap-1.5 text-[11px] font-medium leading-none transition-[width,color] duration-[280ms] ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--brand,#2563eb)] focus-visible:rounded-[6px] motion-reduce:duration-[1ms] ${
              active ? "w-14" : "w-8"
            } ${
              active
                ? "is-active text-[#111] dark:text-[#f4f4f2]"
                : "text-[#8a8a85] hover:text-[#444] dark:hover:text-[#d4d4d8]"
            }`}
          >
            <span className="lang__flag block w-[18px] h-3 rounded-[2px] overflow-hidden border border-black/12 dark:border-white/15">
              <FlagSvg code={flag} />
            </span>
            {active && <span className="uppercase">{lang}</span>}
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
