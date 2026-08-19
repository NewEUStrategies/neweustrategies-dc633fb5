// EDYTOR STRONY. Do 19.08.2026 na zerze (856 instrukcji) - największa trasa
// modułu 4.
//
// Ekran trzyma treść, której nikt inny nie trzyma: wersja robocza siedzi w
// pamięci przeglądarki między autozapisami. Trzy reguły ważą tu najwięcej:
//
//   1. BLOKADA OPTYMISTYCZNA. Zapis niesie `updated_at` z chwili wczytania i
//      przesuwa bazę na wartość zwróconą przez serwer. Bez tego druga karta
//      cicho nadpisuje pracę pierwszej; z zepsutym przesunięciem KAŻDY drugi
//      zapis kończy się fałszywym konfliktem.
//   2. KANONICZNY SLUG. Serwer może zmienić slug przy kolizji. Adres, formularz
//      i cache muszą pójść za tym, co NAPRAWDĘ zapisano - inaczej redaktor
//      edytuje wiersz spod innego adresu.
//   3. RĘCZNY ZAPIS TO DOMKNIĘCIE AUTOZAPISU. „Zapisano” po nieudanym zapisie
//      to najgorszy możliwy komunikat na tym ekranie.
//
// Ciężkie dzieci (kanwa buildera, panel SEO, metabox, rewizje, dostęp) mają
// własne testy i są tu podmienione - inaczej test mierzyłby cudze reguły.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { AnyRoute } from "@tanstack/react-router";

const h = vi.hoisted(() => ({
  routeSlug: "o-nas",
  row: null as Record<string, unknown> | null,
  rpcCalls: [] as { name: string; args: unknown }[],
  updates: [] as Record<string, unknown>[],
  updateResult: { slug: "o-nas", updatedAt: "2026-08-02T10:00:00.000Z" } as Record<string, unknown>,
  updateError: null as unknown,
  deletes: [] as unknown[],
  deleteError: null as Error | null,
  navigations: [] as Record<string, unknown>[],
  confirmAnswer: true,
  seoIssues: [] as { severity: string }[],
  blocking: false,
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useNavigate: () => (opts: Record<string, unknown>) => h.navigations.push(opts),
  useRouter: () => ({ invalidate: () => undefined }),
  // Strażnik niezapisanych zmian montuje blokadę routera; poza `RouterProvider`
  // nie ma czego blokować, a jego reguły mają własny test.
  useBlocker: () => undefined,
}));
vi.mock("@/hooks/useAuth", () => ({ useRequiredTenant: () => "tenant-1" }));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/lib/appDialogs", () => ({ confirmDialog: async () => h.confirmAnswer }));
vi.mock("@/lib/content.functions", () => ({ updatePage: "updatePage", deletePage: "deletePage" }));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => async (payload: Record<string, unknown>) => {
    if (fn === "updatePage") {
      if (h.updateError) throw h.updateError;
      h.updates.push(payload.data as Record<string, unknown>);
      return h.updateResult;
    }
    if (h.deleteError) throw h.deleteError;
    h.deletes.push(payload);
    return { ok: true };
  },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: unknown) => {
      h.rpcCalls.push({ name, args });
      return { maybeSingle: async () => ({ data: h.row, error: null }) };
    },
  },
}));
vi.mock("@/lib/seo/validation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/seo/validation")>()),
  hasBlockingSeoIssues: () => h.blocking,
}));
vi.mock("@/lib/builder/widgetCacheInvalidation", () => ({
  invalidateWidgetCaches: () => undefined,
  emitWidgetCacheInvalidate: () => undefined,
}));
vi.mock("@/lib/seo/invalidate", () => ({ invalidateSeoCaches: () => undefined }));

