// Lista ścieżek (S8) - RTL + axe.
//
// CO TEN PLIK DOWODZI.
//   1. Tabela z podpisem i nagłówkami (`scope`), nazwa = nagłówek wiersza
//      z odnośnikiem do edytora, kolumny: status (ikona + słowo), wyzwalacz
//      (przetłumaczony), w toku, wejścia i cel z 30 dni, wersja.
//   2. Filtr statusu i szukanie pochodzą z adresu (propsy) - szukanie obejmuje
//      też przetłumaczoną nazwę wyzwalacza; pusty wynik mówi, że to filtr.
//   3. Akcje statusu tylko dla admina, z potwierdzeniem i tokenem
//      `updated_at`; konflikt jest komunikatem (wynik `ok:false` nie rzuca).
//   4. Klik w wiersz otwiera edytor; axe bez naruszeń.
//   5. Wejście do edytora zapamiętuje filtr listy (`?status=&q=`) dla okruszków
//      edytora; odczyt przechodzi przez walidator adresu huba.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
  navigate: vi.fn(),
  setStatus: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.("pl"), i18n: { language: "pl" }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useNavigate: () => h.navigate,
}));
vi.mock("@/lib/journeys/journeys.functions", () => ({
  setJourneyStatus: (input: unknown) => h.setStatus(input),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { toast } from "sonner";
import {
  JourneyList,
  recallJourneyListSearch,
  rememberJourneyListSearch,
  type JourneyListProps,
} from "../JourneyList";
import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import { parseJourneyList } from "@/lib/journeys/parse";
import { RPC_SHAPES } from "@/lib/journeys/__tests__/rpcShapes.fixture";
import "@/lib/i18n-admin-journeys";
import "@/lib/i18n-admin-journeys-list";

h.fixedT = realT;
const t = realT("pl");
const T = "11111111-1111-4111-8111-111111111111";
const BASE = RPC_SHAPES.list[0];

const ITEMS = parseJourneyList([
  {
    ...BASE,
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    key: "powitanie",
    name: "Powitanie nowego konta",
    status: "active",
    version: 2,
    template_key: "welcome_onboarding",
    trigger_event_type: "account.registered.v1",
    active: 12,
    enrolled_30d: 40,
    goal_reached_30d: 10,
    updated_at: "2026-10-20T10:00:00+00:00",
  },
  {
    ...BASE,
    id: "aaaaaaaa-0000-4000-8000-000000000002",
    key: "kasa",
    name: "Porzucona kasa",
    status: "paused",
  },
  {
    ...BASE,
    id: "aaaaaaaa-0000-4000-8000-000000000003",
    key: "b2b",
    name: "Szkic B2B",
    status: "draft",
    version: null,
    published_version_id: null,
    template_key: null,
    trigger_event_type: null,
  },
  {
    ...BASE,
    id: "aaaaaaaa-0000-4000-8000-000000000004",
    key: "stara",
    name: "Stara ścieżka",
    status: "archived",
  },
]);

function mount(props: Partial<JourneyListProps> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onStatusChange = vi.fn();
  const onQueryChange = vi.fn();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <JourneyList
        items={ITEMS}
        isLoading={false}
        errorMessage={null}
        status={null}
        query=""
        onStatusChange={onStatusChange}
        onQueryChange={onQueryChange}
        tenantId={T}
        canChangeStatus
        emptyLabel="PUSTO"
        {...props}
      />
    </QueryClientProvider>,
  );
  return { ...view, onStatusChange, onQueryChange };
}

function rows() {
  return screen.getAllByRole("row").slice(1);
}

beforeEach(() => {
  h.navigate.mockReset();
  h.setStatus.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});
afterEach(cleanup);

describe("JourneyList", () => {
  it("tabela: podpis, nagłówki, odnośnik do edytora, kolumny danych", async () => {
    const { container } = mount();
    const table = screen.getByRole("table", { name: t("adminJourneys.list.caption") });
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((th) => th.textContent);
    expect(headers).toEqual([
      t("adminJourneys.list.columns.name"),
      t("adminJourneys.list.columns.status"),
      t("adminJourneys.list.columns.trigger"),
      t("adminJourneys.list.columns.active"),
      t("adminJourneys.list.columns.enrolled30d"),
      t("adminJourneys.list.columns.goal30d"),
      t("adminJourneys.list.columns.version"),
      t("adminJourneys.list.columns.actions"),
    ]);
    const first = rows()[0];
    const link = within(first).getByRole("link", {
      name: t("adminJourneys.list.open", { name: "Powitanie nowego konta" }),
    });
    expect(link).toHaveAttribute(
      "href",
      "/admin/revenue/journeys/aaaaaaaa-0000-4000-8000-000000000001",
    );
    expect(within(first).getByRole("rowheader")).toHaveTextContent("powitanie");
    expect(first).toHaveTextContent(t("adminJourneys.common.status.active"));
    expect(first).toHaveTextContent(t("adminJourneys.trigger.account_registered"));
    expect(first).toHaveTextContent(t("adminJourneys.list.fromTemplate"));
    expect(first).toHaveTextContent("v2");
    expect(first).toHaveTextContent(/25/);
    const draft = rows()[2];
    expect(draft).toHaveTextContent(t("adminJourneys.list.noTrigger"));
    expect(draft).toHaveTextContent(t("adminJourneys.list.versionNone"));
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("szukanie obejmuje nazwę, klucz i przetłumaczony wyzwalacz", () => {
    const ids = () => rows().map((row) => row.getAttribute("data-journey-id")?.slice(-1));
    mount({ query: "b2b" });
    expect(ids()).toEqual(["3"]);
    cleanup();
    mount({ query: "Stara" });
    expect(ids()).toEqual(["4"]);
    cleanup();
    // „Stara ścieżka” startuje na porzuconej kasie - trafia przez nazwę wyzwalacza.
    mount({ query: t("adminJourneys.trigger.checkout_abandoned").toUpperCase() });
    expect(ids()).toEqual(["2", "4"]);
    cleanup();
    mount({ query: t("adminJourneys.trigger.account_registered") });
    expect(ids()).toEqual(["1"]);
  });

  it("filtr statusu z adresu i jego zmiana", () => {
    const { onStatusChange } = mount({ status: "paused" });
    expect(rows()).toHaveLength(1);
    const select = screen.getByRole("combobox", { name: t("adminJourneys.list.statusFilter") });
    expect(select).toHaveValue("paused");
    fireEvent.change(select, { target: { value: "archived" } });
    expect(onStatusChange).toHaveBeenLastCalledWith("archived");
    fireEvent.change(select, { target: { value: "" } });
    expect(onStatusChange).toHaveBeenLastCalledWith(null);
  });

  it("pusty wynik filtra mówi o filtrze, pusta lista - etykietę zakładki", () => {
    mount({ query: "nic takiego" });
    expect(screen.getByText(t("adminJourneys.list.emptyFiltered"))).toBeInTheDocument();
    cleanup();
    mount({ items: [] });
    expect(screen.getByText("PUSTO")).toBeInTheDocument();
  });

  it("wczytywanie i awaria to inne stany niż pustka", () => {
    mount({ items: null, isLoading: true });
    expect(screen.getByText(t("adminJourneys.list.loading"))).toBeInTheDocument();
    cleanup();
    mount({ items: null, errorMessage: t("adminJourneys.list.loadError") });
    expect(screen.getByText(t("adminJourneys.list.loadError"))).toBeInTheDocument();
  });

  it("akcje admina: dozwolone przejścia statusu", () => {
    mount();
    const [active, paused, draft, archived] = rows();
    const names = (row: HTMLElement) =>
      within(row)
        .queryAllByRole("button")
        .map((b) => b.textContent);
    expect(names(active)).toEqual([
      t("adminJourneys.list.actions.pause"),
      t("adminJourneys.list.actions.archive"),
    ]);
    expect(names(paused)).toEqual([
      t("adminJourneys.list.actions.resume"),
      t("adminJourneys.list.actions.archive"),
    ]);
    expect(names(draft)).toEqual([t("adminJourneys.list.actions.archive")]);
    expect(names(archived)).toEqual([]);
  });

  it("wstrzymanie: potwierdzenie, token updated_at, komunikat sukcesu", async () => {
    h.setStatus.mockResolvedValue({
      ok: true,
      data: { id: ITEMS[0].id, updatedAt: "2026-10-20T11:00:00+00:00", status: "paused" },
    });
    mount();
    fireEvent.click(
      screen.getByRole("button", {
        name: t("adminJourneys.list.actions.pauseFor", { name: "Powitanie nowego konta" }),
      }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(
      t("adminJourneys.list.confirm.pauseTitle", { name: "Powitanie nowego konta" }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: t("adminJourneys.list.actions.pause") }),
    );
    await waitFor(() =>
      expect(h.setStatus).toHaveBeenCalledWith({
        data: {
          journeyId: ITEMS[0].id,
          status: "paused",
          expectedUpdatedAt: "2026-10-20T10:00:00+00:00",
        },
      }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(t("adminJourneys.list.done.paused")),
    );
  });

  it("konflikt: komunikat z kodem i powodem, bez wyjątku", async () => {
    h.setStatus.mockResolvedValue({
      ok: false,
      error: "conflict",
      reason: "conflict",
      detail: null,
    });
    mount();
    fireEvent.click(
      screen.getByRole("button", {
        name: t("adminJourneys.list.actions.archiveFor", { name: "Szkic B2B" }),
      }),
    );
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: t("adminJourneys.list.actions.archive") }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(t("adminJourneys.mutationError.conflict")),
    );
  });

  it("redaktor nie widzi akcji statusu", () => {
    mount({ canChangeStatus: false });
    expect(
      screen.queryByRole("columnheader", { name: t("adminJourneys.list.columns.actions") }),
    ).toBeNull();
    expect(screen.queryAllByRole("button", { name: /Wstrzymaj|Archiwizuj/ })).toEqual([]);
  });

  it("klik w wiersz otwiera edytor (odnośnik i przyciski działają po swojemu)", () => {
    mount();
    const cells = within(rows()[1]).getAllByRole("cell");
    fireEvent.click(cells[1]);
    expect(h.navigate).toHaveBeenCalledWith({
      to: "/admin/revenue/journeys/$journeyId",
      params: { journeyId: "aaaaaaaa-0000-4000-8000-000000000002" },
    });
    h.navigate.mockReset();
    fireEvent.click(within(rows()[1]).getByRole("button", { name: /Wznów/ }));
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("wejście do edytora (wiersz albo odnośnik) zapamiętuje filtr listy dla okruszków", () => {
    window.sessionStorage.clear();
    expect(recallJourneyListSearch()).toEqual({});
    mount({ status: "paused", query: "  kasa " });
    fireEvent.click(within(rows()[0]).getAllByRole("cell")[1]);
    expect(recallJourneyListSearch()).toEqual({ status: "paused", q: "kasa" });
    cleanup();

    // Pusty filtr nadpisuje poprzedni - okruszki nie wracają do starego.
    mount();
    fireEvent.click(screen.getByRole("link", { name: /Powitanie nowego konta/ }));
    expect(recallJourneyListSearch()).toEqual({});
  });

  it("odczyt filtra: walidator adresu huba, śmieci i zablokowana pamięć = pełna lista", () => {
    rememberJourneyListSearch({ status: "active", q: "powitanie" });
    expect(recallJourneyListSearch()).toEqual({ status: "active", q: "powitanie" });
    window.sessionStorage.setItem(
      "nes.journeyList.search",
      JSON.stringify({ status: "usunięta", q: "x".repeat(500) }),
    );
    expect(recallJourneyListSearch()).toEqual({});
    window.sessionStorage.setItem("nes.journeyList.search", "{nie json");
    expect(recallJourneyListSearch()).toEqual({});
    // Zablokowana pamięć karty (tryb prywatny, polityka witryny): sam dostęp rzuca.
    const blocked = vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => rememberJourneyListSearch({ q: "a" })).not.toThrow();
    expect(recallJourneyListSearch()).toEqual({});
    blocked.mockRestore();
  });
});
