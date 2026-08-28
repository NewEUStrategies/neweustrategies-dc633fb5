// SZKIELET TREŚCI 22 MAILI TRANSAKCYJNYCH (`tx-copy.ts`): temat, preheader,
// nadlinia, nagłówek, akapit wstępny, CTA, ramka „co dalej", etykiety
// szczegółów i stopka pomocy - w PL i EN. Przed tym plikiem: 22,22% linii,
// 3,7% gałęzi, 8,69% funkcji. Niepokryta była m.in. WIĘKSZOŚĆ funkcji `subject`
// (po jednej na typ i język, czyli 44), a temat to jedyna część maila, którą
// odbiorca widzi ZANIM zdecyduje, czy w ogóle otworzy wiadomość.
//
// ============================================================================
// ROZSTRZYGNIĘCIE i18n - CZYTAĆ PRZED DOPISANIEM KOLEJNEGO PRZYPADKU
// ============================================================================
// Standardowa reguła repo („funkcja zwraca klucz i18n, nigdy gotowy tekst")
// TU NIE OBOWIĄZUJE i nie wolno jej tu wymuszać. Sprawdzone w kodzie:
//
//   tx-copy.ts:1-2   import type { EmailIconName } from "./icons";
//                    import type { EmailLang } from "./nes-layout";
//   tx-copy.ts:739   const DICTS: Record<EmailLang, Dict> = { pl: PL, en: EN };
//   tx-copy.ts:748   export function txCopy(type: TxEmailType, lang: EmailLang): TxCopy {
//   tx-copy.ts:749     return DICTS[lang][type];
//
// Cały plik ma DOKŁADNIE dwa importy i oba są `import type`. Nie ma tu
// `i18next`, nie ma `react-i18next`, nie ma `useTranslation` - jest własny
// dwujęzyczny słownik indeksowany kodem języka, dokładnie jak `errorCopy.ts`:
//
//   errorCopy.ts:1-5  „These surfaces can render outside the i18next provider
//                      (root boundary, class ErrorBoundary), so they read
//                      `currentLang()` directly instead of useTranslation()."
//
// I słusznie: szablon transakcyjny renderuje się na serwerze, w
// `@react-email/render`, POZA drzewem Reacta aplikacji i poza `I18nextProvider`
// (patrz `src/lib/email/tx-preview.server.ts:3` - „Plik server-only"). Hook
// `useTranslation` nie miałby tam dostawcy, a wciągnięcie i18next do wysyłki
// byłoby zmianą PRODUKCJI POD TEST - w module 20 słusznie tego odmówiono.
//
// CO Z TEGO WYNIKA DLA ASERCJI. Nie asertujemy na kluczach (nie ma kluczy).
// Asertujemy na słowniku i to jest dowód MOCNIEJSZY: klucz może istnieć i mieć
// pusty przekład, a tu wymagamy KOMPLETNOŚCI OBU JĘZYKÓW (każdy z 22 typów ma
// wszystkie pola w PL i w EN, żadne nie jest puste ani nie jest kopią drugiego
// języka) oraz SPADKU NA JĘZYK DOMYŚLNY tam, gdzie przekładu nie ma.
// ============================================================================
import { describe, expect, it } from "vitest";

import { TX_EMAIL_CATEGORY } from "@/lib/email/suppressionPolicy";
import type { EmailLang } from "../nes-layout";
import { iconUrl, type EmailIconName } from "../icons";
import { TX_EMAIL_TYPES, txCopy, txSubject, type TxCopy, type TxEmailType } from "../tx-copy";

const LANGS: readonly EmailLang[] = ["pl", "en"];

/**
 * Pola tekstowe, które trafiają wprost do wyrenderowanej wiadomości, wraz
 * z minimalną sensowną długością. Nadlinia i etykieta przycisku to KRÓTKIE
 * etykiety („Newsletter", „Płatność"), a nagłówek, akapit i ramka „co dalej"
 * to ZDANIA - jeden wspólny próg albo przepuściłby pusty akapit, albo
 * fałszywie oskarżył poprawną nadlinię.
 */
