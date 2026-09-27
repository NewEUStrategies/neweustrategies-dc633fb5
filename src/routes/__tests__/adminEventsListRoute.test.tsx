// `/admin/events/list` - trasa listy wydarzeń: bramka roli i przekazanie
// uprawnienia do kopii edycji.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. PRZYCISK KOPII DLA REDAKTORA. „Nowa edycja (kopia)" na pasku zaznaczenia
//      prowadzi do operacji administratora - redaktor dostałby formularz, który
//      baza i tak odrzuci. Trasa ma podać organizmowi `canClone = isAdmin`.
//   2. LISTA DLA AUTORA. Autor nie ma roli redaktora, a RPC listy odmawia mu
//      `42501` - ekran ma powiedzieć to zdaniem, a nie pustą listą.
//
// Organizm listy ma własny plik (`EventsListManager.test.tsx`) - tutaj jest
// atrapą, która zapisuje otrzymane właściwości.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";

const TERAZ = new Date("2026-08-29T12:00:00.000Z");

const h = vi.hoisted(() => ({
  isAdmin: false,
  roles: [] as string[],
  panele: [] as { canClone?: boolean; now: Date; params: Record<string, unknown> }[],
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-events", () => ({ ensureI18n: () => undefined }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: h.isAdmin, roles: h.roles }) }));
vi.mock("@/hooks/useMinuteClock", () => ({ useMinuteClock: () => TERAZ }));
vi.mock("@/components/admin/events/organisms/EventsListManager", () => ({
  EventsListManager: (props: {
    canClone?: boolean;
    now: Date;
    params: Record<string, unknown>;
  }) => {
    h.panele.push(props);
    return <div data-testid="lista" />;
  },
}));

const { renderRoute } = await import("@/test/routeHarness");
const { Route } = await import("@/routes/admin.events.list");

beforeEach(() => {
  h.isAdmin = false;
  h.roles = [];
  h.panele = [];
});
afterEach(() => cleanup());

function zamontuj(entry = "/admin/events/list") {
  return renderRoute({ route: Route, path: "/admin/events/list", initialEntry: entry });
}

describe("admin.events.list - bramka roli i kopia edycji", () => {
  it("administrator: lista z canClone = true, zegarem i parametrami z adresu", async () => {
    h.isAdmin = true;
    await zamontuj("/admin/events/list?q=kongres");
    expect(await screen.findByTestId("lista")).toBeInTheDocument();
    expect(h.panele.at(-1)).toMatchObject({ canClone: true, now: TERAZ, params: { q: "kongres" } });
  });

  it("redaktor: lista BEZ kopii (canClone = false)", async () => {
    h.roles = ["editor"];
    await zamontuj();
    await screen.findByTestId("lista");
    expect(h.panele.at(-1)?.canClone).toBe(false);
  });

  it("autor: zdanie o braku uprawnień zamiast listy", async () => {
    h.roles = ["author"];
    await zamontuj();
    expect(await screen.findByText("adminEvents.list.adminOnly")).toBeInTheDocument();
    expect(screen.queryByTestId("lista")).toBeNull();
    expect(h.panele).toEqual([]);
  });
});
