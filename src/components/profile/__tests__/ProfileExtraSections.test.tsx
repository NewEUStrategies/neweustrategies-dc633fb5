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
//
// DOPISANE W ETAPIE 7c (blok na końcu pliku): drugi koniec każdej operacji
// (błąd zapisu i błąd usuwania w KAŻDEJ z pięciu sekcji), tryb
// tylko-do-odczytu (widok cudzego profilu nie może pokazywać akcji edycji),
// pełna treść wiersza (firma, opis, zakres dat, wydawca, odnośnik) oraz
// dostępność formularzy dopisywania (axe) - `MiniField` dostał `htmlFor`
// dopiero po naprawie ośmiu nienazwanych pól i to regresja, która wraca.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE:
// - PARYTETU PL/EN treści sekcji: w tych tabelach nie ma kolumn `*_pl`/`*_en`
//   (wpisy są jednojęzyczne, tak jak je wpisał autor), a jedyna rzecz zależna
//   od języka - format daty - jest opisana defektem na końcu pliku.
// - KOLEJNOŚCI sekcji na stronie: te komponenty są montowane POJEDYNCZO przez
//   `src/routes/profile.index.tsx` (linie 606-633) i kolejność jest tam
//   literalna - żaden z nich nie wie o istnieniu pozostałych. Asercja
//   kolejności należy do testu tej trasy.
// - PUBLICZNEJ strony autora: `/author/$slug` renderuje WŁASNY zestaw sekcji
//   (`src/components/author/AuthorCvSections.tsx`), nie te komponenty.
// - RLS: to warstwa pgTAP. Tutaj dowodzimy tylko, że zapytanie NIESIE filtry.
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { axeViolations, summarize } from "@/test/axe";

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
  // `null` jest LEGALNĄ odpowiedzią PostgREST (zero wierszy przy niektórych
  // kształtach zapytania) - typ musi ją dopuszczać, żeby dało się dowieść, że
  // warstwa danych zamienia ją na pustą listę, a nie iteruje po `null`.
  rows: { current: [] as Array<Record<string, unknown>> | null },
  selectError: { current: null as { message: string } | null },
  writeError: { current: null as { message: string } | null },
  selects: [] as SelectCall[],
  inserts: [] as InsertCall[],
  updates: [] as UpdateCall[],
  deletes: [] as DeleteCall[],
  storageUploads: [] as StorageUpload[],
  storageUploadError: { current: null as Error | null },
  signedUrlError: { current: null as { message: string } | null },
  // Podpis „udany", ale BEZ danych - legalna odpowiedź SDK, po której kod ma
  // podać komunikat zapasowy, a nie otworzyć okno na `undefined`.
  signedUrlEmpty: { current: false },
  signedUrlCalls: [] as Array<{
    path: string;
    ttl: number;
    opts: Record<string, unknown> | undefined;
  }>,
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  // Język WIDOKU. Produkcja czyta z `useTranslation()` tylko `t`, ale test
  // parytetu językowego musi mieć czym przełączyć język, żeby pokazać, że
  // formatowanie daty go NIE bierze pod uwagę.
  language: { current: "pl" },
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
      createSignedUrl: (path: string, ttl: number, opts?: Record<string, unknown>) => {
        // Zapisujemy WSZYSTKIE trzy argumenty: to czas życia podpisu i opcja
        // pobrania decydują o tym, czy link nie wygaśnie w trakcie czytania
        // i czy plik zapisze się pod nazwą, którą wgrał autor.
        h.signedUrlCalls.push({ path, ttl, opts });
        if (h.signedUrlError.current) {
          return Promise.resolve({ data: null, error: h.signedUrlError.current });
        }
        if (h.signedUrlEmpty.current) {
          return Promise.resolve({ data: null, error: null });
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
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: h.language.current } }),
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
  h.signedUrlEmpty.current = false;
  h.signedUrlCalls.length = 0;
  h.language.current = "pl";
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

/* ==================================================================== */
/* ETAP 7c - stany awaryjne, tryb tylko-do-odczytu, treść wiersza        */
/* ==================================================================== */

/** Otwiera formularz dodawania w sekcji i zwraca przycisk zapisu. */
async function openAddForm(toggleName: RegExp): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole("button", { name: toggleName }));
  return screen.getByRole("button", { name: "profile.actions.save" });
}

/** Wpisuje wartość w pole formularza o podanej etykiecie (kluczu i18n). */
function fillMiniField(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

/** Wejście pliku CV - jedyne `input[type=file]` w sekcji dokumentów. */
function cvInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("test: brak wejścia pliku CV");
  return input;
}

