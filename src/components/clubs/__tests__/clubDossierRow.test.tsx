// Regresja układu „dossier": wiersz ma mieć grzbiet rodzaju, tytuł, metryki
// dostępne dla czytnika ekranu i akcje, które NIE znikają z DOM-u (bo wtedy
// klawiatura nie mogłaby ich osiągnąć).
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClubDossierMetrics, ClubDossierRow } from "@/components/clubs/atoms/ClubDossierRow";

describe("ClubDossierRow", () => {
  it("renderuje ton rodzaju, tytuł, akcje i opisane metryki", () => {
    render(
      <ClubDossierRow
        testId="row"
        tone="thread"
        icon={<span>i</span>}
        meta={<span>Dyskusja</span>}
        title={<h3>Bezpieczeństwo wschodniej flanki</h3>}
        excerpt="Streszczenie wątku"
        metrics={
          <ClubDossierMetrics
            metrics={[{ key: "replies", icon: <span>r</span>, value: 12, label: "12 odpowiedzi" }]}
          />
        }
        footer={<button type="button">Reaguj</button>}
      />,
    );

    const row = screen.getByTestId("row");
    expect(row.getAttribute("data-tone")).toBe("thread");
    expect(screen.getByRole("heading", { name: "Bezpieczeństwo wschodniej flanki" })).toBeTruthy();
    expect(screen.getByText("Streszczenie wątku")).toBeTruthy();
    expect(screen.getByText("12 odpowiedzi")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reaguj" })).toBeTruthy();
  });

  it("oznacza wiersz nieprzeczytany i przypięty bez zmiany struktury", () => {
    render(
      <ClubDossierRow
        testId="row"
        tone="post"
        unread
        pinned
        icon={<span>i</span>}
        meta={<span>Wpis</span>}
        title={<h3>Tytuł</h3>}
      />,
    );
    const row = screen.getByTestId("row");
    expect(row.className).toContain("border-primary/40");
    expect(row.getAttribute("data-tone")).toBe("post");
  });
});
