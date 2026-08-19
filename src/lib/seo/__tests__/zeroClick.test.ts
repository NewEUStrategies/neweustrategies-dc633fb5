// CO DOWODZI TEN PLIK: checklista zero-click w edytorze jest tak wiarygodna,
// jak ten analizator. Trzy klasy błędów byłyby dla redakcji niewidoczne, a
// kosztowne:
//   1. Fałszywe „OK". Redaktor przestaje sprawdzać wpis ręcznie, bo panel
//      świeci na zielono - a lead zaczyna się rozbiegówką i nie ma czego wziąć
//      do snippetu.
//   2. Fałszywe „brak". Panel każe dopisać sekcję, która już jest (bo analiza
//      nie umie czytać drzewa bloków) - redakcja przestaje ufać checkliście.
//   3. Ciche zniknięcie reguły z listy. Wiersz przepada, nikt nie zauważa, że
//      od miesiąca nikt nie sprawdza długości odpowiedzi w FAQ.
import { describe, it, expect } from "vitest";
import {
  analyzeZeroClick,
  countWords,
  isQuestionHeading,
  startsWithFiller,
  ZERO_CLICK_BUDGETS,
  type ZeroClickCheckId,
} from "@/lib/seo/zeroClick";

/** Akapit o zadanej liczbie słów - budżety są liczbowe, więc dane też. */
function words(n: number): string {
  return Array.from({ length: n }, (_, i) => `słowo${i + 1}`).join(" ");
}

function check(input: Parameters<typeof analyzeZeroClick>[0], id: ZeroClickCheckId) {
  const found = analyzeZeroClick(input).checks.find((c) => c.id === id);
  expect(found, `brak reguły ${id} w raporcie`).toBeDefined();
  return found!;
}

const LEAD_OK = words(ZERO_CLICK_BUDGETS.leadWordsMin + 5);

describe("countWords", () => {
  it("liczy słowa po zdjęciu znaczników i encji", () => {
    expect(countWords("<p>Trzy <strong>krótkie</strong>&nbsp;słowa</p>")).toBe(3);
  });

  it("pusta i brakująca treść to zero, nie NaN", () => {
    expect(countWords("")).toBe(0);
    expect(countWords(null)).toBe(0);
    expect(countWords("   <p></p>  ")).toBe(0);
  });
});

describe("isQuestionHeading", () => {
  it("znak zapytania wystarczy", () => {
    expect(isQuestionHeading("Zero-click marketing - co dalej?")).toBe(true);
  });

  it("polski nagłówek pytaniowy BEZ znaku zapytania też się liczy", () => {
    // Redakcje piszą „Jak działa zero-click" bez pytajnika - gdyby to nie
    // liczyło się jako pytanie, checklista karałaby poprawnie zrobiony wpis.
    expect(isQuestionHeading("Jak działa zero-click marketing")).toBe(true);
    expect(isQuestionHeading("Czym jest AI Overview")).toBe(true);
    expect(isQuestionHeading("Ile kosztuje wdrożenie")).toBe(true);
  });

  it("angielskie pytania też", () => {
    expect(isQuestionHeading("How zero-click content works")).toBe(true);
    expect(isQuestionHeading("What is an AI Overview")).toBe(true);
  });

  it("nagłówek-etykieta nie jest pytaniem", () => {
    expect(isQuestionHeading("Wprowadzenie")).toBe(false);
    expect(isQuestionHeading("Kontekst rynkowy")).toBe(false);
    expect(isQuestionHeading("")).toBe(false);
  });
});

describe("startsWithFiller", () => {
  it("łapie rozbiegówki PL i EN", () => {
    expect(startsWithFiller("W dzisiejszych czasach marketing się zmienia.")).toBe(true);
    expect(startsWithFiller("Coraz więcej firm pyta o AI.")).toBe(true);
    expect(startsWithFiller("In today's world, search has changed.")).toBe(true);
  });

  it("odpowiedź wprost nie jest rozbiegówką", () => {
    expect(startsWithFiller("Zero-click marketing to strategia, w której…")).toBe(false);
  });
});

