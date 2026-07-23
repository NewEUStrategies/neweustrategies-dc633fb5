// Czyste narzędzia @wzmianek - jedno źródło prawdy dla FRONTENDU: renderowania
// (linkowanie @slug w treści) i podpowiedzi (typeahead przy pisaniu). Backend
// (process_mentions, migracja 20260711201000) parsuje wzmianki po stronie bazy
// tym samym wzorcem - dlatego linkujemy DOKŁADNIE to, co realnie generuje
// notyfikację, bez rozjazdu „widzę link, ale nikt nie dostał powiadomienia".
//
// Wzorzec (mirror ARE Postgresa):
//   (^|[^a-zA-Z0-9@._-])@([a-zA-Z0-9][a-zA-Z0-9_-]{1,63})
// Znak poprzedzający @ MUSI być początkiem tekstu albo znakiem spoza
// [a-zA-Z0-9@._-] - to odsiewa adresy e-mail ("user@example.com" nie jest
// wzmianką) i dopasowania w środku słowa. Slug: pierwszy znak alfanumeryczny,
// potem 1-63 znaki [a-zA-Z0-9_-]. Świadomie NIE używamy lookbehind - starsze
// Safari (<16.4) rzuca wtedy błędem parsowania wyrażenia; zamiast tego
// przechwytujemy znak graniczny do grupy 1 i re-emitujemy go jako tekst.

/** Segment treści po podziale: zwykły tekst albo wzmianka do zalinkowania. */
export type MentionSegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; slug: string; raw: string };

/** Aktywna wzmianka pisana pod kursorem (typeahead podpowiedzi). */
export interface ActiveMention {
  /** Częściowy slug wpisany po „@" (może być pusty tuż po wpisaniu „@"). */
  query: string;
  /** Indeks znaku „@" w wartości pola. */
  start: number;
  /** Indeks kursora (koniec zaznaczenia do podmiany). */
  end: number;
}

/** Maks. długość sluga (mirror {1,63} po pierwszym znaku = do 64 łącznie). */
const MAX_SLUG_LEN = 64;

// Globalny wzorzec renderowania: grupa 1 = znak graniczny (lub ""), grupa 2 = slug.
const MENTION_RE = /(^|[^a-zA-Z0-9@._-])@([a-zA-Z0-9][a-zA-Z0-9_-]{1,63})/g;

// Znak graniczny dozwolony bezpośrednio przed „@" (spójny z wzorcem powyżej).
const BOUNDARY_CHAR = /[^a-zA-Z0-9@._-]/;

// Częściowy slug w trakcie pisania: dozwolone znaki sluga, dopuszczamy pustkę.
const PARTIAL_SLUG = /^[a-zA-Z0-9_-]*$/;

/**
 * Dzieli treść na segmenty tekstu i wzmianek. Czyste, synchroniczne, bez I/O -
 * bezpieczne do wołania per komentarz na długiej liście. Znak graniczny
 * przechwycony przed „@" wraca do strumienia jako tekst (zero utraty znaków),
 * więc konkatenacja `text` wszystkich segmentów odtwarza wejście 1:1.
 */
export function splitMentions(body: string | null | undefined): MentionSegment[] {
  const out: MentionSegment[] = [];
  if (!body) return out;
  let last = 0;
  MENTION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MENTION_RE.exec(body)) !== null) {
    const full = m[0];
    const boundary = m[1] ?? "";
    const slug = m[2] ?? "";
    const matchStart = m.index;
    // Tekst sprzed dopasowania + przechwycony znak graniczny zostają tekstem.
    const textEnd = matchStart + boundary.length;
    if (textEnd > last) out.push({ kind: "text", text: body.slice(last, textEnd) });
    // slug do linku kanonicznie małymi literami (backend: lower(...)); raw
    // zachowuje wpisaną wielkość liter do wyświetlenia.
    out.push({ kind: "mention", slug: slug.toLowerCase(), raw: `@${slug}` });
    last = matchStart + full.length;
  }
  if (last < body.length) out.push({ kind: "text", text: body.slice(last) });
  return out;
}

/**
 * Wykrywa wzmiankę pisaną AKTUALNIE pod kursorem: ostatnie „@" przed kursorem,
 * poprzedzone początkiem tekstu lub znakiem granicznym, po którym idą wyłącznie
 * dozwolone znaki sluga. Zwraca zakres do podmiany i częściowy query do
 * podpowiedzi, albo null, gdy kursor nie stoi w obrębie wzmianki.
 */
export function findActiveMentionQuery(value: string, caret: number): ActiveMention | null {
  if (caret < 0 || caret > value.length) return null;
  const upto = value.slice(0, caret);
  const at = upto.lastIndexOf("@");
  if (at === -1) return null;
  const before = at === 0 ? "" : value[at - 1];
  // Znak przed „@" musi być granicą (albo początek) - inaczej to e-mail/środek słowa.
  if (before !== "" && !BOUNDARY_CHAR.test(before)) return null;
  const query = upto.slice(at + 1);
  if (query.length >= MAX_SLUG_LEN) return null;
  // Spacja / znak spoza sluga kończy wzmiankę - kursor jest już poza nią.
  if (!PARTIAL_SLUG.test(query)) return null;
  return { query, start: at, end: caret };
}

/**
 * Podmienia aktywny token „@query" na wybrany „@slug " (z końcową spacją, by od
 * razu pisać dalej). Zwraca nową wartość pola i pozycję kursora po wstawieniu.
 */
export function applyMentionSelection(
  value: string,
  active: ActiveMention,
  slug: string,
): { value: string; caret: number } {
  const insert = `@${slug} `;
  const next = value.slice(0, active.start) + insert + value.slice(active.end);
  return { value: next, caret: active.start + insert.length };
}
