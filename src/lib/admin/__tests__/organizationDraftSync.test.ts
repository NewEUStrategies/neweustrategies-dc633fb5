// Reguła uzgadniania draftu karty organizacji - wykonywana, nie tylko czytana.
//
// Ten plik istnieje, bo defekt A4 ma DWIE strony i naprawa jednej psuje drugą,
// jeśli nikt tego nie przypnie: draft, który nie uzgadnia się nigdy, cicho cofa
// cudzą zmianę; draft, który uzgadnia się zawsze, cicho wyrzuca niezapisaną
// pracę administratora. Obie sytuacje wyglądają na ekranie identycznie -
// jak udany zapis.
import { describe, expect, it } from "vitest";
import { draftSyncAction, isNewerRow } from "@/lib/admin/organizationDraftSync";

const ORG = "org-1";
const V1 = "2026-01-15T10:00:00.000Z";
const V2 = "2026-01-15T10:20:00.000Z";

describe("isNewerRow", () => {
  it("ten sam znacznik to NIE zmiana", () => {
    expect(isNewerRow(V1, V1)).toBe(false);
  });

  it("nowszy znacznik to zmiana", () => {
    expect(isNewerRow(V1, V2)).toBe(true);
  });

  it("STARSZY znacznik to nie zmiana - odpowiedź z cache nie cofa formularza", () => {
    // Bez porównania chwil wystarczyłoby `!==`, a wtedy starsza odpowiedź
    // z cache przestawiałaby formularz na dane, które już są nieaktualne.
    expect(isNewerRow(V2, V1)).toBe(false);
  });

  it("ten sam moment zapisany inaczej to nie zmiana", () => {
    expect(isNewerRow("2026-01-15T10:00:00.000Z", "2026-01-15T11:00:00.000+01:00")).toBe(false);
  });

  it("nierozstrzygalny znacznik traktujemy jako zmianę - fail safe", () => {
    expect(isNewerRow(null, V1)).toBe(true);
    expect(isNewerRow(V1, null)).toBe(true);
    expect(isNewerRow(V1, "kiedyś")).toBe(true);
  });
});

describe("draftSyncAction", () => {
  it("pierwsze wczytanie przejmuje wiersz", () => {
    expect(
      draftSyncAction({ seen: null, row: { id: ORG, updatedAt: V1 }, userEdited: false }),
    ).toBe("reseed");
  });

  it("INNA organizacja przejmuje wiersz NAWET z niezapisanymi zmianami", () => {
    // Zawartość formularza dotyczy wtedy wiersza, którego już nie oglądamy -
    // nie ma czego bronić, a zostawienie jej pokazałoby cudze dane pod cudzym
    // nagłówkiem.
    expect(
      draftSyncAction({
        seen: { id: "org-0", updatedAt: V1 },
        row: { id: ORG, updatedAt: V1 },
        userEdited: true,
      }),
    ).toBe("reseed");
  });

  it("ta sama wersja to `skip` - zwykły refetch nie rusza formularza", () => {
    expect(
      draftSyncAction({
        seen: { id: ORG, updatedAt: V1 },
        row: { id: ORG, updatedAt: V1 },
        userEdited: true,
      }),
    ).toBe("skip");
  });

  it("NOWSZA wersja przy NIETKNIĘTYM formularzu uzgadnia - to jest naprawa A4", () => {
    // Zakładka Miejsca zmienia limit funkcją serwerową i unieważnia zapytanie
    // karty. Bez tej gałęzi karta trzymałaby wartość sprzed zmiany i wysyłała
    // ją z powrotem przy zapisie czegokolwiek innego.
    expect(
      draftSyncAction({
        seen: { id: ORG, updatedAt: V1 },
        row: { id: ORG, updatedAt: V2 },
        userEdited: false,
      }),
    ).toBe("reseed");
  });

  it("NOWSZA wersja przy TKNIĘTYM formularzu zostawia pracę administratora", () => {
    // Druga strona tego samego defektu: administrator wpisał miasto, przeszedł
    // na zakładkę Miejsca i zmienił limit. Bezwarunkowe uzgodnienie wyrzuciłoby
    // mu miasto bez słowa. Zamiast tego zostawiamy draft, nie przesuwamy bazy
    // optimistic-locka - i zapis trafia w konflikt, który da się zobaczyć.
    expect(
      draftSyncAction({
        seen: { id: ORG, updatedAt: V1 },
        row: { id: ORG, updatedAt: V2 },
        userEdited: true,
      }),
    ).toBe("keep-local-edits");
  });

  it("STARSZA odpowiedź nie rusza formularza ani z pracą, ani bez niej", () => {
    for (const userEdited of [false, true]) {
      expect(
        draftSyncAction({
          seen: { id: ORG, updatedAt: V2 },
          row: { id: ORG, updatedAt: V1 },
          userEdited,
        }),
      ).toBe("skip");
    }
  });
});
