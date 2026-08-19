// Zgodnościowy re-eksport atrapy łańcucha PostgREST.
//
// Kanoniczne miejsce to `src/test/supabase/chain.ts` - atom wspólnego harnessu
// klienta Supabase (`@/test/supabase`), z którego korzystają fixture czatu,
// klubów, komentarzy i profilu. Ta ścieżka zostaje, bo importuje ją 79 plików
// testowych rozsianych po całym repo; przepisywanie ich przy okazji rozbicia
// harnessu wygenerowałoby ogromny diff bez żadnej zmiany zachowania,
// a `git blame` tych testów przestałby być czytelny.
//
// Nowy kod importuje z `@/test/supabase`. Ten plik nie dokłada ani jednej
// linii logiki - to wyłącznie alias ścieżki.
export * from "./supabase/chain";
