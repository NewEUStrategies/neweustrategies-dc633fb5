// Warstwa INTENCJI profilu - czysty moduł (bez Reacta, bez klienta Supabase).
//
// Katalog mówi, CZEGO ktoś szuka, a nie kim jest. To druga połowa profilu,
// której katalog osób nie miał: „Head of EU Affairs, Bruksela" opisuje
// stanowisko; „szukam partnerów do konsorcjum Horizon" opisuje powód rozmowy.
//
// Kody są ZAMKNIĘTYM zbiorem, bo służą fasecie („pokaż wszystkich otwartych na
// konsorcja") - tekst swobodny (seeking/offering) obsługuje resztę. Ten sam
// zbiór, w tej samej kolejności, żyje w bazie jako
// `public.nes_profile_open_to_catalog()` (migracja 20260807141000); bramka
// `src/lib/ci/__tests__/profileIntentCatalog.gate.test.ts` porównuje oba
// światy, więc dopisanie kodu tylko po jednej stronie wywala CI.
//
// Etykiety NIE mieszkają tutaj - są w słownikach i18n
// (`profileIntent.openTo.<kod>`), bo katalog jest dwujęzyczny.

/** Kod intencji - dokładnie zbiór z `nes_profile_open_to_catalog()`. */
export type ProfileIntentCode =
  | "consortium"
  | "partnership"
  | "advisory"
  | "speaking"
  | "co_authoring"
  | "mentoring"
  | "hiring"
  | "job_change"
  | "investment"
  | "media";

/**
 * Kolejność prezentacji = kolejność katalogu w bazie. Od intencji
 * najsilniej „projektowych" (konsorcjum, partnerstwo) do sygnałów
 * indywidualnych (zmiana roli, media).
 */
export const PROFILE_INTENT_CODES = [
  "consortium",
  "partnership",
  "advisory",
  "speaking",
  "co_authoring",
  "mentoring",
  "hiring",
  "job_change",
  "investment",
  "media",
] as const satisfies readonly ProfileIntentCode[];

/**
 * Sufit intencji na profil - odpowiednik CHECK-a
 * `profiles_open_to_cardinality_check`. „Otwarty na wszystko" nie jest
 * intencją, więc katalog nie pozwala zaznaczyć wszystkiego.
 */
export const PROFILE_INTENT_MAX = 6;

/** Sufit pól swobodnych - odpowiednik `profiles_intent_text_length_check`. */
export const PROFILE_INTENT_TEXT_MAX = 600;

/**
 * Minimum, od którego „czego szukam" liczy się do kompletności profilu
 * (patrz `PROFILE_COMPLETENESS_WEIGHTS.seeking` i próg w SQL). Jedno zdanie
 * to jeszcze nie brief, ale to więcej niż jedno słowo.
 */
export const PROFILE_SEEKING_MIN = 40;

const CODE_SET: ReadonlySet<string> = new Set<string>(PROFILE_INTENT_CODES);

/** Type guard - odsiewa kody nieznane katalogowi (dryf danych, ręczny URL). */
export function isProfileIntentCode(value: unknown): value is ProfileIntentCode {
  return typeof value === "string" && CODE_SET.has(value);
}

/**
 * Normalizuje dowolne wejście (tablica z bazy, CSV z URL-a) do kanonicznej,
 * odduplikowanej listy w kolejności katalogu, przyciętej do sufitu.
 * Kolejność katalogu, a nie kolejność zapisu: dzięki temu ten sam zestaw
 * intencji renderuje się identycznie niezależnie od tego, jak go zaznaczono.
 */
export function normalizeProfileIntents(
  input: readonly string[] | string | null | undefined,
): ProfileIntentCode[] {
  const raw = typeof input === "string" ? input.split(",") : (input ?? []);
  const picked = new Set<ProfileIntentCode>();
  for (const entry of raw) {
    const code = entry.trim();
    if (isProfileIntentCode(code)) picked.add(code);
  }
  return PROFILE_INTENT_CODES.filter((code) => picked.has(code)).slice(0, PROFILE_INTENT_MAX);
}

/** Serializacja do parametru URL katalogu osób (`?open=consortium,advisory`). */
export function serializeProfileIntents(codes: readonly ProfileIntentCode[]): string {
  return normalizeProfileIntents(codes).join(",");
}

/** Klucz i18n etykiety intencji - jedno miejsce zamiast szablonu w każdym widoku. */
export function profileIntentLabelKey(code: ProfileIntentCode): string {
  return `profileIntent.openTo.${code}`;
}
