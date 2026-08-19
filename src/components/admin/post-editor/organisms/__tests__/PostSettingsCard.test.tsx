// Karta „Ustawienia wpisu" (`PostSettingsCard`, 0%): workflow publikacji, typ
// edytora, slug, strona nadrzędna, czas czytania i okładka.
//
// To najgęstszy adapter w sidebarze i niesie trzy reguły, których złamanie jest
// kosztowne:
//
//   1. ZMIANA STATUSU W SELEKCIE PRZECHODZI PRZEZ BRAMKĘ. To jest GŁÓWNA ścieżka
//      publikacji (status → published, potem „Zapisz"). Gdyby select omijał
//      miękką bramkę checklisty, wpis bez okładki i kategorii wychodziłby na
//      stronę bez jednego pytania — a bramka istnieje właśnie po to, żeby
//      redaktor zobaczył braki, zanim opublikuje.
//   2. SLUG JEST NORMALIZOWANY W LOCIE, ale dywiz na końcu zostaje. Ucinanie go
//      przy każdym znaku uniemożliwiłoby napisanie sluga wielowyrazowego —
//      „polityka-" zamieniałoby się w „polityka" przy każdym naciśnięciu.
//   3. PUSTY CZAS CZYTANIA TO `null`, NIE ZERO. Zero znaczy „0 minut czytania",
//      a `null` znaczy „policz automatycznie" — czytelnik widzi różnicę.
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { postEditorData, postEditorFormApi, postForm } from "@/test/post-editor/fixtures";

const h = vi.hoisted(() => ({
  captured: {} as Record<string, unknown>,
  migrate: null as unknown,
  toast: null as unknown,
  toastError: null as unknown,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(),
);

// Podmieniamy WYLACZNIE `useServerFn` - reszta modulu musi zostac, bo
// `createIsomorphicFn` jest uzywane przez warstwe i18n wciagana tu tranzytywnie
// (slugifyTaxonomy -> localeRuntime).
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

vi.mock("@/lib/posts-migrate.functions", async () => {
  const { vi: v } = await import("vitest");
  h.migrate = v.fn(async () => ({ source: "richtext" }));
  return { migratePostToBlocks: h.migrate };
});

vi.mock("sonner", async () => {
  const { toastStub } = await import("@/test/post-editor/fixtures");
  const toast = toastStub();
  h.toast = toast;
  return { toast, Toaster: () => null };
});

vi.mock("@/lib/toastError", async () => {
  const { vi: v } = await import("vitest");
  h.toastError = v.fn();
  return { toastError: h.toastError };
});

function probe(name: string) {
  return (props: Record<string, unknown>) => {
    h.captured[name] = props;
    return <div data-testid={name} />;
  };
}

vi.mock("@/components/admin/CoverImagePicker", () => ({
  CoverImagePicker: probe("CoverImagePicker"),
}));
vi.mock("@/components/admin/PageParentSelect", () => ({
  PageParentSelect: probe("PageParentSelect"),
}));
vi.mock("../../molecules", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, WorkflowStatusSection: probe("WorkflowStatusSection") };
});
// Sekcje sidebara startują zwinięte; ich zwijanie ma własny test w atomach.
vi.mock("../../atoms", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    SidebarSection: ({ title, children }: { title: string; children: unknown }) => (
      <section aria-label={title}>{children as never}</section>
    ),
  };
});

import { PostSettingsCard } from "../PostSettingsCard";

/** Waski widok na atrape API formularza - patrz komentarz w `panels.test.tsx`. */
type Api = Record<string, unknown> & {
  set: ReturnType<typeof vi.fn>;
  confirmPublishGaps: ReturnType<typeof vi.fn>;
  applyStatus: unknown;
  onRevisionRestored: unknown;
  setSelectedCats: ReturnType<typeof vi.fn>;
  setSelectedTags: ReturnType<typeof vi.fn>;
  setSelectedPrograms: ReturnType<typeof vi.fn>;
  setSelectedRegions: ReturnType<typeof vi.fn>;
  history: { set: ReturnType<typeof vi.fn> };
};
type Mock = ReturnType<typeof vi.fn>;
const props = (name: string) => h.captured[name] as Record<string, unknown>;
const toast = () => h.toast as Record<string, Mock>;

