// Zgłoszenie WPISU klubowego do moderacji (`ClubReportDialog`).
//
// CO TEN PLIK DOWODZI.
//  1. PAYLOAD przez PRAWDZIWĄ warstwę danych (`useReportClubContent` ->
//     `reportClubContent` -> `supabase.rpc`): zgłoszenie niesie RODZAJ i
//     IDENTYFIKATOR celu oraz powód, i NIE niesie autora - pod regułą Chatham
//     House klient go nie ma, autora rozwiązuje RPC. Asercje patrzą na nazwy
//     argumentów RPC, bo zgubiony `p_target_type` przechodzi przez `tsc`.
//  2. SZCZEGÓŁY są opcjonalne i normalizowane: pusty opis oraz opis z samych
//     spacji NIE jedzie jako puste zdanie, tylko nie jedzie wcale.
//  3. Licznik znaków pokazuje realną długość wpisanego tekstu wobec limitu.
//  4. SUKCES zamyka dialog, czyści opis i potwierdza; ODMOWA bazy pokazuje
//     KLUCZ i18n i ZOSTAWIA dialog otwarty razem z wpisanym opisem - inaczej
//     zgłaszający traci treść i nie wie, czy sprawa poszła.
//  5. Wysyłka w locie blokuje oba przyciski, a drugie kliknięcie nie wysyła
//     drugiego zgłoszenia.
//  6. Dialog rejestruje przestrzeń tłumaczeń klubu (`ensureClubI18n`) - bez
//     tego wywołania okno pokazałoby gołe klucze.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//  - SŁOWNIKA powodów: `CLUB_REPORT_REASONS` mieszka w `types.ts`; tutaj
//    dowodzimy tylko, że lista wyboru jest z niego zbudowana w całości.
//  - AUTORYTETU: kto może zgłaszać i co się dzieje z pozycją w kolejce, rozstrzyga
//    RPC `club_report_content` i pgTAP; tu widzimy wyłącznie stronę klienta.
//  - PRZEJŚCIA moderacyjnego: kolejka i decyzje to `moderationRules` i panel admina.
//
// Radix (Dialog, Select) nie działa pod happy-dom bez pełnego API wskaźnika,
// więc oba prymitywy stoją tu w natywnych odpowiednikach - dialog renderuje
// treść tylko przy `open`, a lista wyboru jest `<select>` z `<option>`.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  toast: {
    success: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>(),
  },
  ensureI18n: vi.fn<() => void>(),
  /** Zatrzask odpowiedzi RPC - pozwala zobaczyć stan „wysyłka w locie”. */
  gate: null as Promise<void> | null,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("sonner", () => ({ toast: h.toast }));

vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: h.ensureI18n }));

// Radix Dialog pod happy-dom nie ma pełnego API wskaźnika - natywny
// odpowiednik renderuje treść dokładnie wtedy, gdy `open`.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
    open === true ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
}));

// Lista wyboru: natywny `<select>` z podniesionym `id` z wyzwalacza, żeby
// powiązanie `Label htmlFor` -> pole dało się sprawdzić przez etykietę.
vi.mock("@/components/ui/select", async () => {
  const react = await import("react");
  const labelProps = (node: ReactNode): { id?: string } | null => {
    if (!react.isValidElement<{ id?: string }>(node)) return null;
    return "id" in node.props ? node.props : null;
  };
  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value?: string;
      onValueChange?: (next: string) => void;
      children?: ReactNode;
    }) => {
      const parts = react.Children.toArray(children);
      const trigger = parts.find((part) => labelProps(part) !== null);
      return (
        <select
          id={trigger === undefined ? undefined : labelProps(trigger)?.id}
          value={value}
          onChange={(event) => onValueChange?.(event.target.value)}
        >
          {parts.filter((part) => part !== trigger)}
        </select>
      );
    },
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
    SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
      <option value={value}>{children}</option>
    ),
  };
});

