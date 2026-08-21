// Kompozytor nowego tematu (`/club/$clubSlug/new`) - REGUŁY jako czyste funkcje.
//
// CO BYŁO W JSX-IE. Trasa niosła 562 linie, w których obok układu formularza
// siedziało trzynaście reguł produktu: próg długości tytułu i treści, wybór
// domyślnego działu, lista rodzajów wątku dozwolonych dla wołającego,
// dziedziczenie trybu atrybucji z DZIAŁU (nie z klubu), zbiór dozwolonych
// ZAOSTRZEŃ tej zasady, prawo do anonimowego głosu, widoczność pięciu pól
// zależna od rodzaju i uprawnień, złożenie payloadu `club_create_thread`
// i rozstrzygnięcie, gdzie wylądować po publikacji. Każda z nich jest REGUŁĄ,
// a nie układem: każda ma odpowiednik w walidacji RPC, a jej pomyłka kończy się
// odmową serwera PO napisaniu całego tekstu - czyli najdroższym możliwym
// momentem. Dopóki mieszkały w ciele komponentu i w wyrażeniach inline, jedynym
// sposobem sprawdzenia „co dokładnie poleci do RPC” było zamontowanie
// formularza z atrapą Radiksa, pola wzmianek i pickera kotwicy.
//
// GRANICA WARSTW. To warstwa `lib`: zero Reacta, zero i18n, zero zegara i zero
// dostępu do bazy. Wejściem są wiersze `club_groups_list`/`club_view` oraz stan
// pól, wyjściem gołe struktury i KLUCZE i18n. Autoryzacja nie jest tu liczona
// ani powtarzana - `can_post_thread`, `can_moderate` i `attribution_mode`
// przychodzą z SECURITY DEFINER i mają pokrycie pgTAP. Te funkcje decydują
// wyłącznie o tym, czego kompozytor NIE OFERUJE, bo RPC i tak by tego nie
// przyjął: wybór, którego nie da się zrealizować, jest błędem interfejsu,
// a nie ostrzeżeniem serwera.
import { normalizeClubThreadIcon } from "./threadIcons";
import {
  CLUB_ATTRIBUTION_MODES,
  CLUB_THREAD_KINDS,
  isClubAttributionMode,
  type ClubAnchorType,
  type ClubAttributionMode,
  type ClubThreadKind,
} from "./types";

// ---------------------------------------------------------------------------
// Progi pól
// ---------------------------------------------------------------------------

/** Tytuł krótszy nie jest tytułem, tylko zaczątkiem zdania. */
export const CLUB_THREAD_TITLE_MIN = 5;
/** Kontrakt z CHECK-iem w bazie oraz z atrybutem `maxLength` pola. */
export const CLUB_THREAD_TITLE_MAX = 200;
export const CLUB_THREAD_BODY_MIN = 10;
export const CLUB_THREAD_BODY_MAX = 20000;

/**
 * Czy tytuł mieści się w progach. Liczy się długość PO PRZYCIĘCIU, bo dokładnie
 * przyciętą wartość wysyła payload - bez tego pięć spacji przechodziło walidację
 * po stronie klienta i wracało odmową z bazy.
 */
export function threadTitleValid(title: string): boolean {
  const length = title.trim().length;
  return length >= CLUB_THREAD_TITLE_MIN && length <= CLUB_THREAD_TITLE_MAX;
}

/** Jak `threadTitleValid`, dla treści. */
export function threadBodyValid(body: string): boolean {
  const length = body.trim().length;
  return length >= CLUB_THREAD_BODY_MIN && length <= CLUB_THREAD_BODY_MAX;
}

/**
 * Czy formularz wolno wysłać. TA SAMA funkcja stoi za stanem przycisku i za
 * strażnikiem w handlerze wysyłki - rozdzielenie tych dwóch warunków znaczyło
 * kiedyś, że klawiatura („Enter” na aktywnym przycisku) obchodziła walidację,
 * której mysz nie mogła obejść.
 *
 * Brak wybranego działu jest tu równorzędny z pustym tytułem: `club_create_thread`
 * przyjmuje `p_group_id`, a nie klub, więc wysyłka bez działu nie ma adresata.
 */
