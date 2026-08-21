// Zakładanie klubu - REGUŁY wyjęte z ciała `ClubCreateDialog`.
//
// CO BYŁO W JSX-IE I DLACZEGO TO REGUŁA, A NIE UKŁAD.
//
//   1. STAN ADRESU BYŁ `useMemo` Z SZEŚCIU WEJŚĆ. Kolejność warunków decyduje
//      o tym, co administrator widzi, i nie jest przemienna: kolizja zgłoszona
//      przez serwer musi wygrać z odpowiedzią „wolny" leżącą jeszcze w cache
//      React Query, a „sprawdzam" musi wygrać z brakiem odpowiedzi. Odwrócenie
//      dwóch linijek daje formularz, który pokazuje zieloną fajkę przy adresie
//      odrzuconym sekundę wcześniej przez bazę - i nie widać tego w recenzji.
//   2. WARUNEK WYSYŁKI. `canSubmit` bramkuje JEDNO kliknięcie, od którego
//      zależy, czy RPC dostanie adres, o którym wie, że jest zajęty. Stan
//      „sprawdzam" NIE jest stanem gotowym do zapisu - inaczej szybkie
//      kliknięcie po wpisaniu nazwy leci w ciemno.
//      Minimalna długość nazwy (3) jest tu, a nie w CHECK-u bazy: baza przyjmie
//      nazwę jednoliterową, tylko nikt jej potem nie znajdzie na liście.
//   3. WYBÓR KOLUMNY ZAJAWKI. Jedno pole w formularzu, dwie kolumny w bazie.
//      Zapisanie tego samego tekstu w obu udawałoby tłumaczenie, którego nie
//      ma (czytelnicy sięgają po wartość przez `pickLocalized`, więc pusta
//      kolumna cofa się do drugiego języka SAMA). Reguła zależy od języka
//      INTERFEJSU osoby piszącej i była zaszyta w dwóch linijkach literału
//      payloadu.
//   4. KOMUNIKAT ODMOWY I JEGO SKUTEK UBOCZNY. Kod `slug_taken` robi dwie
//      rzeczy naraz: wybiera napis i ZOSTAWIA trwały ślad przy polu adresu
//      (toast znika po chwili, a to jedyna odmowa naprawialna jednym polem).
//      Pozostałe kody wybierają tylko napis.
//   5. UNIEWAŻNIENIE KOLIZJI. Ślad kolizji musi zniknąć, gdy adres się zmieni,
//      i przetrwać, gdy się nie zmienił - inaczej albo blokuje poprawiony
//      adres na zawsze, albo znika przy pierwszym przerenderowaniu.
//
// UKŁADEM (i dlatego tego tu nie ma) jest: siatka par PL/EN, ramka wokół
// trzech decyzji dostępowych, kolejność sekcji, wybór ikony i klasy Tailwinda.
//
// GRANICA WARSTW: zero Reacta, zero i18n, zero klienta Supabase. Wychodzą stąd
// KLUCZE i18n oraz deskryptory, nigdy gotowy tekst.
//
// SŁOWNIK. Klucze `adminClubs.create.*` mieszkają w `i18n-club` (patrz nagłówek
// `i18n-clubs-admin`: sekcja `create` została po stronie publicznej, bo woła ją
// też trasa `/club/join/$token`), ale `adminClubs.fields.slugHint` jest już
// w słowniku PANELU, który trzeba jawnie dociągnąć przez
// `ensureAdminClubsI18n()`. Moduł tego NIE robi i nie może - nie zna Reacta ani
// i18next - i dlatego jest osiągalny WYŁĄCZNIE z komponentów panelu, które
// `ensureAdminClubsI18n()` wołają. Ta granica jest pilnowana bramką
// `adminClubsI18nLoading.gate`; jej złamanie kończy się gołym kluczem na
// ekranie i widać je dopiero w przeglądarce.
import { rankFromPlanTier, type ClubPlanTier } from "./planTiers";
import {
  clubSlugFromName,
  toClubSaveError,
  type ClubAttributionMode,
  type ClubJoinPolicy,
  type ClubLayout,
  type ClubUpsertInput,
  type ClubVisibility,
} from "./types";

/**
 * Stan adresu widziany przez formularz. `empty`/`short` to stany WEJŚCIA
 * (nie było o co pytać serwera), `checking`/`free`/`taken` - stany ODPOWIEDZI.
 */
