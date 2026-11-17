// Teksty strony `/sitemap` (PL/EN) - tytuł i opis `<head>` oraz nagłówki sekcji.
//
// Osobny moduł zamiast lokalnej stałej w `routes/sitemap.tsx`: `head()` trasy
// zostaje w powłoce (chunk startowy `app-initial`), a komponent i loader idą do
// leniwych chunków podziału. Stała czytana i przez `head()`, i przez komponent
// trafiała do modułu `?tsr-shared`, który powłoka importuje statycznie - a z nią
// wszystkie inne wspólne stałe trasy (listy linków, metadane dokumentów
// prawnych, zapytanie przekierowań). Import z modułu splitter TanStacka
// powtarza w każdej części, więc do bootu wchodzi tylko ten plik (roadmapa
// ładowania §9.10). Treść przeniesiona bez zmian.
export const COPY = {
  pl: {
    title: "Mapa strony",
    description: "Pełna mapa serwisu: wszystkie strony, kategorie i najnowsze artykuły.",
    pages: "Strony",
    categories: "Kategorie",
    posts: "Najnowsze artykuły",
    home: "Strona główna",
    blog: "Blog",
    community: "Społeczność",
    legal: "Dokumenty i zasady",
    degraded: "Nie udało się załadować pełnej mapy strony",
  },
  en: {
    title: "Site map",
    description: "The full site map: every page, category and the latest articles.",
    pages: "Pages",
    categories: "Categories",
    posts: "Latest articles",
    home: "Home",
    blog: "Blog",
    community: "Community",
    legal: "Policies and documents",
    degraded: "Couldn't load the full site map",
  },
} as const;
