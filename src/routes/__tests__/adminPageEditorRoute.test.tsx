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
//
// Dołożone 16.10.2026 (naprawy w trasie):
//   4. PRZYWRÓCENIE REWIZJI WCZYTUJE WIERSZ OD NOWA. Serwer nadpisuje wiersz
//      i podbija `updated_at`; edytor pokazywał dalej treść sprzed
//      przywrócenia, a pierwsza edycja kończyła się fałszywym konfliktem.
//      Spóźniona odpowiedź zapisu sprzed przywrócenia nie może tej bazy cofnąć.
//   5. KOŃCOWY DYWIZ TO NIE KOLIZJA. Autozapis w trakcie pisania „o-nas-…”
//      wracał od serwera jako „o-nas” - edytor krzyczał „slug był zajęty”
//      i zjadał redaktorowi dywiz pod kursorem. Długi slug (81-120 znaków,
//      serwer tnie do 120) też nie jest kolizją.
//   6. BRAK WIERSZA MA KOMUNIKAT. Nieaktualny slug dawał wieczne „...”.
//   7. KOLEJNOŚĆ W MENU MIEŚCI SIĘ W SCHEMACIE SERWERA (liczba całkowita
//      0-99999) - inaczej walidacja odrzucała KAŻDY autozapis strony.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { AnyRoute } from "@tanstack/react-router";
import type { CodePageDef } from "@/lib/admin/codePages";

const h = vi.hoisted(() => ({
  routeSlug: "o-nas",
  row: null as Record<string, unknown> | null,
  rpcError: null as unknown,
  rpcCalls: [] as { name: string; args: unknown }[],
  updates: [] as Record<string, unknown>[],
  updateResult: { slug: "o-nas", updatedAt: "2026-08-02T10:00:00.000Z" } as Record<string, unknown>,
  updateError: null as unknown,
  /** Gdy ustawione - zapis czeka na tę obietnicę (odpowiedź serwera „w drodze”). */
  updateGate: null as Promise<void> | null,
  deletes: [] as unknown[],
  deleteError: null as unknown,
  navigations: [] as Record<string, unknown>[],
  routerInvalidations: 0,
  confirmAnswer: true,
  seoIssues: [] as { severity: string }[],
  staticHomepage: null as Record<string, unknown> | null,
  blocking: false,
  codePageOverride: undefined as CodePageDef | undefined,
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useNavigate: () => (opts: Record<string, unknown>) => h.navigations.push(opts),
  useRouter: () => ({
    invalidate: () => {
      h.routerInvalidations += 1;
    },
  }),
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
      const result = h.updateResult;
      if (h.updateGate) await h.updateGate;
      return result;
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
      return { maybeSingle: async () => ({ data: h.row, error: h.rpcError }) };
    },
  },
}));
// Rejestr stron z kodu jest prawdziwy; podmiana pozwala sprawdzić wpis BEZ
// własnych etykiet odnośnika „zarządzaj” (zapasowa etykieta ogólna).
vi.mock("@/lib/admin/codePages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin/codePages")>();
  return { ...actual, codePage: (slug: string) => h.codePageOverride ?? actual.codePage(slug) };
});
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
vi.mock("@/lib/seo/useStaticHomepage", () => ({
  useStaticHomepage: () => ({ staticHomepage: { data: h.staticHomepage } }),
}));
vi.mock("@/components/admin/seo/SeoPanel", () => ({
  SeoPanel: ({
    onIssuesChange,
    onChange,
    homepage,
  }: {
    onIssuesChange: (i: unknown[]) => void;
    onChange: (patch: Record<string, unknown>) => void;
    homepage?: boolean;
  }) => (
    <>
      <span data-testid="seo-homepage">{String(homepage === true)}</span>
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
    <>
      <button type="button" onClick={() => onChange("https://cdn.example/okladka.jpg")}>
        wybierz okładkę
      </button>
      <button type="button" onClick={() => onChange("")}>
        usuń okładkę
      </button>
    </>
  ),
}));

