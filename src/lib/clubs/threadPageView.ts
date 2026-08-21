// Reguły STRONY WĄTKU (`/club/$clubSlug/t/$threadSlug`) wyprowadzone z JSX-a.
//
// CO TU BYŁO PRZED WYPROWADZENIEM. Trasa wątku ma 1 095 linii i jest w tym
// module najgęstszym miejscem na pomyłkę: post otwierający, drzewo odpowiedzi,
// kompozytor, sondaż, stanowiska i osiem paneli przestrzeni roboczej. Reguły
// niżej mieszkały tam jako ciąg wyrażeń inline między znacznikami:
//
//   * kaskada trzech wczesnych `return`-ów (szkielet / awaria / 404),
//   * siedem `const`-ów uprawnień liczonych z wiersza RPC i sesji,
//   * dwa odczyty `?? 0` na stronie odpowiedzi,
//   * trzy potrójne warunki wybierające etykietę i komunikat rozstrzygnięcia,
//   * pięć warunków widoczności akcji przy KAŻDEJ odpowiedzi.
//
// Dopóki siedziały w drzewie JSX, jedynym sposobem sprawdzenia ich było
// zamontowanie całej trasy z czternastoma atrapami zapytań - czyli test, który
// pada przy zmianie układu, a milczy przy zmianie REGUŁY. A to są reguły
// bezpieczeństwa i uczciwości interfejsu, nie kosmetyka: przycisk redakcji na
// wpisie usuniętym przez moderację, przycisk zgłoszenia na WŁASNYM wpisie
// (RPC odrzuci go z 22023) albo „oznacz jako rozstrzygnięcie” u kogoś, kto
// tego prawa nie ma - każdy z tych błędów przechodzi przez `tsc` i przez
// przegląd, bo wygląda jak jeden znak w koniunkcji.
//
// GRANICA WARSTW. To jest warstwa `lib`: zero Reacta, zero i18n, zero klienta
// bazy. Funkcje zwracają KLUCZE i18n albo deskryptory, nigdy gotowego tekstu -
// tłumaczenie jest sprawą widoku. Autorytet dostępu (`can_reply`,
// `can_moderate`, `author_id` skrywane pod regułą Chatham House) należy do
// SECURITY DEFINER RPC i ma pgTAP; te funkcje wyłącznie CZYTAJĄ to, co RPC
// oddało, i nigdy nie liczą uprawnień od nowa.
import { CLUB_REPLY_SORTS, isClubReplyLive, type ClubReplySort } from "./types";

// ---------------------------------------------------------------------------
// Etap wczytywania
// ---------------------------------------------------------------------------

/**
 * Cztery ROZŁĄCZNE stany strony wątku. Rozdział jest regułą, nie kosmetyką:
 * awaria zapytania to NIE „nie ma takiego wątku”. Pusta odpowiedź znaczy 404
 * (klub `secret` nie ma prawa zdradzić, że istnieje), a błąd sieci albo bazy
 * ma powiedzieć, że problem jest po naszej stronie i da się spróbować ponownie
 * - inaczej użytkownik kasuje poprawny link jako martwy.
 */
export type ClubThreadStage = "loading" | "error" | "missing" | "ready";

export interface ClubThreadStageInput {
  /** `useQuery` karty klubu jest w locie. */
  readonly clubPending: boolean;
  /** Karta klubu nie przyszła (`data ?? null`). */
  readonly clubMissing: boolean;
  /** `useQuery` wątku jest w locie. */
  readonly threadPending: boolean;
  /** Wiersz wątku nie przyszedł. */
  readonly threadMissing: boolean;
  /** Którekolwiek z dwóch zapytań padło. */
  readonly failed: boolean;
}

/**
 * Kolejność warunków jest tu CAŁĄ treścią reguły.
 *
 * Zapytanie o wątek jest WYŁĄCZONE, dopóki nie znamy id klubu, a wyłączone
 * `useQuery` zostaje w `isPending` na zawsze. Dlatego oczekiwanie na wątek
 * liczy się TYLKO wtedy, gdy klub faktycznie jest - inaczej wejście na
 * nieistniejący slug kończy się wiecznym szkieletem zamiast 404.
 *
 * Awaria wygrywa nad pustką, bo pustka po awarii nie jest pustką: wiersza nie
 * ma, bo zapytanie padło, a nie bo wątku nie ma.
 */
