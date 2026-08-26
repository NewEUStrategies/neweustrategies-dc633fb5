// Wersja robocza ekranu „Ustawienia rejestracji" studia wydarzenia.
//
// DLACZEGO OSOBNY MODUL, A NIE STAN W KOMPONENCIE. Kazda regula tego ekranu ma
// DRUGIE miejsce zycia w bazie - raz jako CHECK na `events`, raz jako
// `RAISE EXCEPTION` w `admin_event_general_save`. Dwa miejsca rozjezdzaja sie
// dokladnie wtedy, gdy nikt na to nie patrzy, a rozjazd tutaj ma jeden widoczny
// skutek: redaktor dostaje `23514 violates check constraint` zamiast zdania po
// polsku. Reguly czyste daja sie zestawic z migracja bez DOM-u i bez bazy, wiec
// test pilnuje obu stron kontraktu.
//
// TRZY REGULY SA TU OSTRZEJSZE NIZ RPC - I TO NIE JEST NADMIAR. `admin_event_general_save`
// odrzuca `capacity < 0`, ale kolumna ma CHECK `capacity IS NULL OR capacity > 0`
// (`20260713093000`), wiec zero przechodzi walidacje RPC i wywala sie na tabeli.
// Tak samo cena: RPC pilnuje `>= 0`, a `events_ticket_price_positive` wymaga
// `>= 100` groszy. Tak samo waluta: RPC przyjmuje dowolne trzy litery, a
// `events_ticket_currency_allowed` zamyka zbior na dwie. Kazdy z tych trzech
// przypadkow to surowy `23514` u redaktora - dlatego odcinamy je TUTAJ.
//
// ADRES ZEWNETRZNY SPRAWDZAMY W KAZDYM TRYBIE, nie tylko w `external`. RPC patrzy
// na jego ksztalt wylacznie dla trybu `external`, ale CHECK
// `events_external_registration_url_https` obowiazuje ZAWSZE - adres `http://`
// wklejony „na probe" przy trybie `rsvp` przeszedlby przez RPC i wywalil sie na
// tabeli. Adres zostaje zapisany takze wtedy, gdy tryb go nie uzywa (RPC go nie
// zeruje), wiec musi byc poprawny niezaleznie od trybu.
//
// PUSTY NAPIS ZNACZY „NIE PODANO". Tak samo jak w `eventGeneralDraft` - `null`
// w polu formularza zmuszalby kazda liczbe i kazda date do osobnego typu.
//
// CENE TRZYMAMY W JEDNOSTKACH GLOWNYCH, a nie w groszach. Pole „250,00" jest tym,
// co redaktor ma na fakturze; pole „25000" jest tym, co czyta baza. `formatMoney`
// z `lib/billing/types` NIE nadaje sie na wartosc pola: zwraca gotowy napis
// z symbolem waluty przez `Intl.NumberFormat` („250,00 zl"), czyli tekst do
// CZYTANIA, ktorego nie da sie oddac z powrotem do `<input>` ani sparsowac.
// Dlatego przeliczenie stoi tu jawnie, na napisach, a nie na `Number * 100`:
// mnozenie zmiennoprzecinkowe daje `250.55 * 100 = 25055.000000000004`, a od
// zaokraglania groszy zaczyna sie klasa bledow, ktorej nie widac w testach
// z okraglymi kwotami.
//
// KLUCZE KOMUNIKATOW SA PELNYMI LITERALAMI, a nie sklejane z prefiksu. Bramka
// `eventsI18nKeys.gate` widzi goly literal w ksztalcie klucza i sprawdza, czy
// istnieje w PL i EN; klucz sklejony z `${PREFIX}nazwa` jest dla niej
// niewidzialny, wiec dopisany tutaj i zapomniany w slowniku przeszedlby CI.
//
// GRANICA WARSTW: zero Reacta, zero i18next, zero klienta bazy.
import {
  EVENT_REGISTRATION_FLOWS,
  EVENT_REGISTRATION_MODES,
  asEventRegistrationFlow,
  asEventRegistrationMode,
  type EventFormat,
  type EventRegistrationFlow,
  type EventRegistrationMode,
} from "@/lib/events/eventTypes";
// TEN SAM ZAMKNIETY ZBIOR WALUT, DWA CHECK-i. `events_ticket_currency_allowed`
// i `event_ticket_types_currency_values` dopuszczaja te same dwie waluty, wiec
// druga lista w kodzie rozjechalaby sie przy pierwszym dopisaniu trzeciej.
import { TICKET_CURRENCIES, type TicketCurrency } from "@/lib/events/ticketDraft";

