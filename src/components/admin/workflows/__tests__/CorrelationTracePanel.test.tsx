// Ślad korelacji (`CorrelationTracePanel`, 0 z 13 funkcji) — pełna odpowiedź na
// pytanie „co się wydarzyło po moim kliknięciu": zdarzenia domenowe, przebiegi
// automatyzacji przypięte do zdarzeń i dostawy webhooków outboxu.
//
// To narzędzie DIAGNOSTYCZNE, więc jego wartość zależy od tego, czy oś czasu
// jest kompletna i prawdziwa. Cztery rzeczy są tu warte testu:
//
//   1. WALIDACJA UUID PRZED ZAPYTANIEM. Zapytanie ze zdeformowanym id nie
//      zwróci nic i wygląda jak „nic się nie wydarzyło" — a wydarzyło się,
//      tylko id było przekręcone przy kopiowaniu.
//   2. GRUPOWANIE PO event_id. Przebieg przypięty do złego zdarzenia myli
//      diagnozę: sugeruje, że automatyzacja odpaliła się na czymś innym.
//   3. PRZEBIEGI BEZ event_id NIE MOGĄ ZNIKNĄĆ. Przebieg bez zdarzenia to
//      dokładnie ten przypadek, którego się szuka; wypadnięcie go z osi
//      kasowałoby dowód.
//   4. DEEP-LINK NADPISUJE POLE PRZY ZMIANIE PROPA, nie przy każdym renderze —
//      inaczej ręczna edycja pola byłaby kasowana w trakcie pisania.
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import {
  EDITOR_IDS,
  BASE_ISO,
  isoOffset,
  domainEvent,
  traceDelivery,
  workflowRun,
} from "@/test/post-editor/fixtures";

const h = vi.hoisted(() => ({ fetchTrace: null as unknown }));

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(),
);
vi.mock("@/lib/i18n-admin-workflows", () => ({}));

// `isUuid` zostaje ORYGINALNY - to jego zachowanie jest tu przedmiotem testu.
vi.mock("@/lib/admin/workflows", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin/workflows")>();
  const { vi: v } = await import("vitest");
  h.fetchTrace = v.fn(async () => ({
    correlationId: EDITOR_IDS.correlation,
    events: [],
    runs: [],
    deliveries: [],
  }));
  return { ...actual, fetchCorrelationTrace: h.fetchTrace };
});

import { CorrelationTracePanel } from "@/components/admin/workflows/CorrelationTracePanel";

type Mock = ReturnType<typeof vi.fn>;
const fetchTrace = () => h.fetchTrace as Mock;

const CORR = EDITOR_IDS.correlation;

function trace(over: Partial<Record<string, unknown>> = {}) {
  return { correlationId: CORR, events: [], runs: [], deliveries: [], ...over };
}

function renderPanel(correlationId: string | null = null) {
  const onCorrelationIdChange = vi.fn();
  const view = renderWithQueryClient(
    <CorrelationTracePanel
      correlationId={correlationId}
      onCorrelationIdChange={onCorrelationIdChange}
    />,
  );
  return { ...view, onCorrelationIdChange };
}

beforeEach(() => {
  fetchTrace().mockReset();
  fetchTrace().mockResolvedValue(trace());
});

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Walidacja identyfikatora
// ---------------------------------------------------------------------------

