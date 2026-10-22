// Odnośnik z wpisu osi czasu CRM (typ „journey”) do edytora ścieżki (Integrator S8).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. ODNOŚNIK DO CUDZEJ ŚCIEŻKI ALBO NIE TEN KROK. Adres niesie `journey_id`
//      z wpisu, a zapis w toku otwiera edytor na bieżącym kroku kontaktu
//      w zakładce „Kontakty” (ten sam adres co karta „Ścieżki” leada).
//   2. ODNOŚNIK „W CIEMNO”. Wpis spoza kontraktu nie rysuje niczego.
//   3. NAPIS Z EKRANU jest dostępną nazwą odnośnika; axe bez naruszeń.
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ search: [] as unknown[] }));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return {
    ...(await importOriginal<typeof import("@tanstack/react-router")>()),
    // Zaślepka zapisuje `search`, którego zwykła atrapa nie przenosi na <a>.
    Link: (props: { search?: unknown; children?: ReactNode } & Record<string, unknown>) => {
      h.search.push(props.search);
      return <RouterLinkStub {...props} />;
    },
  };
});

import { axeViolations, summarize } from "@/test/axe";
import { CrmJourneyActivityLink } from "@/components/admin/crm/CrmJourneyActivityLink";

const JOURNEY_ID = "4cab3de7-f976-404a-b54e-c37337942b7e";
const LABEL = "Otwórz ścieżkę";

afterEach(() => {
  cleanup();
  h.search = [];
});

describe("CrmJourneyActivityLink", () => {
  it("zapis w toku: edytor TEJ ścieżki na bieżącym kroku, zakładka „Kontakty”", async () => {
    const { container } = render(
      <CrmJourneyActivityLink
        meta={{ journey_id: JOURNEY_ID, current_node_id: "w", summary_pl: "x" }}
        label={LABEL}
      />,
    );
    const link = screen.getByRole("link", { name: LABEL });
    expect(link).toHaveAttribute("href", `/admin/revenue/journeys/${JOURNEY_ID}`);
    expect(h.search).toEqual([{ node: "w", tab: "contacts" }]);
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("zapis zakończony (bez kroku): sam edytor, bez parametrów", () => {
    render(
      <CrmJourneyActivityLink
        meta={{ journey_id: JOURNEY_ID, current_node_id: null }}
        label={LABEL}
      />,
    );
    expect(screen.getByRole("link", { name: LABEL })).toBeInTheDocument();
    expect(h.search).toEqual([{}]);
  });

  it("wpis bez identyfikatora ścieżki (albo z cudzym napisem) nie rysuje NICZEGO", () => {
    const { container } = render(
      <>
        <CrmJourneyActivityLink meta={{ summary_pl: "Coś" }} label={LABEL} />
        <CrmJourneyActivityLink meta={{ journey_id: "../settings" }} label={LABEL} />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
