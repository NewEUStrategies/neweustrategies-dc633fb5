// Atom: przełącznik języka dla edytorów (Elementor builder, Gutenberg blocks).
//
// Wygląd 1:1 z publicznym przełącznikiem w headerze strony głównej
// (`src/components/atoms/LangToggle.tsx`): dwie flagi emoji, aktywna pełna
// nieprzezroczystość, nieaktywna przygaszona. Różnica jest wyłącznie
// funkcjonalna - tu przełączamy edytowaną wersję językową treści, a nie język
// interfejsu, więc komponent jest sterowany (controlled).
import type { AppLang } from "@/lib/i18n/localePath";

export function EditorLangSwitch({
  lang,
  onLangChange,
  className,
}: {
  lang: AppLang;
  onLangChange: (lang: AppLang) => void;
  className?: string;
}) {
  const set = (target: AppLang) => {
    if (target !== lang) onLangChange(target);
  };

  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
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
