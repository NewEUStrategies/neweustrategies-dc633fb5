// Zestaw kart dokumentu (`PostSidebarBundle`, 0%) - ten sam organizm w DWoCH
// zakresach: zakladka „Publikacja" (scope="publish") i panel dokumentu edytora
// blokow (scope="document", superset z layoutem, taksonomia, dostepem
// i historia wersji).
//
// Zakres jest tu jedyna regula: pomylka wpuszcza karty dokumentu do waskiej
// zakladki publikacji (cztery dodatkowe zrodla danych odpytywane bez potrzeby)
// albo odwrotnie - zabiera redaktorowi dostep do historii wersji z panelu, w
// ktorym realnie pracuje nad trescia.
//
// Plik jest osobny, bo `panels.test.tsx` ATRAPUJE ten modul na potrzeby testow
// `PostDetailsPanel` - nie da sie w jednym pliku testowac atrapy i oryginalu.
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { postEditorData, postEditorFormApi } from "@/test/post-editor/fixtures";

const h = vi.hoisted(() => ({ captured: {} as Record<string, unknown> }));

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
vi.mock("@/components/admin/builder/Builder", () => ({ Builder: probe("Builder") }));
vi.mock("@/lib/builder/labelsEn", () => ({ useAdminLang: () => "pl" }));
vi.mock("../PostSettingsCard", () => ({ PostSettingsCard: probe("PostSettingsCard") }));
vi.mock("../PostTranslateCard", () => ({ PostTranslateCard: probe("PostTranslateCard") }));
vi.mock("../PostTaxonomyGrid", () => ({ PostTaxonomyGrid: probe("PostTaxonomyGrid") }));
vi.mock("../AudioSection", () => ({ AudioSection: probe("AudioSection") }));
vi.mock("../TakeawaysSection", () => ({ TakeawaysSection: probe("TakeawaysSection") }));
vi.mock("../CustomMetaSection", () => ({ CustomMetaSection: probe("CustomMetaSection") }));
vi.mock("../RelatedSection", () => ({ RelatedSection: probe("RelatedSection") }));
// `SidebarSection` startuje ZWINIETA dla wiekszosci kart, wiec jej dzieci nie
// sa renderowane. Zwijanie ma wlasny test w `atoms/__tests__`; tutaj przedmiotem
// testu jest ZESTAW kart, wiec rozwijamy sekcje na stale.
vi.mock("../../atoms", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    SidebarSection: ({ title, children }: { title: string; children: unknown }) => (
      <section aria-label={title}>{children as never}</section>
    ),
  };
});

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

import { PostSidebarBundle } from "../PostSidebarBundle";

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
const api = (over: Partial<Record<string, unknown>> = {}) =>
  postEditorFormApi(over) as unknown as Parameters<typeof PostSidebarBundle>[0]["formApi"];
const data = () => postEditorData() as unknown as Parameters<typeof PostSidebarBundle>[0]["data"];
const props = (name: string) => h.captured[name] as Record<string, unknown>;
const taxonomy = {} as unknown as Parameters<typeof PostSidebarBundle>[0]["taxonomy"];
const autoReadMinutes = { pl: 5, en: 4 } as unknown as Parameters<
  typeof PostSidebarBundle
>[0]["autoReadMinutes"];

afterEach(() => {
  cleanup();
  h.captured = {};
});

// ---------------------------------------------------------------------------
// PostSidebarBundle
// ---------------------------------------------------------------------------

describe("PostSidebarBundle - zakres decyduje o zestawie kart", () => {
  const renderBundle = (scope: "publish" | "document", formApi = api()) => {
    render(
      <PostSidebarBundle
        scope={scope}
        formApi={formApi}
        data={data()}
        routeSlug="moj-wpis"
        uiLang="pl"
        autoReadMinutes={autoReadMinutes}
        taxonomy={taxonomy}
        layoutCard={<div data-testid="layoutCard" />}
      />,
    );
  };

  it("zakres `publish` pokazuje karty wspólne, BEZ kart dokumentu", () => {
    renderBundle("publish");
    for (const common of ["PublishChecklistCard", "PostSettingsCard", "PostAuthorsCard"]) {
      expect(screen.getByTestId(common), common).toBeInTheDocument();
    }
    for (const documentOnly of ["PostTaxonomyGrid", "AccessSettingsPane", "RevisionsCard"]) {
      expect(screen.queryByTestId(documentOnly), documentOnly).toBeNull();
    }
    expect(screen.queryByTestId("layoutCard")).toBeNull();
  });

  it("zakres `document` DOKŁADA layout, taksonomię, dostęp i historię", () => {
    renderBundle("document");
    for (const extra of ["layoutCard", "PostTaxonomyGrid", "AccessSettingsPane", "RevisionsCard"]) {
      expect(screen.getByTestId(extra), extra).toBeInTheDocument();
    }
  });

  it("checklista publikacji jest ROZWINIĘTA, gdy czegoś brakuje", () => {
    // Zwinięta karta z brakami byłaby ostrzeżeniem, którego nikt nie zobaczy.
    renderBundle(
      "publish",
      api({ publishChecklist: { items: [], missingRequired: [], requiredOk: false, score: 0 } }),
    );
    expect(screen.getByTestId("PublishChecklistCard")).toBeInTheDocument();
  });

  it("bez checklisty (wpis niewczytany) nie renderuje nic", () => {
    renderBundle("document", api({ publishChecklist: null }));
    expect(screen.queryByTestId("PostSettingsCard")).toBeNull();
  });

  it("karta autorów dostaje GŁÓWNEGO autora z wiersza wpisu", () => {
    renderBundle("publish");
    expect(props("PostAuthorsCard").mainAuthorId).toBe(postEditorData().post!.author_id);
    expect(props("PostAuthorsCard").tenantId).toBe(postEditorData().tenantId);
  });

  it("historia wersji przekazuje callback odświeżenia edytora", () => {
    const formApi = api();
    renderBundle("document", formApi);
    expect(props("RevisionsCard").onRestored).toBe((formApi as unknown as Api).onRevisionRestored);
  });
});
