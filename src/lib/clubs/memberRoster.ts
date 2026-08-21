// Skład klubu (`/club/$clubSlug/members`) - REGUŁY listy członków jako czyste
// funkcje.
//
// CO BYŁO W JSX-IE. Trasa składu trzymała w drzewie renderu siedem osobnych
// reguł produktu, każdą jako wyrażenie inline: zawężenie roli z RPC do
// słownika klienta (`asRole`), zbiór ról, które prowadzący wolno w ogóle
// zaproponować, bramkę widoczności składu przepisaną na argumenty DWÓCH zapytań
// (`canSee ? club?.id : undefined`), zbiór osób z kropką obecności
// (`signal?.faces ?? []` + `filter` + `map` + `new Set`), plakietkę roli
// (`row.role !== "member"`), linię stanowiska (`[job_title, current_company]
// .filter(Boolean).join(...)` pod warunkiem `!== null`), odnośnik do profilu
// (`row.slug ?`), prawo zmiany roli w wierszu (`canManage && row.user_id !==
// user?.id`) oraz komunikat o ucięciu strony (`total > rows.length`).
//
// DLACZEGO TO SĄ REGUŁY, A NIE UKŁAD. Żadna z nich nie mówi, JAK skład wygląda
// - każda mówi, KOMU i CO wolno zobaczyć albo zmienić:
//
//   * bramka widoczności decyduje, czy zapytanie o nazwiska w ogóle wychodzi
//     z przeglądarki (klub ma prawo nie pokazywać składu, a wtedy nie ma też
//     prawa wysłać listy „na wszelki wypadek" i ukryć jej stylem),
//   * zbiór ról do wyboru jest OBRONĄ INTERFEJSU: RPC `club_set_role`
//     przepuszcza role podwyższone wyłącznie personelowi, więc oferowanie ich
//     prowadzącemu byłoby proponowaniem wyboru, który baza odrzuci,
//   * wyjątek „nie zmieniam własnej roli" jest jedyną blokadą, która broni
//     prowadzącego przed odebraniem sobie dostępu do tej właśnie kontrolki,
//   * odnośnik do profilu wolno postawić tylko przy osobie, która ma profil
//     publiczny - katalog klubu nie może obchodzić ustawienia widoczności
//     profilu,
//   * ucięcie strony trzeba powiedzieć wprost, bo nagłówek pokazuje pełny
//     licznik z denormalizacji, więc milcząca różnica wygląda jak brak osób.
//
// Dopóki mieszkały w JSX-ie, sprawdzenie każdej z nich wymagało zamontowania
// całej trasy z czterema atrapami zapytań - czyli testu, który pada przy
// zmianie układu i milczy przy zmianie reguły.
//
// GRANICA WARSTW. Warstwa `lib`: zero Reacta, zero i18n, zero klienta bazy.
// Wejściem są wiersze `club_members_list` i sygnał składu (jedno i drugie
// odsiane po stronie SECURITY DEFINER - `banned` i `left` nie wychodzą z bazy,
// a nazwiska tylko przy `can_see_members`), wyjściem gołe deskryptory. Nazwy
// ról wychodzą jako WARTOŚCI SŁOWNIKA, z których trasa składa klucz i18n
// (`club.role.${role}`) - tutaj nie ma ani jednego gotowego napisu.
//
// AUTORYZACJI TU NIE MA. `can_see_members` i `can_manage` liczy
// `public.club_capabilities()` i to jest jedyny autorytet (patrz nagłówek
// `capabilityMatrix.ts`). Te funkcje CZYTAJĄ jego wynik i nie próbują go
// odtworzyć.
import { CLUB_MEMBER_ROLES, type ClubMemberRole, type ClubMemberStatus } from "./types";

