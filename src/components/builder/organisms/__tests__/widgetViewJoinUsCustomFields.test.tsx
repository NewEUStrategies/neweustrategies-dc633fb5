// Dyspozytor widgetów a moduł pól własnych formularzy (P3.9).
//
// CO TEN PLIK DOWODZI. `WidgetView` jest leniwym chunkiem ładowanym na `/`
// (strona główna ma widgety treściowe), więc jego statyczne importy jadą do
// każdej odsłony strony głównej. Do P3.9 importował z `formFieldConfig.tsx`
// sam parser `parseCustomFields`, a moduł ciągnął za sobą renderer pól:
// `FormSelect` (Radix Select), kompozytor wiadomości, wzmianki i adminowy
// `LayoutPreview` - ~64 KB transferu na `/` dla widgetu, którego tam nie ma.
//
//   1. ZAŁADOWANIE DYSPOZYTORA NIE ŁADUJE MODUŁU PÓL. Moduł ma się wykonać
//      dopiero razem z leniwym chunkiem formularza „Dołącz do nas".
//   2. SUROWA TREŚĆ DOCHODZI DO FORMULARZA. `content.customFields` w formacie
//      edytora (`stringArray`, linia = obiekt JSON) zamienia się w pole
//      formularza tak samo jak przed przeniesieniem parsowania.
//
// Ten test pilnuje grafu ŁADOWANIA modułów (krawędź statyczna = wykonanie
// przy imporcie). Gdzie Rollup skleja chunki, rozstrzyga dopiero build
// (inwentarz chunków, raport P3.9).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WidgetNode } from "@/lib/builder/types";

const fieldModule = vi.hoisted(() => ({ loads: 0 }));
vi.mock("@/lib/builder/formFieldConfig", async (importOriginal) => {
  fieldModule.loads += 1;
  return importOriginal<typeof import("@/lib/builder/formFieldConfig")>();
});

vi.mock("@/integrations/supabase/client", () => {
  type Builder = Record<string, unknown> & { then: (r: (v: unknown) => unknown) => unknown };
  const builder = {} as Builder;
  for (const m of ["select", "eq", "in", "order", "limit", "is", "not"]) {
    (builder as Record<string, unknown>)[m] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  builder.single = vi.fn(async () => ({ data: null, error: null }));
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
  const channel: Record<string, unknown> = {};
  channel.on = vi.fn(() => channel);
  channel.subscribe = vi.fn(() => channel);
  return {
    supabase: {
      from: vi.fn(() => builder),
      rpc: vi.fn(async () => ({ data: [], error: null })),
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(async () => "ok"),
      auth: {
        getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
        getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
      },
    },
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
    i18n: { language: "pl", changeLanguage: () => Promise.resolve() },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import { WidgetView } from "@/components/builder/organisms/WidgetView";

afterEach(cleanup);

function renderJoinUs(content: Record<string, unknown>) {
  const node: WidgetNode = {
    id: "join-us-cf",
    kind: "widget",
    type: "join-us",
    content: content as WidgetNode["content"],
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WidgetView node={node} lang="pl" device="desktop" editable={false} />
    </QueryClientProvider>,
  );
}

describe("WidgetView a pola własne formularza (P3.9)", () => {
  // Kolejność ma znaczenie: licznik rośnie przy pierwszym imporcie modułu pól,
  // a test niżej ładuje go przez chunk formularza.
  it("załadowanie dyspozytora nie wykonuje modułu pól formularza", () => {
    expect(fieldModule.loads).toBe(0);
  });

  it("surowe `content.customFields` (linia = JSON) renderuje pole w formularzu", async () => {
    renderJoinUs({
      variant: "split",
      customFields: [
        JSON.stringify({ id: "member", type: "text", labelPl: "Nr członkowski" }),
        "{wadliwa linia",
      ],
    });
    expect(await screen.findByLabelText("Nr członkowski", { exact: false })).toBeTruthy();
    expect(fieldModule.loads).toBe(1);
  });
});
