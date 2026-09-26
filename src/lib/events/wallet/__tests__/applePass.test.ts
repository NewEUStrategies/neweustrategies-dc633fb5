// @vitest-environment node
// Przepustka Apple Wallet (`.pkpass`): pass.json, pass.strings, manifest, podpis.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW. Wallet odrzuca paczkę po cichu,
// gdy skrót choć jednego pliku nie zgadza się z manifestem, podpis nie pasuje
// do manifestu, kolor nie jest w zapisie `rgb()`, a data ma milisekundy.
// Kod QR inny niż jawny kod biletu to przepustka, której skaner nie przyjmie
// przy bramce. Testy rozpakowują gotową paczkę niezależnym czytnikiem.
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import {
  buildApplePass,
  buildPassJson,
  passColor,
  passDate,
  passStrings,
  utf16le,
} from "../applePass.server";
import { sha1Hex, sha256, toHex } from "../rsa";
import { freezeClock } from "@/test/time";
import { verifyTestCmsSignature } from "@/test/events/walletCms";
import { APPLE_CONFIG_FIXTURE, WALLET_QR, walletTicketFixture } from "@/test/events/walletFixtures";

freezeClock();

const ORIGIN = "https://wydarzenia.example.org";

function decodeUtf16(bytes: Uint8Array): string {
  return new TextDecoder("utf-16le").decode(bytes.slice(2));
}

describe("passColor / passDate / utf16le", () => {
  it("kolor w zapisie rgb(), data W3C bez milisekund, UTF-16LE z BOM", () => {
    expect(passColor("#FF6600")).toBe("rgb(255, 102, 0)");
    expect(passDate(new Date("2026-10-16T07:00:00.123Z"))).toBe("2026-10-16T07:00:00Z");
    expect(Array.from(utf16le("Ał"))).toEqual([0xff, 0xfe, 0x41, 0x00, 0x42, 0x01]);
  });
});

describe("buildPassJson", () => {
  it("eventTicket z polami w języku kliknięcia, kodem QR, datami i kolorami", () => {
    const pass = buildPassJson(walletTicketFixture(), APPLE_CONFIG_FIXTURE, ORIGIN);
    expect(pass).toMatchObject({
      formatVersion: 1,
      passTypeIdentifier: "pass.org.example.test",
      teamIdentifier: "TESTTEAM01",
      serialNumber: "52b00000-0000-0000-0000-0000000000a1",
      organizationName: "Organizator A",
      logoText: "Organizator A",
      description: "Bilet: Kongres portfela",
      backgroundColor: "rgb(17, 34, 51)",
      foregroundColor: "rgb(255, 255, 255)",
      labelColor: "rgb(255, 102, 0)",
      relevantDate: "2026-10-16T07:00:00Z",
      // Koniec + 1 dzień: przepustka wyszarza się dzień po wydarzeniu.
      expirationDate: "2026-10-17T15:00:00Z",
      barcodes: [
        {
          format: "PKBarcodeFormatQR",
          message: WALLET_QR,
          messageEncoding: "iso-8859-1",
          altText: WALLET_QR,
        },
      ],
    });
    const ticket = pass.eventTicket as Record<
      string,
      { key: string; label: string; value: string }[]
    >;
    expect(ticket.primaryFields).toEqual([
      { key: "event", label: "Wydarzenie", value: "Kongres portfela" },
    ]);
    expect(ticket.secondaryFields.map((f) => f.key)).toEqual(["date", "location"]);
    expect(ticket.secondaryFields[0].value).toMatch(/09:00 – 17:00 \(CEST\)$/);
    expect(ticket.auxiliaryFields).toEqual([
      { key: "holder", label: "Uczestnik", value: "Hanna Posiadaczka" },
      { key: "ticket", label: "Rodzaj biletu", value: "Standardowy" },
      { key: "group", label: "Grupa", value: "Prasa" },
    ]);
    expect(ticket.backFields.map((f) => f.key)).toEqual([
      "code",
      "info",
      "organizer",
      "event_page",
    ]);
    expect(ticket.backFields[0].value).toBe(WALLET_QR);
    expect(ticket.backFields[3].value).toBe(`${ORIGIN}/events/wallet-kongres`);
  });

  it("bez końca, miejsca, posiadacza, biletu, grupy i hosta - pola znikają, nie są puste", () => {
    const pass = buildPassJson(
      walletTicketFixture(
        {
          event_ends_at: null,
          event_location: null,
          first_name: null,
          last_name: null,
          ticket_name_pl: null,
          ticket_name_en: null,
          group_name_pl: null,
          group_name_en: null,
        },
        "en",
      ),
      APPLE_CONFIG_FIXTURE,
      null,
    );
    expect(pass.expirationDate).toBe("2026-10-17T07:00:00Z");
    expect(pass.description).toBe("Ticket: Wallet congress");
    const ticket = pass.eventTicket as Record<string, { key: string }[]>;
    expect(ticket.secondaryFields.map((f) => f.key)).toEqual(["date"]);
    expect(ticket.auxiliaryFields).toEqual([]);
    expect(ticket.backFields.map((f) => f.key)).toEqual(["code", "info", "organizer"]);
  });
});