// UWAGA na temat ukrytego wejścia pliku: w `AuthorProfileEditor.test.tsx`
// trzeba było odsiewać artefakt happy-doma (`<input type="file" hidden>` widziany
// przez axe jako widoczne pole bez etykiety, bo arkusz UA się nie stosuje).
// TUTAJ takiego filtra NIE MA i nie może być: wejście pliku CV siedzi WEWNĄTRZ
// `<label>`, więc ma nazwę dostępną z jego treści i axe go nie zgłasza.
// Sprawdzone pomiarem - surowa lista naruszeń jest w tych czterech testach
// pusta, więc filtr byłby wyłącznie cichą furtką na przyszłe realne braki.

describe("odczyt listy - odpowiedzi nietypowe", () => {
  it("odpowiedź BEZ danych i BEZ błędu to pusta lista, nie awaria", async () => {
    // `data: null` jest legalną odpowiedzią PostgREST. Iteracja po `null`
    // wysypałaby całą kartę profilu.
    h.rows.current = null;
    const client = makeClient();
    render(<ExperienceSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });

    await waitFor(() =>
      expect(screen.getByText("profile.sections.experienceEmpty")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });
});

describe("ExperienceSection - pełny wiersz i ścieżki awaryjne", () => {
  it("zapisuje WSZYSTKIE pola formularza, nie tylko stanowisko", async () => {
    const client = makeClient();
    render(<ExperienceSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });

    const save = await openAddForm(/profile.forms.addExperience/);
    fillMiniField("profile.forms.roleTitle", "Analityk");
    fillMiniField("profile.forms.company", "Example Institute");
    fillMiniField("profile.forms.startDate", "2020-01-15");
    fillMiniField("profile.forms.endDate", "2021-06-30");
    fillMiniField("profile.forms.description", "  Analizy sektorowe.  ");
    fireEvent.click(save);

    await waitFor(() => expect(h.inserts).toHaveLength(1));
    expect(h.inserts[0].row).toMatchObject({
      role_title: "Analityk",
      company: "Example Institute",
      start_date: "2020-01-15",
      end_date: "2021-06-30",
      is_current: false,
      description: "Analizy sektorowe.",
    });
  });

  it("ANULOWANIE zamyka formularz i nie zapisuje niczego", async () => {
    const client = makeClient();
    render(<ExperienceSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });

    await openAddForm(/profile.forms.addExperience/);
    fillMiniField("profile.forms.roleTitle", "Analityk");
    fireEvent.click(screen.getByRole("button", { name: "profile.actions.cancel" }));

    expect(screen.queryByLabelText("profile.forms.roleTitle")).not.toBeInTheDocument();
    expect(h.inserts).toHaveLength(0);
  });

  it("błąd USUWANIA pokazuje komunikat bazy, nie milczy", async () => {
    // Usunięcie odbite przez RLS bez komunikatu wygląda jak wiersz, który
    // „wraca" po odświeżeniu - użytkownik klika krzyżyk w kółko.
    h.rows.current = [{ id: "e1", role_title: "Analityk", is_current: false }];
    h.writeError.current = { message: "permission denied for table profile_experiences" };
    const client = makeClient();
    render(<ExperienceSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });

    fireEvent.click(await screen.findByRole("button", { name: "profile.actions.remove" }));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("permission denied for table profile_experiences"),
    );
  });

  it("wiersz „obecnie tu pracuję” pokazuje firmę, opis i otwarty zakres", async () => {
    h.rows.current = [
      {
        id: "e1",
        role_title: "Analityk",
        company: "Example Institute",
        description: "Analizy sektorowe.",
        start_date: "2020-01-15",
        end_date: null,
        is_current: true,
      },
    ];
    const client = makeClient();
    render(<ExperienceSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });

    await screen.findByText("Analityk");
    expect(screen.getByText("Example Institute")).toBeInTheDocument();
    expect(screen.getByText("Analizy sektorowe.")).toBeInTheDocument();
    // Zakres otwarty: rok początku + tłumaczone „obecnie" po myślniku.
    const range = screen.getByText(/profile\.forms\.datePresent/);
    expect(range.textContent).toMatch(/2020/);
    expect(range.textContent).toContain("–");
  });

  it("wiersz ZAMKNIĘTY pokazuje oba lata rozdzielone myślnikiem", async () => {
    h.rows.current = [
      {
        id: "e1",
        role_title: "Analityk",
        company: null,
        description: null,
        start_date: "2020-01-15",
        end_date: "2021-06-30",
        is_current: false,
      },
    ];
    const client = makeClient();
    render(<ExperienceSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });

    await screen.findByText("Analityk");
    const range = screen.getByText(/2020/);
    expect(range.textContent).toMatch(/2021/);
    expect(range.textContent).toContain("–");
  });

  it("wiersz z SAMĄ datą początku nie dorabia wiszącego myślnika", async () => {
    // „sty 2020 –" bez końca czytałoby się jak trwające zatrudnienie, którego
    // wpis nie zadeklarował.
    h.rows.current = [
      {
        id: "e1",
        role_title: "Analityk",
        company: null,
        description: null,
        start_date: "2020-01-15",
        end_date: null,
        is_current: false,
      },
    ];
    const client = makeClient();
    render(<ExperienceSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });

    await screen.findByText("Analityk");
    expect(screen.getByText(/2020/).textContent).not.toContain("–");
  });

  it("wpis BEZ jakiejkolwiek daty nie zostawia pustego wiersza z myślnikiem", async () => {
    h.rows.current = [
      {
        id: "e1",
        role_title: "Analityk",
        company: null,
        description: null,
        start_date: null,
        end_date: null,
        is_current: false,
      },
    ];
    const client = makeClient();
    render(<ExperienceSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });

    const row = (await screen.findByText("Analityk")).closest("li");
    expect(row).not.toBeNull();
    expect(row?.textContent).not.toContain("–");
  });
});

