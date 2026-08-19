// Reguły składu klubu wyprowadzone z JSX-a trasy `/club/$clubSlug/members`.
//
// CO TEN PLIK DOWODZI. Osiem reguł produktu, które przed wyprowadzeniem były
// wyrażeniami inline w drzewie renderu i dały się sprawdzić wyłącznie przez
// zamontowanie całej trasy z czterema atrapami zapytań:
//
//   1. BRAMKA WIDOCZNOŚCI jest wyłącznikiem ZAPYTANIA, nie stylu. Klub, który
//      ukrywa skład, nie ma prawa wysłać listy nazwisk do przeglądarki i schować
//      jej `display: none` - dlatego brak uprawnienia daje `clubId: undefined`,
//      czyli zapytanie wyłączone przez `enabled`.
//   2. Bramka jest DOMKNIĘTA NA PUSTKĘ: brak karty klubu, `null` i `undefined`
//      znaczą ODMOWĘ. Stanem wyjściowym bramki jest „nie wolno”.
//   3. STRONA jest jedna dla listy i dla puli twarzy - kropka obecności ma stać
//      przy wierszu, który jest na ekranie.
//   4. ZAWĘŻENIE ROLI degraduje w DÓŁ. Wartość spoza słownika (nowsza migracja,
//      literówka) nie może wywrócić listy ani sama awansować do roli
//      podwyższonej.
//   5. ZBIÓR RÓL DO WYBORU jest obroną interfejsu: prowadzącemu nie wolno
//      proponować `lead` ani `moderator`, bo RPC `club_set_role` przepuszcza je
//      wyłącznie personelowi. Wybór, którego baza odrzuci, jest błędem
//      interfejsu, a nie ostrzeżeniem serwera.
//   6. WYJĄTEK NA SIEBIE: prowadzący nie zmienia własnej roli - to jedyna
//      zmiana, którą mógłby sobie odebrać dostęp do tej właśnie kontrolki.
//   7. ODNOŚNIK DO PROFILU stawiamy tylko przy osobie z profilem publicznym;
//      pusty ciąg z RPC znaczy dokładnie to samo, co brak wartości.
//   8. UCIĘCIE STRONY mówi się wprost, ale tylko wtedy, gdy naprawdę jest -
//      rozjazd denormalizacji (`total` mniejszy od liczby wierszy) nie ma prawa
//      dać komunikatu o ujemnej resztce.
//
// Progi trafione DOKŁADNIE w granicę i o jeden po każdej stronie: strona 60,
// ucięcie przy `total` równym i o jeden większym od liczby wierszy.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - AUTORYZACJI: `can_see_members` i `can_manage` liczy `club_capabilities()`
//   w SECURITY DEFINER i to jedyny autorytet (pgTAP + `capabilityMatrix.ts`).
//   Te funkcje czytają jego wynik, nie odtwarzają go.
// - ODSIEWU WIERSZY: `banned` i `left` nie wychodzą z `club_members_list`, więc
//   testy nie udają, że filtruje je klient.
// - SKLEJENIA TRASY (co jedzie do zapytań, jaki nagłówek wychodzi, co widzi
//   czytelnik bez uprawnienia) - to zakres `clubMembersRoute.test.tsx`.
// - ROTACJI TWARZY (`rotateRosterFaces`) i kształtu sygnału obecności - własny
//   zakres w `networkTypes.test.ts`.
import { describe, expect, it } from "vitest";
import {
  CLUB_ROSTER_PAGE_SIZE,
  CLUB_ROSTER_STATUS,
  activeMemberIds,
  asClubMemberRole,
  assignableClubRoles,
  canManageClubRoster,
  canSeeClubRoster,
  clubRosterListQuery,
  clubRosterSignalQuery,
  isRosterRowEditable,
  rosterBadgeRole,
  rosterClubId,
  rosterIdentityLine,
  rosterProfileSlug,
  rosterTruncation,
  toClubRosterRows,
  type ClubRosterGate,
  type ClubRosterPresenceFace,
} from "@/lib/clubs/memberRoster";
import { CLUB_MEMBER_ROLES } from "@/lib/clubs/types";
import { CLUB_BASE_ISO, CLUB_IDS, clubMemberRow, clubViewRow } from "@/test/clubs/fixtures";