function renderCard(over: Partial<Record<string, unknown>> = {}) {
  const formApi = postEditorFormApi(over) as unknown as Parameters<
    typeof PostSettingsCard
  >[0]["formApi"];
  const view = renderWithQueryClient(
    <PostSettingsCard
      formApi={formApi}
      data={postEditorData() as unknown as Parameters<typeof PostSettingsCard>[0]["data"]}
      routeSlug="moj-wpis"
      uiLang="pl"
      autoReadMinutes={
        { pl: { minutes: 6 }, en: { minutes: 4 } } as unknown as Parameters<
          typeof PostSettingsCard
        >[0]["autoReadMinutes"]
      }
    />,
  );
  return { ...view, formApi: formApi as unknown as Api };
}

beforeEach(() => {
  (h.migrate as Mock).mockReset();
  (h.migrate as Mock).mockResolvedValue({ source: "richtext" });
  (h.toastError as Mock).mockReset();
  for (const fn of Object.values(toast())) fn.mockReset();
});

afterEach(() => {
  cleanup();
  h.captured = {};
});

// ---------------------------------------------------------------------------
// Workflow publikacji
// ---------------------------------------------------------------------------

describe("PostSettingsCard - bramka publikacji w selekcie statusu", () => {
  it("zmiana statusu PRZECHODZI przez miękką bramkę checklisty", async () => {
    // To GŁÓWNA ścieżka publikacji. Omijanie bramki tutaj wypuszczałoby wpis
    // bez okładki i kategorii bez jednego pytania.
    const { formApi } = renderCard();

    (props("WorkflowStatusSection").onStatusChange as (v: string) => void)("published");

    await waitFor(() => expect(formApi.confirmPublishGaps).toHaveBeenCalledWith("published"));
    await waitFor(() => expect(formApi.set).toHaveBeenCalledWith("status", "published"));
  });

  it("ODMOWA w bramce NIE zmienia statusu", async () => {
    const { formApi } = renderCard({
      confirmPublishGaps: vi.fn(async () => false),
    });

    (props("WorkflowStatusSection").onStatusChange as (v: string) => void)("published");

    await waitFor(() => expect(formApi.confirmPublishGaps).toHaveBeenCalled());
    expect(formApi.set).not.toHaveBeenCalledWith("status", "published");
  });

  it("data publikacji zapisuje się wprost, bez bramki", async () => {
    // Ustawienie terminu nie jest jeszcze publikacją.
    const { formApi } = renderCard();

    (props("WorkflowStatusSection").onPublishAtChange as (v: string) => void)(
      "2026-09-01T10:00:00.000Z",
    );

    expect(formApi.set).toHaveBeenCalledWith("publish_at", "2026-09-01T10:00:00.000Z");
    expect(formApi.confirmPublishGaps).not.toHaveBeenCalled();
  });

  it("przekazuje uprawnienia i ostrzeżenie o przeterminowanym terminie", () => {
    renderCard({ canPublish: false, scheduledInPast: true });
    expect(props("WorkflowStatusSection").canPublish).toBe(false);
    expect(props("WorkflowStatusSection").scheduledInPast).toBe(true);
  });

  it("przycisk akcji statusu woła applyStatus formularza", () => {
    const { formApi } = renderCard();
    expect(props("WorkflowStatusSection").onApplyStatus).toBe(formApi.applyStatus);
  });
});

// ---------------------------------------------------------------------------
// Slug
// ---------------------------------------------------------------------------