export { EVENT_REGISTRATION_FLOWS, EVENT_REGISTRATION_MODES, TICKET_CURRENCIES };
export type { EventRegistrationFlow, EventRegistrationMode, TicketCurrency };

/** Limit dlugosci kazdego adresu - ten sam, ktory pilnuje RPC. */
export const REGISTRATION_SETTINGS_MAX_URL = 2048;

/** Dolna granica ceny z CHECK-a `events_ticket_price_positive`: 1,00 w walucie. */
export const REGISTRATION_SETTINGS_MIN_PRICE_CENTS = 100;

/** KTO widzi wydarzenie w katalogu i na stronie publicznej. */
export const EVENT_VISIBILITIES = ["public", "members"] as const;
export type EventVisibility = (typeof EVENT_VISIBILITIES)[number];

export const EVENT_VISIBILITY_LABEL_KEYS: Record<EventVisibility, string> = {
  public: "adminEvents.studio.registrationSettings.visibilities.public",
  members: "adminEvents.studio.registrationSettings.visibilities.members",
};

export const EVENT_VISIBILITY_HINT_KEYS: Record<EventVisibility, string> = {
  public: "adminEvents.studio.registrationSettings.visibilityHints.public",
  members: "adminEvents.studio.registrationSettings.visibilityHints.members",
};

/** Jedno zdanie na karcie trybu: CO SIE STANIE, gdy uczestnik kliknie „Zapisz sie". */
export const EVENT_REGISTRATION_MODE_HINT_KEYS: Record<EventRegistrationMode, string> = {
  rsvp: "adminEvents.studio.registrationSettings.modeHints.rsvp",
  form: "adminEvents.studio.registrationSettings.modeHints.form",
  external: "adminEvents.studio.registrationSettings.modeHints.external",
  none: "adminEvents.studio.registrationSettings.modeHints.none",
};

export const EVENT_REGISTRATION_FLOW_HINT_KEYS: Record<EventRegistrationFlow, string> = {
  instant: "adminEvents.studio.registrationSettings.flowHints.instant",
  approval: "adminEvents.studio.registrationSettings.flowHints.approval",
};

export interface RegistrationSettingsFieldError {
  field: RegistrationSettingsField;
  messageKey: string;
}

export interface RegistrationSettingsDraft {
  registrationMode: EventRegistrationMode;
  registrationFlow: EventRegistrationFlow;
  externalRegistrationUrl: string;
  visibility: EventVisibility;
  /** Liczba jako tekst - `<input>` nie zna liczb, tylko znaki (takze minus). */
  minTierRank: string;
  /** Pusty tekst = brak pierwszenstwa dla wyzszych warstw. */
  earlyRsvpRank: string;
  /** ISO 8601 albo pusty tekst = zapisy otwarte od publikacji. */
  rsvpOpensAt: string;
  chathamHouse: boolean;
  /** Pusty tekst = bez limitu miejsc. Zero jest NIEDOPUSZCZALNE (CHECK `> 0`). */
  capacity: string;
  /** Cena w JEDNOSTKACH GLOWNYCH („250,00"). Pusty tekst = wydarzenie bezplatne. */
  ticketPrice: string;
  ticketCurrency: TicketCurrency;
  joinUrl: string;
  recordingUrl: string;
}

export type RegistrationSettingsField = keyof RegistrationSettingsDraft;

const HTTPS_PATTERN = /^https:\/\/\S+$/i;
const INTEGER_PATTERN = /^-?\d+$/;
/** Kwota w jednostkach glownych: kropka albo przecinek, najwyzej dwa miejsca. */
const PRICE_PATTERN = /^\d+(?:[.,]\d{1,2})?$/;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Liczba z wiersza RPC jako tekst pola. Kolumny `capacity`, `early_rsvp_rank`
 * i `ticket_price_cents` sa NULL-owalne, choc generator typow oddaje je jako
 * `number` - `null` musi zostac PUSTYM polem, a nie zerem, bo zero znaczy tu
 * co innego niz brak (limit zero miejsc kontra brak limitu).
 */
function integerText(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(Math.trunc(value)) : "";
}

/** Wartosc z bazy -> widocznosc. Poza zbiorem degraduje do WEZSZEJ z dwoch. */
export function asEventVisibility(value: string | null | undefined): EventVisibility {
  // Kierunek degradacji jest swiadomy: uszkodzona wartosc ma ZAMKNAC wydarzenie
  // dla czlonkow, a nie otworzyc je publicznie. Domyslna wartosc kolumny to
  // `public`, ale to jest decyzja redaktora przy tworzeniu, a nie awaryjny
  // fallback dla danych, ktorych nie umiemy odczytac.
  return value === "public" || value === "members" ? value : "members";
}

