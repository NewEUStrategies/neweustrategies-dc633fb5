import { useUiLangSwitch } from "@/lib/i18n/switchUiLanguage";

export function LangToggle() {
  // Wspólna ścieżka przełączenia (src/lib/i18n/switchUiLanguage.ts): język
  // klienta przed nawigacją, ten sam adres w nowym języku (z query i hashem),
  // a poza RouterProvider twarda nawigacja zamiast TypeErrora na `router.state`.
  const { current: lang, switchTo: set } = useUiLangSwitch();

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
