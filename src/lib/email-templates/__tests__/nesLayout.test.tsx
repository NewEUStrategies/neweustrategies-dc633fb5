// WSPÓLNA RAMKA WSZYSTKICH MAILI SYSTEMOWYCH (`nes-layout.tsx`, `icons.tsx`,
// `social.ts`). Ten jeden komponent otacza KAŻDĄ wiadomość, jaką platforma
// wysyła - autoryzacyjną i transakcyjną. Jego gałęzie decydują o tym, czy
// odbiorca zobaczy nadlinię, tytuł i ikonę hero, oraz czy w stopce znajdzie
// adres fundacji zgodny z językiem wiadomości. Przed tym plikiem gałęzie
// ramki stały na 41-75%: warianty BEZ nadlinii, BEZ tytułu i BEZ ikony nigdy
// nie zostały wyrenderowane, choć typ dopuszcza je wszystkie.
//
// ROZSTRZYGNIĘCIE i18n (pełne uzasadnienie w `txCopy.test.ts`). Ramka NIE
// korzysta z i18next - trzyma własny słownik stopki, indeksowany kodem języka
// (nes-layout.tsx:47 `const FOOTER_COPY = { pl: {...}, en: {...} } as const;`,
// odczyt w linii 80 `const f = FOOTER_COPY[lang];`). Jedyne importy tego pliku
// to `react`, `@react-email/components`, `./icons` i `./social`. Renderowanie
// idzie przez `@react-email/render` na serwerze, poza `I18nextProvider`,
// dokładnie jak `errorCopy.ts` przy granicy błędu - dlatego asertujemy na
// kompletności słownika stopki, a nie na kluczach.
//
// Zegar jest zamrożony, bo stopka drukuje ROK w nocie o prawach autorskich
// (nes-layout.tsx:172 `© {new Date().getFullYear()}`). Bez zamrożenia test
// przechodziłby dziś i pękł 1 stycznia.
import * as React from "react";

import { render } from "@react-email/render";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { EmailIcon, IconRow, iconUrl } from "../icons";
import { NesEmailLayout, SecurityNote, infoText, text, type EmailLang } from "../nes-layout";
import { NES_CONTACT, NES_SOCIAL_LINKS } from "../social";

const LANGS: readonly EmailLang[] = ["pl", "en"];

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-22T10:00:00.000Z"));
});

afterAll(() => {
  vi.useRealTimers();
});

const ramka = (props: {
  lang: EmailLang;
  eyebrow?: string;
  heading?: string;
  icon?: "hero-check";
}) =>
  render(
    <NesEmailLayout
      lang={props.lang}
      preview="Podgląd wiadomości"
      siteUrl="https://neweuropeanstrategies.com"
      eyebrow={props.eyebrow}
      heading={props.heading}
      icon={props.icon}
    >
      <p>Treść wiadomości</p>
    </NesEmailLayout>,
  );

describe("NesEmailLayout - hero bez kompletu pól", () => {
  it("pełne hero pokazuje nadlinię, tytuł i ikonę", async () => {
    const html = await ramka({
      lang: "pl",
      eyebrow: "Aktywacja konta",
      heading: "Potwierdź adres e-mail",
      icon: "hero-check",
    });

    expect(html).toContain("Aktywacja konta");
    expect(html).toContain("Potwierdź adres e-mail");
    expect(html).toContain(iconUrl("hero-check"));
  });

  it("wiadomość BEZ nadlinii, tytułu i ikony nadal ma logo i treść", async () => {
    // Wszystkie trzy pola są opcjonalne w typie, więc ten wariant jest realny.
    // Gdyby brak ikony wywracał render, mail w ogóle by nie wyszedł - a to
    // dokładnie ta gałąź, której nikt przed tym testem nie uruchomił.
    const html = await ramka({ lang: "pl" });

    expect(html).toContain("Treść wiadomości");
    expect(html).toContain("New European Strategies");
    expect(html).not.toContain(iconUrl("hero-check"));
    expect(html).not.toContain("undefined");
  });

  it("sama nadlinia bez tytułu nie zostawia pustego nagłówka", async () => {
    const html = await ramka({ lang: "pl", eyebrow: "Portal płatności" });

    expect(html).toContain("Portal płatności");
    expect(html).not.toContain("undefined");
  });

  it("sam tytuł bez nadlinii renderuje się poprawnie", async () => {
    const html = await ramka({ lang: "en", heading: "Your subscription is active" });

    expect(html).toContain("Your subscription is active");
    expect(html).not.toContain("undefined");
  });
});

