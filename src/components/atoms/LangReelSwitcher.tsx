// Mobilny przełącznik języka w formie "taśmy": w spoczynku widać aktywny
// język, a hover / focus / tap odsłania język docelowy przesunięciem w pionie.
import type { AppLang } from "@/lib/i18n/localePath";
import { useUiLangSwitch } from "@/lib/i18n/switchUiLanguage";
import { cn } from "@/lib/utils";

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
        <clipPath id="uj-diag-reel">
          <polygon points="0,0 30,20 60,0 60,4 34,20 60,36 60,40 30,20 0,40 0,36 26,20 0,4" />
        </clipPath>
      </defs>
      <rect width="60" height="40" fill="#012169" />
      <path d="M0,0 L60,40 M60,0 L0,40" stroke="#ffffff" strokeWidth="8" />
      <path
        d="M0,0 L60,40 M60,0 L0,40"
        stroke="#C8102E"
        strokeWidth="4"
        clipPath="url(#uj-diag-reel)"
      />
      <path d="M30,0 v40 M0,20 h60" stroke="#ffffff" strokeWidth="10" />
      <path d="M30,0 v40 M0,20 h60" stroke="#C8102E" strokeWidth="6" />
    </svg>
  );
}

const FLAGS: Record<AppLang, FlagCode> = { pl: "pl", en: "gb" };

export function LangReelSwitcher({ label, className }: { label: string; className?: string }) {
  // Wspólna ścieżka przełączenia (src/lib/i18n/switchUiLanguage.ts) - ta sama
  // co w `LangToggle` i widgecie "language switch" buildera.
  const { current, switchTo } = useUiLangSwitch();
  const target: AppLang = current === "pl" ? "en" : "pl";

  return (
    <button
      type="button"
      onClick={() => switchTo(target)}
      aria-label={`${label}: ${current.toUpperCase()} ${target.toUpperCase()}`}
      title={`${label}: ${target.toUpperCase()}`}
      className={cn(
        "lang-switch shrink-0 rounded-[6px] bg-[#f4f4f2] p-[2px] dark:bg-[#27272a]",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--brand,#2563eb)]",
        className,
      )}
    >
      <span className="lang-switch__window block w-14 rounded-[4px]">
        <span className="lang-switch__track">
          {[current, target].map((lang, i) => (
            <span
              key={`${lang}-${i}`}
              className="lang-switch__item inline-flex items-center justify-center gap-1.5 text-[11px] font-medium leading-none text-[#111] dark:text-[#f4f4f2]"
            >
              <span className="block h-3 w-[18px] overflow-hidden rounded-[2px] border border-black/10 dark:border-white/15">
                <FlagSvg code={FLAGS[lang]} />
              </span>
              <span className="uppercase">{lang}</span>
            </span>
          ))}
        </span>
      </span>
    </button>
  );
}
