// Reguły składu klubu w panelu - tabela przypadków bez Reacta.
//
// CO TEN PLIK DOWODZI.
//   1. ZAWĘŻENIE ENUMÓW degraduje W DÓŁ: wartość spoza słownika (nowsza
//      migracja, literówka) nie może wybrać się sama na rolę podwyższoną ani
//      wywrócić listy.
//   2. FILTR STATUSU jest ODWRACALNY i rozróżnia „wszystkie” od „active” -
//      to rozróżnienie decyduje, czy wiersze `invited` i `pending` są
//      w panelu w ogóle osiągalne.
//   3. GRANICE STRONICOWANIA trafiają dokładnie: pusty zbiór, dokładnie pełna
//      strona, pierwsza i ostatnia strona, numer strony spoza zakresu.
//      `total_count` jedzie w KAŻDYM wierszu RPC i jest jedynym źródłem
//      licznika - długość tablicy zatrzymuje się na rozmiarze strony.
//   4. ZAZNACZENIE jest niemutowalne, dotyczy WIDOCZNEJ strony i nie gubi
//      wyborów z innych stron.
//   5. CZTERY ŁADUNKI MUTACJI wiozą dokładnie to, co trzeba: zatwierdzenie
//      ZACHOWUJE rolę z prośby, zmiana roli ZACHOWUJE status, kadencja
//      rozróżnia „nie przysłałem terminu” od „zdejmij termin”.
//   6. BRAMKI PUSTKI (pusty picker, puste zaznaczenie, pusta data) dają `null`,
//      czyli „nie wysyłaj” - odmowa zapada PRZED zapytaniem do bazy.
//   7. DESKRYPTOR POTWIERDZENIA rozróżnia odrzucenie prośby od usunięcia
//      członka: to dwie różne konsekwencje, więc dwa różne zdania.
//   8. KADENCJA ma domkniętą granicę wygaśnięcia i znosi pustkę w obu
//      postaciach, w jakich RPC potrafi ją oddać (`null` i pusty napis).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) `narrowClubEnum` - własny test w
// `clubTypes.test.ts`; tutaj sprawdzamy KIERUNEK degradacji dla dwóch
// konkretnych słowników, nie mechanikę pomocnika. (2) Reguł składu
// PUBLICZNEGO (`memberRoster.ts`) - to inna powierzchnia z inną bramką
// widoczności. (3) Sklejenia z mutacjami i renderu - `ClubMembersTab.test.tsx`.
import { describe, expect, it } from "vitest";
import {
  ADMIN_MEMBER_PAGE_SIZE,
  ADMIN_MEMBER_STATUS_ANY,
  addMemberPayload,
  adminMemberPaging,
  adminMemberStatusValue,
  adminMemberWindow,
  approveMemberPayload,
  areAllMembersSelected,
  bulkMemberRolePayload,
  changeMemberRolePayload,
  hasMemberTenure,
  memberRemovalPrompt,
  memberTenure,
  memberTenurePayload,
  toAdminMemberRequestView,
  toAdminMemberRole,
  toAdminMemberRowView,
  toAdminMemberStatus,
  toAdminMemberStatusFilter,
  toggleAllMembersSelection,
  toggleMemberSelection,
} from "../adminMemberRoster";
import { CLUB_MEMBER_ROLES, CLUB_MEMBER_STATUSES } from "../types";
import { CLUB_BASE_ISO, CLUB_IDS, clubIsoOffset, clubMemberRow } from "@/test/clubs/fixtures";

describe("zawężenie roli i statusu", () => {
  it("przepuszcza każdą wartość ze słownika bez zmiany", () => {
    for (const role of CLUB_MEMBER_ROLES) expect(toAdminMemberRole(role)).toBe(role);
    for (const status of CLUB_MEMBER_STATUSES) expect(toAdminMemberStatus(status)).toBe(status);
  });

  it("wartość spoza słownika degraduje W DÓŁ, nigdy w górę", () => {
    expect(toAdminMemberRole("chairman")).toBe("member");
    expect(toAdminMemberRole("")).toBe("member");
    expect(toAdminMemberRole(null)).toBe("member");
    expect(toAdminMemberStatus("suspended")).toBe("active");
    expect(toAdminMemberStatus(null)).toBe("active");
  });
});