export function resolveClubThreadStage(input: ClubThreadStageInput): ClubThreadStage {
  if (input.clubPending || (!input.clubMissing && input.threadPending)) return "loading";
  if (input.failed) return "error";
  if (input.clubMissing || input.threadMissing) return "missing";
  return "ready";
}

// ---------------------------------------------------------------------------
// Uprawnienia postu otwierającego
// ---------------------------------------------------------------------------

export interface ClubThreadCapabilityInput {
  /** `kind` z `club_thread_view` - rodzaj wątku. */
  readonly kind: string;
  /**
   * `author_id` z RPC. Pod regułą Chatham House NIE WYCHODZI z bazy (jest
   * `null`), więc porównanie z sesją jest tam zawsze fałszywe - i tak ma być:
   * baza sprawdzi autorstwo przy zapisie, a interfejs nie ma prawa zdradzić,
   * że to wpis czytającego.
   */
  readonly authorId: string | null;
  readonly canModerate: boolean;
  /** `locked_at` - wątek zamknięty nie przyjmuje już redakcji. */
  readonly lockedAt: string | null;
  /** `attribution_mode` klubu/działu rozstrzygnięty przez RPC. */
  readonly attributionMode: string;
  /**
   * Tożsamość czytającego. `null` znaczy „nie wiem, kto to” - także w klubie
   * Chatham House, gdzie sesja JEST, ale autorstwa nie widać.
   */
  readonly viewerId: string | null;
  /**
   * Czy ktokolwiek jest zalogowany. ŚWIADOMIE osobno od `viewerId`: zgłoszenie
   * wymaga SESJI (RPC odrzuci anonima), a rozpoznanie własnego wpisu wymaga
   * TOŻSAMOŚCI. To dwa różne warunki i sklejenie ich w jeden dałoby przycisk
   * „Zgłoś” na własnym wpisie albo jego brak dla zalogowanego czytelnika.
   */
  readonly signedIn: boolean;
}

export interface ClubThreadCapabilities {
  /** Wątek typu „stanowisko” - tylko on ma stanowiska i sort „mapa sporu”. */
  readonly isPosition: boolean;
  readonly isMine: boolean;
  /** Kto może wskazać odpowiedź rozstrzygającą. */
  readonly canResolve: boolean;
  readonly canEdit: boolean;
  readonly canReport: boolean;
  readonly canGoAnonymous: boolean;
  /** Porządki odpowiedzi dostępne w TYM wątku. */
  readonly replySorts: readonly ClubReplySort[];
}

/** Czy wpis należy do czytającego. Wymaga OBU stron znanych. */
function isOwnedBy(authorId: string | null, viewerId: string | null): boolean {
  return authorId !== null && authorId === viewerId;
}

/**
 * Uprawnienia postu otwierającego - jedno wejście, jeden wynik.
 *
 * Trzy reguły warte nazwania:
 *
 *   1. ROZSTRZYGNIĘCIE należy do autora pytania ALBO do moderacji, i wyłącznie
 *      w wątku typu `question`. W pozostałych rodzajach RPC odrzuca próbę,
 *      więc przycisk, który zawsze kończy się błędem, nie ma po co stać na
 *      ekranie.
 *   2. REDAKCJA gaśnie razem z zamknięciem wątku (`locked_at`) - także
 *      moderacji. Zamknięcie jest decyzją o dyskusji, nie o autorze.
 *   3. ZGŁOSZENIE dotyczy wpisu CUDZEGO i tylko zalogowanego: własnego RPC nie
 *      przyjmie (22023).
 */
