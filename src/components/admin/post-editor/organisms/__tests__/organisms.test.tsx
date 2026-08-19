// Organizmy edytora wpisu — cienkie adaptery między stanem formularza
// a molekułami i zewnętrznymi edytorami. Cały katalog stał na 0%.
//
// Adapter jest cienki, ale niesie dokładnie te dwie rzeczy, których nikt inny
// nie pilnuje:
//
//   1. STRAŻNIK `if (!form) return null`. Formularz jest `null`, dopóki wiersz
//      wpisu się nie wczyta. Bez strażnika każdy z tych organizmów wysypywałby
//      się przy pierwszym renderze trasy — a wpis dużego serwisu wczytuje się
//      zauważalnie długo.
//   2. MAPOWANIE POLA NA POLE. Adapter tłumaczy `PostForm` na propy molekuły,
//      więc pomyłka jednego pola (PL zamiast EN, `tts_voice_pl` zamiast
//      `tts_voice_en`) jest niewidoczna w typach i cicha w interfejsie — a
//      zapisuje tekst do niewłaściwej kolumny.
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { postEditorData, postEditorFormApi, postForm } from "@/test/post-editor/fixtures";

const h = vi.hoisted(() => ({
  captured: {} as Record<string, unknown>,
  // Lista WSZYSTKICH instancji znacznika - `captured` trzyma tylko ostatnia,
  // a siatka taksonomii renderuje te sama molekule dwa razy (programy, regiony).
  all: {} as Record<string, unknown[]>,
  renditions: undefined as unknown,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(),
);
vi.mock("@/lib/i18n-admin-post-panes", () => ({}));

vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

/** Znacznik zastępujący ciężki komponent zewnętrzny; zapisuje otrzymane propy. */
function probe(name: string) {
  return (props: Record<string, unknown>) => {
    h.captured[name] = props;
    (h.all[name] ??= []).push(props);
    return <div data-testid={name} />;
  };
}

vi.mock("@/components/admin/AudioPicker", () => ({
  AudioPicker: ({ label, value, onChange }: Record<string, unknown>) => (
    <input
      aria-label={label as string}
      value={(value as string) ?? ""}
      onChange={(e) => (onChange as (v: string) => void)(e.target.value)}
    />
  ),
}));
vi.mock("@/lib/audio/ttsRenditions", () => ({
  usePostTtsRenditions: () => ({ data: h.renditions }),
}));
// `SidebarSection` domyslnie startuje ZWINIETA, wiec jej dzieci nie sa
// renderowane - a to wlasnie na nich stoja asercje mapowania propow. Zwijanie
// ma wlasny test w `atoms/__tests__`, wiec tutaj rozwijamy sekcje na stale.
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
    TtsVoiceCard: probe("TtsVoiceCard"),
    TranslateCard: probe("TranslateCard"),
    LayoutOverridesCard: probe("LayoutOverridesCard"),
    CategoriesCard: probe("CategoriesCard"),
    TagsCard: probe("TagsCard"),
    BilingualPickerCard: probe("BilingualPickerCard"),
  };
});
vi.mock("@/components/admin/CustomMetaValuesEditor", () => ({
  CustomMetaValuesEditor: probe("CustomMetaValuesEditor"),
}));
vi.mock("@/components/admin/RelatedOverrideEditor", () => ({
  RelatedOverrideEditor: probe("RelatedOverrideEditor"),
}));
vi.mock("@/components/admin/PostSettingsMetabox", () => ({
  TakeawaysTab: probe("TakeawaysTab"),
}));
vi.mock("@/components/admin/builder/Builder", () => ({ Builder: probe("Builder") }));
vi.mock("@/lib/builder/labelsEn", () => ({ useAdminLang: () => "en" }));

import { AudioSection } from "../AudioSection";
import { CustomMetaSection } from "../CustomMetaSection";
import { RelatedSection } from "../RelatedSection";
import { TakeawaysSection } from "../TakeawaysSection";
import { PostTranslateCard } from "../PostTranslateCard";
import { PostLayoutCard } from "../PostLayoutCard";
import { PostTaxonomyGrid } from "../PostTaxonomyGrid";
import { BuilderPane } from "../BuilderPane";
import * as barrel from "../index";

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
  postEditorFormApi(over) as unknown as Parameters<typeof AudioSection>[0]["formApi"];
