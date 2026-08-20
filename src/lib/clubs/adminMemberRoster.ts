// Skład klubu w panelu (zakładka „Członkowie”) - REGUŁY jako czyste funkcje.
//
// CO BYŁO W JSX-IE. Organizm `ClubMembersTab` trzymał w drzewie renderu
// jedenaście osobnych reguł produktu, każdą jako wyrażenie inline albo funkcję
// lokalną tuż nad komponentem: zawężenie roli i statusu z RPC do słownika
// klienta (`asRole`, `asStatus`), przełożenie wartości dropListy „wszystkie”
// na argument zapytania (`v === ANY ? null : asStatus(v)`), licznik kolejki
// próśb i zdanie o jej ucięciu (`pendingQ.data?.total ?? pending.length`,
// `pendingTotal > pending.length`), zbiór zaznaczonych wierszy z trzema
// operacjami na nim (`toggleOne`, `allVisibleSelected`, `toggleAllVisible`),
// cztery ładunki mutacji (dodanie, zatwierdzenie, zmiana roli, kadencja),
// ładunek operacji masowej z bramką pustego zaznaczenia, deskryptor
// potwierdzenia usunięcia/odrzucenia oraz stan kadencji
// (`role_expires_at === null` / `isExpired` / data).
//
// DLACZEGO TO SĄ REGUŁY, A NIE UKŁAD. Żadna z nich nie mówi, JAK skład
// wygląda - każda mówi, CO POLECI DO BAZY albo CZEGO ADMINISTRATOR NIE ZOBACZY:
//
//   * zawężenie roli i statusu jest OBRONĄ ZAPISU: `club_member_upsert`
//     przepuszcza wyłącznie wartości z CHECK-a, więc wartość spoza słownika
//     (nowsza migracja, literówka w danych) musi degradować W DÓŁ, nigdy w górę
//     - inaczej jedno kliknięcie w dropliście nadawałoby rolę, której baza
//     nigdy nie potwierdzi,
//   * licznik kolejki próśb czyta `total_count` z KAŻDEGO wiersza (kontrakt
//     paginacji `club_members_list`), a nie długość tablicy - RPC stronicuje
//     po pięćdziesiąt, więc `pending.length` zatrzymywał licznik na
//     pięćdziesiątce dokładnie wtedy, gdy kolejka wymaga uwagi najbardziej,
//   * zaznaczenie trzyma IDENTYFIKATORY i dotyczy WIDOCZNEJ strony - zbiór
//     obiektów rozjeżdżałby się z tabelą po refetchu, a „zaznacz wszystko”
//     liczone po całym klubie zmieniałoby rolę osobom, których administrator
//     nigdy nie zobaczył,
//   * ładunek zatwierdzenia ZACHOWUJE rolę z prośby: zaproszenie z linku może
//     nieść rolę moderatora, a przepisanie jej na `member` cicho ją odbierało,
//   * bramka pustego zaznaczenia i pustego identyfikatora decyduje, czy
//     mutacja w ogóle wychodzi z przeglądarki - odmowa musi zapaść PRZED
//     zapytaniem, nie w postaci błędu z bazy,
//   * deskryptor potwierdzenia jest jedyną blokadą przed operacją
//     NIEODWRACALNĄ (usunięcie członkostwa kasuje jego historię), więc jego
//     kształt jest regułą bezpieczeństwa, a nie ozdobą dialogu.
//
// Dopóki mieszkały w JSX-ie, sprawdzenie każdej z nich wymagało zamontowania
// całej zakładki z czterema atrapami hooków - czyli testu, który pada przy
// zmianie układu i milczy przy zmianie reguły.
//
// GRANICA WARSTW. Zero Reacta, zero i18n, zero klienta bazy. Wejściem są
// wiersze `club_members_list` i stan kontrolek, wyjściem gołe deskryptory
// i KLUCZE i18n - w tym pliku nie ma ani jednego gotowego napisu.
//
// SŁOWNIK PANELU, A NIE PUBLICZNY. Klucze `adminClubs.*` zwracane przez ten
// moduł mieszkają w `i18n-clubs-admin`, który trzeba jawnie dociągnąć przez
// `ensureAdminClubsI18n()`. Moduł tego NIE robi i nie może - nie zna Reacta
// ani i18next - i dlatego jest osiągalny WYŁĄCZNIE z panelu: z organizmu
// `ClubMembersTab` i z molekuł `ClubRoster*`, które to wywołanie mają. Granicę
// pilnuje bramka `adminClubsI18nLoading.gate`; jej złamanie kończy się gołym
// kluczem na ekranie i widać je dopiero w przeglądarce.
//
// DWIE UMOWY CO DO PUSTKI, które trzeba znać czytając asercje. (1) Generator
// typów Supabase deklaruje kolumny `RETURNS TABLE` jako non-null, więc
// `role_expires_at` ma typ `string`, choć baza zwraca tam NULL; pustkę
// reprezentuje więc PUSTY NAPIS, a `null` zostaje dla wywołań z kodu.
// Obie wartości znaczą to samo: brak kadencji. (2) Wartość nieparsowalna jako
// data też znaczy brak kadencji - stara wersja pokazywała w tym miejscu pusty
// przycisk, bo `formatDateShort` oddaje puste napisy dla `Invalid Date`.
import {
  CLUB_MEMBER_ROLES,
  CLUB_MEMBER_STATUSES,
  narrowClubEnum,
  type ClubMemberRole,
  type ClubMemberRow,
  type ClubMemberStatus,
  type ClubMemberUpsertInput,
} from "./types";