describe("analyzeZeroClick - akapit definicyjny", () => {
  it("akapit w budżecie 40-70 słów jest OK", () => {
    const result = check({ html: `<p>${LEAD_OK}</p>` }, "lead");
    expect(result.status).toBe("ok");
    expect(result.value).toBe(ZERO_CLICK_BUDGETS.leadWordsMin + 5);
  });

  it("za krótki akapit dostaje powód `short`, nie samo ostrzeżenie", () => {
    const result = check({ html: `<p>${words(12)}</p>` }, "lead");
    expect(result.status).toBe("warn");
    expect(result.reason).toBe("short");
    expect(result.value).toBe(12);
  });

  it("za długi akapit dostaje powód `long`", () => {
    const result = check({ html: `<p>${words(ZERO_CLICK_BUDGETS.leadWordsMax + 10)}</p>` }, "lead");
    expect(result.status).toBe("warn");
    expect(result.reason).toBe("long");
  });

  it("rozbiegówka o poprawnej DŁUGOŚCI to nadal `warn` - to jest ten fałszywy zielony", () => {
    const filler = `W dzisiejszych czasach ${words(ZERO_CLICK_BUDGETS.leadWordsMin + 3)}`;
    const result = check({ html: `<p>${filler}</p>` }, "lead");
    expect(result.status).toBe("warn");
    expect(result.reason).toBe("filler");
    expect(result.snippet).toBeTruthy();
  });

  it("pusty wpis to `todo`, nie `warn` - nie ma czego poprawiać, trzeba napisać", () => {
    expect(check({ html: "" }, "lead").status).toBe("todo");
  });

  it("tekst wklejony bez znacznika <p> nadal jest leadem", () => {
    // Import z WordPressa i wklejka ze schowka potrafią nie mieć akapitów.
    const result = check({ html: `${LEAD_OK}<h2>Jak to działa?</h2>` }, "lead");
    expect(result.status).toBe("ok");
  });
});

describe("analyzeZeroClick - nagłówki pytaniowe", () => {
  const heading = (level: number, text: string) => ({ type: "heading", data: { level, text } });

  it("udział pytań powyżej progu = OK", () => {
    const blocks = [
      heading(2, "Czym jest zero-click?"),
      heading(2, "Jak to wdrożyć?"),
      heading(2, "Podsumowanie"),
    ];
    const result = check({ blocks }, "questionHeadings");
    expect(result.status).toBe("ok");
    expect(result.value).toBe(2);
    expect(result.total).toBe(3);
  });

  it("same nagłówki-etykiety = `todo`", () => {
    const blocks = [heading(2, "Wprowadzenie"), heading(2, "Kontekst"), heading(2, "Wnioski")];
    const result = check({ blocks }, "questionHeadings");
    expect(result.status).toBe("todo");
    expect(result.value).toBe(0);
  });

  it("jeden nagłówek to nie jest struktura - powód `tooFewHeadings`", () => {
    // Przy jednym H2 „100% pytań" byłoby prawdą statystycznie bezwartościową.
    const result = check({ blocks: [heading(2, "Jak to działa?")] }, "questionHeadings");
    expect(result.reason).toBe("tooFewHeadings");
  });

  it("H4 i niżej nie wchodzą do liczenia (liczą się sekcje, nie podpunkty)", () => {
    const blocks = [
      heading(2, "Czym jest zero-click?"),
      heading(2, "Jak to wdrożyć?"),
      heading(4, "Etykieta bez pytania"),
    ];
    expect(check({ blocks }, "questionHeadings").total).toBe(2);
  });
});

describe("analyzeZeroClick - FAQ", () => {
  const faqBlock = (items: { q: string; a: string }[]) => [{ type: "faq", data: { items } }];

  it("blok FAQ z parami = OK", () => {
    const blocks = faqBlock([
      { q: "Czy zero-click zabija ruch?", a: "Nie - przenosi wartość do widoczności." },
    ]);
    const result = check({ blocks }, "faq");
    expect(result.status).toBe("ok");
    expect(result.value).toBe(1);
  });

  it("sekcja pytań napisana ręcznie to `warn` z powodem `prose`, NIE ok", () => {
    // To jest sedno reguły: czytelnik widzi to samo, crawler nie dostaje
    // FAQPage. Gdyby analizator uznał to za OK, redakcja nigdy nie
    // przeniosłaby pytań do bloku.
    const result = check({ html: "<h2>Najczęściej zadawane pytania</h2><p>Odpowiedź.</p>" }, "faq");
    expect(result.status).toBe("warn");
    expect(result.reason).toBe("prose");
  });

  it("brak pytań w ogóle = `todo`", () => {
    expect(check({ html: `<p>${LEAD_OK}</p>` }, "faq").status).toBe("todo");
  });

  it("puste pary w bloku nie liczą się jako FAQ", () => {
    const result = check({ blocks: faqBlock([{ q: "", a: "" }]) }, "faq");
    expect(result.status).toBe("todo");
  });
});

