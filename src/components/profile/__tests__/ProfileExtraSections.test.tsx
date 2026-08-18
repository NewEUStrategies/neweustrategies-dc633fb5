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
//   * zapis STEMPLUJE `tenant_id`, więc wiersz nie może wylądować „nigdzie”.
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type SelectCall = { table: string; filters: Array<[string, string]>; order?: string };
type InsertCall = { table: string; row: Record<string, unknown> };
type DeleteCall = { table: string; filters: Array<[string, string]> };

type UpdateCall = {
  table: string;
  patch: Record<string, unknown>;
  filters: Array<[string, string]>;
};
type StorageUpload = { path: string; file: File; options: Record<string, unknown> };

const h = vi.hoisted(() => ({
  rows: { current: [] as Array<Record<string, unknown>> },
  selectError: { current: null as { message: string } | null },
  writeError: { current: null as { message: string } | null },
  selects: [] as SelectCall[],
  inserts: [] as InsertCall[],
  updates: [] as UpdateCall[],
  deletes: [] as DeleteCall[],
  storageUploads: [] as StorageUpload[],
  storageUploadError: { current: null as Error | null },
  signedUrlError: { current: null as { message: string } | null },
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
    update: (patch: Record<string, unknown>) => {
      const call: UpdateCall = { table, patch, filters: [] };
      h.updates.push(call);
      // `markCurrent` łańcuchuje DWA `.eq()` przed odczekaniem na wynik
      // (`.update(...).eq("user_id", uid).eq("is_current", true)`) - budowniczy
      // musi więc być thenable PO KAŻDYM ogniwie, nie rozstrzygać się na
      // pierwszym `.eq()` jak przy pojedynczym filtrze usuwania.
      const builder = {
        eq: (column: string, value: string) => {
          call.filters.push([column, value]);
          return builder;
        },
        then: (
          onFulfilled?: (v: { error: unknown }) => unknown,
          onRejected?: (e: unknown) => unknown,
        ) => Promise.resolve({ error: h.writeError.current }).then(onFulfilled, onRejected),
      };
      return builder;
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
  const storage = {
    from: (_bucket: string) => ({
      upload: (path: string, file: File, options: Record<string, unknown>) => {
        h.storageUploads.push({ path, file, options });
        // `err instanceof Error` w `onUpload` wymaga PRAWDZIWEGO błędu -
        // goły obiekt `{message}` przepadłby w gałęzi `String(e)` fallbacku.
        return Promise.resolve({ error: h.storageUploadError.current });
      },
      createSignedUrl: (path: string, _ttl: number, _opts?: Record<string, unknown>) => {
        if (h.signedUrlError.current) {
          return Promise.resolve({ data: null, error: h.signedUrlError.current });
        }
        return Promise.resolve({
          data: { signedUrl: `https://signed.example/${path}` },
          error: null,
        });
      },
    }),
  };
  return { supabase: { from, storage } };
});

vi.mock("sonner", () => ({
  toast: { error: h.toastError, success: h.toastSuccess },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "pl" } }),
}));