/**
 * Rozmiar strony składu.
 *
 * Ta sama liczba obsługuje listę nazwisk i pulę twarzy sygnału obecności -
 * i to jest decyzja, nie zbieżność: kropka obecności ma stać przy wierszu,
 * który jest na ekranie, więc pula twarzy węższa niż strona listy gasiłaby
 * kropki w jej dolnej połowie, a szersza dawałaby osoby z kropką bez wiersza.
 */
export const CLUB_ROSTER_PAGE_SIZE = 60;

/** Skład wychodzi WYŁĄCZNIE dla członkostw aktywnych - usunięci są sprawą
 *  moderacji, nie zebrania. Filtr jedzie do RPC, nie do tablicy w kliencie. */
export const CLUB_ROSTER_STATUS: ClubMemberStatus = "active";

/**
 * Minimum, jakiego reguły potrzebują z karty klubu. Świadomie WĘŻSZE niż
 * `ClubViewRow` i świadomie nullowalne: generator typów Supabase deklaruje
 * kolumny `RETURNS TABLE` jako non-null (patrz `NullableCols` w `types.ts`),
 * a trasa była pisana defensywnie - `=== true` ma znaczyć „baza powiedziała
 * TAK", a nie „coś tam przyszło".
 */
export interface ClubRosterGate {
  readonly id: string;
  readonly can_see_members?: boolean | null;
  readonly can_manage?: boolean | null;
}

/**
 * Czy wolno pokazać nazwiska. Brak karty klubu i każda wartość inna niż jawne
 * `true` znaczą NIE - to bramka, więc jej stanem wyjściowym jest odmowa.
 */
export function canSeeClubRoster(club: ClubRosterGate | null | undefined): boolean {
  return club?.can_see_members === true;
}

/** Czy wolno zmieniać role w tym klubie. Ta sama polityka pustki, co wyżej. */
export function canManageClubRoster(club: ClubRosterGate | null | undefined): boolean {
  return club?.can_manage === true;
}

/**
 * Identyfikator klubu dla zapytań o skład - albo `undefined`, gdy pytać NIE
 * WOLNO.
 *
 * `undefined` nie jest tu „brakiem danych": to wyłącznik obu zapytań (oba mają
 * `enabled: Boolean(clubId)`). Klub, który ukrywa skład, nie ma wysłać listy
 * nazwisk do przeglądarki i schować jej stylem - odmowa musi zapaść PRZED
 * zapytaniem.
 */
export function rosterClubId(club: ClubRosterGate | null | undefined): string | undefined {
  return canSeeClubRoster(club) ? club?.id : undefined;
}

/** Argumenty zapytania o listę członków - jedno miejsce na stronę i filtr. */
export function clubRosterListQuery(club: ClubRosterGate | null | undefined): {
  clubId: string | undefined;
  status: ClubMemberStatus;
  limit: number;
} {
  return {
    clubId: rosterClubId(club),
    status: CLUB_ROSTER_STATUS,
    limit: CLUB_ROSTER_PAGE_SIZE,
  };
}

/** Argumenty zapytania o sygnał obecności - ta sama bramka i ta sama strona. */
export function clubRosterSignalQuery(club: ClubRosterGate | null | undefined): {
  clubId: string | undefined;
  limit: number;
} {
  return { clubId: rosterClubId(club), limit: CLUB_ROSTER_PAGE_SIZE };
}

/**
 * Rola z RPC zawężona do słownika klienta.
 *
 * Wartość spoza słownika (nowsza migracja, literówka w danych) NIE MOŻE
 * wywrócić listy ani wybrać się sama na rolę podwyższoną, więc degraduje do
 * stanu domyślnego. Kierunek degradacji jest jednostronny: w dół, nigdy w górę.
 */
export function asClubMemberRole(value: string | null | undefined): ClubMemberRole {
  return value !== null &&
    value !== undefined &&
    (CLUB_MEMBER_ROLES as readonly string[]).includes(value)
    ? (value as ClubMemberRole)
    : "member";
}

