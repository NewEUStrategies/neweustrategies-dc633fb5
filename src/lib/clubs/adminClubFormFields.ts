// Pola tekstowe zakładki „Ogólne" edytora klubu jako TABELA, nie jako JSX.
//
// CO BYŁO W JSX-IE. Dziewięć niemal identycznych bloków `Label + Input`
// (albo `Textarea`), każdy z własnym `id`, własnym kluczem etykiety, własnym
// `maxLength` i własnym handlerem `onChange={(e) => onChange({ pole: ... })}`.
// Trzy z tych czterech rzeczy to REGUŁY, a nie układ:
//
//   1. KLUCZ ŁATKI. Handler decyduje, KTÓRE pole wersji roboczej się zmienia.
//      Wszystkie klucze są napisami tego samego typu, więc wklejony blok
//      z `namePl` zamiast `nameEn` przechodzi przez `tsc`, przez przegląd
//      (dwa sąsiadujące, prawie identyczne bloki) i przez interfejs (pole
//      przyjmuje tekst, tylko zapisuje go w niewłaściwej kolumnie). Wykrywa
//      to WYŁĄCZNIE test wołający każde pole osobno - i po to jest tu tabela:
//      test iteruje po niej, więc nowe pole bez asercji nie istnieje.
//   2. LIMIT ZNAKÓW. `maxLength` odwzorowuje limit kolumny w bazie. Pole bez
//      limitu przyjmuje tekst, którego zapis wróci błędem po stronie serwera -
//      czyli użytkownik traci wpisaną treść.
//   3. NORMALIZACJA SLUGA W LOCIE. Slug jest jedynym polem, którego treści nie
//      przepisujemy 1:1: CHECK w bazie dopuszcza tylko `[a-z0-9-]`. Reguła
//      mieszka w `adminClubEditor` (`normalizeClubSlugInput`) i tutaj jest
//      tylko WPIĘTA - `clubGeneralTextPatch` jest jedynym miejscem, w którym
//      wybiera się między „przepisz" a „znormalizuj".
//
// UKŁADEM (i dlatego tego tu nie ma) jest: siatka dwukolumnowa dla par PL/EN,
// podział na karty, kolejność kart i klasy Tailwinda.
//
// Zero Reacta, zero i18n, zero klienta Supabase - wychodzą stąd KLUCZE i18n
// i deskryptory, nigdy gotowy tekst.
//
// SŁOWNIK PANELU, A NIE PUBLICZNY. Klucze `adminClubs.*` zwracane przez ten
// moduł mieszkają w `i18n-clubs-admin`, który trzeba jawnie dociągnąć przez
// `ensureAdminClubsI18n()`. Moduł tego NIE robi i nie może - nie zna Reacta
// ani i18next - i dlatego jest osiągalny WYŁĄCZNIE z organizmów panelu, które
// `ensureAdminClubsI18n()` wołają. Ta granica jest pilnowana bramką
// `adminClubsI18nLoading.gate`; jej złamanie kończy się gołym kluczem na
// ekranie i widać je dopiero w przeglądarce.
import { normalizeClubSlugInput, type ClubGeneralDraftValues } from "./adminClubEditor";

/**
 * Klucze wersji roboczej obsługiwane polem tekstowym. Świadomie NIE zawiera
 * `policyArea`, `status`, `cover` ani `layout` - te mają własne kontrolki
 * (droplista, wybór okładki, wybór układu), a nie pole tekstowe.
 */
export type ClubGeneralTextKey =
  | "namePl"
  | "nameEn"
  | "slug"
  | "taglinePl"
  | "taglineEn"
  | "descriptionPl"
  | "descriptionEn"
  | "rulesPl"
  | "rulesEn";

/**
 * Grupa układu. Tabela nie wie, jak wygląda siatka, ale wie, KTÓRE pola idą
 * razem - inaczej organizm musiałby wyliczać podzbiory po nazwach.
 */
export type ClubGeneralFieldGroup = "identity" | "slug" | "tagline" | "body";

