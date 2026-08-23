// SZABLONY MAILI AUTORYZACYJNYCH (`signup`, `invite`, `magic-link`,
// `recovery`, `email_change`, `reauthentication`) i ich słownik treści
// (`copy.ts`). To jedyne wiadomości, bez których użytkownik NIE WEJDZIE na
// konto: potwierdzenie adresu, reset hasła, kod drugiego składnika. Każda
// niedziałająca gałąź jest tu równa zablokowanemu logowaniu.
//
// Podgląd panelu (`auth-preview.server.ts`) renderuje te szablony zawsze
// z KOMPLETEM danych demonstracyjnych, więc jego test nie dotyka ani gałęzi
// „adres podano tylko z jednej strony", ani domyślnego adresu witryny, ani
// dwóch pomocniczych funkcji słownika (`authIcon`, `authSubject`, copy.ts:263
// i 267 - dwie funkcje bez jednego wykonania przed tym plikiem).
//
// ROZSTRZYGNIĘCIE i18n (pełne uzasadnienie w `txCopy.test.ts`). `copy.ts` ma
// trzy importy i wszystkie są `import type` (copy.ts:1-3); nie ma tu i18next.
// Język wybiera własny słownik: `const raw = (lang === "en" ? EN : PL)[type];`
// (copy.ts:247) - i to jest zarazem tutejszy SPADEK NA JĘZYK DOMYŚLNY: cokolwiek
// nie jest angielskim, dostaje polski. Szablon renderuje `@react-email/render`
// na serwerze, poza `I18nextProvider`, tak jak `errorCopy.ts` przy granicy
// błędu - dlatego asertujemy na kompletności obu słowników, nie na kluczach.
//
// Zegar zamrożony: stopka ramki drukuje bieżący rok.
import * as React from "react";

import { render } from "@react-email/render";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { authCopy, authIcon, authSubject, EMAIL_CHANGE_LABELS, type AuthEmailType } from "../copy";
import { EmailChangeEmail } from "../email-change";
import { InviteEmail } from "../invite";
import { MagicLinkEmail } from "../magic-link";
import type { EmailLang } from "../nes-layout";
import { ReauthenticationEmail } from "../reauthentication";
import { RecoveryEmail } from "../recovery";
import { SignupEmail } from "../signup";

const LANGS: readonly EmailLang[] = ["pl", "en"];

const TYPY: readonly AuthEmailType[] = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "reauthentication",
];

const LINK = "https://neweuropeanstrategies.com/auth/confirm?token=demo";

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-22T10:00:00.000Z"));
});

afterAll(() => {
  vi.useRealTimers();
});

