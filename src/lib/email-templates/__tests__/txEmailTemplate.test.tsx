// SZABLON WYSYŁANEJ WIADOMOŚCI TRANSAKCYJNEJ (`transactional.tsx`) oraz
// rejestr gotowych wariantów aplikacji (`app-transactional-templates.tsx`).
// To jest OSTATNI etap przed skrzynką odbiorcy: tu treść ze słownika spotyka
// dane zdarzenia i zamienia się w HTML, którego nie da się już poprawić.
//
// Trzy gałęzie decydują tu o tym, czy mail jest kompletny, a żadna nie była
// przed tym plikiem uruchomiona: dodatkowy akapit (`extra`), przycisk CTA
// (`ctaUrl`) oraz nadpisania treści z panelu redakcyjnego. Po stronie rejestru
// niepokryte było WSZYSTKO, co dzieje się przy DANYCH NIEPEŁNYCH - a rejestr
// przyjmuje `Record<string, unknown>`, więc niepełne dane są tam normą.
//
// ROZSTRZYGNIĘCIE i18n (pełne uzasadnienie w `txCopy.test.ts`): szablon czyta
// treść z własnego słownika (`transactional.tsx:17 import { txCopy } from
// "./tx-copy"`, użycie w linii 102 `const c = txCopy(type, lang);`), nie z
// i18next - renderuje się na serwerze, poza dostawcą i18n. Asertujemy więc na
// wyrenderowanej treści obu języków, nie na kluczach.
//
// Zegar jest zamrożony, bo stopka ramki drukuje bieżący rok.
import * as React from "react";

import { render } from "@react-email/render";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  donationReceivedEnTemplate,
  donationReceivedPlTemplate,
  freeRsvpEnTemplate,
  freeRsvpPlTemplate,
  newsletterConfirmedTemplate,
} from "../app-transactional-templates";
import type { TemplateEntry } from "../registry";
import { TxEmail } from "../transactional";
import { txCopy } from "../tx-copy";

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-22T10:00:00.000Z"));
});

afterAll(() => {
  vi.useRealTimers();
});

const temat = (entry: TemplateEntry, data: Record<string, unknown>): string =>
  typeof entry.subject === "function" ? entry.subject(data) : entry.subject;

const wyrenderuj = (entry: TemplateEntry, data: Record<string, unknown>): Promise<string> =>
  render(React.createElement(entry.component, data));

