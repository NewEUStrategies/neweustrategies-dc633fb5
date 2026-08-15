// Atom: przełącznik języka dla edytorów (Elementor builder, Gutenberg blocks).
//
// Wygląd 1:1 z widgetem "language switch" (LangSwitcherDropdown w
// widget-view/chromeWidgets.tsx): segment z animowanym thumbem, flagi SVG,
// aktywna opcja rozszerza się i pokazuje kod języka. Różnica jest wyłącznie
// funkcjonalna - tu przełączamy edytowaną wersję językową treści, a nie język
// interfejsu, więc komponent jest sterowany (controlled) i nie nawiguje.
import { useTranslation } from "react-i18next";

import type { AppLang } from "@/lib/i18n/localePath";

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
        <clipPath id="uj-diag-editor">
          <polygon points="0,0 30,20 60,0 60,4 34,20 60,36 60,40 30,20 0,40 0,36 26,20 0,4" />
        </clipPath>
      </defs>
      <rect width="60" height="40" fill="#012169" />
      <path d="M0,0 L60,40 M60,0 L0,40" stroke="#ffffff" strokeWidth="8" />
      <path
        d="M0,0 L60,40 M60,0 L0,40"
        stroke="#C8102E"
        strokeWidth="4"
        clipPath="url(#uj-diag-editor)"
      />
      <path d="M30,0 v40 M0,20 h60" stroke="#ffffff" strokeWidth="10" />
      <path d="M30,0 v40 M0,20 h60" stroke="#C8102E" strokeWidth="6" />
    </svg>
  );
}

export function EditorLangSwitch({
  lang,
  onLangChange,
  className,
}: {
  lang: AppLang;
  onLangChange: (lang: AppLang) => void;
  className?: string;
}) {
  const { t } = useTranslation();

  const options: ReadonlyArray<{ lang: AppLang; flag: FlagCode; name: string }> = [
    { lang: "pl", flag: "pl", name: t("common.lang.pl") },
    { lang: "en", flag: "gb", name: t("common.lang.en") },
  ];

  const isLastActive = lang === "en";

  return (
    <div
      className={`lang relative inline-flex p-[2px] rounded-[6px] border border-black/10 bg-[#f4f4f2] dark:border-white/10 dark:bg-[#27272a] ${className ?? ""}`}
      role="group"
      aria-label={t("admin.language")}
    >
      <div
        className="lang__thumb absolute top-[2px] left-[2px] w-14 h-6 rounded-[6px] bg-white border border-black/[0.08] transition-transform duration-[340ms] ease-[cubic-bezier(.32,.72,0,1)] will-change-transform dark:bg-[#18181b] dark:border-white/[0.08]"
        style={{ transform: isLastActive ? "translateX(32px)" : "translateX(0)" }}
      />
      {options.map((option) => {
        const active = lang === option.lang;
        return (
          <button
            key={option.lang}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!active) onLangChange(option.lang);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={option.name}
            aria-pressed={active}
            title={option.name}
            className={`lang__opt relative z-[1] h-6 inline-flex items-center justify-center gap-1.5 text-[11px] font-medium leading-none transition-[width,color] duration-[280ms] ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--brand,#2563eb)] focus-visible:rounded-[6px] motion-reduce:duration-[1ms] ${
              active ? "w-14" : "w-8"
            } ${
              active
                ? "is-active text-[#111] dark:text-[#f4f4f2]"
                : "text-[#8a8a85] hover:text-[#444] dark:hover:text-[#d4d4d8]"
            }`}
          >
            <span className="lang__flag block w-[18px] h-3 rounded-[2px] overflow-hidden border border-black/12 dark:border-white/15">
              <FlagSvg code={option.flag} />
            </span>
            {active && <span className="uppercase">{option.lang}</span>}
          </button>
        );
      })}
    </div>
  );
}