describe("analyzeZeroClick - długość odpowiedzi FAQ", () => {
  it("odpowiedzi w budżecie = OK", () => {
    const blocks = [{ type: "faq", data: { items: [{ q: "Pytanie?", a: words(30) }] } }];
    const result = check({ blocks }, "faqAnswerLength");
    expect(result.status).toBe("ok");
    expect(result.total).toBe(1);
  });

  it("odpowiedź powyżej progu wskazuje KTÓRE pytanie poprawić", () => {
    const blocks = [
      {
        type: "faq",
        data: {
          items: [
            { q: "Krótka?", a: words(20) },
            {
              q: "Rozwlekła odpowiedź na pytanie?",
              a: words(ZERO_CLICK_BUDGETS.faqAnswerWordsMax + 5),
            },
          ],
        },
      },
    ];
    const result = check({ blocks }, "faqAnswerLength");
    expect(result.status).toBe("warn");
    expect(result.value).toBe(1);
    expect(result.total).toBe(2);
    expect(result.snippet).toContain("Rozwlekła");
  });

  it("bez bloku FAQ nie ma czego mierzyć - `todo`, nie fałszywe OK", () => {
    expect(check({ html: `<p>${LEAD_OK}</p>` }, "faqAnswerLength").status).toBe("todo");
  });
});

describe("analyzeZeroClick - punkty „Dowiesz się…”", () => {
  it("3-5 punktów = OK", () => {
    const result = check({ takeaways: ["Raz", "Dwa", "Trzy"] }, "takeaways");
    expect(result.status).toBe("ok");
    expect(result.value).toBe(3);
  });

  it("za mało punktów niesie powód `few`", () => {
    const result = check({ takeaways: ["Raz"] }, "takeaways");
    expect(result.status).toBe("warn");
    expect(result.reason).toBe("few");
  });

  it("za dużo punktów niesie powód `many`", () => {
    const result = check(
      { takeaways: Array.from({ length: ZERO_CLICK_BUDGETS.takeawaysMax + 2 }, (_, i) => `P${i}`) },
      "takeaways",
    );
    expect(result.status).toBe("warn");
    expect(result.reason).toBe("many");
  });

  it("puste stringi nie są punktami", () => {
    expect(check({ takeaways: ["", "   "] }, "takeaways").status).toBe("todo");
  });
});

describe("analyzeZeroClick - skanowalność", () => {
  it("lista w HTML liczy się", () => {
    expect(check({ html: "<ul><li>Krok</li></ul>" }, "scannable").status).toBe("ok");
  });

  it("lista w drzewie bloków liczy się", () => {
    expect(
      check({ blocks: [{ type: "list", data: { ordered: true, items: ["Krok"] } }] }, "scannable")
        .status,
    ).toBe("ok");
  });

  it("pusta lista (same puste pozycje) nie liczy się", () => {
    expect(
      check({ blocks: [{ type: "list", data: { items: ["", "  "] } }] }, "scannable").status,
    ).toBe("todo");
  });
});

describe("analyzeZeroClick - kontrakt raportu", () => {
  const ALL_RULES: ZeroClickCheckId[] = [
    "lead",
    "questionHeadings",
    "faq",
    "faqAnswerLength",
    "takeaways",
    "scannable",
  ];

  it("raport ma KOMPLET reguł nawet dla pustego wpisu", () => {
    // Wiersz, który znika, to reguła, której nikt już nie sprawdza.
    const report = analyzeZeroClick({});
    expect(report.checks.map((c) => c.id)).toEqual(ALL_RULES);
    expect(report.total).toBe(ALL_RULES.length);
    expect(report.passed).toBe(0);
  });

  it("`passed` liczy WYŁĄCZNIE zielone reguły", () => {
    const report = analyzeZeroClick({
      html: `<p>${LEAD_OK}</p><ul><li>Krok</li></ul>`,
      takeaways: ["Raz", "Dwa", "Trzy"],
    });
    const okCount = report.checks.filter((c) => c.status === "ok").length;
    expect(report.passed).toBe(okCount);
    expect(report.passed).toBeGreaterThan(0);
    expect(report.passed).toBeLessThan(report.total);
  });

  it("drzewo bloków wygrywa z HTML-em, gdy oba są ustawione", () => {
    // Edytor blokowy jest źródłem prawdy; nieaktualny `content_*` nie może
    // podmieniać wyniku analizy pod redaktorem.
    const report = analyzeZeroClick({
      html: "<p>Stara treść bez listy.</p>",
      blocks: [{ type: "list", data: { items: ["Krok"] } }],
    });
    expect(report.checks.find((c) => c.id === "scannable")?.status).toBe("ok");
  });

  it("BlocksDoc (obiekt z `blocks`) czyta się tak samo jak goła tablica", () => {
    const doc = { version: 1, blocks: [{ id: "b1", type: "paragraph", data: { html: LEAD_OK } }] };
    expect(check({ blocks: doc }, "lead").status).toBe("ok");
  });
});
