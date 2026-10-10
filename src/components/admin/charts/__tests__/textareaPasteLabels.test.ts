// WKLEJENIE DO POLA DANYCH WYKRESU - zmienione etykiety są zgłaszane.
//
// Format średnikowy nie uniesie średnika ani złamania wiersza, więc
// `widgetGridCsv` zamienia je w etykietach (`safeTextCell`). Import pliku do
// arkusza widgetu liczył to i pokazywał `labelsAdjusted`; wklejenie zakresu
// do pola danych zmieniało „A;B" w „A,B" bez słowa.
import { describe, expect, it } from "vitest";
import { clipboardToChartText } from "../textareaPaste";

describe("clipboardToChartText - etykiety zmienione dla formatu średnikowego", () => {
  it("średnik w nazwie serii: zamieniony i zgłoszony", () => {
    const wynik = clipboardToChartText({ text: "Rok\tA;B\tC\n2019\t1,5\t2\n2020\t3\t4" });
    expect(wynik?.text).toBe("; A,B; C\n2019; 1.5; 2\n2020; 3; 4");
    expect(wynik?.problems).toContainEqual({ code: "labelsAdjusted", count: 1 });
  });

  it("kategoria wielowierszowa z Excela (Alt+Enter): połączona i zgłoszona", () => {
    const wynik = clipboardToChartText({
      text: 'Rok\tA\tC\n"Kraków\nPolska"\t1\t2\n2020\t3\t4',
    });
    expect(wynik?.text).toBe("; A; C\nKraków Polska; 1; 2\n2020; 3; 4");
    expect(wynik?.problems).toContainEqual({ code: "labelsAdjusted", count: 1 });
  });

  it("etykiety bez średnika i złamania - nic do zgłoszenia", () => {
    const wynik = clipboardToChartText({ text: "Rok\tA\tC\n2019\t1\t2" });
    expect(wynik?.problems.map((p) => p.code)).not.toContain("labelsAdjusted");
  });
});