/**
 * Rozmiar strony listy członków w panelu.
 *
 * Ta sama liczba, co domyślny `limit` w `useClubMembers` i w
 * `fetchClubMembers` - i to jest decyzja, nie zbieżność: limit jest częścią
 * klucza zapytania, więc dwa widoki tej samej listy z różnymi limitami
 * rozjeżdżają się w cache (patrz komentarz w `useClubCatalog.ts`).
 */
export const ADMIN_MEMBER_PAGE_SIZE = 50;

/** Wartość dropListy „bez filtra”. Radix nie przyjmuje pustego napisu. */
export const ADMIN_MEMBER_STATUS_ANY = "__any__";

/** Rola z RPC zawężona do słownika klienta. Degradacja tylko W DÓŁ. */
export function toAdminMemberRole(value: string | null): ClubMemberRole {
  return narrowClubEnum(value, CLUB_MEMBER_ROLES, "member");
}

/** Status z RPC zawężony do słownika klienta. */
export function toAdminMemberStatus(value: string | null): ClubMemberStatus {
  return narrowClubEnum(value, CLUB_MEMBER_STATUSES, "active");
}

/**
 * Wartość dropListy -> argument zapytania. `null` znaczy WSZYSTKIE statusy
 * i nie wolno go zamienić na `undefined`: `fetchClubMembers` czyta pominięcie
 * klucza jako serwerowy domyślny filtr `active`, więc pozycja „wszystkie”
 * cicho pokazywałaby wyłącznie aktywnych.
 */
export function toAdminMemberStatusFilter(value: string): ClubMemberStatus | null {
  return value === ADMIN_MEMBER_STATUS_ANY ? null : toAdminMemberStatus(value);
}

/** Argument zapytania -> wartość dropListy. Odwrotność powyższej. */
export function adminMemberStatusValue(filter: ClubMemberStatus | null): string {
  return filter ?? ADMIN_MEMBER_STATUS_ANY;
}

/** Okno strony przekazywane do RPC. */
export interface AdminMemberWindow {
  readonly limit: number;
  readonly offset: number;
}

