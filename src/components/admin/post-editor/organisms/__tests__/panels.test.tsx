// Duże organizmy edytora: nagłówek, boczna nawigacja szczegółów, panel sekcji,
// krok treści i zestaw kart dokumentu. Wszystkie na 0% przed tą zmianą.
//
// Te pięć plików to KOMPOZYCJA — decydują, co redaktor widzi i którą akcję
// wywoła kliknięcie. Trzy rzeczy są tu warte testu:
//
//   1. JEDNA ZAKŁADKA NA RAZ. Sekcje szczegółów montują ciężkie panele
//      (SEO z analizą treści, dostęp, historia wersji), więc zamontowanie kilku
//      naraz to kilka kompletów zapytań przy każdym wejściu w edytor.
//   2. PRZYCISK WOŁA WŁAŚCIWĄ AKCJĘ. „Usuń" i „Zapisz" stoją obok siebie
//      w nagłówku; podmiana handlerów jest niewidoczna w typach.
//   3. WIELOPOLOWE ZMIANY IDĄ JEDNĄ POZYCJĄ HISTORII. Karty organizacji
//      i sponsoringu zmieniają po kilka pól naraz; osobne `set()` na każde dałyby
//      tyle samo wpisów undo i tyle samo szans, żeby autozapis utrwalił stan
//      pośredni — czyli wpis oznaczony jako komercyjny bez reszty deklaracji.
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { postEditorData, postEditorFormApi, postForm } from "@/test/post-editor/fixtures";

const h = vi.hoisted(() => ({
  prompt: null as unknown,
  captured: {} as Record<string, unknown>,
  // Lista WSZYSTKICH instancji danego znacznika - `captured` trzyma tylko
  // ostatnia, a niektore organizmy renderuja ten sam komponent dwa razy
  // (pole tresci PL i EN).
  all: {} as Record<string, unknown[]>,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(),
);
vi.mock("@/lib/i18n-admin-post-panes", () => ({}));
vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

function probe(name: string) {
  return (props: Record<string, unknown>) => {
    h.captured[name] = props;
    (h.all[name] ??= []).push(props);
    return <div data-testid={name} />;
  };
}

// Ciężkie panele mają własne testy; tutaj interesuje nas WYŁĄCZNIE to, KTÓRY
// z nich jest zamontowany i z jakimi propami.
vi.mock("@/components/admin/PostGeneralOverview", () => ({
  PostGeneralOverview: probe("PostGeneralOverview"),
}));
vi.mock("@/components/admin/PostSettingsMetabox", () => ({
  PostSettingsMetabox: probe("PostSettingsMetabox"),
  TakeawaysTab: probe("TakeawaysTab"),
}));
vi.mock("@/components/admin/seo/SeoPanel", () => ({ SeoPanel: probe("SeoPanel") }));
vi.mock("@/components/admin/seo/InternalLinkSuggestions", () => ({
  InternalLinkSuggestions: probe("InternalLinkSuggestions"),
}));
vi.mock("@/components/admin/AccessSettingsPane", () => ({
  AccessSettingsPane: probe("AccessSettingsPane"),
}));
vi.mock("@/components/admin/molecules/RevisionsCard", () => ({
  RevisionsCard: probe("RevisionsCard"),
}));
vi.mock("@/components/admin/AutosaveBar", () => ({ AutosaveBar: probe("AutosaveBar") }));
vi.mock("@/components/admin/blocks/PostBlockEditor", () => ({
  PostBlockEditor: probe("PostBlockEditor"),
}));
vi.mock("@/components/admin/PostEditor", () => ({ PostEditor: probe("PostEditor") }));
// Radix Tabs montuje TYLKO aktywna zakladke, a jego przelaczanie nie dziala pod
// happy-dom (wymaga zdarzen wskaznika). Przedmiotem testu jest MAPOWANIE POL,
// nie prymityw zakladek, wiec renderujemy oba panele jednoczesnie i sprawdzamy,
// ze kazdy pisze do swojej kolumny.
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: unknown }) => <div>{children as never}</div>,
  TabsList: ({ children }: { children: unknown }) => <div role="tablist">{children as never}</div>,
  TabsTrigger: ({ children }: { children: unknown }) => (
    <button role="tab">{children as never}</button>
  ),
  TabsContent: ({ value, children }: { value: string; children: unknown }) => (
    <div data-tab={value}>{children as never}</div>
  ),
}));