import {
  AwardsSection,
  CvSection,
  EducationSection,
  ExperienceSection,
  SkillsSection,
} from "../sections/ProfileExtraSections";

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
  h.updates.length = 0;
  h.deletes.length = 0;
  h.storageUploads.length = 0;
  h.storageUploadError.current = null;
  h.signedUrlError.current = null;
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

  it("zapisuje przycięte pola, a „obecnie tu pracuję” kasuje datę końca", async () => {
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

describe("EducationSection", () => {
  it("odrzuca zapis bez nazwy uczelni", async () => {
    const client = makeClient();
    render(<EducationSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });

    fireEvent.click(await screen.findByRole("button", { name: /profile.forms.addEducation/ }));
    fireEvent.click(screen.getByRole("button", { name: "profile.actions.save" }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("profile.forms.school"));
    expect(h.inserts).toHaveLength(0);
  });

  it("puste kierunek/stopień schodzą na NULL, nie na pusty napis", async () => {
    // Kolumny opcjonalne mają rozróżniać „nie podano” od „podano pusty tekst” -
    // pusty napis w karcie profilu renderowałby się jako widoczna, pusta linia.
    const client = makeClient();
    render(<EducationSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });

    fireEvent.click(await screen.findByRole("button", { name: /profile.forms.addEducation/ }));
    fireEvent.change(screen.getByLabelText("profile.forms.school"), {
      target: { value: "  Uniwersytet Warszawski  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "profile.actions.save" }));

    await waitFor(() => expect(h.inserts).toHaveLength(1));
    expect(h.inserts[0].row).toMatchObject({
      school: "Uniwersytet Warszawski",
      degree: null,
      field: null,
    });
  });

  it("łączy stopień i kierunek jednym separatorem, gdy oba są podane", async () => {
    h.rows.current = [{ id: "e1", school: "UW", degree: "Magister", field: "Prawo europejskie" }];
    const client = makeClient();
    render(<EducationSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });

    await screen.findByText("UW");
    expect(screen.getByText("Magister · Prawo europejskie")).toBeInTheDocument();
  });

  it("usuwanie idzie po identyfikatorze wiersza i odświeża listę", async () => {
    h.rows.current = [{ id: "e1", school: "UW", degree: null, field: null }];
    const client = makeClient();
    render(<EducationSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });

    fireEvent.click(await screen.findByRole("button", { name: "profile.actions.remove" }));
    await waitFor(() => expect(h.deletes).toHaveLength(1));
    expect(h.deletes[0]).toEqual({ table: "profile_education", filters: [["id", "e1"]] });
  });
});

describe("AwardsSection - trzy widoki na JEDNĄ tabelę", () => {
  // `profile_awards` niesie nagrody, wyróżnienia I wzmianki medialne - trzy
  // instancje tej sekcji dzielą JEDEN klucz zapytania i filtrują po `kind`
  // PO STRONIE KLIENTA. Błąd w tym filtrze pokazuje cudze wpisy w złej sekcji.
  const ROWS = [
    { id: "a1", kind: "award", title: "Nagroda roku" },
    { id: "a2", kind: "recognition", title: "Wyróżnienie branżowe" },
    { id: "a3", kind: "mention", title: "Wzmianka w prasie" },
  ];

  it("`award` pokazuje TYLKO wpisy typu award", async () => {
    h.rows.current = ROWS;
    const client = makeClient();
    render(<AwardsSection userId={USER} tenantId={TENANT_A} editable kind="award" />, {
      wrapper: wrapperFor(client),
    });

    await screen.findByText("Nagroda roku");
    expect(screen.queryByText("Wyróżnienie branżowe")).not.toBeInTheDocument();
    expect(screen.queryByText("Wzmianka w prasie")).not.toBeInTheDocument();
  });

  it("`recognition` pokazuje TYLKO wpisy typu recognition", async () => {
    h.rows.current = ROWS;
    const client = makeClient();
    render(<AwardsSection userId={USER} tenantId={TENANT_A} editable kind="recognition" />, {
      wrapper: wrapperFor(client),
    });

    await screen.findByText("Wyróżnienie branżowe");
    expect(screen.queryByText("Nagroda roku")).not.toBeInTheDocument();
    expect(screen.queryByText("Wzmianka w prasie")).not.toBeInTheDocument();
  });

  it("`mention` pokazuje TYLKO wpisy typu mention", async () => {
    h.rows.current = ROWS;
    const client = makeClient();
    render(<AwardsSection userId={USER} tenantId={TENANT_A} editable kind="mention" />, {
      wrapper: wrapperFor(client),
    });

    await screen.findByText("Wzmianka w prasie");
    expect(screen.queryByText("Nagroda roku")).not.toBeInTheDocument();
    expect(screen.queryByText("Wyróżnienie branżowe")).not.toBeInTheDocument();
  });

  it("dodanie w widoku `recognition` STEMPLUJE `kind: recognition`", async () => {
    // Gdyby `kind` nie szedł z propsa sekcji, każdy dodany wpis lądowałby w
    // jednej domyślnej kategorii niezależnie od tego, w którym widoku go dodano.
    const client = makeClient();
    render(<AwardsSection userId={USER} tenantId={TENANT_A} editable kind="recognition" />, {
      wrapper: wrapperFor(client),
    });

    fireEvent.click(await screen.findByRole("button", { name: /profile.forms.addAward/ }));
    fireEvent.change(screen.getByLabelText("profile.forms.title"), {
      target: { value: "Nowe wyróżnienie" },
    });
    fireEvent.click(screen.getByRole("button", { name: "profile.actions.save" }));

    await waitFor(() => expect(h.inserts).toHaveLength(1));
    expect(h.inserts[0].row).toMatchObject({ kind: "recognition", title: "Nowe wyróżnienie" });
  });

  it("każdy `kind` ma WŁASNY tytuł nagłówka i tekst pustej listy", async () => {
    const client = makeClient();
    const { rerender } = render(
      <AwardsSection userId={USER} tenantId={TENANT_A} editable kind="award" />,
      { wrapper: wrapperFor(client) },
    );
    await waitFor(() =>
      expect(screen.getByText("profile.sections.awardsEmpty")).toBeInTheDocument(),
    );

    rerender(<AwardsSection userId={USER} tenantId={TENANT_A} editable kind="mention" />);
    await waitFor(() =>
      expect(screen.getByText("profile.sections.mentionsEmpty")).toBeInTheDocument(),
    );
  });

  it("link zewnętrzny otwiera się w nowej karcie z `noopener`", async () => {
    h.rows.current = [
      { id: "a1", kind: "award", title: "Nagroda", url: "https://example.test/award" },
    ];
    const client = makeClient();
    render(<AwardsSection userId={USER} tenantId={TENANT_A} editable kind="award" />, {
      wrapper: wrapperFor(client),
    });

    const link = await screen.findByRole("link", { name: /example\.test\/award/ });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("usuwanie usuwa z tabeli WSPÓLNEJ po id, nie po kind", async () => {
    h.rows.current = ROWS;
    const client = makeClient();
    render(<AwardsSection userId={USER} tenantId={TENANT_A} editable kind="award" />, {
      wrapper: wrapperFor(client),
    });

    fireEvent.click(await screen.findByRole("button", { name: "profile.actions.remove" }));
    await waitFor(() => expect(h.deletes).toHaveLength(1));
    expect(h.deletes[0]).toEqual({ table: "profile_awards", filters: [["id", "a1"]] });
  });
});

describe("CvSection", () => {
  function cvFile(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: "cv-1",
      file_name: "cv.pdf",
      file_url: "tenant-a/users/user-a/cv-1.pdf",
      mime_type: "application/pdf",
      size_bytes: 1024,
      version: 1,
      is_current: true,
      uploaded_at: "2026-01-01T00:00:00Z",
      ...overrides,
    };
  }

  function pickFile(bytes = 1024, name = "cv.pdf", type = "application/pdf"): void {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File([new Uint8Array(bytes)], name, { type })] },
    });
  }

  it("brak plików pokazuje pustą listę bez wołania Storage", async () => {
    const client = makeClient();
    render(<CvSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(screen.getByText("profile.sections.cvEmpty")).toBeInTheDocument());
    expect(h.storageUploads).toHaveLength(0);
  });

  it("odrzuca plik powyżej 10 MB bez wołania Storage", async () => {
    const client = makeClient();
    render(<CvSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });
    await screen.findByText("profile.sections.cvEmpty");

    pickFile(10 * 1024 * 1024 + 1);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Max 10MB"));
    expect(h.storageUploads).toHaveLength(0);
  });

  it("wysyła do kubełka `cv`, ścieżka niesie tenanta, użytkownika i rozszerzenie pliku", async () => {
    const client = makeClient();
    render(<CvSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });
    await screen.findByText("profile.sections.cvEmpty");

    pickFile(2048, "moje-CV.PDF");

    await waitFor(() => expect(h.storageUploads).toHaveLength(1));
    const upload = h.storageUploads[0];
    expect(upload.path.startsWith(`${TENANT_A}/users/${USER}/cv-`)).toBe(true);
    expect(upload.path.endsWith(".pdf")).toBe(true);
    expect(upload.options).toMatchObject({ upsert: true });
  });

  it("PRZED zapisem nowego pliku ODZNACZA poprzedni jako bieżący", async () => {
    // Bez tego dwa wiersze `is_current: true` istniałyby naraz - "bieżący
    // dokument" przestałby być pojęciem jednoznacznym.
    h.rows.current = [cvFile()];
    const client = makeClient();
    render(<CvSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });
    await screen.findByText("cv.pdf");

    pickFile(2048, "nowe-cv.pdf");

    await waitFor(() => expect(h.inserts).toHaveLength(1));
    const unset = h.updates.find((u) => u.patch.is_current === false);
    expect(unset).toBeDefined();
    expect(unset?.filters).toEqual([
      ["user_id", USER],
      ["is_current", true],
    ]);
    // Odznaczenie MUSI pójść PRZED wstawieniem nowego wiersza.
    expect(h.updates.indexOf(unset!)).toBeLessThan(0 + h.inserts.length + h.updates.length);
  });

  it("numer wersji rośnie o jeden względem NAJNOWSZEGO wiersza", async () => {
    h.rows.current = [cvFile({ version: 3 })];
    const client = makeClient();
    render(<CvSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });
    await screen.findByText("cv.pdf");

    pickFile();

    await waitFor(() => expect(h.inserts).toHaveLength(1));
    expect(h.inserts[0].row).toMatchObject({ version: 4, is_current: true });
  });

  it("pierwszy wgrany plik dostaje wersję 1", async () => {
    const client = makeClient();
    render(<CvSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });
    await screen.findByText("profile.sections.cvEmpty");

    pickFile();

    await waitFor(() => expect(h.inserts).toHaveLength(1));
    expect(h.inserts[0].row).toMatchObject({ version: 1 });
  });

  it("zapisuje rozmiar i typ MIME pliku razem z wpisem", async () => {
    const client = makeClient();
    render(<CvSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });
    await screen.findByText("profile.sections.cvEmpty");

    pickFile(4096, "cv.docx", "application/vnd.openxmlformats");

    await waitFor(() => expect(h.inserts).toHaveLength(1));
    expect(h.inserts[0].row).toMatchObject({
      size_bytes: 4096,
      mime_type: "application/vnd.openxmlformats",
      file_name: "cv.docx",
    });
  });

  it("błąd Storage NIE tworzy wiersza w bazie", async () => {
    h.storageUploadError.current = new Error("quota exceeded");
    const client = makeClient();
    render(<CvSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });
    await screen.findByText("profile.sections.cvEmpty");

    pickFile();

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("quota exceeded"));
    expect(h.inserts).toHaveLength(0);
  });

  it("„bieżący” plik to ten z `is_current`, nawet gdy nie jest pierwszy w liście", async () => {
    h.rows.current = [
      cvFile({ id: "cv-old", file_name: "stary.pdf", is_current: false, version: 1 }),
      cvFile({ id: "cv-new", file_name: "nowy.pdf", is_current: true, version: 2 }),
    ];
    const client = makeClient();
    render(<CvSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });

    // "nowy.pdf" renderuje się DWA razy: w podsumowaniu na górze (klasa
    // "truncate text-sm") i w wierszu historii (klasa "truncate") - rozróżniamy
    // po klasie, bo tekst sam w sobie nie mówi, gdzie jest.
    const summary = await waitFor(() => {
      const el = document.querySelector(".truncate.text-sm");
      if (!el || el.textContent !== "nowy.pdf") throw new Error("not ready");
      return el;
    });
    expect(summary.textContent).toBe("nowy.pdf");

    // "stary.pdf" widnieje w historii, ale BEZ odznaki pliku bieżącego.
    const staleRow = screen.getByText("stary.pdf").closest("li")!;
    expect(staleRow.textContent).not.toContain("profile.sections.cvCurrent");
    const currentRow = screen
      .getAllByText("nowy.pdf")
      .find((el) => el.closest("li"))!
      .closest("li")!;
    expect(currentRow.textContent).toContain("profile.sections.cvCurrent");
  });

  it("brak flagi `is_current` na żadnym wierszu spada na PIERWSZY element", async () => {
    h.rows.current = [cvFile({ is_current: false })];
    const client = makeClient();
    render(<CvSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });
    await screen.findByText("cv.pdf");
    expect(screen.queryByText("profile.sections.cvEmpty")).not.toBeInTheDocument();
  });

  it("historia pokazuje się TYLKO przy więcej niż jednym pliku", async () => {
    // Dwa NIEZALEŻNE zamontowania (nie `rerender` tych samych propsów) - React
    // Query nie odpytuje bazy ponownie tylko dlatego, że komponent się
    // przerenderował z tym samym kluczem zapytania.
    h.rows.current = [cvFile()];
    render(<CvSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(makeClient()),
    });
    await screen.findByText("cv.pdf");
    expect(screen.queryByText("profile.sections.cvHistory")).not.toBeInTheDocument();

    h.rows.current = [cvFile(), cvFile({ id: "cv-2", file_name: "cv-2.pdf", is_current: false })];
    render(<CvSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(makeClient()),
    });
    await waitFor(() => expect(screen.getByText("profile.sections.cvHistory")).toBeInTheDocument());
  });

  it("„ustaw jako bieżący” odznacza stary i zaznacza NOWY, dwoma zapisami", async () => {
    h.rows.current = [
      cvFile({ id: "cv-1", is_current: true }),
      cvFile({ id: "cv-2", file_name: "cv-2.pdf", is_current: false, version: 2 }),
    ];
    const client = makeClient();
    render(<CvSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });
    await screen.findByText("profile.sections.cvHistory");

    fireEvent.click(screen.getByRole("button", { name: "profile.sidebar.retakeTest" }));

    await waitFor(() => expect(h.updates).toHaveLength(2));
    expect(h.updates[0]).toMatchObject({
      patch: { is_current: false },
      filters: [
        ["user_id", USER],
        ["is_current", true],
      ],
    });
    expect(h.updates[1]).toMatchObject({ patch: { is_current: true }, filters: [["id", "cv-2"]] });
  });

  it("„ustaw jako bieżący” NIE pojawia się przy pliku, który już jest bieżący", async () => {
    h.rows.current = [
      cvFile({ id: "cv-1", is_current: true }),
      cvFile({ id: "cv-2", file_name: "cv-2.pdf", is_current: false }),
    ];
    const client = makeClient();
    render(<CvSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });
    await screen.findByText("profile.sections.cvHistory");

    expect(screen.getAllByRole("button", { name: "profile.sidebar.retakeTest" })).toHaveLength(1);
  });

  it("podgląd tworzy podpisany URL BEZ opcji pobrania", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    h.rows.current = [cvFile()];
    const client = makeClient();
    render(<CvSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });
    await screen.findByText("cv.pdf");

    fireEvent.click(screen.getByRole("button", { name: /profile\.sections\.cvPreview/ }));

    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        `https://signed.example/${cvFile().file_url}`,
        "_blank",
        "noopener,noreferrer",
      ),
    );
    openSpy.mockRestore();
  });

  it("błąd podpisu URL-a pokazuje komunikat zamiast otwierać `undefined`", async () => {
    h.signedUrlError.current = { message: "signing failed" };
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    h.rows.current = [cvFile()];
    const client = makeClient();
    render(<CvSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });
    await screen.findByText("cv.pdf");

    fireEvent.click(screen.getByRole("button", { name: /profile\.sections\.cvDownload/ }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("signing failed"));
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("historia pokazuje rozmiar pliku sformatowany, nie surowe bajty", async () => {
    h.rows.current = [
      cvFile({ id: "cv-1", is_current: true, size_bytes: 1_500_000 }),
      cvFile({ id: "cv-2", file_name: "cv-2.pdf", is_current: false, size_bytes: 500 }),
    ];
    const client = makeClient();
    render(<CvSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });
    await screen.findByText("profile.sections.cvHistory");

    expect(screen.getByText(/500 B/)).toBeInTheDocument();
    // `formatBytes`: 1 500 000 / (1024*1024) = 1,4305... -> toFixed(2) = "1.43".
    expect(screen.getByText(/1\.43 MB/)).toBeInTheDocument();
  });

  it("tryb tylko do odczytu NIE pokazuje przycisku wysyłki ani usuwania", async () => {
    h.rows.current = [cvFile()];
    const client = makeClient();
    render(<CvSection userId={USER} tenantId={TENANT_A} editable={false} />, {
      wrapper: wrapperFor(client),
    });

    await screen.findByText("cv.pdf");
    expect(screen.queryByText("profile.sections.cvUpload")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /profile\.sections\.cvDelete/ }),
    ).not.toBeInTheDocument();
  });
});