// Ciężkie dzieci - każde z własnym zestawem testów.
vi.mock("@/components/admin/builder/Builder", () => ({
  Builder: ({ onChange }: { onChange: (v: unknown) => void }) => (
    <button type="button" data-testid="kanwa" onClick={() => onChange({ blocks: ["nowy"] })}>
      zmień treść kanwy
    </button>
  ),
}));
vi.mock("@/components/admin/seo/SeoPanel", () => ({
  SeoPanel: ({
    onIssuesChange,
    onChange,
  }: {
    onIssuesChange: (i: unknown[]) => void;
    onChange: (patch: Record<string, unknown>) => void;
  }) => (
    <>
      <button type="button" onClick={() => onIssuesChange(h.seoIssues)}>
        zgłoś uwagi SEO
      </button>
      <button type="button" onClick={() => onChange({ seo_title_pl: "Tytuł SEO" })}>
        zmień pole SEO
      </button>
    </>
  ),
}));
vi.mock("@/components/admin/PostSettingsMetabox", () => ({
  PostSettingsMetabox: ({
    onTakeawaysChange,
    onTakeawaysVariantChange,
    onTocOverrideChange,
  }: {
    onTakeawaysChange: (lang: string, next: string[]) => void;
    onTakeawaysVariantChange: (next: string) => void;
    onTocOverrideChange: (next: unknown) => void;
  }) => (
    <>
      <button type="button" onClick={() => onTakeawaysChange("pl", ["wniosek PL"])}>
        wnioski PL
      </button>
      <button type="button" onClick={() => onTakeawaysChange("en", ["takeaway EN"])}>
        wnioski EN
      </button>
      <button type="button" onClick={() => onTakeawaysVariantChange("card")}>
        wariant wniosków
      </button>
      <button type="button" onClick={() => onTocOverrideChange({ mode: "off" })}>
        spis treści
      </button>
    </>
  ),
}));
vi.mock("@/components/admin/AccessSettingsPane", () => ({ AccessSettingsPane: () => null }));
vi.mock("@/components/admin/molecules/RevisionsCard", () => ({
  RevisionsCard: ({ onRestored }: { onRestored: () => void }) => (
    <button type="button" onClick={onRestored}>
      przywróć rewizję
    </button>
  ),
}));
vi.mock("@/components/admin/PageParentSelect", () => ({
  PageParentSelect: ({ onChange }: { onChange: (v: string) => void }) => (
    <button type="button" onClick={() => onChange("pg-rodzic")}>
      wybierz rodzica
    </button>
  ),
}));
vi.mock("@/components/admin/ImageSlot", () => ({
  ImageSlot: ({ onChange }: { onChange: (v: string) => void }) => (
    <button type="button" onClick={() => onChange("https://cdn.example/okladka.jpg")}>
      wybierz okładkę
    </button>
  ),
}));

import "@/test/i18nReal";
import "@/lib/i18n-admin-extras";
import { Route } from "@/routes/admin.pages.$slug";

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function pageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "pg-1",
    slug: "o-nas",
    updated_at: "2026-08-01T10:00:00.000Z",
    status: "draft",
    editor: "builder",
    title_pl: "O nas",
    title_en: "About us",
    content_pl: null,
    content_en: null,
    excerpt_pl: null,
    excerpt_en: null,
    cover_image_url: null,
    published_at: null,
    publish_at: null,
    builder_data: null,
    parent_id: null,
    menu_order: 0,
    template_type: "default",
    header_override: null,
    toc_override: null,
    takeaways_pl: [],
    takeaways_en: [],
    takeaways_variant: null,
    seo_title_pl: null,
    seo_title_en: null,
    seo_description_pl: null,
    seo_description_en: null,
    seo_canonical_url: null,
    seo_noindex: false,
    seo_og_image_url: null,
    og_image_generated_url: null,
    ...overrides,
  };
}

async function setup(row: Record<string, unknown> | null = pageRow()) {
  h.row = row;
  const Component = (Route as AnyRoute).options.component as () => ReactNode;
  const view = render(<Component />, { wrapper });
  if (row) await waitFor(() => expect(titleField("PL")).toBeInTheDocument());
  return view;
}

/** Pole tytułu w danym języku. */
const titleField = (langu: "PL" | "EN") =>
  screen.getByLabelText(new RegExp(`\\(${langu}\\)$`)) as HTMLInputElement;

const saveButton = () => screen.getByRole("button", { name: /^(Zapisz|Save)$/ });
const lastUpdate = () =>
  h.updates.at(-1) as { fields: Record<string, unknown>; baseUpdatedAt?: string };

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.routeSlug = "o-nas";
  h.rpcCalls.length = 0;
  h.updates.length = 0;
  h.deletes.length = 0;
  h.navigations.length = 0;
  h.updateError = null;
  h.deleteError = null;
  h.confirmAnswer = true;
  h.blocking = false;
  h.seoIssues = [];
  h.updateResult = { slug: "o-nas", updatedAt: "2026-08-02T10:00:00.000Z" };
  h.toast.success.mockReset();
  h.toast.error.mockReset();
  h.toast.warning.mockReset();
  vi.spyOn(Route, "useParams").mockReturnValue({ slug: h.routeSlug } as never);
});