vi.mock("@/components/admin/builder/Builder", () => ({ Builder: probe("Builder") }));
/** Sonda RENDERUJĄCA dzieci - dla obudów (kadr layoutu wokół kanwy). */
function wrapProbe(name: string) {
  return ({ children, ...rest }: { children?: unknown } & Record<string, unknown>) => {
    h.captured[name] = rest;
    (h.all[name] ??= []).push(rest);
    return <div data-testid={name}>{children as never}</div>;
  };
}
vi.mock("@/components/admin/blocks/LayoutScaffold", () => ({
  LayoutScaffold: wrapProbe("LayoutScaffold"),
}));
vi.mock("@/components/admin/blocks/AutoFootnotesPreview", () => ({
  AutoFootnotesPreview: probe("AutoFootnotesPreview"),
}));
vi.mock("@/lib/appDialogs", async () => {
  const { vi: v } = await import("vitest");
  h.prompt = v.fn(async () => "https://cdn.tenant/obraz.png");
  return { promptDialog: h.prompt };
});
vi.mock("@/lib/builder/labelsEn", () => ({ useAdminLang: () => "pl" }));
vi.mock("../PostSidebarBundle", () => ({ PostSidebarBundle: probe("PostSidebarBundle") }));
vi.mock("../PostSettingsCard", () => ({ PostSettingsCard: probe("PostSettingsCard") }));
vi.mock("../PostTranslateCard", () => ({ PostTranslateCard: probe("PostTranslateCard") }));
vi.mock("../PostTaxonomyGrid", () => ({ PostTaxonomyGrid: probe("PostTaxonomyGrid") }));
vi.mock("../AudioSection", () => ({ AudioSection: probe("AudioSection") }));
vi.mock("../TakeawaysSection", () => ({ TakeawaysSection: probe("TakeawaysSection") }));
vi.mock("../CustomMetaSection", () => ({ CustomMetaSection: probe("CustomMetaSection") }));
vi.mock("../RelatedSection", () => ({ RelatedSection: probe("RelatedSection") }));
vi.mock("../../molecules", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    PostOrganizationPicker: probe("PostOrganizationPicker"),
    PostSponsoredCard: probe("PostSponsoredCard"),
    PublishChecklistCard: probe("PublishChecklistCard"),
    PostAuthorsCard: probe("PostAuthorsCard"),
    SeriesCard: probe("SeriesCard"),
    PreviewLinksCard: probe("PreviewLinksCard"),
    ChangelogCard: probe("ChangelogCard"),
  };
});

import { PostEditorHeader } from "../PostEditorHeader";
import { PostDetailsNav, type DetailsTab } from "../PostDetailsNav";
import { PostDetailsPanel } from "../PostDetailsPanel";
import { PostContentEditor } from "../PostContentEditor";

/**
 * Waski widok na atrape API formularza. `postEditorFormApi` zwraca
 * `Record<string, unknown>` (fixture jest wspolny dla kilkunastu ksztaltow
 * propow), wiec testy, ktore siegaja do konkretnych pol, deklaruja je tutaj -
 * zamiast rzutowac w kazdym miejscu z osobna.
 */
type Api = Record<string, unknown> & {
  set: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  discardToSaved: ReturnType<typeof vi.fn>;
  setSeoIssues: ReturnType<typeof vi.fn>;
  onRevisionRestored: ReturnType<typeof vi.fn>;
  setSelectedCats: ReturnType<typeof vi.fn>;
  setSelectedTags: ReturnType<typeof vi.fn>;
  setSelectedPrograms: ReturnType<typeof vi.fn>;
  setSelectedRegions: ReturnType<typeof vi.fn>;
  history: { set: ReturnType<typeof vi.fn>; undo: unknown; redo: unknown };
};
const api = (over: Partial<Record<string, unknown>> = {}) =>
  postEditorFormApi(over) as unknown as Parameters<typeof PostDetailsPanel>[0]["formApi"];
const data = () => postEditorData() as unknown as Parameters<typeof PostDetailsPanel>[0]["data"];
const props = (name: string) => h.captured[name] as Record<string, unknown>;

const taxonomy = {} as unknown as Parameters<typeof PostDetailsPanel>[0]["taxonomy"];
const autoReadMinutes = { pl: 5, en: 4 } as unknown as Parameters<
  typeof PostDetailsPanel
>[0]["autoReadMinutes"];

afterEach(() => {
  cleanup();
  h.captured = {};
  h.all = {};
});

// ---------------------------------------------------------------------------
// PostEditorHeader
// ---------------------------------------------------------------------------

