// Odnośnik z wpisu osi czasu CRM do studia wydarzenia.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. ODNOŚNIK PROWADZI DO CUDZEGO EKRANU. Adres musi nieść `event_id` z tego
//      wpisu i kończyć się na pulpicie wydarzenia, a nie na liście wydarzeń.
//   2. ODNOŚNIK „W CIEMNO". Wpis bez identyfikatora (starszy kod, zapis ręczny)
//      ma NIE rysować niczego - pusty odnośnik prowadzi donikąd.
//   3. NAPIS GUBI SIĘ PO DRODZE. Ekran podaje napis ze swojego słownika; to on
//      jest dostępną nazwą odnośnika.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import { axeViolations, summarize } from "@/test/axe";
import { CrmEventActivityLink } from "@/components/admin/crm/CrmEventActivityLink";

const EVENT_ID = "3f1a0c8e-0000-4000-8000-000000000042";

afterEach(cleanup);

describe("CrmEventActivityLink", () => {
  it("prowadzi na pulpit studia TEGO wydarzenia, pod napisem podanym przez ekran", async () => {
    const { container } = render(
      <CrmEventActivityLink meta={{ event_id: EVENT_ID }} label="Otwórz w studiu wydarzenia" />,
    );

    const link = screen.getByRole("link", { name: "Otwórz w studiu wydarzenia" });
    expect(link).toHaveAttribute("href", `/admin/events/${EVENT_ID}/overview`);
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("wpis bez identyfikatora wydarzenia nie rysuje NICZEGO", () => {
    const { container } = render(
      <CrmEventActivityLink meta={{ summary_pl: "Coś" }} label="Otwórz w studiu wydarzenia" />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