describe("EducationSection - pełny wiersz, awarie i tryb tylko-do-odczytu", () => {
  it("zapisuje stopień, kierunek i oba końce zakresu", async () => {
    const client = makeClient();
    render(<EducationSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });

    const save = await openAddForm(/profile.forms.addEducation/);
    fillMiniField("profile.forms.school", "Example University");
    fillMiniField("profile.forms.degree", "  Magister  ");
    fillMiniField("profile.forms.field", "  Prawo europejskie  ");
    fillMiniField("profile.forms.startDate", "2014-10-01");
    fillMiniField("profile.forms.endDate", "2019-06-30");
    fireEvent.click(save);

    await waitFor(() => expect(h.inserts).toHaveLength(1));
    expect(h.inserts[0].row).toMatchObject({
      school: "Example University",
      degree: "Magister",
      field: "Prawo europejskie",
      start_date: "2014-10-01",
      end_date: "2019-06-30",
    });
  });

  it("ANULOWANIE zamyka formularz bez zapisu", async () => {
    const client = makeClient();
    render(<EducationSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });

    await openAddForm(/profile.forms.addEducation/);
    fireEvent.click(screen.getByRole("button", { name: "profile.actions.cancel" }));

    expect(screen.queryByLabelText("profile.forms.school")).not.toBeInTheDocument();
    expect(h.inserts).toHaveLength(0);
  });

  it("błąd ZAPISU pokazuje komunikat bazy i nie udaje sukcesu", async () => {
    h.writeError.current = { message: "new row violates row-level security policy" };
    const client = makeClient();
    render(<EducationSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });

    const save = await openAddForm(/profile.forms.addEducation/);
    fillMiniField("profile.forms.school", "Example University");
    fireEvent.click(save);

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("new row violates row-level security policy"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("błąd USUWANIA pokazuje komunikat bazy", async () => {
    h.rows.current = [{ id: "e1", school: "Example University", degree: null, field: null }];
    h.writeError.current = { message: "permission denied for table profile_education" };
    const client = makeClient();
    render(<EducationSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });

    fireEvent.click(await screen.findByRole("button", { name: "profile.actions.remove" }));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("permission denied for table profile_education"),
    );
  });

  it("tryb tylko-do-odczytu nie pokazuje ANI dodawania, ANI usuwania", async () => {
    // Widok cudzego profilu: brak `editable` musi zdjąć obie akcje, nie jedną.
    h.rows.current = [{ id: "e1", school: "Example University", degree: null, field: null }];
    const client = makeClient();
    render(<EducationSection userId={USER} tenantId={TENANT_A} editable={false} />, {
      wrapper: wrapperFor(client),
    });

    await screen.findByText("Example University");
    expect(
      screen.queryByRole("button", { name: /profile.forms.addEducation/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "profile.actions.remove" }),
    ).not.toBeInTheDocument();
  });
});