describe("PostEditorHeader", () => {
  const renderHeader = (step: "details" | "content" = "details") => {
    const formApi = api();
    const onStepChange = vi.fn();
    render(<PostEditorHeader step={step} onStepChange={onStepChange} formApi={formApi} />);
    return { formApi: formApi as unknown as Api, onStepChange };
  };

  it("w kroku szczegółów wraca LINKIEM na listę wpisów", () => {
    renderHeader("details");
    expect(screen.getByRole("link")).toHaveAttribute("href", "/admin/posts");
  });

  it("w kroku treści wraca PRZYCISKIEM do szczegółów, nie z edytora", () => {
    // Link na listę w kroku treści wyrzucałby redaktora z edytora zamiast
    // cofnąć go o jeden krok.
    const { onStepChange } = renderHeader("content");
    expect(screen.queryByRole("link")).toBeNull();

    fireEvent.click(screen.getByText("adminPostPanes.editor.detailsStep"));

    expect(onStepChange).toHaveBeenCalledWith("details");
  });

  it("zapis wola zapis, a usuniecie usuniecie - nie odwrotnie", () => {
    // Przyciski stoją obok siebie; podmiana handlerów jest niewidoczna
    // w typach, a kosztuje wpis.
    const { formApi } = renderHeader();

    fireEvent.click(screen.getByText("admin.save"));
    expect(formApi.save).toHaveBeenCalledTimes(1);
    expect(formApi.del).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("admin.delete"));
    expect(formApi.del).toHaveBeenCalledTimes(1);
  });

  it("w trakcie zapisu przycisk jest zablokowany", () => {
    // Podwójne kliknięcie wysłałoby dwa zapisy na ten sam wiersz.
    const formApi = api({ busy: true });
    render(<PostEditorHeader step="details" onStepChange={vi.fn()} formApi={formApi} />);
    expect(screen.getByText("...").closest("button")).toBeDisabled();
  });

  it("pasek autozapisu dostaje stan i akcje historii", () => {
    const { formApi } = renderHeader();
    expect(props("AutosaveBar").status).toBe("idle");
    expect(props("AutosaveBar").onUndo).toBe(formApi.history.undo);
    expect(props("AutosaveBar").onRedo).toBe(formApi.history.redo);
    expect(props("AutosaveBar").onDiscard).toBe(formApi.discardToSaved);
  });
});

// ---------------------------------------------------------------------------
// PostDetailsNav
// ---------------------------------------------------------------------------