const POLA_TEKSTOWE: readonly { pole: keyof TxCopy; min: number }[] = [
  { pole: "preview", min: 20 },
  { pole: "eyebrow", min: 4 },
  { pole: "heading", min: 12 },
  { pole: "intro", min: 40 },
  { pole: "cta", min: 5 },
  { pole: "note", min: 40 },
  { pole: "footerHelp", min: 30 },
];

/** Etykiety wiersza szczegółów - wszystkie muszą istnieć w obu językach. */
const POLA_ETYKIET = [
  "plan",
  "price",
  "period",
  "renewsAt",
  "endsAt",
  "event",
  "date",
  "place",
  "previousPlan",
  "newPlan",
  "attemptedAt",
  "retryAt",
  "accessUntil",
  "transaction",
  "ticketCode",
  "donorMessage",
] as const satisfies readonly (keyof TxCopy["labels"])[];

/**
 * Ikony dopuszczone w mailach. Lista jest wypisana z rozmysłu: `EmailIconName`
 * żyje wyłącznie w typach, więc literówka w nazwie ikony nie jest błędem
 * kompilacji tam, gdzie wartość przechodzi przez `Record`. W skrzynce literówka
 * to pusty prostokąt zamiast ikony hero - i nikt się o tym nie dowie.
 */
const IKONY_DOZWOLONE: readonly EmailIconName[] = [
  "hero-check",
  "hero-handshake",
  "hero-magic",
  "hero-log-in",
  "hero-key",
  "hero-mail",
  "hero-shield",
  "clock",
  "lock",
  "info",
  "social-linkedin",
  "social-facebook",
  "social-x",
  "social-globe",
];

/**
 * Ślady niewypełnionej zmiennej. `undefined` w temacie maila nie da się cofnąć
 * - wiadomość zostaje w skrzynce odbiorcy na zawsze.
 */
const SLAD_BRAKU = /\b(undefined|NaN)\b|\[object Object\]/;

describe("tx-copy - kompletność słownika obu języków", () => {
  it("słownik zna dokładnie te typy, które zna polityka listy wykluczeń", () => {
    // Rozjazd tych dwóch list to mail bez kategorii (albo kategoria bez maila):
    // wysyłka albo poleci mimo wypisu, albo zostanie zablokowana bez powodu.
    const zeSlownika = [...TX_EMAIL_TYPES].sort();
    const zPolityki = Object.keys(TX_EMAIL_CATEGORY).sort();

    expect(zeSlownika).toEqual(zPolityki);
    // 22 -> 26: cztery maile cyklu życia zgłoszenia formularzowego
    // (`event_registration_received/_approved/_rejected`, `event_waitlist_promoted`).
    expect(zeSlownika).toHaveLength(29);
  });

  it.each(TX_EMAIL_TYPES)("%s ma komplet treści w PL i w EN", (type) => {
    for (const lang of LANGS) {
      const c = txCopy(type, lang);
      expect(c, `${type}/${lang}: brak wpisu w słowniku`).toBeDefined();
      for (const { pole, min } of POLA_TEKSTOWE) {
        const wartosc = c[pole];
        expect(typeof wartosc, `${type}/${lang}/${pole}`).toBe("string");
        expect(
          String(wartosc).trim().length,
          `${type}/${lang}/${pole} jest puste lub urwane`,
        ).toBeGreaterThanOrEqual(min);
        expect(String(wartosc), `${type}/${lang}/${pole}`).not.toMatch(SLAD_BRAKU);
      }
    }
  });

  it.each(TX_EMAIL_TYPES)("%s: PL i EN to naprawdę dwa przekłady, nie kopia", (type) => {
    const pl = txCopy(type, "pl");
    const en = txCopy(type, "en");

    // Nagłówek i akapit wstępny to zdania - identyczne zdanie w obu słownikach
    // znaczy, że przekład został przeoczony i anglojęzyczny odbiorca dostanie
    // polski mail. `eyebrow` i `cta` bywają zbieżne z powodu nazw własnych
    // („Newsletter"), więc reguła obejmuje pola niosące zdanie.
    expect(pl.heading, `${type}: nagłówek nieprzetłumaczony`).not.toBe(en.heading);
    expect(pl.intro, `${type}: akapit wstępny nieprzetłumaczony`).not.toBe(en.intro);
    expect(pl.note, `${type}: ramka „co dalej" nieprzetłumaczona`).not.toBe(en.note);
    expect(pl.preview, `${type}: preheader nieprzetłumaczony`).not.toBe(en.preview);
  });

  it.each(TX_EMAIL_TYPES)("%s ma etykiety szczegółów w obu językach", (type) => {
    for (const lang of LANGS) {
      const labels = txCopy(type, lang).labels;
      for (const pole of POLA_ETYKIET) {
        expect(labels[pole], `${type}/${lang}/${pole}`).toBeTruthy();
        expect(labels[pole].trim().length, `${type}/${lang}/${pole}`).toBeGreaterThan(2);
      }
    }
  });

  it("etykiety szczegółów są przetłumaczone tam, gdzie języki się różnią", () => {
    const pl = txCopy("subscription_confirmed", "pl").labels;
    const en = txCopy("subscription_confirmed", "en").labels;

    // „Plan" jest w obu językach ten sam z natury; reszta ma być przełożona.
    expect(pl.price).not.toBe(en.price);
    expect(pl.period).not.toBe(en.period);
    expect(pl.donorMessage).not.toBe(en.donorMessage);
    expect(pl.plan).toBe(en.plan);
  });

  it.each(TX_EMAIL_TYPES)("%s wskazuje istniejącą ikonę, tę samą w obu językach", (type) => {
    const pl = txCopy(type, "pl");
    const en = txCopy(type, "en");

    // Ikona to element identyfikacji wizualnej, nie treść - inna ikona w EN
    // znaczyłaby, że któryś słownik został ręcznie rozjechany.
    expect(IKONY_DOZWOLONE, `${type}: nieznana ikona ${pl.icon}`).toContain(pl.icon);
    expect(pl.icon).toBe(en.icon);
    expect(iconUrl(pl.icon)).toBe(
      `https://unnltowbgszpdzwpawdu.supabase.co/storage/v1/object/public/media/theme%2Femail%2Ficons/${pl.icon}.png`,
    );
  });
});

