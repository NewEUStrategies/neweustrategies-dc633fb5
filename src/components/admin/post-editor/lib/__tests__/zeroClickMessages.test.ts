// CO DOWODZI TEN PLIK: pomiar bez komunikatu jest bezużyteczny, a komunikat
// niezgodny z pomiarem jest gorszy niż jego brak - redaktor dostaje instrukcję
// naprawy czegoś, czego nie zmierzono, i traci zaufanie do całej checklisty.
//
// Dwie rzeczy nie mają innego strażnika:
//   1. Ten sam `warn` niesie RÓŻNE prace („lead za krótki" vs „lead zaczyna się
//      rozbiegówką"). Rozróżnia je `reason` - gdyby mapowanie je zlało, panel
//      kazałby dopisywać słowa do akapitu, który trzeba przepisać od nowa.
//   2. Liczby w komunikacie muszą pochodzić z `ZERO_CLICK_BUDGETS`, nie być
//      wpisane w tłumaczenie. Inaczej zmiana progu przesuwa pomiar, a copy
//      dalej mówi starą liczbę.
import { describe, it, expect } from "vitest";
import { ZERO_CLICK_BUDGETS, type ZeroClickCheck } from "@/lib/seo/zeroClick";
import { zeroClickMessage, zeroClickRuleTitleKey } from "../zeroClickMessages";

describe("zeroClickRuleTitleKey", () => {
  it("kieruje w gałąź `rules` słownika ściągawki", () => {
    expect(zeroClickRuleTitleKey("lead")).toBe("adminZeroClick.rules.lead.title");
  });
});

describe("zeroClickMessage - akapit definicyjny", () => {
  it("`short` i `long` to DWA różne komunikaty, nie jeden „poza budżetem”", () => {
    const short = zeroClickMessage({ id: "lead", status: "warn", reason: "short", value: 12 });
    const long = zeroClickMessage({ id: "lead", status: "warn", reason: "long", value: 120 });
    expect(short.key).toBe("adminZeroClick.rules.lead.shortWords");
    expect(long.key).toBe("adminZeroClick.rules.lead.longWords");
    expect(short.key).not.toBe(long.key);
  });

  it("granice biorą się z budżetu, nie z tłumaczenia", () => {
    const short = zeroClickMessage({ id: "lead", status: "warn", reason: "short", value: 12 });
    expect(short.params).toEqual({ words: 12, min: ZERO_CLICK_BUDGETS.leadWordsMin });
    const long = zeroClickMessage({ id: "lead", status: "warn", reason: "long", value: 120 });
    expect(long.params).toEqual({ words: 120, max: ZERO_CLICK_BUDGETS.leadWordsMax });
  });

  it("rozbiegówka ma własny komunikat - inna praca niż zła długość", () => {
    const filler = zeroClickMessage({ id: "lead", status: "warn", reason: "filler", value: 45 });
    expect(filler.key).toBe("adminZeroClick.rules.lead.filler");
  });

  it("OK niesie zmierzoną liczbę słów i oba końce budżetu", () => {
    const ok = zeroClickMessage({ id: "lead", status: "ok", value: 45 });
    expect(ok.key).toBe("adminZeroClick.rules.lead.okWords");
    expect(ok.params).toEqual({
      words: 45,
      min: ZERO_CLICK_BUDGETS.leadWordsMin,
      max: ZERO_CLICK_BUDGETS.leadWordsMax,
    });
  });

  it("brak akapitu to `todo` bez parametrów", () => {
    const todo = zeroClickMessage({ id: "lead", status: "todo", value: 0 });
    expect(todo.key).toBe("adminZeroClick.rules.lead.todo");
    expect(todo.params).toBeUndefined();
  });
});

describe("zeroClickMessage - nagłówki pytaniowe", () => {
  it("„za mało nagłówków” wygrywa nad udziałem pytań w OBU statusach", () => {
    // Przy jednym H2 procent nic nie znaczy, a praca jest inna: najpierw
    // rozbić tekst na sekcje, dopiero potem przepisać nagłówki na pytania.
    const warn: ZeroClickCheck = {
      id: "questionHeadings",
      status: "warn",
      reason: "tooFewHeadings",
      value: 1,
      total: 1,
    };
    const todo: ZeroClickCheck = { ...warn, status: "todo", value: 0 };
    expect(zeroClickMessage(warn).key).toBe("adminZeroClick.rules.questionHeadings.todoFew");
    expect(zeroClickMessage(todo).key).toBe("adminZeroClick.rules.questionHeadings.todoFew");
  });

  it("udział pytań jedzie z licznikiem i mianownikiem", () => {
    const ok = zeroClickMessage({ id: "questionHeadings", status: "ok", value: 3, total: 4 });
    expect(ok.key).toBe("adminZeroClick.rules.questionHeadings.ok");
    expect(ok.params).toEqual({ value: 3, total: 4 });
    const warn = zeroClickMessage({ id: "questionHeadings", status: "warn", value: 1, total: 5 });
    expect(warn.key).toBe("adminZeroClick.rules.questionHeadings.warn");
    expect(warn.params).toEqual({ value: 1, total: 5 });
  });

  it("zero pytań przy komplecie nagłówków to `todo`", () => {
    expect(
      zeroClickMessage({ id: "questionHeadings", status: "todo", value: 0, total: 4 }).key,
    ).toBe("adminZeroClick.rules.questionHeadings.todo");
  });
});