export function clubThreadCapabilities(input: ClubThreadCapabilityInput): ClubThreadCapabilities {
  const isPosition = input.kind === "position";
  const isMine = isOwnedBy(input.authorId, input.viewerId);
  return {
    isPosition,
    isMine,
    canResolve: input.kind === "question" && (input.canModerate || isMine),
    canEdit: (isMine || input.canModerate) && input.lockedAt === null,
    canReport: input.signedIn && !isMine,
    canGoAnonymous: input.attributionMode === "anonymous_allowed",
    replySorts: availableClubReplySorts(isPosition),
  };
}

/**
 * Sort „mapa sporu” (`stance`) ma sens WYŁĄCZNIE tam, gdzie stanowiska w ogóle
 * istnieją - czyli w wątku `position`. Poza nim grupowałby wszystko w jeden
 * kosz „bez stanowiska” i udawał widok, którego nie ma.
 */
export function availableClubReplySorts(isPosition: boolean): readonly ClubReplySort[] {
  return CLUB_REPLY_SORTS.filter((sort) => sort !== "stance" || isPosition);
}

// ---------------------------------------------------------------------------
// Strona odpowiedzi
// ---------------------------------------------------------------------------

/** Minimalny kształt strony odpowiedzi (`ClubRepliesPage`) czytany przez widok. */
export interface ClubRepliesPageShape {
  readonly rows: readonly unknown[];
  /** WSZYSTKIE widoczne odpowiedzi wątku, nie tylko pobrana strona. */
  readonly total: number;
}

export interface ClubRepliesMeter {
  readonly total: number;
  readonly shown: number;
  /** Strona jest ucięta - trzeba to powiedzieć WPROST. */
  readonly truncated: boolean;
  /** Czy pokazać droplistę porządków. */
  readonly sortPickerVisible: boolean;
}

/**
 * Licznik odpowiedzi pod nagłówkiem sekcji.
 *
 * `undefined` znaczy ZAPYTANIE W LOCIE, nie „zero odpowiedzi” - i właśnie
 * dlatego oba odczyty muszą zejść do zera zamiast wywalić się na `.length`.
 *
 * UCIĘCIE mówi się wprost: nagłówek pokazuje pełny licznik z denormalizacji,
 * więc milcząca różnica między `total` a długością listy wyglądałaby jak utrata
 * treści, a nie jak paginacja.
 *
 * DROPLISTA porządków stoi dopiero od DWÓCH odpowiedzi: przy jednej nie ma
 * czego porządkować, a pole wyboru sugerowałoby, że lista jest dłuższa.
 */
export function clubRepliesMeter(page: ClubRepliesPageShape | null | undefined): ClubRepliesMeter {
  const total = page?.total ?? 0;
  const shown = page?.rows.length ?? 0;
  return { total, shown, truncated: total > shown, sortPickerVisible: total > 1 };
}

/** Czy któraś z ZAŁADOWANYCH odpowiedzi nosi już flagę rozstrzygnięcia. */
export function clubThreadHasResolution(
  rows: readonly { readonly is_resolution: boolean }[],
): boolean {
  return rows.some((row) => row.is_resolution);
}

// ---------------------------------------------------------------------------
// Rozstrzygnięcie wątku
// ---------------------------------------------------------------------------

/**
 * Akcja rozstrzygnięcia dostępna przy JEDNEJ odpowiedzi.
 *
 * `mark` i `move` to ta sama operacja RPC z inną etykietą - i ta różnica jest
 * treścią komunikatu, nie ozdobą: „oznacz” przy wątku, który nic nie ma
 * rozstrzygniętego, „przenieś” przy wątku, który już ma. Człowiek musi
 * wiedzieć, że jego klik ZDEJMIE decyzję z innej odpowiedzi.
 */
export type ClubResolveAction = "none" | "mark" | "move" | "unmark";

export interface ClubResolveActionInput {
  readonly canResolve: boolean;
  /** Czy TA odpowiedź jest rozstrzygnięciem. */
  readonly isResolution: boolean;
  /** Czy KTÓRAKOLWIEK załadowana odpowiedź jest rozstrzygnięciem. */
  readonly hasResolution: boolean;
}

export function clubResolveAction(input: ClubResolveActionInput): ClubResolveAction {
  if (!input.canResolve) return "none";
  if (input.isResolution) return "unmark";
  return input.hasResolution ? "move" : "mark";
}

