// CO DOWODZI TEN PLIK: plakietka wyniku SEO (0-100) w tabeli przeglądu maluje
// pasek DOKŁADNIE według reguły `Math.max(4, Math.min(100, score))`, a obok
// niego pokazuje wynik SUROWY - bez klamry. Tabela `it.each` przechodzi każdy
// poziom oceny (`SeoGrade`: good/warn/poor) przez wszystkie punkty łamania
// klamry: -5, 0, 1, 50, 100 i 120.
//
// DLACZEGO TO WAŻNE DLA UŻYTKOWNIKA. Plakietka stoi w wierszu tabeli /admin/seo
// i jest jedynym skanowalnym wzrokiem sygnałem „ten wpis wymaga uwagi". Gdy
// klamra pęknie:
//   * brak dolnej klamry (0 -> 0%) daje w wierszu pasek o zerowej szerokości,
//     wizualnie identyczny z brakiem plakietki - wiersz z NAJGORSZYM wynikiem
//     przestaje się wyróżniać i wypada z pola uwagi redakcji,
//   * brak górnej klamry przy wyniku > 100 rozpycha pasek poza kontener i
//     rozjeżdża szerokości kolumn w całej tabeli,
//   * zaklamrowanie także LICZBY (pokazanie „100" przy wyniku 120) skłamałoby
//     o danych - liczba jest audytem, pasek tylko grafiką.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE:
//   * nie liczy wyniku ani nie ustala progów good/warn/poor - to kontrakt
//     `src/lib/seo/__tests__/contentStatus.test.ts` („grades a bare row as poor
//     (only the indexable points)", „reaches good grade on a fully tended row
//     and penalizes noindex"); tutaj wynik i poziom są WEJŚCIEM,
//   * nie sprawdza treści tabeli przeglądu ani filtrów,
//   * nie dubluje `e2e/seo.spec.ts` - jedyny test e2e stykający się z tą
//     powierzchnią to „/admin/seo is auth-gated (redirects to /auth or /login)",
//     który sprawdza WYŁĄCZNIE przekierowanie niezalogowanego użytkownika i
//     nigdy nie dochodzi do wyrenderowanej tabeli.
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { SeoGrade } from "@/lib/seo/contentStatus";
import { SeoScorePill } from "../SeoScorePill";

const GRADES: readonly SeoGrade[] = ["good", "warn", "poor"];
/** Punkty łamania klamry: dwa poniżej dolnej granicy, środek, dwa na/ponad górną. */
const SCORES: readonly number[] = [-5, 0, 1, 50, 100, 120];

const TONE: Record<SeoGrade, string> = {
  good: "bg-emerald-500",
  warn: "bg-amber-500",
  poor: "bg-destructive",
};

/** Pasek to jedyny element plakietki z szerokością wyliczaną w JS. */
function renderPill(score: number, grade: SeoGrade): HTMLElement {
  const { container } = render(<SeoScorePill score={score} grade={grade} />);
  const bar = container.querySelector<HTMLElement>("span[style]");
  if (!bar) throw new Error("plakietka nie wyrenderowała paska z wyliczoną szerokością");
  return bar;
}

const CASES: ReadonlyArray<readonly [SeoGrade, number, string]> = GRADES.flatMap((grade) =>
  SCORES.map((score) => [grade, score, `${Math.max(4, Math.min(100, score))}%`] as const),
);

afterEach(cleanup);

describe("SeoScorePill - klamry szerokości paska", () => {
  it.each(CASES)("poziom %s z wynikiem %s daje pasek %s", (grade, score, expectedWidth) => {
    expect(renderPill(score, grade).style.width).toBe(expectedWidth);
  });

  it("dolna klamra jest przypięta punktowo: 0 i 1 dają ten sam widoczny pasek", () => {
    expect(renderPill(0, "poor").style.width).toBe("4%");
    cleanup();
    expect(renderPill(1, "poor").style.width).toBe("4%");
    cleanup();
    // 4 to pierwszy wynik, przy którym pasek przestaje być podnoszony.
    expect(renderPill(4, "poor").style.width).toBe("4%");
    cleanup();
    expect(renderPill(5, "poor").style.width).toBe("5%");
  });

  it("górna klamra jest przypięta punktowo: 100 i 120 dają pełny pasek", () => {
    expect(renderPill(100, "good").style.width).toBe("100%");
    cleanup();
    expect(renderPill(120, "good").style.width).toBe("100%");
    cleanup();
    expect(renderPill(99, "good").style.width).toBe("99%");
  });
});

describe("SeoScorePill - liczba i ton", () => {
  it.each(SCORES)("pokazuje SUROWY wynik %s, mimo zaklamrowanego paska", (score) => {
    render(<SeoScorePill score={score} grade="warn" />);
    // Liczba nie jest klamrowana - inaczej audyt danych czytałby fałsz.
    expect(screen.getByText(String(score))).toBeTruthy();
  });

  it.each(GRADES)("poziom %s maluje pasek własnym tonem", (grade) => {
    expect(renderPill(50, grade).className).toContain(TONE[grade]);
  });

  it("tony trzech poziomów są parami różne", () => {
    expect(new Set(Object.values(TONE)).size).toBe(GRADES.length);
  });
});
