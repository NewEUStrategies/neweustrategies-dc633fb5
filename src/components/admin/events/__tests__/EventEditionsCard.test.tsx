// Blok „Edycje wydarzenia" na pulpicie studia.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. ODNOŚNIK DO ZŁEGO WYDARZENIA. Każda edycja prowadzi na pulpit SWOJEGO
//      identyfikatora; podmieniony parametr otwiera w studiu bieżące wydarzenie.
//   2. WEJŚCIE DO KLONU BEZ ŹRÓDŁA. „Utwórz kolejną edycję" musi nieść
//      `?from=<to wydarzenie>` - bez niego ląduje w kreatorze od zera.
//   3. BŁĄD JAKO PUSTKA. Nieudany odczyt pokazujący „brak edycji" to nieprawda
//      o rodowodzie wydarzenia.
//   4. RELACJA SPOZA ZBIORU. Nowszy backend z nową relacją nie może wywrócić
//      listy - wiersz dostaje etykietę domyślną.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { axeViolations, summarize } from "@/test/axe";
import { freezeClock } from "@/test/time";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase";
import { CLONE_NEW_ID, CLONE_SOURCE_ID } from "@/test/events/eventCloneFixtures";

const h = vi.hoisted(() => ({ rpc: null as SupabaseRpcStub | null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (name: string, args?: Record<string, unknown>) => h.rpc!.rpc(name, args) },
}));
vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-event-clone", () => ({ ensureCloneI18n: () => undefined }));
// Odnośnik z `search` - atrapa zapisuje go w `data-search`, bo cel zależy od niego.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    search,
    children,
    ...rest
  }: {
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
    children: ReactNode;
  }) => (
    <a
      href={Object.entries(params ?? {}).reduce((href, [k, v]) => href.replace(`$${k}`, v), to)}
      data-search={search === undefined ? "" : new URLSearchParams(search).toString()}
      {...rest}
    >
      {children}
    </a>
  ),
}));

const { EventEditionsCard } = await import("@/components/admin/events/molecules/EventEditionsCard");

freezeClock();

const PREVIOUS_ID = "5e5e5e5e-0000-4000-8000-000000000003";

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});
afterEach(() => cleanup());

function edition(overrides: Record<string, unknown>) {
  return {
    id: PREVIOUS_ID,
    slug: "kongres-2025",
    title_pl: "Kongres 2025",
    title_en: "Congress 2025",
    starts_at: "2098-03-20T08:00:00.000Z",
    timezone: "Europe/Warsaw",
    status: "published",
    relation: "previous",
    depth: 1,
    ...overrides,
  };
}

describe("EventEditionsCard", () => {
  it("lista edycji z odnośnikami na pulpit KAŻDEJ z nich i wejście do klonu z ?from=", async () => {
    h.rpc!.setData("admin_event_editions", [
      edition({}),
      edition({ id: CLONE_NEW_ID, title_pl: "Kongres 2027", relation: "next", status: "draft" }),
      edition({
        id: "5e5e5e5e-0000-4000-8000-000000000004",
        title_pl: "Inna",
        relation: "sideways",
      }),
    ]);
    const { container } = renderWithQueryClient(<EventEditionsCard eventId={CLONE_SOURCE_ID} />);
    const previous = await screen.findByRole("link", {
      name: "adminEventClone.editions.open(title=Kongres 2025)",
    });
    expect(previous).toHaveAttribute("href", `/admin/events/${PREVIOUS_ID}/overview`);
    expect(previous).toHaveTextContent("adminEventClone.editions.relation.previous");
    const next = screen.getByRole("link", {
      name: "adminEventClone.editions.open(title=Kongres 2027)",
    });
    expect(next).toHaveAttribute("href", `/admin/events/${CLONE_NEW_ID}/overview`);
    expect(next).toHaveTextContent("adminEventClone.editions.relation.next");
    expect(next).toHaveTextContent("adminEventClone.status.draft");
    // Relacja spoza zbioru dostaje etykietę domyślną, a nie pustkę.
    expect(
      screen.getByRole("link", { name: "adminEventClone.editions.open(title=Inna)" }),
    ).toHaveTextContent("adminEventClone.editions.relation.previous");
    const create = screen.getByRole("link", { name: /adminEventClone.editions.createNext/ });
    expect(create).toHaveAttribute("href", "/admin/events/new");
    expect(create).toHaveAttribute("data-search", `from=${CLONE_SOURCE_ID}`);
    expect(h.rpc!.lastCall("admin_event_editions")?.arg("p_event_id")).toBe(CLONE_SOURCE_ID);
    expect(summarize(await axeViolations(container))).toBe("");
  });

  it("pusta lista mówi „brak edycji”, a wejście do klonu zostaje", async () => {
    h.rpc!.setData("admin_event_editions", []);
    renderWithQueryClient(<EventEditionsCard eventId={CLONE_SOURCE_ID} />);
    expect(await screen.findByText("adminEventClone.editions.empty")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /createNext/ })).toBeInTheDocument();
  });

  it("błąd odczytu jest komunikatem błędu, NIE pustką", async () => {
    h.rpc!.setError("admin_event_editions", "forbidden: admin role required");
    renderWithQueryClient(<EventEditionsCard eventId={CLONE_SOURCE_ID} />);
    await waitFor(() =>
      expect(screen.getByText(/forbidden: admin role required/)).toBeInTheDocument(),
    );
    expect(screen.queryByText("adminEventClone.editions.empty")).toBeNull();
  });
});