export function newThreadFormReady(input: {
  readonly title: string;
  readonly body: string;
  readonly groupId: string;
}): boolean {
  return input.groupId !== "" && threadTitleValid(input.title) && threadBodyValid(input.body);
}

// ---------------------------------------------------------------------------
// Dział
// ---------------------------------------------------------------------------

/** Minimum, jakiego te reguły potrzebują z wiersza `club_groups_list`. */
export interface NewThreadGroupRow {
  readonly id: string;
  readonly can_post_thread: boolean;
  readonly attribution_mode: string | null;
}

/**
 * Działy, w których wołającemu wolno założyć temat. Droplista karmiona pełną
 * listą działów oferowała wybór, który kończył się odmową RPC - a członek nie
 * ma skąd wiedzieć, że w „Ogłoszeniach” pisze wyłącznie moderator.
 */
export function postableThreadGroups<T extends NewThreadGroupRow>(
  groups: readonly T[],
): readonly T[] {
  return groups.filter((group) => group.can_post_thread);
}

/**
 * Dział, który ma być wybrany, albo `null` = nie ruszaj wyboru.
 *
 * Dwie reguły w jednym miejscu, bo obie odpowiadają na to samo pytanie „czym
 * wypełnić droplistę, zanim użytkownik jej dotknie”:
 *
 *   * brak wyboru degraduje do PIERWSZEGO dozwolonego działu - osoba z dostępem
 *     do jednego działu nie ma czego wybierać, a pusta droplista blokowała jej
 *     przycisk publikacji bez wyjaśnienia;
 *   * dział z ADRESU (`?groupId=`) obowiązuje TYLKO wtedy, gdy wolno w nim
 *     założyć temat - inaczej formularz startowałby z wyborem, którego zapis
 *     i tak odrzuci, a link z kompozytora na hubie stałby się pułapką.
 *
 * Pusta lista dozwolonych działów nie kasuje wyboru: czekamy na odpowiedź RPC,
 * a nie zerujemy pole w trakcie jej wczytywania.
 */
export function resolveThreadGroupId(
  current: string,
  postable: readonly { readonly id: string }[],
): string | null {
  const [first] = postable;
  if (first === undefined) return null;
  if (current !== "" && postable.some((group) => group.id === current)) return null;
  return first.id;
}

// ---------------------------------------------------------------------------
// Rodzaj wątku
// ---------------------------------------------------------------------------

/**
 * Rodzaje, które RPC przepuści. `announcement` wymaga moderacji (V1 §1.3),
 * a lista karmiona pełnym słownikiem oferowała go każdemu - żeby po napisaniu
 * tekstu odpowiedzieć „clubs: announcement requires moderator”.
 */
export function threadKindChoices(canModerate: boolean): readonly ClubThreadKind[] {
  if (canModerate) return CLUB_THREAD_KINDS;
  return CLUB_THREAD_KINDS.filter((kind) => kind !== "announcement");
}

/**
 * Rodzaj po sprawdzeniu uprawnień. Wartość z adresu albo utrata uprawnienia
 * moderacyjnego w trakcie pisania degraduje `announcement` do dyskusji, a nie
 * do błędu - adres jest wejściem użytkownika i nie ma prawa wywrócić
 * kompozytora ani zablokować publikacji.
 */
export function resolveThreadKind(kind: ClubThreadKind, canModerate: boolean): ClubThreadKind {
  if (!canModerate && kind === "announcement") return "discussion";
  return kind;
}

/**
 * Domyślny stan przełącznika „zamknij odpowiedzi”. Ogłoszenie jest komunikatem,
 * nie dyskusją - ale to DOMYŚLNA wartość, nie przymus: moderator, który chce
 * otworzyć dyskusję pod ogłoszeniem, przestawia przełącznik i tak zostaje
 * (o „dotknięciu” pamięta trasa, bo to stan interfejsu, nie reguła).
 */
export function defaultLockReplies(kind: ClubThreadKind): boolean {
  return kind === "announcement";
}

// ---------------------------------------------------------------------------
// Atrybucja: dziedziczenie i dozwolone zaostrzenia
// ---------------------------------------------------------------------------