describe("filtr statusu w dropliście", () => {
  it("pozycja „wszystkie” daje null, czyli BRAK filtra po stronie RPC", () => {
    expect(toAdminMemberStatusFilter(ADMIN_MEMBER_STATUS_ANY)).toBeNull();
    expect(adminMemberStatusValue(null)).toBe(ADMIN_MEMBER_STATUS_ANY);
  });

  it("każdy status słownika przechodzi w obie strony", () => {
    for (const status of CLUB_MEMBER_STATUSES) {
      expect(toAdminMemberStatusFilter(status)).toBe(status);
      expect(adminMemberStatusValue(status)).toBe(status);
    }
  });

  it("wartość nieznana w dropliście schodzi do stanu domyślnego, a nie do braku filtra", () => {
    expect(toAdminMemberStatusFilter("zombie")).toBe("active");
  });
});

describe("okno strony", () => {
  it("pierwsza strona nie ma przesunięcia", () => {
    expect(adminMemberWindow(0)).toEqual({ limit: ADMIN_MEMBER_PAGE_SIZE, offset: 0 });
  });

  it("kolejne strony przesuwają się o pełny rozmiar strony", () => {
    expect(adminMemberWindow(1).offset).toBe(ADMIN_MEMBER_PAGE_SIZE);
    expect(adminMemberWindow(3).offset).toBe(3 * ADMIN_MEMBER_PAGE_SIZE);
  });

  it("numer spoza zakresu daje PIERWSZĄ stronę, nie ujemne przesunięcie", () => {
    expect(adminMemberWindow(-2).offset).toBe(0);
    expect(adminMemberWindow(Number.NaN).offset).toBe(0);
    expect(adminMemberWindow(1.7).offset).toBe(ADMIN_MEMBER_PAGE_SIZE);
  });
});

describe("granice stronicowania z total_count", () => {
  it("pusty zbiór ma JEDNĄ stronę i zerowe indeksy", () => {
    expect(adminMemberPaging({ page: 0, shown: 0, total: 0 })).toEqual({
      page: 0,
      pageCount: 1,
      shown: 0,
      total: 0,
      firstIndex: 0,
      lastIndex: 0,
      isFirstPage: true,
      isLastPage: true,
      hasMore: false,
    });
  });

  it("DOKŁADNIE PEŁNA strona nie zapowiada następnej", () => {
    const paging = adminMemberPaging({
      page: 0,
      shown: ADMIN_MEMBER_PAGE_SIZE,
      total: ADMIN_MEMBER_PAGE_SIZE,
    });

    expect(paging.pageCount).toBe(1);
    expect(paging.firstIndex).toBe(1);
    expect(paging.lastIndex).toBe(ADMIN_MEMBER_PAGE_SIZE);
    expect(paging.isFirstPage).toBe(true);
    expect(paging.isLastPage).toBe(true);
    expect(paging.hasMore).toBe(false);
  });

  it("jeden wiersz ponad stronę otwiera drugą stronę", () => {
    const paging = adminMemberPaging({
      page: 0,
      shown: ADMIN_MEMBER_PAGE_SIZE,
      total: ADMIN_MEMBER_PAGE_SIZE + 1,
    });

    expect(paging.pageCount).toBe(2);
    expect(paging.isLastPage).toBe(false);
    expect(paging.hasMore).toBe(true);
  });

  it("OSTATNIA strona liczy indeksy od przesunięcia i nie zapowiada dalszych", () => {
    const paging = adminMemberPaging({ page: 2, shown: 37, total: 137 });

    expect(paging.page).toBe(2);
    expect(paging.pageCount).toBe(3);
    expect(paging.firstIndex).toBe(101);
    expect(paging.lastIndex).toBe(137);
    expect(paging.isFirstPage).toBe(false);
    expect(paging.isLastPage).toBe(true);
    expect(paging.hasMore).toBe(false);
  });

  it("numer strony poza zakresem jest PRZYCINANY - total mógł zmaleć między odczytami", () => {
    expect(adminMemberPaging({ page: 9, shown: 1, total: 51 }).page).toBe(1);
    expect(adminMemberPaging({ page: -3, shown: 1, total: 51 }).page).toBe(0);
    expect(adminMemberPaging({ page: Number.NaN, shown: 1, total: 51 }).page).toBe(0);
  });

  it("liczby ujemne w odpowiedzi znoszą się do zera, a nie do ujemnych indeksów", () => {
    const paging = adminMemberPaging({ page: 0, shown: -5, total: -9 });

    expect(paging.shown).toBe(0);
    expect(paging.total).toBe(0);
    expect(paging.firstIndex).toBe(0);
    expect(paging.hasMore).toBe(false);
  });

  it("licznik z total_count jest większy niż strona i to WŁAŚNIE ma być widać", () => {
    const paging = adminMemberPaging({ page: 0, shown: 50, total: 137 });

    expect(paging.total).toBe(137);
    expect(paging.shown).toBe(50);
    expect(paging.hasMore).toBe(true);
  });
});

