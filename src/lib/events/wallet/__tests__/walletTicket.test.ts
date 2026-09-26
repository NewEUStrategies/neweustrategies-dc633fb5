// @vitest-environment node
// Model przepustki z odpowiedzi `event_ticket_wallet_payload`.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW. Termin w strefie serwera zamiast
// wydarzenia (godzina przesunięta o dwie), przepustka z pustym tytułem albo
// biała etykieta na białym tle z brandingu - wszystko to trafia do portfela
// uczestnika i zostaje tam do dnia wydarzenia, bo przepustki są statyczne.
import { describe, expect, it } from "vitest";

import {
  eventPageUrl,
  WALLET_DEFAULT_BACKGROUND,
  walletColors,
  walletTicketFromPayload,
  walletWhen,
} from "../walletTicket";
import { WALLET_COPY, WALLET_LANGS, walletLang } from "../walletCopy";
import { freezeClock } from "@/test/time";
import { WALLET_QR, walletPayloadRow, walletTicketFixture } from "@/test/events/walletFixtures";

freezeClock();

describe("walletTicketFromPayload", () => {
  it("mapuje komplet pól, termin w strefie wydarzenia i język kliknięcia", () => {
    const ticket = walletTicketFixture({}, "EN ");
    expect(ticket).toMatchObject({
      registrationId: "52b00000-0000-0000-0000-0000000000a1",
      tenantId: "52000000-0000-0000-0000-0000000000a0",
      organizationName: "Organizator A",
      lang: "en",
      holderName: "Hanna Posiadaczka",
      qrToken: WALLET_QR,
      ticketName: { pl: "Standardowy", en: "Standard" },
      groupName: { pl: "Prasa", en: "Press" },
    });
    expect(ticket.event).toMatchObject({
      id: "52e00000-0000-0000-0000-0000000000a1",
      slug: "wallet-kongres",
      title: { pl: "Kongres portfela", en: "Wallet congress" },
      timezone: "Europe/Warsaw",
      location: "Warszawa, Sala Kongresowa",
      coverUrl: "https://cdn.example.org/cover.jpg",
    });
    // 07:00 UTC = 09:00 CEST; ten sam dzień -> sama godzina końca.
    expect(ticket.event.when.pl).toMatch(/16 października 2026.*09:00 – 17:00 \(CEST\)$/);
    expect(ticket.event.when.en).toMatch(/16 October 2026.*09:00 – 17:00 \(CEST\)$/);
  });

  it("bez języka kliknięcia bierze język zgłoszenia, a bez obu - polski", () => {
    expect(walletTicketFixture({ lang: "en" }).lang).toBe("en");
    expect(walletTicketFixture({ lang: "de" }, "fr").lang).toBe("pl");
    expect(walletTicketFixture({ lang: null }).lang).toBe("pl");
  });

  it("pola opcjonalne: brak zamienia się na null, jeden język uzupełnia drugi", () => {
    const ticket = walletTicketFixture({
      first_name: " ",
      last_name: null,
      event_ends_at: null,
      event_location: "",
      event_cover_url: "http://niebezpieczny.example.org/a.jpg",
      ticket_name_pl: null,
      ticket_name_en: "Only English",
      group_name_pl: null,
      group_name_en: null,
      tenant_name: null,
      event_title_en: null,
      event_timezone: "Nie/Istnieje",
    });
    expect(ticket.holderName).toBeNull();
    expect(ticket.event.endsAt).toBeNull();
    expect(ticket.event.location).toBeNull();
    expect(ticket.event.coverUrl).toBeNull();
    expect(ticket.ticketName).toEqual({ pl: "Only English", en: "Only English" });
    expect(ticket.groupName).toBeNull();
    expect(ticket.event.title).toEqual({ pl: "Kongres portfela", en: "Kongres portfela" });
    // Nazwa organizacji nie może być pusta - zastępczo tytuł wydarzenia.
    expect(ticket.organizationName).toBe("Kongres portfela");
    // Nieznana strefa -> strefa serwisu, jak w całym module.
    expect(ticket.event.timezone).toBe("Europe/Warsaw");
    expect(ticket.event.when.pl).toMatch(/09:00 \(CEST\)$/);
    expect(walletTicketFixture({ last_name: "Tylko", first_name: null }).holderName).toBe("Tylko");
  });

  it("odrzuca odpowiedź bez pól, bez których przepustki nie da się złożyć", () => {
    expect(walletTicketFromPayload(null, WALLET_QR, null)).toBeNull();
    expect(walletTicketFromPayload([1, 2], WALLET_QR, null)).toBeNull();
    expect(walletTicketFromPayload("x", WALLET_QR, null)).toBeNull();
    for (const key of [
      "registration_id",
      "tenant_id",
      "event_id",
      "event_slug",
      "event_starts_at",
    ]) {
      expect(
        walletTicketFromPayload(walletPayloadRow({ [key]: null }), WALLET_QR, null),
      ).toBeNull();
    }
    expect(
      walletTicketFromPayload(
        walletPayloadRow({ event_title_pl: 7, event_title_en: " " }),
        WALLET_QR,
        null,
      ),
    ).toBeNull();
  });
});

