// Atom: jedna pigułka kategorii nad tytułem wpisu.
//
// Wyniesiona z ciała `map` w `CategoryBadges`, bo cała jej trudność - kontrast
// napisu na dowolnym kolorze ustawionym przez redakcję - jest regułą WCAG, nie
// stylem. Reguła żyje w `lib/post/badgeContrast`, atom tylko ją stosuje.
import { AppLink } from "@/components/atoms/AppLink";
import { categoryHref, categoryLabel, pickTextColor } from "@/lib/post/badgeContrast";

export interface CategoryPillProps {
  slug: string;
  name_pl: string;
  name_en: string;
  /** Kolor tła z /admin/category-colors. Brak = neutralna pigułka motywu. */
  color?: string | null;
  lang: "pl" | "en";
}

/** Wspólna geometria pigułki. */
export const CATEGORY_PILL_CLASS =
  "inline-flex items-center rounded-sm px-3 py-1 text-xs font-semibold uppercase tracking-wide shadow-sm transition";

export function CategoryPill({ slug, name_pl, name_en, color, lang }: CategoryPillProps) {
  const label = categoryLabel({ name_pl, name_en }, lang);
  const bg = color ?? undefined;
  return (
    <AppLink
      href={categoryHref(slug, lang)}
      style={bg ? { backgroundColor: bg, color: pickTextColor(bg) } : undefined}
      className={`${CATEGORY_PILL_CLASS} ${bg ? "" : "bg-foreground/85 text-background"}`}
    >
      {label}
    </AppLink>
  );
}
