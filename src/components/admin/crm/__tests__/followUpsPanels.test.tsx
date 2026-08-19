// Panele follow-upów: pasek nad skrzynką leadów i zakładka „Zadania" na karcie
// kontaktu. Testujemy ZACHOWANIE panelu (co widzi i co klika sprzedaż), nie
// sam render: reguły liczenia terminów mają własny test (lib/crm/tasksView).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const h = vi.hoisted(() => ({
  dueTasks: [] as unknown[],
  leadTasks: [] as unknown[],
  updated: [] as unknown[],
  created: [] as unknown[],
  deleted: [] as unknown[],
  createThrows: false,
  updateThrows: false,
  deleteThrows: false,
  toastError: [] as string[],
  toastSuccess: [] as string[],
}));

vi.mock("@/lib/crm-tasks.functions", () => ({
  CRM_IMPORT_CHUNK_SIZE: 500,
  listCrmDueTasks: async () => ({ json: JSON.stringify(h.dueTasks) }),
  listCrmLeadTasks: async () => ({ json: JSON.stringify(h.leadTasks) }),
  updateCrmTask: async (input: unknown) => {
    h.updated.push(input);
    if (h.updateThrows) throw new Error("zmiana odrzucona");
    return { ok: true };
  },
  createCrmTask: async (input: unknown) => {
    if (h.createThrows) throw new Error("insert failed");
    h.created.push(input);
    return { ok: true };
  },
  deleteCrmTask: async (input: unknown) => {
    h.deleted.push(input);
    if (h.deleteThrows) throw new Error("kasowanie odrzucone");
    return { ok: true };
  },
}));
vi.mock("sonner", () => ({
  toast: {
    error: (m: string) => h.toastError.push(m),
    success: (m: string) => h.toastSuccess.push(m),
    warning: (m: string) => h.toastError.push(m),
  },
}));

import { FollowUpsPanel } from "../FollowUpsPanel";
import { LeadTasksPanel } from "../LeadTasksPanel";

const LEAD_ID = "11111111-1111-4111-8111-111111111111";
const PAST = new Date(Date.now() - 3 * 3_600_000).toISOString();
const FUTURE = new Date(Date.now() + 24 * 3_600_000).toISOString();

beforeEach(() => {
  h.dueTasks = [];
  h.leadTasks = [];
  h.updated = [];
  h.created = [];
  h.deleted = [];
  h.createThrows = false;
  h.updateThrows = false;
  h.deleteThrows = false;
  h.toastError = [];
  h.toastSuccess = [];
});

describe("FollowUpsPanel", () => {
  it("nie renderuje się wcale, gdy nie ma nic do zrobienia", async () => {
    const { container } = renderWithQueryClient(<FollowUpsPanel lang="pl" onOpenLead={() => {}} />);
    await waitFor(() => expect(container.querySelector("section")).toBeNull());
  });

  it("pokazuje liczbę zaległych i nadchodzących oraz etykietę kontaktu", async () => {
    h.dueTasks = [
      {
        id: "t1",
        lead_id: LEAD_ID,
        title: "Oddzwonić po webinarze",
        due_at: PAST,
        status: "open",
        lead: {
          id: LEAD_ID,
          email: "anna@example.test",
          first_name: "Anna",
          last_name: "Kowalska",
        },
      },
      {
        id: "t2",
        lead_id: LEAD_ID,
        title: "Wysłać ofertę",
        due_at: FUTURE,
        status: "open",
        lead: { id: LEAD_ID, email: "bartek@example.test", first_name: null, last_name: null },
      },
    ];
    renderWithQueryClient(<FollowUpsPanel lang="pl" onOpenLead={() => {}} />);

    expect(await screen.findByText("1 po terminie")).toBeInTheDocument();
    expect(screen.getByText("1 nadchodzące")).toBeInTheDocument();
    expect(screen.getByText(/Anna Kowalska/)).toBeInTheDocument();
    // Kontakt bez nazwiska pokazuje e-mail, nie pusty nawias.
    expect(screen.getByText(/bartek@example.test/)).toBeInTheDocument();
  });

  it("oznaczenie wykonania wysyła status done dla właściwego zadania", async () => {
    h.dueTasks = [
      { id: "t1", lead_id: LEAD_ID, title: "Zadanie", due_at: FUTURE, status: "open", lead: null },
    ];
    renderWithQueryClient(<FollowUpsPanel lang="en" onOpenLead={() => {}} />);
    fireEvent.click(await screen.findByTitle("Done"));
    await waitFor(() => expect(h.updated).toEqual([{ data: { id: "t1", status: "done" } }]));
  });

  it("strzałka otwiera kontakt razem z identyfikatorem zadania", async () => {
    h.dueTasks = [
      { id: "t1", lead_id: LEAD_ID, title: "Zadanie", due_at: FUTURE, status: "open", lead: null },
    ];
    const onOpenLead = vi.fn();
    renderWithQueryClient(<FollowUpsPanel lang="pl" onOpenLead={onOpenLead} />);
    fireEvent.click(await screen.findByLabelText("Otwórz leada"));
    expect(onOpenLead).toHaveBeenCalledWith(LEAD_ID, "t1");
  });
});