vi.mock("@/integrations/supabase/client", async () => {
  const { clubSupabaseMock } = await import("@/test/clubs/fixtures");
  return {
    supabase: {
      ...clubSupabaseMock.supabase,
      rpc: (name: string, args?: Record<string, unknown>) => {
        const result = clubSupabaseMock.supabase.rpc(name, args);
        const gate = h.gate;
        return gate === null ? result : gate.then(() => result);
      },
    },
  };
});

import { ClubReportDialog } from "@/components/clubs/molecules/ClubReportDialog";
import { CLUB_IDS, clubRpc, resetClubRpc } from "@/test/clubs/fixtures";
import { CLUB_REPORT_REASONS } from "@/lib/clubs/types";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { translateKey } from "@/test/i18nStub";

const REPORT_RPC = "club_report_content";

function reasonSelect(): HTMLSelectElement {
  const el = screen.getByLabelText(translateKey("club.report.reasonLabel"));
  if (!(el instanceof HTMLSelectElement)) throw new Error("lista powodów nie jest polem wyboru");
  return el;
}

function detailsField(): HTMLTextAreaElement {
  const el = screen.getByLabelText(translateKey("club.report.detailsLabel"));
  if (!(el instanceof HTMLTextAreaElement)) throw new Error("opis nie jest polem tekstowym");
  return el;
}

const submitButton = (): HTMLElement =>
  screen.getByRole("button", { name: translateKey("club.report.submit") });
const cancelButton = (): HTMLElement =>
  screen.getByRole("button", { name: translateKey("club.report.cancel") });

beforeEach(() => {
  resetClubRpc();
  h.toast.success.mockReset();
  h.toast.error.mockReset();
  h.ensureI18n.mockReset();
  h.gate = null;
  clubRpc.setData(REPORT_RPC, "report-1");
});

afterEach(cleanup);

