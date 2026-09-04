// POWIERZCHNIA ZAKŁADKI MODUŁOWEJ: wstęp redagowany w studiu, a pod nim dane
// z bazy. Plik nie miał dotąd ANI JEDNEGO testu, a rozstrzyga trzy rzeczy,
// których nie widać, dopóki nie są zepsute.
//
// 1. CZY REDAKTOR WIDZI TO, CO UCZESTNIK. Pięć podstron modułowych to
//    PRAWDZIWE strony w tabeli `pages`, przypięte przez `event_pages.module`.
//    Zakładka rysująca własny nagłówek wpisany w kod robiłaby ze studia edytor
//    tekstu, którego nikt nigdy nie zobaczy.
//
// 2. CZY ŚCIEŻKA POCHODZI Z BAZY. Adres strony przyjeżdża w `event_menu`
//    gotowy (rekurencyjnie z łańcucha slugów rodziców) razem ze znacznikiem
//    `module`. Sklejony tutaj z sluga wydarzenia rozjechałby się przy pierwszym
//    przeniesieniu strony w drzewie - i zakładka pokazałaby cudzy dokument albo
//    żaden.
//
// 3. CZY BRAK WSTĘPU WYWRACA ZAKŁADKĘ. Strona modułowa bywa odpięta, cofnięta
//    do szkicu albo widoczna tylko dla grup - wtedy `event_menu` jej nie odda.
//    Dane pod spodem (lista uczestników, program, siatka prelegentów) mają
//    własne źródło i własne bramki, więc zakładka NADAL ROBI SWOJE. Zdanie
//    „nie znaleźliśmy strony" byłoby nieprawdą o zakładce, która działa - a
//    granica błędu zabrałaby uczestnikowi listę, po którą przyszedł.
//
// CZEGO TU NIE MA. Rysunku dokumentu - `ContentRenderer` i przypisy mają własne
// pliki testowe, a tutaj są atrapami zapisującymi, CO dostały. Sprawdzamy
// sklejenie, nie cudzy renderer.
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { EventMenuItem } from "@/lib/events/publicEventApi";
import type { PageData, ResolvedContent } from "@/lib/queries/public";
import type { BlocksDoc } from "@/lib/blocks/types";

const fetchMenu = vi.fn<(slug: string) => Promise<EventMenuItem[]>>();
const askedSegments: string[][] = [];
const docFn = vi.fn<() => Promise<ResolvedContent | null>>();
const language = { current: "pl" };

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      get language() {
        return language.current;
      },
      exists: () => true,
      changeLanguage: () => Promise.resolve(),
    },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const authState = { user: null as { id: string } | null };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => authState }));

vi.mock("@/lib/events/publicEventApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/events/publicEventApi")>(
    "@/lib/events/publicEventApi",
  );
  return { ...actual, fetchEventMenu: (slug: string) => fetchMenu(slug) };
});

// Fabryka opcji zapytania o dokument jest GRANICĄ BAZY tej zakładki: zapisujemy
// ścieżkę, o którą pyta, bo to ona rozstrzyga, czy adres przyszedł z `event_menu`.
vi.mock("@/lib/queries/public", () => ({
  resolvedContentQueryOptions: (segments: string[]) => {
    askedSegments.push(segments);
    return { queryKey: ["public", "resolved", segments], queryFn: () => docFn() };
  },
}));

vi.mock("@/components/content/ContentRenderer", () => ({
  ContentRenderer: (props: { lang: string; html?: string; editor?: string }) => (
    <div
      data-testid="renderer-tresci"
      data-lang={props.lang}
      data-editor={props.editor ?? ""}
      data-html={props.html ?? ""}
    />
  ),
}));

vi.mock("@/components/Footnotes", () => ({
  FootnoteTooltips: () => null,
  FootnotesList: () => <div data-testid="przypisy" />,
}));

const { EventModulePage } = await import("@/components/events/public/molecules/EventModulePage");

function menuItem(over: Partial<EventMenuItem> & { id: string; path: string }): EventMenuItem {
  return {
    pageId: `page-${over.id}`,
    labelPl: "Uczestnicy",
    labelEn: "Participants",
    icon: null,
    color: null,
    sortOrder: 0,
    module: null,
    ...over,
  };
}