/** Karta klubu zawężona do tego, co czyta bramka - z jawną pustką. */
function gate(overrides: Partial<ClubRosterGate> = {}): ClubRosterGate {
  return { id: CLUB_IDS.club, can_see_members: true, can_manage: false, ...overrides };
}

// --- bramka widoczności -----------------------------------------------------

describe("bramka widoczności składu - stanem wyjściowym jest odmowa", () => {
  it("jawne `true` z bazy otwiera skład", () => {
    expect(canSeeClubRoster(gate({ can_see_members: true }))).toBe(true);
  });

  it.each([
    ["jawne false", gate({ can_see_members: false })],
    ["kolumna null", gate({ can_see_members: null })],
    ["kolumna nieobecna", { id: CLUB_IDS.club }],
  ])("%s zamyka skład", (_opis, club: ClubRosterGate) => {
    expect(canSeeClubRoster(club)).toBe(false);
  });

  it.each([
    ["brak karty klubu (null)", null],
    ["karta jeszcze nie przyszła (undefined)", undefined],
  ])("%s zamyka skład", (_opis, club: ClubRosterGate | null | undefined) => {
    expect(canSeeClubRoster(club)).toBe(false);
  });

  it("wiersz `club_view` z fixture'ów przechodzi bramkę bez zawężania kształtu", () => {
    expect(canSeeClubRoster(clubViewRow({ can_see_members: true }))).toBe(true);
    expect(canSeeClubRoster(clubViewRow({ can_see_members: false }))).toBe(false);
  });
});

describe("bramka zarządzania rolami - ta sama polityka pustki", () => {
  it("jawne `true` daje prawo zmiany roli", () => {
    expect(canManageClubRoster(gate({ can_manage: true }))).toBe(true);
  });

  it.each([
    ["jawne false", gate({ can_manage: false })],
    ["kolumna null", gate({ can_manage: null })],
    ["kolumna nieobecna", { id: CLUB_IDS.club }],
  ])("%s odmawia zarządzania", (_opis, club: ClubRosterGate) => {
    expect(canManageClubRoster(club)).toBe(false);
  });

  it("brak karty klubu odmawia zarządzania", () => {
    expect(canManageClubRoster(null)).toBe(false);
    expect(canManageClubRoster(undefined)).toBe(false);
  });

  it("widzenie składu NIE jest zarządzaniem nim - to dwie różne kolumny", () => {
    const club = gate({ can_see_members: true, can_manage: false });
    expect(canSeeClubRoster(club)).toBe(true);
    expect(canManageClubRoster(club)).toBe(false);
  });
});

// --- argumenty zapytań ------------------------------------------------------

describe("argumenty zapytań o skład - odmowa zapada PRZED zapytaniem", () => {
  it("z uprawnieniem jedzie identyfikator klubu", () => {
    expect(rosterClubId(gate({ can_see_members: true }))).toBe(CLUB_IDS.club);
  });

  it.each([
    ["bez uprawnienia", gate({ can_see_members: false })],
    ["z kolumną null", gate({ can_see_members: null })],
  ])("%s zapytanie NIE dostaje identyfikatora", (_opis, club: ClubRosterGate) => {
    expect(rosterClubId(club)).toBeUndefined();
  });

  it("brak karty klubu wyłącza zapytanie", () => {
    expect(rosterClubId(null)).toBeUndefined();
  });

  it("lista pyta o AKTYWNYCH i o jedną stronę", () => {
    expect(clubRosterListQuery(gate())).toEqual({
      clubId: CLUB_IDS.club,
      status: "active",
      limit: CLUB_ROSTER_PAGE_SIZE,
    });
  });

  it("strona składu ma 60 osób, a filtr statusu jest `active`", () => {
    expect(CLUB_ROSTER_PAGE_SIZE).toBe(60);
    expect(CLUB_ROSTER_STATUS).toBe("active");
  });

  it("lista bez uprawnienia zachowuje filtr i stronę, gubi WYŁĄCZNIE klub", () => {
    expect(clubRosterListQuery(gate({ can_see_members: false }))).toEqual({
      clubId: undefined,
      status: "active",
      limit: CLUB_ROSTER_PAGE_SIZE,
    });
  });

  it("pula twarzy jest RÓWNA stronie listy - kropka nie gaśnie w połowie ekranu", () => {
    const list = clubRosterListQuery(gate());
    const signal = clubRosterSignalQuery(gate());
    expect(signal.limit).toBe(list.limit);
    expect(signal.clubId).toBe(list.clubId);
  });

  it("sygnał obecności jedzie tą samą bramką, co lista nazwisk", () => {
    expect(clubRosterSignalQuery(gate({ can_see_members: false }))).toEqual({
      clubId: undefined,
      limit: CLUB_ROSTER_PAGE_SIZE,
    });
  });
});

