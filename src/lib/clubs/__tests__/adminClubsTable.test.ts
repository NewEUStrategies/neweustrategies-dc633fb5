// Reguły wiersza tabeli klubów - tabela przypadków na czystych funkcjach.
//
// CO TEN PLIK DOWODZI.
//   1. DEGRADACJĘ KOLUMNY CHECK-OWEJ na trzech klasach wejścia: wartość ze
//      słownika, wartość SPOZA słownika (tak wygląda `status: "published"`
//      w atrapie `adminClubRow()` - kolumna z innej migracji) i pusty napis,
//      którym RPC reprezentuje pustkę. Nagłówek `atoms/ClubBadges.tsx` mówi
//      wprost, że dowód tej degradacji leży TUTAJ, bo do samego znacznika
//      wartość spoza zbioru nie dochodzi.
//   2. KIERUNEK fallbacku: nieznany status czyta się jako `draft`, a nieznana
//      widoczność jako `members` - nigdy jako coś SZERSZEGO niż zapisano
//      w bazie. Pomyłka w drugą stronę pokazywałaby klub jako publiczny.
//   3. KRESKĘ w pustym miejscu: brak prowadzących i brak aktywności mają znak,
//      bo puste miejsce w tabeli czyta się jak błąd wczytywania.
//   4. DATĘ liczoną od `CLUB_BASE_ISO`, z jawną różnicą PL/EN, oraz obie
//      gałęzie pustki: pusty napis i napis, którego nie da się sparsować
//      (`new Date("")` to `Invalid Date`, a `formatDate` zwraca wtedy "").
//   5. PROJEKCJĘ wiersza: nazwa sięga po drugą kolumnę językową, gdy pierwsza
//      jest pusta, a lista pusta wchodzi i wychodzi pusta.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) `narrowClubEnum` i `pickLocalized` mają
// własne testy - tu sprawdzamy DOBÓR słownika i fallbacku, nie mechanikę
// zawężania. (2) `formatDate` z `lib/i18n/format` też ma swój test; tu jedzie
// tylko decyzja o formacie kolumny i o kresce. (3) Znacznika ani układu tabeli
// ten plik nie dotyka - to `ClubTableRow.test.tsx` i `ClubsTable.test.tsx`.
import { describe, expect, it } from "vitest";
import {
  CLUB_TABLE_EMPTY_CELL,
  clubPublicHref,
  clubTableLeads,
  clubTableStatus,
  clubTableVisibility,
  clubsTableRowView,
  clubsTableRowViews,
  formatClubLastActivity,
} from "@/lib/clubs/adminClubsTable";
import { CLUB_STATUSES, CLUB_VISIBILITIES } from "@/lib/clubs/types";
import { CLUB_BASE_ISO, CLUB_IDS, adminClubRow, clubIsoOffset } from "@/test/clubs/fixtures";

describe("zawężenie kolumn CHECK-owych", () => {
  it.each(CLUB_STATUSES)("status ze słownika zostaje sobą: %s", (status) => {
    expect(clubTableStatus(status)).toBe(status);
  });

  it.each(CLUB_VISIBILITIES)("widoczność ze słownika zostaje sobą: %s", (visibility) => {
    expect(clubTableVisibility(visibility)).toBe(visibility);
  });

  it("status spoza słownika degraduje się do wersji roboczej", () => {
    // „published" to realny stan z innej migracji - dokładnie taki jedzie
    // w atrapie wiersza. Bursztyn („ktoś musi na to spojrzeć") jest tu
    // bezpieczniejszy niż zielone „aktywny".
    expect(clubTableStatus("published")).toBe("draft");
    expect(clubTableStatus("")).toBe("draft");
    expect(clubTableStatus(null)).toBe("draft");
  });

  it("widoczność spoza słownika NIE degraduje się do publicznej", () => {
    expect(clubTableVisibility("world")).toBe("members");
    expect(clubTableVisibility("")).toBe("members");
    expect(clubTableVisibility(null)).toBe("members");
  });
});

