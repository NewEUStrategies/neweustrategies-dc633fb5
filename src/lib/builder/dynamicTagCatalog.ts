// Katalog tokenów tekstu dynamicznego (`{post.title}`, `{author.name}`, ...)
// dla wstawiacza w panelu (`DynamicTagInserter`). Rozwiązywanie tokenów przy
// renderze opisuje nagłówek `dynamicText.ts`.
//
// OSOBNY MODUŁ, CELOWO (chunk startowy, roadmapa ładowania §9.1 J3).
// `dynamicText.ts` importują widgety renderera, więc siedzi w `app-initial`;
// katalog (etykiety PL/EN, ok. 0,9 KB surowego kodu) czyta wyłącznie panel.
// `dynamicText.ts` NIE importuje stąd niczego - także reeksportem.

export interface DynamicTagDef {
  /** Token as typed by the user - always wrapped in curly braces. */
  token: string;
  /** Short i18n-agnostic English label used inside the admin picker. */
  label: string;
  /** Optional short description surfaced next to the label. */
  description?: string;
}

export const DYNAMIC_TAG_GROUPS: {
  id: "post" | "author" | "taxonomy" | "site";
  labelPl: string;
  labelEn: string;
  tags: DynamicTagDef[];
}[] = [
  {
    id: "post",
    labelPl: "Wpis",
    labelEn: "Post",
    tags: [
      { token: "{post.title}", label: "Tytuł wpisu" },
      { token: "{post.excerpt}", label: "Zajawka" },
      { token: "{post.slug}", label: "Slug" },
      { token: "{post.date}", label: "Data publikacji" },
      { token: "{post.updated}", label: "Data aktualizacji" },
      { token: "{post.reading}", label: "Czas czytania" },
      { token: "{post.views}", label: "Wyświetlenia" },
    ],
  },
  {
    id: "author",
    labelPl: "Autor",
    labelEn: "Author",
    tags: [
      { token: "{author.name}", label: "Imię i nazwisko" },
      { token: "{author.role}", label: "Stanowisko" },
      { token: "{author.company}", label: "Firma / redakcja" },
    ],
  },
  {
    id: "taxonomy",
    labelPl: "Taksonomia",
    labelEn: "Taxonomy",
    tags: [
      { token: "{category.name}", label: "Nazwa kategorii" },
      { token: "{tag.name}", label: "Nazwa tagu" },
      { token: "{archive.label}", label: "Etykieta archiwum" },
    ],
  },
  {
    id: "site",
    labelPl: "Kontekst",
    labelEn: "Context",
    tags: [
      { token: "{date.today}", label: "Dzisiejsza data" },
      { token: "{year}", label: "Bieżący rok" },
    ],
  },
];

export function listDynamicTags(): DynamicTagDef[] {
  return DYNAMIC_TAG_GROUPS.flatMap((g) => g.tags);
}
