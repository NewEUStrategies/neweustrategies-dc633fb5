// SMS w GSM-7: transliteracja, septety, data liczbowa, składanie treści.
//
// STAWKA. Jeden znak spoza GSM-7 przełącza cały SMS na UCS-2 (70 znaków na
// segment zamiast 160) - przypomnienie rozpada się na płatne części albo jest
// ucinane u operatora. Tytuł w stylu „Bezpieczeństwo łączności" i polska nazwa
// miesiąca („październik") to dokładnie ten przypadek, więc testujemy każdą
// literę z mapy, każdy miesiąc i budżet septetów z tabelą rozszerzeń.
import { describe, expect, it } from "vitest";

import {
  composeSmsBody,
  formatSmsMoment,
  gsm7Septets,
  isGsm7,
  transliterateToGsm7,
} from "@/lib/events/gsm7";

describe("transliterateToGsm7", () => {
  it.each([
    ["ą", "a"],
    ["ć", "c"],
    ["ę", "e"],
    ["ł", "l"],
    ["ń", "n"],
    ["ó", "o"],
    ["ś", "s"],
    ["ź", "z"],
    ["ż", "z"],
    ["Ą", "A"],
    ["Ć", "C"],
    ["Ę", "E"],
    ["Ł", "L"],
    ["Ń", "N"],
    ["Ó", "O"],
    ["Ś", "S"],
    ["Ź", "Z"],
    ["Ż", "Z"],
  ])("polska litera %s -> %s", (from, to) => {
    expect(transliterateToGsm7(from)).toBe(to);
  });

  it("„Bezpieczeństwo łączności” -> ASCII z cudzysłowami prostymi", () => {
    expect(transliterateToGsm7("„Bezpieczeństwo łączności”")).toBe('"Bezpieczenstwo lacznosci"');
  });

  it("Latin-1 spoza alfabetu -> litery bazowe, znaki alfabetu GSM zostają", () => {
    expect(transliterateToGsm7("áâãÀÁÂÃçêëÈÊËíîïÌÍÎÏðÐôõÒÔÕúûÙÚÛýÿÝ")).toBe(
      "aaaAAAAceeEEEiiiIIIIdDooOOOuuUUUyyY",
    );
    expect(transliterateToGsm7("þÞ")).toBe("thTh");
    expect(transliterateToGsm7("àèéìòùÇÉÄÖÑÜäöñüßÆæØøÅå")).toBe("àèéìòùÇÉÄÖÑÜäöñüßÆæØøÅå");
  });

  it("Latin Extended-A z mapy", () => {
    expect(transliterateToGsm7("čČďĎđĐěĚėĖğĞıİľĽĺĹňŇőŐřŘŕŔšŠşŞťŤţŢůŮűŰžŽ")).toBe(
      "cCdDdDeEeEgGiIlLlLnNoOrRrRsSsStTtTuUuUzZ",
    );
    expect(transliterateToGsm7("œŒ")).toBe("oeOE");
  });

  it("typografia: cudzysłowy, myślniki, wielokropek, spacje niełamiące, tabulator", () => {
    expect(transliterateToGsm7("‘a’ ‚b‛ ′ ‹c›")).toBe("'a' 'b' ' 'c'");
    expect(transliterateToGsm7("“d” „e‟ ″ «f»")).toBe('"d" "e" " "f"');
    expect(transliterateToGsm7("1‐2‑3‒4–5—6―7−8")).toBe("1-2-3-4-5-6-7-8");
    expect(transliterateToGsm7("x… •")).toBe("x... -");
    expect(transliterateToGsm7("a b c d e f\tg")).toBe("a b c d e f g");
  });

  it("litera z diakrytykiem spoza mapy: rozkład NFD, gdy daje literę GSM", () => {
    expect(transliterateToGsm7("ǎǐǒǔ")).toBe("aiou");
  });

  it("znak łączący zapisany osobno (NFC) daje literę GSM, gdy istnieje", () => {
    expect(transliterateToGsm7("é")).toBe("é");
    expect(transliterateToGsm7("ś")).toBe("s");
  });

  it("samotny znak łączący i pismo spoza łacinki -> ?", () => {
    expect(transliterateToGsm7("́")).toBe("?");
    expect(transliterateToGsm7("Олена")).toBe("?????");
    expect(transliterateToGsm7("😀")).toBe("?");
  });

  it("tabela rozszerzeń i nowa linia zostają", () => {
    expect(transliterateToGsm7("€[]{}\\^~|\n\r")).toBe("€[]{}\\^~|\n\r");
  });
});