describe("zaznaczenie wierszy", () => {
  it("przełączenie dodaje i zdejmuje, zawsze w NOWYM zbiorze", () => {
    const pusty: ReadonlySet<string> = new Set();
    const zJednym = toggleMemberSelection(pusty, "u1");

    expect([...zJednym]).toEqual(["u1"]);
    expect([...pusty]).toEqual([]);
    expect([...toggleMemberSelection(zJednym, "u1")]).toEqual([]);
  });

  it("pusta strona NIE jest „zaznaczona cała”", () => {
    expect(areAllMembersSelected(new Set(["u1"]), [])).toBe(false);
    expect(areAllMembersSelected(new Set(["u1", "u2"]), ["u1", "u2"])).toBe(true);
    expect(areAllMembersSelected(new Set(["u1"]), ["u1", "u2"])).toBe(false);
  });

  it("„zaznacz wszystko” obejmuje TYLKO widoczne i nie gubi innych stron", () => {
    const stan = new Set(["z-innej-strony"]);

    const poZaznaczeniu = toggleAllMembersSelection(stan, ["u1", "u2"]);
    expect([...poZaznaczeniu].sort()).toEqual(["u1", "u2", "z-innej-strony"]);

    const poOdznaczeniu = toggleAllMembersSelection(poZaznaczeniu, ["u1", "u2"]);
    expect([...poOdznaczeniu]).toEqual(["z-innej-strony"]);
  });
});

describe("ładunki mutacji", () => {
  it("pusty picker NIE daje ładunku - odmowa zapada przed zapytaniem", () => {
    expect(addMemberPayload("")).toBeNull();
    expect(addMemberPayload(CLUB_IDS.member)).toEqual({
      userId: CLUB_IDS.member,
      role: "member",
      status: "active",
    });
  });

  it("zatwierdzenie prośby ZACHOWUJE rolę z wiersza", () => {
    expect(approveMemberPayload(clubMemberRow({ role: "moderator", status: "pending" }))).toEqual({
      userId: CLUB_IDS.member,
      role: "moderator",
      status: "active",
    });
  });

  it("zatwierdzenie z rolą spoza słownika nie podnosi uprawnień", () => {
    expect(approveMemberPayload(clubMemberRow({ role: "chairman" })).role).toBe("member");
  });

  it("zmiana roli ZACHOWUJE status - nie jest zatwierdzeniem prośby", () => {
    expect(changeMemberRolePayload(clubMemberRow({ status: "pending" }), "moderator")).toEqual({
      userId: CLUB_IDS.member,
      role: "moderator",
      status: "pending",
    });
  });

  it("puste zaznaczenie NIE daje ładunku operacji masowej", () => {
    expect(bulkMemberRolePayload(new Set(), "moderator")).toBeNull();
    expect(bulkMemberRolePayload(new Set(["u1", "u2"]), "observer")).toEqual({
      userIds: ["u1", "u2"],
      role: "observer",
    });
  });
});

