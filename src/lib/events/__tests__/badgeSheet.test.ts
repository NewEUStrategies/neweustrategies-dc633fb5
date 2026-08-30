import { describe, expect, it } from "vitest";
import {
  badgeFullName,
  badgeLocalized,
  badgeSizeMm,
  parseBadgeBatch,
} from "@/lib/events/badgeSheet";
import { buildBadgePrintDocument } from "@/lib/events/badgePrintDocument";

describe("badgeSizeMm", () => {
  it("zwraca wymiary formatu w pionie", () => {
    expect(badgeSizeMm({ paperFormat: "a6", orientation: "portrait" })).toEqual({
      widthMm: 105,
      heightMm: 148,
    });
  });

  it("obraca boki dla orientacji poziomej zamiast skalowac", () => {
    expect(badgeSizeMm({ paperFormat: "a7", orientation: "landscape" })).toEqual({
      widthMm: 105,
      heightMm: 74,
    });
  });

  it("dla formatu custom bierze wymiary szablonu", () => {
    expect(
      badgeSizeMm({ paperFormat: "custom", orientation: "portrait", widthMm: 90, heightMm: 120 }),
    ).toEqual({ widthMm: 90, heightMm: 120 });
  });

  it("nieznany format i zerowe wymiary spadaja do wartosci domyslnej", () => {
    expect(
      badgeSizeMm({ paperFormat: "custom", orientation: "portrait", widthMm: 0, heightMm: null }),
    ).toEqual({ widthMm: 105, heightMm: 148 });
    expect(badgeSizeMm({ paperFormat: "zupelnie-inny", orientation: "portrait" })).toEqual({
      widthMm: 105,
      heightMm: 148,
    });
  });
});

describe("parseBadgeBatch", () => {
  it("mapuje ladunek bazy na typowane karty", () => {
    const batch = parseBadgeBatch({
      event_id: "e1",
      template_id: null,
      issued_at: "2026-05-01T09:00:00Z",
      badges: [
        {
          person_id: "p1",
          first_name: "Anna",
          last_name: "Nowak",
          job_title: "Analityk",
          company: "NES",
          registration_id: "r1",
          registration_status: "approved",
          ticket_name_pl: "Pełny",
          ticket_name_en: "Full",
          group_name_pl: "Prelegenci",
          group_name_en: "Speakers",
          group_color: "#ff8a00",
          qr_code: "TOKEN",
        },
      ],
    });

    expect(batch.templateId).toBeNull();
    expect(batch.badges).toHaveLength(1);
    expect(batch.badges[0].qrCode).toBe("TOKEN");
    expect(badgeFullName(batch.badges[0])).toBe("Anna Nowak");
  });

  it("osoba bez zapisu nie ma kodu, ale nadal jest karta", () => {
    const batch = parseBadgeBatch({
      badges: [{ person_id: "p2", first_name: "Jan", last_name: "Kowalski", qr_code: null }],
    });
    expect(batch.badges[0].qrCode).toBeNull();
    expect(batch.badges[0].company).toBeNull();
  });

  it("smieciowy ladunek daje pusta partie zamiast wyjatku", () => {
    expect(parseBadgeBatch(null).badges).toEqual([]);
    expect(parseBadgeBatch({ badges: "nope" }).badges).toEqual([]);
  });
});

describe("badgeLocalized", () => {
  it("wybiera jezyk interfejsu i wraca do drugiego przy braku", () => {
    expect(badgeLocalized("Pełny", "Full", "en")).toBe("Full");
    expect(badgeLocalized("Pełny", null, "en")).toBe("Pełny");
    expect(badgeLocalized(null, null, "pl")).toBeNull();
  });
});

describe("buildBadgePrintDocument", () => {
  const card = parseBadgeBatch({
    badges: [
      {
        person_id: "p1",
        first_name: "Anna",
        last_name: "Nowak",
        job_title: "Analityk",
        company: "<NES>",
        group_color: "#ff8a00",
        qr_code: "TOKEN",
      },
    ],
  }).badges[0];

  const options = {
    widthMm: 105,
    heightMm: 148,
    showQr: true,
    qrSizeMm: 24,
    backgroundColor: "#ffffff",
    eventTitle: "Forum",
    documentTitle: "Identyfikatory",
    noCodeLabel: "Bez kodu",
  };

  it("osadza rozmiar karty w milimetrach", () => {
    const html = buildBadgePrintDocument(
      [
        {
          card,
          qrDataUrl: "data:image/png;base64,AAA",
          ticketLabel: "Pełny",
          groupLabel: "Goście",
        },
      ],
      options,
    );
    expect(html).toContain("width: 105mm");
    expect(html).toContain("height: 148mm");
    expect(html).toContain("data:image/png;base64,AAA");
  });

  it("escapuje dane osoby, zeby nazwa firmy nie wstrzykiwala znacznikow", () => {
    const html = buildBadgePrintDocument(
      [{ card, qrDataUrl: null, ticketLabel: null, groupLabel: null }],
      options,
    );
    expect(html).toContain("&lt;NES&gt;");
    expect(html).not.toContain("<NES>");
  });

  it("karta bez kodu dostaje napis o wejsciu recznym, a nie pusty obrazek", () => {
    const html = buildBadgePrintDocument(
      [{ card, qrDataUrl: null, ticketLabel: null, groupLabel: null }],
      options,
    );
    expect(html).toContain("Bez kodu");
    expect(html).not.toContain("<img");
  });

  it("odrzuca kolor grupy spoza formatu hex", () => {
    const evil = { ...card, groupColor: "red; background: url(javascript:1)" };
    const html = buildBadgePrintDocument(
      [{ card: evil, qrDataUrl: null, ticketLabel: null, groupLabel: "Goście" }],
      options,
    );
    expect(html).not.toContain("javascript:");
    expect(html).toContain("#d1d5db");
  });
});
