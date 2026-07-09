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
}

export function KeyTakeaways({
  items,
  className,
  settingsOverride,
  variantOverride,
  langOverride,
}: KeyTakeawaysProps) {
  const { t, i18n } = useTranslation();
  const globalSettings = useKeyTakeawaysSettings();
  const settings = settingsOverride ?? globalSettings;

  const clean = items
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter((s) => s.length > 0)
    .slice(0, 7);

  if (!settings.enabled || clean.length === 0) return null;

  const lang: "pl" | "en" =
    langOverride ?? ((i18n.language ?? "pl").startsWith("en") ? "en" : "pl");
  const label =
    (lang === "en" ? settings.labelEn : settings.labelPl)?.trim() ||
    t("post.takeaways.title");

  const variant = variantOverride ?? settings.variant;

  // Zestaw CSS variables (light + dark) - dark wchodzi w życie przez `.dark &`.
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
  };

  // Rozbij etykietę na "pierwsze N słów + reszta" na potrzeby wariantu ghost.
  const highlightCount = Math.max(0, Math.min(3, settings.highlight?.words ?? 0));
  const labelParts = (() => {
    if (highlightCount <= 0) return { head: "", tail: label };
    const tokens = label.split(/(\s+)/); // zachowaj spacje
    let words = 0;
    let cut = 0;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] && !/^\s+$/.test(tokens[i])) {
        words += 1;
        if (words === highlightCount) {
          cut = i + 1;
          break;
        }
      }
    }
    return {
      head: tokens.slice(0, cut).join(""),
      tail: tokens.slice(cut).join(""),
    };
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
              className="key-takeaways__icon shrink-0 flex items-center justify-center rounded-full"
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
                  className="key-takeaways__bullet mt-2.5 inline-block h-2 w-2 shrink-0 rounded-full"
                  aria-hidden="true"
                />
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
            {labelParts.head ? (
              <span className="key-takeaways__ghost-title-hl">{labelParts.head}</span>
            ) : null}
            {labelParts.tail}
          </h2>
          <h2 className="sr-only">{label}</h2>
          <ul className="key-takeaways__list relative z-10 space-y-0">
            {clean.map((bullet, i) => (
              <li
                key={i}
                className="key-takeaways__ghost-item flex items-start gap-3 text-base md:text-lg leading-relaxed py-2"
              >
                <span
                  className="key-takeaways__bullet mt-2 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  aria-hidden="true"
                />
                <span className="font-semibold">{bullet}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}

