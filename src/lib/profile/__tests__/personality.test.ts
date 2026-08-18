// Punktacja Big Five - czysty moduł, do tej pory na ZERZE pokrycia.
//
// CO JEST TU DO ZEPSUCIA. Kwestionariusz osobowości ma 30 pytań, z których
// POŁOWA jest odwrócona („nie lubię nowości” mierzy otwartość na minus).
// Jeżeli odwrócenie przestanie działać, nic się nie wywali: użytkownik dostanie
// wynik, tylko odwrotny na połowie skali - a odwrotny wynik testu osobowości
// jest nie do wykrycia bez znajomości kluczy. Dokładnie ten rodzaj błędu ma tu
// łapać test, a nie „czy funkcja zwraca liczbę”.
//
// Druga rzecz to NORMALIZACJA. `scoreAnswers` skaluje surową sumę do 0-100
// przez `(suma - min) / (max - min)`, gdzie oba końce zależą od LICZBY
// zaliczonych odpowiedzi. Przy zerowej liczbie mianownik to zero, a wynikiem
// dzielenia byłby NaN - i to NaN trafiłby na wykres w interfejsie.
import { describe, expect, it } from "vitest";
import { answerAll, personalityQuestions } from "@/test/profile/fixtures";
import { answeredCount, AXES, isComplete, scoreAnswers, type Axis } from "../personality";

/** Odpowiedzi maksymalizujące osie: 5 na pytanie proste, 1 na odwrócone. */
function maxAnswers(questions: ReturnType<typeof personalityQuestions>): Record<number, number> {
  return Object.fromEntries(questions.map((q) => [q.id, q.reverse ? 1 : 5]));
}

describe("AXES", () => {
  it("wymienia pięć osi modelu i nie duplikuje żadnej", () => {
    // Oś zgubiona na tej liście znika z wykresu, choć pytania nadal są zadawane.
    expect(AXES).toHaveLength(5);
    expect(new Set(AXES).size).toBe(5);
  });

  it("pokrywa się z osiami, dla których `scoreAnswers` zwraca wynik", () => {
    const scores = scoreAnswers({}, []);
    expect(Object.keys(scores).sort()).toEqual([...AXES].sort());
  });
});

describe("scoreAnswers - odwrócone pozycje", () => {
  it("odwraca pozycje reverse: same piątki dają ŚRODEK skali, nie maksimum", () => {
    // To jest właściwy dowód na działanie klucza odwrotnego. Przy 3 pytaniach
    // prostych i 3 odwróconych same piątki to 3x5 + 3x(6-5) = 18 z 30, czyli
    // dokładnie połowa przedziału. Gdyby odwrócenie przestało działać, wyszłoby
    // 100 - i nikt by nie zauważył, bo liczba nadal wygląda sensownie.
    const questions = personalityQuestions(6);
    const scores = scoreAnswers(answerAll(questions, 5), questions);
    for (const axis of AXES) expect(scores[axis]).toBe(50);
  });

  it("same jedynki dają ten sam środek - skala jest symetryczna", () => {
    const questions = personalityQuestions(6);
    const scores = scoreAnswers(answerAll(questions, 1), questions);
    for (const axis of AXES) expect(scores[axis]).toBe(50);
  });

  it("maksimum osi wymaga 5 na pozycjach prostych i 1 na odwróconych", () => {
    const questions = personalityQuestions(6);
    const scores = scoreAnswers(maxAnswers(questions), questions);
    for (const axis of AXES) expect(scores[axis]).toBe(100);
  });

  it("odwrotność maksimum to zero, nie liczba ujemna", () => {
    const questions = personalityQuestions(6);
    const answers = Object.fromEntries(questions.map((q) => [q.id, q.reverse ? 5 : 1]));
    const scores = scoreAnswers(answers, questions);
    for (const axis of AXES) expect(scores[axis]).toBe(0);
  });
});

describe("scoreAnswers - normalizacja", () => {
  it("mapuje pojedynczą odpowiedź 1/3/5 na 0/50/100", () => {
    const one: ReturnType<typeof personalityQuestions> = [
      { id: 1, axis: "openness", reverse: false, text_pl: "p", text_en: "q", sort_order: 1 },
    ];
    expect(scoreAnswers({ 1: 1 }, one).openness).toBe(0);
    expect(scoreAnswers({ 1: 3 }, one).openness).toBe(50);
    expect(scoreAnswers({ 1: 5 }, one).openness).toBe(100);
  });

  it("liczy każdą oś NIEZALEŻNIE - wynik jednej nie przecieka na drugą", () => {
    const questions = personalityQuestions(2);
    const openness = questions.filter((q) => q.axis === "openness");
    // Maksymalizujemy WYŁĄCZNIE otwartość, reszta osi zostaje bez odpowiedzi.
    const answers = Object.fromEntries(openness.map((q) => [q.id, q.reverse ? 1 : 5]));
    const scores = scoreAnswers(answers, questions);
    expect(scores.openness).toBe(100);
    for (const axis of AXES.filter((a) => a !== "openness")) expect(scores[axis]).toBe(0);
  });

  it("oś bez ani jednej zaliczonej odpowiedzi to 0, NIGDY NaN", () => {
    // Mianownik `max - min` jest zerem przy zerowej liczbie odpowiedzi.
    // Bez wczesnego wyjścia na wykresie w interfejsie wylądowałoby NaN.
    const questions = personalityQuestions(6);
    const scores = scoreAnswers({}, questions);
    for (const axis of AXES) {
      expect(scores[axis]).toBe(0);
      expect(Number.isNaN(scores[axis])).toBe(false);
    }
  });

  it("zaokrągla do liczby całkowitej", () => {
    // 2 pytania proste, odpowiedzi 5 i 4: suma 9, min 2, max 10 -> 87,5 -> 88.
    const questions: ReturnType<typeof personalityQuestions> = [
      { id: 1, axis: "openness", reverse: false, text_pl: "p", text_en: "q", sort_order: 1 },
      { id: 2, axis: "openness", reverse: false, text_pl: "p", text_en: "q", sort_order: 2 },
    ];
    expect(scoreAnswers({ 1: 5, 2: 4 }, questions).openness).toBe(88);
  });
});