function page(over: Partial<PageData> = {}): PageData {
  return {
    id: "page-1",
    slug: "uczestnicy",
    title_pl: "Uczestnicy",
    title_en: "Participants",
    content_pl: "<p>Zapraszamy do katalogu uczestnikow.</p>",
    content_en: "<p>Welcome to the attendee directory.</p>",
    excerpt_pl: null,
    excerpt_en: null,
    editor: "richtext",
    builder_data: null,
    blocks_data: null,
    cover_image_url: null,
    published_at: "2026-08-01T08:00:00Z",
    updated_at: "2026-08-01T08:00:00Z",
    seo_title_pl: null,
    seo_title_en: null,
    seo_description_pl: null,
    seo_description_en: null,
    seo_canonical_url: null,
    seo_noindex: false,
    seo_og_image_url: null,
    og_image_generated_url: null,
    takeaways_pl: [],
    takeaways_en: [],
    takeaways_variant: null,
    ...over,
  };
}

function pageDocument(over: Partial<PageData> = {}): ResolvedContent {
  return { kind: "page", item: page(over), crumbs: [], parentPageId: "root", access: null };
}

/** Dokument w blokach - drugi silnik tej samej ścieżki renderowania. */
function blocksDoc(text: string): BlocksDoc {
  return { version: 1, blocks: [{ id: "b1", type: "paragraph", data: { html: text } }] };
}

/**
 * Wpis (nie strona) pod tą samą ścieżką - jedyny powód, dla którego `kind`
 * jest w tym komponencie warunkiem, a nie ozdobą.
 */
function postDocument(): ResolvedContent {
  return {
    kind: "post",
    item: {
      ...page({ slug: "relacja-z-kongresu" }),
      read_minutes: 4,
      post_format: "standard",
      layout_overrides: null,
      custom_meta: null,
      related_override: null,
      author_id: null,
      toc_override: null,
      audio_url_pl: null,
      audio_url_en: null,
      organization_id: null,
      organization_name: null,
      organization_logo_url: null,
      organization_website: null,
      is_sponsored: false,
      sponsored_kind: null,
      sponsored_advertiser_name: null,
      sponsored_advertiser_url: null,
      sponsored_payer_name: null,
      sponsored_note_pl: null,
      sponsored_note_en: null,
      sponsored_affiliate: false,
      sponsored_political: false,
      sponsored_political_process: null,
      sponsored_sponsor_controller: null,
    },
    crumbs: [],
    parentPageId: "root",
    tags: [],
    categories: [],
    author: null,
    authors: [],
    access: null,
  };
}

function renderModule(children: ReactNode = <div data-testid="dane-zakladki" />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <EventModulePage slug="kongres-energetyczny" module="participants">
        {children}
      </EventModulePage>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  askedSegments.length = 0;
  language.current = "pl";
  authState.user = null;
  fetchMenu.mockResolvedValue([
    menuItem({
      id: "m1",
      path: "wydarzenia/kongres-energetyczny/uczestnicy",
      module: "participants",
    }),
  ]);
  docFn.mockResolvedValue(pageDocument());
});

