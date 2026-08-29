// Notatka wewnetrzna sponsora - regresja utraty danych.
//
// CO SIE PSULO. `admin_event_sponsors_list` CELOWO nie oddaje `internal_note`
// (notatka handlowa nie ma po co jezdzic przez ekran, ktory jej nie pokazuje) -
// wychodzi wylacznie z `admin_event_sponsor_detail`. Dialog edycji dostawal
// jednak wiersz LISTY, wiec `sponsorDraftFromRow` czytalo `undefined` i zapisywalo
// pusty napis. `sponsorDraftToInput` zawsze zwracalo `internalNote: null`
// (nie `undefined`), pomocnik `payload()` odsiewa tylko `undefined`, wiec klucz
// LADOWAL w ladunku z wartoscia null - a SQL brzmi
// `internal_note = CASE WHEN p_payload ? 'internal_note' THEN ... ELSE internal_note END`.
// Klucz byl obecny, wiec galaz zachowawcza sie nie uruchamiala i notatka znikala
// przy pierwszej edycji dowolnego innego pola. Bez ostrzezenia i bez sladu.
//
// TRZY STANY, NIE DWA. Naprawa wprowadza `internalNoteKnown`, bo „nie wiem"
// i „jest puste" to rozne odpowiedzi:
//   * nie wiem  -> klucza nie ma w ladunku, baza zostawia swoja wartosc,
//   * wiem, puste -> klucz jest, baza czysci notatke (swiadome skasowanie),
//   * wiem, tekst -> klucz jest, baza zapisuje tekst.
import { describe, expect, it } from "vitest";

import {
  emptySponsorDraft,
  sponsorDraftFromRow,
  sponsorDraftToInput,
} from "@/lib/events/sponsorDraft";

const EVENT = "11111111-1111-4111-8111-111111111111";

/** Wiersz w ksztalcie `admin_event_sponsors_list` - BEZ kolumny `internal_note`. */
function listRow(over: Record<string, unknown> = {}) {
  return {
    id: "s-1",
    company_id: "c-1",
    company_name: "New European Strategies",
    tier_id: "t-1",
    role: "sponsor",
    is_published: true,
    booth_label: "A12",
    sort_order: 3,
    snapshot_name: "NES",
    snapshot_logo_url: "",
    snapshot_website: "",
    snapshot_country: "",
    snapshot_description_pl: "",
    snapshot_description_en: "",
    ...over,
  };
}

/** Wiersz w ksztalcie `admin_event_sponsor_detail` - Z kolumna `internal_note`. */
function detailRow(note: string | null) {
  return listRow({ internal_note: note });
}

describe("sponsorDraftFromRow - skad szkic wie, czy zna notatke", () => {
  it("wiersz listy (bez kolumny) -> notatka NIEZNANA", () => {
    expect(sponsorDraftFromRow(listRow()).internalNoteKnown).toBe(false);
  });

  it("wiersz szczegolu z trescia -> notatka znana i wczytana", () => {
    const draft = sponsorDraftFromRow(detailRow("umowa NES/2026/114"));
    expect(draft.internalNoteKnown).toBe(true);
    expect(draft.internalNote).toBe("umowa NES/2026/114");
  });

  it("wiersz szczegolu z NULL-em -> notatka znana i pusta", () => {
    const draft = sponsorDraftFromRow(detailRow(null));
    expect(draft.internalNoteKnown).toBe(true);
    expect(draft.internalNote).toBe("");
  });

  it("nowy sponsor zna swoja (pusta) notatke - nie ma czego chronic", () => {
    expect(emptySponsorDraft(1).internalNoteKnown).toBe(true);
  });
});

describe("sponsorDraftToInput - co trafia do ladunku", () => {
  it("REGRESJA: szkic z wiersza listy NIE wysyla klucza notatki", () => {
    const input = sponsorDraftToInput(sponsorDraftFromRow(listRow()), EVENT);
    expect(input.internalNote).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(input, "internalNote")).toBe(true);
    // Klucz istnieje w obiekcie, ale ma wartosc `undefined` - i wlasnie to
    // odsiewa `payload()` w `sponsorsApi`, wiec do bazy nie pojedzie.
  });

  it("szkic ze znana, niepusta notatka wysyla jej tresc", () => {
    const input = sponsorDraftToInput(
      sponsorDraftFromRow(detailRow("faktura po wydarzeniu")),
      EVENT,
    );
    expect(input.internalNote).toBe("faktura po wydarzeniu");
  });

  it("swiadome wyczyszczenie znanej notatki wysyla `null`, a nie `undefined`", () => {
    const draft = { ...sponsorDraftFromRow(detailRow("stara tresc")), internalNote: "   " };
    expect(sponsorDraftToInput(draft, EVENT).internalNote).toBeNull();
  });

  it("redaktor, ktory wpisal tresc do nieznanej notatki, nie traci jej", () => {
    // Tak wyglada szkic po `set("internalNote", ...)` w dialogu.
    const draft = {
      ...sponsorDraftFromRow(listRow()),
      internalNote: "nowa notatka",
      internalNoteKnown: true,
    };
    expect(sponsorDraftToInput(draft, EVENT).internalNote).toBe("nowa notatka");
  });

  it("pozostale pola jada niezaleznie od stanu notatki", () => {
    const input = sponsorDraftToInput(sponsorDraftFromRow(listRow()), EVENT);
    expect(input.id).toBe("s-1");
    expect(input.boothLabel).toBe("A12");
    expect(input.snapshotName).toBe("NES");
  });

  it("EDYCJA nie wysyla `eventId` ani `companyId` - przypiecia sie nie przenosi", () => {
    const input = sponsorDraftToInput(sponsorDraftFromRow(listRow()), EVENT);
    expect(input.eventId).toBeUndefined();
    expect(input.companyId).toBeUndefined();
  });

  it("NOWE przypiecie wysyla `eventId` i `companyId`", () => {
    const draft = { ...emptySponsorDraft(1), companyId: "c-9", snapshotName: "Firma" };
    const input = sponsorDraftToInput(draft, EVENT);
    expect(input.eventId).toBe(EVENT);
    expect(input.companyId).toBe("c-9");
  });
});

describe("kontrakt z SQL-em, ktory te trzy stany obsluguje", () => {
  it("`payload()` odsiewa `undefined`, a zachowuje jawny `null`", async () => {
    // Ten sam ksztalt, co pomocnik w `sponsorsApi` - gdyby zmienil zdanie
    // i zaczal odsiewac takze `null`, swiadome czyszczenie notatki przestaloby
    // dzialac po cichu.
    const payload = (input: Record<string, unknown>) => {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(input)) {
        if (value !== undefined) out[key] = value;
      }
      return out;
    };
    expect(payload({ internal_note: undefined })).not.toHaveProperty("internal_note");
    expect(payload({ internal_note: null })).toHaveProperty("internal_note", null);
  });
});