describe("PostSettingsCard - slug", () => {
  const slugInput = () => screen.getByDisplayValue(postForm().slug);

  it("normalizuje w locie, ale ZOSTAWIA końcowy dywiz", () => {
    // Ucinanie dywizu przy każdym znaku uniemożliwiłoby napisanie sluga
    // wielowyrazowego: „polityka-" wracałoby jako „polityka".
    const { formApi } = renderCard();

    fireEvent.change(slugInput(), { target: { value: "Polityka Spójności-" } });

    expect(formApi.set).toHaveBeenCalledWith("slug", "polityka-spojnosci-");
  });

  it("po opuszczeniu pola dywiz końcowy znika", () => {
    const { formApi } = renderCard();

    fireEvent.blur(slugInput(), { target: { value: "polityka-spojnosci-" } });

    expect(formApi.set).toHaveBeenCalledWith("slug", "polityka-spojnosci");
  });

  it("diakrytyki i wielkie litery są zdejmowane już przy pisaniu", () => {
    const { formApi } = renderCard();
    fireEvent.change(slugInput(), { target: { value: "ŚRODA Wielkopolska" } });
    expect(formApi.set).toHaveBeenCalledWith("slug", "sroda-wielkopolska");
  });

  // -------------------------------------------------------------------------
  // REGRESJA: slug transliteruje „ł" na „l", zamiast ją zjadać.
  //
  // Do 18.08 `normalizeSlugInput` opierał transliterację wyłącznie na
  // `normalize("NFD")`, które rozkłada ą/ć/ę/ń/ó/ś/ź/ż na „podstawa + znak
  // diakrytyczny" — ale NIE „ł" (U+0142). To osobna litera z przekreśleniem,
  // nie złożenie, więc NFD zostawiała ją bez zmian, a następny krok
  // (`[^a-z0-9]+`) zamieniał ją na dywiz.
  //
  // Skutek: wpis „Łódź Miasto" dostawał adres `odz-miasto`, a „Miłość" →
  // `mio-c`. Adres wpisu jest trwały (linkowany, indeksowany), więc pomyłka
  // zostawała na stałe.
  // -------------------------------------------------------------------------
  it("litera ze skreśleniem jest TRANSLITEROWANA, nie zjadana", () => {
    const { formApi } = renderCard();
    fireEvent.change(slugInput(), { target: { value: "ŁÓDŹ Miasto" } });
    expect(formApi.set).toHaveBeenCalledWith("slug", "lodz-miasto");
  });
});

// ---------------------------------------------------------------------------
// Czas czytania
// ---------------------------------------------------------------------------

describe("PostSettingsCard - czas czytania", () => {
  it("puste pole zapisuje `null` (czytelnik dostaje automat), nie zero", () => {
    // Zero znaczy „0 minut czytania" i tak zostałoby pokazane czytelnikowi.
    const { formApi } = renderCard();

    fireEvent.change(screen.getByPlaceholderText("admin.posts.readMinutesAuto"), {
      target: { value: "" },
    });

    expect(formApi.set).toHaveBeenCalledWith("read_minutes", null);
  });

  it("wpisana liczba jedzie jako LICZBA, nie string", () => {
    const { formApi } = renderCard();

    fireEvent.change(screen.getByPlaceholderText("admin.posts.readMinutesAuto"), {
      target: { value: "12" },
    });

    expect(formApi.set).toHaveBeenCalledWith("read_minutes", 12);
  });

  it("podpowiedź pokazuje automat dla OBU języków", () => {
    // Automat liczy się tym samym rdzeniem, co strona publiczna - redaktor musi
    // widzieć obie wersje, bo pole nadpisuje obie naraz.
    renderCard();
    const hint = screen.getByText(/admin\.posts\.readMinutesHint/);
    expect(hint.textContent).toContain('"pl":6');
    expect(hint.textContent).toContain('"en":4');
  });
});

// ---------------------------------------------------------------------------
// Typ edytora i migracja
// ---------------------------------------------------------------------------