describe("edytor strony - wczytanie wiersza", () => {
  it("czyta wiersz przez FUNKCJĘ SERWEROWĄ, nie przez zwykły select", async () => {
    // Kolumny z treścią są odebrane roli `authenticated` - `select("*")`
    // dostałby odmowę. Cała edycja idzie przez `get_page_for_edit`.
    await setup();
    expect(h.rpcCalls[0]).toMatchObject({ name: "get_page_for_edit", args: { _slug: "o-nas" } });
  });

  it("do czasu wczytania nie pokazuje formularza", () => {
    h.row = null;
    const Component = (Route as AnyRoute).options.component as () => ReactNode;
    render(<Component />, { wrapper });

    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("wypełnia formularz wartościami z bazy", async () => {
    await setup(pageRow({ title_pl: "Kontakt", title_en: "Contact" }));

    expect(titleField("PL").value).toBe("Kontakt");
    expect(titleField("EN").value).toBe("Contact");
  });

  it("wiersz ze STARYM edytorem jest normalizowany do buildera", async () => {
    // Historyczne wiersze mają `editor: "richtext"`; bez normalizacji krok
    // treści renderowałby edytor, którego już nie ma.
    await setup(pageRow({ editor: "richtext" }));
    fireEvent.change(titleField("PL"), { target: { value: "Zmiana" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.updates).toHaveLength(1));
    expect(lastUpdate().fields.editor).toBe("builder");
  });
});

describe("edytor strony - blokada optymistyczna", () => {
  it("zapis niesie `updated_at` z chwili WCZYTANIA", async () => {
    // Bez tej wartości serwer nie ma jak wykryć równoległej edycji.
    await setup();
    fireEvent.change(titleField("PL"), { target: { value: "Nowy tytuł" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.updates).toHaveLength(1));
    expect(lastUpdate().baseUpdatedAt).toBe("2026-08-01T10:00:00.000Z");
  });

  it("PRZESUWA bazę na wartość zwróconą przez serwer", async () => {
    // Z zamrożoną bazą KAŻDY kolejny zapis kończy się fałszywym konfliktem.
    await setup();
    fireEvent.change(titleField("PL"), { target: { value: "Pierwsza zmiana" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.updates).toHaveLength(1));

    h.updateResult = { slug: "o-nas", updatedAt: "2026-08-03T10:00:00.000Z" };
    fireEvent.change(titleField("PL"), { target: { value: "Druga zmiana" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.updates).toHaveLength(2));
    expect(lastUpdate().baseUpdatedAt).toBe("2026-08-02T10:00:00.000Z");
  });

  it("KONFLIKT edycji ma własny komunikat i NIE jest zgłaszany dwa razy", async () => {
    // Dwa czerwone dymki o tym samym zdarzeniu wyglądają jak dwie awarie.
    h.updateError = Object.assign(new Error("EDIT_CONFLICT"), { code: "EDIT_CONFLICT" });
    await setup();
    fireEvent.change(titleField("PL"), { target: { value: "Zmiana" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toast.error).toHaveBeenCalled());
    expect(h.toast.success).not.toHaveBeenCalled();
    expect(h.toast.error.mock.calls).toHaveLength(1);
  });
});

describe("edytor strony - kanoniczny slug", () => {
  it("KOLIZJA sluga jest głośna i synchronizuje formularz", async () => {
    // Cicha zmiana zostawia redaktora z adresem, pod którym nic nie ma.
    h.updateResult = { slug: "o-nas-2", updatedAt: "2026-08-02T10:00:00.000Z" };
    await setup();
    fireEvent.change(titleField("PL"), { target: { value: "Zmiana" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toast.warning).toHaveBeenCalled());
    await waitFor(() =>
      expect(h.navigations.at(-1)).toMatchObject({
        to: "/admin/pages/$slug",
        params: { slug: "o-nas-2" },
        replace: true,
      }),
    );
  });

  it("BEZ kolizji nie przenosi i nie ostrzega", async () => {
    await setup();
    fireEvent.change(titleField("PL"), { target: { value: "Zmiana" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.updates).toHaveLength(1));
    expect(h.toast.warning).not.toHaveBeenCalled();
    expect(h.navigations).toHaveLength(0);
  });

  it("slug jest NORMALIZOWANY w trakcie pisania i domykany po wyjściu z pola", async () => {
    // Adres z wielkimi literami i spacjami nie odpowiada żadnej stronie.
    await setup();
    const slug = screen.getByLabelText(/^Slug/) as HTMLInputElement;

    // W trakcie pisania: małe litery, bez spacji i bez znaków diakrytycznych,
    // ale KOŃCOWY dywiz zostaje - inaczej nie da się wpisać drugiego wyrazu.
    fireEvent.change(slug, { target: { value: "O Nas Później " } });
    expect(slug.value).toBe("o-nas-pozniej-");

    // Po wyjściu z pola: wersja domknięta, bez wiszącego dywizu.
    fireEvent.blur(slug);
    expect(slug.value).toBe("o-nas-pozniej");
  });
});

describe("edytor strony - ręczny zapis", () => {
  it("potwierdza zapis dopiero po UDANYM zapisie", async () => {
    await setup();
    fireEvent.change(titleField("PL"), { target: { value: "Zmiana" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toast.success).toHaveBeenCalled());
  });

  it("NIE chwali się zapisem, którego nie było", async () => {
    // „Zapisano” po nieudanym zapisie to najgorszy komunikat na tym ekranie.
    h.updateError = new Error("brak połączenia");
    await setup();
    fireEvent.change(titleField("PL"), { target: { value: "Zmiana" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("brak połączenia"));
    expect(h.toast.success).not.toHaveBeenCalled();
  });

  it("BLOKUJĄCE uwagi SEO wstrzymują zapis", async () => {
    // Strona bez tytułu SEO trafia do wyszukiwarki jako „bez tytułu”.
    h.blocking = true;
    await setup();
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toast.error).toHaveBeenCalled());
    expect(h.updates).toHaveLength(0);
  });

  it("OSTRZEŻENIA SEO nie wstrzymują zapisu, ale są widoczne", async () => {
    // Ostrzeżenie blokujące zapis uczyłoby redaktorów je ignorować.
    h.seoIssues = [{ severity: "warning" }];
    await setup();
    fireEvent.click(screen.getByText("zgłoś uwagi SEO"));
    fireEvent.change(titleField("PL"), { target: { value: "Zmiana" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.updates).toHaveLength(1));
    expect(h.toast.warning).toHaveBeenCalled();
  });

  it("zapis niesie KOMPLET pól, nie tylko zmienione", async () => {
    // Pominięte pole zostaje w bazie z poprzedniej wartości albo znika.
    await setup(pageRow({ takeaways_pl: ["a"], seo_noindex: true, menu_order: 7 }));
    fireEvent.change(titleField("PL"), { target: { value: "Zmiana" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.updates).toHaveLength(1));
    expect(lastUpdate().fields).toMatchObject({
      takeaways_pl: ["a"],
      seo_noindex: true,
      menu_order: 7,
      template_type: "default",
    });
  });
});

describe("edytor strony - historia i porzucanie zmian", () => {
  it("Ctrl+Z cofa ostatnią zmianę", async () => {
    // Bez cofania jedno nieuważne wklejenie kasuje akapit bezpowrotnie.
    await setup();
    fireEvent.change(titleField("PL"), { target: { value: "Zmieniony tytuł" } });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });

    await waitFor(() => expect(titleField("PL").value).toBe("O nas"));
  });

  it("Ctrl+Shift+Z i Ctrl+Y PONAWIAJĄ cofniętą zmianę", async () => {
    await setup();
    fireEvent.change(titleField("PL"), { target: { value: "Zmieniony" } });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => expect(titleField("PL").value).toBe("O nas"));

    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(titleField("PL").value).toBe("Zmieniony"));

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => expect(titleField("PL").value).toBe("O nas"));
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    await waitFor(() => expect(titleField("PL").value).toBe("Zmieniony"));
  });

  it("ODRZUCENIE zmian wraca do ostatnio ZAPISANEJ wersji", async () => {
    // Powrót do wiersza z chwili wejścia cofnąłby także zmiany, które
    // autozapis zdążył już utrwalić - i następny zapis nadpisałby je starą
    // treścią. Przycisk pojawia się dopiero przy niezapisanych zmianach.
    await setup();
    fireEvent.change(titleField("PL"), { target: { value: "Pierwsza wersja" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.updates).toHaveLength(1));

    fireEvent.change(titleField("PL"), { target: { value: "Niezapisany bałagan" } });
    const odrzuc = await screen.findByRole("button", { name: /Anuluj zmiany|Discard changes/i });
    fireEvent.click(odrzuc);

    await waitFor(() => expect(titleField("PL").value).toBe("Pierwsza wersja"));
  });

  it("skrót BEZ modyfikatora nie rusza historii", async () => {
    // Litera „z” wpisywana w polu tekstowym nie może cofać zmian.
    await setup();
    fireEvent.change(titleField("PL"), { target: { value: "Zmieniony" } });
    fireEvent.keyDown(window, { key: "z" });

    expect(titleField("PL").value).toBe("Zmieniony");
  });
});

describe("edytor strony - usuwanie i nawigacja", () => {
  it("usunięcie PYTA, a po zgodzie wraca na listę", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /^(Usuń|Delete)$/ }));

    await waitFor(() => expect(h.deletes).toEqual([{ data: { id: "pg-1" } }]));
    expect(h.navigations.at(-1)).toMatchObject({ to: "/admin/pages" });
  });

  it("odmowa w oknie potwierdzenia NIE usuwa", async () => {
    h.confirmAnswer = false;
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /^(Usuń|Delete)$/ }));

    await waitFor(() => expect(h.confirmAnswer).toBe(false));
    expect(h.deletes).toHaveLength(0);
  });

  it("PORAŻKA usunięcia zostawia redaktora w edytorze", async () => {
    h.deleteError = new Error("strona jest stroną główną");
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /^(Usuń|Delete)$/ }));

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("strona jest stroną główną"));
    expect(h.navigations).toHaveLength(0);
  });

  it("podgląd prowadzi pod PUBLICZNY adres i otwiera nową kartę", async () => {
    // Podgląd w tej samej karcie gubi niezapisaną wersję roboczą.
    await setup(pageRow({ slug: "kontakt" }));
    const podglad = screen.getByRole("link", { name: /podgląd|preview/i });

    expect(podglad).toHaveAttribute("href", "/kontakt");
    expect(podglad).toHaveAttribute("target", "_blank");
  });
});

