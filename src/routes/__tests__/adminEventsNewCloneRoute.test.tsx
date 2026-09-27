// `/admin/events/new?from=<id>` - DRUGA DROGA TWORZENIA: kopia poprzedniej edycji.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. `?from=` BEZ WALIDACJI. Adres z literówką ma dać zwykły kreator, a nie
//      ekran klonu, który wyśle do RPC nie-UUID.
//   2. EKRAN KLONU DLA REDAKTORA. Klon jest operacją administratora - trasa ma
//      przekazać ekranowi `canClone = false`, żeby odmowa nie przyszła po
//      wypełnieniu formularza.
//   3. WYBÓR ŹRÓDŁA NIE PROWADZI POD ADRES. „Kopiuj z poprzedniej edycji" ma
//      nawigować na `/admin/events/new?from=<id>` (odświeżalny, przesyłalny),
//      a nie trzymać źródła w stanie komponentu.
//   4. WYBÓR ŹRÓDŁA DLA REDAKTORA. Redaktor tworzy z rodzaju; przycisk kopii
//      byłby dla niego kontrolką bez skutku.
//
// Kreator z rodzaju ma własny plik (`adminEventsNewRoute.test.tsx`), ekran
// klonu i wybór źródła - własne pliki. Tutaj asertujemy wyłącznie to, co robi
// TRASA: walidację adresu i rozgałęzienie.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";

import { supabaseRpcStub, type SupabaseRpcStub, ok } from "@/test/supabase";

const SOURCE_ID = "5e5e5e5e-0000-4000-8000-000000000001";

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
  isAdmin: false,
  roles: [] as string[],
  nawigacje: [] as unknown[],
  ekran: [] as { sourceId: string; canClone: boolean }[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (name: string, args?: Record<string, unknown>) => h.rpc!.rpc(name, args) },
}));
vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-events", () => ({ ensureI18n: () => undefined }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: h.isAdmin, roles: h.roles }) }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => (options: unknown) => {
    h.nawigacje.push(options);
    return Promise.resolve();
  },
}));
vi.mock("@/components/admin/events/studio/EventStudioCreateShell", () => ({
  EventStudioCreateShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/admin/events/organisms/EventCreateForm", () => ({
  EventCreateForm: () => <div data-testid="kreator" />,
}));
vi.mock("@/components/admin/events/organisms/EventCloneScreen", () => ({
  EventCloneScreen: (props: { sourceId: string; canClone: boolean }) => {
    h.ekran.push(props);
    return <div data-testid="ekran-klonu" />;
  },
}));
vi.mock("@/components/admin/events/molecules/EventCloneSourcePicker", () => ({
  EventCloneSourcePicker: ({ onPick }: { onPick: (id: string) => void }) => (
    <button type="button" onClick={() => onPick(SOURCE_ID)}>
      wybierz-zrodlo
    </button>
  ),
}));

const { renderRoute, routeSearchValidator } = await import("@/test/routeHarness");
const { Route } = await import("@/routes/admin.events_.new");

beforeEach(() => {
  h.rpc = supabaseRpcStub();
  h.rpc.setResponse("event_types_active", ok([]));
  h.isAdmin = false;
  h.roles = [];
  h.nawigacje = [];
  h.ekran = [];
});
afterEach(() => cleanup());

function zamontuj(entry: string) {
  return renderRoute({ route: Route, path: "/admin/events/new", initialEntry: entry });
}

describe("validateSearch", () => {
  it("przepuszcza wyłącznie UUID w `from`", () => {
    const validate = routeSearchValidator(Route);
    expect(validate({ from: SOURCE_ID, inne: "x" })).toEqual({ from: SOURCE_ID });
    expect(validate({ from: "kongres-2026" })).toEqual({});
    expect(validate({})).toEqual({});
  });
});

describe("rozgałęzienie trasy", () => {
  it("administrator z ?from= dostaje ekran klonu z tym źródłem", async () => {
    h.isAdmin = true;
    await zamontuj(`/admin/events/new?from=${SOURCE_ID}`);
    expect(await screen.findByTestId("ekran-klonu")).toBeInTheDocument();
    expect(h.ekran.at(-1)).toEqual({ sourceId: SOURCE_ID, canClone: true });
    expect(screen.queryByTestId("kreator")).toBeNull();
  });

  it("redaktor z ?from= dostaje ekran klonu z canClone = false (zdanie zamiast formularza)", async () => {
    h.roles = ["editor"];
    await zamontuj(`/admin/events/new?from=${SOURCE_ID}`);
    await screen.findByTestId("ekran-klonu");
    expect(h.ekran.at(-1)).toEqual({ sourceId: SOURCE_ID, canClone: false });
  });

  it("niepoprawne ?from= daje zwykły kreator", async () => {
    h.roles = ["editor"];
    const route = await zamontuj("/admin/events/new?from=nie-uuid");
    expect(route.search().from).toBeUndefined();
    expect(await screen.findByTestId("kreator")).toBeInTheDocument();
    expect(h.ekran).toEqual([]);
  });

  it("administrator widzi nad kreatorem wybór źródła, który nawiguje pod ?from=", async () => {
    h.isAdmin = true;
    await zamontuj("/admin/events/new");
    await screen.findByTestId("kreator");
    fireEvent.click(screen.getByRole("button", { name: "wybierz-zrodlo" }));
    expect(h.nawigacje).toEqual([{ to: "/admin/events/new", search: { from: SOURCE_ID } }]);
  });

  it("redaktor tworzy z rodzaju - bez wyboru źródła", async () => {
    h.roles = ["editor"];
    await zamontuj("/admin/events/new");
    await screen.findByTestId("kreator");
    expect(screen.queryByRole("button", { name: "wybierz-zrodlo" })).toBeNull();
  });
});
