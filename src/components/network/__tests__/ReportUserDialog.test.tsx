// ReportUserDialog: zgłoszenie osoby do moderacji tenanta.
// Dialog jest sterowany z zewnątrz (popover ConnectButton), więc testujemy sam
// dialog. Domknięty słownik powodów jest kontraktem z CHECK-iem w bazie, a
// dedup i limit dzienny egzekwuje RPC - UI musi tylko odróżnić limit od
// zwykłego błędu.
//
// Cztery przypadki `ReportUserButton` odpadły 20260913 razem z komponentem:
// był wyeksportowany i przetestowany, a nie wołał go ŻADEN plik produkcyjny.
// Test kodu bez użytkownika to nie pokrycie, tylko koszt utrzymania, który
// wygląda jak pokrycie.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  NETWORK_IDS,
  PEER_NAME,
  failingMutation,
  idleMutation,
  pendingMutation,
  succeedingMutation,
  translateKey as k,
  type MutationStub,
} from "@/test/network/fixtures";

type ReportVars = { userId: string; reason: string; details?: string };

const h = vi.hoisted(() => ({
  user: { id: "user-me" } as { id: string } | null,
  report: null as unknown,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastErrorMapper: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/network/fixtures")).reactI18nextStub());
vi.mock("@/lib/i18n-network", () => ({ ensureI18n: () => {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/lib/network/useConnections", () => ({ useReportUser: () => h.report }));
vi.mock("@/lib/toastError", () => ({ toastError: h.toastErrorMapper }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

import { ReportUserDialog } from "@/components/network/ReportUserDialog";

const report = (): MutationStub<ReportVars, string> => h.report as MutationStub<ReportVars, string>;

const REASONS = ["spam", "harassment", "impersonation", "inappropriate", "other"] as const;

function renderDialog(open = true) {
  const onOpenChange = vi.fn();
  const view = render(
    <ReportUserDialog
      userId={NETWORK_IDS.peer}
      displayName={PEER_NAME}
      open={open}
      onOpenChange={onOpenChange}
    />,
  );
  return { ...view, onOpenChange };
}

function openReasonList(): void {
  fireEvent.keyDown(screen.getByRole("combobox", { name: k("network.reportReasonLabel") }), {
    key: "ArrowDown",
  });
}

function submit(): void {
  fireEvent.click(screen.getByRole("button", { name: k("network.reportSubmit") }));
}

beforeEach(() => {
  h.user = { id: NETWORK_IDS.me };
  h.report = idleMutation<ReportVars, string>();
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
  h.toastErrorMapper.mockClear();
});

describe("ReportUserDialog", () => {
  it("zamknięty: nic nie renderuje", () => {
    const { container } = renderDialog(false);
    expect(container).toBeEmptyDOMElement();
  });

  it("otwarty: tytuł z nazwą osoby i wyjaśnienie, że zgłoszenie jest niewidoczne dla zgłaszanego", () => {
    renderDialog();
    expect(screen.getByText(k("network.reportTitle", { name: PEER_NAME }))).toBeInTheDocument();
    expect(screen.getByText(k("network.reportBody"))).toBeInTheDocument();
  });

  it("słownik powodów jest domknięty i zgodny z CHECK-iem bazy", () => {
    renderDialog();
    openReasonList();
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(REASONS.map((r) => k(`network.reportReasons.${r}`)));
  });

  it("domyślny powód to spam, a szczegóły mają limit 1000 znaków", () => {
    renderDialog();
    expect(
      screen.getByRole("combobox", { name: k("network.reportReasonLabel") }),
    ).toHaveTextContent(k("network.reportReasons.spam"));
    expect(screen.getByRole("textbox", { name: k("network.reportDetailsLabel") })).toHaveAttribute(
      "maxlength",
      "1000",
    );
  });

  it("wysyłka: RPC dostaje osobę, powód i szczegóły; sukces zamyka dialog", () => {
    h.report = succeedingMutation<ReportVars, string>("report-1");
    const { onOpenChange } = renderDialog();
    fireEvent.change(screen.getByRole("textbox", { name: k("network.reportDetailsLabel") }), {
      target: { value: "Masowe zaproszenia do sieci" },
    });
    submit();

    expect(report().lastVars()).toEqual({
      userId: NETWORK_IDS.peer,
      reason: "spam",
      details: "Masowe zaproszenia do sieci",
    });
    expect(h.toastSuccess).toHaveBeenCalledWith(k("network.reportedToast"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("zmiana powodu trafia do RPC", () => {
    h.report = succeedingMutation<ReportVars, string>("report-1");
    renderDialog();
    openReasonList();
    fireEvent.click(screen.getByRole("option", { name: k("network.reportReasons.harassment") }));
    submit();
    expect(report().lastVars()?.reason).toBe("harassment");
  });

  it("limit dzienny zgłoszeń: własny komunikat, dialog zostaje otwarty", () => {
    h.report = failingMutation<ReportVars, string>("report_user: rate limited");
    const { onOpenChange } = renderDialog();
    submit();
    expect(h.toastError).toHaveBeenCalledWith(k("network.reportRateLimited"));
    expect(h.toastErrorMapper).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("inny błąd: generyczny mapper", () => {
    h.report = failingMutation<ReportVars, string>("permission denied");
    renderDialog();
    submit();
    expect(h.toastErrorMapper).toHaveBeenCalledTimes(1);
    expect(h.toastErrorMapper.mock.calls[0][1]).toBe("save");
  });

  it("wysyłka w locie: przycisk zablokowany (dedup i tak jest w bazie)", () => {
    h.report = pendingMutation<ReportVars, string>();
    renderDialog();
    expect(screen.getByRole("button", { name: k("network.reportSubmit") })).toBeDisabled();
  });
});
