// Katalog wzmianek: czysta warstwa rozstrzygania „@slug -> kto to jest".
//
// PO CO. Do tej pory wzmianka była renderowana jako `@slug` - czyli NICK. Nick
// nie niesie żadnej informacji: czytelnik wątku widzi `@a-nowak` i nie wie, czy
// to autorka raportu, czy przypadkowy uczestnik. Docelowo wzmianka ma pokazywać
// AWATAR + IMIĘ I NAZWISKO, a jeśli osoba ma w profilu firmę - także firmę.
//
// DLACZEGO NIE W PARSERZE. Wzorzec `@slug` w `parse.ts` jest LUSTREM triggera
// `process_mentions` w bazie - to on decyduje, kto dostanie powiadomienie.
// Gdyby składnia rozróżniała osobę od firmy (np. `@@acme`), front i baza
// rozjechałyby się przy pierwszej wzmiance firmy. Dlatego składnia zostaje
// JEDNA, a rozstrzygnięcie „osoba czy organizacja" schodzi TUTAJ, do warstwy
// rozwiązywania: najpierw pytamy o osoby, a slugi, które nie są osobą, pytamy
// o organizacje. Osoba ma pierwszeństwo - dokładnie jak w bazie.
//
// ZERO I/O. Ten plik jest czysty; zapytania robi `useMentionDirectory`.
import { splitMentions } from "./parse";

/** Osoba rozwiązana ze sluga - komplet pól karty i etykiety wzmianki. */
export interface MentionPerson {
  kind: "person";
  slug: string;
  name: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  company: string | null;
  bio: string | null;
  verified: boolean;
}

/** Organizacja (term taksonomii `categories.kind = 'organization'`). */
export interface MentionOrg {
  kind: "org";
  slug: string;
  id: string;
  name: string;
  logoUrl: string | null;
  description: string | null;
}

export type MentionEntity = MentionPerson | MentionOrg;

/** Mapa slug -> byt. Slug jest kanonicznie mały (spójnie z parserem i bazą). */
export type MentionDirectory = ReadonlyMap<string, MentionEntity>;

/** Pusty katalog - stała, żeby nie tworzyć nowej mapy przy każdym renderze. */
export const EMPTY_DIRECTORY: MentionDirectory = new Map<string, MentionEntity>();

function trimText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text === "" ? null : text.slice(0, max);
}

/**
 * Etykieta zastępcza, gdy sluga nie da się rozwiązać (profil poza zasięgiem
 * RLS, term usunięty, sieć padła). NIGDY nie pokazujemy `@slug` - zamiast nicku
 * odtwarzamy czytelną postać z samego sluga: `anna-nowak` -> `Anna Nowak`.
 * To nie jest zgadywanie tożsamości, tylko uczytelnienie tego, co i tak stoi
 * w treści - a przy okazji jedyne miejsce, w którym nick mógłby wyciec.
 */
export function slugToDisplayName(slug: string): string {
  const words = slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toLocaleUpperCase("pl-PL") + part.slice(1));
  return words.length > 0 ? words.join(" ") : slug;
}

/** Minimalny kształt segmentu, jakiego potrzebuje zbieranie slugów. Pasuje
 *  zarówno do `MentionSegment` (parse.ts), jak i do `InlineSegment` treści
 *  klubowej - dzięki temu ta warstwa nie musi wiedzieć o module klubów. */
export interface SluggedSegment {
  kind: string;
  slug?: string;
}

/**
 * Slugi wzmianek ze zbioru treści - wejście do JEDNEGO zapytania zbiorczego na
 * powierzchnię (wątek, sekcja komentarzy, ściana klubu), zamiast zapytania na
 * wzmiankę. Kolejność wystąpienia zachowana, duplikaty usunięte.
 *
 * Parser jest WSTRZYKIWANY, a nie wybierany flagą: treść klubowa niesie też
 * linki i #tagi (`splitInline` z modułu klubów), komentarze pod artykułami -
 * same wzmianki (`splitMentions`). Gdyby ten plik sam sięgnął po parser
 * klubowy, warstwa ogólna zaczęłaby zależeć od modułu dziedzinowego.
 */