describe("ClubReportDialog - powierzchnia okna", () => {
  it("zamknięte okno nie renderuje formularza", () => {
    renderWithQueryClient(
      <ClubReportDialog
        targetType="thread"
        targetId={CLUB_IDS.thread}
        open={false}
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.queryByText(translateKey("club.report.title"))).toBeNull();
  });

  it("otwarte okno rejestruje tłumaczenia klubu i pokazuje CAŁY słownik powodów", () => {
    renderWithQueryClient(
      <ClubReportDialog
        targetType="thread"
        targetId={CLUB_IDS.thread}
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(h.ensureI18n).toHaveBeenCalled();
    expect(screen.getByText(translateKey("club.report.title"))).toBeInTheDocument();
    expect(screen.getByText(translateKey("club.report.description"))).toBeInTheDocument();

    const options = Array.from(reasonSelect().options).map((option) => option.value);
    expect(options).toEqual([...CLUB_REPORT_REASONS]);
    expect(reasonSelect().value).toBe("inappropriate");
    expect(screen.getByText(`0 / 1000`)).toBeInTheDocument();
  });

  it("anulowanie zamyka okno i nie wysyła zgłoszenia", () => {
    const onOpenChange = vi.fn<(open: boolean) => void>();
    renderWithQueryClient(
      <ClubReportDialog
        targetType="thread"
        targetId={CLUB_IDS.thread}
        open
        onOpenChange={onOpenChange}
      />,
    );
    fireEvent.click(cancelButton());

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(clubRpc.callsFor(REPORT_RPC)).toHaveLength(0);
  });
});

describe("ClubReportDialog - payload zgłoszenia", () => {
  it("niesie rodzaj i identyfikator celu, powód domyślny i BRAK opisu", async () => {
    renderWithQueryClient(
      <ClubReportDialog
        targetType="thread"
        targetId={CLUB_IDS.thread}
        open
        onOpenChange={vi.fn()}
      />,
    );
    fireEvent.click(submitButton());

    await waitFor(() => expect(clubRpc.callsFor(REPORT_RPC)).toHaveLength(1));
    const call = clubRpc.lastCall(REPORT_RPC);
    expect(call?.arg("p_target_type")).toBe("thread");
    expect(call?.arg("p_target_id")).toBe(CLUB_IDS.thread);
    expect(call?.arg("p_reason")).toBe("inappropriate");
    expect(call?.arg("p_details")).toBeUndefined();
    expect(call?.keys()).not.toContain("p_author_id");
  });

  it("zgłoszenie odpowiedzi z innym powodem i przyciętym opisem", async () => {
    renderWithQueryClient(
      <ClubReportDialog targetType="reply" targetId={CLUB_IDS.reply} open onOpenChange={vi.fn()} />,
    );
    fireEvent.change(reasonSelect(), { target: { value: "harassment" } });
    fireEvent.change(detailsField(), { target: { value: "  atak na osobę  " } });
    expect(screen.getByText(`17 / 1000`)).toBeInTheDocument();

    fireEvent.click(submitButton());

    await waitFor(() => expect(clubRpc.callsFor(REPORT_RPC)).toHaveLength(1));
    const call = clubRpc.lastCall(REPORT_RPC);
    expect(call?.arg("p_target_type")).toBe("reply");
    expect(call?.arg("p_target_id")).toBe(CLUB_IDS.reply);
    expect(call?.arg("p_reason")).toBe("harassment");
    expect(call?.arg("p_details")).toBe("atak na osobę");
  });

  it("opis z samych spacji nie jedzie jako pusty opis", async () => {
    renderWithQueryClient(
      <ClubReportDialog
        targetType="thread"
        targetId={CLUB_IDS.thread}
        open
        onOpenChange={vi.fn()}
      />,
    );
    fireEvent.change(detailsField(), { target: { value: "    " } });
    fireEvent.click(submitButton());

    await waitFor(() => expect(clubRpc.callsFor(REPORT_RPC)).toHaveLength(1));
    expect(clubRpc.lastCall(REPORT_RPC)?.arg("p_details")).toBeUndefined();
  });
});

describe("ClubReportDialog - wynik wysyłki", () => {
  it("sukces zamyka okno, czyści opis i potwierdza przyjęcie sprawy", async () => {
    const onOpenChange = vi.fn<(open: boolean) => void>();
    renderWithQueryClient(
      <ClubReportDialog
        targetType="thread"
        targetId={CLUB_IDS.thread}
        open
        onOpenChange={onOpenChange}
      />,
    );
    fireEvent.change(detailsField(), { target: { value: "spam w wątku" } });
    fireEvent.click(submitButton());

    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith("club.report.sent"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(detailsField()).toHaveValue("");
  });

  it("odmowa bazy pokazuje KLUCZ błędu, zostawia okno otwarte i wpisany opis", async () => {
    clubRpc.setError(REPORT_RPC, "report_denied");
    const onOpenChange = vi.fn<(open: boolean) => void>();
    renderWithQueryClient(
      <ClubReportDialog
        targetType="thread"
        targetId={CLUB_IDS.thread}
        open
        onOpenChange={onOpenChange}
      />,
    );
    fireEvent.change(detailsField(), { target: { value: "spam w wątku" } });
    fireEvent.click(submitButton());

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("club.report.failed"));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(detailsField()).toHaveValue("spam w wątku");
    expect(h.toast.success).not.toHaveBeenCalled();
  });

  it("wysyłka w locie blokuje przyciski i opis, a drugi klik nie wysyła drugi raz", async () => {
    let open = (): void => undefined;
    h.gate = new Promise<void>((resolve) => {
      open = () => resolve();
    });
    renderWithQueryClient(
      <ClubReportDialog
        targetType="thread"
        targetId={CLUB_IDS.thread}
        open
        onOpenChange={vi.fn()}
      />,
    );
    fireEvent.click(submitButton());

    await waitFor(() => expect(submitButton()).toBeDisabled());
    expect(cancelButton()).toBeDisabled();
    expect(detailsField()).toBeDisabled();

    fireEvent.click(submitButton());
    expect(clubRpc.callsFor(REPORT_RPC)).toHaveLength(1);

    open();
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith("club.report.sent"));
  });
});