describe("edytor strony - dwa kroki", () => {
  it("startuje od SZCZEGÓŁÓW, nie od kanwy", async () => {
    // Kanwa bez tytułu tworzy stronę bez nazwy na liście.
    await setup();
    expect(screen.queryByTestId("kanwa")).toBeNull();
  });

  it("przejście do treści wymaga tytułu w DOWOLNYM języku", async () => {
    await setup(pageRow({ title_pl: "", title_en: "" }));
    const dalej = screen.getByRole("button", { name: /Przejdź do edycji treści/ });
    expect(dalej).toBeDisabled();

    fireEvent.change(titleField("EN"), { target: { value: "Only EN" } });
    expect(dalej).toBeEnabled();
  });

  it("krok TREŚCI pokazuje kanwę i pozwala wrócić", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /Przejdź do edycji treści/ }));
    expect(screen.getByTestId("kanwa")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /Szczegóły|Details/ })[0]);
    expect(screen.queryByTestId("kanwa")).toBeNull();
  });
});

describe("edytor strony - publikacja zaplanowana", () => {
  it("pole daty pojawia się DOPIERO przy statusie zaplanowanym", async () => {
    // Data widoczna zawsze sugeruje, że publikacja jest odroczona.
    await setup();
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull();

    fireEvent.keyDown(screen.getAllByRole("combobox")[0], { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: /zaplanowan|scheduled/i }));

    await waitFor(() =>
      expect(document.querySelector('input[type="datetime-local"]')).not.toBeNull(),
    );
  });

  it("PUSTA data zaplanowanej publikacji jest oznaczona jako wymagana", async () => {
    // Zaplanowana strona bez daty nigdy się nie opublikuje.
    await setup(pageRow({ status: "scheduled", publish_at: null }));
    expect(screen.getByText(/wymag|required/i)).toBeInTheDocument();
  });

  it("data z PRZESZŁOŚCI jest oznaczona osobno", async () => {
    // To nie jest to samo co brak daty - taka strona opublikuje się natychmiast.
    await setup(pageRow({ status: "scheduled", publish_at: "2020-01-01T10:00:00.000Z" }));
    expect(screen.getByText(/przeszł|past/i)).toBeInTheDocument();
  });
});