describe("TxEmail - wariant minimalny i pełny", () => {
  it("bez języka bierze polski - to jest domyślny język platformy", async () => {
    const html = await render(
      React.createElement(TxEmail, {
        type: "newsletter_confirmed",
        siteUrl: "https://neweuropeanstrategies.com",
      }),
    );

    expect(html).toContain(txCopy("newsletter_confirmed", "pl").heading);
    expect(html).toContain("Dzień dobry");
  });

  it("bez szczegółów, bez CTA i bez dodatkowego akapitu mail nadal jest kompletny", async () => {
    // Najuboższy realny wariant (np. potwierdzenie newslettera). Gdyby brak
    // przycisku wywracał render, wiadomość w ogóle nie opuściłaby kolejki.
    const html = await render(
      React.createElement(TxEmail, {
        type: "newsletter_confirmed",
        lang: "pl",
        siteUrl: "https://neweuropeanstrategies.com",
      }),
    );
    const c = txCopy("newsletter_confirmed", "pl");

    expect(html).toContain(c.intro);
    expect(html).toContain(c.note);
    expect(html).toContain(c.footerHelp);
    expect(html).not.toContain("undefined");
  });

  it("dodatkowy akapit i przycisk pojawiają się dokładnie wtedy, gdy je podano", async () => {
    const html = await render(
      React.createElement(TxEmail, {
        type: "subscription_confirmed",
        lang: "pl",
        siteUrl: "https://neweuropeanstrategies.com",
        ctaUrl: "https://neweuropeanstrategies.com/profil/plan",
        ctaLabel: "Przejdź do planu",
        extra: "Dostęp masz od tej chwili.",
        details: [{ label: "Plan", value: "Professional" }],
      }),
    );

    expect(html).toContain("Dostęp masz od tej chwili.");
    expect(html).toContain("Przejdź do planu");
    expect(html).toContain("https://neweuropeanstrategies.com/profil/plan");
    expect(html).toContain("Professional");
  });

  it("bez etykiety przycisku bierze domyślne wezwanie ze słownika", async () => {
    const html = await render(
      React.createElement(TxEmail, {
        type: "subscription_confirmed",
        lang: "en",
        siteUrl: "https://neweuropeanstrategies.com",
        ctaUrl: "https://neweuropeanstrategies.com/pricing",
      }),
    );

    expect(html).toContain(txCopy("subscription_confirmed", "en").cta);
    expect(html).toContain("/pricing");
  });

  it("pusty akapit dodatkowy nie wstawia pustego bloku tekstu", async () => {
    // `extra: ""` jest realne: `tx-body` oddaje `undefined`, ale panel
    // redakcyjny potrafi zapisać puste pole. Pusty `<p>` psuje odstępy w Gmailu.
    const html = await render(
      React.createElement(TxEmail, {
        type: "subscription_canceled",
        lang: "pl",
        siteUrl: "https://neweuropeanstrategies.com",
        extra: "",
        intro: null,
        note: null,
      }),
    );
    const c = txCopy("subscription_canceled", "pl");

    expect(html).toContain(c.intro);
    expect(html).toContain(c.note);
  });

  it("nadpisania z panelu wygrywają ze słownikiem we WSZYSTKICH polach", async () => {
    // Redakcja edytuje treść trzech maili w panelu. Jeśli nadpisanie nie
    // dociera do renderu, panel kłamie: pokazuje zmianę, a wychodzi stara treść.
    const html = await render(
      React.createElement(TxEmail, {
        type: "team_seat_grace",
        lang: "pl",
        siteUrl: "https://neweuropeanstrategies.com",
        preview: "Własny preheader",
        eyebrow: "Własna nadlinia",
        heading: "Własny nagłówek",
        intro: "Własny akapit wstępny.",
        note: "Własna ramka co dalej.",
      }),
    );
    const c = txCopy("team_seat_grace", "pl");

    expect(html).toContain("Własny nagłówek");
    expect(html).toContain("Własny akapit wstępny.");
    expect(html).toContain("Własna ramka co dalej.");
    expect(html).not.toContain(c.heading);
  });

  it("imię i wołacz trafiają do powitania, a ich brak daje formę neutralną", async () => {
    const zImieniem = await render(
      React.createElement(TxEmail, {
        type: "event_registered",
        lang: "pl",
        siteUrl: "https://neweuropeanstrategies.com",
        firstName: "Anna",
        vocativePl: "Anno",
        gender: "female",
      }),
    );
    const bezImienia = await render(
      React.createElement(TxEmail, {
        type: "event_registered",
        lang: "pl",
        siteUrl: "https://neweuropeanstrategies.com",
        firstName: null,
      }),
    );

    expect(zImieniem).toContain("Dzień dobry, Anno");
    expect(bezImienia).toContain("Dzień dobry");
    expect(bezImienia).not.toContain("Anno");
  });
});

