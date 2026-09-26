// Wydane linki raportu dla sponsorów (`SponsorReportLinksPanel`).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. TOKEN W PANELU - lista pokazuje wyłącznie prefiks (8 znaków); pełnego
//      poświadczenia nikt z panelu nie odtworzy.
//   2. ZŁY STAN LINKU - aktywny / odwołany / wygasły to trzy różne odpowiedzi,
//      a odwołać można tylko aktywny.
//   3. ODWOŁANIE BEZ PYTANIA albo odwołanie ZŁEGO linku.
//   4. STAN ZAPYTANIA: wczytywanie, odmowa bazy zdaniem, pusta lista.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConfirmDialogRequest } from "@/lib/appDialogs";
import type { SponsorReportLinkRow } from "@/lib/events/sponsorReportApi";

type Result = { onSuccess?: () => void; onError?: (error: unknown) => void };

const h = vi.hoisted(() => ({
  rows: undefined as unknown[] | undefined,
  pending: false,
  error: null as Error | null,
  revoked: [] as string[],
  revokeError: null as Error | null,
  revokePending: false,
  hookIds: [] as string[],
  confirms: [] as unknown[],
  answer: true,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/appDialogs", () => ({
  confirmDialog: async (request: Omit<ConfirmDialogRequest, "kind">) => {
    h.confirms.push(request);
    return h.answer;
  },
}));
vi.mock("@/lib/events/useSponsorReport", () => ({
  useSponsorReportLinks: (eventId: string) => {
    h.hookIds.push(eventId);
    return {
      data: h.rows,
      isPending: h.pending,
      isError: h.error !== null,
      error: h.error,
    };
  },
  useRevokeSponsorReportLink: (eventId: string) => {
    h.hookIds.push(eventId);
    return {
      isPending: h.revokePending,
      mutate: (id: string, result: Result) => {
        h.revoked.push(id);
        if (h.revokeError === null) result.onSuccess?.();
        else result.onError?.(h.revokeError);
      },
    };
  },
}));

const { SponsorReportLinksPanel } =
  await import("@/components/admin/events/organisms/SponsorReportLinksPanel");

const L = "adminEventSponsorReport.links";

function link(patch: Partial<SponsorReportLinkRow>): SponsorReportLinkRow {
  return {
    created_at: "2099-06-01T10:00:00Z",
    expires_at: "2099-08-19T23:59:59Z",
    id: "l1",
    include_leads: false,
    is_active: true,
    label: "Dla działu marketingu",
    last_seen_at: null as unknown as string,
    revoked_at: null as unknown as string,
    sponsor_id: "s1",
    sponsor_name: "Acme",
    token_prefix: "Ab3_-Ab3",
    view_count: 0,
    ...patch,
  };
}

function panel() {
  return render(<SponsorReportLinksPanel eventId="ev1" timezone="Europe/Warsaw" />);
}

const rows = () => screen.getAllByRole("row").slice(1);

beforeEach(() => {
  h.rows = [
    link({ id: "l1" }),
    link({
      id: "l2",
      token_prefix: "Zz9-Zz9-",
      is_active: false,
      revoked_at: "2099-06-10T08:00:00Z",
      include_leads: true,
      last_seen_at: "2099-06-09T14:30:00Z",
      view_count: 12,
    }),
    link({ id: "l3", token_prefix: "Qq1_Qq1_", is_active: false }),
  ];
  h.pending = false;
  h.error = null;
  h.revoked = [];
  h.revokeError = null;
  h.revokePending = false;
  h.hookIds = [];
  h.confirms = [];
  h.answer = true;
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

describe("SponsorReportLinksPanel - lista", () => {
  it("wiersz: sponsor, etykieta, SAM prefiks, zakres, daty, licznik i stan", () => {
    panel();
    const [active, revoked, expired] = rows();
    const a = within(active);
    expect(a.getByText("Acme")).toBeTruthy();
    expect(a.getByText("Dla działu marketingu")).toBeTruthy();
    expect(a.getByText("Ab3_-Ab3…")).toBeTruthy();
    expect(a.getByText(`${L}.withoutLeads`)).toBeTruthy();
    expect(a.getByText(`${L}.never`)).toBeTruthy();
    expect(a.getByText(`${L}.active`)).toBeTruthy();
    expect(a.getByText(/2099/)).toBeTruthy();

    const r = within(revoked);
    expect(r.getByText(`${L}.withLeads`)).toBeTruthy();
    expect(r.getByText(`${L}.revoked`)).toBeTruthy();
    expect(r.getByText("12")).toBeTruthy();
    expect(r.queryByText(`${L}.never`)).toBeNull();
    expect(within(expired).getByText(`${L}.expired`)).toBeTruthy();
    expect(new Set(h.hookIds)).toEqual(new Set(["ev1"]));
  });

  it("odwołać można TYLKO aktywny link", () => {
    panel();
    const buttons = screen.getAllByRole("button", { name: /revokeFor/ });
    expect(buttons).toHaveLength(1);
    expect(buttons[0].getAttribute("aria-label")).toBe(`${L}.revokeFor(prefix=Ab3_-Ab3)`);
  });

  it("wczytywanie, odmowa bazy i pusta lista mówią zdaniem", () => {
    h.pending = true;
    const first = panel();
    expect(screen.getByText("adminEventSponsorReport.loading")).toBeTruthy();
    first.unmount();

    h.pending = false;
    h.error = new Error("forbidden: event admin required");
    h.rows = undefined;
    const second = panel();
    expect(screen.queryByText(/forbidden:/)).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    second.unmount();

    h.error = null;
    h.rows = [];
    panel();
    expect(screen.getByText(`${L}.empty`)).toBeTruthy();
  });
});

describe("SponsorReportLinksPanel - odwołanie", () => {
  async function revokeFirst() {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /revokeFor/ }));
    });
  }

  it("pyta destrukcyjnie i po zgodzie odwołuje WŁAŚCIWY link", async () => {
    panel();
    await revokeFirst();
    expect(h.confirms).toEqual([
      {
        title: `${L}.revokeFor(prefix=Ab3_-Ab3)`,
        description: `${L}.revokeConfirm`,
        confirmLabel: `${L}.revoke`,
        destructive: true,
      },
    ]);
    expect(h.revoked).toEqual(["l1"]);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${L}.revokedToast`);
  });

  it("odmowa w oknie potwierdzenia niczego nie odwołuje", async () => {
    h.answer = false;
    panel();
    await revokeFirst();
    expect(h.revoked).toEqual([]);
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("odmowa bazy kończy się komunikatem, a w trakcie odwołania przycisk jest zgaszony", async () => {
    h.revokeError = new Error("not_found: link");
    panel();
    await revokeFirst();
    expect(h.toastError).toHaveBeenCalledTimes(1);
    expect(String(h.toastError.mock.calls[0]?.[0])).not.toContain("not_found:");
    h.revokePending = true;
    panel();
    expect(
      screen
        .getAllByRole("button", { name: /revokeFor/ })
        .some((b) => (b as HTMLButtonElement).disabled),
    ).toBe(true);
  });
});
