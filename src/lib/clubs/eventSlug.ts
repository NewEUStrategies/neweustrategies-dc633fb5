// Slug wydarzenia klubowego.
//
// `club_event_upsert` wymaga sluga przy TWORZENIU, a CHECK bazy
// (`club_events_slug_format`) przepuszcza wyłącznie `^[a-z0-9]+(-[a-z0-9]+)*$`.
// Tytuł bywa polski (ogonki), bywa też sam z siebie pusty po transliteracji
// (np. same znaki interpunkcyjne) - dlatego funkcja ZAWSZE zwraca poprawny
// slug, a krótki sufiks czasowy chroni przed kolizją dwóch spotkań o tym
// samym tytule w jednym klubie.
const PL_MAP: Record<string, string> = {
  ą: "a",
  ć: "c",
  ę: "e",
  ł: "l",
  ń: "n",
  ó: "o",
  ś: "s",
  ź: "z",
  ż: "z",
};

/** Czysta transliteracja bez sufiksu - wydzielona, żeby dała się testować. */
export function clubEventSlugBase(input: string): string {
  return input
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (ch) => PL_MAP[ch] ?? ch)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/** Slug gotowy do zapisu: baza + sufiks unikalizujący. */
export function clubEventSlug(title: string, seed: number = Date.now()): string {
  const base = clubEventSlugBase(title);
  const suffix = Math.abs(Math.trunc(seed)).toString(36).slice(-5) || "0";
  return base.length > 0 ? `${base}-${suffix}` : `event-${suffix}`;
}

export function isValidClubEventSlug(slug: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug);
}