/**
 * Okno strony dla numeru strony liczonego od zera. Numer spoza zakresu
 * (ujemny, niecałkowity, `NaN`) daje PIERWSZĄ stronę - żądanie o ujemnym
 * `offset` baza odrzuca, a lista bez wiersza to gorsza odpowiedź niż lista
 * od początku.
 */
export function adminMemberWindow(page: number): AdminMemberWindow {
  const safe = Number.isFinite(page) && page > 0 ? Math.floor(page) : 0;
  return { limit: ADMIN_MEMBER_PAGE_SIZE, offset: safe * ADMIN_MEMBER_PAGE_SIZE };
}

/** Stan stronicowania policzony z `total_count` i długości strony. */
export interface AdminMemberPaging {
  readonly page: number;
  readonly pageCount: number;
  readonly shown: number;
  readonly total: number;
  /** Numer pierwszego wiersza strony liczony od jedynki; 0 dla pustej strony. */
  readonly firstIndex: number;
  readonly lastIndex: number;
  readonly isFirstPage: boolean;
  readonly isLastPage: boolean;
  /** Czy za tą stroną są jeszcze wiersze. */
  readonly hasMore: boolean;
}

/**
 * Granice stronicowania policzone z kontraktu `total_count`.
 *
 * Pusty zbiór ma JEDNĄ stronę, a nie zero - „strona 0 z 0” czyta się jak
 * awaria, choć jest poprawną odpowiedzią na filtr, który nikogo nie zwrócił.
 * Numer strony jest przycinany do zakresu, bo `total_count` może zmaleć
 * między dwoma odczytami (ktoś opuścił klub w trakcie przeglądania).
 *
 * `total` przychodzi jako liczba, a nie `number | undefined`, bo brak
 * odpowiedzi to nie „zero osób”: dopóki zapytanie nie wróciło, jedyną prawdą
 * jest długość tablicy i to WOŁAJĄCY musi tę decyzję podjąć jawnie.
 */
export function adminMemberPaging(args: {
  page: number;
  shown: number;
  total: number;
}): AdminMemberPaging {
  const total = args.total > 0 ? Math.floor(args.total) : 0;
  const shown = args.shown > 0 ? Math.floor(args.shown) : 0;
  const pageCount = Math.max(1, Math.ceil(total / ADMIN_MEMBER_PAGE_SIZE));
  const requested = Number.isFinite(args.page) && args.page > 0 ? Math.floor(args.page) : 0;
  const page = Math.min(requested, pageCount - 1);
  const offset = page * ADMIN_MEMBER_PAGE_SIZE;
  const lastIndex = offset + shown;
  return {
    page,
    pageCount,
    shown,
    total,
    firstIndex: shown === 0 ? 0 : offset + 1,
    lastIndex,
    isFirstPage: page === 0,
    isLastPage: page === pageCount - 1,
    hasMore: lastIndex < total,
  };
}

/** Przełącz jeden wiersz w zaznaczeniu. Zawsze NOWY zbiór. */
export function toggleMemberSelection(
  selected: ReadonlySet<string>,
  userId: string,
): ReadonlySet<string> {
  const next = new Set(selected);
  if (next.has(userId)) next.delete(userId);
  else next.add(userId);
  return next;
}

/**
 * Czy zaznaczono CAŁĄ widoczną stronę. Pusta strona daje `false`: haczyk
 * „zaznaczono wszystko” nad tabelą bez wierszy jest kłamstwem.
 */
export function areAllMembersSelected(
  selected: ReadonlySet<string>,
  visibleIds: readonly string[],
): boolean {
  return visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
}

/**
 * „Zaznacz wszystko” dotyczy WIDOCZNEJ strony. Zaznaczenia z innych stron
 * zostają nienaruszone - administrator, który przeszedł stronę dalej, nie
 * traci tego, co zaznaczył wcześniej.
 */