// --- rola z RPC -------------------------------------------------------------

describe("zawężenie roli do słownika klienta - degradacja tylko w dół", () => {
  it.each(CLUB_MEMBER_ROLES)("rola `%s` ze słownika przechodzi bez zmiany", (role) => {
    expect(asClubMemberRole(role)).toBe(role);
  });

  it.each([
    ["wartość z nowszej migracji", "curator"],
    ["inna wielkość liter", "LEAD"],
    ["pusty ciąg", ""],
    ["ciąg z samych spacji", "  "],
    ["null", null],
    ["undefined", undefined],
  ])("%s degraduje do stanu domyślnego", (_opis, value: string | null | undefined) => {
    expect(asClubMemberRole(value)).toBe("member");
  });

  it("degradacja NIE prowadzi w górę - nieznana rola nie awansuje na prowadzącego", () => {
    expect(asClubMemberRole("club_lead")).not.toBe("lead");
    expect(asClubMemberRole("club_lead")).not.toBe("moderator");
  });
});

describe("plakietka roli - `member` jest stanem domyślnym, więc bez plakietki", () => {
  it("rola domyślna nie daje plakietki", () => {
    expect(rosterBadgeRole("member")).toBeNull();
  });

  it.each(["lead", "moderator", "observer"])("rola `%s` daje plakietkę z tą rolą", (role) => {
    expect(rosterBadgeRole(role)).toBe(role);
  });

  it.each([
    ["wartość spoza słownika", "curator"],
    ["pusty ciąg", ""],
    ["null", null],
  ])(
    "%s daje plakietkę ze stanem domyślnym - odwzorowanie trasy 1:1, opisane w module",
    (_opis, value: string | null) => {
      // Warunek patrzy na wartość SUROWĄ, a etykieta powstaje z zawężonej -
      // dokładnie tak zachowywał się JSX trasy przed wyprowadzeniem. Test
      // pilnuje, żeby wyprowadzenie tego nie „naprawiło” po cichu.
      expect(rosterBadgeRole(value)).toBe("member");
    },
  );
});

describe("role do wyboru - droplista nie oferuje wyboru, który baza odrzuci", () => {
  it("personel dostaje cały słownik, razem z rolami podwyższonymi", () => {
    expect(assignableClubRoles(true)).toEqual(CLUB_MEMBER_ROLES);
  });

  it("prowadzący dostaje DWIE role i ani jednej podwyższonej", () => {
    const roles = assignableClubRoles(false);
    expect(roles).toEqual(["member", "observer"]);
    expect(roles).not.toContain("lead");
    expect(roles).not.toContain("moderator");
  });
});

// --- sygnał obecności -------------------------------------------------------

describe("zbiór osób z kropką obecności", () => {
  const faces: ClubRosterPresenceFace[] = [
    { userId: CLUB_IDS.member, isActive: true },
    { userId: CLUB_IDS.lead, isActive: false },
    { userId: CLUB_IDS.me, isActive: true },
  ];

  it("bierze WYŁĄCZNIE osoby aktywne w ostatniej dobie", () => {
    const ids = activeMemberIds({ faces });
    expect([...ids].sort()).toEqual([CLUB_IDS.member, CLUB_IDS.me].sort());
    expect(ids.has(CLUB_IDS.lead)).toBe(false);
  });

  it.each([
    ["zapytanie w locie (undefined)", undefined],
    ["brak sygnału (null)", null],
    ["sygnał bez twarzy", { faces: [] }],
    ["twarze jako null", { faces: null }],
  ])(
    "%s daje zbiór PUSTY - lista bez kropek, a nie lista bez wierszy",
    (_opis, signal: { faces?: readonly ClubRosterPresenceFace[] | null } | null | undefined) => {
      expect(activeMemberIds(signal).size).toBe(0);
    },
  );

  it("ta sama osoba w puli dwa razy liczy się raz", () => {
    const ids = activeMemberIds({
      faces: [
        { userId: CLUB_IDS.member, isActive: true },
        { userId: CLUB_IDS.member, isActive: true },
      ],
    });
    expect(ids.size).toBe(1);
  });
});

