// TeamMemberWidget: kafelek osoby (hover-identity) + modal z bio/kontaktem.
// Kontrakty przypinane tutaj: sanityzacja URL-i social (javascript: odpada),
// tryb editable nie otwiera modala, fallback braku zdjecia, i18n pozycji.
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";

import type { WidgetContent, WidgetNode } from "@/lib/builder/types";
import { TeamMemberWidget } from "../TeamMemberWidget";

// BrandIcon siega do biblioteki ikon przez klienta Supabase - stub thenable
// wystarcza, zeby zapytanie spokojnie zwrocilo pusto (fallback = Lucide).
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "in", "is", "order", "limit"]) {
    chain[m] = () => chain;
  }
  (chain as { then: (onF: (v: unknown) => unknown) => Promise<unknown> }).then = (onF) =>
    Promise.resolve({ data: [], error: null }).then(onF);
  (chain as { maybeSingle: () => Promise<unknown> }).maybeSingle = () =>
    Promise.resolve({ data: null, error: null });
  return { supabase: chain };
});

let nextId = 0;
function node(content: WidgetContent): WidgetNode {
  return { id: `tm-${nextId++}`, kind: "widget", type: "team-member", content };
}

function renderWidget(content: WidgetContent, editable = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TeamMemberWidget node={node(content)} lang="pl" editable={editable} />
    </QueryClientProvider>,
  );
}

const FULL: WidgetContent = {
  photo: "https://cdn.example.org/anna.jpg",
  name: "Anna Kowalska",
  position_pl: "Dyrektorka programu",
  position_en: "Programme director",
  programLabel_pl: "Bezpieczeństwo",
  bio_pl: "<p>Bio <strong>Anny</strong>.</p>",
  email: "anna@example.org",
  phone: "+48 600 000 000",
  authorSlug: "anna-kowalska",
  linkedin: "https://linkedin.com/in/anna",
  x: "javascript:alert(1)",
  website: "https://example.org",
  overlayAlpha: "0.4",
  cardMaxWidth: "320",
};

describe("TeamMemberWidget", () => {
  it("renderuje kafelek i otwiera modal z bio, kontaktem i pozycja PL", () => {
    renderWidget(FULL);
    const card = screen.getByRole("button", { name: "Anna Kowalska" });
    fireEvent.click(card);

    expect(screen.getAllByRole("heading", { name: "Anna Kowalska" }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Dyrektorka programu").length).toBeGreaterThan(0);
    expect(screen.getByText("Anny")).toBeInTheDocument();
    expect(screen.getByText("anna@example.org").closest("a")).toHaveAttribute(
      "href",
      "mailto:anna@example.org",
    );
    expect(screen.getByText("+48 600 000 000").closest("a")).toHaveAttribute(
      "href",
      "tel:+48 600 000 000",
    );
  });

  it("filtruje niebezpieczne URL-e social (javascript:) i zostawia poprawne", () => {
    const { container } = renderWidget(FULL);
    const text = container.textContent ?? "";
    expect(text).toContain("Anna Kowalska");
    // safeUrl wycina javascript: - ikona X nie powstaje, LinkedIn i website tak.
    const iconWraps = container.querySelectorAll(".cms-team-member span.inline-flex");
    expect(iconWraps.length).toBe(2);
  });

  it("tryb editable nie otwiera modala (wlasciwosci ustawia panel boczny)", () => {
    renderWidget(FULL, true);
    fireEvent.click(screen.getByRole("button", { name: "Anna Kowalska" }));
    expect(screen.queryAllByRole("heading", { name: "Anna Kowalska" })).toHaveLength(0);
  });

  it("bez zdjecia pokazuje placeholder sylwetki, a niepoprawne wymiary degraduja do domyslnych", () => {
    const { container } = renderWidget({
      name: "Jan Nowak",
      overlayAlpha: "not-a-number",
      cardMaxWidth: "-5",
    });
    const card = container.querySelector(".cms-team-member");
    expect(card).toBeTruthy();
    expect((card as HTMLElement).style.maxWidth).toBe("");
    expect(card?.querySelector("svg")).toBeTruthy();
  });
});
