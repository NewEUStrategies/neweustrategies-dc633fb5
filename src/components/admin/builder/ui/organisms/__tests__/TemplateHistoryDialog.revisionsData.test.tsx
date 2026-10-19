// HISTORIA SZABLONU NA PRAWDZIWYM HAKU DANYCH - co redaktor widzi, gdy baza
// odmówi, gdy historia jest dłuższa niż lista i gdy data rewizji jest zła.
//
// Siostrzany builderDialogsAndPreview.test.tsx atrapuje `useTemplateRevisions`
// i sprawdza oprawę listy. Tu hak jest PRAWDZIWY, a atrapą jest tylko klient
// Supabase i hook najemcy - więc dowodzimy całej drogi „wiersze z bazy ->
// ekran":
//   1. Odmowa odczytu historii jest KOMUNIKATEM (role="alert"), a nie
//      „Brak rewizji." - redaktor nie może uznać, że historii nie ma.
//   2. Historia dłuższa niż limit pokazuje limit wierszy i notkę o obcięciu.
//   3. Uszkodzony `created_at` nie wyświetla „Invalid Date" - zostaje surowy.
//   4. Dialog pyta o historię WSKAZANEGO szablonu, zawężoną do najemcy z sesji.
// i18n: atrapa z @/test/i18nStub (klucz + parametry), jak u sąsiadów.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { RecordedChain, SupabaseFromStub, SupabaseResult } from "@/test/supabase";

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  tenantId: "11111111-1111-4111-8111-111111111111" as string | null,
}));

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (!h.db) throw new Error("test: atrapa bazy nie została zainicjalizowana");
      return h.db.from(table);
    },
  },
}));
vi.mock("@/lib/tenant", () => ({
  useCurrentTenantId: () => h.tenantId,
}));

import { fail, ok, supabaseFromStub } from "@/test/supabase";
import { TEMPLATE_REVISIONS_LIMIT, type SectionTemplate } from "@/lib/builder/templates";
import { TemplateHistoryDialog } from "../TemplateHistoryDialog";

const REV = "builder_template_revisions";
const TENANT = "11111111-1111-4111-8111-111111111111";

const template: SectionTemplate = {
  id: "t1",
  name: "Hero",
  data: { id: "s1", kind: "section", children: [] },
  created_at: "2026-08-01T10:00:00.000Z",
  created_by: null,
};

const revRow = (id: string, created_at = "2026-08-01T10:00:00.000Z") => ({
  id,
  template_id: "t1",
  name: `Hero ${id}`,
  data: { id: `s-${id}`, kind: "section", children: [] },
  note: null,
  created_at,
  created_by: null,
});

function db(): SupabaseFromStub {
  if (!h.db) throw new Error("test: atrapa bazy nie została zainicjalizowana");
  return h.db;
}

function respond(result: SupabaseResult): void {
  db().setResponse(REV, () => result);
}

function openDialog() {
  return render(
    <TemplateHistoryDialog
      template={template}
      open
      onOpenChange={vi.fn()}
      onInsert={vi.fn()}
      onRestore={vi.fn()}
    />,
  );
}

beforeEach(() => {
  h.db = supabaseFromStub();
  h.tenantId = TENANT;
});

afterEach(() => {
  h.db?.reset();
});

describe("TemplateHistoryDialog - dane z prawdziwego haka historii", () => {
  it("pyta o rewizje wskazanego szablonu w obszarze roboczym z sesji", async () => {
    respond(ok([revRow("r1")]));

    openDialog();

    expect(await screen.findByText(/builder\.templateHistory\.current/)).toBeTruthy();
    const eq = (db().lastChain(REV) as RecordedChain).calls
      .filter((c) => c.method === "eq")
      .map((c) => c.args);
    expect(eq).toEqual([
      ["template_id", "t1"],
      ["tenant_id", TENANT],
    ]);
  });

  it("odmowa odczytu pokazuje alert zamiast „brak rewizji”", async () => {
    respond(fail("permission denied for table builder_template_revisions", "42501"));

    openDialog();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("builder.templateHistory.error");
    expect(screen.queryByText("builder.templateHistory.empty")).toBeNull();
  });

  it("historia dłuższa niż limit pokazuje limit wierszy i notkę o obcięciu", async () => {
    respond(ok(Array.from({ length: TEMPLATE_REVISIONS_LIMIT + 1 }, (_, i) => revRow(`r-${i}`))));

    openDialog();

    expect(
      await screen.findByText(`builder.templateHistory.truncated(n=${TEMPLATE_REVISIONS_LIMIT})`),
    ).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(TEMPLATE_REVISIONS_LIMIT);
  });

  it("pełna historia w limicie nie pokazuje notki o obcięciu", async () => {
    respond(ok([revRow("r2"), revRow("r1")]));

    openDialog();

    expect(await screen.findAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByText(/builder\.templateHistory\.truncated/)).toBeNull();
  });

  it("uszkodzony znacznik czasu zostaje surowy zamiast „Invalid Date”", async () => {
    respond(ok([revRow("r2"), revRow("r1", "nie-data")]));

    openDialog();

    const [, starsza] = await screen.findAllByRole("listitem");
    expect(within(starsza).getByText("nie-data")).toBeTruthy();
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
  });
});