// --- linia stanowiska -------------------------------------------------------

describe("linia stanowiska pod nazwiskiem", () => {
  it.each([
    ["stanowisko i firma", "Analityk", "NES", "Analityk - NES"],
    ["tylko stanowisko (firma null)", "Analityk", null, "Analityk"],
    ["tylko firma (stanowisko null)", null, "NES", "NES"],
    ["tylko firma (stanowisko puste)", "", "NES", "NES"],
    ["tylko stanowisko (firma pusta)", "Analityk", "", "Analityk"],
    ["obie kolumny obecne, ale puste", "", "", ""],
  ])("%s daje linię %#", (_opis, job: string | null, company: string | null, expected: string) => {
    expect(rosterIdentityLine(job, company)).toBe(expected);
  });

  it.each([
    ["obie kolumny null", null, null],
    ["obie kolumny nieobecne", undefined, undefined],
    ["null i undefined", null, undefined],
  ])(
    "%s znaczy „nie rysuj akapitu” (null)",
    (_opis, job: string | null | undefined, company: string | null | undefined) => {
      expect(rosterIdentityLine(job, company)).toBeNull();
    },
  );

  it("separator jest JEDEN, także gdy część wartości jest pusta", () => {
    expect(rosterIdentityLine("Analityk", "")).not.toContain(" - ");
  });
});

// --- odnośnik do profilu ----------------------------------------------------

describe("odnośnik do profilu - katalog klubu nie obchodzi widoczności profilu", () => {
  it("osoba z profilem publicznym dostaje slug", () => {
    expect(rosterProfileSlug("anna-nowak")).toBe("anna-nowak");
  });

  it.each([
    ["pusty ciąg z RPC", ""],
    ["null", null],
    ["undefined", undefined],
  ])("%s znaczy wiersz BEZ odnośnika", (_opis, slug: string | null | undefined) => {
    expect(rosterProfileSlug(slug)).toBeNull();
  });
});

// --- prawo zmiany roli w wierszu -------------------------------------------

describe("prawo zmiany roli w wierszu - wyjątek na siebie", () => {
  it("prowadzący zmienia rolę KOMU INNEMU", () => {
    expect(isRosterRowEditable(true, CLUB_IDS.member, CLUB_IDS.me)).toBe(true);
  });

  it("prowadzący NIE zmienia własnej roli - to jedyna zmiana, którą traci dostęp", () => {
    expect(isRosterRowEditable(true, CLUB_IDS.me, CLUB_IDS.me)).toBe(false);
  });

  it.each([
    ["czytelnik bez prawa zarządzania, cudzy wiersz", CLUB_IDS.member, CLUB_IDS.me],
    ["czytelnik bez prawa zarządzania, własny wiersz", CLUB_IDS.me, CLUB_IDS.me],
    ["gość bez sesji", CLUB_IDS.member, null],
  ])("%s nie dostaje kontrolki", (_opis, rowUserId: string, viewerId: string | null) => {
    expect(isRosterRowEditable(false, rowUserId, viewerId)).toBe(false);
  });

  it("prowadzący bez odczytanej sesji widzi kontrolkę przy każdym wierszu", () => {
    // `viewerId === null` nie jest tożsamością, więc żaden wiersz nie jest
    // „mój” - a `canManage` przyszło z bazy dla konkretnej sesji.
    expect(isRosterRowEditable(true, CLUB_IDS.me, null)).toBe(true);
    expect(isRosterRowEditable(true, CLUB_IDS.me, undefined)).toBe(true);
  });
});

// --- złożenie wiersza na widok ---------------------------------------------