export type ClubCreateSlugState = "empty" | "short" | "checking" | "free" | "taken";

/** Minimalna długość adresu, przy której `useClubSlugAvailable` w ogóle pyta. */
export const CLUB_SLUG_MIN_LENGTH = 3;

/** Minimalna długość nazwy polskiej, bez której zapis nie ma sensu. */
export const CLUB_CREATE_MIN_NAME_LENGTH = 3;

/**
 * Adres OBOWIĄZUJĄCY: dopóki pole adresu nie zostało tknięte, adres podąża za
 * nazwą. Po pierwszej ręcznej edycji przestaje - inaczej poprawka adresu
 * znikałaby przy następnej literze wpisanej w nazwę.
 */
export function clubCreateEffectiveSlug(input: {
  slugTouched: boolean;
  slug: string;
  namePl: string;
}): string {
  return input.slugTouched ? input.slug : clubSlugFromName(input.namePl);
}

export interface ClubCreateSlugInput {
  /** Adres obowiązujący (patrz `clubCreateEffectiveSlug`). */
  effectiveSlug: string;
  /** Adres, o który FAKTYCZNIE zapytano serwer (po opóźnieniu). */
  debouncedSlug: string;
  /** Zapytanie o dostępność jest w locie. */
  isFetching: boolean;
  /** Odpowiedź serwera; `undefined` = jeszcze nie ma. */
  available: boolean | undefined;
  /** Adres odrzucony przez RPC przy ZAPISIE (wyścig sprawdzenia z zapisem). */
  serverConflict: string | null;
}

/**
 * KOLEJNOŚĆ WARUNKÓW JEST TU TREŚCIĄ, nie stylem. Od góry:
 * pustka i zbyt krótki adres nie były pytaniem do serwera; kolizja z ZAPISU
 * bije wszystko (jest świeższa niż cache); niezgodność adresu z odpytanym albo
 * zapytanie w locie znaczy „sprawdzam"; dopiero potem czyta się odpowiedź.
 * Brak odpowiedzi to `checking`, NIE `free` - domyślna zieleń pozwalałaby
 * zapisać adres, o którym nic nie wiadomo.
 */
export function clubCreateSlugState(input: ClubCreateSlugInput): ClubCreateSlugState {
  if (input.effectiveSlug.length === 0) return "empty";
  if (input.effectiveSlug.length < CLUB_SLUG_MIN_LENGTH) return "short";
  if (input.serverConflict === input.effectiveSlug) return "taken";
  if (input.debouncedSlug !== input.effectiveSlug || input.isFetching) return "checking";
  if (input.available === false) return "taken";
  if (input.available === true) return "free";
  return "checking";
}

/**
 * Ślad kolizji z serwera unieważnia się SAM, gdy adres się zmieni. Zwraca tę
 * samą wartość, gdy nic się nie zmieniło - wywołujący wsadza to wprost do
 * `setState`, więc identyczność referencji oszczędza przerenderowanie.
 */
export function nextClubSlugConflict(current: string | null, effectiveSlug: string): string | null {
  return current !== null && current !== effectiveSlug ? null : current;
}

/** Napis POD polem adresu wraz z informacją, czy to komunikat błędu. */
export interface ClubCreateSlugMessage {
  key: string;
  /** Prawda = ton destrukcyjny i `role="alert"` (czytnik ma to przeczytać). */
  alert: boolean;
}

export function clubCreateSlugMessage(state: ClubCreateSlugState): ClubCreateSlugMessage {
  if (state === "taken") return { key: "adminClubs.create.slugTaken", alert: true };
  if (state === "free") return { key: "adminClubs.create.slugFree", alert: false };
  return { key: "adminClubs.fields.slugHint", alert: false };
}

/** Znacznik OBOK pola adresu. `none` = miejsce zarezerwowane, nic nie widać. */
export type ClubCreateSlugMark = "spinner" | "ok" | "error" | "none";

/**
 * Suma ROZŁĄCZNA, nie jeden kształt z polem opcjonalnym: znacznik widoczny ZAWSZE
 * niesie etykietę, bo jest ikoną i jego znaczenie istnieje wyłącznie w
 * `aria-label`. Wariant `none` nie ma etykiety, bo nie ma czego opisać - i typ
 * pilnuje, żeby wywołujący nie sprawdzał pustki, której nie może dostać.
 */