import "@/test/i18nReal";
import "@/lib/i18n-admin-extras";
// Słownik panelu `admin.*` (od 2026-10-17 poza rdzeniem języka) - w aplikacji
// rejestruje go `AdminSession`, a ten test montuje ekran bez niej.
import "@/lib/i18n-admin-core";
import i18n from "@/lib/i18n";
import { routeHead } from "@/test/routeHarness";
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
  h.staticHomepage = null;
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.routeSlug = "o-nas";
  h.rpcError = null;
  h.rpcCalls.length = 0;
  h.updates.length = 0;
  h.deletes.length = 0;
  h.navigations.length = 0;
  h.routerInvalidations = 0;
  h.updateError = null;
  h.updateGate = null;
  h.deleteError = null;
  h.confirmAnswer = true;
  h.blocking = false;
  h.seoIssues = [];
  h.codePageOverride = undefined;
  h.updateResult = { slug: "o-nas", updatedAt: "2026-08-02T10:00:00.000Z" };
  h.toast.success.mockReset();
  h.toast.error.mockReset();
  h.toast.warning.mockReset();
  h.toast.info.mockReset();
  vi.spyOn(Route, "useParams").mockReturnValue({ slug: h.routeSlug } as never);
});

afterEach(async () => {
  // Test angielskiego panelu przełącza WSPÓLNĄ instancję i18next.
  if (i18n.language !== "pl") await act(() => i18n.changeLanguage("pl"));
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

  it("zmiana sluga odświeża odczyt strony głównej, a zmiana samego tytułu - nie", async () => {
    // Strona główna bywa wskazana slugiem z ustawień - zapisany nowy slug
    // może zmienić, KTÓRA strona jest stroną główną (panel SEO, podgląd).
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const homepageInvalidations = () =>
      spy.mock.calls.filter(
        ([filters]) =>
          (filters as { queryKey?: unknown[] })?.queryKey?.[0] === "admin-seo-static-homepage",
      );
    await setup();
    fireEvent.change(titleField("PL"), { target: { value: "Zmiana" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.updates).toHaveLength(1));
    expect(homepageInvalidations()).toHaveLength(0);

    h.updateResult = { slug: "o-nas-2", updatedAt: "2026-08-03T10:00:00.000Z" };
    fireEvent.change(titleField("PL"), { target: { value: "Druga zmiana" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.updates).toHaveLength(2));
    await waitFor(() => expect(homepageInvalidations()).toHaveLength(1));
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
    expect(screen.getByTestId("seo-homepage").textContent).toBe("false");
  });

  it("STRONA GŁÓWNA: podgląd prowadzi pod `/`, a panel SEO dostaje tryb strony głównej", async () => {
    // Jej własny slug (`/main`) to 301 na `/`; panel ma pokazać to, co poda `/`.
    const row = pageRow({ slug: "main" });
    h.staticHomepage = { id: row.id, slug: "main", seo_title_pl: null, seo_title_en: null };
    await setup(row);
    expect(screen.getByRole("link", { name: /podgląd|preview/i })).toHaveAttribute("href", "/");
    expect(screen.getByTestId("seo-homepage").textContent).toBe("true");
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

  it("data z PRZYSZŁOŚCI zapowiada publikację automatyczną, bez ostrzeżeń", async () => {
    await setup(pageRow({ status: "scheduled", publish_at: "2099-01-01T10:00:00.000Z" }));
    expect(screen.getByText(/opublikuje się automatycznie|automatically/i)).toBeInTheDocument();
    expect(screen.queryByText(/przeszł|past/i)).toBeNull();
    expect(screen.queryByText(/wymaga daty|requires a publish date/i)).toBeNull();
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
    // Dokładnie ten moment ZEGARA ŚCIENNEGO redaktora (konstruktor lokalny),
    // nie 08:30 UTC - inaczej publikacja przesuwa się o strefę.
    expect(fields.publish_at).toBe(new Date(2026, 8, 2, 8, 30).toISOString());
  });

  it("pole daty pokazuje zapisany moment w LOKALNYM czasie redaktora", async () => {
    const iso = new Date(2026, 8, 1, 14, 5).toISOString();
    await setup(pageRow({ status: "scheduled", publish_at: iso }));
    const pole = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;

    expect(pole.value).toBe("2026-09-01T14:05");
  });

  it("wyczyszczona data zapisuje się jako PUSTKA i wraca ostrzeżenie o wymaganej dacie", async () => {
    await setup(pageRow({ status: "scheduled", publish_at: "2099-01-01T10:00:00.000Z" }));
    const pole = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    const fields = await zapiszPo(() => fireEvent.change(pole, { target: { value: "" } }));

    expect(fields.publish_at).toBeNull();
    expect(screen.getByText(/wymaga daty|requires a publish date/i)).toBeInTheDocument();
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

  it("okładka usunięta w slocie zapisuje się jako PUSTKA, nie pusty napis", async () => {
    // Pusty napis w `cover_image_url` daje `<img src="">` i og:image bez adresu.
    await setup(pageRow({ cover_image_url: "https://cdn.example/stara.jpg" }));
    const fields = await zapiszPo(() => fireEvent.click(screen.getByText("usuń okładkę")));

    expect(fields.cover_image_url).toBeNull();
  });

  it("wyczyszczona zajawka EN też zapisuje się jako pustka", async () => {
    await setup(pageRow({ excerpt_en: "Old excerpt" }));
    const opisy = screen.getAllByRole("textbox").filter((el) => el.tagName === "TEXTAREA");
    const fields = await zapiszPo(() => fireEvent.change(opisy[1], { target: { value: "   " } }));

    expect(fields.excerpt_en).toBeNull();
  });
});

describe("edytor strony - przywrócenie rewizji", () => {
  // Serwer (`restoreRevision`) nadpisuje wiersz i podbija `updated_at`.
  const przywrocony = () =>
    pageRow({ title_pl: "Wersja z rewizji", updated_at: "2026-08-05T10:00:00.000Z" });

  it("formularz pokazuje PRZYWRÓCONĄ treść, a nie wersję sprzed przywrócenia", async () => {
    await setup();
    h.row = przywrocony();
    fireEvent.click(screen.getByText("przywróć rewizję"));

    await waitFor(() => expect(titleField("PL").value).toBe("Wersja z rewizji"));
    // Wiersz czytany ponownie tą samą funkcją serwerową, a trasy odświeżone.
    expect(h.rpcCalls.filter((c) => c.name === "get_page_for_edit")).toHaveLength(2);
    expect(h.routerInvalidations).toBe(1);
  });

  it("następny zapis niesie `updated_at` PRZYWRÓCONEGO wiersza - bez fałszywego konfliktu", async () => {
    // Z bazą sprzed przywrócenia serwer odrzuca zapis jako EDIT_CONFLICT,
    // choć jedyną „cudzą” zmianą było przywrócenie samego redaktora.
    await setup();
    h.row = przywrocony();
    fireEvent.click(screen.getByText("przywróć rewizję"));
    await waitFor(() => expect(titleField("PL").value).toBe("Wersja z rewizji"));

    fireEvent.change(titleField("PL"), { target: { value: "Poprawka po przywróceniu" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.updates).toHaveLength(1));
    expect(lastUpdate().baseUpdatedAt).toBe("2026-08-05T10:00:00.000Z");
    expect(lastUpdate().fields.title_pl).toBe("Poprawka po przywróceniu");
  });

  it("przywrócony wiersz jest CZYSTĄ bazą: niezapisany szkic przepada, nic nie czeka na zapis", async () => {
    // Szkic sprzed przywrócenia nie może zostać „niezapisaną zmianą”, którą
    // autozapis za chwilę wpisałby na przywróconą wersję.
    await setup();
    fireEvent.change(titleField("PL"), { target: { value: "Niezapisany szkic" } });
    expect(
      await screen.findByRole("button", { name: /Anuluj zmiany|Discard changes/i }),
    ).toBeInTheDocument();

    h.row = przywrocony();
    fireEvent.click(screen.getByText("przywróć rewizję"));

    await waitFor(() => expect(titleField("PL").value).toBe("Wersja z rewizji"));
    expect(screen.queryByRole("button", { name: /Anuluj zmiany|Discard changes/i })).toBeNull();
    expect(h.updates).toHaveLength(0);
  });

  it("ODMOWA ponownego odczytu jest zgłoszona, a formularz zostaje nietknięty", async () => {
    // Błąd z RPC to zwykły obiekt PostgREST - toast nie może brzmieć
    // „[object Object]”, a formularz nie może się wyzerować.
    await setup();
    // Wyciszenie TYLKO na ten test - przeciek do kolejnych ukrywałby prawdziwe
    // błędy Reacta (vitest.config nie przywraca podsłuchów sam).
    const ciszaKonsoli = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      h.rpcError = { message: "Failed to fetch", code: "" };
      fireEvent.click(screen.getByText("przywróć rewizję"));

      await waitFor(() =>
        expect(h.toast.error).toHaveBeenCalledWith(
          "Problem z połączeniem. Sprawdź internet i spróbuj ponownie.",
        ),
      );
      expect(titleField("PL").value).toBe("O nas");
    } finally {
      ciszaKonsoli.mockRestore();
    }
  });

  it("SPÓŹNIONA odpowiedź zapisu sprzed przywrócenia nie cofa bazy blokady ani cache", async () => {
    // Zapis jest w drodze, redaktor przywraca rewizję, odpowiedź przychodzi
    // dopiero po ponownym odczycie. Jej `updated_at` jest STARSZY niż
    // przywrócenie - wpisany jako baza dawał fałszywy konflikt przy następnej
    // edycji, a wpisany do cache wracał po ponownym otwarciu edytora.
    let odpowiedz: () => void = () => undefined;
    h.updateGate = new Promise<void>((resolve) => {
      odpowiedz = resolve;
    });
    await setup();
    fireEvent.change(titleField("PL"), { target: { value: "Szkic w drodze" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.updates).toHaveLength(1));

    h.row = przywrocony();
    fireEvent.click(screen.getByText("przywróć rewizję"));
    await waitFor(() => expect(titleField("PL").value).toBe("Wersja z rewizji"));

    h.updateGate = null;
    odpowiedz();
    // Ręczny zapis domknięty (przycisk znów aktywny) = `saveFn` skończył.
    await waitFor(() => expect(saveButton()).not.toBeDisabled());
    expect(titleField("PL").value).toBe("Wersja z rewizji");
    expect(queryClient.getQueryData(["page-by-slug", "tenant-1", "o-nas"])).toMatchObject({
      title_pl: "Wersja z rewizji",
      updated_at: "2026-08-05T10:00:00.000Z",
    });

    fireEvent.change(titleField("PL"), { target: { value: "Poprawka po przywróceniu" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.updates).toHaveLength(2));
    expect(lastUpdate().baseUpdatedAt).toBe("2026-08-05T10:00:00.000Z");
  });
});

describe("edytor strony - nagłówek karty", () => {
  it("head() nazywa SEKCJĘ i trzyma panel poza indeksem", () => {
    // Ogólny tytuł „Admin” na kilkunastu kartach nie mówi, która to edycja.
    const { meta } = routeHead(Route as AnyRoute);

    expect(meta).toContainEqual({ title: "Page editor | New European Strategies" });
    expect(meta).toContainEqual({ name: "robots", content: "noindex, nofollow" });
  });
});

describe("edytor strony - wiersz, którego nie ma", () => {
  it("NIEAKTUALNY slug daje komunikat i drogę na listę zamiast wiecznego „...”", async () => {
    // Zakładka sprzed zmiany adresu albo strona w koszu: RPC zwraca pustkę.
    h.row = null;
    const Component = (Route as AnyRoute).options.component as () => ReactNode;
    render(<Component />, { wrapper });

    expect(await screen.findByRole("alert")).toHaveTextContent(/Nie udało się wczytać strony/);
    expect(screen.getByRole("link", { name: /Wstecz/ })).toHaveAttribute("href", "/admin/pages");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("BŁĄD odczytu też kończy się komunikatem, nie zawieszonym ekranem", async () => {
    h.row = pageRow();
    h.rpcError = { message: "permission denied", code: "42501" };
    const Component = (Route as AnyRoute).options.component as () => ReactNode;
    render(<Component />, { wrapper });

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^(Zapisz|Save)$/ })).toBeNull();
  });
});

describe("edytor strony - slug w trakcie pisania", () => {
  it("autozapis „o-nas-” (końcowy dywiz) to NIE kolizja: bez ostrzeżenia i bez zjadania dywizu", async () => {
    // Redaktor pisze „o-nas-nowa” i robi pauzę po dywizie. Serwer obcina
    // końcowy dywiz („o-nas”) - to normalizacja, nie zajęty adres.
    await setup();
    const slug = screen.getByLabelText(/^Slug/) as HTMLInputElement;
    fireEvent.change(slug, { target: { value: "o nas " } });
    expect(slug.value).toBe("o-nas-");

    // Prawdziwy autozapis po bezczynności (bez klikania „Zapisz”, które
    // zabrałoby fokus z pola).
    await waitFor(() => expect(h.updates).toHaveLength(1), { timeout: 4000 });
    expect(lastUpdate().fields.slug).toBe("o-nas-");
    await screen.findByText("Zapisano");

    expect(h.toast.warning).not.toHaveBeenCalled();
    expect(slug.value).toBe("o-nas-");
    expect(h.navigations).toHaveLength(0);
  });

  it("DŁUGI zapisany slug (81-120 znaków) to NIE kolizja: zapis samego tytułu nie ostrzega", async () => {
    // Serwer tnie slug do 120 znaków (`createPage` z długiego tytułu, import
    // WordPressa). Porównanie z normalizacją ucinającą do 80 brało każdy
    // zapis takiej strony za „slug zajęty” - choć pola nikt nie ruszał.
    const dlugi =
      "polityka-prywatnosci-i-zasady-przetwarzania-danych-osobowych-czlonkow-klubu-new-european-strategies";
    expect(dlugi.length).toBeGreaterThan(80);
    expect(dlugi.length).toBeLessThanOrEqual(120);
    h.routeSlug = dlugi;
    vi.spyOn(Route, "useParams").mockReturnValue({ slug: dlugi } as never);
    h.updateResult = { slug: dlugi, updatedAt: "2026-08-02T10:00:00.000Z" };
    await setup(pageRow({ slug: dlugi }));

    fireEvent.change(titleField("PL"), { target: { value: "Polityka prywatności" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith("Zapisano"));
    expect(lastUpdate().fields.slug).toBe(dlugi);
    expect(h.toast.warning).not.toHaveBeenCalled();
    expect((screen.getByLabelText(/^Slug/) as HTMLInputElement).value).toBe(dlugi);
    expect(h.navigations).toHaveLength(0);
  });

  it("PRAWDZIWA kolizja nadal ostrzega i przepisuje pole na zapisany slug", async () => {
    h.updateResult = { slug: "kontakt-2", updatedAt: "2026-08-02T10:00:00.000Z" };
    await setup();
    const slug = screen.getByLabelText(/^Slug/) as HTMLInputElement;
    fireEvent.change(slug, { target: { value: "kontakt" } });
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(h.toast.warning).toHaveBeenCalledWith('Slug był zajęty - zapisano jako "kontakt-2"'),
    );
    expect(slug.value).toBe("kontakt-2");
  });

  it("odpowiedź o kolizji NIE nadpisuje sluga, który redaktor zdążył dopisać", async () => {
    // Zapis „kontakt” jest w drodze, redaktor pisze dalej. Spóźniona
    // odpowiedź „kontakt-2” ostrzega, ale nie cofa pola - a dopisany slug
    // trafia do bazy następnym zapisem.
    let odpowiedz: () => void = () => undefined;
    h.updateGate = new Promise<void>((resolve) => {
      odpowiedz = resolve;
    });
    h.updateResult = { slug: "kontakt-2", updatedAt: "2026-08-02T10:00:00.000Z" };
    await setup();
    const slug = screen.getByLabelText(/^Slug/) as HTMLInputElement;
    fireEvent.change(slug, { target: { value: "kontakt" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.updates).toHaveLength(1));

    fireEvent.change(slug, { target: { value: "kontakt-nowy" } });
    h.updateGate = null;
    h.updateResult = { slug: "kontakt-nowy", updatedAt: "2026-08-03T10:00:00.000Z" };
    odpowiedz();

    await waitFor(() => expect(h.toast.warning).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(h.updates).toHaveLength(2));
    expect(lastUpdate().fields.slug).toBe("kontakt-nowy");
    expect(slug.value).toBe("kontakt-nowy");
  });
});

describe("edytor strony - kolejność w menu w zakresie schematu serwera", () => {
  async function zapiszKolejnosc(wpisane: string) {
    await setup();
    fireEvent.change(screen.getByLabelText(/Kolejność w menu/), { target: { value: wpisane } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.updates).toHaveLength(1));
    return lastUpdate().fields.menu_order;
  }

  it("pole deklaruje natywny zakres: liczby całkowite od zera", async () => {
    await setup();
    const pole = screen.getByLabelText(/Kolejność w menu/);
    expect(pole).toHaveAttribute("min", "0");
    expect(pole).toHaveAttribute("max", "99999");
    expect(pole).toHaveAttribute("step", "1");
  });

  it.each([
    ["-3", 0],
    ["2.7", 2],
    ["1000000", 99999],
    ["1e400", 99999],
  ])(
    "wpisane „%s” zapisuje się jako %i (serwer przyjmuje tylko int 0-99999)",
    async (wpisane, oczekiwane) => {
      // `-3` albo `2.7` odrzucała walidacja serwera - a z nią CAŁY autozapis.
      expect(await zapiszKolejnosc(wpisane)).toBe(oczekiwane);
    },
  );
});

describe("edytor strony - odpowiedź serwera po zapisie", () => {
  it("strona TESTOWA wymuszona na noindex: komunikat i przełącznik zgodny z bazą", async () => {
    // Serwer sam ustawia noindex stronom `test-*`; formularz z `false`
    // odesłałby przy następnym zapisie stan sprzeczny z bazą.
    h.updateResult = {
      slug: "o-nas",
      updatedAt: "2026-08-02T10:00:00.000Z",
      noindexForced: true,
    };
    await setup();
    fireEvent.change(titleField("PL"), { target: { value: "Zmiana" } });
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(h.toast.info).toHaveBeenCalledWith(expect.stringMatching(/strona testowa/i), {
        id: "test-page-noindex",
      }),
    );

    fireEvent.click(saveButton());
    await waitFor(() => expect(h.updates).toHaveLength(2));
    expect(lastUpdate().fields.seo_noindex).toBe(true);
  });

  it("odpowiedź BEZ `updatedAt` i sluga zostawia bazę blokady i adres bez zmian", async () => {
    // Wyzerowanie bazy dawałoby fałszywy konflikt, a „brak sluga” nie jest
    // powodem, żeby przenosić redaktora pod inny adres.
    h.updateResult = { ok: true };
    await setup();
    fireEvent.change(titleField("PL"), { target: { value: "Pierwsza" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.updates).toHaveLength(1));
    fireEvent.change(titleField("PL"), { target: { value: "Druga" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.updates).toHaveLength(2));

    expect(lastUpdate().baseUpdatedAt).toBe("2026-08-01T10:00:00.000Z");
    expect(h.navigations).toHaveLength(0);
    expect(h.toast.warning).not.toHaveBeenCalled();
  });

  it("wiersz BEZ `updated_at` nie wysyła bazy blokady (null odrzuciłby schemat)", async () => {
    await setup(pageRow({ updated_at: null }));
    fireEvent.change(titleField("PL"), { target: { value: "Zmiana" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.updates).toHaveLength(1));
    expect(lastUpdate()).not.toHaveProperty("baseUpdatedAt", null);
    expect(lastUpdate().baseUpdatedAt).toBeUndefined();
  });

  it("historyczny wiersz z NULL-ami wysyła puste listy i fałsz, nie null", async () => {
    // Schemat serwera przyjmuje tablicę wniosków i boolean noindex - null
    // w którymkolwiek z tych pól odrzucałby każdy zapis starej strony.
    await setup(
      pageRow({
        takeaways_pl: null,
        takeaways_en: null,
        takeaways_variant: undefined,
        toc_override: undefined,
        seo_noindex: null,
      }),
    );
    fireEvent.change(titleField("PL"), { target: { value: "Zmiana" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.updates).toHaveLength(1));
    expect(lastUpdate().fields).toMatchObject({
      takeaways_pl: [],
      takeaways_en: [],
      takeaways_variant: null,
      toc_override: null,
      seo_noindex: false,
    });
  });

  it("odrzucenie zapisu bez obiektu Error nadal pokazuje jego treść", async () => {
    h.updateError = "Rate limit exceeded - please slow down";
    await setup();
    fireEvent.change(titleField("PL"), { target: { value: "Zmiana" } });
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(h.toast.error).toHaveBeenCalledWith("Rate limit exceeded - please slow down"),
    );
    expect(h.toast.success).not.toHaveBeenCalled();
  });

  it("odrzucenie usunięcia bez obiektu Error nadal pokazuje jego treść", async () => {
    h.deleteError = "Save rejected";
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /^(Usuń|Delete)$/ }));

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("Save rejected"));
    expect(h.navigations).toHaveLength(0);
  });
});

describe("edytor strony - okruszki i skróty", () => {
  it.each([
    [{ title_pl: "", title_en: "About us" }, "About us"],
    [{ title_pl: "", title_en: "", slug: "o-nas" }, "o-nas"],
  ])("okruszek nazywa stronę zapasowo (%o -> %s)", async (overrides, oczekiwane) => {
    // Strona bez polskiego tytułu nie może wisieć w okruszkach jako pustka.
    await setup(pageRow(overrides));
    const okruszek = screen
      .getAllByRole("link", { current: "page" })
      .find((el) => el.textContent === oczekiwane);
    expect(okruszek).toBeTruthy();
  });

  it("strona bez tytułów i z wyczyszczonym slugiem jest „bez tytułu”, nie pustką", async () => {
    await setup(pageRow({ title_pl: "", title_en: "" }));
    fireEvent.change(screen.getByLabelText(/^Slug/), { target: { value: "" } });

    expect(screen.getAllByRole("link", { current: "page" }).map((el) => el.textContent)).toContain(
      "bez tytułu",
    );
  });

  it("zwykłe skróty z Ctrl (np. Ctrl+C) NIE są przechwytywane przez historię", async () => {
    // `preventDefault` na Ctrl+C zabrałby redaktorowi kopiowanie.
    await setup();
    fireEvent.change(titleField("PL"), { target: { value: "Zmieniony" } });

    expect(fireEvent.keyDown(window, { key: "c", ctrlKey: true })).toBe(true);
    expect(titleField("PL").value).toBe("Zmieniony");
  });
});

describe("edytor strony - odnośnik „zarządzaj” strony z kodu", () => {
  it("polski panel pokazuje etykietę PL z rejestru i adres zarządzania", async () => {
    vi.spyOn(Route, "useParams").mockReturnValue({ slug: "club" } as never);
    await setup(pageRow({ slug: "club" }));

    expect(
      screen.getByRole("link", { name: "Zarządzaj klubami: Kluby dyskusyjne" }),
    ).toHaveAttribute("href", "/admin/community/clubs");
  });

  it("angielski panel pokazuje etykietę EN z rejestru", async () => {
    await act(() => i18n.changeLanguage("en"));
    vi.spyOn(Route, "useParams").mockReturnValue({ slug: "club" } as never);
    await setup(pageRow({ slug: "club" }));

    expect(
      screen.getByRole("link", { name: "Manage clubs: Discussion clubs" }),
    ).toBeInTheDocument();
  });

  it.each([
    ["pl", "Zarządzaj treścią"],
    ["en", "Manage content"],
  ])("wpis BEZ własnych etykiet dostaje ogólną (%s: „%s”)", async (lang, oczekiwane) => {
    if (lang === "en") await act(() => i18n.changeLanguage("en"));
    h.codePageOverride = {
      slug: "o-nas",
      path: "/o-nas",
      label_pl: "O nas",
      label_en: "About",
      manage_path: "/admin/settings",
    };
    await setup();

    expect(screen.getByRole("link", { name: oczekiwane })).toHaveAttribute(
      "href",
      "/admin/settings",
    );
  });
});
