import { useTranslation } from "react-i18next";
import { useRouter } from "@tanstack/react-router";

import { localizedPath, stripLangPrefix, type AppLang } from "@/lib/i18n/localePath";
import { setClientLang } from "@/lib/i18n/localeRuntime";

export function LangToggle() {
  const { i18n } = useTranslation();
  const router = useRouter();
  const lang: AppLang = (i18n.language ?? "pl").startsWith("en") ? "en" : "pl";

  const set = (target: AppLang) => {
    if (target === lang) return;
    // Sync the router's `output` rewrite to the new language *before* navigating
    // so the next href carries the right "/en" prefix, independent of i18next's
    // async changeLanguage. The URL is the source of truth, so we navigate to
    // the same page's localized path - the route re-renders in the new language
    // and the canonical / hreflang follow automatically.
    setClientLang(target);
    void i18n.changeLanguage(target);
    const internal = stripLangPrefix(router.state.location.pathname).pathname;
    void router.navigate({
      href: localizedPath(internal, target),
      replace: true,
      resetScroll: false,
    });
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => set("en")}
        type="button"
        aria-label="English"
        aria-pressed={lang === "en"}
        className={`text-base leading-none transition ${lang === "en" ? "opacity-100" : "opacity-60 hover:opacity-100"}`}
      >
        🇬🇧
      </button>
      <button
        onClick={() => set("pl")}
        type="button"
        aria-label="Polski"
        aria-pressed={lang === "pl"}
        className={`text-base leading-none transition ${lang === "pl" ? "opacity-100" : "opacity-60 hover:opacity-100"}`}
      >
        🇵🇱
      </button>
    </div>
  );
}