export function toggleAllMembersSelection(
  selected: ReadonlySet<string>,
  visibleIds: readonly string[],
): ReadonlySet<string> {
  const next = new Set(selected);
  if (areAllMembersSelected(selected, visibleIds)) {
    visibleIds.forEach((id) => next.delete(id));
  } else {
    visibleIds.forEach((id) => next.add(id));
  }
  return next;
}

/** Ładunek `club_member_upsert` bez identyfikatora klubu (dokłada go hook). */
export type AdminMemberUpsert = Omit<ClubMemberUpsertInput, "clubId">;

/**
 * Ładunek dodania osoby kartą „Dodaj członka”. Brak wyboru w pickerze daje
 * `null`, czyli „nie wysyłaj” - pusty `user_id` baza odrzuca wyjątkiem, więc
 * bramka po stronie klienta zamienia błąd w brak akcji.
 */
export function addMemberPayload(userId: string): AdminMemberUpsert | null {
  return userId.length === 0 ? null : { userId, role: "member", status: "active" };
}

/**
 * Ładunek zatwierdzenia prośby. ZACHOWUJE rolę z wiersza - zaproszenie
 * z linku może nieść rolę moderatora, a przepisanie jej na `member` po cichu
 * ją odbierało.
 */
export function approveMemberPayload(row: ClubMemberRow): AdminMemberUpsert {
  return { userId: row.user_id, role: toAdminMemberRole(row.role), status: "active" };
}

/** Ładunek zmiany roli. Status zostaje TAKI SAM - zmiana roli nie jest
 *  zatwierdzeniem prośby ani odbanowaniem. */
export function changeMemberRolePayload(row: ClubMemberRow, role: string): AdminMemberUpsert {
  return {
    userId: row.user_id,
    role: toAdminMemberRole(role),
    status: toAdminMemberStatus(row.status),
  };
}

/** Ładunek operacji masowej albo `null`, gdy nic nie zaznaczono. */
export function bulkMemberRolePayload(
  selected: ReadonlySet<string>,
  role: ClubMemberRole,
): { userIds: string[]; role: ClubMemberRole } | null {
  const userIds = [...selected];
  return userIds.length === 0 ? null : { userIds, role };
}

/**
 * Ładunek zmiany kadencji.
 *
 * `clearRoleExpiry` jest JAWNE, bo bez niego nie da się odróżnić „nie
 * przysłałem terminu” od „zdejmij termin” - a ta niejednoznaczność cicho
 * kasowała kadencję przy każdej zmianie roli z panelu. Zapis bez daty
 * i bez flagi czyszczenia daje `null`, czyli brak akcji.
 */
export function memberTenurePayload(
  row: ClubMemberRow,
  value: string,
  clear: boolean,
): AdminMemberUpsert | null {
  if (!clear && value.trim() === "") return null;
  return {
    userId: row.user_id,
    role: toAdminMemberRole(row.role),
    status: toAdminMemberStatus(row.status),
    roleExpiresAt: clear ? null : new Date(value).toISOString(),
    clearRoleExpiry: clear,
  };
}

/** Stan kadencji w kolumnie „Rola wygasa”. */
export type AdminMemberTenure =
  | { readonly kind: "none" }
  | { readonly kind: "expired"; readonly at: string }
  | { readonly kind: "until"; readonly at: string };

/**
 * Kadencja wobec podanej chwili. Chwila jest ARGUMENTEM, nie `Date.now()`
 * w środku: to jedyny sposób, żeby granica „wygasła / jeszcze nie” dała się
 * sprawdzić bez zegara systemowego.
 *
 * Granica jest DOMKNIĘTA po stronie wygaśnięcia (`<=`), tak samo jak
 * `club_scheduler_tick` w bazie - rola z terminem równym teraz jest już
 * wygaszona, a nie „wygaśnie za chwilę”.
 */