describe("walletWhen", () => {
  it("wydarzenie wielodniowe pokazuje pełną datę końca", () => {
    const text = walletWhen("2026-10-16T07:00:00Z", "2026-10-17T15:00:00Z", "Europe/Warsaw", "pl");
    expect(text).toMatch(/16 października 2026.* – 17 października 2026.*17:00 \(CEST\)$/);
  });

  it("północ w strefie wydarzenia to inny dzień niż w UTC", () => {
    // 22:30 UTC 16.10 = 00:30 CEST 17.10, koniec 01:30 CEST tego samego dnia.
    const text = walletWhen("2026-10-16T22:30:00Z", "2026-10-16T23:30:00Z", "Europe/Warsaw", "en");
    expect(text).toMatch(/17 October 2026.*00:30 – 01:30 \(CEST\)$/);
  });
});

describe("walletColors", () => {
  it("tło z nawigacji, jasny tekst na ciemnym, etykieta z koloru akcji", () => {
    expect(walletColors({ navigation: "#112233", main_action: "#FF6600" }, null)).toEqual({
      background: "#112233",
      foreground: "#FFFFFF",
      label: "#FF6600",
    });
  });

  it("jasne tło -> ciemny tekst; akcja bez kontrastu ustępuje kolorowi grupy", () => {
    expect(walletColors({ navigation: "#fafafa", main_action: "#FFFF00" }, "#003366")).toEqual({
      background: "#FAFAFA",
      foreground: WALLET_DEFAULT_BACKGROUND,
      label: "#003366",
    });
  });

  it("bez nawigacji tłem jest kolor akcji; bez kontrastu obu etykieta = tekst", () => {
    expect(walletColors({ main_action: "#FF6600" }, "#FF7711")).toEqual({
      background: "#FF6600",
      foreground: WALLET_DEFAULT_BACKGROUND,
      label: WALLET_DEFAULT_BACKGROUND,
    });
  });

  it("brak brandingu (albo śmieci) -> grafit skanera; zły kolor grupy jest pomijany", () => {
    expect(walletColors(null, "zielony")).toEqual({
      background: WALLET_DEFAULT_BACKGROUND,
      foreground: "#FFFFFF",
      label: "#FFFFFF",
    });
    expect(walletColors({ navigation: "red" }, "#00ff99").label).toBe("#00FF99");
  });
});

describe("walletCopy / eventPageUrl", () => {
  it("oba języki mają ten sam zestaw niepustych napisów", () => {
    expect(Object.keys(WALLET_COPY.pl).sort()).toEqual(Object.keys(WALLET_COPY.en).sort());
    for (const lang of WALLET_LANGS) {
      for (const value of Object.values(WALLET_COPY[lang])) expect(value.trim()).not.toBe("");
    }
  });

  it("walletLang przyjmuje tylko pl/en", () => {
    expect(walletLang(" PL")).toBe("pl");
    expect(walletLang("en")).toBe("en");
    expect(walletLang("de")).toBeNull();
    expect(walletLang(1)).toBeNull();
  });

  it("adres strony wydarzenia tylko przy znanym hoście", () => {
    expect(eventPageUrl("https://a.example.org", "kongres 2026")).toBe(
      "https://a.example.org/events/kongres%202026",
    );
    expect(eventPageUrl(null, "kongres")).toBeNull();
  });
});
