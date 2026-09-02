// Lista zapytań eksperckich - skrzynka ODEBRANYCH i wejście z powiadomienia.
//
// Istniejący `expertRequestCancel.test.tsx` pilnuje jednej ścieżki: wycofania
// zapytania ze skrzynki „wysłane" (kliknięcie otwiera potwierdzenie, a nie od
// razu mutację). Ten plik dobija DRUGĄ POŁOWĘ komponentu, której tamten nie
// dotyka: skrzynkę „otrzymane" z parą akcji przyjmij/odrzuć, stan pusty,
// podświetlenie i przewinięcie do zapytania wskazanego z powiadomienia oraz
// mapowanie odmowy serwera na komunikat.
//
// DLACZEGO TO NIE JEST KOSMETYKA. Akcje skrzynki „otrzymane" są NIEODWRACALNE
// z punktu widzenia nadawcy (odrzucenie zużywa jego pulę miesięczną), a stały
// dotąd na nietrafionej gałęzi `box === "sent" ? ... : ...` - czyli jedna
// literówka w warunku pokazywałaby odbiorcy przycisk „Wycofaj" zamiast pary
// decyzji, a suita byłaby zielona.
//
// RODO: tematy i treści zapytań są zmyślone.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import type { ExpertRequestQuota, ExpertRequestRow } from "@/lib/chat/useExpertRequests";

const h = vi.hoisted(() => ({
  rows: [] as ExpertRequestRow[],
  resolveSpy: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  scrolled: [] as Array<Record<string, unknown>>,
  quota: { data: undefined as ExpertRequestQuota | undefined, isPending: false },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && Object.keys(opts).length > 0 ? `${key} ${JSON.stringify(opts)}` : key,
  }),
}));

vi.mock("@/lib/i18n-expert-request", () => ({ ensureI18n: vi.fn() }));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => h.toastSuccess(...args),
    error: (...args: unknown[]) => h.toastError(...args),
  },
}));

vi.mock("@/lib/chat/useExpertRequests", () => ({
  useMyExpertRequests: () => ({ data: h.rows, isPending: false }),
  useMyExpertRequestQuota: () => h.quota,
  useResolveExpertRequest: () => ({ mutateAsync: h.resolveSpy, isPending: false }),
}));

import { ExpertRequestList } from "@/components/chat/ExpertRequestList";

/**
 * Wiersz skrzynki w PEŁNYM kształcie wiersza bazy - bez rzutowania. Brakująca
 * kolumna ma być błędem typów TUTAJ, przy zmianie migracji, a nie cichym
 * `undefined` w renderze.
 */
function row(overrides: Partial<ExpertRequestRow> = {}): ExpertRequestRow {
  return {
    id: "req-1",
    tenant_id: "tenant-alfa",
    sender_id: "user-nadawca",
    recipient_id: "user-odbiorca",
    subject: "Konsultacja regulacyjna",
    reason: "Prośba o rozmowę na temat projektu rozporządzenia.",
    questions: [],
    expected_answers: null,
    external_links: [],
    status: "pending",
    admin_note: null,
    decline_reason: null,
    responded_at: null,
    converted_conversation_id: null,
    created_at: "2026-08-01T10:00:00Z",
    updated_at: "2026-08-01T10:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  h.rows = [row()];
  h.resolveSpy = vi.fn(async () => ({ status: "approved" }));
  h.toastSuccess = vi.fn();
  h.toastError = vi.fn();
  h.scrolled = [];
  // happy-dom nie implementuje `scrollIntoView` - wejście z powiadomienia
  // wywołałoby błąd zamiast przewinięcia.
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: function scrollIntoViewStub(options: Record<string, unknown>) {
      h.scrolled.push(options);
    },
  });
});