export function memberTenure(expiresAt: string | null, nowMs: number): AdminMemberTenure {
  if (expiresAt === null || expiresAt === "") return { kind: "none" };
  const at = new Date(expiresAt).getTime();
  if (Number.isNaN(at)) return { kind: "none" };
  return at <= nowMs ? { kind: "expired", at: expiresAt } : { kind: "until", at: expiresAt };
}

/** Czy jest co czyścić. Przycisk „zdejmij kadencję” bez kadencji jest martwy. */
export function hasMemberTenure(expiresAt: string | null): boolean {
  return memberTenure(expiresAt, 0).kind !== "none";
}

/** Deskryptor potwierdzenia operacji NIEODWRACALNEJ. Same klucze i18n. */
export interface AdminMemberRemovalPrompt {
  readonly titleKey: string;
  readonly titleParams: { readonly name: string };
  readonly bodyKey: string;
  readonly successKey: string;
}

/**
 * Odrzucenie prośby i usunięcie członka to ta sama mutacja, ale DWA różne
 * zdania: pierwsze mówi „ta osoba nie wejdzie”, drugie „ta osoba wypada
 * razem z historią”. Wspólny komunikat kazałby administratorowi domyślać
 * się, co właśnie robi.
 */
export function memberRemovalPrompt(row: ClubMemberRow, reject: boolean): AdminMemberRemovalPrompt {
  return reject
    ? {
        titleKey: "adminClubs.members.rejectConfirmTitle",
        titleParams: { name: row.display_name },
        bodyKey: "adminClubs.members.rejectConfirmBody",
        successKey: "adminClubs.members.rejected",
      }
    : {
        titleKey: "adminClubs.members.removeConfirmTitle",
        titleParams: { name: row.display_name },
        bodyKey: "adminClubs.members.removeConfirmBody",
        successKey: "adminClubs.members.removed",
      };
}

/** Pole opcjonalne wiersza: pustka to `null`, nie pusty napis. */
function optional(value: string | null): string | null {
  return value === null || value === "" ? null : value;
}

/** Wiersz tabeli składu w postaci gotowej do wyrenderowania. */
export interface AdminMemberRowView {
  readonly userId: string;
  readonly displayName: string;
  readonly jobTitle: string | null;
  readonly role: ClubMemberRole;
  readonly status: ClubMemberStatus;
  readonly joinedAt: string;
  readonly expiresAt: string | null;
  /** Prośba o dostęp - tylko taki wiersz ma przycisk zatwierdzenia. */
  readonly canApprove: boolean;
}

/**
 * Mapowanie wiersza RPC na widok. Zawężenie enumów zapada TUTAJ, więc żaden
 * komponent nie dostaje surowego napisu z bazy - a plakietka statusu
 * (`ClubMemberStatusBadge`) przyjmuje typ, nie `string`.
 */
export function toAdminMemberRowView(row: ClubMemberRow): AdminMemberRowView {
  const status = toAdminMemberStatus(row.status);
  return {
    userId: row.user_id,
    displayName: row.display_name,
    jobTitle: optional(row.job_title),
    role: toAdminMemberRole(row.role),
    status,
    joinedAt: row.joined_at,
    expiresAt: optional(row.role_expires_at),
    canApprove: status === "pending",
  };
}

/** Pozycja kolejki próśb o dostęp. */
export interface AdminMemberRequestView {
  readonly userId: string;
  readonly displayName: string;
  /** Klucz i18n roli - nazwy ról nie powstają w tej warstwie. */
  readonly roleKey: string;
  readonly company: string | null;
}

/**
 * Mapowanie prośby na pozycję kolejki. Linia pod nazwiskiem mówi ROLĘ, o którą
 * prośba idzie, bo zatwierdzenie tę rolę zachowa - bez niej administrator
 * zatwierdza w ciemno.
 */
export function toAdminMemberRequestView(row: ClubMemberRow): AdminMemberRequestView {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    roleKey: `club.role.${toAdminMemberRole(row.role)}`,
    company: optional(row.current_company),
  };
}