/** Klucze etykiet akcji rozstrzygnięcia. Widok tłumaczy, moduł nazywa. */
export const CLUB_RESOLVE_LABEL_KEYS: Readonly<Record<Exclude<ClubResolveAction, "none">, string>> =
  {
    mark: "club.markResolution",
    move: "club.moveResolution",
    unmark: "club.unmarkResolution",
  };

/**
 * Komunikat po udanym rozstrzygnięciu. `replyId === null` to COFNIĘCIE, więc
 * ma własne zdanie - a przy wątku, który rozstrzygnięcie już miał, prawdą jest
 * „przeniesiono”, nie „rozstrzygnięto”.
 */
export function clubResolveToastKey(replyId: string | null, hasResolution: boolean): string {
  if (replyId === null) return "club.unresolvedToast";
  return hasResolution ? "club.movedResolutionToast" : "club.resolvedToast";
}

// ---------------------------------------------------------------------------
// Uprawnienia jednej odpowiedzi
// ---------------------------------------------------------------------------

/**
 * Poziom, od którego odpowiedzi NIE dostają już przycisku „Odpowiedz”. Drzewo
 * jest przycięte do dwóch poziomów (`buildClubReplyTree`), a przycisk, który
 * po cichu przypina wpis gdzie indziej, wprowadza w błąd.
 */
export const CLUB_REPLY_MAX_DEPTH = 2;

export interface ClubReplyCapabilityInput {
  readonly authorId: string | null;
  /** `status` z `club_replies_list`: `pending | visible | hidden | deleted`. */
  readonly status: string;
  readonly depth: number;
  readonly isResolution: boolean;
  readonly viewerId: string | null;
  /** Moderacja TEGO klubu - z karty wątku, nie liczona tutaj. */
  readonly canModerate: boolean;
  readonly threadLocked: boolean;
  readonly canResolve: boolean;
  readonly hasResolution: boolean;
}

export interface ClubReplyCapabilities {
  readonly isMine: boolean;
  readonly canEdit: boolean;
  readonly canReport: boolean;
  /** Czy stoi przycisk „Odpowiedz” (poziom drzewa, nie uprawnienie). */
  readonly canReplyTo: boolean;
  readonly resolveAction: ClubResolveAction;
}

/**
 * Uprawnienia jednej odpowiedzi.
 *
 * REDAKCJA pyta o STATUS, nie o samo autorstwo: poprzednia wersja sprawdzała
 * `status !== "removed"`, a takiego statusu nie ma w słowniku
 * (`pending | visible | hidden | deleted`), więc warunek był zawsze prawdziwy
 * i wpis zdjęty przez moderację zachowywał przycisk redakcji. Stąd
 * `isClubReplyLive` jako jedyne miejsce, które o tym decyduje.
 */
export function clubReplyCapabilities(input: ClubReplyCapabilityInput): ClubReplyCapabilities {
  const isMine = isOwnedBy(input.authorId, input.viewerId);
  return {
    isMine,
    canEdit: (isMine || input.canModerate) && !input.threadLocked && isClubReplyLive(input.status),
    canReport: input.viewerId !== null && !isMine,
    canReplyTo: input.depth < CLUB_REPLY_MAX_DEPTH,
    resolveAction: clubResolveAction({
      canResolve: input.canResolve,
      isResolution: input.isResolution,
      hasResolution: input.hasResolution,
    }),
  };
}

// ---------------------------------------------------------------------------
// Reakcje
// ---------------------------------------------------------------------------

/**
 * Suma reakcji jednej partii - liczba nad twarzami. Było to dwukrotnie
 * powtórzone `reduce` w JSX-ie (post otwierający i każda odpowiedź), a pusta
 * partia MUSI dać zero, nie `undefined`: `ClubReactionAvatars` pokazuje
 * „+N”, więc `undefined` wypisałoby „+NaN”.
 */
export function clubReactionTotal(tallies: readonly { readonly total: number }[]): number {
  return tallies.reduce((sum, tally) => sum + tally.total, 0);
}
