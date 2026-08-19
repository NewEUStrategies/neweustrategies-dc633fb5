// Pigułki kategorii wpisu - renderowane nad tytułem w overlayu / nagłówku.
//
// Plik jest teraz WYŁĄCZNIE kompozycją: pojedynczą pigułkę renderuje atom
// `atoms/CategoryPill`, a reguła kontrastu napisu na kolorze kategorii (WCAG)
// żyje w czystym module `lib/post/badgeContrast`. Wcześniej `pickTextColor` była
// prywatna tutaj, więc dowód czytelności etykiety wymagał wyrenderowania linku
// z routerem i czytania atrybutu `style`.
import { CategoryPill } from "@/components/post/atoms/CategoryPill";

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

export function CategoryBadges({ items, lang }: Props) {
  if (!items.length) return null;
  return (
    <>
      {items.map((c) => (
        <CategoryPill
          key={c.slug}
          slug={c.slug}
          name_pl={c.name_pl}
          name_en={c.name_en}
          color={c.color}
          lang={lang}
        />
      ))}
    </>
  );
}