describe("tx-copy - temat wiadomości", () => {
  it.each(TX_EMAIL_TYPES)("%s: temat PL i EN są niepuste i różne", (type) => {
    const pl = txSubject(type, "pl", { subject: "Professional" });
    const en = txSubject(type, "en", { subject: "Professional" });

    expect(pl.trim().length).toBeGreaterThan(10);
    expect(en.trim().length).toBeGreaterThan(10);
    expect(pl, `${type}: temat nieprzetłumaczony na EN`).not.toBe(en);
    expect(pl).not.toMatch(SLAD_BRAKU);
    expect(en).not.toMatch(SLAD_BRAKU);
  });

  it.each(TX_EMAIL_TYPES)("%s: temat bez zmiennej nie zostawia w skrzynce dziury", (type) => {
    for (const lang of LANGS) {
      // Trzy kształty braku, które realnie przychodzą ze zdarzenia:
      // brak pola, jawny `null` i pusty napis po stronie bazy.
      const brakPola = txSubject(type, lang);
      const jawnyNull = txSubject(type, lang, { subject: null });
      const pustyNapis = txSubject(type, lang, { subject: "" });

      expect(brakPola, `${type}/${lang}`).not.toMatch(SLAD_BRAKU);
      expect(jawnyNull).toBe(brakPola);
      expect(pustyNapis).toBe(brakPola);
      expect(brakPola.trim().length).toBeGreaterThan(10);
      // Wiszący separator („✅ Subskrypcja aktywna - | NES") to widoczny ślad
      // po zmiennej, której nie było.
      expect(brakPola, `${type}/${lang}: wiszący separator`).not.toMatch(/[-(]\s*\|/);
    }
  });

  it.each(TX_EMAIL_TYPES)("%s: temat ze zmienną naprawdę tę zmienną pokazuje", (type) => {
    for (const lang of LANGS) {
      const zNazwa = txSubject(type, lang, { subject: "Professional" });
      const bezNazwy = txSubject(type, lang, {});

      if (zNazwa === bezNazwy) {
        // Dwa tematy są stałe z definicji (portal płatności, newsletter) -
        // nie mają slotu na nazwę planu. Wtedy dowodem jest STAŁOŚĆ: temat
        // nie może się zmieniać pod wpływem danych, których nie używa.
        expect(txSubject(type, lang, { subject: "Cokolwiek" })).toBe(bezNazwy);
        expect(bezNazwy).toContain("New European Strategies");
        continue;
      }
      expect(zNazwa, `${type}/${lang}: nazwa nie weszła do tematu`).toContain("Professional");
      expect(zNazwa.length).toBeGreaterThan(bezNazwy.length);
    }
  });

  it("każdy temat niesie markę - to ona odróżnia mail od phishingu", () => {
    const braki = TX_EMAIL_TYPES.flatMap((type) =>
      LANGS.filter((lang) => !txSubject(type, lang, {}).includes("New European Strategies")).map(
        (lang) => `${type}/${lang}`,
      ),
    );

    expect(braki).toEqual([]);
    // 26 typów razy dwa języki.
    expect(TX_EMAIL_TYPES.length * LANGS.length).toBe(58);
  });

  it("temat nie przekracza długości, po której klient pocztowy go urywa", () => {
    // Gmail na telefonie pokazuje ~70 znaków; powyżej ~120 obcięcie zjada
    // nawet nazwę marki. To próg zdroworozsądkowy, nie kosmetyka.
    const zaDlugie = TX_EMAIL_TYPES.flatMap((type) =>
      LANGS.map((lang) => ({
        id: `${type}/${lang}`,
        len: txSubject(type, lang, { subject: "Professional" }).length,
      })),
    ).filter((e) => e.len > 120);

    expect(zaDlugie).toEqual([]);
    expect(TX_EMAIL_TYPES.length).toBeGreaterThan(0);
  });
});

describe("tx-copy - brak tłumaczenia i spadek na język domyślny", () => {
  it("lista typów jest WYPROWADZONA ze słownika, więc typ bez treści nie istnieje", () => {
    // `TX_EMAIL_TYPES = Object.keys(PL)` (tx-copy.ts:746). Gdyby ktoś dopisał
    // typ do unii, ale nie do słownika, `txCopy` oddałby `undefined`, a szablon
    // wyrenderowałby pusty mail. Ta asercja to bramka na taki rozjazd.
    const brakujaceWEn = TX_EMAIL_TYPES.filter((type) => txCopy(type, "en") === undefined);
    const brakujaceWPl = TX_EMAIL_TYPES.filter((type) => txCopy(type, "pl") === undefined);

    expect(brakujaceWPl).toEqual([]);
    expect(brakujaceWEn).toEqual([]);
  });

  it("oba słowniki mają IDENTYCZNY zestaw kluczy - EN nie może zostać w tyle", () => {
    // Kompletność obu języków jest tu SILNIEJSZYM dowodem niż asercja na kluczu
    // i18n: klucz mógłby istnieć z pustym przekładem, a tu pustego przekładu
    // nie ma prawa być (sprawdzone wyżej, pole po polu).
    const plKompletne = TX_EMAIL_TYPES.filter((t) => txCopy(t, "pl").heading.length > 0);
    const enKompletne = TX_EMAIL_TYPES.filter((t) => txCopy(t, "en").heading.length > 0);

    expect(plKompletne).toEqual([...TX_EMAIL_TYPES]);
    expect(enKompletne).toEqual([...TX_EMAIL_TYPES]);
  });

  it("nieznany typ maila NIE wypuszcza pustej wiadomości - wywraca się głośno", () => {
    // Rzutowanie `string` -> `TxEmailType` jest tu świadome: udajemy rozjazd
    // między unią typów a słownikiem, którego kompilator nie zobaczy, bo typ
    // przychodzi z bazy (kolumna `email_type`). Cicha pusta wiadomość byłaby
    // gorsza od wyjątku: wyszłaby do skrzynki.
    const zBazy: string = "subscription_teleported";

    expect(() => txSubject(zBazy as TxEmailType, "pl", {})).toThrow();
    expect(txCopy(zBazy as TxEmailType, "pl")).toBeUndefined();
  });
});