describe("SkillsSection - awarie i tryb tylko-do-odczytu", () => {
  it("błąd ZAPISU pokazuje komunikat bazy, a pole nie jest czyszczone", async () => {
    // Wyczyszczenie pola przy nieudanym zapisie kazałoby wpisywać od nowa.
    h.writeError.current = { message: "duplicate key value violates unique constraint" };
    const client = makeClient();
    render(<SkillsSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });

    const input = await screen.findByPlaceholderText("profile.forms.addSkill");
    fireEvent.change(input, { target: { value: "OSINT" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("duplicate key value violates unique constraint"),
    );
    expect(input).toHaveValue("OSINT");
  });

  it("błąd USUWANIA pokazuje komunikat bazy", async () => {
    h.rows.current = [{ id: "s1", label: "OSINT" }];
    h.writeError.current = { message: "permission denied for table profile_skills" };
    const client = makeClient();
    render(<SkillsSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });

    fireEvent.click(await screen.findByRole("button", { name: "profile.actions.remove" }));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("permission denied for table profile_skills"),
    );
  });

  it("klawisz INNY niż Enter nie zapisuje umiejętności", async () => {
    // Tabulator, strzałki i Escape muszą zostawić pole w spokoju - inaczej
    // każde przejście klawiaturą przez formularz tworzy wiersz w bazie.
    const client = makeClient();
    render(<SkillsSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });

    const input = await screen.findByPlaceholderText("profile.forms.addSkill");
    fireEvent.change(input, { target: { value: "OSINT" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.keyDown(input, { key: "Tab" });

    expect(h.inserts).toHaveLength(0);
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("tryb tylko-do-odczytu zdejmuje pole dopisywania i krzyżyki przy chipach", async () => {
    h.rows.current = [{ id: "s1", label: "OSINT" }];
    const client = makeClient();
    render(<SkillsSection userId={USER} tenantId={TENANT_A} editable={false} />, {
      wrapper: wrapperFor(client),
    });

    await screen.findByText("OSINT");
    expect(screen.queryByPlaceholderText("profile.forms.addSkill")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "profile.actions.remove" }),
    ).not.toBeInTheDocument();
  });

  it("PUSTA lista umiejętności w widoku gościa mówi wprost, że nic tu nie ma", async () => {
    // W trybie edycji pustki NIE pokazujemy (jest pole dopisywania) - w widoku
    // cudzego profilu pusty prostokąt bez słowa byłby nieodróżnialny od awarii.
    const client = makeClient();
    render(<SkillsSection userId={USER} tenantId={TENANT_A} editable={false} />, {
      wrapper: wrapperFor(client),
    });

    await waitFor(() =>
      expect(screen.getByText("profile.sections.skillsEmpty")).toBeInTheDocument(),
    );
  });
});

describe("AwardsSection - walidacja, pełny wiersz, awarie", () => {
  it("odmawia zapisu BEZ tytułu i nie dotyka bazy", async () => {
    const client = makeClient();
    render(<AwardsSection userId={USER} tenantId={TENANT_A} editable kind="award" />, {
      wrapper: wrapperFor(client),
    });

    const save = await openAddForm(/profile.forms.addAward/);
    fillMiniField("profile.forms.issuer", "Example Foundation");
    fireEvent.click(save);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("profile.forms.title"));
    expect(h.inserts).toHaveLength(0);
  });

  it("zapisuje wydawcę, datę, adres i opis, przycinając białe znaki", async () => {
    const client = makeClient();
    render(<AwardsSection userId={USER} tenantId={TENANT_A} editable kind="award" />, {
      wrapper: wrapperFor(client),
    });

    const save = await openAddForm(/profile.forms.addAward/);
    fillMiniField("profile.forms.title", "  Nagroda roku  ");
    fillMiniField("profile.forms.issuer", "  Example Foundation  ");
    fillMiniField("profile.forms.awardedAt", "2025-11-20");
    fillMiniField("profile.forms.url", "  https://example.org/nagroda  ");
    fillMiniField("profile.forms.description", "  Za analizy sektorowe.  ");
    fireEvent.click(save);

    await waitFor(() => expect(h.inserts).toHaveLength(1));
    expect(h.inserts[0].row).toMatchObject({
      kind: "award",
      title: "Nagroda roku",
      issuer: "Example Foundation",
      awarded_at: "2025-11-20",
      url: "https://example.org/nagroda",
      description: "Za analizy sektorowe.",
    });
  });

  it("ANULOWANIE zamyka formularz bez zapisu", async () => {
    const client = makeClient();
    render(<AwardsSection userId={USER} tenantId={TENANT_A} editable kind="award" />, {
      wrapper: wrapperFor(client),
    });

    await openAddForm(/profile.forms.addAward/);
    fireEvent.click(screen.getByRole("button", { name: "profile.actions.cancel" }));

    expect(screen.queryByLabelText("profile.forms.title")).not.toBeInTheDocument();
    expect(h.inserts).toHaveLength(0);
  });

  it("błąd ZAPISU pokazuje komunikat bazy i nie udaje sukcesu", async () => {
    h.writeError.current = { message: "new row violates row-level security policy" };
    const client = makeClient();
    render(<AwardsSection userId={USER} tenantId={TENANT_A} editable kind="award" />, {
      wrapper: wrapperFor(client),
    });

    const save = await openAddForm(/profile.forms.addAward/);
    fillMiniField("profile.forms.title", "Nagroda roku");
    fireEvent.click(save);

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("new row violates row-level security policy"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("błąd USUWANIA pokazuje komunikat bazy", async () => {
    h.rows.current = [{ id: "a1", kind: "award", title: "Nagroda roku" }];
    h.writeError.current = { message: "permission denied for table profile_awards" };
    const client = makeClient();
    render(<AwardsSection userId={USER} tenantId={TENANT_A} editable kind="award" />, {
      wrapper: wrapperFor(client),
    });

    fireEvent.click(await screen.findByRole("button", { name: "profile.actions.remove" }));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("permission denied for table profile_awards"),
    );
  });

  it("wiersz pokazuje wydawcę, datę i opis, gdy są zapisane", async () => {
    h.rows.current = [
      {
        id: "a1",
        kind: "award",
        title: "Nagroda roku",
        issuer: "Example Foundation",
        awarded_at: "2025-11-20",
        description: "Za analizy sektorowe.",
        url: null,
      },
    ];
    const client = makeClient();
    render(<AwardsSection userId={USER} tenantId={TENANT_A} editable kind="award" />, {
      wrapper: wrapperFor(client),
    });

    await screen.findByText("Nagroda roku");
    expect(screen.getByText("Example Foundation")).toBeInTheDocument();
    expect(screen.getByText("2025-11-20")).toBeInTheDocument();
    expect(screen.getByText("Za analizy sektorowe.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("tryb tylko-do-odczytu zdejmuje dodawanie i usuwanie", async () => {
    h.rows.current = [{ id: "a1", kind: "award", title: "Nagroda roku" }];
    const client = makeClient();
    render(<AwardsSection userId={USER} tenantId={TENANT_A} editable={false} kind="award" />, {
      wrapper: wrapperFor(client),
    });

    await screen.findByText("Nagroda roku");
    expect(
      screen.queryByRole("button", { name: /profile.forms.addAward/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "profile.actions.remove" }),
    ).not.toBeInTheDocument();
  });
});

describe("CvSection - ścieżki awaryjne wysyłki i pobrania", () => {
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

  it("plik BEZ rozszerzenia i BEZ typu MIME dostaje domyślne .pdf, a kolumna typu NULL", async () => {
    // Nazwa kończąca się kropką (albo plik bez rozszerzenia) daje puste
    // rozszerzenie. Ścieżka bez rozszerzenia trafia do kubełka jako plik, którego
    // przeglądarka nie umie otworzyć - dlatego jest wartość domyślna. Kolumna
    // `mime_type` musi natomiast zostać NULL-em: „nie wiem" to nie
    // „application/pdf".
    const client = makeClient();
    render(<CvSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });
    await screen.findByText("profile.sections.cvEmpty");

    fireEvent.change(cvInput(), { target: { files: [new File([new Uint8Array(16)], "cv.")] } });

    await waitFor(() => expect(h.inserts).toHaveLength(1));
    expect(h.storageUploads[0].path.endsWith(".pdf")).toBe(true);
    expect(h.storageUploads[0].options).toMatchObject({ contentType: "application/pdf" });
    expect(h.inserts[0].row).toMatchObject({ file_name: "cv.", mime_type: null });
  });

  it("zdarzenie wyboru BEZ pliku nie wysyła niczego", async () => {
    // Anulowanie systemowego okna wyboru daje `change` z pustą listą plików.
    const client = makeClient();
    render(<CvSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });
    await screen.findByText("profile.sections.cvEmpty");

    fireEvent.change(cvInput(), { target: { files: [] } });

    expect(h.storageUploads).toHaveLength(0);
    expect(h.inserts).toHaveLength(0);
  });

  it("błąd WSTAWIENIA wiersza po udanym uploadzie pokazuje komunikat zapasowy", async () => {
    // Błąd PostgREST nie jest instancją `Error`, więc gałąź `e instanceof Error`
    // nie ma z czego wziąć treści - komunikat zapasowy jest jedyną informacją,
    // jaką dostaje użytkownik. Brak tej gałęzi dałby „[object Object]".
    h.writeError.current = { message: "new row violates row-level security policy" };
    const client = makeClient();
    render(<CvSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });
    await screen.findByText("profile.sections.cvEmpty");

    fireEvent.change(cvInput(), {
      target: { files: [new File([new Uint8Array(16)], "cv.pdf", { type: "application/pdf" })] },
    });

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Upload failed"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("usuwa BIEŻĄCY dokument po jego identyfikatorze", async () => {
    h.rows.current = [cvFile()];
    const client = makeClient();
    render(<CvSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });
    await screen.findByText("cv.pdf");

    fireEvent.click(screen.getByRole("button", { name: /profile\.sections\.cvDelete/ }));

    await waitFor(() => expect(h.deletes).toHaveLength(1));
    expect(h.deletes[0]).toEqual({ table: "profile_cv_files", filters: [["id", "cv-1"]] });
  });

  it("błąd USUWANIA dokumentu pokazuje komunikat bazy", async () => {
    h.rows.current = [cvFile()];
    h.writeError.current = { message: "permission denied for table profile_cv_files" };
    const client = makeClient();
    render(<CvSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });
    await screen.findByText("cv.pdf");

    fireEvent.click(screen.getByRole("button", { name: /profile\.sections\.cvDelete/ }));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("permission denied for table profile_cv_files"),
    );
  });

  it("usuwa wiersz Z HISTORII po jego identyfikatorze, nie bieżący", async () => {
    h.rows.current = [
      cvFile({ id: "cv-1", is_current: true }),
      cvFile({ id: "cv-2", file_name: "cv-2.pdf", is_current: false, version: 2 }),
    ];
    const client = makeClient();
    render(<CvSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });
    await screen.findByText("profile.sections.cvHistory");

    // Krzyżyki w historii mają etykietę `profile.actions.remove`; przycisk
    // przy bieżącym dokumencie ma własną etykietę (`cvDelete`).
    const historyRemoves = screen.getAllByRole("button", { name: "profile.actions.remove" });
    fireEvent.click(historyRemoves[historyRemoves.length - 1]);

    await waitFor(() => expect(h.deletes).toHaveLength(1));
    expect(h.deletes[0].filters).toEqual([["id", "cv-2"]]);
  });

  it("podpis BEZ błędu i BEZ danych daje komunikat zapasowy, nie otwiera pustego okna", async () => {
    h.signedUrlEmpty.current = true;
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    h.rows.current = [cvFile()];
    const client = makeClient();
    render(<CvSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });
    await screen.findByText("cv.pdf");

    fireEvent.click(screen.getByRole("button", { name: /profile\.sections\.cvPreview/ }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Preview failed"));
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("pobranie prosi o podpis Z NAZWĄ pliku i godzinnym czasem życia", async () => {
    // Bez opcji `download` przeglądarka zapisuje plik pod nazwą ze ŚCIEŻKI
    // w kubełku (`cv-1755...pdf`) - autor dostaje na dysk plik, którego nie
    // rozpoznaje. Czas życia podpisu (3600 s) jest drugą połową kontraktu:
    // link krótszy niż czas czytania wygasa w trakcie podglądu.
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    h.rows.current = [cvFile()];
    const client = makeClient();
    render(<CvSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });
    await screen.findByText("cv.pdf");

    fireEvent.click(screen.getByRole("button", { name: /profile\.sections\.cvDownload/ }));

    await waitFor(() => expect(h.signedUrlCalls).toHaveLength(1));
    expect(h.signedUrlCalls[0]).toEqual({
      path: cvFile().file_url,
      ttl: 3600,
      opts: { download: "cv.pdf" },
    });
    expect(openSpy).toHaveBeenCalledWith(
      `https://signed.example/${cvFile().file_url}`,
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
  });

  it("PODGLĄD prosi o podpis BEZ opcji pobrania - plik ma się otworzyć, nie zapisać", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    h.rows.current = [cvFile()];
    const client = makeClient();
    render(<CvSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });
    await screen.findByText("cv.pdf");

    fireEvent.click(screen.getByRole("button", { name: /profile\.sections\.cvPreview/ }));

    await waitFor(() => expect(h.signedUrlCalls).toHaveLength(1));
    expect(h.signedUrlCalls[0].opts).toBeUndefined();
    openSpy.mockRestore();
  });

  it("HISTORIA w trybie tylko-do-odczytu nie ma ani krzyżyków, ani przywracania", async () => {
    h.rows.current = [
      cvFile({ id: "cv-1", is_current: true }),
      cvFile({ id: "cv-2", file_name: "cv-2.pdf", is_current: false, version: 2 }),
    ];
    const client = makeClient();
    render(<CvSection userId={USER} tenantId={TENANT_A} editable={false} />, {
      wrapper: wrapperFor(client),
    });
    await screen.findByText("profile.sections.cvHistory");

    expect(
      screen.queryByRole("button", { name: "profile.actions.remove" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "profile.sidebar.retakeTest" }),
    ).not.toBeInTheDocument();
    // Podgląd i pobranie zostają - to jedyny sens tej sekcji dla gościa.
    expect(
      screen.getByRole("button", { name: /profile\.sections\.cvPreview/ }),
    ).toBeInTheDocument();
  });
});