/**
 * Rola do plakietki przy nazwisku albo `null`, gdy plakietki nie ma.
 *
 * `member` to stan domyślny - plakietka przy KAŻDYM wierszu byłaby szumem,
 * a nie informacją, więc pokazujemy wyłącznie role wyróżniające.
 *
 * UWAGA CO DO WARTOŚCI NIEZNANEJ: warunek patrzy na wartość SUROWĄ, a napis
 * powstaje z wartości zawężonej, więc rola spoza słownika daje plakietkę
 * z etykietą stanu domyślnego. Odwzorowuje to zachowanie trasy 1:1 (było
 * `row.role !== "member" ? t(\`club.role.${asRole(row.role)}\`) : null`)
 * i jest tu opisane, żeby nie wyglądało na przypadek przy następnym czytaniu.
 */
export function rosterBadgeRole(value: string | null | undefined): ClubMemberRole | null {
  return value === "member" ? null : asClubMemberRole(value);
}

/**
 * Role, które prowadzący klubu może w ogóle ZAPROPONOWAĆ.
 *
 * `is_club_admin` w bazie to dokładnie admin|super_admin, a tylko im RPC
 * `club_set_role` przepuszcza `lead` i `moderator`. Droplista prowadzącego
 * ich więc nie oferuje: wybór, którego baza odrzuci, jest błędem interfejsu,
 * a nie ostrzeżeniem serwera.
 */
export function assignableClubRoles(isAdmin: boolean): readonly ClubMemberRole[] {
  return isAdmin ? CLUB_MEMBER_ROLES : (["member", "observer"] as const);
}

/** Jedna twarz sygnału obecności w kształcie, który te reguły czytają. */
export interface ClubRosterPresenceFace {
  readonly userId: string;
  readonly isActive: boolean;
}

/**
 * Zbiór osób z kropką obecności („odezwał się w ostatniej dobie").
 *
 * Twarze przychodzą tą samą regułą widoczności profilu, co lista członków, więc
 * zbiór pokrywa dokładnie te wiersze, które są na ekranie. Brak sygnału
 * (zapytanie w locie, klub bez uprawnienia, awaria) daje zbiór PUSTY, czyli
 * listę bez kropek - a nie listę bez wierszy.
 */
export function activeMemberIds(
  signal: { readonly faces?: readonly ClubRosterPresenceFace[] | null } | null | undefined,
): Set<string> {
  const faces = signal?.faces ?? [];
  const ids = new Set<string>();
  for (const face of faces) if (face.isActive) ids.add(face.userId);
  return ids;
}

/**
 * Linia stanowiska pod nazwiskiem: „stanowisko - firma", jedno z dwóch albo
 * `null`, gdy obu kolumn nie ma.
 *
 * `null` znaczy „nie rysuj akapitu", a pusty ciąg znaczy „kolumna jest, tylko
 * pusta" - i to rozróżnienie odwzorowuje trasę 1:1 (warunek `!== null` na
 * kolumnach plus `filter(Boolean)` na wartościach). Patrz też uwaga o pustym
 * akapicie w teście trasy: przy DWÓCH kolumnach obecnych, ale pustych, wynikiem
 * jest pusty ciąg, nie `null`.
 */
export function rosterIdentityLine(
  jobTitle: string | null | undefined,
  company: string | null | undefined,
): string | null {
  const hasJob = jobTitle !== null && jobTitle !== undefined;
  const hasCompany = company !== null && company !== undefined;
  if (!hasJob && !hasCompany) return null;
  return [jobTitle, company].filter((part): part is string => Boolean(part)).join(" - ");
}

/**
 * Slug profilu publicznego albo `null`, gdy odnośnika NIE WOLNO postawić.
 *
 * Osoba bez publicznego profilu jest w składzie wypisana bez linku: katalog
 * klubu nie może obchodzić ustawienia widoczności profilu. Pusty ciąg z RPC
 * znaczy dokładnie to samo, co brak wartości.
 */