/**
 * Tryb atrybucji obowiązujący w WYBRANYM dziale.
 *
 * Kolejność źródeł jest sedno: `club_groups_list` zwraca wartość już EFEKTYWNĄ
 * (NULL w kolumnie działu znaczy „weź z klubu”), więc dział jest pierwszym
 * źródłem prawdy, a klub tylko awaryjnym - dla stanu, w którym działy jeszcze
 * się nie wczytały. Czytanie tego wprost z klubu sprawiało, że dział prowadzony
 * w regule Chatham House pokazywał ustawienia klubu: przełącznik anonimowości
 * pojawiał się tam, gdzie RPC go odrzuca, i znikał tam, gdzie jest jedynym
 * sposobem na zabranie głosu.
 *
 * Wartość spoza słownika degraduje do `null` (= „nie wiem, nie pokazuj zasady”),
 * bo napis z bazy sprzed migracji nie ma prawa wywrócić formularza.
 */
export function baseAttributionMode(
  groups: readonly NewThreadGroupRow[],
  groupId: string,
  clubMode: string | null,
): ClubAttributionMode | null {
  const raw = groups.find((group) => group.id === groupId)?.attribution_mode ?? clubMode;
  return isClubAttributionMode(raw) ? raw : null;
}

/**
 * Zaostrzenia zasady, które autor może wybrać dla WŁASNEGO wątku.
 *
 * Nadpisanie na poziomie wątku wolno wyłącznie ZAOSTRZYĆ - poluzowanie byłoby
 * obejściem polityki klubu przez założenie wątku, więc RPC je odrzuca. Zwykły
 * członek dostaje zatem najwyżej „Chatham House”, a w dziale już prowadzonym
 * w tej regule (albo bez rozstrzygniętej zasady) nie dostaje nic i droplista
 * w ogóle się nie pokazuje. Moderator widzi cały słownik, bo jego RPC
 * przepuszcza.
 */
export function attributionOverrideChoices(
  canModerate: boolean,
  base: ClubAttributionMode | null,
): readonly ClubAttributionMode[] {
  if (canModerate) return CLUB_ATTRIBUTION_MODES;
  if (base === null || base === "chatham") return [];
  return ["chatham"];
}

/**
 * Czy wybrane nadpisanie nadal jest dozwolone. Zmiana działu może unieważnić
 * wybór (inna zasada bazowa) - wtedy trasa wraca do dziedziczenia, zamiast
 * wysyłać wartość, której RPC już nie przyjmie. Brak nadpisania jest zawsze
 * dozwolony: „dziedzicz” nie jest wyborem, który da się unieważnić.
 */
export function isAttributionOverrideAllowed(
  override: ClubAttributionMode | null,
  choices: readonly ClubAttributionMode[],
): boolean {
  return override === null || choices.includes(override);
}

/** Zasada, która realnie obowiązuje w wątku: nadpisanie albo dziedziczony dział. */
export function effectiveAttributionMode(
  override: ClubAttributionMode | null,
  base: ClubAttributionMode | null,
): ClubAttributionMode | null {
  return override ?? base;
}

/**
 * Czy autor może zabrać głos anonimowo. WYŁĄCZNIE `anonymous_allowed`:
 * „Chatham House” ukrywa tożsamość uczestników w prezentacji, ale nie jest
 * zgodą na anonimowe autorstwo, a `attributed` jest jej wprost przeciwny.
 */
export function canPostAnonymously(effective: ClubAttributionMode | null): boolean {
  return effective === "anonymous_allowed";
}

/** Wartość-wartownik dropListy nadpisania: „dziedzicz dział”. */
export const NEW_THREAD_ATTRIBUTION_INHERIT = "inherit";

/** Wartość dropListy dla stanu formularza (`null` = dziedzicz). */
export function attributionSelectValue(override: ClubAttributionMode | null): string {
  return override ?? NEW_THREAD_ATTRIBUTION_INHERIT;
}

/**
 * Odczyt wyboru z dropListy. Wszystko, co nie jest trybem ze słownika (czyli
 * wartownik „inherit”, ale też dowolny inny napis), znaczy „dziedzicz” - dzięki
 * temu do stanu nigdy nie trafi napis, którego RPC nie zna.
 */
export function readAttributionSelection(value: string): ClubAttributionMode | null {
  return isClubAttributionMode(value) ? value : null;
}

