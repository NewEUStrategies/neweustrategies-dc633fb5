// Mapowanie pomiaru zero-click (czysty `analyzeZeroClick`) na klucz i18n
// komunikatu w checkliście edytora. Osobna, czysta funkcja, bo to jedyne
// miejsce, w którym `status` + `reason` rozstrzygają, CO redaktor przeczyta -
// a każda pomyłka tutaj to instrukcja naprawy niezgodna z tym, co zmierzono.
import { ZERO_CLICK_BUDGETS, type ZeroClickCheck } from "@/lib/seo/zeroClick";

export interface ZeroClickMessage {
  /** Pełny klucz i18n (namespace `adminZeroClick.rules.*`). */
  key: string;
  /** Parametry interpolacji. Nigdy `count` - to słowo i18next rezerwuje na liczbę mnogą. */
  params?: Record<string, string | number>;
}

const BASE = "adminZeroClick.rules";

/** Klucz tytułu reguły (wiersz checklisty i nagłówek w ściągawce). */
export function zeroClickRuleTitleKey(id: ZeroClickCheck["id"]): string {
  return `${BASE}.${id}.title`;
}

/** Komunikat stanu dla pojedynczej reguły. */
export function zeroClickMessage(check: ZeroClickCheck): ZeroClickMessage {
  const at = (leaf: string) => `${BASE}.${check.id}.${leaf}`;
  const value = check.value ?? 0;
  const total = check.total ?? 0;

  switch (check.id) {
    case "lead":
      if (check.status === "todo") return { key: at("todo") };
      if (check.reason === "filler") return { key: at("filler") };
      if (check.reason === "short")
        return {
          key: at("shortWords"),
          params: { words: value, min: ZERO_CLICK_BUDGETS.leadWordsMin },
        };
      if (check.reason === "long")
        return {
          key: at("longWords"),
          params: { words: value, max: ZERO_CLICK_BUDGETS.leadWordsMax },
        };
      return {
        key: at("okWords"),
        params: {
          words: value,
          min: ZERO_CLICK_BUDGETS.leadWordsMin,
          max: ZERO_CLICK_BUDGETS.leadWordsMax,
        },
      };

    case "questionHeadings":
      // „Za mało nagłówków" jest ważniejsze niż udział pytań: przy jednym H2
      // sam procent nic nie mówi, a praca do wykonania jest inna (rozbić tekst
      // na sekcje, dopiero potem przepisać nagłówki na pytania).
      if (check.reason === "tooFewHeadings") return { key: at("todoFew") };
      if (check.status === "todo") return { key: at("todo") };
      if (check.status === "warn") return { key: at("warn"), params: { value, total } };
      return { key: at("ok"), params: { value, total } };

    case "faq":
      if (check.status === "ok") return { key: at("ok"), params: { value } };
      if (check.status === "warn") return { key: at("warn") };
      return { key: at("todo") };

    case "faqAnswerLength":
      if (check.status === "todo") return { key: at("todo") };
      if (check.status === "warn")
        return {
          key: at("warn"),
          params: {
            value,
            total,
            max: ZERO_CLICK_BUDGETS.faqAnswerWordsMax,
            snippet: check.snippet ?? "",
          },
        };
      return { key: at("ok"), params: { total, max: ZERO_CLICK_BUDGETS.faqAnswerWordsMax } };

    case "takeaways":
      if (check.status === "todo") return { key: at("todo") };
      if (check.reason === "few")
        return { key: at("warnFew"), params: { value, min: ZERO_CLICK_BUDGETS.takeawaysMin } };
      if (check.reason === "many")
        return { key: at("warnMany"), params: { value, max: ZERO_CLICK_BUDGETS.takeawaysMax } };
      return { key: at("ok"), params: { value } };

    case "scannable":
      return { key: at(check.status === "ok" ? "ok" : "todo") };
  }
}