export function rosterProfileSlug(slug: string | null | undefined): string | null {
  return slug === null || slug === undefined || slug === "" ? null : slug;
}

/**
 * Czy wiersz ma kontrolkę zmiany roli.
 *
 * Zmiana WŁASNEJ roli nie ma sensu i jest jedyną, która mogłaby odebrać
 * prowadzącemu dostęp do tej kontrolki - stąd wyjątek na siebie. Gość
 * (`viewerId === null`) nigdy nie zarządza, bo nie przejdzie `canManage`.
 */
export function isRosterRowEditable(
  canManage: boolean,
  rowUserId: string,
  viewerId: string | null | undefined,
): boolean {
  return canManage && rowUserId !== viewerId;
}

/** Wiersz `club_members_list` w kształcie, którego te reguły naprawdę czytają. */
export interface ClubRosterSourceRow {
  readonly user_id: string;
  readonly display_name: string;
  readonly avatar_url: string | null;
  readonly slug: string | null;
  readonly job_title: string | null;
  readonly current_company: string | null;
  readonly verified: boolean;
  readonly role: string;
  readonly joined_at: string;
}

/** Kontekst czytelnika - to, czego wiersz sam o sobie nie wie. */
export interface ClubRosterViewContext {
  readonly activeIds: ReadonlySet<string>;
  readonly canManage: boolean;
  readonly viewerId: string | null;
}

/** Deskryptor jednego wiersza składu - dane dla renderu, bez ani jednego napisu. */
export interface ClubRosterRowView {
  readonly userId: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  /** Kropka obecności przy twarzy. */
  readonly active: boolean;
  readonly verified: boolean;
  /** Rola do kontrolki wyboru - zawsze wartość ze słownika. */
  readonly role: ClubMemberRole;
  /** Rola do plakietki albo `null`, gdy plakietki nie ma. */
  readonly badgeRole: ClubMemberRole | null;
  /** Linia stanowiska albo `null`, gdy akapitu nie ma. */
  readonly identity: string | null;
  readonly joinedAt: string;
  /** Slug profilu albo `null`, gdy wiersz jest bez odnośnika. */
  readonly profileSlug: string | null;
  readonly editable: boolean;
}

/** Skład złożony na widok - jeden przebieg, zero decyzji w drzewie renderu. */
export function toClubRosterRows(
  rows: readonly ClubRosterSourceRow[],
  context: ClubRosterViewContext,
): ClubRosterRowView[] {
  return rows.map((row) => ({
    userId: row.user_id,
    name: row.display_name,
    avatarUrl: row.avatar_url,
    active: context.activeIds.has(row.user_id),
    verified: row.verified,
    role: asClubMemberRole(row.role),
    badgeRole: rosterBadgeRole(row.role),
    identity: rosterIdentityLine(row.job_title, row.current_company),
    joinedAt: row.joined_at,
    profileSlug: rosterProfileSlug(row.slug),
    editable: isRosterRowEditable(context.canManage, row.user_id, context.viewerId),
  }));
}

/** Parametry komunikatu o ucięciu strony - albo `null`, gdy nic nie ucięto. */
export interface ClubRosterTruncation {
  readonly shown: number;
  readonly total: number;
}

/**
 * Czy powiedzieć wprost, że strona jest ucięta.
 *
 * Nagłówek pokazuje PEŁNY licznik z denormalizacji (`clubs.member_count`),
 * a lista jedną stronę, więc milcząca różnica wygląda jak brak osób. Liczba
 * większa od pokazanej to jedyny warunek: `total` mniejszy od liczby wierszy
 * (rozjazd denormalizacji) nie jest ucięciem i nie ma prawa dać komunikatu
 * o ujemnej resztce.
 */
export function rosterTruncation(shown: number, total: number): ClubRosterTruncation | null {
  return total > shown ? { shown, total } : null;
}