/** Wartosc z bazy -> waluta. Wielkosc liter normalizowana, poza zbiorem `PLN`. */
export function asEventTicketCurrency(value: string | null | undefined): TicketCurrency {
  const upper = typeof value === "string" ? value.trim().toUpperCase() : "";
  return (TICKET_CURRENCIES as readonly string[]).includes(upper)
    ? (upper as TicketCurrency)
    : "PLN";
}

/**
 * Grosze -> wartosc pola w jednostkach glownych („25000" -> „250.00").
 *
 * Separatorem jest KROPKA, bo to kanoniczny zapis pola liczbowego (`inputMode`
 * `decimal`), ktory wraca do parsera bez straty. Przecinek z polskiej klawiatury
 * numerycznej parser przyjmuje - patrz `registrationPriceCents`.
 */
export function registrationPriceInput(cents: number): string {
  const whole = Math.trunc(Math.abs(cents) / 100);
  const rest = Math.abs(cents) % 100;
  const sign = cents < 0 ? "-" : "";
  return `${sign}${whole}.${String(rest).padStart(2, "0")}`;
}

/**
 * Wartosc pola -> grosze. `null` = pole puste (wydarzenie bezplatne),
 * `Number.NaN` = zapis nieczytelny.
 *
 * Odstepy sa USUWANE przed sprawdzeniem wzorca: „1 250,00" wklejone z faktury
 * jest poprawna kwota, a nie bledem redaktora (`\s` w JS obejmuje takze spacje
 * nierozdzielajace, ktore wkleja edytor tekstu).
 */
export function registrationPriceCents(value: string): number | null {
  const compact = value.replace(/\s/g, "");
  if (compact === "") return null;
  if (!PRICE_PATTERN.test(compact)) return Number.NaN;
  const [whole, fraction = ""] = compact.replace(",", ".").split(".");
  // Arytmetyka na napisach, nie `Number(compact) * 100`: mnozenie
  // zmiennoprzecinkowe daje 25055.000000000004 dla „250,55".
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/** Liczba calkowita z pola albo `null` (puste) / `Number.NaN` (nieczytelne). */
function integerOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return INTEGER_PATTERN.test(trimmed) ? Number(trimmed) : Number.NaN;
}

/** Szkic z wiersza RPC. Nieznane pole degraduje do pustego, a nie wywraca ekranu. */
export function registrationSettingsDraftFromRow(
  row: Record<string, unknown>,
): RegistrationSettingsDraft {
  const cents = row["ticket_price_cents"];
  return {
    registrationMode: asEventRegistrationMode(text(row["registration_mode"])),
    registrationFlow: asEventRegistrationFlow(text(row["registration_flow"])),
    externalRegistrationUrl: text(row["external_registration_url"]),
    visibility: asEventVisibility(text(row["visibility"])),
    minTierRank: integerText(row["min_tier_rank"]),
    earlyRsvpRank: integerText(row["early_rsvp_rank"]),
    rsvpOpensAt: text(row["rsvp_opens_at"]),
    chathamHouse: row["chatham_house"] === true,
    capacity: integerText(row["capacity"]),
    ticketPrice:
      typeof cents === "number" && Number.isFinite(cents) ? registrationPriceInput(cents) : "",
    ticketCurrency: asEventTicketCurrency(text(row["ticket_currency"])),
    // ADRES TRANSMISJI I NAGRANIA WRACAJA TYLKO Z `admin_event_detail`. Oba sa
    // odciete od klienckiego SELECT-a grantem kolumnowym (`20260713093000`,
    // `20260803191905`), a to definerowe RPC stoi za `assert_editor_tenant` -
    // dlatego ekran redaktora moze je w ogole POKAZAC, a nie tylko zapisac na
    // slepo.
    joinUrl: text(row["join_url"]),
    recordingUrl: text(row["recording_url"]),
  };
}

/**
 * Powody odrzucenia wersji roboczej. Kolejnosc jest kolejnoscia CZYTANIA ekranu
 * - pierwszy blad, na ktory redaktor natrafi wzrokiem, ma byc pierwszy na liscie.
 */
