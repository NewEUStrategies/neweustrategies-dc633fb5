// Rejestr stron PUBLICZNYCH renderowanych z kodu (trasy React w src/routes),
// a nie z buildera. Wpis w tabeli `pages` dla takiego slugu istnieje wyłącznie
// po to, żeby redakcja miała jedno miejsce na tytuł, opis i SEO - treść i układ
// pochodzą z komponentu i nadpisują wszystko, co kiedykolwiek zbudowano w
// builderze pod tym adresem.
//
// Rejestr jest jednym źródłem prawdy dla:
//   * listy /admin/pages (plakietka „Z kodu" + brak złudzeń, że edycja
//     buildera cokolwiek zmieni),
//   * edytora /admin/pages/:slug (baner wyjaśniający zakres edycji),
//   * testów parzystości (każdy slug musi mieć realną trasę).
// Dodanie strony kodowej = jedna linia tutaj.

export interface CodePageDef {
  /** Slug w tabeli `pages` (bez ukośnika). */
  slug: string;
  /** Publiczna ścieżka URL renderowana przez trasę React. */
  path: string;
  label_pl: string;
  label_en: string;
  /**
   * Ścieżka w panelu admina, gdzie redakcja realnie zarządza treścią tej strony
   * (obrazy, teksty, etykiety pól i przycisków). Bez tego wpisu edytor pokazuje
   * wyłącznie informację, że układ pochodzi z kodu.
   */
  manage_path?: string;
  manage_label_pl?: string;
  manage_label_en?: string;
}

export const CODE_PAGES: readonly CodePageDef[] = [
  {
    slug: "pricing",
    path: "/pricing",
    label_pl: "Cennik (plany, segmenty, porównanie)",
    label_en: "Pricing (plans, segments, comparison)",
  },
  {
    slug: "membership-registration",
    path: "/membership-registration",
    label_pl: "Rejestracja członkostwa (konto, logowanie, reset hasła)",
    label_en: "Membership registration (account, sign-in, password reset)",
    manage_path: "/admin/login-settings",
    manage_label_pl: "Zarządzaj treścią: Strona logowania",
    manage_label_en: "Manage content: Login page",
  },

  {
    slug: "contribute",
    path: "/contribute",
    label_pl: "Zgłoś artykuł",
    label_en: "Contribute an article",
  },
  {
    slug: "cookies",
    path: "/cookies",
    label_pl: "Polityka plików cookies",
    label_en: "Cookie policy",
  },
  {
    slug: "polityka-prywatnosci",
    path: "/polityka-prywatnosci",
    label_pl: "Polityka prywatności",
    label_en: "Privacy policy",
  },
  { slug: "regulamin", path: "/regulamin", label_pl: "Regulamin", label_en: "Terms of service" },
  {
    slug: "zwroty-i-reklamacje",
    path: "/zwroty-i-reklamacje",
    label_pl: "Zwroty i reklamacje",
    label_en: "Returns and complaints",
  },
] as const;

const BY_SLUG: ReadonlyMap<string, CodePageDef> = new Map(CODE_PAGES.map((p) => [p.slug, p]));

/** Czy dany slug jest obsługiwany przez trasę React (builder nic tu nie zmieni). */
export function isCodePage(slug: string | null | undefined): boolean {
  return !!slug && BY_SLUG.has(slug);
}

export function codePage(slug: string | null | undefined): CodePageDef | null {
  return slug ? (BY_SLUG.get(slug) ?? null) : null;
}

export function codePageLabel(def: CodePageDef, lang: string): string {
  return lang === "en" ? def.label_en : def.label_pl;
}