describe("EventModulePage - wstęp z CMS-a nad danymi zakładki", () => {
  it("wstęp redakcyjny staje NAD danymi, a nie zamiast nich", async () => {
    const view = renderModule();

    expect(await screen.findByTestId("renderer-tresci")).toBeInTheDocument();
    expect(screen.getByTestId("dane-zakladki")).toBeInTheDocument();

    // Kolejność jest treścią, nie stylem: zdanie wstępu ma tłumaczyć listę,
    // która jest POD nim.
    const doc = screen.getByTestId("renderer-tresci");
    const dane = screen.getByTestId("dane-zakladki");
    expect(doc.compareDocumentPosition(dane) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(view.container.querySelector("[data-cms-content]")).not.toBeNull();
  });

  it("dokument jedzie tą samą drogą, co każda inna strona serwisu", async () => {
    renderModule();
    await screen.findByTestId("renderer-tresci");

    // Ten sam renderer i te same przypisy, co pod trasą splat - „mały renderer
    // nagłówka i akapitu" wpisany tutaj gubiłby pierwszy widget wstawiony
    // przez redakcję.
    expect(screen.getByTestId("renderer-tresci")).toHaveAttribute("data-editor", "richtext");
    // Do renderera jedzie TREŚĆ redakcyjna, a nie sam znacznik silnika: gdyby
    // zakładka rysowała własny nagłówek wpisany w kod, zdanie ze studia nie
    // dotarłoby tu wcale, a test nadal byłby zielony.
    expect(screen.getByTestId("renderer-tresci").getAttribute("data-html")).toContain(
      "Zapraszamy do katalogu uczestnikow.",
    );
    expect(screen.getByTestId("przypisy")).toBeInTheDocument();
  });

  it("język interfejsu wybiera kolumnę treści dokumentu", async () => {
    language.current = "en";
    renderModule();

    const renderer = await screen.findByTestId("renderer-tresci");
    expect(renderer).toHaveAttribute("data-lang", "en");
    expect(renderer.getAttribute("data-html")).toContain("Welcome to the attendee directory.");
    expect(renderer.getAttribute("data-html")).not.toContain("Zapraszamy");
  });
});

describe("EventModulePage - ścieżka pochodzi z `event_menu`", () => {
  it("pyta o PEŁNĄ ścieżkę z bazy, a nie o sklejoną z sluga wydarzenia", async () => {
    renderModule();
    await screen.findByTestId("renderer-tresci");

    // Menu przyjeżdża z RPC `event_menu` wołanego SLUGIEM wydarzenia - to on
    // rozstrzyga, czyje menu czytamy; zawężenie najemcem siedzi w SQL (pilnuje
    // go bramka `check:sql-tenant-scope`).
    expect(fetchMenu).toHaveBeenCalledWith("kongres-energetyczny");
    expect(askedSegments.at(-1)).toEqual(["wydarzenia", "kongres-energetyczny", "uczestnicy"]);
  });

  it("dopasowanie idzie po kolumnie `module`, a nie po slugu strony", async () => {
    // Redakcja może nazwać zwykłą podstronę „participants" - to jest napis,
    // który wolno jej zmienić. Znacznik `module` jest kolumną i zmienić się
    // nie może.
    fetchMenu.mockResolvedValue([
      menuItem({ id: "m0", path: "wydarzenia/kongres-energetyczny/participants", module: null }),
      menuItem({
        id: "m1",
        path: "o-nas/kongres/lista-osob",
        module: "participants",
      }),
    ]);
    renderModule();
    await screen.findByTestId("renderer-tresci");

    expect(askedSegments.at(-1)).toEqual(["o-nas", "kongres", "lista-osob"]);
  });
});

describe("EventModulePage - brak wstępu nie jest awarią zakładki", () => {
  it("strona odpięta od menu zostawia dane zakładki i NIE pyta bazy o dokument", async () => {
    fetchMenu.mockResolvedValue([
      menuItem({ id: "m2", path: "wydarzenia/kongres-energetyczny/program", module: "agenda" }),
    ]);
    renderModule();

    expect(await screen.findByTestId("dane-zakladki")).toBeInTheDocument();
    await waitFor(() => expect(fetchMenu).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("renderer-tresci")).not.toBeInTheDocument();
    // Pusta ścieżka to brak zapytania, a nie zapytanie o korzeń serwisu.
    expect(docFn).not.toHaveBeenCalled();
  });

  it("szósty moduł dopisany w bazie nie porywa zakładki, którą ta wersja zna", async () => {
    fetchMenu.mockResolvedValue([
      menuItem({
        id: "m3",
        path: "wydarzenia/kongres-energetyczny/wystawcy",
        module: "exhibitors",
      }),
    ]);
    renderModule();

    expect(await screen.findByTestId("dane-zakladki")).toBeInTheDocument();
    // Nieznany moduł nie jest DOPASOWANIEM: zakładka uczestników nie ma prawa
    // pokazać wstępu napisanego dla wystawców.
    expect(screen.queryByTestId("renderer-tresci")).not.toBeInTheDocument();
    expect(docFn).not.toHaveBeenCalled();
  });

  it("strona bez treści nie rysuje pustej ramki nad danymi", async () => {
    docFn.mockResolvedValue(pageDocument({ content_pl: null, content_en: null }));
    renderModule();

    expect(await screen.findByTestId("dane-zakladki")).toBeInTheDocument();
    await waitFor(() => expect(docFn).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("renderer-tresci")).not.toBeInTheDocument();
  });

  it("nieosiągalny dokument degraduje się do samych danych, a nie do granicy błędu", async () => {
    docFn.mockRejectedValue(new Error("siec nie odpowiada"));
    renderModule();

    expect(await screen.findByTestId("dane-zakladki")).toBeInTheDocument();
    await waitFor(() => expect(docFn).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("renderer-tresci")).not.toBeInTheDocument();
    expect(screen.queryByText(/siec nie odpowiada/)).not.toBeInTheDocument();
  });

  it("brak dokumentu pod ścieżką z menu zostawia dane zakładki bez zdania o awarii", async () => {
    // Strona cofnięta do szkicu nadal ma pozycję w menu, ale rezolwer nie
    // oddaje jej dokumentu - zakładka ma wtedy pokazać dane, nie odmowę.
    docFn.mockResolvedValue(null);
    renderModule();

    expect(await screen.findByTestId("dane-zakladki")).toBeInTheDocument();
    await waitFor(() => expect(docFn).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("renderer-tresci")).not.toBeInTheDocument();
  });

  it("strona bez wersji angielskiej pokazuje wersję polską, a nie pustkę", async () => {
    // Redakcja tłumaczy podstrony modułowe z opóźnieniem - brak kolumny `en`
    // nie może zamienić wstępu w pustą ramkę nad listą.
    language.current = "en";
    docFn.mockResolvedValue(pageDocument({ content_en: null }));
    renderModule();

    const renderer = await screen.findByTestId("renderer-tresci");
    expect(renderer).toHaveAttribute("data-lang", "en");
    expect(renderer.getAttribute("data-html")).toContain("Zapraszamy do katalogu uczestnikow.");
  });

  it("dokument w blokach jedzie do renderera w języku interfejsu", async () => {
    // Blokowy silnik to ta sama droga renderowania, co reszta serwisu -
    // zakładka nie ma prawa obsługiwać tylko jednego z nich.
    docFn.mockResolvedValue(
      pageDocument({
        editor: "blocks",
        content_pl: null,
        content_en: null,
        blocks_data: { pl: blocksDoc("Wstep polski"), en: blocksDoc("English intro") },
      }),
    );
    const view = renderModule();

    expect(await screen.findByTestId("renderer-tresci")).toHaveAttribute("data-editor", "blocks");
    expect(screen.getByTestId("dane-zakladki")).toBeInTheDocument();

    // Blokowy dokument bez wersji angielskiej też ma się narysować - inaczej
    // nietłumaczona podstrona modułowa gubi wstęp zamiast go pokazać po polsku.
    view.unmount();
    language.current = "en";
    docFn.mockResolvedValue(
      pageDocument({
        editor: "blocks",
        content_pl: null,
        content_en: null,
        blocks_data: { pl: blocksDoc("Wstep polski") },
      }),
    );
    renderModule();
    expect(await screen.findByTestId("renderer-tresci")).toHaveAttribute("data-lang", "en");
  });

  it("wpis pod tą ścieżką nie jedzie do renderera stron", async () => {
    // Pod adresem modułowym może kiedyś stanąć WPIS - o tym rozstrzyga `kind`.
    // Bez tego warunku wpis pojechałby do renderera jako strona, czyli jako
    // dokument bez pól, których ta powierzchnia oczekuje.
    docFn.mockResolvedValue(postDocument());
    renderModule();

    expect(await screen.findByTestId("dane-zakladki")).toBeInTheDocument();
    await waitFor(() => expect(docFn).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("renderer-tresci")).not.toBeInTheDocument();
  });
});