describe("copy.ts - kompletność słownika maili autoryzacyjnych", () => {
  it.each(TYPY)("%s ma komplet treści w PL i w EN", (type) => {
    for (const lang of LANGS) {
      const c = authCopy(type, lang);
      // `cta` i `fallback` są celowo puste dla kodu weryfikacyjnego - tamten
      // szablon nie ma przycisku ani linku zastępczego, bo kod się przepisuje.
      // Reszta pól idzie do treści zawsze i pusta być nie może.
      const pola = [c.subject, c.preview, c.eyebrow, c.heading, c.intro, c.security, c.expiry];

      expect(
        pola.filter((p) => !p || p.trim().length < 4),
        `${type}/${lang}`,
      ).toEqual([]);
      expect(
        pola.some((p) => p.includes("undefined")),
        `${type}/${lang}`,
      ).toBe(false);
    }
  });

  it("szablony z przyciskiem mają etykietę CTA i tekst zastępczy w obu językach", () => {
    // Pusty `cta` w szablonie, który RYSUJE przycisk, daje przycisk bez napisu.
    const zPrzyciskiem: readonly AuthEmailType[] = [
      "signup",
      "invite",
      "magiclink",
      "recovery",
      "email_change",
    ];
    const braki = zPrzyciskiem.flatMap((type) =>
      LANGS.filter((lang) => {
        const c = authCopy(type, lang);
        return !c.cta.trim() || !c.fallback.trim();
      }).map((lang) => `${type}/${lang}`),
    );

    expect(braki).toEqual([]);
    expect(authCopy("reauthentication", "pl").cta).toBe("");
  });

  it.each(TYPY)("%s: PL i EN to dwa przekłady, nie jedna wersja", (type) => {
    const pl = authCopy(type, "pl");
    const en = authCopy(type, "en");

    expect(pl.subject).not.toBe(en.subject);
    expect(pl.intro).not.toBe(en.intro);
    expect(pl.security).not.toBe(en.security);
  });

  it("temat wyciągnięty skrótem jest tym samym tematem co pełna treść", () => {
    // `authSubject` używa webhook wysyłki - rozjazd z `authCopy` znaczyłby, że
    // odbiorca widzi w skrzynce inny temat niż redakcja w podglądzie.
    const braki = TYPY.flatMap((type) =>
      LANGS.filter((lang) => authSubject(type, lang) !== authCopy(type, lang).subject).map(
        (lang) => `${type}/${lang}`,
      ),
    );

    expect(braki).toEqual([]);
    expect(authSubject("recovery", "pl").length).toBeGreaterThan(10);
  });

  it("ikona nagłówka jest ta sama w obu językach i niezależna od rodzaju", () => {
    // `authIcon` czyta słownik z pominięciem rozstrzygania rodzaju - to jest
    // jego cała rola i jedyny powód, dla którego istnieje osobno.
    const rozjazdy = TYPY.filter((type) => authIcon(type, "pl") !== authIcon(type, "en"));

    expect(rozjazdy).toEqual([]);
    expect(authIcon("signup", "pl")).toBe(authCopy("signup", "pl", "female").icon);
  });

  it("wersja angielska nie odmienia się przez rodzaj gramatyczny", () => {
    // `lang === "en" ? "unknown" : gender` (copy.ts:248). Angielszczyzna nie
    // ma tu form osobowych; przekazanie rodzaju dalej byłoby błędem cichym.
    const male = authCopy("recovery", "en", "male");
    const female = authCopy("recovery", "en", "female");

    expect(male.security).toBe(female.security);
    expect(male.intro).toBe(female.intro);
  });

  it("etykiety zmiany adresu istnieją w obu językach i są przetłumaczone", () => {
    expect(EMAIL_CHANGE_LABELS.pl.from).not.toBe(EMAIL_CHANGE_LABELS.en.from);
    expect(EMAIL_CHANGE_LABELS.pl.to).not.toBe(EMAIL_CHANGE_LABELS.en.to);
  });
});