describe("CorrelationTracePanel - walidacja identyfikatora", () => {
  it("zdeformowany identyfikator NIE wysyła zapytania i pokazuje błąd", () => {
    // Zapytanie ze złym id zwróciłoby pustkę wyglądającą jak „nic się nie
    // wydarzyło" - a wydarzyło się, tylko id było przekręcone przy kopiowaniu.
    const { onCorrelationIdChange } = renderPanel(null);

    fireEvent.change(screen.getByLabelText("adminWorkflows.trace.inputLabel"), {
      target: { value: "to-nie-jest-uuid" },
    });
    fireEvent.click(screen.getByText("adminWorkflows.trace.load"));

    expect(screen.getByText("adminWorkflows.trace.invalidUuid")).toBeInTheDocument();
    expect(onCorrelationIdChange).not.toHaveBeenCalled();
    expect(fetchTrace()).not.toHaveBeenCalled();
  });

  it("błędne pole jest oznaczone dla technologii asystujących", () => {
    renderPanel(null);
    const input = screen.getByLabelText("adminWorkflows.trace.inputLabel");
    expect(input).toHaveAttribute("aria-invalid", "false");

    fireEvent.change(input, { target: { value: "zle" } });
    fireEvent.click(screen.getByText("adminWorkflows.trace.load"));

    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("poprawiony identyfikator czyści błąd już przy pisaniu", () => {
    // Komunikat wiszący po poprawieniu wartości sugeruje, że nadal jest źle.
    renderPanel(null);
    const input = screen.getByLabelText("adminWorkflows.trace.inputLabel");
    fireEvent.change(input, { target: { value: "zle" } });
    fireEvent.click(screen.getByText("adminWorkflows.trace.load"));
    expect(screen.getByText("adminWorkflows.trace.invalidUuid")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: CORR } });

    expect(screen.queryByText("adminWorkflows.trace.invalidUuid")).toBeNull();
  });

  it("poprawny identyfikator zgłasza się w GÓRĘ, nie pobiera sam", () => {
    // Wybór śladu jest stanem TRASY (deep-link), więc panel go tylko zgłasza.
    const { onCorrelationIdChange } = renderPanel(null);

    fireEvent.change(screen.getByLabelText("adminWorkflows.trace.inputLabel"), {
      target: { value: `  ${CORR}  ` },
    });
    fireEvent.click(screen.getByText("adminWorkflows.trace.load"));

    // Białe znaki z wklejenia są obcinane.
    expect(onCorrelationIdChange).toHaveBeenCalledWith(CORR);
  });

  it("Enter w polu działa jak kliknięcie przycisku", () => {
    const { onCorrelationIdChange } = renderPanel(null);
    const input = screen.getByLabelText("adminWorkflows.trace.inputLabel");
    fireEvent.change(input, { target: { value: CORR } });

    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCorrelationIdChange).toHaveBeenCalledWith(CORR);
  });

  it("inny klawisz NIE wysyła formularza", () => {
    const { onCorrelationIdChange } = renderPanel(null);
    const input = screen.getByLabelText("adminWorkflows.trace.inputLabel");
    fireEvent.change(input, { target: { value: CORR } });

    fireEvent.keyDown(input, { key: "a" });

    expect(onCorrelationIdChange).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Deep-link
// ---------------------------------------------------------------------------

describe("CorrelationTracePanel - deep-link z historii przebiegów", () => {
  it("identyfikator z propa wypełnia pole i uruchamia pobranie", async () => {
    renderPanel(CORR);
    await waitFor(() => expect(fetchTrace()).toHaveBeenCalledWith(CORR));
    expect(screen.getByLabelText("adminWorkflows.trace.inputLabel")).toHaveValue(CORR);
  });

  it("ręczna edycja pola NIE jest nadpisywana przy kolejnych renderach", () => {
    // Wzorzec „adjust state during render" reaguje na ZMIANĘ propa, nie na
    // każdy render. Bez tego pole kasowałoby się w trakcie pisania.
    //
    // Providera montujemy sami, bo `rerender` z RTL renderuje przekazany element
    // BEZ opakowania użytego przy pierwszym renderze.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const panel = () => (
      <QueryClientProvider client={client}>
        <CorrelationTracePanel correlationId={CORR} onCorrelationIdChange={vi.fn()} />
      </QueryClientProvider>
    );
    const { rerender } = render(panel());
    const input = screen.getByLabelText("adminWorkflows.trace.inputLabel");

    fireEvent.change(input, { target: { value: "wpisuję ręcznie" } });
    // Ten sam prop, kolejny render.
    rerender(panel());

    expect(input).toHaveValue("wpisuję ręcznie");
  });

  it("brak identyfikatora NIE odpytuje serwera", () => {
    renderPanel(null);
    expect(fetchTrace()).not.toHaveBeenCalled();
  });

  it("identyfikator z propa, który NIE jest UUID, też nie odpytuje", () => {
    // Parametr URL bywa dowolny - panel nie może na nim polegać.
    renderPanel("wklejone-śmieci");
    expect(fetchTrace()).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Stany
// ---------------------------------------------------------------------------

describe("CorrelationTracePanel - stany", () => {
  it("błąd pobrania pokazuje komunikat", async () => {
    fetchTrace().mockRejectedValue(new Error("denied"));
    renderPanel(CORR);
    await waitFor(() =>
      expect(screen.getByText("adminWorkflows.common.loadError")).toBeInTheDocument(),
    );
  });

  it("ślad bez zdarzeń mówi wprost, że nic nie znaleziono", async () => {
    fetchTrace().mockResolvedValue(trace({ events: [] }));
    renderPanel(CORR);
    await waitFor(() => expect(screen.getByText("adminWorkflows.trace.empty")).toBeInTheDocument());
  });

  it("licznik zdarzeń, przebiegów i dostaw jest wypisany w nagłówku osi", async () => {
    fetchTrace().mockResolvedValue(
      trace({
        events: [domainEvent()],
        runs: [workflowRun()],
        deliveries: [traceDelivery()],
      }),
    );
    renderPanel(CORR);

    await waitFor(() =>
      expect(screen.getByText(/adminWorkflows\.trace\.eventsTitle/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/adminWorkflows\.trace\.runsTitle/)).toBeInTheDocument();
    expect(screen.getByText(/adminWorkflows\.trace\.deliveriesTitle/)).toBeInTheDocument();
  });

  it("ślad ze zdarzeniami, ale bez przebiegów, mówi o tym wprost", async () => {
    // To najczęstsza diagnoza: „zdarzenie poszło, ale żaden przepis go nie
    // złapał" - warunek nie pasuje albo przepis jest wyłączony.
    fetchTrace().mockResolvedValue(trace({ events: [domainEvent()] }));
    renderPanel(CORR);

    await waitFor(() =>
      expect(screen.getByText("adminWorkflows.trace.noRuns")).toBeInTheDocument(),
    );
    expect(screen.getByText("adminWorkflows.trace.noDeliveries")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Oś czasu
// ---------------------------------------------------------------------------

describe("CorrelationTracePanel - oś czasu", () => {
  it("przypina przebieg do zdarzenia PO event_id", async () => {
    // Przebieg przypięty do złego zdarzenia myli diagnozę: sugeruje, że
    // automatyzacja odpaliła się na czymś innym niż faktycznie.
    fetchTrace().mockResolvedValue(
      trace({
        events: [
          domainEvent({ id: "ev-1", event_type: "post.published.v1" }),
          domainEvent({ id: "ev-2", event_type: "comment.created.v1", created_at: isoOffset(5) }),
        ],
        runs: [
          workflowRun({ id: "r1", event_id: "ev-2", workflow_definitions: { name: "Przepis B" } }),
        ],
      }),
    );
    renderPanel(CORR);

    await waitFor(() => expect(screen.getByText("Przepis B")).toBeInTheDocument());
    // Przebieg siedzi w KARCIE drugiego zdarzenia, nie pierwszego.
    const items = screen.getAllByRole("listitem");
    expect(within(items[1]).getByText("Przepis B")).toBeInTheDocument();
    expect(within(items[0]).queryByText("Przepis B")).toBeNull();
  });

  it("przebieg BEZ event_id ląduje w sekcji osieroconych, nie znika", async () => {
    // To dokładnie ten przypadek, którego szuka się w diagnostyce.
    fetchTrace().mockResolvedValue(
      trace({
        events: [domainEvent({ id: "ev-1" })],
        runs: [
          workflowRun({
            id: "orphan",
            event_id: null,
            workflow_definitions: { name: "Przepis osierocony" },
          }),
        ],
      }),
    );
    renderPanel(CORR);

    await waitFor(() => expect(screen.getByText("Przepis osierocony")).toBeInTheDocument());
    // Nie znalazł się w karcie zdarzenia.
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).queryByText("Przepis osierocony")).toBeNull();
  });

  it("przebieg usuniętego przepisu ma etykietę zastępczą", async () => {
    fetchTrace().mockResolvedValue(
      trace({
        events: [domainEvent({ id: "ev-1" })],
        runs: [workflowRun({ event_id: "ev-1", workflow_definitions: null })],
      }),
    );
    renderPanel(CORR);
    await waitFor(() =>
      expect(screen.getByText("adminWorkflows.runs.deletedWorkflow")).toBeInTheDocument(),
    );
  });

  it("liczy offset względem PIERWSZEGO zdarzenia śladu", async () => {
    // Odstęp czasowy jest tu treścią diagnostyczną: pokazuje, ile silnik
    // potrzebował na reakcję.
    fetchTrace().mockResolvedValue(
      trace({
        events: [
          domainEvent({ id: "ev-1", created_at: BASE_ISO }),
          domainEvent({ id: "ev-2", created_at: isoOffset(2) }),
        ],
      }),
    );
    renderPanel(CORR);

    await waitFor(() =>
      expect(screen.getByText(/adminWorkflows\.trace\.startOffset/)).toBeInTheDocument(),
    );
    // 2 minuty = 120 000 ms; pierwsze zdarzenie ma offset 0 i go nie pokazuje.
    expect(screen.getAllByText(/adminWorkflows\.trace\.startOffset/)).toHaveLength(1);
  });

  it("aktor zdarzenia jest pokazany, gdy istnieje", async () => {
    fetchTrace().mockResolvedValue(trace({ events: [domainEvent({ actor_id: "user-xyz" })] }));
    renderPanel(CORR);
    await waitFor(() =>
      expect(screen.getByText("adminWorkflows.trace.actor:")).toBeInTheDocument(),
    );
  });

  it("zdarzenie systemowe (bez aktora) nie pokazuje pustego wiersza aktora", async () => {
    fetchTrace().mockResolvedValue(trace({ events: [domainEvent({ actor_id: null })] }));
    renderPanel(CORR);
    await waitFor(() =>
      expect(screen.getByText("adminWorkflows.trace.aggregate:")).toBeInTheDocument(),
    );
    expect(screen.queryByText("adminWorkflows.trace.actor:")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Dostawy webhooków
// ---------------------------------------------------------------------------

describe("CorrelationTracePanel - dostawy outboxu", () => {
  it("dostawa jest przypięta do swojego zdarzenia, z liczbą prób", async () => {
    fetchTrace().mockResolvedValue(
      trace({
        events: [domainEvent({ id: "ev-1" })],
        deliveries: [traceDelivery({ event_id: "ev-1", attempts: 3 })],
      }),
    );
    renderPanel(CORR);

    await waitFor(() => expect(screen.getByText("Slack redakcji")).toBeInTheDocument());
    expect(screen.getByText(/adminWorkflows\.trace\.attempts/)).toBeInTheDocument();
  });

  it("dostawa bez nazwy punktu końcowego pokazuje typ zdarzenia", async () => {
    fetchTrace().mockResolvedValue(
      trace({
        events: [domainEvent({ id: "ev-1" })],
        deliveries: [traceDelivery({ event_id: "ev-1", integration_endpoints: null })],
      }),
    );
    renderPanel(CORR);
    await waitFor(() => expect(screen.getAllByText("post.published.v1").length).toBeGreaterThan(0));
  });

  it("błąd dostawy jest widoczny wraz z podpowiedzią", async () => {
    fetchTrace().mockResolvedValue(
      trace({
        events: [domainEvent({ id: "ev-1" })],
        deliveries: [traceDelivery({ event_id: "ev-1", last_error: "502 Bad Gateway" })],
      }),
    );
    renderPanel(CORR);

    await waitFor(() => expect(screen.getByText("502 Bad Gateway")).toBeInTheDocument());
    expect(screen.getByTitle("502 Bad Gateway")).toBeInTheDocument();
  });

  it("dostawa BEZ event_id jest pomijana w osi (nie ma gdzie jej przypiąć)", async () => {
    fetchTrace().mockResolvedValue(
      trace({
        events: [domainEvent({ id: "ev-1" })],
        deliveries: [traceDelivery({ event_id: null, integration_endpoints: { name: "Sierota" } })],
      }),
    );
    renderPanel(CORR);

    await waitFor(() =>
      expect(screen.getByText("adminWorkflows.trace.aggregate:")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Sierota")).toBeNull();
  });

  it("dostawa niedostarczona nie pokazuje daty dostarczenia", async () => {
    fetchTrace().mockResolvedValue(
      trace({
        events: [domainEvent({ id: "ev-1" })],
        deliveries: [traceDelivery({ event_id: "ev-1", delivered_at: null })],
      }),
    );
    renderPanel(CORR);

    await waitFor(() => expect(screen.getByText("Slack redakcji")).toBeInTheDocument());
    expect(screen.queryByText("adminWorkflows.trace.deliveredAt")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

describe("CorrelationTracePanel - payload zdarzenia", () => {
  it("payload jest DOMYŚLNIE schowany, z licznikiem kluczy", async () => {
    // Payloady bywają duże; rozwinięte zasłoniłyby oś czasu.
    fetchTrace().mockResolvedValue(
      trace({ events: [domainEvent({ payload: { slug: "x", status: "published" } })] }),
    );
    renderPanel(CORR);

    await waitFor(() =>
      expect(screen.getByText(/adminWorkflows\.trace\.payload/)).toBeInTheDocument(),
    );
    const toggle = screen.getByRole("button", { name: /payload/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/"published"/)).toBeNull();
  });

  it("kliknięcie rozwija payload jako sformatowany JSON", async () => {
    fetchTrace().mockResolvedValue(trace({ events: [domainEvent({ payload: { slug: "x" } })] }));
    renderPanel(CORR);
    await waitFor(() =>
      expect(screen.getByText(/adminWorkflows\.trace\.payload/)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /payload/ }));

    expect(screen.getByRole("button", { name: /payload/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText(/"slug": "x"/)).toBeInTheDocument();
  });

  it("PUSTY payload nie renderuje przycisku w ogóle", async () => {
    // Przycisk rozwijający pustkę to obiecanka bez pokrycia.
    fetchTrace().mockResolvedValue(trace({ events: [domainEvent({ payload: {} })] }));
    renderPanel(CORR);

    await waitFor(() =>
      expect(screen.getByText("adminWorkflows.trace.aggregate:")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/adminWorkflows\.trace\.payload/)).toBeNull();
  });

  it("payload nie będący obiektem jest traktowany jak pusty", async () => {
    fetchTrace().mockResolvedValue(trace({ events: [domainEvent({ payload: "tekst" })] }));
    renderPanel(CORR);

    await waitFor(() =>
      expect(screen.getByText("adminWorkflows.trace.aggregate:")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/adminWorkflows\.trace\.payload/)).toBeNull();
  });
});
