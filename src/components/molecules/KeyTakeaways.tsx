// Publiczna sekcja "Z tego artykułu dowiesz się..." wyświetlana nad treścią wpisu.
// Konsumuje globalne ustawienia (site_settings.key_takeaways):
//   - enabled (globalna widoczność sekcji)
//   - variant: "card" (karta z ikoną + numeracja) | "heading" (duży nagłówek + kropki)
//   - icon (dowolna ikona Lucide, dynamiczna resolucja)
//   - labelPl / labelEn (nagłówek sekcji per język)
//   - colors (tło, akcent, ikona, tekst, tytuł + warianty dark)
// Wpisy per język: `posts.takeaways_pl` / `posts.takeaways_en`. Atomic-design "molecule".
import { useTranslation } from "react-i18next";
import { DynamicIcon, type IconName } from "@/lib/icons/DynamicIcon";
import {
  useKeyTakeawaysSettings,
  type KeyTakeawaysSettings,
  type KeyTakeawaysVariant,
} from "@/lib/keyTakeaways/settings";

interface KeyTakeawaysProps {
  items: readonly string[];
  className?: string;
  /** Nadpisanie ustawień globalnych (używane w podglądzie admina). */
  settingsOverride?: KeyTakeawaysSettings;
  /** Wymusza wariant (dla podglądu). */
  variantOverride?: KeyTakeawaysVariant;
  /** Wymusza język (dla podglądu). */
  langOverride?: "pl" | "en";
  /**
   * Gdy true i brak realnych punktów - renderuj placeholderowe bullety,
   * żeby pokazać obecność sekcji (używane dla tekstowych wpisów przed
   * uzupełnieniem treści). Placeholders znikają, gdy pojawi się choć
   * jeden realny punkt.
   */
  withPlaceholders?: boolean;
  /** Liczba placeholderów do wyświetlenia (domyślnie 3). */
  placeholderCount?: number;
}

const PLACEHOLDER_TEXTS: Record<"pl" | "en", readonly string[]> = {
  pl: [
    "Kluczowy wniosek pojawi się tutaj po dodaniu pierwszego punktu.",
    "Drugi kluczowy wniosek z artykułu.",
    "Trzeci kluczowy wniosek z artykułu.",
    "Czwarty kluczowy wniosek z artykułu.",
    "Piąty kluczowy wniosek z artykułu.",
  ],
  en: [
    "A key takeaway will appear here once you add your first point.",
    "A second key takeaway from this article.",
    "A third key takeaway from this article.",
    "A fourth key takeaway from this article.",
    "A fifth key takeaway from this article.",
  ],
};