describe("scoreAnswers - odsiew odpowiedzi niepoprawnych", () => {
  const questions = personalityQuestions(6);

  it("pomija odpowiedzi poza zakresem 1-5 w OBIE strony", () => {
    // Wartość 0 albo 6 to dryf danych (ręczny zapis, stary klient). Wliczona
    // przesunęłaby całą skalę osi, bo zmienia zarówno sumę, jak i licznik.
    const tooLow = scoreAnswers(answerAll(questions, 0), questions);
    const tooHigh = scoreAnswers(answerAll(questions, 6), questions);
    for (const axis of AXES) {
      expect(tooLow[axis]).toBe(0);
      expect(tooHigh[axis]).toBe(0);
    }
  });

  it("pomija wartości nieliczbowe zamiast wliczać je jako zero", () => {
    const answers = { ...answerAll(questions, 5) } as Record<number, number>;
    // Kształt spoza kontraktu: string z formularza, który nie przeszedł parsowania.
    answers[1] = "5" as unknown as number;
    const scores = scoreAnswers(answers, questions);
    // Pytanie 1 jest proste (nieodwrócone) i wypada z licznika: zostaje
    // 2 proste (10) + 3 odwrócone (3) = 13, przy n=5 -> min 5, max 25.
    expect(scores.openness).toBe(40);
  });

  it("liczy wynik z pytań, które SĄ w zestawie - dodatkowa odpowiedź nie wpływa", () => {
    // Odpowiedź na pytanie usunięte z kwestionariusza nie może wracać do wyniku.
    const answers = { ...maxAnswers(questions), 999: 1 };
    const scores = scoreAnswers(answers, questions);
    for (const axis of AXES) expect(scores[axis]).toBe(100);
  });
});

describe("isComplete", () => {
  const questions = personalityQuestions(6);

  it("wymaga odpowiedzi na KAŻDE pytanie", () => {
    expect(isComplete(answerAll(questions, 3), questions)).toBe(true);
    const missingOne = { ...answerAll(questions, 3) };
    delete missingOne[questions[0].id];
    expect(isComplete(missingOne, questions)).toBe(false);
  });

  it("odpowiedź poza zakresem NIE liczy się jako udzielona", () => {
    // Inaczej formularz pozwoliłby zapisać kwestionariusz z wartością spoza
    // skali, a `scoreAnswers` i tak by ją pominął - wynik z dziury w danych.
    for (const bad of [0, 6]) {
      const answers = { ...answerAll(questions, 3), [questions[0].id]: bad };
      expect(isComplete(answers, questions)).toBe(false);
    }
  });

  it("wartość nieliczbowa nie liczy się jako udzielona", () => {
    const answers = { ...answerAll(questions, 3) } as Record<number, number>;
    answers[questions[0].id] = null as unknown as number;
    expect(isComplete(answers, questions)).toBe(false);
  });

  it("pusty kwestionariusz jest kompletny - nie ma czego brakować", () => {
    expect(isComplete({}, [])).toBe(true);
  });
});

describe("answeredCount", () => {
  const questions = personalityQuestions(6);

  it("liczy wyłącznie odpowiedzi w zakresie skali", () => {
    expect(answeredCount(answerAll(questions, 4), questions)).toBe(questions.length);
    expect(answeredCount({}, questions)).toBe(0);
  });

  it("pokazuje POSTĘP - wartość spoza skali nie podbija licznika", () => {
    // Licznik napędza pasek postępu. Zawyżony pozwoliłby dojść do „30/30”
    // przy kwestionariuszu, którego `isComplete` nie przepuszcza.
    const answers: Record<number, number> = {};
    for (const q of questions.slice(0, 4)) answers[q.id] = 3;
    answers[questions[4].id] = 9;
    expect(answeredCount(answers, questions)).toBe(4);
    expect(isComplete(answers, questions)).toBe(false);
  });

  it("jest spójny z `isComplete`: pełny licznik znaczy kompletny zestaw", () => {
    const answers = answerAll(questions, 2);
    expect(answeredCount(answers, questions)).toBe(questions.length);
    expect(isComplete(answers, questions)).toBe(true);
  });

  it("liczy per zestaw, nie per oś - pytania jednej osi też się sumują", () => {
    const single: Axis = "openness";
    const only = questions.filter((q) => q.axis === single);
    expect(answeredCount(answerAll(only, 3), only)).toBe(only.length);
  });
});