describe("skrzynka ODEBRANYCH", () => {
  it("oczekujące zapytanie daje PARĘ decyzji, nie wycofanie", () => {
    renderWithQueryClient(<ExpertRequestList box="received" />);
    expect(screen.getByRole("button", { name: "expertRequest.actions.approve" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "expertRequest.actions.decline" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "expertRequest.actions.cancel" })).toBeNull();
  });

  it("przyjęcie woła RPC z akcją `approve` i melduje sukces", async () => {
    renderWithQueryClient(<ExpertRequestList box="received" />);
    fireEvent.click(screen.getByRole("button", { name: "expertRequest.actions.approve" }));

    await waitFor(() =>
      expect(h.resolveSpy).toHaveBeenCalledWith({ requestId: "req-1", action: "approve" }),
    );
    // Etykieta sukcesu dla `approve` to `approved`, nie `approve` - ta zamiana
    // jest w kodzie warunkiem trójargumentowym i nikt jej dotąd nie sprawdził.
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("expertRequest.status.approved"),
    );
  });

  it("odrzucenie woła RPC z akcją `decline` i własnym komunikatem", async () => {
    renderWithQueryClient(<ExpertRequestList box="received" />);
    fireEvent.click(screen.getByRole("button", { name: "expertRequest.actions.decline" }));

    await waitFor(() =>
      expect(h.resolveSpy).toHaveBeenCalledWith({ requestId: "req-1", action: "decline" }),
    );
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("expertRequest.status.decline"),
    );
  });

  it("ODMOWA SERWERA nie udaje sukcesu - komunikat idzie z mapowania werdyktów", async () => {
    h.resolveSpy = vi.fn(async () => {
      throw new Error("expert_request: monthly quota exceeded");
    });
    renderWithQueryClient(<ExpertRequestList box="received" />);
    fireEvent.click(screen.getByRole("button", { name: "expertRequest.actions.approve" }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("zapytanie ROZSTRZYGNIĘTE nie ma już żadnej akcji", () => {
    h.rows = [row({ status: "approved" })];
    renderWithQueryClient(<ExpertRequestList box="received" />);
    expect(screen.queryByRole("button", { name: "expertRequest.actions.approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "expertRequest.actions.decline" })).toBeNull();
    expect(screen.getByText("expertRequest.status.approved")).toBeTruthy();
  });

  it("pusta skrzynka pokazuje komunikat, a nie pustą listę", () => {
    h.rows = [];
    renderWithQueryClient(<ExpertRequestList box="received" />);
    expect(screen.getByText("expertRequest.box.empty")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });
});

describe("wejście z powiadomienia", () => {
  it("wskazane zapytanie jest PODŚWIETLONE i przewinięte na środek", async () => {
    h.rows = [row({ id: "req-1" }), row({ id: "req-2", subject: "Drugie zapytanie" })];
    const { container } = renderWithQueryClient(
      <ExpertRequestList box="received" highlightId="req-2" />,
    );

    await waitFor(() => expect(h.scrolled).toHaveLength(1));
    // `block: "center"`, nie domyślne „start" - inaczej wiersz chowa się pod
    // przyklejonym nagłówkiem profilu.
    expect(h.scrolled[0]).toMatchObject({ block: "center" });

    const highlighted = container.querySelectorAll("li.border-\\[var\\(--brand\\)\\]");
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0]?.textContent).toContain("Drugie zapytanie");
  });

  it("bez wskazania nic nie jest podświetlone i nic się nie przewija", () => {
    h.rows = [row({ id: "req-1" }), row({ id: "req-2" })];
    const { container } = renderWithQueryClient(<ExpertRequestList box="received" />);

    expect(h.scrolled).toHaveLength(0);
    expect(container.querySelectorAll("li.border-\\[var\\(--brand\\)\\]")).toHaveLength(0);
  });

  it("wskazanie zapytania SPOZA listy nie wywraca komponentu", () => {
    h.rows = [row({ id: "req-1" })];
    renderWithQueryClient(<ExpertRequestList box="received" highlightId="req-nieistniejace" />);
    expect(h.scrolled).toHaveLength(0);
    expect(screen.getByText("Konsultacja regulacyjna")).toBeTruthy();
  });
});
