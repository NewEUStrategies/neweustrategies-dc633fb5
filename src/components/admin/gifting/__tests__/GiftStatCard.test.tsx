// Atomy kafla statystyki gifting i jego szkieletu - CZY LICZBA JEST CZYTELNA
// I CZY UKŁAD NIE SKACZE.
//
// CO TEN PLIK DOWODZI.
//   1. LICZBA IDZIE PRZEZ `toLocaleString()`, więc 12345 czyta się jako
//      dwanaście tysięcy, a nie jako „12345". W panelu, w którym obok siebie
//      stoi dziesięć liczb, brak separatora tysięcy jest realną pomyłką o rząd
//      wielkości - a asercja na `getByText("12345")` przeszłaby OBOJĘTNIE dla
//      obu wariantów, więc dowód musi porównywać z `toLocaleString()` liczby.
//   2. ZERO JEST POKAZANE, nie schowane. Kafel „0 cofniętych" to informacja;
//      pusty kafel to awaria. Gałąź `value && ...` byłaby tu błędem cichym.
//   3. SZKIELET MA WYSOKOŚĆ KAFLA (h-20) - dojechanie odpowiedzi nie przesuwa
//      układu pod kursorem admina.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Kolejności i doboru dziesięciu kafli (to
// decyzja organizmu - `GiftStatsPanel.test.tsx`) ani zachowania przy awarii
// odczytu (tamże).
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { GiftStatCard, GiftStatSkeleton } from "@/components/admin/gifting/atoms/GiftStatCard";

describe("kafel statystyki gifting", () => {
  it("formatuje liczbę separatorem tysięcy, a nie surowym ciągiem cyfr", () => {
    render(<GiftStatCard label="Aktywne" value={12345} />);

    expect(screen.getByText((12345).toLocaleString())).toBeTruthy();
    expect(screen.queryByText("12345")).toBeNull();
  });

  it("ZERO jest pokazane jako wartość, nie ukryte", () => {
    render(<GiftStatCard label="Cofnięte" value={0} />);

    expect(screen.getByText("Cofnięte")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
  });

  it("etykieta pochodzi wyłącznie z propsa - atom nie tłumaczy", () => {
    render(<GiftStatCard label="Etykieta Z Zewnątrz" value={7} />);

    expect(screen.getByText("Etykieta Z Zewnątrz")).toBeTruthy();
  });
});

describe("szkielet kafla", () => {
  it("ma tę samą wysokość co kafel, więc układ nie przeskakuje po odpowiedzi", () => {
    const { container } = render(<GiftStatSkeleton />);

    const szkielet = container.firstElementChild;
    expect(szkielet?.className).toContain("h-20");
    expect(szkielet?.className).toContain("animate-pulse");
  });

  it("szkielet NIE pokazuje żadnej liczby - nie udaje danych", () => {
    const { container } = render(<GiftStatSkeleton />);

    expect(container.textContent).toBe("");
  });
});