describe("NesEmailLayout - stopka w języku wiadomości", () => {
  it.each(LANGS)("stopka %s ma komplet: claim, tagline, linki i notę automatu", async (lang) => {
    const html = await ramka({ lang, heading: "Tytuł" });

    // Stopka niesie obowiązek informacyjny (adres fundacji, kontakt) - brak
    // któregokolwiek elementu to mail bez wymaganej stopki, nie kosmetyka.
    expect(html).toContain("neweuropeanstrategies.com");
    expect(html).toContain(NES_CONTACT.email);
    expect(html).toContain(NES_CONTACT.phone);
    expect(html).toContain(lang === "pl" ? "Polityka prywatności" : "Privacy policy");
    expect(html).toContain(lang === "pl" ? "WIEDZA" : "KNOWLEDGE");
  });

  it("polska wersja podaje polski adres fundacji", async () => {
    const html = await ramka({ lang: "pl", heading: "Tytuł" });

    expect(html).toContain("00-613 Warszawa");
    expect(html).not.toContain("00-613 Warsaw, Poland");
  });

  it("angielska wersja podaje adres po angielsku", async () => {
    // Ten sam adres, inny zapis - polski adres w mailu EN czyta się jak błąd
    // wysyłki do niewłaściwego odbiorcy.
    const html = await ramka({ lang: "en", heading: "Title" });

    expect(html).toContain("Warsaw, Poland");
    expect(html).not.toContain("00-613 Warszawa");
  });

  it("nota o prawach autorskich niesie bieżący rok, nie rok wdrożenia", async () => {
    // React rozdziela sąsiadujące węzły tekstowe znacznikiem `<!-- -->`,
    // więc porównujemy treść po ich usunięciu - inaczej test mówiłby
    // o szczegółach serializatora, a nie o tym, co widzi odbiorca.
    const html = (await ramka({ lang: "pl", heading: "Tytuł" })).replaceAll("<!-- -->", "");

    expect(html).toContain("© 2026 New European Strategies");
    expect(html).not.toContain("NaN");
  });

  it("stopka linkuje wszystkie profile social z ich glifami", async () => {
    const html = await ramka({ lang: "pl", heading: "Tytuł" });

    for (const link of NES_SOCIAL_LINKS) {
      expect(html, `brak profilu ${link.key}`).toContain(link.href);
      expect(html, `brak ikony ${link.icon}`).toContain(iconUrl(link.icon));
    }
    expect(NES_SOCIAL_LINKS.length).toBeGreaterThan(0);
  });

  it("adresy profili są bezwzględne i szyfrowane - inaczej klient pocztowy je zerwie", async () => {
    const zle = NES_SOCIAL_LINKS.filter((l) => !l.href.startsWith("https://"));

    expect(zle).toEqual([]);
    expect(new Set(NES_SOCIAL_LINKS.map((l) => l.key)).size).toBe(NES_SOCIAL_LINKS.length);
  });
});

describe("SecurityNote - etykieta noty bezpieczeństwa", () => {
  it("bez podanej etykiety bierze domyślną w języku wiadomości", async () => {
    const pl = await render(<SecurityNote lang="pl">Nie prosiłeś o zmianę hasła?</SecurityNote>);
    const en = await render(<SecurityNote lang="en">Not you?</SecurityNote>);

    expect(pl).toContain("Bezpieczeństwo");
    expect(en).toContain("Security");
  });

  it("podana etykieta wygrywa z domyślną", async () => {
    // Nadpisanie etykiety jest używane tam, gdzie nota nie mówi o
    // bezpieczeństwie - domyślna byłaby wtedy myląca.
    const html = await render(
      <SecurityNote lang="pl" label="Co dalej">
        Treść noty
      </SecurityNote>,
    );

    expect(html).toContain("Co dalej");
    expect(html).not.toContain("Bezpieczeństwo");
  });
});

describe("EmailIcon i IconRow - ikony jako obrazy, nie SVG", () => {
  it("ikona renderuje się jako obraz PNG ze storage, bo klienty usuwają SVG", async () => {
    const html = await render(React.createElement(EmailIcon, { name: "clock" }));

    expect(html).toContain(iconUrl("clock"));
    expect(html).toContain('width="16"');
  });

  it("podany rozmiar i tekst alternatywny trafiają do znacznika", async () => {
    const html = await render(
      React.createElement(EmailIcon, { name: "lock", size: 30, alt: "Kłódka" }),
    );

    expect(html).toContain('width="30"');
    expect(html).toContain('alt="Kłódka"');
  });

  it("wiersz ikona+tekst dziedziczy margines ze stylu tekstu", async () => {
    const html = await render(
      <IconRow name="info" textStyle={text}>
        Treść wiersza
      </IconRow>,
    );

    expect(html).toContain("Treść wiersza");
    expect(html).toContain(iconUrl("info"));
  });

  it("styl tekstu BEZ marginesu nie wstawia do tabeli marginesu undefined", async () => {
    // `margin: textStyle.margin ?? 0` (icons.tsx:69). Bez tej gałęzi Outlook
    // dostałby `margin: undefined` w atrybucie style i rozjechałby wiersz.
    const bezMarginesu: React.CSSProperties = { fontSize: "12px", color: "#55575d" };
    const html = await render(
      <IconRow name="info" size={20} textStyle={bezMarginesu}>
        Bez marginesu
      </IconRow>,
    );

    expect(html).not.toContain("margin:undefined");
    expect(html).toContain("Bez marginesu");
  });

  it("styl z jawnym zerowym marginesem zachowuje zero, nie podmienia go", async () => {
    const html = await render(
      <IconRow name="info" textStyle={infoText}>
        Zerowy margines
      </IconRow>,
    );

    expect(html).toContain("Zerowy margines");
    expect(html).not.toContain("undefined");
  });
});