describe("PostDetailsNav", () => {
  const ALL_TABS: DetailsTab[] = [
    "general",
    "takeaways",
    "audio",
    "settings",
    "layout",
    "taxonomy",
    "related",
    "seo",
    "meta",
    "publish",
    "access",
    "organization",
    "revisions",
  ];

  it("renderuje KAŻDĄ zakładkę z rejestru", () => {
    // Zakładka, która wypadnie z nawigacji, staje się nieosiągalna - a jej
    // sekcja nadal istnieje w panelu.
    render(<PostDetailsNav active="general" onSelect={vi.fn()} />);
    expect(screen.getAllByRole("button")).toHaveLength(ALL_TABS.length);
  });

  it("każda zakładka wywołuje wybór ZE SWOIM identyfikatorem", () => {
    const onSelect = vi.fn();
    render(<PostDetailsNav active="general" onSelect={onSelect} />);

    for (const tab of ALL_TABS) {
      onSelect.mockClear();
      fireEvent.click(screen.getByText(`adminPostPanes.nav.${tab}`));
      expect(onSelect, tab).toHaveBeenCalledWith(tab);
    }
  });

  it("aktywna zakładka jest oznaczona jako bieżąca strona", () => {
    // Wyróżnienie kolorem nie dociera do czytnika ekranu.
    render(<PostDetailsNav active="seo" onSelect={vi.fn()} />);
    const active = screen.getAllByRole("button").filter((b) => b.getAttribute("aria-current"));
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toContain("adminPostPanes.nav.seo");
  });

  it("zakładki są pogrupowane tematycznie z nagłówkami grup", () => {
    render(<PostDetailsNav active="general" onSelect={vi.fn()} />);
    for (const group of [
      "groupContent",
      "groupStructure",
      "groupSeoMeta",
      "groupPublication",
      "groupHistory",
    ]) {
      expect(screen.getByText(`adminPostPanes.nav.${group}`), group).toBeInTheDocument();
    }
  });

  it("podpowiedzi są renderowane tam, gdzie są zdefiniowane", () => {
    render(<PostDetailsNav active="general" onSelect={vi.fn()} />);
    expect(screen.getByText("adminPostPanes.nav.generalHint")).toBeInTheDocument();
    // `taxonomy` i `revisions` nie mają podpowiedzi - i to jest w porządku.
    expect(screen.queryByText("adminPostPanes.nav.taxonomyHint")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PostDetailsPanel
// ---------------------------------------------------------------------------

describe("PostDetailsPanel - jedna zakładka na raz", () => {
  const renderPanel = (detailsTab: DetailsTab, formApi = api()) => {
    const onDetailsTabChange = vi.fn();
    const onGoToContent = vi.fn();
    render(
      <PostDetailsPanel
        formApi={formApi}
        data={data()}
        routeSlug="moj-wpis"
        uiLang="pl"
        autoReadMinutes={autoReadMinutes}
        taxonomy={taxonomy}
        layoutCard={<div data-testid="layoutCard" />}
        detailsTab={detailsTab}
        onDetailsTabChange={onDetailsTabChange}
        onGoToContent={onGoToContent}
      />,
    );
    return { formApi: formApi as unknown as Api, onDetailsTabChange, onGoToContent };
  };

  it("każda zakładka montuje SWOJĄ sekcję", () => {
    const expected: Array<[DetailsTab, string]> = [
      ["general", "PostGeneralOverview"],
      ["settings", "PostSettingsMetabox"],
      ["takeaways", "TakeawaysSection"],
      ["seo", "SeoPanel"],
      ["meta", "CustomMetaSection"],
      ["related", "RelatedSection"],
      ["publish", "PostSidebarBundle"],
      ["layout", "layoutCard"],
      ["taxonomy", "PostTaxonomyGrid"],
      ["access", "AccessSettingsPane"],
      ["organization", "PostOrganizationPicker"],
      ["audio", "AudioSection"],
      ["revisions", "RevisionsCard"],
    ];
    for (const [tab, testId] of expected) {
      renderPanel(tab);
      expect(screen.getByTestId(testId), tab).toBeInTheDocument();
      cleanup();
    }
  });

  it("sekcje INNYCH zakładek NIE są montowane", () => {
    // SEO z analizą treści, dostęp i historia wersji odpytują własne źródła
    // przy montażu - kilka naraz to kilka kompletów zapytań przy każdym wejściu.
    renderPanel("general");
    expect(screen.getByTestId("PostGeneralOverview")).toBeInTheDocument();
    for (const other of ["SeoPanel", "AccessSettingsPane", "RevisionsCard", "AudioSection"]) {
      expect(screen.queryByTestId(other), other).toBeNull();
    }
  });

  it("bez formularza panel nie renderuje nic", () => {
    renderPanel("general", api({ form: null }));
    expect(screen.queryByTestId("PostGeneralOverview")).toBeNull();
  });

  it("przejście do treści jest ZABLOKOWANE, dopóki wpis nie ma żadnego tytułu", () => {
    // Wpis bez tytułu w obu językach nie ma jak być zapisany ani znaleziony.
    renderPanel("general", api({ form: postForm({ title_pl: "  ", title_en: "" }) }));
    expect(screen.getByText(/goToContent/).closest("button")).toBeDisabled();
  });

  it("wystarczy tytuł w JEDNYM języku, żeby przejść dalej", () => {
    const { onGoToContent } = renderPanel(
      "general",
      api({ form: postForm({ title_pl: "", title_en: "English only" }) }),
    );
    const button = screen.getByText(/goToContent/).closest("button")!;
    expect(button).not.toBeDisabled();

    fireEvent.click(button);
    expect(onGoToContent).toHaveBeenCalledTimes(1);
  });

  it("zakładka organizacji pokazuje OBIE karty: atrybucję i deklarację komercyjną", () => {
    // Rozstrzygają się razem w momencie publikacji i razem są warunkiem
    // legalnego wypuszczenia materiału.
    renderPanel("organization");
    expect(screen.getByTestId("PostOrganizationPicker")).toBeInTheDocument();
    expect(screen.getByTestId("PostSponsoredCard")).toBeInTheDocument();
  });

  it("WIELOPOLOWY patch idzie JEDNĄ pozycją historii, z kluczem scalania", () => {
    // Osobne `set()` na każde pole dałyby tyle samo wpisów undo i tyle samo
    // szans, żeby autozapis utrwalił stan pośredni - czyli wpis oznaczony jako
    // komercyjny bez reszty ustawowej deklaracji.
    const { formApi } = renderPanel("organization");

    (props("PostOrganizationPicker").onPatch as (p: Record<string, unknown>) => void)({
      organization_id: "org-1",
      organization_name: "Firma",
    });

    const historySet = formApi.history.set as ReturnType<typeof vi.fn>;
    expect(historySet).toHaveBeenCalledTimes(1);
    expect(historySet.mock.calls[0][1]).toEqual({
      coalesceKey: "organization_id|organization_name",
    });
  });

  it("patch na pustym stanie zwraca go bez zmian", () => {
    const { formApi } = renderPanel("organization");
    (props("PostSponsoredCard").onPatch as (p: Record<string, unknown>) => void)({
      is_sponsored: true,
    });
    const updater = (formApi.history.set as ReturnType<typeof vi.fn>).mock.calls[0][0] as (
      f: unknown,
    ) => unknown;
    expect(updater(null)).toBeNull();
    expect(updater(postForm())).toMatchObject({ is_sponsored: true });
  });

  it("SEO: zmiany też idą jedną pozycją historii", () => {
    const { formApi } = renderPanel("seo");

    (props("SeoPanel").onChange as (p: Record<string, unknown>) => void)({
      seo_title_pl: "Nowy",
      seo_noindex: true,
    });

    const historySet = formApi.history.set as ReturnType<typeof vi.fn>;
    expect(historySet.mock.calls[0][1]).toEqual({ coalesceKey: "seo_noindex|seo_title_pl" });
  });

  it("SEO: sugestie linków wewnętrznych NIE odpytują dla NOWEGO wpisu", () => {
    // Wpis o id "new" jeszcze nie istnieje - zapytanie o linki do niego byłoby
    // zapytaniem o wiersz, którego nie ma.
    const onDetailsTabChange = vi.fn();
    render(
      <PostDetailsPanel
        formApi={api()}
        data={
          postEditorData({ id: "new" }) as unknown as Parameters<typeof PostDetailsPanel>[0]["data"]
        }
        routeSlug="new"
        uiLang="pl"
        autoReadMinutes={autoReadMinutes}
        taxonomy={taxonomy}
        layoutCard={null}
        detailsTab="seo"
        onDetailsTabChange={onDetailsTabChange}
        onGoToContent={vi.fn()}
      />,
    );
    expect(props("InternalLinkSuggestions").postId).toBeNull();
  });

  it("przegląd ogólny dostaje NAZWY wybranych kategorii w języku panelu", () => {
    const formApi = api({ selectedCats: [postEditorData().allCats![0].id] });
    renderPanel("general", formApi);
    expect(props("PostGeneralOverview").selectedCatNames).toEqual([
      postEditorData().allCats![0].name_pl,
    ]);
    cleanup();

    render(
      <PostDetailsPanel
        formApi={formApi}
        data={data()}
        routeSlug="moj-wpis"
        uiLang="en"
        autoReadMinutes={autoReadMinutes}
        taxonomy={taxonomy}
        layoutCard={null}
        detailsTab="general"
        onDetailsTabChange={vi.fn()}
        onGoToContent={vi.fn()}
      />,
    );
    expect(props("PostGeneralOverview").selectedCatNames).toEqual([
      postEditorData().allCats![0].name_en,
    ]);
  });

  it("nawigacja z przeglądu ogólnego przełącza zakładkę", () => {
    const { onDetailsTabChange } = renderPanel("general");
    (props("PostGeneralOverview").onNavigate as (t: string) => void)("seo");
    expect(onDetailsTabChange).toHaveBeenCalledWith("seo");
  });
});

// ---------------------------------------------------------------------------
// PostContentEditor
// ---------------------------------------------------------------------------

describe("PostContentEditor - silnik decyduje, który edytor się montuje", () => {
  const renderEditor = (editor: "blocks" | "builder" | "richtext" | "markdown") => {
    const formApi = api({ form: postForm({ editor }) });
    render(
      <PostContentEditor
        formApi={formApi}
        data={data()}
        routeSlug="moj-wpis"
        uiLang="pl"
        autoReadMinutes={autoReadMinutes}
        taxonomy={taxonomy}
        globalLayout={undefined}
        ov={{} as never}
        currentFormat={"standard" as never}
        layoutCard={null}
      />,
    );
    return formApi as unknown as Api;
  };

  it("edytor blokowy montuje kanwę bloków, a NIE pola tekstowe", () => {
    renderEditor("blocks");
    expect(screen.getByTestId("PostBlockEditor")).toBeInTheDocument();
    expect(screen.queryByTestId("PostEditor")).toBeNull();
    expect(screen.queryByTestId("Builder")).toBeNull();
  });

  it("builder montuje kanwę wizualną", () => {
    renderEditor("builder");
    expect(screen.getByTestId("Builder")).toBeInTheDocument();
    expect(screen.queryByTestId("PostBlockEditor")).toBeNull();
  });

  it("rich text i markdown montują DWA pola tekstowe: PL i EN", () => {
    for (const editor of ["richtext", "markdown"] as const) {
      renderEditor(editor);
      expect(screen.getAllByTestId("PostEditor"), editor).toHaveLength(2);
      expect(screen.getAllByRole("tab"), editor).toHaveLength(2);
      cleanup();
    }
  });

  it("pole PL pisze do content_pl, a pole EN do content_en", () => {
    // Pomylka strony jezykowej nadpisuje tekst w drugim jezyku - i to bez
    // zadnego sygnalu, bo oba pola wygladaja identycznie.
    const formApi = renderEditor("richtext");

    const [plField, enField] = h.all.PostEditor as Array<Record<string, unknown>>;
    // Kolejnosc renderu: najpierw panel PL, potem EN.
    expect(plField.value).toBe(postForm().content_pl);
    expect(enField.value).toBe(postForm().content_en);

    (plField.onChange as (v: string) => void)("<p>Polski</p>");
    (enField.onChange as (v: string) => void)("<p>English</p>");

    expect(formApi.set).toHaveBeenCalledWith("content_pl", "<p>Polski</p>");
    expect(formApi.set).toHaveBeenCalledWith("content_en", "<p>English</p>");
  });

  it("markdown przekazuje tryb `markdown`, richtext tryb `richtext`", () => {
    // Zły tryb renderuje surowe znaczniki zamiast sformatowanego tekstu.
    renderEditor("markdown");
    expect(props("PostEditor").mode).toBe("markdown");
    cleanup();

    renderEditor("richtext");
    expect(props("PostEditor").mode).toBe("richtext");
  });

  it("zmiana silnika zapisuje się do formularza", () => {
    const formApi = renderEditor("blocks");
    // `EditorModeToggle` jest prawdziwy - szukamy jego przełącznika po tekście.
    const toggle = screen.getAllByRole("button")[0];
    fireEvent.click(toggle);
    expect(formApi.set).toHaveBeenCalled();
  });

  it("podgląd bloków wskazuje publiczny adres wpisu, ale NIE dla nowego", () => {
    // `/new` nie jest adresem publicznym - link prowadziłby na 404.
    renderEditor("blocks");
    expect(props("PostBlockEditor").previewHref).toBe("/moj-wpis");
    cleanup();

    render(
      <PostContentEditor
        formApi={api({ form: postForm({ editor: "blocks" }) })}
        data={data()}
        routeSlug="new"
        uiLang="pl"
        autoReadMinutes={autoReadMinutes}
        taxonomy={taxonomy}
        globalLayout={undefined}
        ov={{} as never}
        currentFormat={"standard" as never}
        layoutCard={null}
      />,
    );
    expect(props("PostBlockEditor").previewHref).toBeUndefined();
  });

  it("bez formularza nie renderuje żadnego edytora", () => {
    render(
      <PostContentEditor
        formApi={api({ form: null })}
        data={data()}
        routeSlug="moj-wpis"
        uiLang="pl"
        autoReadMinutes={autoReadMinutes}
        taxonomy={taxonomy}
        globalLayout={undefined}
        ov={{} as never}
        currentFormat={"standard" as never}
        layoutCard={null}
      />,
    );
    expect(screen.queryByTestId("PostBlockEditor")).toBeNull();
    expect(screen.queryByTestId("PostEditor")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Callbacki przekazywane w dół (gałęzie, których probe sam nie wywoła)
// ---------------------------------------------------------------------------

describe("PostDetailsPanel - callbacki przeglądu ogólnego", () => {
  const renderGeneral = () => {
    const formApi = api();
    render(
      <PostDetailsPanel
        formApi={formApi}
        data={data()}
        routeSlug="moj-wpis"
        uiLang="pl"
        autoReadMinutes={autoReadMinutes}
        taxonomy={taxonomy}
        layoutCard={null}
        detailsTab="general"
        onDetailsTabChange={vi.fn()}
        onGoToContent={vi.fn()}
      />,
    );
    return formApi as unknown as Api;
  };

  it("tytuł i zajawka PL/EN piszą do OSOBNYCH kolumn", () => {
    // Cztery pola tekstowe o identycznym wyglądzie; pomyłka strony językowej
    // nadpisuje treść w drugim języku bez żadnego sygnału.
    const formApi = renderGeneral();
    const p = props("PostGeneralOverview");

    (p.onTitlePlChange as (v: string) => void)("Tytuł PL");
    (p.onTitleEnChange as (v: string) => void)("Title EN");
    (p.onExcerptPlChange as (v: string) => void)("Zajawka PL");
    (p.onExcerptEnChange as (v: string) => void)("Excerpt EN");

    expect(formApi.set).toHaveBeenCalledWith("title_pl", "Tytuł PL");
    expect(formApi.set).toHaveBeenCalledWith("title_en", "Title EN");
    expect(formApi.set).toHaveBeenCalledWith("excerpt_pl", "Zajawka PL");
    expect(formApi.set).toHaveBeenCalledWith("excerpt_en", "Excerpt EN");
  });

  it("puste zajawki przechodzą jako pusty string, nie undefined", () => {
    // Przegląd renderuje na nich `.length` przy liczeniu kompletności.
    render(
      <PostDetailsPanel
        formApi={api({ form: postForm({ excerpt_pl: null, excerpt_en: null }) })}
        data={data()}
        routeSlug="moj-wpis"
        uiLang="pl"
        autoReadMinutes={autoReadMinutes}
        taxonomy={taxonomy}
        layoutCard={null}
        detailsTab="general"
        onDetailsTabChange={vi.fn()}
        onGoToContent={vi.fn()}
      />,
    );
    expect(props("PostGeneralOverview").excerptPl).toBe("");
    expect(props("PostGeneralOverview").excerptEn).toBe("");
  });

  it("nazwy WYBRANYCH tagów idą do przeglądu", () => {
    const formApi = api({ selectedTags: [postEditorData().allTags![0].id] });
    render(
      <PostDetailsPanel
        formApi={formApi}
        data={data()}
        routeSlug="moj-wpis"
        uiLang="pl"
        autoReadMinutes={autoReadMinutes}
        taxonomy={taxonomy}
        layoutCard={null}
        detailsTab="general"
        onDetailsTabChange={vi.fn()}
        onGoToContent={vi.fn()}
      />,
    );
    expect(props("PostGeneralOverview").selectedTagNames).toEqual([
      postEditorData().allTags![0].name,
    ]);
  });

  it("zakładka ustawień zapisuje nadpisanie spisu treści", () => {
    const formApi = api();
    render(
      <PostDetailsPanel
        formApi={formApi}
        data={data()}
        routeSlug="moj-wpis"
        uiLang="pl"
        autoReadMinutes={autoReadMinutes}
        taxonomy={taxonomy}
        layoutCard={null}
        detailsTab="settings"
        onDetailsTabChange={vi.fn()}
        onGoToContent={vi.fn()}
      />,
    );

    (props("PostSettingsMetabox").onTocOverrideChange as (v: unknown) => void)({ hide: true });

    expect((formApi as unknown as Api).set).toHaveBeenCalledWith("toc_override", { hide: true });
  });

  it("panel SEO dostaje wybraną kategorię jako nadtytuł obrazka społecznościowego", () => {
    // Nadtytuł na obrazku OG bierze się z pierwszej wybranej kategorii; brak
    // wyboru daje `null`, a nie nazwę przypadkowej kategorii z listy.
    render(
      <PostDetailsPanel
        formApi={api({ selectedCats: [] })}
        data={data()}
        routeSlug="moj-wpis"
        uiLang="pl"
        autoReadMinutes={autoReadMinutes}
        taxonomy={taxonomy}
        layoutCard={null}
        detailsTab="seo"
        onDetailsTabChange={vi.fn()}
        onGoToContent={vi.fn()}
      />,
    );
    expect(props("SeoPanel").ogKicker).toBeNull();
  });

  it("problemy SEO wracają do formularza tą samą drogą", () => {
    const formApi = api();
    render(
      <PostDetailsPanel
        formApi={formApi}
        data={data()}
        routeSlug="moj-wpis"
        uiLang="pl"
        autoReadMinutes={autoReadMinutes}
        taxonomy={taxonomy}
        layoutCard={null}
        detailsTab="seo"
        onDetailsTabChange={vi.fn()}
        onGoToContent={vi.fn()}
      />,
    );
    expect(props("SeoPanel").onIssuesChange).toBe((formApi as unknown as Api).setSeoIssues);
  });
});

describe("PostContentEditor - kanwa bloków", () => {
  const renderBlocks = (globalLayout?: unknown) => {
    const formApi = api({ form: postForm({ editor: "blocks" }) });
    render(
      <PostContentEditor
        formApi={formApi}
        data={data()}
        routeSlug="moj-wpis"
        uiLang="pl"
        autoReadMinutes={autoReadMinutes}
        taxonomy={taxonomy}
        globalLayout={globalLayout as never}
        ov={{} as never}
        currentFormat={"standard" as never}
        layoutCard={null}
      />,
    );
    return formApi as unknown as Api;
  };

  it("zmiana dokumentu bloków zapisuje się do formularza", () => {
    const formApi = renderBlocks();
    (props("PostBlockEditor").onChange as (v: unknown) => void)({ pl: { version: 1, blocks: [] } });
    expect(formApi.set).toHaveBeenCalledWith("blocks_data", { pl: { version: 1, blocks: [] } });
  });

  it("BEZ ustawień layoutu kanwa idzie bez obudowy", () => {
    // Brak globalnych ustawień nie może wysypać edytora - kanwa renderuje się
    // wtedy „goła", bez podglądu układu wpisu.
    renderBlocks(undefined);
    const wrap = props("PostBlockEditor").canvasWrap as (c: unknown, l: string) => unknown;
    expect(wrap(<div data-testid="canvas" />, "pl")).toEqual(<div data-testid="canvas" />);
  });

  it("panel dokumentu jest zestawem kart w zakresie `document`", () => {
    // `documentPane` jedzie jako ELEMENT, ktory renderuje dopiero edytor blokow -
    // probe sie nie wykona, wiec czytamy propy prosto z elementu. Zakres
    // `document` to superset: layout, taksonomia, dostep i historia wersji.
    renderBlocks();
    const pane = props("PostBlockEditor").documentPane as {
      props: { scope: string; routeSlug: string };
    };
    expect(pane.props.scope).toBe("document");
    expect(pane.props.routeSlug).toBe("moj-wpis");
  });
});

describe("PostContentEditor - obudowa kanwy layoutem wpisu", () => {
  const GLOBAL_LAYOUT = {
    presets: [],
    defaults: {},
  } as unknown as Parameters<typeof PostContentEditor>[0]["globalLayout"];

  const renderWithLayout = (form = postForm({ editor: "blocks" })) => {
    const formApi = api({ form });
    render(
      <PostContentEditor
        formApi={formApi}
        data={data()}
        routeSlug="moj-wpis"
        uiLang="pl"
        autoReadMinutes={autoReadMinutes}
        taxonomy={taxonomy}
        globalLayout={GLOBAL_LAYOUT}
        ov={{} as never}
        currentFormat={"standard" as never}
        layoutCard={null}
      />,
    );
    return formApi as unknown as Api;
  };

  it("Z ustawieniami layoutu kanwa dostaje podgląd układu wpisu", () => {
    // To jest sens tej obudowy: redaktor pisze w kanwie, ale widzi ją w takim
    // kadrze, w jakim zobaczy ją czytelnik.
    renderWithLayout();
    const wrap = props("PostBlockEditor").canvasWrap as (c: unknown, l: string) => unknown;
    const wrapped = wrap(<div data-testid="canvas" />, "pl");
    // Wynik NIE jest gołą kanwą - został owinięty.
    expect(wrapped).not.toEqual(<div data-testid="canvas" />);
  });

  it("obudowa bierze tytuł i zajawkę WŁAŚCIWEGO języka kanwy", () => {
    // Kanwa angielska w polskim kadrze pokazywałaby redaktorowi nie ten wpis,
    // który pisze.
    renderWithLayout(
      postForm({
        editor: "blocks",
        title_pl: "Polski tytuł",
        title_en: "English title",
        excerpt_pl: "Zajawka PL",
        excerpt_en: "Excerpt EN",
      }),
    );
    const wrap = props("PostBlockEditor").canvasWrap as (
      c: unknown,
      l: string,
    ) => { props: Record<string, unknown> };

    expect(wrap(<div />, "pl").props).toMatchObject({
      title: "Polski tytuł",
      excerpt: "Zajawka PL",
    });
    expect(wrap(<div />, "en").props).toMatchObject({
      title: "English title",
      excerpt: "Excerpt EN",
    });
  });

  it("PRZYPISY z podglądu piszą do SWOJEGO języka, nie kasują drugiego", () => {
    // `AutoFootnotesPreview` numeruje przypisy w dokumencie i oddaje poprawioną
    // wersję. Zapis `set("blocks_data", nextDoc)` zamiast scalenia wymazałby
    // dokument DRUGIEGO języka - i redaktor traciłby całą wersję EN przy
    // pierwszym przypisie dodanym po polsku.
    const formApi = renderWithLayout(
      postForm({
        editor: "blocks",
        blocks_data: {
          pl: { version: 1, blocks: [] },
          en: { version: 1, blocks: [{ id: "en-1" }] },
        } as never,
      }),
    );
    const wrap = props("PostBlockEditor").canvasWrap as (c: unknown, l: string) => React.JSX.Element;

    // Kadr trzeba ZAMONTOWAĆ - dopiero wtedy istnieje podgląd przypisów.
    render(wrap(<div data-testid="canvas" />, "pl"));
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
    (props("AutoFootnotesPreview").onChange as (d: unknown) => void)({
      version: 1,
      blocks: [{ id: "pl-1" }],
    });

    expect(formApi.set).toHaveBeenCalledWith("blocks_data", {
      pl: { version: 1, blocks: [{ id: "pl-1" }] },
      en: { version: 1, blocks: [{ id: "en-1" }] },
    });
  });

  it("podgląd przypisów na PUSTYM dokumencie startuje od pustej pary", () => {
    // `blocks_data: null` to stan nowego wpisu; bez domyślnej pary zapis
    // przypisu poleciałby na `undefined`.
    const formApi = renderWithLayout(postForm({ editor: "blocks", blocks_data: null }));
    const wrap = props("PostBlockEditor").canvasWrap as (c: unknown, l: string) => React.JSX.Element;

    render(wrap(<div />, "en"));
    (props("AutoFootnotesPreview").onChange as (d: unknown) => void)({ version: 1, blocks: [] });

    const [, value] = formApi.set.mock.calls.at(-1) as [string, Record<string, unknown>];
    expect(Object.keys(value)).toEqual(["pl", "en"]);
    expect(value.en).toEqual({ version: 1, blocks: [] });
  });

  it("brakujący tytuł w jednym języku podstawia tytuł z drugiego", () => {
    // Pusty nagłówek w kadrze podglądu wyglądałby jak usterka układu, a jest
    // tylko brakiem tłumaczenia.
    renderWithLayout(postForm({ editor: "blocks", title_en: "", title_pl: "Tylko polski" }));
    const wrap = props("PostBlockEditor").canvasWrap as (
      c: unknown,
      l: string,
    ) => { props: Record<string, unknown> };
    expect(wrap(<div />, "en").props).toMatchObject({ title: "Tylko polski" });
  });
});

// ---------------------------------------------------------------------------
// PostContentEditor - reszta kontraktu kroku treści
// ---------------------------------------------------------------------------

describe("PostContentEditor - brak formularza i wybór obrazka", () => {
  const renderEditor = (form: unknown, editor = "richtext") => {
    const formApi = api({ form: form as never });
    const view = render(
      <PostContentEditor
        formApi={formApi}
        data={data()}
        routeSlug="moj-wpis"
        uiLang="pl"
        autoReadMinutes={autoReadMinutes}
        taxonomy={taxonomy}
        globalLayout={undefined}
        ov={{} as never}
        currentFormat={"standard" as never}
        layoutCard={null}
      />,
    );
    void editor;
    return view;
  };

  it("BEZ formularza krok treści nie renderuje NICZEGO", () => {
    // Wpis jeszcze się wczytuje. Zamontowany edytor bloków na pustym stanie
    // odpalałby własne zapytania i mógłby zapisać pusty dokument.
    const view = renderEditor(null);
    expect(view.container).toBeEmptyDOMElement();
  });

  it("WYBÓR OBRAZKA idzie przez pytanie o adres z podpisami z i18n", () => {
    // To awaryjna ścieżka trybów tekstowych (bloki mają własną bibliotekę
    // mediów). Bez podpisów z i18n redaktor EN dostałby polski komunikat.
    renderEditor(postForm({ editor: "richtext" }));

    const pick = props("PostEditor").onPickImage as () => Promise<string | null>;
    void pick();

    expect(h.prompt as ReturnType<typeof vi.fn>).toHaveBeenCalledWith({
      title: "admin.imageUrlTitle",
      placeholder: "https://…",
      confirmLabel: "admin.insert",
    });
  });
});