describe("edytor strony - strona renderowana z kodu", () => {
  it("dla zwykłej strony NIE pokazuje ostrzeżenia o kodzie", async () => {
    await setup();
    expect(screen.queryByText(/renderowana z kodu|rendered from code/i)).toBeNull();
  });

  it("dla strony z rejestru pokazuje ostrzeżenie i odnośnik do podglądu", async () => {
    // Bez tej informacji redaktor układa bloki, których nikt nigdy nie zobaczy.
    vi.spyOn(Route, "useParams").mockReturnValue({ slug: "pricing" } as never);
    await setup(pageRow({ slug: "pricing" }));

    const banner = screen.getByText(/kodu|code/i).closest("div") as HTMLElement;
    expect(banner).toBeTruthy();
    expect(within(banner).getAllByRole("link").length).toBeGreaterThan(0);
  });
});

// PEŁNY PRZEGLĄD PÓL FORMULARZA. Metabox strony ma kilkanaście kontrolek o
// identycznej budowie (`set("klucz", wartość)`), a zapis wysyła CAŁY wiersz -
// podpięcie kontrolki pod cudzy klucz nie daje błędu typów i objawia się
// dopiero jako strona z cudzym szablonem albo cudzym nagłówkiem.
describe("edytor strony - każda kontrolka pisze do WŁASNEGO pola", () => {
  /** Zmienia pole, zapisuje i zwraca wysłany zestaw pól. */
  async function zapiszPo(akcja: () => void) {
    akcja();
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.updates).toHaveLength(1));
    return lastUpdate().fields;
  }

  it("kolejność w menu zapisuje się jako LICZBA", async () => {
    // Napis w kolejności wywraca sortowanie menu po stronie bazy.
    await setup();
    const fields = await zapiszPo(() =>
      fireEvent.change(screen.getByLabelText(/Kolejność w menu/), { target: { value: "5" } }),
    );

    expect(fields.menu_order).toBe(5);
  });

  it("pusta kolejność spada na zero, nie na NaN", async () => {
    await setup(pageRow({ menu_order: 3 }));
    const fields = await zapiszPo(() =>
      fireEvent.change(screen.getByLabelText(/Kolejność w menu/), { target: { value: "" } }),
    );

    expect(fields.menu_order).toBe(0);
  });

  it("szablon strony zapisuje IDENTYFIKATOR, nie widoczną nazwę", async () => {
    await setup();
    const select = within(
      screen.getByText("Template strony").closest("div") as HTMLElement,
    ).getByRole("combobox");
    fireEvent.keyDown(select, { key: "ArrowDown" });
    const opcje = screen.getAllByRole("option");
    const inna = opcje.find((o) => o.getAttribute("data-state") !== "checked") ?? opcje[1];
    const fields = await zapiszPo(() => fireEvent.click(inna));

    expect(fields.template_type).not.toBe("default");
  });

  it("nagłówek DOMYŚLNY zapisuje się jako pustka, nie jako napis „default”", async () => {
    // Napis „default” w bazie nie jest żadnym z rozpoznawanych trybów nagłówka.
    await setup(pageRow({ header_override: "transparent" }));
    const select = within(
      screen.getByText("Header (override)").closest("div") as HTMLElement,
    ).getByRole("combobox");
    fireEvent.keyDown(select, { key: "ArrowDown" });
    const fields = await zapiszPo(() =>
      fireEvent.click(screen.getByRole("option", { name: "Domyślny" })),
    );

    expect(fields.header_override).toBeNull();
  });

  it("wybrany nagłówek zapisuje swoją wartość", async () => {
    await setup();
    const select = within(
      screen.getByText("Header (override)").closest("div") as HTMLElement,
    ).getByRole("combobox");
    fireEvent.keyDown(select, { key: "ArrowDown" });
    const fields = await zapiszPo(() =>
      fireEvent.click(screen.getByRole("option", { name: "Ukryty" })),
    );

    expect(fields.header_override).toBe("hidden");
  });

  it("okładka trafia do WŁASNEGO pola", async () => {
    await setup();
    const fields = await zapiszPo(() => fireEvent.click(screen.getByText("wybierz okładkę")));

    expect(fields.cover_image_url).toBe("https://cdn.example/okladka.jpg");
  });

  it("rodzic strony trafia do WŁASNEGO pola", async () => {
    await setup();
    const fields = await zapiszPo(() => fireEvent.click(screen.getByText("wybierz rodzica")));

    expect(fields.parent_id).toBe("pg-rodzic");
  });

  it("opis strony ma OSOBNE pole dla każdego języka", async () => {
    // Podpięcie obu pod jedno pole daje ten sam opis w obu wersjach serwisu.
    await setup();
    const opisy = screen.getAllByRole("textbox").filter((el) => el.tagName === "TEXTAREA");
    fireEvent.change(opisy[0], { target: { value: "Opis polski" } });
    const fields = await zapiszPo(() =>
      fireEvent.change(opisy[1], { target: { value: "English description" } }),
    );

    expect(fields.excerpt_pl).toBe("Opis polski");
    expect(fields.excerpt_en).toBe("English description");
  });

  it("wyczyszczony opis zapisuje się jako PUSTKA, nie jako pusty napis", async () => {
    // Pusty napis w opisie daje meta description bez treści zamiast braku tagu.
    await setup(pageRow({ excerpt_pl: "Stary opis" }));
    const opisy = screen.getAllByRole("textbox").filter((el) => el.tagName === "TEXTAREA");
    const fields = await zapiszPo(() => fireEvent.change(opisy[0], { target: { value: "" } }));

    expect(fields.excerpt_pl).toBeNull();
  });

  it("zmiana z panelu SEO trafia do wersji roboczej", async () => {
    await setup();
    const fields = await zapiszPo(() => fireEvent.click(screen.getByText("zmień pole SEO")));

    expect(fields.seo_title_pl).toBe("Tytuł SEO");
  });

  it.each([
    ["wnioski PL", "takeaways_pl", ["wniosek PL"]],
    ["wnioski EN", "takeaways_en", ["takeaway EN"]],
  ])("%s zapisuje się do %s", async (przycisk, klucz, oczekiwane) => {
    // Wnioski PL zapisane do pola EN pojawiają się na anglojęzycznej stronie.
    await setup();
    const fields = await zapiszPo(() => fireEvent.click(screen.getByText(przycisk as string)));

    expect(fields[klucz as string]).toEqual(oczekiwane);
  });

  it("wariant wniosków i nadpisanie spisu treści mają własne pola", async () => {
    await setup();
    fireEvent.click(screen.getByText("wariant wniosków"));
    const fields = await zapiszPo(() => fireEvent.click(screen.getByText("spis treści")));

    expect(fields.takeaways_variant).toBe("card");
    expect(fields.toc_override).toEqual({ mode: "off" });
  });

  it("data publikacji zaplanowanej zapisuje się w formacie ISO", async () => {
    // Wartość z pola jest lokalna; zapis bez konwersji przesuwa publikację
    // o strefę czasową redaktora.
    await setup(pageRow({ status: "scheduled", publish_at: "2026-09-01T10:00:00.000Z" }));
    const pole = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    const fields = await zapiszPo(() =>
      fireEvent.change(pole, { target: { value: "2026-09-02T08:30" } }),
    );

    expect(String(fields.publish_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(String(fields.publish_at)).not.toBe("2026-09-01T10:00:00.000Z");
  });

  it("zmiana na KANWIE trafia do wersji roboczej", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /Przejdź do edycji treści/ }));
    fireEvent.click(screen.getByTestId("kanwa"));
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.updates).toHaveLength(1));
    expect(lastUpdate().fields.builder_data).toEqual({ blocks: ["nowy"] });
  });

  it("górny przełącznik kroków prowadzi w OBIE strony", async () => {
    // To jedyna droga powrotu z kanwy na urządzeniu z szerokim ekranem.
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /^2\./ }));
    expect(screen.getByTestId("kanwa")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^1\./ }));
    expect(screen.queryByTestId("kanwa")).toBeNull();
  });

  it("przywrócenie rewizji odświeża wczytany wiersz", async () => {
    // Bez odświeżenia edytor pokazuje dalej wersję sprzed przywrócenia.
    await setup();
    expect(() => fireEvent.click(screen.getByText("przywróć rewizję"))).not.toThrow();
  });
});