export function collectMentionSlugs(
  bodies: readonly (string | null | undefined)[],
  split: (body: string | null | undefined) => readonly SluggedSegment[] = splitMentions,
): string[] {
  const seen = new Set<string>();
  for (const body of bodies) {
    for (const seg of split(body)) {
      if (seg.kind === "mention" && typeof seg.slug === "string" && seg.slug !== "") {
        seen.add(seg.slug.toLowerCase());
      }
    }
  }
  return [...seen];
}

/** Dołącza slugi autorów (byline) do zbioru z treści - ten sam batch. */
export function withAuthorSlugs(
  slugs: readonly string[],
  authorSlugs: readonly (string | null | undefined)[],
): string[] {
  const seen = new Set<string>(slugs);
  for (const slug of authorSlugs) {
    if (typeof slug === "string" && slug.length > 0) seen.add(slug.toLowerCase());
  }
  return [...seen];
}

/** Wiersz `profiles_public` -> osoba. `lang` wybiera wariant biogramu. */
export function personFromRow(
  row: Record<string, unknown>,
  lang: "pl" | "en",
): MentionPerson | null {
  const slug = trimText(row.slug, 64);
  if (slug === null) return null;
  const name =
    trimText(row.display_name, 120) ??
    trimText([row.first_name, row.last_name].filter(Boolean).join(" "), 120) ??
    slugToDisplayName(slug);
  return {
    kind: "person",
    slug: slug.toLowerCase(),
    name,
    avatarUrl: trimText(row.avatar_url, 2048),
    jobTitle: trimText(row.job_title, 120) ?? trimText(row.specialization, 120),
    company: trimText(row.current_company, 120),
    bio: trimText(lang === "en" ? row.bio_en : row.bio_pl, 240),
    verified: typeof row.verified_at === "string" && row.verified_at.length > 0,
  };
}

/** Wiersz `categories` (kind = 'organization') -> organizacja. */
export function orgFromRow(row: Record<string, unknown>, lang: "pl" | "en"): MentionOrg | null {
  const slug = trimText(row.slug, 64);
  const id = trimText(row.id, 64);
  if (slug === null || id === null) return null;
  const primary = lang === "en" ? row.name_en : row.name_pl;
  const secondary = lang === "en" ? row.name_pl : row.name_en;
  const name = trimText(primary, 120) ?? trimText(secondary, 120) ?? slugToDisplayName(slug);
  const descPrimary = lang === "en" ? row.description_en : row.description_pl;
  const descSecondary = lang === "en" ? row.description_pl : row.description_en;
  return {
    kind: "org",
    slug: slug.toLowerCase(),
    id,
    name,
    logoUrl: trimText(row.logo_url, 2048),
    description: trimText(descPrimary, 240) ?? trimText(descSecondary, 240),
  };
}

/**
 * Buduje katalog z obu zapytań. Osoba ma PIERWSZEŃSTWO: gdy ten sam slug
 * istnieje w `profiles` i w taksonomii, wzmianka dotyczy człowieka - tak samo
 * rozstrzyga `process_mentions`, więc powiadomienie i widok mówią to samo.
 */
export function buildDirectory(
  personRows: readonly Record<string, unknown>[],
  orgRows: readonly Record<string, unknown>[],
  lang: "pl" | "en",
): MentionDirectory {
  const out = new Map<string, MentionEntity>();
  for (const row of orgRows) {
    const org = orgFromRow(row, lang);
    if (org !== null) out.set(org.slug, org);
  }
  for (const row of personRows) {
    const person = personFromRow(row, lang);
    if (person !== null) out.set(person.slug, person);
  }
  return out;
}

/**
 * Linia tożsamości pod nazwiskiem: stanowisko i/lub firma. Zwraca TABLICĘ, a
 * nie sklejony napis - dzięki temu widok warunkuje render na długości, a nie na
 * pustym stringu, i nie zostaje separator-sierota („ · ") ani pusty akapit.
 * Brak firmy = element po prostu znika i reszta przesuwa się w lewo.
 */
export function identityLine(
  jobTitle: string | null | undefined,
  company: string | null | undefined,
): string[] {
  return [jobTitle, company].filter(
    (part): part is string => typeof part === "string" && part !== "",
  );
}

/** Adres organizacji. Term ma już WŁASNY profil publiczny (/organization/$slug),
 *  więc wzmianka prowadzi do wizytówki instytucji, a nie do wyszukiwarki
 *  przefiltrowanej po jej identyfikatorze. */
export function orgHref(org: MentionOrg): string {
  return `/organization/${encodeURIComponent(org.slug)}`;
}