/** Opis etykiety opcji „dziedzicz”: klucz i opcjonalny klucz nazwy zasady. */
export interface AttributionInheritLabel {
  readonly key: "club.attribution.attributed" | "club.composer.participantAnonymityInherit";
  /** Klucz nazwy dziedziczonej zasady; `null` = etykieta nie ma parametru. */
  readonly modeKey: string | null;
}

/**
 * Etykieta opcji „dziedzicz”. Bez rozstrzygniętej zasady bazowej mówimy wprost
 * „podpisane”, a nie „dziedzicz nieznane”: moderator otwierający kompozytor
 * przed wczytaniem działów zobaczyłby inaczej opcję bez treści.
 */
export function attributionInheritLabel(base: ClubAttributionMode | null): AttributionInheritLabel {
  if (base === null) return { key: "club.attribution.attributed", modeKey: null };
  return {
    key: "club.composer.participantAnonymityInherit",
    modeKey: `club.attribution.${base}`,
  };
}

/** Podpowiedź pod dropListą nadpisania - reguła Chatham House ma własną. */
export function attributionHintKey(
  effective: ClubAttributionMode | null,
): "club.composer.participantAnonymityChatham" | "club.composer.participantAnonymityHint" {
  return effective === "chatham"
    ? "club.composer.participantAnonymityChatham"
    : "club.composer.participantAnonymityHint";
}

// ---------------------------------------------------------------------------
// Widoczność pól
// ---------------------------------------------------------------------------

/** Które pola i noty kompozytora są widoczne dla danego stanu. */
export interface NewThreadFieldVisibility {
  /** Nota z obowiązującą zasadą autorstwa - MUSI być widoczna przed publikacją. */
  readonly attributionNote: boolean;
  /** Droplista zaostrzenia zasady dla uczestników wątku. */
  readonly attributionOverride: boolean;
  /** Ostrzeżenie, że ogłoszenie przypina się z definicji rodzaju (migracja A25). */
  readonly announcementPinnedNote: boolean;
  /** Przełącznik „zamknij odpowiedzi” - uprawnienie moderacyjne. */
  readonly lockReplies: boolean;
  /** Przełącznik „opublikuj anonimowo”. */
  readonly anonymousToggle: boolean;
}

/**
 * Widoczność pięciu elementów kompozytora w JEDNYM deskryptorze.
 *
 * Wszystkie pięć warunków były wyrażeniami inline w JSX-ie, a każdy z nich jest
 * regułą: pole widoczne tam, gdzie RPC go nie przyjmie, produkuje odmowę po
 * napisaniu tekstu; pole ukryte tam, gdzie jest jedynym sposobem na zabranie
 * głosu, cicho odbiera funkcję. Zebrane razem dają się sprawdzić tabelą
 * przypadków, zamiast pięcioma renderami z różnymi atrapami.
 */
export function newThreadFieldVisibility(input: {
  readonly kind: ClubThreadKind;
  readonly canModerate: boolean;
  readonly effectiveAttribution: ClubAttributionMode | null;
  readonly attributionChoiceCount: number;
}): NewThreadFieldVisibility {
  return {
    attributionNote: input.effectiveAttribution !== null,
    attributionOverride: input.attributionChoiceCount > 0,
    announcementPinnedNote: input.kind === "announcement",
    lockReplies: input.canModerate,
    anonymousToggle: canPostAnonymously(input.effectiveAttribution),
  };
}

// ---------------------------------------------------------------------------
// Bramka: kto widzi kompozytor
// ---------------------------------------------------------------------------

/**
 * Czy pokazać formularz. Strażnik, a nie zwykły predykat: zawęża typ, więc
 * dalsza część trasy czyta kartę klubu bez rzutowania.
 */
export function canComposeThread<T extends { readonly can_post_thread: boolean }>(
  club: T | null,
): club is T {
  return club !== null && club.can_post_thread;
}

/**
 * Klucz i18n z powodem odmowy. `reason` z `club_view` jest tu autorytetem
 * (`tier_too_low`, `not_member`, ...), a jego brak - pusty napis albo NULL dla
 * klubu, którego RPC wcale nie zwrócił - degraduje do zdania ogólnego. Bez tej
 * degradacji odmowa renderowała klucz `club.reason.` bez ogona, czyli surowy
 * identyfikator na ekranie.
 */