const props = (name: string) => h.captured[name] as Record<string, unknown>;

afterEach(() => {
  cleanup();
  h.captured = {};
  h.all = {};
  h.renditions = undefined;
});

// ---------------------------------------------------------------------------
// Strażnik pustego formularza
// ---------------------------------------------------------------------------

describe("organizmy - strażnik `if (!form) return null`", () => {
  it("KAŻDY organizm zależny od formularza renderuje pustkę, gdy wpis się nie wczytał", () => {
    // Formularz jest `null` do czasu wczytania wiersza. Brak strażnika
    // wysypywałby trasę przy pierwszym renderze.
    const empty = api({ form: null });
    const data = postEditorData() as unknown as Parameters<typeof CustomMetaSection>[0]["data"];

    for (const [name, node] of [
      ["AudioSection", <AudioSection key="a" formApi={empty} />],
      ["CustomMetaSection", <CustomMetaSection key="c" formApi={empty} data={data} />],
      ["RelatedSection", <RelatedSection key="r" formApi={empty} />],
      ["TakeawaysSection", <TakeawaysSection key="t" formApi={empty} />],
      ["PostTranslateCard", <PostTranslateCard key="p" formApi={empty} />],
    ] as const) {
      const { container } = render(node);
      expect(container.textContent?.trim(), name).toBe("");
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AudioSection
// ---------------------------------------------------------------------------

describe("AudioSection", () => {
  it("pole PL zapisuje do audio_url_pl, pole EN do audio_url_en", () => {
    // Pomyłka strony językowej podmienia nagranie pod drugim językiem -
    // czytelnik dostaje lektora czytającego nie w tym języku, co tekst.
    const formApi = api();
    render(<AudioSection formApi={formApi} />);

    fireEvent.change(screen.getByLabelText("adminPostPanes.sections.audioPlLabel"), {
      target: { value: "https://cdn/pl.mp3" },
    });
    fireEvent.change(screen.getByLabelText("adminPostPanes.sections.audioEnLabel"), {
      target: { value: "https://cdn/en.mp3" },
    });

    const set = (formApi as unknown as Api).set as ReturnType<typeof vi.fn>;
    expect(set).toHaveBeenCalledWith("audio_url_pl", "https://cdn/pl.mp3");
    expect(set).toHaveBeenCalledWith("audio_url_en", "https://cdn/en.mp3");
  });

  it("wyczyszczenie pola zapisuje `null`, nie pusty string", () => {
    // Pusty string w kolumnie wygląda jak „jest nagranie", więc publiczny
    // odtwarzacz renderowałby się z pustym źródłem.
    const formApi = api({ form: postForm({ audio_url_pl: "https://cdn/pl.mp3" }) });
    render(<AudioSection formApi={formApi} />);

    fireEvent.change(screen.getByLabelText("adminPostPanes.sections.audioPlLabel"), {
      target: { value: "" },
    });

    expect((formApi as unknown as Api).set).toHaveBeenCalledWith("audio_url_pl", null);
  });

  it("zmiana głosu trafia do kolumny WŁAŚCIWEGO języka", () => {
    const formApi = api();
    render(<AudioSection formApi={formApi} />);

    const onVoiceChange = props("TtsVoiceCard").onVoiceChange as (
      lang: string,
      id: string | null,
    ) => void;
    onVoiceChange("en", "voice-en");
    onVoiceChange("pl", "voice-pl");

    const set = (formApi as unknown as Api).set as ReturnType<typeof vi.fn>;
    expect(set).toHaveBeenCalledWith("tts_voice_en", "voice-en");
    expect(set).toHaveBeenCalledWith("tts_voice_pl", "voice-pl");
  });

  it("WGRANY plik ma pierwszeństwo - karta lektora o tym wie", () => {
    // Gdy plik jest wgrany, ElevenLabs nie jest wołany w ogóle. Karta lektora
    // musi dostać tę informację, żeby nie proponować generowania.
    render(
      <AudioSection formApi={api({ form: postForm({ audio_url_pl: "  https://x.mp3  " }) })} />,
    );
    expect(props("TtsVoiceCard").uploadedPl).toBe(true);
    expect(props("TtsVoiceCard").uploadedEn).toBe(false);
  });

  it("adres złożony z samych spacji NIE liczy się jako wgrany plik", () => {
    render(<AudioSection formApi={api({ form: postForm({ audio_url_pl: "   " }) })} />);
    expect(props("TtsVoiceCard").uploadedPl).toBe(false);
  });

  it("przekazuje nagrania z prywatnego cache do karty lektora", () => {
    h.renditions = [{ lang: "pl", status: "ready" }];
    render(<AudioSection formApi={api()} />);
    expect(props("TtsVoiceCard").renditions).toEqual([{ lang: "pl", status: "ready" }]);
  });
});

// ---------------------------------------------------------------------------
// Sekcje delegujące
// ---------------------------------------------------------------------------

describe("CustomMetaSection", () => {
  it("edytor wartości dostaje tenanta AKTYWNEGO obszaru roboczego", () => {
    // Definicje pól meta są tenant-scoped; zły tenant pokazałby pola obcej firmy.
    const data = postEditorData() as unknown as Parameters<typeof CustomMetaSection>[0]["data"];
    render(<CustomMetaSection formApi={api()} data={data} />);
    expect(props("CustomMetaValuesEditor").tenantId).toBe(postEditorData().tenantId);
  });

  it("zmiana wartości zapisuje się do custom_meta", () => {
    const formApi = api();
    const data = postEditorData() as unknown as Parameters<typeof CustomMetaSection>[0]["data"];
    render(<CustomMetaSection formApi={formApi} data={data} />);

    (props("CustomMetaValuesEditor").onChange as (v: unknown) => void)({ x: 1 });

    expect((formApi as unknown as Api).set).toHaveBeenCalledWith("custom_meta", { x: 1 });
  });

  it("prowadzi do definicji pól meta osobnym linkiem", () => {
    const data = postEditorData() as unknown as Parameters<typeof CustomMetaSection>[0]["data"];
    render(<CustomMetaSection formApi={api()} data={data} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/admin/custom-meta");
  });
});

describe("RelatedSection", () => {
  it("nadpisanie powiązanych zapisuje się do related_override", () => {
    const formApi = api();
    render(<RelatedSection formApi={formApi} />);

    (props("RelatedOverrideEditor").onChange as (v: unknown) => void)({ ids: ["p1"] });

    expect((formApi as unknown as Api).set).toHaveBeenCalledWith("related_override", {
      ids: ["p1"],
    });
  });

  it("wyczyszczenie nadpisania zapisuje null (powrót do reguły globalnej)", () => {
    const formApi = api();
    render(<RelatedSection formApi={formApi} />);

    (props("RelatedOverrideEditor").onChange as (v: unknown) => void)(null);

    expect((formApi as unknown as Api).set).toHaveBeenCalledWith("related_override", null);
  });
});

describe("TakeawaysSection", () => {
  it("wnioski PL i EN idą do OSOBNYCH kolumn", () => {
    const formApi = api();
    render(<TakeawaysSection formApi={formApi} />);

    const onChange = props("TakeawaysTab").onChange as (lang: string, v: string[]) => void;
    onChange("pl", ["Nowy wniosek"]);
    onChange("en", ["New takeaway"]);

    const set = (formApi as unknown as Api).set as ReturnType<typeof vi.fn>;
    expect(set).toHaveBeenCalledWith("takeaways_pl", ["Nowy wniosek"]);
    expect(set).toHaveBeenCalledWith("takeaways_en", ["New takeaway"]);
  });

  it("brak wniosków przechodzi jako pusta tablica, nie undefined", () => {
    // `TakeawaysTab` mapuje po tej wartości.
    render(<TakeawaysSection formApi={api({ form: postForm({ takeaways_pl: null as never }) })} />);
    expect(props("TakeawaysTab").pl).toEqual([]);
  });

  it("wariant prezentacji zapisuje się osobno", () => {
    const formApi = api();
    render(<TakeawaysSection formApi={formApi} />);

    (props("TakeawaysTab").onVariantChange as (v: string) => void)("list");

    expect((formApi as unknown as Api).set).toHaveBeenCalledWith("takeaways_variant", "list");
  });
});

// ---------------------------------------------------------------------------
// PostTranslateCard
// ---------------------------------------------------------------------------

describe("PostTranslateCard - źródło tłumaczenia zależy od SILNIKA edytora", () => {
  it("edytor blokowy oddaje bloki PL, a NIE HTML", () => {
    // Wysłanie HTML-a z edytora blokowego przetłumaczyłoby pustą wartość -
    // treść siedzi w dokumencie bloków, nie w `content_pl`.
    render(
      <PostTranslateCard
        formApi={api({
          form: postForm({
            editor: "blocks",
            content_pl: "<p>stary html</p>",
            blocks_data: {
              pl: { version: 1, blocks: [{ type: "paragraph", text: "Akapit" }] },
            } as never,
          }),
        })}
      />,
    );

    const source = props("TranslateCard").source as Record<string, unknown>;
    expect(source.content_pl).toBeNull();
    expect(source.blocks_pl).toEqual([{ type: "paragraph", text: "Akapit" }]);
  });

  it("edytor tekstowy oddaje HTML, a NIE bloki", () => {
    render(
      <PostTranslateCard
        formApi={api({ form: postForm({ editor: "richtext", content_pl: "<p>Treść</p>" }) })}
      />,
    );

    const source = props("TranslateCard").source as Record<string, unknown>;
    expect(source.content_pl).toBe("<p>Treść</p>");
    expect(source.blocks_pl).toBeNull();
  });

  it("markdown też oddaje treść tekstową", () => {
    render(
      <PostTranslateCard
        formApi={api({ form: postForm({ editor: "markdown", content_pl: "# Tytuł" }) })}
      />,
    );
    expect((props("TranslateCard").source as Record<string, unknown>).content_pl).toBe("# Tytuł");
  });

  it("builder nie oddaje ani HTML-a, ani bloków", () => {
    render(
      <PostTranslateCard
        formApi={api({ form: postForm({ editor: "builder", content_pl: "<p>x</p>" }) })}
      />,
    );
    const source = props("TranslateCard").source as Record<string, unknown>;
    expect(source.content_pl).toBeNull();
    expect(source.blocks_pl).toBeNull();
  });

  it("wykrywa ISTNIEJĄCĄ treść EN, żeby ostrzec przed nadpisaniem", () => {
    render(<PostTranslateCard formApi={api({ form: postForm({ title_en: "English title" }) })} />);
    expect(props("TranslateCard").hasEnContent).toBe(true);
    cleanup();

    render(<PostTranslateCard formApi={api({ form: postForm({ title_en: "   " }) })} />);
    expect(props("TranslateCard").hasEnContent).toBe(false);
  });

  it("puste bloki EN nie liczą się jako istniejąca treść", () => {
    render(
      <PostTranslateCard
        formApi={api({
          form: postForm({
            title_en: "",
            blocks_data: { en: { version: 1, blocks: [] } } as never,
          }),
        })}
      />,
    );
    expect(props("TranslateCard").hasEnContent).toBe(false);
  });

  it("wynik tłumaczenia wchodzi JEDNĄ zmianą historii (undo cofa całość)", () => {
    // Rozbicie na osiem osobnych `set` kazałoby redaktorowi cofać osiem razy.
    const formApi = api();
    render(<PostTranslateCard formApi={formApi} />);

    (props("TranslateCard").onTranslated as (r: Record<string, unknown>) => void)({
      title_en: "New title",
      excerpt_en: "New excerpt",
      takeaways_en: ["A"],
      seo_title_en: "SEO",
      seo_description_en: "SEO desc",
      content_en: "<p>EN</p>",
      blocks_en: null,
    });

    const historySet = (formApi as unknown as Api).history as { set: ReturnType<typeof vi.fn> };
    expect(historySet.set).toHaveBeenCalledTimes(1);
  });

  it("puste pola wyniku NIE kasują istniejącej treści EN", () => {
    // Tłumaczenie, które nie zwróciło zajawki, nie może wyczyścić tej, która
    // już jest napisana ręcznie.
    const formApi = api({ form: postForm({ title_en: "Stary EN", excerpt_en: "Stara zajawka" }) });
    render(<PostTranslateCard formApi={formApi} />);

    (props("TranslateCard").onTranslated as (r: Record<string, unknown>) => void)({
      title_en: "",
      excerpt_en: null,
      takeaways_en: [],
      seo_title_en: null,
      seo_description_en: null,
      content_en: null,
      blocks_en: null,
    });

    const historySet = (formApi as unknown as Api).history as { set: ReturnType<typeof vi.fn> };
    const updater = historySet.set.mock.calls[0][0] as (p: unknown) => Record<string, unknown>;
    const next = updater(postForm({ title_en: "Stary EN", excerpt_en: "Stara zajawka" }));
    expect(next.title_en).toBe("Stary EN");
    expect(next.excerpt_en).toBe("Stara zajawka");
  });

  it("aktualizator na pustym stanie zwraca go bez zmian", () => {
    const formApi = api();
    render(<PostTranslateCard formApi={formApi} />);
    (props("TranslateCard").onTranslated as (r: Record<string, unknown>) => void)({
      title_en: "x",
      takeaways_en: [],
    });
    const historySet = (formApi as unknown as Api).history as { set: ReturnType<typeof vi.fn> };
    const updater = historySet.set.mock.calls[0][0] as (p: unknown) => unknown;
    expect(updater(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PostLayoutCard / PostTaxonomyGrid / BuilderPane
// ---------------------------------------------------------------------------

describe("PostLayoutCard", () => {
  const base = {
    ov: {} as never,
    onOverridesChange: vi.fn(),
    currentFormat: "standard" as never,
    layoutSet: [] as never,
    globalLayout: undefined,
  };

  it("format wpisu jedzie z formularza i wraca do niego", () => {
    const formApi = api();
    render(<PostLayoutCard formApi={formApi} {...base} />);

    expect(props("LayoutOverridesCard").postFormat).toBe("standard");
    (props("LayoutOverridesCard").onPostFormatChange as (v: string) => void)("gallery");
    expect((formApi as unknown as Api).set).toHaveBeenCalledWith("post_format", "gallery");
  });

  it("bez formularza nie renderuje karty", () => {
    const { container } = render(<PostLayoutCard formApi={api({ form: null })} {...base} />);
    expect(container.textContent?.trim()).toBe("");
  });
});

describe("PostTaxonomyGrid", () => {
  const render1 = (grid?: boolean) => {
    const formApi = api();
    const data = postEditorData() as unknown as Parameters<typeof PostTaxonomyGrid>[0]["data"];
    const taxonomy = {
      newCatPl: "",
      setNewCatPl: vi.fn(),
      newCatEn: "",
      setNewCatEn: vi.fn(),
      newTagName: "",
      setNewTagName: vi.fn(),
      taxonomyBusy: null,
      addCategory: vi.fn(),
      addTag: vi.fn(),
    } as unknown as Parameters<typeof PostTaxonomyGrid>[0]["taxonomy"];
    render(<PostTaxonomyGrid formApi={formApi} data={data} taxonomy={taxonomy} grid={grid} />);
    return { formApi, taxonomy };
  };

  it("renderuje cztery karty taksonomii", () => {
    render1();
    expect(screen.getByTestId("CategoriesCard")).toBeInTheDocument();
    expect(screen.getByTestId("TagsCard")).toBeInTheDocument();
    // Programy i regiony dzielą jedną molekułę dwujęzyczną.
    expect(screen.getAllByTestId("BilingualPickerCard")).toHaveLength(2);
  });

  it("opcje pochodzą z tenant-scoped warstwy danych", () => {
    // Jeden obszar roboczy nie może zobaczyć taksonomii innego.
    render1();
    expect(props("CategoriesCard").allCats).toEqual(postEditorData().allCats);
    expect(props("TagsCard").allTags).toEqual(postEditorData().allTags);
  });

  it("wariant `grid` opakowuje karty w siatkę dwukolumnową", () => {
    const { container } = render(<div />);
    cleanup();
    render1(true);
    expect(document.querySelector("div.grid")).not.toBeNull();
    expect(container).toBeDefined();
  });

  it("bez `grid` karty idą płasko (do sidebara)", () => {
    render1(false);
    expect(document.querySelector("div.grid")).toBeNull();
  });
});

describe("BuilderPane", () => {
  it("kanwa startuje w JĘZYKU PANELU, nie zawsze po polsku", () => {
    // Angielski administrator nie może lądować na polskiej zakładce treści.
    const set = vi.fn();
    render(<BuilderPane form={{ builder_data: null }} set={set} />);
    expect(props("Builder").lang).toBe("en");
  });

  it("zmiana dokumentu zapisuje się do builder_data", () => {
    const set = vi.fn();
    render(<BuilderPane form={{ builder_data: null }} set={set} />);

    (props("Builder").onChange as (v: unknown) => void)({ version: 1, sections: [] });

    expect(set).toHaveBeenCalledWith("builder_data", { version: 1, sections: [] });
  });

  it("przełączenie języka kanwy jest lokalne (nie dotyka formularza)", () => {
    const set = vi.fn();
    render(<BuilderPane form={{ builder_data: null }} set={set} />);

    (props("Builder").onLangChange as (v: string) => void)("pl");

    expect(set).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Barrel
// ---------------------------------------------------------------------------

describe("barrel organizmów", () => {
  it("eksportuje KAŻDY organizm katalogu", () => {
    // Brakujący re-eksport ujawnia się dopiero przy imporcie w trasie.
    for (const name of [
      "PostEditorHeader",
      "PostDetailsNav",
      "PostSettingsCard",
      "PostTranslateCard",
      "PostLayoutCard",
      "PostTaxonomyGrid",
      "TakeawaysSection",
      "AudioSection",
      "CustomMetaSection",
      "RelatedSection",
      "PostSidebarBundle",
      "BuilderPane",
      "PostDetailsPanel",
      "PostContentEditor",
    ]) {
      expect(barrel, name).toHaveProperty(name);
    }
  });
});

describe("PostTaxonomyGrid - callbacki kart", () => {
  const setup = () => {
    const formApi = api();
    const data = postEditorData() as unknown as Parameters<typeof PostTaxonomyGrid>[0]["data"];
    const taxonomy = {
      newCatPl: "",
      setNewCatPl: vi.fn(),
      newCatEn: "",
      setNewCatEn: vi.fn(),
      newTagName: "",
      setNewTagName: vi.fn(),
      taxonomyBusy: null,
      addCategory: vi.fn(async () => undefined),
      addTag: vi.fn(async () => undefined),
    };
    render(
      <PostTaxonomyGrid
        formApi={formApi}
        data={data}
        taxonomy={taxonomy as unknown as Parameters<typeof PostTaxonomyGrid>[0]["taxonomy"]}
      />,
    );
    return { formApi: formApi as unknown as Api, taxonomy };
  };

  it("wybór kategorii i tagów wraca do WŁAŚCIWEGO settera", () => {
    // Zamienione settery przypisałyby tagi jako kategorie - i odwrotnie.
    const { formApi } = setup();

    (props("CategoriesCard").onSelectedCatsChange as (v: string[]) => void)(["cat-1"]);
    (props("TagsCard").onSelectedTagsChange as (v: string[]) => void)(["tag-1"]);

    expect(formApi.setSelectedCats).toHaveBeenCalledWith(["cat-1"]);
    expect(formApi.setSelectedTags).toHaveBeenCalledWith(["tag-1"]);
  });

  it("tworzenie inline woła akcję taksonomii, nie zapis formularza", () => {
    // Kategoria powstaje osobnym INSERT-em (tenant-scoped), a nie jako część
    // zapisu wpisu - inaczej nowa kategoria nie istniałaby do czasu zapisu.
    const { taxonomy, formApi } = setup();

    (props("CategoriesCard").onAddCategory as () => void)();
    (props("TagsCard").onAddTag as () => void)();

    expect(taxonomy.addCategory).toHaveBeenCalledTimes(1);
    expect(taxonomy.addTag).toHaveBeenCalledTimes(1);
    expect(formApi.set).not.toHaveBeenCalled();
  });

  it("pola nowej kategorii/tagu są sterowane ze stanu taksonomii", () => {
    const { taxonomy } = setup();

    (props("CategoriesCard").onNewCatPlChange as (v: string) => void)("Nowa");
    (props("CategoriesCard").onNewCatEnChange as (v: string) => void)("New");
    (props("TagsCard").onNewTagNameChange as (v: string) => void)("tag");

    expect(taxonomy.setNewCatPl).toHaveBeenCalledWith("Nowa");
    expect(taxonomy.setNewCatEn).toHaveBeenCalledWith("New");
    expect(taxonomy.setNewTagName).toHaveBeenCalledWith("tag");
  });

  it("programy i regiony piszą do SWOICH setterów", () => {
    const { formApi } = setup();
    const [programs, regions] = h.all.BilingualPickerCard as Array<Record<string, unknown>>;

    (programs.onSelectedChange as (v: string[]) => void)(["prog-1"]);
    (regions.onSelectedChange as (v: string[]) => void)(["reg-1"]);

    expect(formApi.setSelectedPrograms).toHaveBeenCalledWith(["prog-1"]);
    expect(formApi.setSelectedRegions).toHaveBeenCalledWith(["reg-1"]);
  });
});
