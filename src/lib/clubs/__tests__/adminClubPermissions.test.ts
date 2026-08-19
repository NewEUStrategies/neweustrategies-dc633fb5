// Składanie zakładki „Uprawnienia" - czyste funkcje macierzy i podglądu.
//
// CO TEN PLIK DOWODZI.
//   1. CZTERY STANY PODGLĄDU I ICH KOLEJNOŚĆ. „Wybierz osobę" wygrywa z „w
//      locie", bo zapytanie bez osoby nie startuje (`enabled`), więc szkielet
//      wisiałby na ekranie bez końca. Brak danych PRZY wybranej osobie
//      i zakończonym zapytaniu to AWARIA RPC, a nie pustka - i ma osobny stan,
//      bo w JSX-ie było to bezimienne ramię `: null`.
//   2. PUSTY WYBÓR NIE PYTA BAZY: `capabilityPreviewUserId("")` daje
//      `undefined`, czyli `enabled: false` w zapytaniu podglądu.
//   3. PODGLĄD CZYTA RPC, NIE MACIERZ. Zdolności w podglądzie biorą się
//      z odpowiedzi bazy - macierz jest dokumentacją i gdyby się rozjechały,
//      prawdą jest baza (nagłówek `capabilityMatrix.ts`).
//   4. BRAK POWODU TO TEŻ ODPOWIEDŹ: `reason === null` wraca jako `null`,
//      a nie jako klucz `club.reason.` bez ogona.
//   5. MACIERZ przepisana na wiersze zachowuje kolejność i pełny rozmiar
//      (9 zdolności x 8 ról) - widok jej nie sortuje, bo to ONA jest
//      dokumentacją migracji.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) ZAWARTOŚCI macierzy - każda komórka
// i inwariant „super_admin przechodzi wszystko, co admin" mają test
// w `capabilityMatrix.test.ts`. Tutaj sprawdzamy KSZTAŁT projekcji, nie
// wartości. (2) `readCapability` jako mapowania pól - też tam. (3) Ikony,
// znacznika i układu tabeli - to `ClubTableCapabilityCell.test.tsx`
// i `ClubPermissionsTab.test.tsx`.
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_CELL_LABEL,
  capabilityPreviewRows,
  capabilityPreviewState,
  capabilityPreviewSummary,
  capabilityPreviewUserId,
  clubCapabilityMatrixRows,
} from "@/lib/clubs/adminClubPermissions";
import { CAPABILITY_KEYS, CAPABILITY_ROLES } from "@/lib/clubs/capabilityMatrix";
import { NO_CLUB_CAPABILITIES, type ClubCapabilities } from "@/lib/clubs/types";
import { CLUB_IDS } from "@/test/clubs/fixtures";

/** Zdolności z RPC - domyślnie wszystko zamknięte, jak `NO_CLUB_CAPABILITIES`. */
function caps(overrides: Partial<ClubCapabilities> = {}): ClubCapabilities {
  return { ...NO_CLUB_CAPABILITIES, ...overrides };
}

describe("macierz przepisana na wiersze", () => {
  it("ma wiersz na każdą zdolność i komórkę na każdą rolę", () => {
    const rows = clubCapabilityMatrixRows();

    expect(rows.map((row) => row.key)).toEqual([...CAPABILITY_KEYS]);
    for (const row of rows) {
      expect(row.cells.map((cell) => cell.role)).toEqual([...CAPABILITY_ROLES]);
    }
  });

  it("komórka niesie wartość z macierzy, nie z podglądu", () => {
    const rows = clubCapabilityMatrixRows();
    const manage = rows.find((row) => row.key === "can_manage");

    // Struktura należy wyłącznie do staffu - lead prowadzi klub, ale go nie
    // przebudowuje. To wartość Z MACIERZY, więc podgląd jej nie dotyka.
    expect(manage?.cells.find((cell) => cell.role === "lead")?.value).toBe("no");
    expect(manage?.cells.find((cell) => cell.role === "admin")?.value).toBe("yes");
  });

  it("etykieta komórki jest rekordem po zamkniętej unii", () => {
    // Rekord, a nie łańcuch `if`-ów: nowa wartość macierzy nie ma jak wpaść
    // do gałęzi „wszystko inne", czyli do minusa udającego „nie wolno".
    expect(CAPABILITY_CELL_LABEL).toEqual({ yes: "yes", cond: "conditional", no: "no" });
  });
});

describe("identyfikator osoby dla podglądu", () => {
  it("pusty wybór nie pyta bazy", () => {
    expect(capabilityPreviewUserId("")).toBeUndefined();
  });

  it("wybrana osoba jedzie do zapytania", () => {
    expect(capabilityPreviewUserId(CLUB_IDS.member)).toBe(CLUB_IDS.member);
  });
});

describe("rola efektywna i powód", () => {
  it("powód odmowy wraca jako klucz przestrzeni publicznej", () => {
    expect(
      capabilityPreviewSummary(caps({ effectiveRole: "observer", reason: "tier_too_low" })),
    ).toEqual({ roleKey: "club.role.observer", reasonKey: "club.reason.tier_too_low" });
  });

  it("brak przeszkód wraca jako brak klucza, nie jako klucz bez ogona", () => {
    expect(capabilityPreviewSummary(caps({ effectiveRole: "lead", reason: null }))).toEqual({
      roleKey: "club.role.lead",
      reasonKey: null,
    });
  });
});

describe("wiersze podglądu", () => {
  it("czytają odpowiedź RPC, a nie macierz", () => {
    const rows = capabilityPreviewRows(caps({ canRead: true, canReply: true }));

    expect(rows.map((row) => row.key)).toEqual([...CAPABILITY_KEYS]);
    expect(rows.filter((row) => row.granted).map((row) => row.key)).toEqual([
      "can_read",
      "can_reply",
    ]);
  });

  it("zdolności całkowicie zamknięte dają wiersze bez ani jednego przyznania", () => {
    expect(capabilityPreviewRows(caps()).some((row) => row.granted)).toBe(false);
  });
});

describe("stan sekcji podglądu", () => {
  it("brak wybranej osoby: prosimy o wybór, nawet gdy zapytanie zgłasza „w locie”", () => {
    expect(capabilityPreviewState({ userId: "", isPending: true, caps: undefined })).toEqual({
      kind: "empty",
    });
  });

  it("wybrana osoba i zapytanie w locie: szkielet", () => {
    expect(
      capabilityPreviewState({ userId: CLUB_IDS.member, isPending: true, caps: undefined }),
    ).toEqual({ kind: "pending" });
  });

  it("wybrana osoba, zapytanie zakończone, brak danych: AWARIA, nie pustka", () => {
    expect(
      capabilityPreviewState({ userId: CLUB_IDS.member, isPending: false, caps: undefined }),
    ).toEqual({ kind: "unavailable" });
  });

  it("odpowiedź RPC składa podsumowanie i wiersze w jednym stanie", () => {
    const state = capabilityPreviewState({
      userId: CLUB_IDS.member,
      isPending: false,
      caps: caps({ effectiveRole: "member", reason: null, canRead: true }),
    });

    expect(state.kind).toBe("ready");
    if (state.kind !== "ready") throw new Error("stan podglądu musi być gotowy");
    expect(state.summary.roleKey).toBe("club.role.member");
    expect(state.rows).toHaveLength(CAPABILITY_KEYS.length);
    expect(state.rows[0]).toEqual({ key: "can_read", granted: true });
  });
});
