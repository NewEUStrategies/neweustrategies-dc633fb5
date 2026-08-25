// Powierzchnia zapisow publicznej strony wydarzenia - REGULA, nie uklad.
//
// ── PO CO TEN MODUL ISTNIEJE ────────────────────────────────────────────────
// Migracja `20260823136000_event_builder_review_fixes.sql` zamknela w
// `rsvp_event()` bramke trybu zapisow: status `going` przechodzi WYLACZNIE przy
// `registration_mode = 'rsvp'` i `registration_flow = 'instant'`. Bramka jest
// poprawna - bez niej wydarzenie z zapisami wylaczonymi przyjmowalo zapisy,
// a wydarzenie wymagajace akceptacji potwierdzalo uczestnika natychmiast.
//
// Front tej bramki nie znal. `events.$slug.tsx` rysowal przycisk zapisu
// BEZWARUNKOWO, a TRZY z szesciu zasianych rodzajow wydarzen maja
// `default_registration_mode = 'form'` (okragly stol, stacjonarne, hybrydowe -
// zasiew w `20260823120000`, a `admin_event_create` przepisuje tryb rodzaju na
// wydarzenie). Redaktor tworzyl w panelu Okragly stol, uczestnik dostawal
// przycisk, ktory ZAWSZE konczyl sie odmowa - i to odmowa wpadajaca w generyczny
// komunikat, bo trasa mapowala tylko trzy stare powody odmowy.
//
// ── DLACZEGO UNIA WARIANTOW, A NIE ZBIOR FLAG ──────────────────────────────
// Wariantow jest dwadziescia. Zbior niezaleznych booli (`canRegister`,
// `isSoldOut`, `isTierLocked`, `showWaitlist`, ...) pozwala WYRENDEROWAC STAN
// SPRZECZNY: przycisk zapisu obok zdania "zapisy sa zamkniete", albo przycisk
// listy rezerwowej na wydarzeniu bez zapisow. Zamknieta unia czyni to
// niereprezentowalnym: kontrolka jest CZESCIA wariantu, a nie osobna flaga,
// wiec wariant bez kontrolki nie ma jej gdzie miec. Kompilator domyka
// kompletnosc obslugi (`switch` na `kind` bez `default`), a nie autor trasy.
//
// ── SKAD BIERZE SIE WEJSCIE ────────────────────────────────────────────────
// Z JEDNEGO wywolania `event_page_header(p_slug)` (migracja `20260823170000`).
// Nie z tabeli `events`: migracja `20260803191905` odebrala anon i authenticated
// SELECT na `public.events` i nadala go z JAWNA ALLOWLISTA 29 kolumn, w ktorej
// NIE MA ani `registration_mode`, ani `registration_flow`, ani
// `external_registration_url`. Zapytanie tabelaryczne o te kolumny konczy sie
// odmowa uprawnien - decyzja o przycisku nie da sie policzyc bez tego RPC.
//
// `registration_state` jest liczone w bazie i ma OSIEM wartosci (slownik
// wspolny z `closed_reason` z `event_registration_form()` plus wlasne
// `event_ended`): `event_cancelled`, `event_ended`, `registration_disabled`,
// `registration_external`, `registration_not_open`, `membership_required`,
// `sold_out`, `open`. Wartosc nieznana temu modulowi konczy sie wariantem
// `closedUnknown` - zamknietym, bo klient, ktory nie rozumie stanu, nie ma prawa
// zapraszac do zapisu.
//
// UWAGA NA `registration_state`: NIE WIE o trybie `form` ani o przeplywie
// `approval`. Dla wydarzenia z formularzem baza raportuje `open`, bo z jej
// punktu widzenia zapisy SA otwarte - tylko innym wejsciem
// (`event_register()`), a nie `rsvp_event()`. Dlatego te dwa przypadki
// rozstrzyga ten modul, PO stanie z bazy i przed bramkami osobistymi.
//
// GRANICA WARSTW: zero Reacta, zero i18next, zero klienta Supabase. Wychodza
// stad KLUCZE i18n, nigdy gotowy tekst - napisy sklada trasa, a molekula
// dostaje je juz zlozone. Wzorzec: `lib/events/timezone.ts`,
// `lib/events/adminEventTypeCatalog.ts`.
import { isEventRegistrationFlow, isEventRegistrationMode } from "@/lib/events/eventTypes";