export function validateRegistrationSettingsDraft(
  draft: RegistrationSettingsDraft,
): readonly RegistrationSettingsFieldError[] {
  const errors: RegistrationSettingsFieldError[] = [];

  const external = draft.externalRegistrationUrl.trim();
  if (draft.registrationMode === "external" && external === "") {
    errors.push({
      field: "externalRegistrationUrl",
      messageKey: "adminEvents.studio.registrationSettings.errors.externalUrlRequired",
    });
  } else if (external !== "" && !HTTPS_PATTERN.test(external)) {
    errors.push({
      field: "externalRegistrationUrl",
      messageKey: "adminEvents.studio.registrationSettings.errors.externalUrlInvalid",
    });
  } else if (external.length > REGISTRATION_SETTINGS_MAX_URL) {
    errors.push({
      field: "externalRegistrationUrl",
      messageKey: "adminEvents.studio.registrationSettings.errors.externalUrlTooLong",
    });
  }

  const tier = integerOrNull(draft.minTierRank);
  if (tier !== null && (Number.isNaN(tier) || tier < 0)) {
    errors.push({
      field: "minTierRank",
      messageKey: "adminEvents.studio.registrationSettings.errors.tierRankInvalid",
    });
  }

  const early = integerOrNull(draft.earlyRsvpRank);
  if (early !== null && (Number.isNaN(early) || early < 0)) {
    errors.push({
      field: "earlyRsvpRank",
      messageKey: "adminEvents.studio.registrationSettings.errors.tierRankInvalid",
    });
  }

  // ZERO MIEJSC NIE JEST LIMITEM, jest wydarzeniem zamknietym - i CHECK
  // `capacity > 0` je odrzuca. „Bez zapisow" ma na to wlasny tryb.
  const capacity = integerOrNull(draft.capacity);
  if (capacity !== null && (Number.isNaN(capacity) || capacity < 1)) {
    errors.push({
      field: "capacity",
      messageKey: "adminEvents.studio.registrationSettings.errors.capacityInvalid",
    });
  }

  const price = registrationPriceCents(draft.ticketPrice);
  if (price !== null && Number.isNaN(price)) {
    errors.push({
      field: "ticketPrice",
      messageKey: "adminEvents.studio.registrationSettings.errors.priceInvalid",
    });
  } else if (price !== null && price < REGISTRATION_SETTINGS_MIN_PRICE_CENTS) {
    // Kwota nizsza niz 1,00 jest nieoperatorowalna dla operatora platnosci,
    // i dokladnie tak stoi w CHECK-u. „Bezplatne" zapisuje sie PUSTYM polem.
    errors.push({
      field: "ticketPrice",
      messageKey: "adminEvents.studio.registrationSettings.errors.priceTooLow",
    });
  }

  // ADRES `http` TO MIESZANA TRESC. Strona wydarzenia idzie po https, wiec
  // przegladarka pokaze ostrzezenie o niezabezpieczonym polaczeniu dokladnie
  // w tym momencie, w ktorym uczestnik klika „Wejdz na transmisje" - czyli
  // w jedynym momencie, w ktorym ten adres ma znaczenie.
  const join = draft.joinUrl.trim();
  if (join !== "" && (!HTTPS_PATTERN.test(join) || join.length > REGISTRATION_SETTINGS_MAX_URL)) {
    errors.push({
      field: "joinUrl",
      messageKey: "adminEvents.studio.registrationSettings.errors.joinUrlInvalid",
    });
  }

  const recording = draft.recordingUrl.trim();
  if (
    recording !== "" &&
    (!HTTPS_PATTERN.test(recording) || recording.length > REGISTRATION_SETTINGS_MAX_URL)
  ) {
    errors.push({
      field: "recordingUrl",
      messageKey: "adminEvents.studio.registrationSettings.errors.recordingUrlInvalid",
    });
  }

  return errors;
}

/**
 * Ostrzezenia - rzeczy, ktore NIE blokuja zapisu, ale znacza, ze ustawienie nie
 * robi tego, czego redaktor od niego oczekuje.
 *
 * FORMAT JEST ARGUMENTEM, A NIE POLEM SZKICU. Ten ekran formatu nie zapisuje
 * (mieszka na „Informacjach ogolnych"), a szkic zawiera wylacznie pola, ktore
 * ekran wysyla - pole nieedytowalne wlozone do szkicu zaraz trafiloby do
 * payloadu i nadpisywaloby cudzy ekran.
 *
 * CZEGO TU NIE MA: „limit miejsc mniejszy od liczby zatwierdzonych zgloszen".
 * Tego modul czysty nie wie i nie ma skad wiedziec - liczba zgloszen jest
 * zapytaniem do bazy, a nie funkcja szkicu.
 */