describe("LeadTasksPanel", () => {
  const task = (over: Record<string, unknown> = {}) => ({
    id: "t1",
    tenant_id: "t",
    lead_id: LEAD_ID,
    title: "Oddzwonić",
    note: null,
    due_at: FUTURE,
    status: "open",
    assignee_id: null,
    created_by: null,
    reminded_at: null,
    completed_at: null,
    created_at: PAST,
    updated_at: PAST,
    ...over,
  });

  it("pusta lista pokazuje zachętę do dodania pierwszego follow-upu", async () => {
    renderWithQueryClient(<LeadTasksPanel leadId={LEAD_ID} lang="pl" />);
    expect(await screen.findByText(/Brak zadań dla tego leada/)).toBeInTheDocument();
  });

  it("dzieli zadania na otwarte i zakończone", async () => {
    h.leadTasks = [task(), task({ id: "t2", title: "Zamknięte", status: "done" })];
    renderWithQueryClient(<LeadTasksPanel leadId={LEAD_ID} lang="pl" />);
    expect(await screen.findByText(/Otwarte/)).toBeInTheDocument();
    expect(screen.getByText(/Zakończone/)).toBeInTheDocument();
    expect(screen.getByText("Oddzwonić")).toBeInTheDocument();
    expect(screen.getByText("Zamknięte")).toBeInTheDocument();
  });

  it("zadanie po terminie jest oznaczone", async () => {
    h.leadTasks = [task({ due_at: PAST })];
    renderWithQueryClient(<LeadTasksPanel leadId={LEAD_ID} lang="pl" />);
    expect(await screen.findByText(/po terminie/)).toBeInTheDocument();
  });

  it("dodanie follow-upu wysyła tytuł, termin i klucz idempotencji", async () => {
    renderWithQueryClient(<LeadTasksPanel leadId={LEAD_ID} lang="pl" />);
    const input = await screen.findByPlaceholderText(/Co jest do zrobienia/);
    fireEvent.change(input, { target: { value: "Umówić spotkanie" } });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj" }));

    await waitFor(() => expect(h.created).toHaveLength(1));
    const payload = (h.created[0] as { data: Record<string, unknown> }).data;
    expect(payload).toMatchObject({ lead_id: LEAD_ID, title: "Umówić spotkanie" });
    expect(typeof payload.idempotency_key).toBe("string");
    expect(String(payload.due_at)).not.toBe("");
  });

  it("pusty tytuł nie wysyła niczego", async () => {
    renderWithQueryClient(<LeadTasksPanel leadId={LEAD_ID} lang="pl" />);
    const button = await screen.findByRole("button", { name: "Dodaj" });
    fireEvent.click(button);
    await waitFor(() => expect(h.created).toHaveLength(0));
  });

  it("błąd zapisu pokazuje komunikat zamiast cichej porażki", async () => {
    h.createThrows = true;
    renderWithQueryClient(<LeadTasksPanel leadId={LEAD_ID} lang="pl" />);
    fireEvent.change(await screen.findByPlaceholderText(/Co jest do zrobienia/), {
      target: { value: "Zadanie" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj" }));
    await waitFor(() => expect(h.toastError).toContain("insert failed"));
  });

  it("oznaczenie wykonania i przywrócenie zmieniają status w obie strony", async () => {
    h.leadTasks = [task()];
    renderWithQueryClient(<LeadTasksPanel leadId={LEAD_ID} lang="pl" />);
    fireEvent.click(await screen.findByTitle("Oznacz jako wykonane"));
    await waitFor(() => expect(h.updated).toEqual([{ data: { id: "t1", status: "done" } }]));

    h.leadTasks = [task({ status: "done" })];
    h.updated = [];
    renderWithQueryClient(<LeadTasksPanel leadId={LEAD_ID} lang="pl" />);
    fireEvent.click((await screen.findAllByTitle("Przywróć jako otwarte"))[0]);
    await waitFor(() => expect(h.updated).toEqual([{ data: { id: "t1", status: "open" } }]));
  });

  it("usunięcie zadania woła serwer z jego identyfikatorem", async () => {
    h.leadTasks = [task()];
    renderWithQueryClient(<LeadTasksPanel leadId={LEAD_ID} lang="pl" />);
    fireEvent.click(await screen.findByTitle("Usuń"));
    await waitFor(() => expect(h.deleted).toEqual([{ data: { id: "t1" } }]));
  });
});

describe("panele follow-upów - wersja angielska i odmowy", () => {
  const task = (over: Record<string, unknown> = {}) => ({
    id: "t1",
    tenant_id: "t",
    lead_id: LEAD_ID,
    title: "Oddzwonić",
    note: null,
    due_at: FUTURE,
    status: "open",
    assignee_id: null,
    created_by: null,
    reminded_at: null,
    completed_at: null,
    created_at: PAST,
    updated_at: PAST,
    ...over,
  });

  it("pasek follow-upów po angielsku liczy zaległe i nadchodzące", async () => {
    h.dueTasks = [
      { id: "t1", lead_id: LEAD_ID, title: "Call back", due_at: PAST, status: "open", lead: null },
      {
        id: "t2",
        lead_id: LEAD_ID,
        title: "Send offer",
        due_at: FUTURE,
        status: "open",
        lead: null,
      },
    ];
    renderWithQueryClient(<FollowUpsPanel lang="en" onOpenLead={() => {}} />);
    expect(await screen.findByText("1 overdue")).toBeInTheDocument();
    expect(screen.getByText("1 upcoming")).toBeInTheDocument();
  });

  it("odmowa oznaczenia wykonania na pasku pokazuje komunikat", async () => {
    h.dueTasks = [
      { id: "t1", lead_id: LEAD_ID, title: "Zadanie", due_at: FUTURE, status: "open", lead: null },
    ];
    h.updateThrows = true;
    renderWithQueryClient(<FollowUpsPanel lang="pl" onOpenLead={() => {}} />);
    fireEvent.click(await screen.findByTitle("Wykonane"));
    await waitFor(() => expect(h.toastError).toContain("zmiana odrzucona"));
  });

  it("odmowa zmiany statusu i kasowania zadania w karcie mówi wprost", async () => {
    h.leadTasks = [task()];
    h.updateThrows = true;
    h.deleteThrows = true;
    renderWithQueryClient(<LeadTasksPanel leadId={LEAD_ID} lang="pl" />);
    fireEvent.click(await screen.findByTitle("Oznacz jako wykonane"));
    await waitFor(() => expect(h.toastError).toContain("zmiana odrzucona"));
    fireEvent.click(screen.getByTitle("Usuń"));
    await waitFor(() => expect(h.toastError).toContain("kasowanie odrzucone"));
  });

  it("notatka przy follow-upie idzie na serwer razem z zadaniem", async () => {
    renderWithQueryClient(<LeadTasksPanel leadId={LEAD_ID} lang="pl" />);
    fireEvent.change(await screen.findByPlaceholderText(/Co jest do zrobienia/), {
      target: { value: "Umówić spotkanie" },
    });
    const note = screen.getAllByRole("textbox").at(-1) as HTMLElement;
    fireEvent.change(note, { target: { value: "Po webinarze o CBAM" } });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj" }));
    await waitFor(() => expect(h.created).toHaveLength(1));
    expect((h.created[0] as { data: Record<string, unknown> }).data).toMatchObject({
      title: "Umówić spotkanie",
      note: "Po webinarze o CBAM",
    });
  });

  it("zakończone zadanie da się przywrócić i usunąć", async () => {
    h.leadTasks = [task({ status: "done", completed_at: PAST })];
    renderWithQueryClient(<LeadTasksPanel leadId={LEAD_ID} lang="pl" />);
    fireEvent.click(await screen.findByTitle("Przywróć jako otwarte"));
    await waitFor(() => expect(h.updated).toEqual([{ data: { id: "t1", status: "open" } }]));
    fireEvent.click(screen.getByTitle("Usuń"));
    await waitFor(() => expect(h.deleted).toEqual([{ data: { id: "t1" } }]));
  });
});