describe("PostSettingsCard - typ edytora", () => {
  it("zmiana silnika zapisuje się do formularza", () => {
    const { formApi } = renderCard();
    const trigger = screen.getByRole("combobox");

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.click(
      within(screen.getByRole("listbox")).getByRole("option", {
        name: "admin.posts.editorMarkdown",
      }),
    );

    expect(formApi.set).toHaveBeenCalledWith("editor", "markdown");
  });

  it("przycisk migracji do bloków JEST widoczny dla starszych silników", () => {
    for (const editor of ["richtext", "markdown", "builder"] as const) {
      renderCard({ form: postForm({ editor }) });
      expect(screen.getByText("admin.posts.migrateToBlocks"), editor).toBeInTheDocument();
      cleanup();
    }
  });

  it("dla edytora blokowego przycisku migracji NIE MA", () => {
    // Migracja bloków do bloków byłaby operacją bez sensu na żywym wpisie.
    renderCard({ form: postForm({ editor: "blocks" }) });
    expect(screen.queryByText("admin.posts.migrateToBlocks")).toBeNull();
  });

  it("migracja woła server fn z id wpisu, melduje sukces i odświeża wiersz", async () => {
    const { queryClient } = renderCard({ form: postForm({ editor: "richtext" }) });
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.click(screen.getByText("admin.posts.migrateToBlocks"));

    await waitFor(() =>
      expect(h.migrate as Mock).toHaveBeenCalledWith({ data: { id: postForm().id } }),
    );
    await waitFor(() => expect(toast().success).toHaveBeenCalled());
    // Bez inwalidacji edytor pokazywałby starą treść mimo udanej migracji.
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: ["post-by-slug", postEditorData().tenantId, "moj-wpis"],
        }),
      ),
    );
  });

  it("nieudana migracja pokazuje BŁĄD i nie melduje sukcesu", async () => {
    (h.migrate as Mock).mockRejectedValue(new Error("nie da się"));
    renderCard({ form: postForm({ editor: "richtext" }) });

    fireEvent.click(screen.getByText("admin.posts.migrateToBlocks"));

    await waitFor(() => expect(h.toastError as Mock).toHaveBeenCalled());
    expect(toast().success).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Strona nadrzędna i okładka
// ---------------------------------------------------------------------------

describe("PostSettingsCard - strona nadrzędna i okładka", () => {
  it("wybór strony nadrzędnej jest tenant-scoped", () => {
    // Lista stron obcej firmy w tym selekcie byłaby wyciekiem struktury serwisu.
    renderCard();
    expect(props("PageParentSelect").tenantId).toBe(postEditorData().tenantId);
  });

  it("PUSTY wybór strony nadrzędnej nie nadpisuje wartości", () => {
    // `onChange(undefined)` z komponentu selecta nie może wyczyścić pola przez
    // przypadek - czyszczenie idzie osobną, jawną wartością.
    const { formApi } = renderCard();

    (props("PageParentSelect").onChange as (v: string | undefined) => void)(undefined);

    expect(formApi.set).not.toHaveBeenCalledWith("parent_page_id", undefined);
  });

  it("wybrana strona nadrzędna zapisuje się", () => {
    const { formApi } = renderCard();
    (props("PageParentSelect").onChange as (v: string) => void)("page-9");
    expect(formApi.set).toHaveBeenCalledWith("parent_page_id", "page-9");
  });

  it("usunięcie okładki zapisuje `null`, nie pusty string", () => {
    // Pusty string w kolumnie wygląda jak „jest okładka" i publiczny layout
    // renderowałby pustą ramkę zamiast wariantu bez obrazu.
    const { formApi } = renderCard();

    (props("CoverImagePicker").onChange as (v: string) => void)("");

    expect(formApi.set).toHaveBeenCalledWith("cover_image_url", null);
  });

  it("ustawienie okładki zapisuje adres", () => {
    const { formApi } = renderCard();
    (props("CoverImagePicker").onChange as (v: string) => void)("https://cdn/x.jpg");
    expect(formApi.set).toHaveBeenCalledWith("cover_image_url", "https://cdn/x.jpg");
  });
});

describe("PostSettingsCard - brak formularza", () => {
  it("nie renderuje nic, dopóki wpis się nie wczytał", () => {
    const { container } = renderCard({ form: null });
    expect(container.textContent?.trim()).toBe("");
  });
});