export function registrationSettingsWarnings(
  draft: RegistrationSettingsDraft,
  format: EventFormat,
): readonly string[] {
  const warnings: string[] = [];

  // Wydarzenie online, na ktore da sie zapisac, ale bez adresu transmisji:
  // uczestnik dostaje potwierdzenie zapisu i nie ma gdzie wejsc.
  const collectsSignups = draft.registrationMode === "rsvp" || draft.registrationMode === "form";
  if (collectsSignups && format === "online" && draft.joinUrl.trim() === "") {
    warnings.push("adminEvents.studio.registrationSettings.warnings.onlineWithoutJoinUrl");
  }

  // Pierwszenstwo bez daty otwarcia nie robi NIC: nie ma przed czym byc
  // pierwszym, jesli zapisy sa otwarte od publikacji dla wszystkich.
  if (draft.earlyRsvpRank.trim() !== "" && draft.rsvpOpensAt.trim() === "") {
    warnings.push("adminEvents.studio.registrationSettings.warnings.earlyRankWithoutOpening");
  }

  // Cena przy trybie „bez zapisow": nie ma jak kupic, bo nie ma zapisu, do
  // ktorego doklada sie płatnosc.
  const price = registrationPriceCents(draft.ticketPrice);
  if (draft.registrationMode === "none" && price !== null && !Number.isNaN(price) && price > 0) {
    warnings.push("adminEvents.studio.registrationSettings.warnings.pricedWithoutRegistration");
  }

  // Zasada Chatham House przy stronie publicznej jest obietnica, ktorej strona
  // nie dowozi: tresc czyta kazdy, takze ten, kto zasady nie przyjal.
  if (draft.chathamHouse && draft.visibility === "public") {
    warnings.push("adminEvents.studio.registrationSettings.warnings.chathamHouseOnPublicPage");
  }

  return warnings;
}

/** Czy wersja robocza rozni sie od zapisanej - warunek aktywnosci „Zapisz". */
export function registrationSettingsDirty(
  a: RegistrationSettingsDraft,
  b: RegistrationSettingsDraft,
): boolean {
  return (
    JSON.stringify(registrationSettingsPayload("", a)) !==
    JSON.stringify(registrationSettingsPayload("", b))
  );
}

/**
 * Payload dla `admin_event_general_save`.
 *
 * WYSYLAMY WYLACZNIE POLA TEGO EKRANU. Kontrakt RPC mowi „klucz nieobecny =
 * pole nietkniete", wiec tytul, termin i adres publiczny zostaja takie, jakie
 * zapisal ekran „Informacje ogolne" - dwa ekrany pisza do jednej tabeli i zaden
 * nie kasuje pracy drugiego.
 *
 * WSZYSTKO IDZIE NAPISEM, takze `chatham_house`. Kontrakt `saveEventGeneral`
 * przyjmuje slownik napisow, a `p_payload->>'klucz'` w plpgsql i tak oddaje
 * tekst - `::boolean` po stronie RPC czyta „true"/„false".
 */
export function registrationSettingsPayload(
  eventId: string,
  draft: RegistrationSettingsDraft,
): Record<string, string> {
  const cents = registrationPriceCents(draft.ticketPrice);
  return {
    id: eventId,
    registration_mode: draft.registrationMode,
    registration_flow: draft.registrationFlow,
    external_registration_url: draft.externalRegistrationUrl.trim(),
    visibility: draft.visibility,
    capacity: draft.capacity.trim(),
    min_tier_rank: draft.minTierRank.trim(),
    early_rsvp_rank: draft.earlyRsvpRank.trim(),
    rsvp_opens_at: draft.rsvpOpensAt.trim(),
    // Pusty napis = `NULL` po stronie RPC, czyli „bezplatne". Kwota nieczytelna
    // nie ma tu wystapic - `validateRegistrationSettingsDraft` odcina zapis
    // wczesniej - ale gdyby wystapila, pusty napis jest bezpieczniejszy niz
    // „NaN" wysłane do `::integer`.
    ticket_price_cents: cents === null || Number.isNaN(cents) ? "" : String(cents),
    // `TICKET_CURRENCIES` sa juz wielkimi literami; `toUpperCase` jest tu
    // gwarancja kontraktu, a nie poprawka - CHECK bazy porownuje do „PLN"/„EUR".
    ticket_currency: draft.ticketCurrency.trim().toUpperCase(),
    chatham_house: draft.chathamHouse ? "true" : "false",
    join_url: draft.joinUrl.trim(),
    recording_url: draft.recordingUrl.trim(),
  };
}