describe("rejestr szablonów aplikacji - dane niepełne i nieoczekiwane", () => {
  it("wariant EN renderuje się po angielsku, mimo że domyślnym językiem jest PL", async () => {
    const html = await wyrenderuj(freeRsvpEnTemplate, freeRsvpEnTemplate.previewData ?? {});

    expect(html).toContain("Hi Anna,");
    expect(html).toContain(txCopy("event_registered", "en").heading);
  });

  it("nieznany kod języka spada na polski, a nie na pustą wiadomość", async () => {
    // `readLang` (app-transactional-templates.tsx:12-14) zna tylko „en";
    // wszystko inne - w tym `de`, `null` i liczbę - traktuje jako polski.
    // To jest tutejszy spadek na język domyślny.
    const html = await wyrenderuj(freeRsvpPlTemplate, { lang: "de" });
    const niemowa = await wyrenderuj(freeRsvpPlTemplate, { lang: 7 });

    expect(html).toContain(txCopy("event_registered", "pl").heading);
    expect(niemowa).toContain(txCopy("event_registered", "pl").heading);
  });

  it("brak imienia w danych podstawia imię domyślne, nie puste powitanie", async () => {
    // Powitanie „Dzień dobry, " z wiszącym przecinkiem jest widoczne od razu.
    const html = await wyrenderuj(freeRsvpPlTemplate, {});

    expect(html).toContain("Dzień dobry, Anno");
    expect(html).not.toMatch(/Dzień dobry,\s*</);
  });

  it("imię o niewłaściwym typie jest odrzucane jak brak imienia", async () => {
    // Dane przychodzą jako `Record<string, unknown>` z API rejestru, więc
    // liczba w polu `firstName` nie jest hipotezą.
    const html = await wyrenderuj(freeRsvpPlTemplate, { firstName: 42, vocativePl: "   " });

    expect(html).toContain("Dzień dobry, Anno");
    expect(html).not.toContain("42");
  });

  it("wariant EN nie doskleja polskiego wołacza", async () => {
    const html = await wyrenderuj(donationReceivedEnTemplate, { lang: "en", firstName: "Anna" });

    expect(html).toContain("Hi Anna,");
    expect(html).not.toContain("Anno");
  });

  it("brak adresu CTA podstawia stronę główną, nie pusty przycisk", async () => {
    // Przycisk z pustym `href` prowadzi w mailu donikąd - to martwe CTA.
    const html = await wyrenderuj(newsletterConfirmedTemplate, { lang: "pl" });

    expect(html).toContain('href="https://neweuropeanstrategies.com"');
    expect(html).not.toContain('href=""');
  });

  it("szczegóły, które nie są tablicą, są pomijane bez wywracania renderu", async () => {
    const html = await wyrenderuj(donationReceivedPlTemplate, {
      lang: "pl",
      details: "to nie jest tablica",
    });

    expect(html).toContain(txCopy("donation_received", "pl").heading);
    expect(html).not.toContain("to nie jest tablica");
  });

  it("wiersz szczegółów o nieznanym kształcie jest odsiewany, reszta przechodzi", async () => {
    // Jeden zepsuty wiersz nie może skasować poprawnych - odbiorca ma dostać
    // tyle szczegółów, ile da się bezpiecznie pokazać.
    const html = await wyrenderuj(donationReceivedPlTemplate, {
      lang: "pl",
      details: [
        { label: "Kwota", value: "100,00 PLN" },
        { label: "Numer", value: 12345 },
        null,
        "śmieć",
        { value: "bez etykiety" },
      ],
    });

    expect(html).toContain("100,00 PLN");
    expect(html).not.toContain("12345");
    expect(html).not.toContain("bez etykiety");
  });

  it("temat bez nazwy przedmiotu nie zostawia wiszącego separatora", async () => {
    const zNazwa = temat(freeRsvpPlTemplate, { lang: "pl", subjectName: "Briefing" });
    const bezNazwy = temat(freeRsvpPlTemplate, { lang: "pl" });

    expect(zNazwa).toContain("Briefing");
    expect(bezNazwy).not.toMatch(/-\s*\|/);
    expect(bezNazwy).toContain("New European Strategies");
  });

  it("temat idzie za językiem podanym w danych, nie za nazwą wariantu", async () => {
    const en = temat(freeRsvpPlTemplate, { lang: "en", subjectName: "Briefing" });
    const pl = temat(freeRsvpPlTemplate, { lang: "pl", subjectName: "Briefing" });

    expect(en).not.toBe(pl);
    expect(en).toContain("Registration confirmed");
  });

  it("nazwa przedmiotu złożona z samych spacji jest traktowana jak brak nazwy", async () => {
    const spacje = temat(freeRsvpPlTemplate, { lang: "pl", subjectName: "   " });
    const brak = temat(freeRsvpPlTemplate, { lang: "pl" });

    expect(spacje).toBe(brak);
    expect(spacje).not.toMatch(/ {2}/);
  });
});