export function KeyTakeaways({
  items,
  className,
  settingsOverride,
  variantOverride,
  langOverride,
  withPlaceholders = false,
  placeholderCount = 3,
}: KeyTakeawaysProps) {
  const { t, i18n } = useTranslation();
  const globalSettings = useKeyTakeawaysSettings();
  const settings = settingsOverride ?? globalSettings;

  const realClean = items
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter((s) => s.length > 0)
    .slice(0, 7);

  const isPlaceholder = realClean.length === 0 && withPlaceholders;
  if (!settings.enabled) return null;
  if (realClean.length === 0 && !withPlaceholders) return null;

  const lang: "pl" | "en" =
    langOverride ?? ((i18n.language ?? "pl").startsWith("en") ? "en" : "pl");
  const label =
    (lang === "en" ? settings.labelEn : settings.labelPl)?.trim() ||
    t("post.takeaways.title");

  const variant = variantOverride ?? settings.variant;

  // Zestaw CSS variables (light + dark) - dark wchodzi w życie przez `.dark &`.
  const sizeScale = Math.max(0.5, Math.min(3, settings.highlight?.sizeScale ?? 1));
  const offsetY = Math.max(-200, Math.min(200, settings.highlight?.offsetY ?? 0));
  const styleVars: Record<string, string> = {
    "--kt-bg": settings.colors.bg,
    "--kt-bg-dark": settings.colors.bgDark,
    "--kt-accent": settings.colors.accent,
    "--kt-icon": settings.colors.icon,
    "--kt-icon-bg": settings.colors.iconBg,
    "--kt-text": settings.colors.text,
    "--kt-text-dark": settings.colors.textDark,
    "--kt-title": settings.colors.title,
    "--kt-title-dark": settings.colors.titleDark,
    "--kt-highlight": settings.highlight?.color ?? settings.colors.accent,
    "--kt-ghost-scale": String(sizeScale),
    "--kt-ghost-offset-y": `${offsetY}px`,
    "--kt-border": settings.colors.border ?? "transparent",
    "--kt-border-dark": settings.colors.borderDark ?? "transparent",
    "--kt-border-width": `${settings.colors.borderWidth ?? 0}px`,
  };

  // Rozbij etykietę na tokeny (słowa i spacje) - dla wariantu ghost
  // renderujemy każde słowo osobno, żeby móc podświetlać wybrane pozycje.
  const highlightIdx = new Set(settings.highlight?.indices ?? []);
  const labelTokens = (() => {
    const parts = label.split(/(\s+)/);
    let wordIdx = 0;
    return parts.map((piece) => {
      const isWhitespace = /^\s+$/.test(piece);
      if (isWhitespace || piece.length === 0) {
        return { text: piece, isWord: false, index: -1 };
      }
      const idx = wordIdx;
      wordIdx += 1;
      return { text: piece, isWord: true, index: idx };
    });
  })();

  const iconName = (settings.icon || "Search") as IconName;

  return (
    <aside
      aria-label={label}
      // Stabilne "key-takeaways" - referencowane przez SpeakableSpecification
      // w JSON-LD (src/lib/seo/meta.ts). Nie zmieniać nazwy.
      className={`key-takeaways key-takeaways--${variant} my-10 ${className ?? ""}`}
      style={styleVars as React.CSSProperties}
      data-variant={variant}
    >
      {variant === "card" ? (
        <div className="key-takeaways__card rounded-2xl p-6 md:p-8">
          <div className="flex items-start gap-4">
            <div
              className="key-takeaways__icon shrink-0 flex items-center justify-center rounded-[6px]"
              aria-hidden="true"
            >
              <DynamicIcon name={iconName} size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="key-takeaways__title font-display text-xl md:text-2xl font-semibold mb-3">
                {label}
              </h2>
              <ol className="key-takeaways__list space-y-2.5 list-decimal list-inside marker:font-semibold text-base leading-relaxed">
                {clean.map((bullet, i) => (
                  <li key={i} className="pl-1">
                    <span className="align-top">{bullet}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      ) : variant === "heading" ? (
        <div className="key-takeaways__heading">
          <h2 className="key-takeaways__title font-display text-2xl lg:text-4xl font-semibold mb-5">
            {label}
          </h2>
          <ul className="key-takeaways__list space-y-3.5 border-t pt-5">
            {clean.map((bullet, i) => (
              <li
                key={i}
                className="flex items-start gap-3 text-base lg:text-lg leading-relaxed"
              >
                <span
                  className="shrink-0 inline-flex items-center justify-center h-[1lh]"
                  aria-hidden="true"
                >
                  <span className="key-takeaways__bullet inline-block h-2 w-2 rounded-full" />
                </span>
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        // "ghost": wielki, półprzezroczysty nagłówek renderowany ZA listą
        // (z-index 0), lista siedzi na nim (z-index 10) i wizualnie ją
        // przecina. Wzorowane na Foxiz "You will find out that".
        <div className="key-takeaways__ghost relative isolate">
          <h2
            aria-hidden="true"
            className="key-takeaways__ghost-title font-display font-black tracking-tight pointer-events-none select-none absolute inset-x-0 top-0 whitespace-nowrap"
          >
            {labelTokens.map((tok, i) => {
              if (!tok.isWord) return <span key={i}>{tok.text}</span>;
              const on = highlightIdx.has(tok.index);
              return (
                <span
                  key={i}
                  className={on ? "key-takeaways__ghost-title-hl" : undefined}
                >
                  {tok.text}
                </span>
              );
            })}
          </h2>
          <h2 className="sr-only">{label}</h2>
          <ul className="key-takeaways__list relative z-10 space-y-0">
            {clean.map((bullet, i) => (
              <li
                key={i}
                className="key-takeaways__ghost-item flex items-start gap-3 text-base md:text-lg leading-relaxed py-2"
              >
                <span
                  className="shrink-0 inline-flex items-center justify-center h-[1lh]"
                  aria-hidden="true"
                >
                  <span className="key-takeaways__bullet inline-block h-2.5 w-2.5 rounded-full" />
                </span>
                <span className="font-semibold">{bullet}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}

