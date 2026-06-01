import { useTranslation } from "react-i18next";
import { Globe } from "@/lib/lucide-shim";

/**
 * AdminLangBar
 * Sticky top-right PL/EN toggle, always visible across the entire admin panel
 * (also when AdminShell is rendered with `hideSidebar`). Persistence is handled
 * by the i18n module (`languageChanged` -> localStorage).
 */
export function AdminLangBar() {
  const { i18n, t } = useTranslation();
  const lang = (i18n.language ?? "pl").startsWith("en") ? "en" : "pl";

  const set = (l: "pl" | "en") => {
    if (l !== lang) void i18n.changeLanguage(l);
  };

  const btn = (active: boolean) =>
    `px-2 py-1 text-xs font-medium rounded-md transition ${
      active
        ? "bg-brand text-brand-foreground shadow-sm"
        : "text-muted-foreground hover:text-foreground hover:bg-muted"
    }`;

  return (
    <div
      role="group"
      aria-label={t("admin.language")}
      className="fixed top-3 right-3 z-50 flex items-center gap-1 rounded-lg border border-border bg-card/95 backdrop-blur px-1.5 py-1 shadow-sm"
    >
      <Globe className="w-3.5 h-3.5 text-muted-foreground ml-1" aria-hidden />
      <button type="button" onClick={() => set("pl")} className={btn(lang === "pl")} aria-pressed={lang === "pl"}>
        PL
      </button>
      <button type="button" onClick={() => set("en")} className={btn(lang === "en")} aria-pressed={lang === "en"}>
        EN
      </button>
    </div>
  );
}
