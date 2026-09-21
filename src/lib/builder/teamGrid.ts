// Czysty model widgetu "team-member-grid" (siatka zespołu).
//
// Poza komponentami, dokładnie z tego samego powodu co `travelRouteCard.ts`
// i `promoCard.ts`: renderer, panel i testy mają JEDNO źródło prawdy, a każda
// reguła (kto w ogóle jest osobą, co odsiewamy z adresów social, jak tniemy
// przynależność projektową) daje się sprawdzić bez montowania Reacta.
//
// Moduł jest CZYSTY: bez Reacta, DOM-u, sieci i zegara. To nie jest higiena
// dla higieny - siatka renderuje się na serwerze (SSR) i musi policzyć się
// IDENTYCZNIE w przeglądarce przy hydratacji. Żadna wartość tutaj nie zależy
// od `Date.now()`, `Math.random()`, `window` ani strefy maszyny, więc obie
// strony dostają ten sam wynik z tego samego wejścia.
import type { WidgetContent } from "./types";
import { safeImageUrl, safeUrl, sanitizeHtml } from "@/lib/sanitize";

/** Język treści widgetu (ten sam alias co w `widget-view/frame`). */
export type TeamGridLang = "pl" | "en";

/**
 * Zaokrąglenie użyte, gdy dokument nie niesie własnej wartości (wpisy sprzed
 * dodania pola). Ta sama liczba stoi w `WIDGETS["team-member-grid"].defaults`.
 */
export const TEAM_GRID_DEFAULT_RADIUS = 6;

export type TeamGridSocialKey = "x" | "facebook" | "linkedin" | "instagram" | "youtube" | "website";

export const TEAM_GRID_SOCIAL_KEYS: readonly TeamGridSocialKey[] = [
  "x",
  "facebook",
  "linkedin",
  "instagram",
  "youtube",
  "website",
];

/**
 * Nazwy platform NIE idą do słownika: "LinkedIn" i "YouTube" to nazwy własne,
 * identyczne w obu językach (ta sama decyzja co w `team-member`).
 */
export const TEAM_GRID_SOCIAL_LABEL: Record<TeamGridSocialKey, string> = {
  x: "X",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  youtube: "YouTube",
  website: "Website",
};

type Bag = Record<string, unknown>;

/**
 * Wartość pola w żądanym języku z PEŁNYM łańcuchem fallbacków
 * (język -> PL -> EN -> klucz bez sufiksu). Ostatnie ogniwo jest tu z tego
 * samego powodu co w `pickI18n`: treść wpisana wyłącznie po angielsku ma się
 * pokazać także w widoku PL, zamiast zniknąć.
 *
 * UWAGA NA KOLEJNOŚĆ I `??`: gałęzie są leniwe, więc przy wypełnionym
 * `foo_pl` klucz bazowy `foo` NIE jest odczytywany. To nie jest przypadek -
 * bramka wierności ustawień liczy odczyty treści i klucz bazowy, którego panel
 * nie oferuje, zgłosiłaby jako "ustawienie ukryte".
 */
function loc(bag: Bag, base: string, lang: TeamGridLang): string {
  const v =
    (bag[`${base}_${lang}`] as unknown) ??
    (bag[`${base}_pl`] as unknown) ??
    (bag[`${base}_en`] as unknown) ??
    bag[base];
  return typeof v === "string" ? v.trim() : "";
}

function str(bag: Bag, key: string): string {
  const v = bag[key];
  return typeof v === "string" ? v.trim() : "";
}

/** Inicjały dla osoby bez zdjęcia - z imienia, nigdy z placeholdera. */
export function teamGridInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** "Bałkany, Energia, " -> ["Bałkany", "Energia"]. Puste wpisy odpadają. */
export function teamGridProjects(raw: string): string[] {
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Klasa siatki dla liczby kolumn - literały, bo Tailwind skanuje źródło. */
export function teamGridColumnsClass(columns: number): string {
  if (columns === 2) return "sm:grid-cols-2";
  if (columns === 4) return "sm:grid-cols-2 lg:grid-cols-4";
  return "sm:grid-cols-2 lg:grid-cols-3";
}

/** Osoba gotowa do renderu - wszystko już zlokalizowane i odkażone. */
export interface TeamGridMember {
  key: string;
  avatar: string;
  name: string;
  role: string;
  department: string;
  bio: string;
  /** Sanityzowany HTML; pusty = okno pokazuje `bio` jako tekst. */
  fullBio: string;
  affiliation: string;
  projects: string[];
  email: string;
  phone: string;
  profileHref: string;
  socials: Array<{ key: TeamGridSocialKey; url: string }>;
}

/**
 * Treść widgetu -> lista osób gotowych do renderu.
 *
 * OSOBA BEZ IMIENIA NIE ISTNIEJE: nazwa jest dostępną etykietą kafelka i
 * tytułem okna, więc wpis bez niej byłby przyciskiem bez nazwy. Świeżo dodany
 * wiersz jest więc niewidoczny, dopóki redakcja go nie nazwie - i to jest
 * zamierzone (ta sama zasada „puste pole = brak elementu" co w `team-member`).
 */
export function teamGridMembers(content: WidgetContent, lang: TeamGridLang): TeamGridMember[] {
  const raw = content.members;
  if (!Array.isArray(raw)) return [];
  const out: TeamGridMember[] = [];
  raw.forEach((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return;
    const bag = entry as Bag;
    const name = str(bag, "name");
    if (!name) return;
    const socials = TEAM_GRID_SOCIAL_KEYS.map((key) => {
      // `safeUrl` zbija `javascript:` i spółkę do wartości zastępczej; pusty
      // wynik (albo "#") oznacza, że ikona NIE ma prawa powstać.
      const url = safeUrl(str(bag, key), "");
      return { key, url: url && url !== "#" ? url : "" };
    }).filter((s) => Boolean(s.url));
    const id = str(bag, "id");
    out.push({
      key: id || `tmg-${index}`,
      // `photo` czytamy jako alias historyczny: tak nazywa to pole starszy
      // `team-member`, więc wklejenie wpisu stamtąd nie gubi zdjęcia.
      avatar: safeImageUrl(str(bag, "avatar") || str(bag, "photo")),
      name,
      role: loc(bag, "role", lang),
      department: loc(bag, "department", lang),
      bio: loc(bag, "bio", lang),
      fullBio: sanitizeHtml(loc(bag, "fullBio", lang)),
      affiliation: loc(bag, "affiliation", lang),
      projects: teamGridProjects(loc(bag, "projects", lang)),
      email: str(bag, "email"),
      phone: str(bag, "phone"),
      profileHref: safeUrl(str(bag, "profileHref"), ""),
      socials,
    });
  });
  return out;
}

/** Nagłówek sekcji - te same fallbacki językowe co pola osoby. */
export function teamGridHeader(
  content: WidgetContent,
  lang: TeamGridLang,
): { badge: string; heading: string; intro: string } {
  const bag = content as unknown as Bag;
  return {
    badge: loc(bag, "badge", lang),
    heading: loc(bag, "heading", lang),
    intro: loc(bag, "intro", lang),
  };
}
