// Zapisane STRONY (nie wpisy) na liście czytelniczej.
//
// MOLEKUŁA: lista odnośników z propsów. Osobna sekcja pod siatką wpisów, bo
// strona nie ma okładki ani zajawki - w siatce kart byłaby pustą kartą.
//
// Wcześniej `/reading-list` pokazywało WYŁĄCZNIE wpisy, więc strona zapisana
// z paska czytania znikała bez śladu (rozjazd z /profile/bookmarks). Ta sekcja
// zamyka tę różnicę.
//
// Odnośnik jest zwykłym `<a href>`, nie `<Link>`: pełna ścieżka strony pochodzi
// z bazy (`page_full_path`), a nie ze wzorca trasy - router nie ma tu wzorca do
// dopasowania.
import { useTranslation } from "react-i18next";
import { savedPageTitle } from "@/components/readingList/atoms/savedTitle";

// Nakładka słownika rejestruje klucze `readingList.*` EFEKTEM UBOCZNYM importu.
// Przed wyprowadzeniem komponentów z trasy wciągała ją jedna linia w
// `routes/reading-list.tsx`; teraz każdy plik, który woła te klucze, musi ją
// zaimportować sam - inaczej klucz działa tylko wtedy, gdy nakładkę
// przypadkiem wciągnie inny moduł w tym samym chunku.
import "@/lib/i18n-reading-list";

/** Zapisana strona z policzoną pełną ścieżką. */
export interface SavedPage {
  id: string;
  slug: string;
  title_pl: string | null;
  title_en: string | null;
  fullPath: string;
}

export function SavedPagesList({
  pages,
  lang,
}: {
  pages: readonly SavedPage[];
  lang: "pl" | "en";
}) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-2xl">
      <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
        {t("readingList.savedPagesHeading")}
      </h3>
      <ul className="divide-y divide-border/60 rounded-[6px] border border-border/60">
        {pages.map((page) => (
          <li key={page.id} className="px-3 py-2.5">
            <a href={page.fullPath} className="block truncate text-sm font-medium hover:underline">
              {savedPageTitle(page, lang)}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
