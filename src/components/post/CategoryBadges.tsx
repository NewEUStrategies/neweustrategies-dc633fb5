// Pigułki kategorii wpisu - renderowane nad tytułem w overlayu / nagłówku.
// Kolor pigułki pochodzi z `categories.color` (HEX), zarządzanego w
// /admin/category-colors. Brak koloru -> neutralny (foreground/85) - nigdy żółty.
import { AppLink } from "@/components/atoms/AppLink";

type Lang = "pl" | "en";

interface CategoryLite {
  slug: string;
  name_pl: string;
  name_en: string;
  color?: string | null;
}

interface Props {
  items: readonly CategoryLite[];
  lang: Lang;
}

// Prosty kontrast: jasny/ciemny tekst względem tła (WCAG luminance approx).
function pickTextColor(hex: string | null | undefined): string {
  if (!hex) return "hsl(var(--background))";
  const m = hex.replace("#", "");
  if (m.length !== 6) return "hsl(var(--background))";
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  // relative luminance
  const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return l > 0.6 ? "#0b0b0d" : "#ffffff";
}

export function CategoryBadges({ items, lang }: Props) {
  if (!items.length) return null;
  return (
    <>
      {items.map((c) => {
        const label = lang === "en" ? c.name_en || c.name_pl : c.name_pl || c.name_en;
        const href = `/${lang === "en" ? "en/" : ""}category/${c.slug}`;
        const bg = c.color ?? undefined;
        return (
          <AppLink
            key={c.slug}
            href={href}
            style={
              bg
                ? { backgroundColor: bg, color: pickTextColor(bg) }
                : undefined
            }
            className={
              "inline-flex items-center rounded-sm px-3 py-1 text-xs font-semibold uppercase tracking-wide shadow-sm transition hover:opacity-90 " +
              (bg ? "" : "bg-foreground/85 text-background")
            }
          >
            {label}
          </AppLink>
        );
      })}
    </>
  );
}
