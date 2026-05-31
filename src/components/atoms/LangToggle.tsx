import { useTranslation } from "react-i18next";

type Lang = "pl" | "en";

export function LangToggle() {
  const { i18n } = useTranslation();
  const lang: Lang = (i18n.language ?? "pl").startsWith("en") ? "en" : "pl";
  const set = (l: Lang) => i18n.changeLanguage(l);

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