describe("szablony autoryzacyjne - render w obu językach", () => {
  it.each(LANGS)("potwierdzenie rejestracji (%s) niesie link i ostrzeżenie", async (lang) => {
    const html = await render(
      React.createElement(SignupEmail, {
        siteUrl: "https://neweuropeanstrategies.com",
        confirmationUrl: LINK,
        lang,
      }),
    );
    const c = authCopy("signup", lang);

    expect(html).toContain(LINK);
    expect(html).toContain(c.cta);
    expect(html).toContain(lang === "pl" ? "Bezpieczeństwo" : "Security");
    expect(html).not.toContain("undefined");
  });

  it.each(LANGS)("zaproszenie (%s) niesie link i tekst zastępczy", async (lang) => {
    const html = await render(
      React.createElement(InviteEmail, {
        siteUrl: "https://neweuropeanstrategies.com",
        confirmationUrl: LINK,
        lang,
        firstName: "Anna",
        gender: "female",
      }),
    );

    expect(html).toContain(authCopy("invite", lang, "female").fallback);
    expect(html).toContain(LINK);
  });

  it("link magiczny działa bez podanego adresu witryny", async () => {
    // `siteUrl` ma wartość domyślną, bo webhook Supabase nie zawsze ją podaje.
    // Brak adresu w stopce znaczyłby link „donikąd" w każdej wiadomości.
    const html = await render(React.createElement(MagicLinkEmail, { confirmationUrl: LINK }));

    expect(html).toContain("https://neweuropeanstrategies.com");
    expect(html).toContain(authCopy("magiclink", "pl").heading);
  });

  it("reset hasła bez podanego adresu witryny też ma poprawną stopkę", async () => {
    const html = await render(React.createElement(RecoveryEmail, { confirmationUrl: LINK }));

    expect(html).toContain("https://neweuropeanstrategies.com/polityka-prywatnosci");
    expect(html).toContain(authCopy("recovery", "pl").cta);
  });

  it("angielski reset hasła i angielski link magiczny mają angielską notę pomocy", async () => {
    // Polska nota pomocy w mailu EN to jedyny polski tekst, jaki zobaczy
    // anglojęzyczny odbiorca - i zobaczy go na końcu wiadomości o resecie hasła.
    const reset = await render(
      React.createElement(RecoveryEmail, { confirmationUrl: LINK, lang: "en" }),
    );
    const magic = await render(
      React.createElement(MagicLinkEmail, { confirmationUrl: LINK, lang: "en" }),
    );

    expect(reset).toContain("Need help?");
    expect(reset).not.toContain("Potrzebujesz pomocy?");
    expect(magic).toContain("Need help?");
    expect(magic).not.toContain("Potrzebujesz pomocy?");
  });

  it("ponowne uwierzytelnienie pokazuje kod, a nie przycisk", async () => {
    // Kod przepisuje się ręcznie - gdyby zniknął z treści, drugi składnik
    // byłby nie do przejścia.
    const html = await render(React.createElement(ReauthenticationEmail, { token: "482 915" }));

    expect(html).toContain("482 915");
    expect(html).toContain(authCopy("reauthentication", "pl").expiry);
  });

  it("ponowne uwierzytelnienie po angielsku używa angielskiej noty", async () => {
    const html = await render(
      React.createElement(ReauthenticationEmail, {
        token: "482 915",
        lang: "en",
        siteUrl: "https://neweuropeanstrategies.com",
      }),
    );

    expect(html).toContain("Security");
    expect(html).toContain("Need help?");
  });
});

describe("zmiana adresu e-mail - ramka z adresami", () => {
  it("oba adresy pokazują się z etykietami w języku wiadomości", async () => {
    const html = await render(
      React.createElement(EmailChangeEmail, {
        confirmationUrl: LINK,
        oldEmail: "stary@example.com",
        newEmail: "nowy@example.com",
        lang: "pl",
      }),
    );

    expect(html).toContain("Obecny adres");
    expect(html).toContain("stary@example.com");
    expect(html).toContain("Nowy adres");
    expect(html).toContain("nowy@example.com");
  });

  it("sam nowy adres nie drukuje pustego wiersza „obecny adres”", async () => {
    // Supabase potrafi nie podać poprzedniego adresu. Pusty wiersz z etykietą
    // czyta się jak „usunęliśmy twój stary adres" - i generuje zgłoszenie.
    const html = await render(
      React.createElement(EmailChangeEmail, {
        confirmationUrl: LINK,
        newEmail: "nowy@example.com",
        lang: "pl",
      }),
    );

    expect(html).toContain("nowy@example.com");
    expect(html).not.toContain("Obecny adres");
  });

  it("sam poprzedni adres nie drukuje pustego wiersza z nowym adresem", async () => {
    const html = await render(
      React.createElement(EmailChangeEmail, {
        confirmationUrl: LINK,
        oldEmail: "stary@example.com",
        lang: "en",
      }),
    );

    expect(html).toContain("stary@example.com");
    expect(html).not.toContain("New address");
  });

  it("bez żadnego adresu ramka znika, a wiadomość nadal ma link potwierdzający", async () => {
    // To najuboższy realny wariant. Gdyby zniknął też przycisk, użytkownik
    // nie miałby jak zatwierdzić zmiany adresu i straciłby dostęp do konta.
    const html = await render(
      React.createElement(EmailChangeEmail, { confirmationUrl: LINK, lang: "pl" }),
    );

    expect(html).toContain(LINK);
    expect(html).not.toContain("Obecny adres");
    expect(html).not.toContain("Nowy adres");
  });
});
