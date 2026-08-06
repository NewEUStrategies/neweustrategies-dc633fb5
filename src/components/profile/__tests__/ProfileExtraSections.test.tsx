// Rozszerzenia profilu (doświadczenie, wykształcenie, umiejętności,
// wyróżnienia) - warstwa, w której użytkownik dopisuje wiersze do WŁASNEGO
// obszaru roboczego.
//
// Najważniejsza asercja tego pliku dotyczy IZOLACJI OBSZARÓW ROBOCZYCH:
//   * odczyt filtruje po `user_id` ORAZ `tenant_id` (RLS to ostatnia linia
//     obrony, nie jedyna - zapytanie bez filtra tenanta pokazałoby wiersze
//     z innego obszaru każdemu, kto ma do nich prawo w swoim),
//   * klucz cache niesie tenanta, więc przełączenie obszaru nie serwuje
//     poprzedniego z pamięci,
//   * zapis STEMPLUJE `tenant_id`, więc wiersz nie może wylądować „nigdzie".
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type SelectCall = { table: string; filters: Array<[string, string]>; order?: string };
type InsertCall = { table: string; row: Record<string, unknown> };
type DeleteCall = { table: string; filters: Array<[string, string]> };

const h = vi.hoisted(() => ({
  rows: { current: [] as Array<Record<string, unknown>> },
  selectError: { current: null as { message: string } | null },
  writeError: { current: null as { message: string } | null },
  selects: [] as SelectCall[],
  inserts: [] as InsertCall[],
  deletes: [] as DeleteCall[],
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => ({
    select: (_columns: string) => {
      const call: SelectCall = { table, filters: [] };
      h.selects.push(call);
      const builder = {
        eq: (column: string, value: string) => {
          call.filters.push([column, value]);
          return builder;
        },
        order: (column: string) => {
          call.order = column;
          return Promise.resolve({ data: h.rows.current, error: h.selectError.current });
        },
      };
      return builder;
    },
    insert: (row: Record<string, unknown>) => {
      h.inserts.push({ table, row });
      return Promise.resolve({ error: h.writeError.current });
    },
    delete: () => {
      const call: DeleteCall = { table, filters: [] };
      h.deletes.push(call);
      return {
        eq: (column: string, value: string) => {
          call.filters.push([column, value]);
          return Promise.resolve({ error: h.writeError.current });
        },
      };
    },
  });
  return { supabase: { from } };
});

vi.mock("sonner", () => ({
  toast: { error: h.toastError, success: h.toastSuccess },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "pl" } }),
}));

import { ExperienceSection, SkillsSection } from "../sections/ProfileExtraSections";

const USER = "user-a";
const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

function makeClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  h.rows.current = [];
  h.selectError.current = null;
  h.writeError.current = null;
  h.selects.length = 0;
  h.inserts.length = 0;
  h.deletes.length = 0;
  h.toastError.mockReset();
  h.toastSuccess.mockReset();
});

describe("izolacja obszaru roboczego", () => {
  it("odczyt filtruje po właścicielu ORAZ po tenancie", async () => {
    const client = makeClient();
    render(<ExperienceSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(h.selects.length).toBeGreaterThan(0));
    const call = h.selects[0];
    expect(call.table).toBe("profile_experiences");
    expect(call.filters).toEqual([
      ["user_id", USER],
      ["tenant_id", TENANT_A],
    ]);
    expect(call.order).toBe("sort_order");
  });

  it("klucz cache niesie tenanta - przełączenie obszaru nie serwuje poprzedniego", async () => {
    const client = makeClient();
    h.rows.current = [{ id: "e1", role_title: "Analityk w A", is_current: false }];
    const view = render(<ExperienceSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });
    await screen.findByText("Analityk w A");

    h.rows.current = [{ id: "e2", role_title: "Analityk w B", is_current: false }];
    view.rerender(<ExperienceSection userId={USER} tenantId={TENANT_B} editable />);

    await screen.findByText("Analityk w B");
    expect(screen.queryByText("Analityk w A")).not.toBeInTheDocument();
    expect(client.getQueryData(["profile_experiences", USER, TENANT_A])).toEqual([
      { id: "e1", role_title: "Analityk w A", is_current: false },
    ]);
  });

  it("nie odpytuje bazy bez kompletu (właściciel + tenant)", async () => {
    const client = makeClient();
    render(<ExperienceSection userId={USER} tenantId="" editable />, {
      wrapper: wrapperFor(client),
    });
    await Promise.resolve();
    expect(h.selects).toHaveLength(0);
  });

  it("zapis STEMPLUJE właściciela i tenanta", async () => {
    const client = makeClient();
    render(<SkillsSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });

    const input = await screen.findByPlaceholderText("profile.forms.addSkill");
    fireEvent.change(input, { target: { value: "  Analiza ryzyka  " } });
    fireEvent.click(screen.getByRole("button", { name: /profile.actions.add/ }));

    await waitFor(() => expect(h.inserts).toHaveLength(1));
    expect(h.inserts[0]).toEqual({
      table: "profile_skills",
      row: { user_id: USER, tenant_id: TENANT_A, label: "Analiza ryzyka", level: 3 },
    });
  });
});