describe("passStrings", () => {
  it("mapuje napisy z pass.json na drugi język; klucz powtarzający się - raz", () => {
    const ticket = walletTicketFixture({ group_name_pl: "Kongres portfela", group_name_en: "X" });
    const en = passStrings(ticket, "en", ORIGIN);
    expect(en).toContain('"Wydarzenie" = "Event";');
    expect(en).toContain('"Kongres portfela" = "Wallet congress";');
    expect(en).toContain('"Bilet: Kongres portfela" = "Ticket: Wallet congress";');
    expect(en).toContain('"Standardowy" = "Standard";');
    expect(en).not.toContain('"Kongres portfela" = "X";');
    expect(en.endsWith(";\n")).toBe(true);
    const pl = passStrings(ticket, "pl", ORIGIN);
    expect(pl).toContain('"Wydarzenie" = "Wydarzenie";');
  });

  it("ucieka cudzysłów, ukośnik i końce linii w obu stronach wpisu", () => {
    const ticket = walletTicketFixture({
      event_title_pl: 'Forum "A"\\B',
      event_title_en: "Forum\r\nA",
    });
    expect(passStrings(ticket, "en", null)).toContain('"Forum \\"A\\"\\\\B" = "Forum\\r\\nA";');
  });
});

describe("buildApplePass", () => {
  it("paczka: pliki, manifest SHA-1 zgodny z bajtami i podpis manifestu", async () => {
    const bytes = await buildApplePass({
      ticket: walletTicketFixture(),
      config: APPLE_CONFIG_FIXTURE,
      publicOrigin: ORIGIN,
      now: new Date("2026-09-26T08:00:00Z"),
    });
    const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
    expect(Object.keys(zip.files)).toEqual([
      "pass.json",
      "icon.png",
      "icon@2x.png",
      "icon@3x.png",
      "pl.lproj/pass.strings",
      "en.lproj/pass.strings",
      "manifest.json",
      "signature",
    ]);

    const manifestBytes = await zip.file("manifest.json")!.async("uint8array");
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as Record<string, string>;
    expect(Object.keys(manifest)).toEqual(Object.keys(zip.files).slice(0, 6));
    for (const [name, digest] of Object.entries(manifest)) {
      expect(await sha1Hex(await zip.file(name)!.async("uint8array"))).toBe(digest);
    }

    const icon = await zip.file("icon.png")!.async("uint8array");
    expect(Array.from(icon.slice(1, 4))).toEqual([0x50, 0x4e, 0x47]);

    const pass = JSON.parse(await zip.file("pass.json")!.async("string")) as Record<
      string,
      unknown
    >;
    expect(pass.serialNumber).toBe("52b00000-0000-0000-0000-0000000000a1");
    const strings = await zip.file("en.lproj/pass.strings")!.async("uint8array");
    expect(Array.from(strings.slice(0, 2))).toEqual([0xff, 0xfe]);
    expect(decodeUtf16(strings)).toContain('"Wydarzenie" = "Event";');

    const signature = await zip.file("signature")!.async("uint8array");
    const verified = await verifyTestCmsSignature(signature);
    expect(verified.valid).toBe(true);
    expect(verified.certificates).toBe(2);
    expect(toHex(verified.messageDigest)).toBe(toHex(await sha256(manifestBytes)));
  });
});