describe("isGsm7 i gsm7Septets", () => {
  it("alfabet podstawowy i rozszerzenia są GSM-7, reszta nie", () => {
    expect(isGsm7("Forum 2030 @ £$¥ ΔΦ ¿¡ §")).toBe(true);
    expect(isGsm7("€ [x] {y} \\ ^ ~ |")).toBe(true);
    expect(isGsm7("ł")).toBe(false);
    expect(isGsm7("…")).toBe(false);
    expect(isGsm7("")).toBe(true);
  });

  it("znak rozszerzenia liczy się podwójnie", () => {
    expect(gsm7Septets("abc")).toBe(3);
    expect(gsm7Septets("€")).toBe(2);
    expect(gsm7Septets("[]{}\\^~|")).toBe(16);
    expect(gsm7Septets("")).toBe(0);
  });
});

describe("formatSmsMoment", () => {
  const PL_MONTHS = [
    "styczeń",
    "luty",
    "marzec",
    "kwiecień",
    "maj",
    "czerwiec",
    "lipiec",
    "sierpień",
    "wrzesień",
    "październik",
    "listopad",
    "grudzień",
  ];

  it.each(PL_MONTHS.map((name, index) => [name, index + 1]))(
    "miesiąc %s zapisany cyframi (GSM-7, bez nazwy)",
    (_name, month) => {
      const mm = String(month).padStart(2, "0");
      const value = formatSmsMoment(`2030-${mm}-15T10:05:00Z`, "UTC");
      expect(value).toBe(`15.${mm} 10:05`);
      expect(isGsm7(value)).toBe(true);
    },
  );

  it("strefa wydarzenia: Warszawa latem (+2) i zimą (+1), Nowy Jork", () => {
    expect(formatSmsMoment("2030-06-10T08:00:00Z", "Europe/Warsaw")).toBe("10.06 10:00");
    expect(formatSmsMoment("2030-01-10T08:00:00Z", "Europe/Warsaw")).toBe("10.01 09:00");
    expect(formatSmsMoment("2030-06-10T03:30:00Z", "America/New_York")).toBe("09.06 23:30");
  });

  it("północ to 00, nie 24 (hourCycle h23)", () => {
    expect(formatSmsMoment("2030-06-09T22:00:00Z", "Europe/Warsaw")).toBe("10.06 00:00");
  });

  it("zła strefa -> Europe/Warsaw", () => {
    expect(formatSmsMoment("2030-06-10T08:00:00Z", "Mars/Base")).toBe("10.06 10:00");
  });

  it("nieczytelna data -> pusty napis", () => {
    expect(formatSmsMoment("nie-data", "Europe/Warsaw")).toBe("");
  });
});

describe("composeSmsBody", () => {
  const template = (title: string): string =>
    `Przypomnienie: ${title} jutro 10.06 10:00. Szczegóły w e-mailu.`;

  it("transliteruje CAŁĄ treść - szablon i tytuł", () => {
    const body = composeSmsBody(template, "Bezpieczeństwo łączności");
    expect(body).toBe(
      "Przypomnienie: Bezpieczenstwo lacznosci jutro 10.06 10:00. Szczegoly w e-mailu.",
    );
    expect(isGsm7(body)).toBe(true);
  });

  it("przycina TYTUŁ z `...`, nigdy szablonu, i mieści się w 160 septetach", () => {
    const long = `Konferencja ${"bardzo długiego tytułu ".repeat(10)}`;
    const body = composeSmsBody(template, long);
    expect(gsm7Septets(body)).toBeLessThanOrEqual(160);
    expect(body.startsWith("Przypomnienie: Konferencja bardzo dlugiego tytulu")).toBe(true);
    expect(body).toMatch(/\.\.\. jutro 10\.06 10:00\. Szczegoly w e-mailu\.$/);
    expect(body).not.toMatch(/ \.\.\./);
  });

  it("tytuł ze znakami rozszerzeń liczy septety podwójnie", () => {
    const body = composeSmsBody((t) => `${"x".repeat(150)}${t}`, "€€€€€€");
    // Budżet 10: „€€€€€€" = 12 septetów -> miejsce na 7 przed `...` -> „€€€" (6).
    expect(body).toBe(`${"x".repeat(150)}€€€...`);
    expect(gsm7Septets(body)).toBe(159);
  });

  it("za mało miejsca nawet na `...` -> tytuł pominięty", () => {
    expect(composeSmsBody((t) => `${"x".repeat(158)}${t}`, "Forum")).toBe("x".repeat(158));
  });

  it("krótki tytuł przechodzi bez zmian (po przycięciu spacji)", () => {
    expect(composeSmsBody((t) => `Start: ${t}`, "  Forum  ", 20)).toBe("Start: Forum");
  });

  it("szablon dłuższy niż budżet -> sms_template_too_long", () => {
    expect(() => composeSmsBody(() => "x".repeat(161), "Forum")).toThrow("sms_template_too_long");
    expect(() => composeSmsBody(() => "€".repeat(81), "")).toThrow("sms_template_too_long");
  });

  it("własny budżet septetów", () => {
    expect(composeSmsBody((t) => `A ${t}`, "Bardzo długi tytuł", 10)).toBe("A Bardz...");
  });
});