export function newThreadDenialKey(club: { readonly reason: string | null } | null): string {
  const reason = club?.reason ?? "";
  return reason === "" ? "club.cannotPost" : `club.reason.${reason}`;
}

// ---------------------------------------------------------------------------
// Payload i wynik publikacji
// ---------------------------------------------------------------------------

/** Kotwica wątku w kształcie, jakiego potrzebuje payload. */
export interface NewThreadAnchor {
  readonly anchorType: ClubAnchorType;
  readonly anchorId: string;
}

/** Stan pól kompozytora - wejście dla payloadu. */
export interface NewThreadFormState {
  readonly groupId: string;
  readonly title: string;
  readonly body: string;
  readonly kind: ClubThreadKind;
  readonly anonymous: boolean;
  readonly lockReplies: boolean;
  /** Uprawnienie moderacyjne wołającego - decyduje, czy `lockReplies` w ogóle jedzie. */
  readonly canModerate: boolean;
  readonly topic: string | null;
  readonly icon: string | null;
  readonly anchor: NewThreadAnchor | null;
  readonly attributionOverride: ClubAttributionMode | null;
  readonly idempotencyKey: string;
}

/** Argumenty mutacji `club_create_thread` (podzbiór `CreateThreadVars`). */
export interface NewThreadPayload {
  readonly groupId: string;
  readonly title: string;
  readonly body: string;
  readonly kind: ClubThreadKind;
  readonly anonymous: boolean;
  readonly anchorType: ClubAnchorType | null;
  readonly anchorId: string | null;
  readonly idempotencyKey: string;
  readonly lockReplies: boolean;
  readonly topic: string | null;
  readonly icon: string | null;
  readonly attributionMode: ClubAttributionMode | null;
}

/**
 * Stan formularza -> payload mutacji. Cztery decyzje, z których żadna nie jest
 * przepisaniem pola:
 *
 *   * tytuł i treść jadą PRZYCIĘTE - to ta sama wartość, którą walidował
 *     `newThreadFormReady`, więc walidacja i wysyłka nie mogą się rozjechać;
 *   * `lockReplies` wysyłamy TYLKO z uprawnieniem moderacyjnym - bez tego
 *     zwykły członek dostawał odmowę za pole, którego nawet nie widział;
 *   * ikona przechodzi przez katalog (`normalizeClubThreadIcon`), bo nazwa
 *     spoza zbioru jest ozdobą, która nie ma prawa zablokować publikacji;
 *   * `attributionMode` jedzie SUROWE nadpisanie, a nie wartość efektywna:
 *     `null` znaczy „dziedzicz dział”, więc wysłanie wyliczonej zasady
 *     zamrażałoby w wątku stan działu z chwili pisania.
 */
export function buildNewThreadPayload(state: NewThreadFormState): NewThreadPayload {
  return {
    groupId: state.groupId,
    title: state.title.trim(),
    body: state.body.trim(),
    kind: state.kind,
    anonymous: state.anonymous,
    anchorType: state.anchor?.anchorType ?? null,
    anchorId: state.anchor?.anchorId ?? null,
    idempotencyKey: state.idempotencyKey,
    lockReplies: state.canModerate ? state.lockReplies : false,
    topic: state.topic,
    icon: normalizeClubThreadIcon(state.icon),
    attributionMode: state.attributionOverride,
  };
}

/** Co zrobić po udanej publikacji: komunikat i cel nawigacji. */
export interface NewThreadOutcome {
  readonly toastKey: "club.threadPending" | "club.threadCreated";
  /** Slug wątku do otwarcia; `null` = wróć na listę, wątku jeszcze nie widać. */
  readonly threadSlug: string | null;
}

/**
 * Wpis w kolejce premoderacji NIE prowadzi do wątku - jego strona odpowiedziałaby
 * odmową, bo autor nie ma prawa czytać treści czekającej na dopuszczenie.
 * Dlatego status `pending` mówi o tym wprost i wraca na listę; każdy inny status
 * (`open` i cokolwiek dojdzie do słownika później) otwiera wątek.
 */
export function newThreadOutcome(result: {
  readonly slug: string;
  readonly status: string;
}): NewThreadOutcome {
  if (result.status === "pending") return { toastKey: "club.threadPending", threadSlug: null };
  return { toastKey: "club.threadCreated", threadSlug: result.slug };
}
