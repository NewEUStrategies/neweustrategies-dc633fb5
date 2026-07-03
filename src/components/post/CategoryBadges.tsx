// Pigułki kategorii wpisu - renderowane nad tytułem w overlayu / nagłówku.
// Linkuje do /category/<slug> (PL) lub /en/category/<slug> (EN).
import { AppLink } from "@/components/atoms/AppLink";

type Lang = "pl" | "en";

interface CategoryLite {
  slug: string;
  name_pl: string;
  name_en: string;
}

interface Props {
  items: readonly CategoryLite[];
  lang: Lang;
}

export function CategoryBadges({ items, lang }: Props) {
  if (!items.length) return null;
  return (
    <>
      {items.map((c) => {
        const label = lang === "en" ? c.name_en || c.name_pl : c.name_pl || c.name_en;
        const href = `/${lang === "en" ? "en/" : ""}category/${c.slug}`;
        return (
          <AppLink
            key={c.slug}
            to={href}
            className="inline-flex items-center rounded-sm bg-brand px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white shadow-sm transition hover:opacity-90"
          >
            {label}
          </AppLink>
        );
      })}
    </>
  );
}