describe("zeroClickMessage - FAQ", () => {
  it("sekcja pisana prozą dostaje komunikat o BRAKU FAQPage, nie o braku pytań", () => {
    const warn = zeroClickMessage({ id: "faq", status: "warn", reason: "prose", value: 0 });
    expect(warn.key).toBe("adminZeroClick.rules.faq.warn");
  });

  it("blok FAQ raportuje liczbę par", () => {
    const ok = zeroClickMessage({ id: "faq", status: "ok", value: 4 });
    expect(ok.key).toBe("adminZeroClick.rules.faq.ok");
    expect(ok.params).toEqual({ value: 4 });
  });

  it("brak sekcji to `todo`", () => {
    expect(zeroClickMessage({ id: "faq", status: "todo", value: 0 }).key).toBe(
      "adminZeroClick.rules.faq.todo",
    );
  });
});

describe("zeroClickMessage - długość odpowiedzi FAQ", () => {
  it("ostrzeżenie wskazuje ILE odpowiedzi, z ILU i KTÓRĄ poprawić", () => {
    const warn = zeroClickMessage({
      id: "faqAnswerLength",
      status: "warn",
      value: 2,
      total: 5,
      snippet: "Czy zero-click zabija ruch?",
    });
    expect(warn.params).toEqual({
      value: 2,
      total: 5,
      max: ZERO_CLICK_BUDGETS.faqAnswerWordsMax,
      snippet: "Czy zero-click zabija ruch?",
    });
  });

  it("brak fragmentu nie wstawia `undefined` do komunikatu", () => {
    const warn = zeroClickMessage({ id: "faqAnswerLength", status: "warn", value: 1, total: 3 });
    expect(warn.params?.snippet).toBe("");
  });

  it("OK potwierdza próg, żeby redaktor znał budżet bez otwierania ściągawki", () => {
    const ok = zeroClickMessage({ id: "faqAnswerLength", status: "ok", value: 0, total: 3 });
    expect(ok.params).toEqual({ total: 3, max: ZERO_CLICK_BUDGETS.faqAnswerWordsMax });
  });

  it("brak bloku FAQ to `todo`, nie zielone „wszystkie mieszczą się”", () => {
    expect(
      zeroClickMessage({ id: "faqAnswerLength", status: "todo", value: 0, total: 0 }).key,
    ).toBe("adminZeroClick.rules.faqAnswerLength.todo");
  });
});

describe("zeroClickMessage - punkty „Dowiesz się…”", () => {
  it("za mało i za dużo to dwa różne komunikaty z właściwym końcem budżetu", () => {
    const few = zeroClickMessage({ id: "takeaways", status: "warn", reason: "few", value: 1 });
    const many = zeroClickMessage({ id: "takeaways", status: "warn", reason: "many", value: 9 });
    expect(few.key).toBe("adminZeroClick.rules.takeaways.warnFew");
    expect(few.params).toEqual({ value: 1, min: ZERO_CLICK_BUDGETS.takeawaysMin });
    expect(many.key).toBe("adminZeroClick.rules.takeaways.warnMany");
    expect(many.params).toEqual({ value: 9, max: ZERO_CLICK_BUDGETS.takeawaysMax });
  });

  it("komplet punktów raportuje ich liczbę", () => {
    expect(zeroClickMessage({ id: "takeaways", status: "ok", value: 4 }).params).toEqual({
      value: 4,
    });
  });
});

describe("zeroClickMessage - skanowalność", () => {
  it("ma tylko dwa stany i oba mają klucz", () => {
    expect(zeroClickMessage({ id: "scannable", status: "ok" }).key).toBe(
      "adminZeroClick.rules.scannable.ok",
    );
    expect(zeroClickMessage({ id: "scannable", status: "todo" }).key).toBe(
      "adminZeroClick.rules.scannable.todo",
    );
  });
});

describe("zeroClickMessage - kontrakt", () => {
  it("nigdy nie zwraca `count` jako parametru (i18next zabrałby go na liczbę mnogą)", () => {
    const checks: ZeroClickCheck[] = [
      { id: "lead", status: "ok", value: 45 },
      { id: "questionHeadings", status: "warn", value: 1, total: 4 },
      { id: "faq", status: "ok", value: 3 },
      { id: "faqAnswerLength", status: "warn", value: 1, total: 3, snippet: "Pytanie?" },
      { id: "takeaways", status: "warn", reason: "few", value: 2 },
      { id: "scannable", status: "todo" },
    ];
    for (const check of checks) {
      expect(Object.keys(zeroClickMessage(check).params ?? {})).not.toContain("count");
    }
  });

  it("każdy status każdej reguły ma klucz w gałęzi tej reguły", () => {
    const ids = [
      "lead",
      "questionHeadings",
      "faq",
      "faqAnswerLength",
      "takeaways",
      "scannable",
    ] as const;
    for (const id of ids) {
      for (const status of ["ok", "warn", "todo"] as const) {
        const message = zeroClickMessage({ id, status });
        expect(message.key.startsWith(`adminZeroClick.rules.${id}.`)).toBe(true);
      }
    }
  });
});