export interface ClubGeneralTextField {
  key: ClubGeneralTextKey;
  group: ClubGeneralFieldGroup;
  /** `id` w DOM - wiąże `<label>` z polem, więc jest częścią dostępności. */
  id: string;
  labelKey: string;
  /** Limit kolumny w bazie; brak = kolumna `text` bez limitu. */
  maxLength?: number;
  /** Obecne = pole wielolinijkowe o tej liczbie wierszy. */
  rows?: number;
  hintKey?: string;
}

/**
 * Kolejność wpisów = kolejność pól w formularzu. Zmiana kolejności zmienia
 * kolejność w interfejsie, więc jest widoczna w teście kolejności etykiet.
 */
export const CLUB_GENERAL_TEXT_FIELDS: readonly ClubGeneralTextField[] = [
  {
    key: "namePl",
    group: "identity",
    id: "club-name-pl",
    labelKey: "adminClubs.fields.namePl",
    maxLength: 120,
  },
  {
    key: "nameEn",
    group: "identity",
    id: "club-name-en",
    labelKey: "adminClubs.fields.nameEn",
    maxLength: 120,
  },
  {
    key: "slug",
    group: "slug",
    id: "club-slug",
    labelKey: "adminClubs.fields.slug",
    hintKey: "adminClubs.fields.slugHint",
  },
  {
    key: "taglinePl",
    group: "tagline",
    id: "club-tagline-pl",
    labelKey: "adminClubs.fields.taglinePl",
    maxLength: 200,
  },
  {
    key: "taglineEn",
    group: "tagline",
    id: "club-tagline-en",
    labelKey: "adminClubs.fields.taglineEn",
    maxLength: 200,
  },
  {
    key: "descriptionPl",
    group: "body",
    id: "club-desc-pl",
    labelKey: "adminClubs.fields.descriptionPl",
    rows: 4,
  },
  {
    key: "descriptionEn",
    group: "body",
    id: "club-desc-en",
    labelKey: "adminClubs.fields.descriptionEn",
    rows: 4,
  },
  {
    key: "rulesPl",
    group: "body",
    id: "club-rules-pl",
    labelKey: "adminClubs.fields.rulesPl",
    rows: 3,
  },
  {
    key: "rulesEn",
    group: "body",
    id: "club-rules-en",
    labelKey: "adminClubs.fields.rulesEn",
    rows: 3,
    hintKey: "adminClubs.fields.rulesHint",
  },
];

/** Pola danej grupy, w kolejności tabeli. */
export function clubGeneralFieldsIn(group: ClubGeneralFieldGroup): readonly ClubGeneralTextField[] {
  return CLUB_GENERAL_TEXT_FIELDS.filter((field) => field.group === group);
}

/**
 * KLUCZ OSTRZEŻENIA o zmianie sluga.
 *
 * UWAGA - ZNANY DEFEKT TREŚCIOWY, ZACHOWANY 1:1. Dzisiejszy JSX pokazuje pod
 * polem sluga tę samą podpowiedź DWA RAZY: raz szarą (`hintKey`), raz
 * bursztynową z trójkątem (to ostrzeżenie). Ostrzeżenie nie mówi więc nic
 * ponad podpowiedź, którą użytkownik już widzi. Refaktor jest zachowaniowo
 * neutralny, więc klucz zostaje ten sam, a defekt jest zgłoszony testem
 * `it.fails` w `ClubGeneralTab.test.tsx` - naprawa wymaga NOWEGO klucza i18n
 * w PL i EN, czyli zmiany treści, nie przeniesienia kodu.
 */
export const CLUB_SLUG_CHANGED_WARNING_KEY = "adminClubs.fields.slugHint";

/**
 * Łatka wersji roboczej z pola tekstowego. Slug jedzie przez normalizację,
 * pozostałe pola 1:1 - to jedyne rozgałęzienie w drodze od klawiatury do
 * wersji roboczej i dlatego jest osobną funkcją, a nie warunkiem w JSX-ie.
 */
export function clubGeneralTextPatch(
  key: ClubGeneralTextKey,
  raw: string,
): Partial<ClubGeneralDraftValues> {
  const value = key === "slug" ? normalizeClubSlugInput(raw) : raw;
  const patch: { [K in ClubGeneralTextKey]?: string } = { [key]: value };
  return patch;
}
