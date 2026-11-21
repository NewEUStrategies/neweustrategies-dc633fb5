import { Moon, Sun } from "@/lib/lucide-shim";
import { cn } from "@/lib/utils";

/**
 * Ikona przełącznika motywu z animowaną wymianą słońce/księżyc.
 *
 * Wspólna dla `ThemeToggle` (header, portal autoryzacji, studio) i
 * `ThemeToggleWidget` (chrome buildera) - jedna animacja i geometria,
 * rozmiar ikony podaje konsument przez `iconClassName`.
 *
 * `key` na spanie remontuje węzeł przy każdym przełączeniu, więc animacja
 * wejścia (`theme-icon-in-*` w `styles.css`) startuje od nowa: słońce
 * wjeżdża z obrotem zgodnym z ruchem wskazówek, księżyc przeciwnym.
 */
export function ThemeToggleIcon({
  isDark,
  iconClassName,
}: {
  isDark: boolean;
  iconClassName?: string;
}) {
  return (
    <span
      key={isDark ? "sun" : "moon"}
      className={cn(
        "inline-flex items-center justify-center",
        isDark ? "theme-icon-in-cw" : "theme-icon-in-ccw",
      )}
    >
      {isDark ? (
        <Sun className={iconClassName} aria-hidden="true" />
      ) : (
        <Moon className={iconClassName} aria-hidden="true" />
      )}
    </span>
  );
}