describe("ExperienceSection", () => {
  it("odmawia zapisu bez stanowiska i nie dotyka bazy", async () => {
    const client = makeClient();
    render(<ExperienceSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });

    fireEvent.click(await screen.findByRole("button", { name: /profile.forms.addExperience/ }));
    fireEvent.click(screen.getByRole("button", { name: "profile.actions.save" }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("profile.forms.roleTitle"));
    expect(h.inserts).toHaveLength(0);
  });

  it('zapisuje przycięte pola, a „obecnie tu pracuję" kasuje datę końca', async () => {
    const client = makeClient();
    render(<ExperienceSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });

    fireEvent.click(await screen.findByRole("button", { name: /profile.forms.addExperience/ }));
    fireEvent.change(screen.getByLabelText("profile.forms.roleTitle"), {
      target: { value: "  Analityk  " },
    });
    fireEvent.change(screen.getByLabelText("profile.forms.company"), {
      target: { value: "  NES  " },
    });
    fireEvent.change(screen.getByLabelText("profile.forms.endDate"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "profile.actions.save" }));

    await waitFor(() => expect(h.inserts).toHaveLength(1));
    expect(h.inserts[0].row).toMatchObject({
      role_title: "Analityk",
      company: "NES",
      is_current: true,
      end_date: null,
    });
    expect(h.toastSuccess).toHaveBeenCalledWith("profile.actions.saved");
  });

  it("błąd bazy zgłasza komunikat i nie udaje sukcesu", async () => {
    h.writeError.current = { message: "new row violates row-level security policy" };
    const client = makeClient();
    render(<ExperienceSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });

    fireEvent.click(await screen.findByRole("button", { name: /profile.forms.addExperience/ }));
    fireEvent.change(screen.getByLabelText("profile.forms.roleTitle"), {
      target: { value: "Analityk" },
    });
    fireEvent.click(screen.getByRole("button", { name: "profile.actions.save" }));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("new row violates row-level security policy"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("usuwanie idzie po identyfikatorze wiersza", async () => {
    h.rows.current = [{ id: "e1", role_title: "Analityk", is_current: false }];
    const client = makeClient();
    render(<ExperienceSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });

    fireEvent.click(await screen.findByRole("button", { name: "profile.actions.remove" }));
    await waitFor(() => expect(h.deletes).toHaveLength(1));
    expect(h.deletes[0]).toEqual({
      table: "profile_experiences",
      filters: [["id", "e1"]],
    });
  });

  it("tryb tylko do odczytu nie pokazuje akcji zapisu ani usuwania", async () => {
    h.rows.current = [{ id: "e1", role_title: "Analityk", is_current: false }];
    const client = makeClient();
    render(<ExperienceSection userId={USER} tenantId={TENANT_A} editable={false} />, {
      wrapper: wrapperFor(client),
    });

    await screen.findByText("Analityk");
    expect(
      screen.queryByRole("button", { name: /profile.forms.addExperience/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "profile.actions.remove" }),
    ).not.toBeInTheDocument();
  });
});

describe("SkillsSection", () => {
  it("Enter w polu dodaje umiejętność", async () => {
    const client = makeClient();
    render(<SkillsSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });

    const input = await screen.findByPlaceholderText("profile.forms.addSkill");
    fireEvent.change(input, { target: { value: "OSINT" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(h.inserts).toHaveLength(1));
    expect(h.inserts[0].row).toMatchObject({ label: "OSINT" });
  });

  it("pusta umiejętność nie trafia do bazy", async () => {
    const client = makeClient();
    render(<SkillsSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });

    const input = await screen.findByPlaceholderText("profile.forms.addSkill");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("profile.forms.addSkill"));
    expect(h.inserts).toHaveLength(0);
  });

  it("wyświetla istniejące umiejętności i pozwala je usunąć", async () => {
    h.rows.current = [
      { id: "s1", label: "OSINT" },
      { id: "s2", label: "PESTEL" },
    ];
    const client = makeClient();
    render(<SkillsSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });

    await screen.findByText("OSINT");
    expect(screen.getByText("PESTEL")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "profile.actions.remove" })[1]);
    await waitFor(() => expect(h.deletes).toHaveLength(1));
    expect(h.deletes[0].filters).toEqual([["id", "s2"]]);
  });
});