describe("złożenie składu na widok", () => {
  const context = {
    activeIds: new Set([CLUB_IDS.member]),
    canManage: true,
    viewerId: CLUB_IDS.me,
  };

  it("wiersz pełny dostaje wszystkie pola deskryptora", () => {
    const [view] = toClubRosterRows([clubMemberRow()], context);
    expect(view).toEqual({
      userId: CLUB_IDS.member,
      name: "Anna Nowak",
      avatarUrl: "",
      active: true,
      verified: true,
      role: "member",
      badgeRole: null,
      identity: "Analityk - NES",
      joinedAt: CLUB_BASE_ISO,
      profileSlug: "anna-nowak",
      editable: true,
    });
  });

  it("wiersz CZĘŚCIOWY (bez awatara, stanowiska, firmy i profilu) nie wywraca składu", () => {
    const [view] = toClubRosterRows(
      [clubMemberRow({ avatar_url: "", job_title: "", current_company: "", slug: "" })],
      context,
    );
    expect(view.avatarUrl).toBe("");
    expect(view.profileSlug).toBeNull();
    expect(view.identity).toBe("");
  });

  it("kropka obecności gaśnie przy osobie spoza zbioru aktywnych", () => {
    const [view] = toClubRosterRows([clubMemberRow({ user_id: CLUB_IDS.lead })], {
      ...context,
      activeIds: new Set([CLUB_IDS.member]),
    });
    expect(view.active).toBe(false);
  });

  it("rola podwyższona daje plakietkę, a wartość spoza słownika trafia do kontrolki jako `member`", () => {
    const [lead, unknown] = toClubRosterRows(
      [
        clubMemberRow({ user_id: CLUB_IDS.lead, role: "lead" }),
        clubMemberRow({ user_id: CLUB_IDS.me, role: "curator" }),
      ],
      context,
    );
    expect(lead.badgeRole).toBe("lead");
    expect(lead.role).toBe("lead");
    expect(unknown.role).toBe("member");
  });

  it("własny wiersz prowadzącego jest bez kontrolki, cudzy z kontrolką", () => {
    const [mine, other] = toClubRosterRows(
      [clubMemberRow({ user_id: CLUB_IDS.me }), clubMemberRow({ user_id: CLUB_IDS.member })],
      context,
    );
    expect(mine.editable).toBe(false);
    expect(other.editable).toBe(true);
  });

  it("bez prawa zarządzania ŻADEN wiersz nie ma kontrolki", () => {
    const views = toClubRosterRows(
      [clubMemberRow({ user_id: CLUB_IDS.member }), clubMemberRow({ user_id: CLUB_IDS.lead })],
      { ...context, canManage: false },
    );
    expect(views.map((view) => view.editable)).toEqual([false, false]);
  });

  it("pusty skład daje pustą tablicę, a nie wiersz-zaślepkę", () => {
    expect(toClubRosterRows([], context)).toEqual([]);
  });

  it("kolejność wierszy z RPC zostaje nietknięta - porządek jest decyzją bazy", () => {
    const views = toClubRosterRows(
      [
        clubMemberRow({ user_id: CLUB_IDS.lead, display_name: "Zofia" }),
        clubMemberRow({ user_id: CLUB_IDS.member, display_name: "Anna" }),
      ],
      context,
    );
    expect(views.map((view) => view.name)).toEqual(["Zofia", "Anna"]);
  });
});

// --- ucięcie strony --------------------------------------------------------

describe("komunikat o ucięciu strony - granica i po jednym z każdej strony", () => {
  it.each([
    ["pełna strona bez reszty", CLUB_ROSTER_PAGE_SIZE, CLUB_ROSTER_PAGE_SIZE],
    ["jedna osoba mniej niż strona", CLUB_ROSTER_PAGE_SIZE - 1, CLUB_ROSTER_PAGE_SIZE - 1],
    ["pusty skład", 0, 0],
    ["rozjazd denormalizacji (licznik mniejszy od wierszy)", 60, 59],
  ])("%s: bez komunikatu", (_opis, shown: number, total: number) => {
    expect(rosterTruncation(shown, total)).toBeNull();
  });

  it.each([
    ["o jedną osobę za dużo", CLUB_ROSTER_PAGE_SIZE, CLUB_ROSTER_PAGE_SIZE + 1],
    ["dwie strony", CLUB_ROSTER_PAGE_SIZE, 121],
    ["klub z jedną osobą przy pustej stronie", 0, 1],
  ])("%s: komunikat z liczbami do podstawienia", (_opis, shown: number, total: number) => {
    expect(rosterTruncation(shown, total)).toEqual({ shown, total });
  });
});
