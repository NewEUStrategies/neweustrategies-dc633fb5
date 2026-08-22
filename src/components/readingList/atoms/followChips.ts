// Chipy obserwacji: złożenie trzech odpowiedzi bazy (autorzy / kategorie / tagi)
// w JEDNĄ listę deskryptorów do wyświetlenia.
//
// ATOM: czysta funkcja, zero I/O, zero Reacta. Wejście to już pobrane wiersze,
// wyjście to deskryptory - komponent nie liczy tu niczego.
//
// I18N: funkcja NIE zwraca gotowego tekstu dla przypadku „autor bez nazwy" -
// zwraca `label: null` i `fallbackKey`, a napis podstawia komponent. Dzięki temu
// nazwa własna z bazy i kopia interfejsu nie mieszają się w jednym polu.
//
// KOLEJNOŚĆ (autorzy -> kategorie -> tagi) jest częścią zachowania: czytelnik
// czyta chipy jako listę „kogo obserwuję, potem czego".

/** Rodzaj obserwowanego bytu - ten sam zbiór, który przyjmuje `useToggleFollow`. */
export type FollowChipType = "author" | "category" | "tag";

export interface FollowChip {
  type: FollowChipType;
  id: string;
  /** Nazwa z bazy albo `null`, gdy jej nie ma (patrz `fallbackKey`). */
  label: string | null;
  /** Klucz i18n używany, gdy `label` jest `null`. */
  fallbackKey?: string;
  href: { to: string; params: Record<string, string> } | null;
  avatarUrl?: string | null;
}

/** Wiersze, z których powstają chipy - węższe niż pełne typy tabel. */
export interface FollowChipSources {
  authors: readonly {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    slug: string | null;
  }[];
  cats: readonly { id: string; name_pl: string; name_en: string; slug: string }[];
  tags: readonly { id: string; name: string; slug: string }[];
}

/**
 * Deskryptory chipów. Autor BEZ sluga nie dostaje odnośnika (`href: null`) -
 * profil publiczny takiej osoby nie istnieje, a link w nikąd jest gorszy niż
 * jego brak. Nazwa kategorii spada na `name_pl`, gdy wariant językowy jest
 * pusty - kategoria bez nazwy byłaby chipem-widmem.
 */
export function buildFollowChips(sources: FollowChipSources, lang: "pl" | "en"): FollowChip[] {
  const authorChips: FollowChip[] = sources.authors.map((author) => ({
    type: "author",
    id: author.id,
    label: author.display_name,
    fallbackKey: "readingList.anonymousAuthor",
    href: author.slug ? { to: "/author/$slug", params: { slug: author.slug } } : null,
    avatarUrl: author.avatar_url,
  }));
  const catChips: FollowChip[] = sources.cats.map((cat) => ({
    type: "category",
    id: cat.id,
    label: (lang === "pl" ? cat.name_pl : cat.name_en) || cat.name_pl,
    href: { to: "/category/$slug", params: { slug: cat.slug } },
  }));
  const tagChips: FollowChip[] = sources.tags.map((tag) => ({
    type: "tag",
    id: tag.id,
    label: `#${tag.name}`,
    href: { to: "/tag/$slug", params: { slug: tag.slug } },
  }));
  return [...authorChips, ...catChips, ...tagChips];
}
