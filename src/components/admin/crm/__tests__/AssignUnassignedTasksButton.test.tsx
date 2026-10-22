// „Przypisz zadania bez osoby" na liście CRM (I9, Z-S7-02 / P24).
//
// CO TEN PLIK DOWODZI:
//   1. JEDEN PISARZ: akcja woła server fn modułu `assignUnassignedCrmTasks`
//      (ten sam co szybka naprawa huba) - BEZ osoby zastępczej, więc z listy
//      CRM zadania trafiają wyłącznie do właścicieli leadów.
//   2. Potwierdzenie przed zapisem; „Anuluj" nic nie wysyła.
//   3. Wynik mówi, ile przypisano i ile zostało (PL i EN, liczebniki); po
//      zapisie odświeżają się zadania i leady (prefiksy fabryki `crmKeys`).
//   4. Odmowa serwera to zdanie, nie surowy komunikat; axe bez naruszeń.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  assign: vi.fn(),
  confirm: vi.fn(),
  toast: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/crm-tasks.functions", () => ({
  assignUnassignedCrmTasks: (input: unknown) => h.assign(input),
}));
vi.mock("@/lib/appDialogs", () => ({ confirmDialog: (opts: unknown) => h.confirm(opts) }));
vi.mock("sonner", () => ({ toast: h.toast }));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { AssignUnassignedTasksButton } from "@/components/admin/crm/AssignUnassignedTasksButton";
import { crmKeys } from "@/lib/crm/keys";

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const view = render(
    <QueryClientProvider client={client}>
      <AssignUnassignedTasksButton />
    </QueryClientProvider>,
  );
  return { ...view, invalidate };
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.assign.mockReset().mockResolvedValue({
    assigned_to_owner: 3,
    assigned_to_fallback: 0,
    remaining: 0,
  });
  h.confirm.mockReset().mockResolvedValue(true);
  for (const fn of Object.values(h.toast)) fn.mockReset();
});

afterEach(() => cleanup());

describe("AssignUnassignedTasksButton", () => {
  it("po potwierdzeniu woła server fn modułu bez osoby zastępczej i odświeża zadania oraz leady", async () => {
    const { invalidate } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Przypisz zadania bez osoby" }));

    await waitFor(() => expect(h.assign).toHaveBeenCalledTimes(1));
    expect(h.assign).toHaveBeenCalledWith({ data: { fallback_assignee_id: null } });
    expect(h.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Przypisać otwarte zadania bez osoby?",
        confirmLabel: "Przypisz",
      }),
    );
    await waitFor(() =>
      expect(h.toast.success).toHaveBeenCalledWith("Przypisano 3 zadania właścicielom leadów."),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: crmKeys.tasksAll() });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: crmKeys.leadsAll() });
  });

  it('„Anuluj" nic nie wysyła', async () => {
    h.confirm.mockResolvedValue(false);
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Przypisz zadania bez osoby" }));

    await waitFor(() => expect(h.confirm).toHaveBeenCalled());
    expect(h.assign).not.toHaveBeenCalled();
  });

  it("zadania leadów bez właściciela zostają - wynik to mówi (EN, liczebnik)", async () => {
    await i18n.changeLanguage("en");
    h.assign.mockResolvedValue({ assigned_to_owner: 1, assigned_to_fallback: 0, remaining: 2 });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Assign tasks without a person" }));

    await waitFor(() =>
      expect(h.toast.success).toHaveBeenCalledWith("Assigned 1 task to its lead owner."),
    );
    expect(h.toast.warning).toHaveBeenCalledWith(
      "2 tasks still have no person (leads without an owner) - pick one in the hub diagnostics.",
    );
  });

  it("nic do przypisania - jedno zdanie, bez fałszywego sukcesu", async () => {
    h.assign.mockResolvedValue({ assigned_to_owner: 0, assigned_to_fallback: 0, remaining: 0 });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Przypisz zadania bez osoby" }));

    await waitFor(() =>
      expect(h.toast.info).toHaveBeenCalledWith(
        "Nie ma otwartych zadań bez osoby, które można przypisać właścicielowi leada.",
      ),
    );
    expect(h.toast.success).not.toHaveBeenCalled();
  });

  it("odmowa serwera (np. brak MFA) - zdanie ze słownika, nie surowy komunikat", async () => {
    h.assign.mockRejectedValue(new Error("mfa_required"));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Przypisz zadania bez osoby" }));

    await waitFor(() =>
      expect(h.toast.error).toHaveBeenCalledWith(
        "Nie udało się przypisać zadań. Spróbuj ponownie.",
      ),
    );
  });

  it("axe bez naruszeń", async () => {
    const { container } = mount();
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