// ---------------------------------------------------------------------------
// Slownik stanu zapisow z bazy
// ---------------------------------------------------------------------------

/**
 * Osiem wartosci `event_page_header().registration_state`. Zawezenie zyje po
 * stronie kodu, bo kolumna jest w bazie wyliczana jako `text` - generator
 * Supabase oddaje ja jako `string`, wiec `Record<Stan, ...>` nie mialby nad czym
 * domykac kompletnosci. To ten sam zabieg co `EVENT_REGISTRATION_MODES`.
 */
export const EVENT_REGISTRATION_STATES = [
  "open",
  "event_cancelled",
  "event_ended",
  "registration_disabled",
  "registration_external",
  "registration_not_open",
  "membership_required",
  "sold_out",
] as const;

export type EventRegistrationState = (typeof EVENT_REGISTRATION_STATES)[number];

export function isEventRegistrationState(value: string): value is EventRegistrationState {
  return (EVENT_REGISTRATION_STATES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Wejscie reguly
// ---------------------------------------------------------------------------

/**
 * Migawka naglowka, na ktorej liczy sie decyzja. Wszystkie pola pochodza
 * z JEDNEGO wiersza `event_page_header()` - jedno wywolanie to jedna chwila
 * w czasie. Dwa pola sa doklejane przez trase i to jest udokumentowane
 * odstepstwo:
 *
 *   * `isSignedIn` - naglowek personalizuje odpowiedz, ale nie oddaje wprost
 *     "czy wolajacy jest zalogowany" (odda `my_*` jako NULL zarowno dla
 *     anonima, jak i dla zalogowanego bez zapisu - to dwa rozne komunikaty).
 *   * `myWaitlistPosition` - patrz komentarz przy polu.
 */
export interface RegistrationSurfaceInput {
  /** `events.registration_mode`: rsvp / form / external / none. */
  readonly registrationMode: string;
  /** `events.registration_flow`: instant / approval. */
  readonly registrationFlow: string;
  /** Stan policzony w bazie - patrz `EVENT_REGISTRATION_STATES`. */
  readonly registrationState: string;
  /** Adres obcego narzedzia rejestracji; wymagany przy trybie `external`. */
  readonly externalRegistrationUrl: string | null;
  /** Wolne miejsca; NULL znaczy BEZ LIMITU, nie zero. */
  readonly seatsLeft: number | null;
  /** `event_registrations.status` wolajacego (sciezka etapu 4) albo NULL. */
  readonly myRegistrationStatus: string | null;
  /** `event_rsvps.status` wolajacego (sciezka legacy) albo NULL. */
  readonly myRsvpStatus: string | null;
  /**
   * Pozycja w kolejce rezerwowej. DWA ZRODLA, bo dwie sciezki zapisu sa zywe:
   * `event_page_header().my_waitlist_position` liczy kolejke etapu 4, a legacy
   * kolejke `event_rsvps` liczy `get_event_waitlist_position()`. Trasa podaje
   * te, ktora odpowiada zywej sciezce; NULL znaczy "nie wiemy", a nie "zero".
   */
  readonly myWaitlistPosition: number | null;
  /** `tier_locked`: prog warstwy czlonkostwa nie jest spelniony. */
  readonly tierLocked: boolean;
  /** `chatham_house_locked`: wydarzenie w regule CH bez uprawnienia warstwy. */
  readonly chathamHouseLocked: boolean;
  /** `has_ended`: `COALESCE(ends_at, starts_at) < now()` policzone w bazie. */
  readonly hasEnded: boolean;
  /** Czy wolajacy ma konto - patrz komentarz przy interfejsie. */
  readonly isSignedIn: boolean;
}

// ---------------------------------------------------------------------------
// Wyjscie reguly: zamknieta unia wariantow
// ---------------------------------------------------------------------------

/**
 * Kontrolka wariantu. `action` mowi, KTORA sciezka zapisu kryje sie za
 * klikniciem, bo to nie jest kosmetyka:
 *
 *   * `rsvp` / `waitlist` / `cancel` -> RPC `rsvp_event()` (sciezka legacy),
 *   * `external` -> adres organizatora, NIE nasze RPC,
 *   * `membership` -> trasa cennika, zadnego zapisu.
 *
 * `enabled = false` istnieje dla jednego przypadku: kontrolka, ktora ma sens
 * wizualny, ale jest w tej chwili w locie (trasa dokleja `pending` mutacji).
 * Regula sama nigdy nie oddaje wylaczonej kontrolki - wylaczona kontrolka jest
 * gorsza niz jej brak, bo nie mowi, czego brakuje.
 */
export type RegistrationControl =
  | { readonly action: "rsvp"; readonly labelKey: string; readonly enabled: boolean }
  | { readonly action: "waitlist"; readonly labelKey: string; readonly enabled: boolean }
  | { readonly action: "cancel"; readonly labelKey: string; readonly enabled: boolean }
  | {
      readonly action: "external";
      readonly labelKey: string;
      readonly enabled: boolean;
      readonly url: string;
    }
  | { readonly action: "membership"; readonly labelKey: string; readonly enabled: boolean }
  // Zgloszenie formularzem (`event_register()`) stoi na WLASNEJ trasie, a nie
  // pod tym samym przyciskiem co `rsvp_event()`: to inne wejscie do bazy, inny
  // zestaw danych i inna decyzja. Osobna akcja pilnuje, zeby kontrolka
  // formularza nie mogla przez pomylke wolac RPC szybkiego zapisu.
  | { readonly action: "registrationForm"; readonly labelKey: string; readonly enabled: boolean };

/**
 * Jeden wariant = jedno zdanie + co najwyzej jedna kontrolka. Warianty bez
 * kontrolki maja `control: null` NA POZIOMIE TYPU, wiec nie da sie ich
 * wyrenderowac z przyciskiem.
 *
 * `messageKey` wskazuje klucz i18n zdania. Klucze z parametrem sa oznaczone:
 *   * `registrationNotOpen` -> `{{date}}` (kiedy zapisy ruszaja),
 *   * warianty kolejki -> osobne `waitlistPosition` (patrz `waitlistPositionOf`).
 */
export type RegistrationSurface =
  // --- fakty o wydarzeniu: nic ich nie przebija -----------------------------
  | { readonly kind: "eventCancelled"; readonly messageKey: string; readonly control: null }
  | { readonly kind: "eventEnded"; readonly messageKey: string; readonly control: null }
  // --- fakty o WOLAJACYM: silniejsze od kazdej bramki ----------------------
  | {
      readonly kind: "registeredRsvp";
      readonly messageKey: string;
      readonly control: Extract<RegistrationControl, { action: "cancel" }>;
    }
  | {
      readonly kind: "waitlistedRsvp";
      readonly messageKey: string;
      readonly control: Extract<RegistrationControl, { action: "cancel" }>;
      readonly waitlistPosition: number | null;
    }
  | { readonly kind: "registeredApplication"; readonly messageKey: string; readonly control: null }
  | {
      readonly kind: "waitlistedApplication";
      readonly messageKey: string;
      readonly control: null;
      readonly waitlistPosition: number | null;
    }
  | { readonly kind: "pendingApproval"; readonly messageKey: string; readonly control: null }
  | { readonly kind: "applicationRejected"; readonly messageKey: string; readonly control: null }
  // --- tryb zapisow: bramki, ktorych zalogowanie NIE zdejmuje --------------
  | { readonly kind: "registrationDisabled"; readonly messageKey: string; readonly control: null }
  | {
      readonly kind: "registrationExternal";
      readonly messageKey: string;
      readonly control: Extract<RegistrationControl, { action: "external" }>;
    }
  | {
      readonly kind: "registrationExternalMisconfigured";
      readonly messageKey: string;
      readonly control: null;
    }
  | {
      readonly kind: "registrationForm";
      readonly messageKey: string;
      readonly control: Extract<RegistrationControl, { action: "registrationForm" }>;
    }
  | {
      readonly kind: "registrationApproval";
      readonly messageKey: string;
      readonly control: Extract<RegistrationControl, { action: "registrationForm" }>;
    }
  // --- bramki osobiste ----------------------------------------------------
  | { readonly kind: "signInRequired"; readonly messageKey: string; readonly control: null }
  | { readonly kind: "registrationNotOpen"; readonly messageKey: string; readonly control: null }
  | {
      readonly kind: "membershipRequired";
      readonly messageKey: string;
      readonly control: Extract<RegistrationControl, { action: "membership" }>;
    }
  | {
      readonly kind: "chathamHouseRequired";
      readonly messageKey: string;
      readonly control: Extract<RegistrationControl, { action: "membership" }>;
    }
  // --- zapisy otwarte -----------------------------------------------------
  | {
      readonly kind: "soldOut";
      readonly messageKey: string;
      readonly control: Extract<RegistrationControl, { action: "waitlist" }>;
    }
  | {
      readonly kind: "open";
      readonly messageKey: string;
      readonly control: Extract<RegistrationControl, { action: "rsvp" }>;
    }
  // --- stan, ktorego ten klient nie zna -----------------------------------
  | { readonly kind: "closedUnknown"; readonly messageKey: string; readonly control: null };

export type RegistrationSurfaceKind = RegistrationSurface["kind"];

// ---------------------------------------------------------------------------
// Klucze i18n - jedno miejsce, zeby zmiana slownika byla jedna zmiana
// ---------------------------------------------------------------------------

const HINT = "eventFront.registrationStateHint";
const ACTION = "eventFront.registrationAction";
const MINE = "eventFront.myRegistration";
const SURFACE = "eventFront.registrationSurface";

// ---------------------------------------------------------------------------
// Regula
// ---------------------------------------------------------------------------

/**
 * Jedna decyzja o tym, co widzi uczestnik w bloku zapisow.
 *
 * ── PIERWSZENSTWO I JEGO UZASADNIENIE ───────────────────────────────────────
 *
 * Drabinka ma piec pieter i kazde piętro odpowiada na inne pytanie. Zla
 * kolejnosc daje komunikat PRAWDZIWY, ale nie ten, ktory pomaga - a przy
 * kontrolce daje sciane.
 *
 * PIETRO 1. FAKT O WYDARZENIU (odwolane, zakonczone). Nic tego nie przebija.
 *
 *   ROZSTRZYGNIECIE: "wydarzenie ZAKONCZONE" wygrywa nad "jestem ZAPISANY".
 *   Powody, w kolejnosci wagi:
 *     (a) kontrolka. Wariant zapisanego niesie przycisk "Wycofaj zapis".
 *         Wycofanie zapisu z wydarzenia, ktore sie odbylo, nie zmienia niczego
 *         poza wierszem w bazie - przycisk jest kontrolka bez skutku, czyli
 *         sciana z innej strony.
 *     (b) zgodnosc z baza. `event_page_header()` liczy `registration_state`
 *         drabinka, w ktorej `event_ended` stoi na drugim miejscu, PRZED
 *         wszystkim innym. Klient stawiajacy wlasny status wyzej mowilby
 *         cos innego niz stan, ktory dostal w tej samej odpowiedzi.
 *     (c) tresc. Po wydarzeniu uczestnika interesuje nagranie, a nie zapis;
 *         sekcja nagrania jest osobna i ta decyzji nie dotyczy.
 *   Informacja "byles zapisany" nie ginie bezpowrotnie: `attended` / `no_show`
 *   sa w slowniku `eventFront.myRegistration.*` i naleza do podsumowania
 *   uczestnictwa, nie do bloku zapisow.
 *
 * PIETRO 2. FAKT O WOLAJACYM (mam zapis / czekam na decyzje / odrzucono mnie).
 *   Silniejszy od KAZDEJ bramki nizej. Bramka pokazana osobie, ktora juz jest
 *   w srodku, jest falszywa w skutku: zdanie "wymaga czlonkostwa" pokazane
 *   zapisanemu uczestnikowi mowi mu, ze nie wejdzie, choc wejdzie.
 *   Ta sama regula chroni przed drugim absurdem: osobie JUZ W KOLEJCE
 *   rezerwowej nie proponujemy "dopisz sie na liste rezerwowa".
 *
 *   ROZDZIELENIE DWOCH SCIEZEK ZAPISU jest tu istotne i nie jest kosmetyka.
 *   `event_rsvps` (legacy, pisane przez `rsvp_event()`) i `event_registrations`
 *   (etap 4, pisane przez `event_register()`) zyja obie. Wycofac zapis przez
 *   `rsvp_event('cancelled')` da sie WYLACZNIE na sciezce legacy - ta funkcja
 *   nie tyka wierszy etapu 4. Dlatego warianty `*Application` NIE MAJA
 *   kontrolki: ekranu wycofania zgloszenia (`event_registration_cancel`) nie ma
 *   jeszcze na tej stronie, a przycisk wolajacy `rsvp_event()` byl by cichym
 *   brakiem skutku - najgorszym rodzajem sciany, bo bez komunikatu.
 *
 *   `interested` NIE JEST tu terminalne i to jest decyzja: sygnal
 *   zainteresowania nie jest zapisem, wiec nie zabiera uczestnikowi przycisku
 *   zapisu. Wariant leci dalej drabinka.
 *   `draft` (zgloszenie nieukonczone) tez leci dalej - porzucona wersja robocza
 *   nie jest zapisem i nie moze zablokowac ekranu.
 *
 * PIETRO 3. TRYB I PRZEPLYW ZAPISOW. Bramki, ktorych ZALOGOWANIE NIE ZDEJMUJE.
 *   Stoja PRZED bramka zalogowania celowo: anonimowi uczestnicy wydarzenia bez
 *   zapisow maja usłyszec "to wydarzenie nie przyjmuje zapisow", a nie
 *   "zaloguj sie" - zalogowanie nic tam nie zmieni, a nieprawdziwa obietnica
 *   kosztuje ich rejestracje konta.
 *
 * PIETRO 4. BRAMKI OSOBISTE (zalogowanie, okno czasowe, warstwa, Chatham
 *   House).
 *
 *   ROZSTRZYGNIECIE: "prog warstwy nie spelniony" wygrywa nad "brak miejsc".
 *   Powody:
 *     (a) wyjscie. Zdanie o warstwie ma wyjscie (cennik). Zdanie o braku
 *         miejsc kieruje na liste rezerwowa, a `rsvp_event()` odmowi
 *         nie-czlonkowi zapisu na kolejke tak samo jak zapisu na wydarzenie
 *         (`events: membership required` sprawdza sie PRZED limitem miejsc) -
 *         czyli dokladnie sciana.
 *     (b) zgodnosc z baza. W drabince `event_page_header()`
 *         `membership_required` stoi PRZED `sold_out`, wiec stan, ktory
 *         dostajemy, juz to rozstrzygnal. Ten modul tego nie odwraca.
 *   Kolejnosc warstwa -> Chatham House idzie za `rsvp_event()`, ktore sprawdza
 *   prog warstwy przed uprawnieniem `chatham_house_events`: nazywamy PIERWSZA
 *   bramke, na ktora uczestnik by wpadl, a nie dowolna z brakujacych.
 *
 *   ODSTEPSTWO, ktore trzeba znac: `rsvp_event()` sprawdza czlonkostwo PRZED
 *   oknem `rsvp_opens_at`, a `event_page_header()` odwrotnie. Idziemy za
 *   naglowkiem, bo to on oddaje `registration_state` - a rozjazd jest
 *   nieszkodliwy, bo wariant `registrationNotOpen` nie ma kontrolki, wiec ta
 *   odmowa i tak jest z interfejsu nieosiagalna.
 *
 * PIETRO 5. ZAPISY OTWARTE (kolejka albo zapis).
 */
export function resolveRegistrationSurface(input: RegistrationSurfaceInput): RegistrationSurface {
  const state = isEventRegistrationState(input.registrationState) ? input.registrationState : null;
  const mode = isEventRegistrationMode(input.registrationMode) ? input.registrationMode : null;
  const flow = isEventRegistrationFlow(input.registrationFlow) ? input.registrationFlow : null;

  // ── PIETRO 1: fakt o wydarzeniu ───────────────────────────────────────────
  if (state === "event_cancelled") {
    return { kind: "eventCancelled", messageKey: `${HINT}.event_cancelled`, control: null };
  }
  // `hasEnded` jest brane obok stanu, a nie zamiast: stan liczy sie w bazie
  // z tego samego pola, ale kolumna `has_ended` jest jawna i tansza w tescie.
  if (state === "event_ended" || input.hasEnded) {
    return { kind: "eventEnded", messageKey: `${HINT}.event_ended`, control: null };
  }

  // ── PIETRO 2: fakt o wolajacym ────────────────────────────────────────────
  const application = resolveApplication(input);
  if (application !== null) return application;

  const legacy = resolveLegacyRsvp(input);
  if (legacy !== null) return legacy;

  // ── PIETRO 3: tryb i przeplyw ─────────────────────────────────────────────
  if (mode === "none" || state === "registration_disabled") {
    return {
      kind: "registrationDisabled",
      messageKey: `${HINT}.registration_disabled`,
      control: null,
    };
  }
  if (mode === "external" || state === "registration_external") {
    const url = normalizedUrl(input.externalRegistrationUrl);
    if (url === null) {
      // CHECK bazy wymaga adresu przy trybie `external`, ale stan wydarzenia
      // moze byc starszy niz ten CHECK (albo adres zostal wyczyszczony innym
      // wejsciem). Bez adresu nie ma gdzie kliknac - i to jest blad DANYCH,
      // a nie stan zapisow, wiec ma wlasne zdanie i zadnej kontrolki.
      return {
        kind: "registrationExternalMisconfigured",
        messageKey: `${SURFACE}.externalUrlMissing`,
        control: null,
      };
    }
    return {
      kind: "registrationExternal",
      messageKey: `${HINT}.registration_external`,
      control: { action: "external", labelKey: `${ACTION}.registerExternal`, enabled: true, url },
    };
  }
  if (mode === "form") {
    // `registration_state` mowi tu `open`, bo z punktu widzenia bazy zapisy SA
    // otwarte - tylko innym wejsciem (`event_register()`). Kontrolka prowadzi
    // WLASNIE tam: na trase formularza zgloszenia, ktora wola `event_register()`
    // z pelnym zestawem danych (bilet, pytania organizatora, zgody).
    return {
      kind: "registrationForm",
      messageKey: `${SURFACE}.formRequired`,
      control: { action: "registrationForm", labelKey: `${ACTION}.registerForm`, enabled: true },
    };
  }
  if (flow === "approval") {
    // Przeplyw akceptacji to takze zgloszenie, a nie szybki zapis: decyzje
    // podejmuje organizator, wiec uczestnik wypelnia ten sam formularz.
    return {
      kind: "registrationApproval",
      messageKey: `${SURFACE}.approvalRequired`,
      control: { action: "registrationForm", labelKey: `${ACTION}.registerForm`, enabled: true },
    };
  }

  // ── PIETRO 4: bramki osobiste ─────────────────────────────────────────────
  if (!input.isSignedIn) {
    return { kind: "signInRequired", messageKey: `${SURFACE}.signInHint`, control: null };
  }
  if (state === "registration_not_open") {
    return {
      kind: "registrationNotOpen",
      messageKey: `${HINT}.registration_not_open`,
      control: null,
    };
  }
  if (state === "membership_required" || input.tierLocked) {
    return {
      kind: "membershipRequired",
      messageKey: `${HINT}.membership_required`,
      control: { action: "membership", labelKey: `${ACTION}.seeMembership`, enabled: true },
    };
  }
  if (input.chathamHouseLocked) {
    return {
      kind: "chathamHouseRequired",
      messageKey: "eventFront.header.chathamHouseLocked",
      control: { action: "membership", labelKey: `${ACTION}.seeMembership`, enabled: true },
    };
  }

  // ── PIETRO 5: zapisy otwarte ──────────────────────────────────────────────
  if (state === "sold_out" || (input.seatsLeft !== null && input.seatsLeft <= 0)) {
    // Kolejka rezerwowa NIE jest bledem i nie ma prawa nim wygladac:
    // `rsvp_event()` przyjmuje `going` przy komplecie i SAM degraduje wynik do
    // `waitlist` pod blokada wiersza wydarzenia. Kontrolka jest wiec czynna.
    return {
      kind: "soldOut",
      messageKey: `${HINT}.sold_out`,
      control: { action: "waitlist", labelKey: `${ACTION}.joinWaitlist`, enabled: true },
    };
  }
  if (state === "open") {
    return {
      kind: "open",
      messageKey: `${HINT}.open`,
      control: { action: "rsvp", labelKey: `${ACTION}.register`, enabled: true },
    };
  }

  // Stan, ktorego ten klient nie zna (nowa wartosc dolozona w bazie). Zamkniete,
  // bo klient bez zrozumienia stanu nie ma prawa zapraszac do zapisu - a przy
  // otwartym domysle zapraszalby dokladnie w te sciane, ktora ten modul zamyka.
  return { kind: "closedUnknown", messageKey: `${SURFACE}.closedUnknown`, control: null };
}

/** Sciezka etapu 4 (`event_registrations`). Brak wiersza -> `null`. */
function resolveApplication(input: RegistrationSurfaceInput): RegistrationSurface | null {
  switch (input.myRegistrationStatus) {
    case "pending":
      return { kind: "pendingApproval", messageKey: `${MINE}.pending`, control: null };
    case "rejected":
      // `event_page_header()` odsiewa dzisiaj `rejected` i `cancelled`
      // (`status NOT IN (...)`), wiec ten wariant jest z tej sciezki
      // NIEOSIAGALNY. Zostaje mimo to: slownik statusow tabeli go dopuszcza,
      // a wariant bez obslugi to przyszly `closedUnknown` w miejscu, gdzie
      // uczestnik ma prawo do konkretnej odpowiedzi.
      return { kind: "applicationRejected", messageKey: `${MINE}.rejected`, control: null };
    case "approved":
      return { kind: "registeredApplication", messageKey: `${MINE}.approved`, control: null };
    case "waitlist":
      return {
        kind: "waitlistedApplication",
        messageKey: `${MINE}.waitlist`,
        control: null,
        waitlistPosition: input.myWaitlistPosition,
      };
    default:
      // `draft`, `attended`, `no_show`, `cancelled` i brak wiersza - patrz
      // uzasadnienie pietra 2.
      return null;
  }
}

/** Sciezka legacy (`event_rsvps`), jedyna wycofywalna z tej strony. */
function resolveLegacyRsvp(input: RegistrationSurfaceInput): RegistrationSurface | null {
  if (input.myRsvpStatus === "going") {
    return {
      kind: "registeredRsvp",
      messageKey: "eventFront.myRsvp.going",
      control: { action: "cancel", labelKey: `${ACTION}.cancel`, enabled: true },
    };
  }
  if (input.myRsvpStatus === "waitlist") {
    return {
      kind: "waitlistedRsvp",
      messageKey: `${MINE}.waitlist`,
      control: { action: "cancel", labelKey: `${ACTION}.cancel`, enabled: true },
      waitlistPosition: input.myWaitlistPosition,
    };
  }
  // `interested` i `cancelled` NIE sa terminalne - patrz uzasadnienie pietra 2.
  return null;
}

/** Puste i bialoznakowe adresy to brak adresu, nie adres. */
function normalizedUrl(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

// ---------------------------------------------------------------------------
// Pochodne pytania trasy - zeby warunki nie odrastaly w JSX
// ---------------------------------------------------------------------------

/**
 * Pozycja w kolejce, jesli wariant ja niesie. Dwa warianty maja to pole i tylko
 * one; funkcja istnieje, zeby trasa nie sprawdzala tego operatorem `in`.
 */
export function waitlistPositionOf(surface: RegistrationSurface): number | null {
  return surface.kind === "waitlistedRsvp" || surface.kind === "waitlistedApplication"
    ? surface.waitlistPosition
    : null;
}

/**
 * Czy decyzja dotyczy SCIEZKI LEGACY (`rsvp_event`), czyli tej, ktora na
 * wydarzeniu PLATNYM zastepuje przycisk zapisu zakupem wejsciowki.
 * Trasa potrzebuje tego jednego pytania - bez niego wracalaby do skladania
 * wlasnych warunkow z kolumn, co jest defektem, ktory ten modul zamyka.
 */
export function isLegacyRsvpDecision(surface: RegistrationSurface): boolean {
  switch (surface.kind) {
    case "open":
    case "soldOut":
    case "registeredRsvp":
    case "waitlistedRsvp":
      return true;
    default:
      return false;
  }
}

/**
 * Czy sygnal `interested` ma szanse przejsc bramki `rsvp_event()`.
 *
 * Bramka trybu zapisow z `20260823136000` obejmuje WYLACZNIE `going`, wiec
 * zainteresowanie wolno wyrazic takze na wydarzeniu z formularzem, z
 * rejestracja zewnetrzna i bez zapisow. Blokuja je natomiast bramki, ktore
 * dotycza kazdego statusu poza `cancelled`: prog warstwy, Chatham House i okno
 * `rsvp_opens_at`. Wydarzenie odwolane i zakonczone przepuscilby serwer, ale
 * przycisk "zainteresowany" na wydarzeniu, ktore sie odbylo, nie ma sensu -
 * i to jest jedyne miejsce, gdzie ta funkcja jest ostrzejsza od bazy.
 */
export function canSignalInterest(surface: RegistrationSurface): boolean {
  switch (surface.kind) {
    case "eventCancelled":
    case "eventEnded":
    case "signInRequired":
    case "registrationNotOpen":
    case "membershipRequired":
    case "chathamHouseRequired":
    case "applicationRejected":
    case "closedUnknown":
      return false;
    default:
      return true;
  }
}

// ---------------------------------------------------------------------------
// Odmowy `rsvp_event()` -> klucze i18n (DRUGA LINIA OBRONY)
// ---------------------------------------------------------------------------

/**
 * Surowy komunikat wyjatku `rsvp_event()` na klucz i18n.
 *
 * Po przebudowie ekranu cztery odmowy trybu zapisow SA Z INTERFEJSU
 * NIEOSIAGALNE - zaden wariant z kontrolka `rsvp` nie powstaje przy trybie
 * `none`, `external`, `form` ani przy przeplywie `approval`. Mapowanie zostaje
 * jako druga linia obrony i ma konkretny scenariusz: uczestnik z OTWARTA KARTA
 * w chwili, gdy organizator zmienia tryb w panelu. Jego przycisk pochodzi
 * z migawki, ktora przestala byc prawda - i ma dostac zdanie prawdziwe, a nie
 * generyczne "coś nie zadziałało".
 *
 * KOLEJNOSC DOPASOWAN JEST ISTOTNA. `events: chatham house membership required`
 * ZAWIERA podnapis `membership required`, wiec dopasowanie po czlonkostwie
 * przechwytywalo odmowe Chatham House i pokazywalo zdanie o warstwie zamiast
 * o regule spotkania. Dlatego wzorce bardziej szczegolowe stoja wyzej.
 */
const RSVP_REFUSAL_KEYS: readonly (readonly [needle: string, key: string])[] = [
  // Bardziej szczegolowe najpierw - patrz komentarz wyzej.
  ["chatham house membership required", "eventFront.header.chathamHouseLocked"],
  ["registration disabled", `${HINT}.registration_disabled`],
  ["registration external", `${HINT}.registration_external`],
  ["registration form required", `${SURFACE}.formRequired`],
  ["registration approval required", `${SURFACE}.approvalRequired`],
  ["membership required", `${HINT}.membership_required`],
  ["rsvp not open", "community.events.rsvpNotOpenToast"],
  ["ticket required", `${SURFACE}.ticketRequired`],
  ["full", "community.events.rsvpFull"],
  ["not found", "eventFront.errors.notFound"],
  ["authentication required", "eventFront.errors.authRequired"],
];

/** Klucz i18n odmowy; nierozpoznany komunikat -> jeden ogolny klucz. */
export function rsvpRefusalMessageKey(message: string): string {
  const haystack = message.toLowerCase();
  for (const [needle, key] of RSVP_REFUSAL_KEYS) {
    if (haystack.includes(needle)) return key;
  }
  return "community.events.rsvpError";
}