describe("kadencja roli", () => {
  const wiersz = clubMemberRow({ role: "moderator", status: "active" });

  it("zapis bez daty i bez czyszczenia NIE leci", () => {
    expect(memberTenurePayload(wiersz, "", false)).toBeNull();
    expect(memberTenurePayload(wiersz, "   ", false)).toBeNull();
  });

  it("czyszczenie jedzie z JAWNĄ flagą, bo brak pola znaczy „nie ruszaj”", () => {
    expect(memberTenurePayload(wiersz, "", true)).toEqual({
      userId: CLUB_IDS.member,
      role: "moderator",
      status: "active",
      roleExpiresAt: null,
      clearRoleExpiry: true,
    });
  });

  it("data z pola przechodzi na znacznik ISO i nie czyści kadencji", () => {
    expect(memberTenurePayload(wiersz, "2027-01-31", false)).toEqual({
      userId: CLUB_IDS.member,
      role: "moderator",
      status: "active",
      roleExpiresAt: "2027-01-31T00:00:00.000Z",
      clearRoleExpiry: false,
    });
  });

  // BŁĄD ZASTANY, NIE NAPRAWIONY W TEJ ZMIANIE. Pole `type="date"` degraduje
  // do zwykłego tekstu w przeglądarkach bez obsługi tego typu, więc do reguły
  // potrafi dojść napis, z którego nie da się przeczytać daty - a wtedy
  // `new Date(value).toISOString()` rzuca RangeError wewnątrz handlera
  // kliknięcia i gasi cały ekran. Poprawka to jedna gałąź `Number.isNaN`,
  // ale zmienia zachowanie, więc nie wchodzi razem z refaktorem.
  it.fails("kadencja z niepoprawną datą powinna dać brak akcji, a rzuca wyjątkiem", () => {
    expect(() => memberTenurePayload(wiersz, "kiedyś-w-marcu", false)).not.toThrow();
  });

  it("brak terminu znaczy brak kadencji w OBU postaciach pustki z RPC", () => {
    expect(memberTenure(null, 0)).toEqual({ kind: "none" });
    expect(memberTenure("", 0)).toEqual({ kind: "none" });
    expect(memberTenure("nie-data", 0)).toEqual({ kind: "none" });
    expect(hasMemberTenure(null)).toBe(false);
    expect(hasMemberTenure("")).toBe(false);
    expect(hasMemberTenure(CLUB_BASE_ISO)).toBe(true);
  });

  it("granica wygaśnięcia jest DOMKNIĘTA - termin równy teraz jest już wygaszony", () => {
    const teraz = new Date(CLUB_BASE_ISO).getTime();

    expect(memberTenure(CLUB_BASE_ISO, teraz)).toEqual({ kind: "expired", at: CLUB_BASE_ISO });
    expect(memberTenure(clubIsoOffset(-1), teraz).kind).toBe("expired");
    expect(memberTenure(clubIsoOffset(1), teraz)).toEqual({
      kind: "until",
      at: clubIsoOffset(1),
    });
  });
});

describe("deskryptor potwierdzenia", () => {
  it("odrzucenie prośby i usunięcie członka to DWA różne zdania", () => {
    const wiersz = clubMemberRow({ display_name: "Anna Nowak" });

    expect(memberRemovalPrompt(wiersz, true)).toEqual({
      titleKey: "adminClubs.members.rejectConfirmTitle",
      titleParams: { name: "Anna Nowak" },
      bodyKey: "adminClubs.members.rejectConfirmBody",
      successKey: "adminClubs.members.rejected",
    });
    expect(memberRemovalPrompt(wiersz, false)).toEqual({
      titleKey: "adminClubs.members.removeConfirmTitle",
      titleParams: { name: "Anna Nowak" },
      bodyKey: "adminClubs.members.removeConfirmBody",
      successKey: "adminClubs.members.removed",
    });
  });
});

describe("mapowanie wiersza na widok", () => {
  it("dane PEŁNE przechodzą z zawężonymi enumami", () => {
    expect(
      toAdminMemberRowView(
        clubMemberRow({
          role: "moderator",
          status: "pending",
          job_title: "Analityk",
          role_expires_at: clubIsoOffset(60),
        }),
      ),
    ).toEqual({
      userId: CLUB_IDS.member,
      displayName: "Anna Nowak",
      jobTitle: "Analityk",
      role: "moderator",
      status: "pending",
      joinedAt: CLUB_BASE_ISO,
      expiresAt: clubIsoOffset(60),
      canApprove: true,
    });
  });

  it("dane CZĘŚCIOWE: puste pola opcjonalne dają null, nie pusty napis", () => {
    const widok = toAdminMemberRowView(
      clubMemberRow({ job_title: "", role_expires_at: "", status: "active" }),
    );

    expect(widok.jobTitle).toBeNull();
    expect(widok.expiresAt).toBeNull();
    expect(widok.canApprove).toBe(false);
  });

  it("przycisk zatwierdzenia jest TYLKO przy prośbie", () => {
    for (const status of CLUB_MEMBER_STATUSES) {
      expect(toAdminMemberRowView(clubMemberRow({ status })).canApprove).toBe(status === "pending");
    }
  });
});

describe("mapowanie prośby na pozycję kolejki", () => {
  it("linia pod nazwiskiem mówi ROLĘ kluczem i18n oraz firmę, jeśli jest", () => {
    expect(toAdminMemberRequestView(clubMemberRow({ role: "moderator" }))).toEqual({
      userId: CLUB_IDS.member,
      displayName: "Anna Nowak",
      roleKey: "club.role.moderator",
      company: "NES",
    });
  });

  it("brak firmy daje null - w JSX-ie nie ma czego dokleić", () => {
    expect(toAdminMemberRequestView(clubMemberRow({ current_company: "" })).company).toBeNull();
  });
});