export type ClubCreateSlugMarkDescriptor =
  { mark: "none" } | { mark: "spinner" | "ok" | "error"; labelKey: string };

export function clubCreateSlugMark(state: ClubCreateSlugState): ClubCreateSlugMarkDescriptor {
  if (state === "checking") return { mark: "spinner", labelKey: "adminClubs.create.slugChecking" };
  if (state === "free") return { mark: "ok", labelKey: "adminClubs.create.slugFree" };
  if (state === "taken") return { mark: "error", labelKey: "adminClubs.create.slugTaken" };
  return { mark: "none" };
}

/**
 * Czy wolno wysłać. Trzy warunki, każdy odcina inną klasę pomyłki: nazwa zbyt
 * krótka (klub nie do znalezienia), adres w stanie innym niż `free` (zapis
 * w ciemno albo pod pewny błąd), zapis już leci (drugie kliknięcie = drugi
 * klub).
 */
export function canSubmitClubCreate(input: {
  namePl: string;
  slugState: ClubCreateSlugState;
  isPending: boolean;
}): boolean {
  return (
    input.namePl.trim().length >= CLUB_CREATE_MIN_NAME_LENGTH &&
    input.slugState === "free" &&
    !input.isPending
  );
}

/** Wartości formularza zakładania - kształt 1:1 ze stanem `ClubCreateDialog`. */
export interface ClubCreateFormValues {
  slug: string;
  namePl: string;
  nameEn: string;
  tagline: string;
  visibility: ClubVisibility;
  joinPolicy: ClubJoinPolicy;
  attribution: ClubAttributionMode;
  layout: ClubLayout;
  planTier: ClubPlanTier;
  cover: string;
  topic: string | null;
}

/** Puste pole tekstowe jedzie jako `null`, nie jako `""`. */
function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Payload `admin_club_upsert` dla NOWEGO klubu.
 *
 * REGUŁY, które tu mieszkają:
 * - NAZWA ANGIELSKA DZIEDZICZY PO POLSKIEJ. Klub bez `name_en` pokazywałby
 *   pusty tytuł na `/en/`.
 * - ZAJAWKA IDZIE DO KOLUMNY JĘZYKA, W KTÓRYM PRACUJE REDAKTOR, a druga
 *   zostaje pusta CELOWO (patrz punkt 3 nagłówka pliku).
 * - PRÓG PLANU zapisuje się jako RANGA, nie jako nazwa progu - kolumna
 *   `min_tier_rank` jest liczbą i porównuje się ją nierównością.
 * - KLUB POWSTAJE JAKO WERSJA ROBOCZA. Zakładanie nie jest publikowaniem:
 *   status `draft` daje czas na ustawienie reszty w edytorze.
 */
export function clubCreatePayload(
  values: ClubCreateFormValues,
  options: { writesPolish: boolean },
): ClubUpsertInput {
  const namePl = values.namePl.trim();
  const nameEn = values.nameEn.trim();
  const tagline = orNull(values.tagline);
  return {
    slug: values.slug,
    name_pl: namePl,
    name_en: nameEn !== "" ? nameEn : namePl,
    tagline_pl: options.writesPolish ? tagline : null,
    tagline_en: options.writesPolish ? null : tagline,
    visibility: values.visibility,
    join_policy: values.joinPolicy,
    attribution_mode: values.attribution,
    layout: values.layout,
    min_tier_rank: rankFromPlanTier(values.planTier),
    cover_image_url: orNull(values.cover),
    policy_area: values.topic,
    status: "draft",
  };
}

/** Skutki odmowy RPC: napis w toaście i ewentualny trwały ślad przy polu. */
export interface ClubCreateFailure {
  key: string;
  /**
   * Prawda TYLKO dla `slug_taken`: jedyna odmowa, którą piszący naprawia
   * jednym polem, więc dostaje trwały komunikat obok tego pola.
   */
  blocksSlug: boolean;
}

export function clubCreateFailure(error: unknown): ClubCreateFailure {
  const code = toClubSaveError(error);
  return { key: `adminClubs.create.error.${code}`, blocksSlug: code === "slug_taken" };
}
