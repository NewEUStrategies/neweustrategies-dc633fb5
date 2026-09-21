// Katalog wzmianek udostępniony poddrzewu powierzchni.
//
// PO CO KONTEKST. Etykietą wzmianki jest imię i nazwisko, więc każda wzmianka
// potrzebuje profilu przy renderze. Gdyby sięgała po niego sama, wątek zrobiłby
// tyle zapytań, ile ma wzmianek. Powierzchnia (strona wątku, sekcja
// komentarzy, ściana klubu) pyta RAZ o komplet slugów i podaje gotową mapę w
// dół - komponent wzmianki tylko z niej czyta.
//
// BRAK DOSTAWCY NIE JEST BŁĘDEM. Poza dostawcą (izolowany render w teście,
// podgląd komponentu) katalog jest pusty, a wzmianka schodzi na uczytelniony
// slug i leniwy dymek. Nick nie pojawia się nawet wtedy.
import { createContext, useContext, type ReactNode } from "react";
import {
  EMPTY_DIRECTORY,
  type MentionDirectory,
  type MentionEntity,
} from "@/lib/mentions/directory";
import { useMentionDirectory } from "@/lib/mentions/useMentionDirectory";

const MentionDirectoryContext = createContext<MentionDirectory>(EMPTY_DIRECTORY);

/**
 * Rozwiązuje komplet slugów jednym zapytaniem i podaje mapę poddrzewu.
 * `slugs` zbiera powierzchnia z treści i autorów (`collectMentionSlugs`,
 * `withAuthorSlugs`) - dzięki temu byline i wzmianka w treści czytają z tego
 * samego wpisu cache'u.
 */
export function MentionDirectoryProvider({
  slugs,
  lang,
  children,
}: {
  slugs: readonly string[];
  lang: "pl" | "en";
  children: ReactNode;
}) {
  const { directory } = useMentionDirectory(slugs, lang);
  return (
    <MentionDirectoryContext.Provider value={directory}>
      {children}
    </MentionDirectoryContext.Provider>
  );
}

/** Byt spod sluga albo `null`, gdy katalog go nie zna (lub nie ma dostawcy). */
export function useMentionEntity(slug: string | null | undefined): MentionEntity | null {
  const directory = useContext(MentionDirectoryContext);
  if (typeof slug !== "string" || slug === "") return null;
  return directory.get(slug.toLowerCase()) ?? null;
}
