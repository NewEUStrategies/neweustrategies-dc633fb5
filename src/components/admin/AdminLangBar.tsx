import { useTranslation } from "react-i18next";

/**
 * AdminLangBar
 * Compact segmented PL/EN toggle. Rendered only when the admin sidebar is
 * hidden (e.g. on full-screen editors), so it does not duplicate the
 * language switch that already lives in the sidebar footer.
 */
export function AdminLangBar() {
  const { i18n, t } = useTranslation();
  const lang: "pl" | "en" = (i18n.language ?? "pl").startsWith("en") ? "en" : "pl";

  const set = (l: "pl" | "en") => {
    if (l !== lang) void i18n.changeLanguage(l);
  };

  return (
    <div
      role="group"
      aria-label={t("admin.language")}
      className="fixed top-3 right-3 z-50 inline-flex items-center rounded-full border border-border bg-card/90 p-0.5 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/70"
    >
      <button
        type="button"
        onClick={() => set("pl")}
        aria-pressed={lang === "pl"}
        className={`min-w-[2.25rem] px-3 py-1 text-[11px] font-semibold tracking-wide rounded-full transition ${
          lang === "pl"
            ? "bg-foreground text-background"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        PL
      </button>
      <button
        type="button"
        onClick={() => set("en")}
        aria-pressed={lang === "en"}
        className={`min-w-[2.25rem] px-3 py-1 text-[11px] font-semibold tracking-wide rounded-full transition ${
          lang === "en"
            ? "bg-foreground text-background"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        EN
      </button>
    </div>
  );
}