describe("data ostatniej aktywności", () => {
  it("format kolumny zależy od języka interfejsu", () => {
    expect(formatClubLastActivity(CLUB_BASE_ISO, "pl")).toContain("sie");
    expect(formatClubLastActivity(CLUB_BASE_ISO, "en")).toContain("Aug");
    expect(formatClubLastActivity(CLUB_BASE_ISO, "pl")).toContain("2026");
  });

  it("surowy znacznik z i18next jest normalizowany bez pomocy komponentu", () => {
    // `en-US` to realna wartość `i18n.language` - komponent NIE tłumaczy jej
    // na "pl"/"en", robi to `lib/i18n/format`.
    expect(formatClubLastActivity(CLUB_BASE_ISO, "en-US")).toContain("Aug");
    expect(formatClubLastActivity(CLUB_BASE_ISO, undefined)).toContain("sie");
  });

  it("przesunięcie o minuty nie gubi dnia", () => {
    expect(formatClubLastActivity(clubIsoOffset(90), "pl")).toContain("18");
  });

  it.each([
    ["pusty napis z RPC", ""],
    ["brak wartości", null],
    ["napis, którego nie da się sparsować", "kiedyś"],
  ])("brak aktywności ma znak, nie pustkę: %s", (_opis, value) => {
    expect(formatClubLastActivity(value, "pl")).toBe(CLUB_TABLE_EMPTY_CELL);
  });
});

describe("prowadzący i adres publiczny", () => {
  it("prowadzący jadą jednym napisem po przecinku", () => {
    expect(clubTableLeads(["Jan Kowalski", "Anna Nowak"])).toBe("Jan Kowalski, Anna Nowak");
  });

  it("brak prowadzących ma znak", () => {
    expect(clubTableLeads([])).toBe(CLUB_TABLE_EMPTY_CELL);
    expect(clubTableLeads(null)).toBe(CLUB_TABLE_EMPTY_CELL);
  });

  it("adres podglądu publicznego jest zbudowany ze sluga", () => {
    expect(clubPublicHref("klub-energetyczny")).toBe("/club/klub-energetyczny");
  });
});

describe("projekcja wiersza", () => {
  it("pełny wiersz przechodzi na widok z zawężonymi kolumnami", () => {
    const view = clubsTableRowView(
      adminClubRow({ status: "active", visibility: "private", pending_count: 3 }),
      "pl",
    );

    expect(view).toMatchObject({
      id: CLUB_IDS.club,
      name: "Klub energetyczny",
      slug: "klub-energetyczny",
      slugPath: "/klub-energetyczny",
      publicHref: "/club/klub-energetyczny",
      status: "active",
      visibility: "private",
      groupCount: 3,
      memberCount: 42,
      threadCount: 12,
      pendingCount: 3,
      hasPending: true,
      leads: "Jan Kowalski",
    });
    expect(view.lastActivity).toContain("2026");
  });

  it("wiersz CZĘŚCIOWY: brak nazwy w języku interfejsu sięga po drugą kolumnę", () => {
    const view = clubsTableRowView(adminClubRow({ name_pl: "   " }), "pl");

    expect(view.name).toBe("Energy club");
  });

  it("wiersz UBOGI: zero zgłoszeń, zero prowadzących, brak aktywności", () => {
    const view = clubsTableRowView(
      adminClubRow({ pending_count: 0, lead_names: [], last_activity_at: "" }),
      "pl",
    );

    expect(view.hasPending).toBe(false);
    expect(view.leads).toBe(CLUB_TABLE_EMPTY_CELL);
    expect(view.lastActivity).toBe(CLUB_TABLE_EMPTY_CELL);
  });

  it("angielski interfejs bierze nazwę z kolumny angielskiej", () => {
    expect(clubsTableRowView(adminClubRow(), "en").name).toBe("Energy club");
  });

  it("lista zachowuje kolejność wejściową, a pusta zostaje pusta", () => {
    const rows = [
      adminClubRow({ id: CLUB_IDS.club, slug: "pierwszy" }),
      adminClubRow({ id: CLUB_IDS.otherClub, slug: "drugi" }),
    ];

    expect(clubsTableRowViews(rows, "pl").map((view) => view.slug)).toEqual(["pierwszy", "drugi"]);
    expect(clubsTableRowViews([], "pl")).toEqual([]);
  });
});
