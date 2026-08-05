// Mapa źródeł obrazka podglądu (og:image) dla każdego typu treści.
// Wydzielona z ekranu /admin/settings/social-preview, żeby kontrakt
// „skąd bierze się karta" dało się objąć testem regresji.

export type SocialSourceId =
  | "home"
  | "posts"
  | "pages"
  | "authors"
  | "podcasts"
  | "newsletter";

export interface SocialSourceRow {
  id: SocialSourceId;
  where: string;
  how: string;
  /** Ścieżka do edytora, który realnie steruje tym obrazkiem. */
  to?: string;
  /** Czy domyślna karta z tego ekranu nadpisuje własny obrazek treści. */
  overridesOwnImage: boolean;
}

export function socialSourceRows(lang: "pl" | "en"): SocialSourceRow[] {
  const pl = lang === "pl";
  return [
    {
      id: "home",
      where: pl ? "Strona główna i listingi" : "Homepage & listings",
      how: pl ? "Domyślna karta ustawiona powyżej." : "The default card configured above.",
      overridesOwnImage: false,
    },
    {
      id: "posts",
      where: pl ? "Wpisy / artykuły" : "Posts / articles",
      how: pl
        ? "Obrazek wyróżniający wpisu; nadpisanie w panelu SEO edytora."
        : "The post cover image; override in the editor's SEO panel.",
      to: "/admin/posts",
      overridesOwnImage: false,
    },
    {
      id: "pages",
      where: pl ? "Strony (także kodowe </>)" : "Pages (incl. code pages </>)",
      how: pl
        ? "Pole „Obrazek OG” w SEO danej strony."
        : 'The "OG image" field in the page\'s SEO section.',
      to: "/admin/pages",
      overridesOwnImage: false,
    },
    {
      id: "authors",
      where: pl ? "Profile autorów i ekspertów" : "Author & expert profiles",
      how: pl
        ? "Awatar profilu (z automatycznym cache-busterem)."
        : "The profile avatar (with an automatic cache-buster).",
      to: "/admin/experts",
      overridesOwnImage: false,
    },
    {
      id: "podcasts",
      where: pl ? "Podcasty i web stories" : "Podcasts & web stories",
      how: pl
        ? "Okładka odcinka / historii; brak = karta domyślna."
        : "Episode / story cover; missing = the default card.",
      to: "/admin/podcasts",
      overridesOwnImage: false,
    },
    {
      id: "newsletter",
      where: pl ? "Newsletter i popupy" : "Newsletter & popups",
      how: pl
        ? "Własne obrazy w kreatorze wiadomości i popupów."
        : "Own images in the message and popup builders.",
      to: "/admin/popups",
      overridesOwnImage: false,
    },
  ];
}