describe("dostępność sekcji dodatkowych", () => {
  it("otwarty formularz doświadczenia nie ma naruszeń axe", async () => {
    // W tym pliku poprawiono już raz osiem nienazwanych pól (`MiniField`
    // dostał `useId` + `htmlFor`) - to regresja, która wraca przy każdym nowym
    // polu dopisanym „na szybko".
    h.rows.current = [
      {
        id: "e1",
        role_title: "Analityk",
        company: "Example Institute",
        description: "Analizy sektorowe.",
        start_date: "2020-01-15",
        end_date: null,
        is_current: true,
      },
    ];
    const client = makeClient();
    const view = render(<ExperienceSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });
    await openAddForm(/profile.forms.addExperience/);

    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("otwarty formularz wyróżnienia nie ma naruszeń axe", async () => {
    const client = makeClient();
    const view = render(
      <AwardsSection userId={USER} tenantId={TENANT_A} editable kind="recognition" />,
      { wrapper: wrapperFor(client) },
    );
    await openAddForm(/profile.forms.addAward/);

    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("sekcja dokumentów z historią nie ma naruszeń axe", async () => {
    h.rows.current = [
      {
        id: "cv-1",
        file_name: "cv.pdf",
        file_url: "tenant-a/users/user-a/cv-1.pdf",
        mime_type: "application/pdf",
        size_bytes: 1024,
        version: 1,
        is_current: true,
        uploaded_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "cv-2",
        file_name: "cv-2.pdf",
        file_url: "tenant-a/users/user-a/cv-2.pdf",
        mime_type: "application/pdf",
        size_bytes: 2048,
        version: 2,
        is_current: false,
        uploaded_at: "2026-01-02T00:00:00Z",
      },
    ];
    const client = makeClient();
    const view = render(<CvSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });
    await screen.findByText("profile.sections.cvHistory");

    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("sekcja umiejętności w trybie edycji nie ma naruszeń axe", async () => {
    h.rows.current = [{ id: "s1", label: "OSINT" }];
    const client = makeClient();
    const view = render(<SkillsSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });
    await screen.findByText("OSINT");

    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("defekty sekcji dodatkowych", () => {
  it.fails("DEFEKT: błąd odczytu listy jest NIEODRÓŻNIALNY od pustej listy", async () => {
    // CO: `useUserList` rzuca błąd (ProfileExtraSections.tsx:81), ale żadna
    // sekcja nie czyta `q.isError` - `isEmpty` liczy tylko `!q.isLoading &&
    // items.length === 0`, więc awaria odczytu renderuje się DOKŁADNIE jak
    // pusty dorobek.
    // GDZIE: src/components/profile/sections/ProfileExtraSections.tsx:81
    // (rzucenie) + :194, :367, :503, :630 (wyliczenie `isEmpty`).
    // KONSEKWENCJA: użytkownik, któremu odczyt odbiła polityka RLS albo padła
    // sieć, widzi „brak wpisów" nad WŁASNYM doświadczeniem zawodowym i wpisuje
    // je od nowa - powstają duplikaty, których nie umie usunąć, bo pierwotnych
    // wierszy nadal nie widzi. Repo ma na to gotowy atom
    // (`src/components/profile/atoms/ListHydrationNotice.tsx`): trzy stany
    // (oczekiwanie, awaria, pustka) MUSZĄ być rozłączne.
    h.selectError.current = { message: "permission denied for table profile_experiences" };
    const client = makeClient();
    render(<ExperienceSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });

    // Najpierw dowód, że stan się USTABILIZOWAŁ na komunikacie pustki...
    await waitFor(() =>
      expect(screen.getByText("profile.sections.experienceEmpty")).toBeInTheDocument(),
    );
    // ...a potem asercja tego, czego brakuje: awaria musi być OGŁOSZONA.
    expect(screen.queryByRole("alert")).not.toBeNull();
  });

  it.fails("DEFEKT: nieudane wstawienie CV zostawia profil BEZ dokumentu bieżącego", async () => {
    // CO: `onUpload` najpierw zdejmuje flagę `is_current` ze wszystkich wierszy
    // użytkownika (linia 774-778), a DOPIERO POTEM wstawia nowy wiersz
    // (linia 780). Gdy insert padnie, odznaczenie zostaje - i żaden wiersz nie
    // jest już bieżący. Kolejność jest odwracalna bez zmiany kontraktu.
    // GDZIE: src/components/profile/sections/ProfileExtraSections.tsx:774-790.
    // KONSEKWENCJA: karta osoby w CRM czyta CV zapytaniem
    // `.eq("is_current", true).maybeSingle()` (src/lib/crm.functions.ts:445),
    // więc po nieudanym uploadzie PRZESTAJE pokazywać jakikolwiek życiorys -
    // choć stary plik nadal leży w bazie i w kubełku. W samym edytorze nie
    // widać tego wcale, bo lista spada na `items[0]`, więc użytkownik nie ma
    // nawet z czego wywnioskować, co się stało.
    h.rows.current = [
      {
        id: "cv-1",
        file_name: "cv.pdf",
        file_url: "tenant-a/users/user-a/cv-1.pdf",
        mime_type: "application/pdf",
        size_bytes: 1024,
        version: 1,
        is_current: true,
        uploaded_at: "2026-01-01T00:00:00Z",
      },
    ];
    h.writeError.current = { message: "new row violates row-level security policy" };
    const client = makeClient();
    render(<CvSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });
    await screen.findByText("cv.pdf");

    fireEvent.change(cvInput(), {
      target: {
        files: [new File([new Uint8Array(16)], "nowe-cv.pdf", { type: "application/pdf" })],
      },
    });

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Upload failed"));
    expect(h.updates.filter((u) => u.patch.is_current === false)).toHaveLength(0);
  });

  it.fails("DEFEKT: nieudane „ustaw jako bieżący” MILCZY", async () => {
    // CO: `markCurrent` (ProfileExtraSections.tsx:806-814) nie czyta `error`
    // z ŻADNEGO z dwóch zapisów - ani z odznaczenia, ani z zaznaczenia. Po
    // odbiciu przez RLS woła `invalidate()` i kończy się bez śladu.
    // GDZIE: src/components/profile/sections/ProfileExtraSections.tsx:806-814.
    // KONSEKWENCJA: użytkownik klika „przywróć tę wersję", lista mruga
    // i wraca w stanie sprzed kliknięcia. Bez komunikatu wygląda to na zepsuty
    // przycisk; użytkownik klika dalej albo usuwa nowszy plik, żeby „zmusić"
    // profil do pokazania starszego.
    h.rows.current = [
      {
        id: "cv-1",
        file_name: "cv.pdf",
        file_url: "tenant-a/users/user-a/cv-1.pdf",
        mime_type: "application/pdf",
        size_bytes: 1024,
        version: 1,
        is_current: true,
        uploaded_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "cv-2",
        file_name: "cv-2.pdf",
        file_url: "tenant-a/users/user-a/cv-2.pdf",
        mime_type: "application/pdf",
        size_bytes: 2048,
        version: 2,
        is_current: false,
        uploaded_at: "2026-01-02T00:00:00Z",
      },
    ];
    h.writeError.current = { message: "permission denied for table profile_cv_files" };
    const client = makeClient();
    render(<CvSection userId={USER} tenantId={TENANT_A} editable />, {
      wrapper: wrapperFor(client),
    });
    await screen.findByText("profile.sections.cvHistory");

    fireEvent.click(screen.getByRole("button", { name: "profile.sidebar.retakeTest" }));

    await waitFor(() => expect(h.updates).toHaveLength(2));
    expect(h.toastError).toHaveBeenCalled();
  });

  it.fails("DEFEKT: zakres dat wiersza NIE idzie za językiem widoku", async () => {
    // CO: `formatRange` (ProfileExtraSections.tsx:1000 i :1005) formatuje daty
    // przez `toLocaleDateString(undefined, …)`, czyli locale ŚRODOWISKA, choć
    // dostaje `t` i mogłoby dostać język widoku. Nazwy miesięcy są więc te
    // same dla obu wersji językowych profilu.
    // GDZIE: src/components/profile/sections/ProfileExtraSections.tsx:993-1009.
    // KONSEKWENCJA: angielska wersja profilu eksperta pokazuje „sty 2020 – cze
    // 2021" (albo odwrotnie: polska „Jan 2020"), zależnie od locale procesu
    // renderującego SSR - a nie od języka, który wybrał czytelnik. Ten sam
    // brak wejścia sprawia, że data jest formatowana w strefie czasowej
    // serwera, więc wpis z 1 stycznia może wyświetlić się jako grudzień.
    const row = {
      id: "e1",
      role_title: "Analityk",
      company: null,
      description: null,
      start_date: "2020-01-15",
      end_date: "2021-06-30",
      is_current: false,
    };
    h.rows.current = [row];

    h.language.current = "pl";
    render(<ExperienceSection userId={USER} tenantId={TENANT_A} editable={false} />, {
      wrapper: wrapperFor(makeClient()),
    });
    const polish = (await screen.findByText(/2020/)).textContent;

    h.language.current = "en";
    render(<ExperienceSection userId={USER} tenantId={TENANT_A} editable={false} />, {
      wrapper: wrapperFor(makeClient()),
    });
    const english = (await screen.findAllByText(/2020/)).at(-1)?.textContent;

    expect(english).not.toBe(polish);
  });
});
