// Trzy edytory o najgłębszej strukturze: mega menu (kolumny -> linki ->
// karta wyróżniona), sponsorzy (poziomy -> sponsorzy) i slot obrazka
// (adres + wysyłka pliku). Tabela z `editorMatrix` dowozi im podłogę
// (render, brak wycieków, zapisy zdefiniowane); tutaj sprawdzamy REGUŁY
// zagnieżdżonej edycji, których żadna tabela nie wyrazi:
//
//  * zapis pozycji zagnieżdżonej nie może zdeptać rodzeństwa,
//  * przenoszenie na krańcach listy nie może gubić pozycji,
//  * przełączenie rodzaju kolumny wymienia zestaw pól, a nie dokłada go,
//  * usunięcie karty wyróżnionej zapisuje `null`, nie brak klucza.
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import type { Json, WidgetNode } from "@/lib/builder/types";
import { selectWithOption, optionValues } from "@/test/builder/panels";
import { MEGA_MENU_ICON_NAMES } from "@/lib/megaMenu/showcaseIcons";
import { MegaMenuEditor } from "../MegaMenuEditor";
import { SponsorsEditor } from "../SponsorsEditor";
import { ImageSlot } from "../ImageSlot";

const db: { current: SupabaseFromStub } = { current: supabaseFromStub() };
const uploadMedia = vi.hoisted(() =>
  vi.fn(async () => ({ publicUrl: "https://cdn.test/wyslany.png", mediaId: "m-1" })),
);

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});
vi.mock("@/components/ui/switch", async () => {
  const React = await import("react");
  const { radixSwitchStub } = await import("@/test/reactStubs");
  return radixSwitchStub(React);
});
// Sesja jest sterowana z testu: wysyłka pliku ma trzy różne wyniki w
// zależności od tego, kto (i czy w ogóle) jest zalogowany.
const auth = vi.hoisted(() => ({
  session: { user: { id: "u-1" } } as { user: { id: string } } | null,
  error: null as { message: string } | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => db.current.from(table),
    // Wysyłka pliku czyta sesję (identyfikator autora wysyłki idzie do audytu).
    auth: { getSession: async () => ({ data: { session: auth.session }, error: auth.error }) },
  },
}));
// Biblioteka mediów ma własny test (wyszukiwanie, paginacja, podgląd) - tutaj
// liczy się tylko to, że slot przyjmuje wybrany z niej adres.
vi.mock("@/components/admin/media/MediaPickerDialog", () => ({
  MediaPickerDialog: ({
    open,
    onPick,
  }: {
    open: boolean;
    onPick: (url: string) => void;
    onOpenChange: (v: boolean) => void;
    title: string;
  }) =>
    open ? (
      <button
        type="button"
        data-testid="wybierz-z-biblioteki"
        onClick={() => onPick("https://cdn.test/z-biblioteki.png")}
      />
    ) : null,
}));
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return { ...actual, ...serverFnStubModule(), useServerFn: () => async () => ({}) };
});
vi.mock("@/hooks/useAuth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRequiredTenant: () => "tenant-test",
    useCurrentTenantId: () => "tenant-test",
  };
});
vi.mock("@/lib/media.functions", () => ({
  createMediaFolder: async () => ({}),
  registerMediaUpload: async () => ({}),
  updateMediaMeta: async () => ({}),
}));
vi.mock("@/lib/media/upload", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, uploadAndRegisterMedia: uploadMedia };
});

type Written = Array<[string, Json]>;

function renderEditor(
  Editor: (p: {
    c: WidgetNode["content"];
    lang: "pl" | "en";
    setContent: (k: string, v: Json) => void;
  }) => ReactNode,
  c: WidgetNode["content"],
  lang: "pl" | "en" = "pl",
) {
  const written: Written = [];
  const view = renderWithQueryClient(
    <Editor c={c} lang={lang} setContent={(k, v) => written.push([k, v])} />,
  );
  return { ...view, written, last: () => written.at(-1) };
}

beforeEach(() => {
  db.current = supabaseFromStub();
  db.current.setResponse("categories", ok([{ slug: "gospodarka", name_pl: "Gospodarka" }]));
  db.current.setResponse(
    "pages",
    ok([{ id: "p1", slug: "o-nas", title_pl: "O nas", title_en: "About" }]),
  );
  uploadMedia.mockClear();
  uploadMedia.mockImplementation(async () => ({
    publicUrl: "https://cdn.test/wyslany.png",
    mediaId: "m-1",
  }));
  auth.session = { user: { id: "u-1" } };
  auth.error = null;
});

const LINK_COLUMN = {
  id: "col-1",
  kind: "links",
  title_pl: "Produkty",
  title_en: "Products",
  links: [
    { label_pl: "Pierwszy", label_en: "First", href: "/jeden", icon: "" },
    { label_pl: "Drugi", label_en: "Second", href: "/dwa", icon: "" },
  ],
};

const CATEGORY_COLUMN = {
  id: "col-2",
  kind: "category",
  title_pl: "Analizy",
  title_en: "Analyses",
  categorySlug: "gospodarka",
  postCount: 4,
  viewAllHref: "/kategoria/gospodarka",
};

describe("MegaMenuEditor - ustawienia menu", () => {
  it("zapisuje etykietę wyzwalacza pod klucz języka treści", () => {
    const { last } = renderEditor(MegaMenuEditor, {}, "en");
    const trigger = document.querySelector<HTMLInputElement>('input[placeholder="Products"]');
    if (!trigger) throw new Error("test: brak pola wyzwalacza");
    fireEvent.change(trigger, { target: { value: "Solutions" } });
    expect(last()).toEqual(["trigger_en", "Solutions"]);
  });

  it("zapisuje adres wyzwalacza", () => {
    const { last } = renderEditor(MegaMenuEditor, {});
    const href = document.querySelector<HTMLInputElement>(
      'input[placeholder="builder.megaMenuEditor.labelUrlPh"]',
    );
    if (!href) throw new Error("test: brak pola adresu");
    fireEvent.change(href, { target: { value: "/produkty" } });
    expect(last()).toEqual(["href", "/produkty"]);
  });

  it("oferuje dwa sposoby otwierania i dwa układy", () => {
    renderEditor(MegaMenuEditor, {});
    expect(optionValues(selectWithOption("click"))).toEqual(["hover", "click"]);
    expect(optionValues(selectWithOption("showcase"))).toEqual(["classic", "showcase"]);
  });

  it("zapisuje sposób otwierania i układ", () => {
    const { written } = renderEditor(MegaMenuEditor, {});
    fireEvent.change(selectWithOption("click"), { target: { value: "click" } });
    fireEvent.change(selectWithOption("showcase"), { target: { value: "showcase" } });
    expect(Object.fromEntries(written)).toMatchObject({ triggerOn: "click", layout: "showcase" });
  });

  it("szerokość stała odsłania pole pikseli", () => {
    const withFixed = renderEditor(MegaMenuEditor, { width: "fixed", widthPx: 1200 });
    const px = document.querySelector<HTMLInputElement>('input[type="number"]');
    expect(px?.value).toBe("1200");
    withFixed.unmount();

    renderEditor(MegaMenuEditor, { width: "container" });
    // Szerokość „kontener” bierze wymiar z siatki strony - pole pikseli nie ma
    // wtedy żadnego znaczenia.
    expect(document.querySelector('input[type="number"]')).toBeNull();
  });
});

describe("MegaMenuEditor - kolumny", () => {
  it("dodaje kolumnę do listy", () => {
    const { last } = renderEditor(MegaMenuEditor, {});
    fireEvent.click(screen.getByRole("button", { name: /common.add/ }));
    const [key, value] = last() ?? [];
    expect(key).toBe("columns");
    expect(Array.isArray(value)).toBe(true);
    expect((value as unknown[]).length).toBe(1);
  });

  it("przełączenie rodzaju kolumny wymienia zestaw pól", () => {
    const { last } = renderEditor(MegaMenuEditor, { columns: [LINK_COLUMN] });
    expect(screen.getByText("builder.megaMenuEditor.links")).toBeInTheDocument();
    fireEvent.change(selectWithOption("category"), { target: { value: "category" } });
    const [, value] = last() ?? [];
    expect((value as Array<Record<string, unknown>>)[0].kind).toBe("category");
  });

  it("kolumna kategorii pokazuje wybór kategorii z bazy", async () => {
    renderEditor(MegaMenuEditor, { columns: [CATEGORY_COLUMN] });
    await screen.findByRole("option", { name: "Gospodarka" });
    const select = selectWithOption("gospodarka");
    expect(select.value).toBe("gospodarka");
    expect(screen.queryByText("builder.megaMenuEditor.links")).toBeNull();
  });

  it("kolumna kategorii zapisuje slug, liczbę wpisów i adres archiwum", async () => {
    const { written } = renderEditor(MegaMenuEditor, { columns: [CATEGORY_COLUMN] });
    await screen.findByRole("option", { name: "Gospodarka" });
    fireEvent.change(selectWithOption("gospodarka"), { target: { value: "__none" } });
    const numbers = document.querySelectorAll<HTMLInputElement>('input[type="number"]');
    fireEvent.change(numbers[numbers.length - 1], { target: { value: "8" } });
    const cols = () => (written.at(-1)?.[1] as Array<Record<string, unknown>> | undefined) ?? [];
    expect(cols()[0].postCount).toBe(8);
    const clearedSlug = written.find(
      ([, v]) => (v as Array<Record<string, unknown>>)[0]?.categorySlug === "",
    );
    // Wybór „brak” zapisuje pusty slug, nie znacznik `__none`.
    expect(clearedSlug).toBeDefined();
  });

  it("edycja linku nie rusza pozostałych linków", () => {
    const { written } = renderEditor(MegaMenuEditor, { columns: [LINK_COLUMN] });
    const labels = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[placeholder="Etykieta PL"]'),
    );
    fireEvent.change(labels[1], { target: { value: "Zmieniony" } });
    const cols = written.at(-1)?.[1] as Array<Record<string, unknown>>;
    const links = cols[0].links as Array<Record<string, unknown>>;
    expect(links[0].label_pl).toBe("Pierwszy");
    expect(links[1].label_pl).toBe("Zmieniony");
    // Adres drugiego linku musi zostać nietknięty - zapis jest scalający.
    expect(links[1].href).toBe("/dwa");
  });

  it("dodanie linku dokłada pozycję dwujęzyczną", () => {
    const { written } = renderEditor(MegaMenuEditor, { columns: [LINK_COLUMN] });
    fireEvent.click(screen.getByRole("button", { name: "builder.megaMenuEditor.addLink" }));
    const links = (written.at(-1)?.[1] as Array<Record<string, unknown>>)[0].links as Array<
      Record<string, unknown>
    >;
    expect(links).toHaveLength(3);
    // Nowy link ma etykietę w OBU językach - inaczej druga wersja strony
    // renderuje puste menu.
    expect(links[2].label_pl).toBeTruthy();
    expect(links[2].label_en).toBeTruthy();
  });

  it("usunięcie linku zostawia pozostałe", () => {
    const { written } = renderEditor(MegaMenuEditor, { columns: [LINK_COLUMN] });
    fireEvent.click(
      screen.getAllByRole("button", { name: "builder.megaMenuEditor.removeLink" })[0],
    );
    const links = (written.at(-1)?.[1] as Array<Record<string, unknown>>)[0].links as Array<
      Record<string, unknown>
    >;
    expect(links).toHaveLength(1);
    expect(links[0].label_pl).toBe("Drugi");
  });

  it("ikona linku zapisuje pustą nazwę dla wyboru „brak”", () => {
    const { written } = renderEditor(MegaMenuEditor, {
      columns: [{ ...LINK_COLUMN, links: [{ label_pl: "A", href: "/a", icon: "book" }] }],
    });
    const iconSelect = selectWithOption("none");
    fireEvent.change(iconSelect, { target: { value: "none" } });
    const links = (written.at(-1)?.[1] as Array<Record<string, unknown>>)[0].links as Array<
      Record<string, unknown>
    >;
    expect(links[0].icon).toBe("");
  });

  it("opis linku zapisuje się pod klucz języka treści", () => {
    const { written } = renderEditor(MegaMenuEditor, { columns: [LINK_COLUMN] }, "en");
    const desc = document.querySelector<HTMLInputElement>(
      'input[placeholder="Description (optional)"]',
    );
    if (!desc) throw new Error("test: brak pola opisu linku");
    fireEvent.change(desc, { target: { value: "Short" } });
    const links = (written.at(-1)?.[1] as Array<Record<string, unknown>>)[0].links as Array<
      Record<string, unknown>
    >;
    expect(links[0].desc_en).toBe("Short");
  });
});

describe("MegaMenuEditor - karta wyróżniona", () => {
  it("dodanie karty seeduje tytuł w obu językach", () => {
    const { written } = renderEditor(MegaMenuEditor, { columns: [LINK_COLUMN] });
    fireEvent.click(screen.getByRole("button", { name: "builder.megaMenuEditor.add" }));
    const featured = (written.at(-1)?.[1] as Array<Record<string, unknown>>)[0].featured as Record<
      string,
      unknown
    >;
    expect(featured.title_pl).toBeTruthy();
    expect(featured.title_en).toBeTruthy();
  });

  it("usunięcie karty zapisuje null, nie brak klucza", () => {
    const { written } = renderEditor(MegaMenuEditor, {
      columns: [{ ...LINK_COLUMN, featured: { title_pl: "Tytuł", title_en: "Title" } }],
    });
    fireEvent.click(screen.getByRole("button", { name: "builder.megaMenuEditor.remove" }));
    const featured = (written.at(-1)?.[1] as Array<Record<string, unknown>>)[0].featured;
    // `null` jest jawnym „nie ma karty” - brak klucza renderer mógłby wziąć
    // za „jeszcze nie wczytano”.
    expect(featured).toBeNull();
  });

  it("karta wyróżniona ma pola tytułu, adresu i proporcji obrazu", () => {
    const { written } = renderEditor(MegaMenuEditor, {
      columns: [
        {
          ...LINK_COLUMN,
          featured: {
            title_pl: "Tytuł",
            title_en: "Title",
            href: "/promo",
            image: "https://cdn.test/a.png",
            aspectRatio: "16/9",
            focalX: 50,
            focalY: 50,
          },
        },
      ],
    });
    expect(selectWithOption("3/4").value).toBe("16/9");
    fireEvent.change(selectWithOption("3/4"), { target: { value: "1/1" } });
    const featured = (written.at(-1)?.[1] as Array<Record<string, unknown>>)[0].featured as Record<
      string,
      unknown
    >;
    expect(featured.aspectRatio).toBe("1/1");
    // Pozostałe pola karty zostają - zapis jest scalający.
    expect(featured.title_pl).toBe("Tytuł");
    expect(featured.href).toBe("/promo");
  });
});

// ── Karta wyróżniona: KAŻDE pole karty osobno ───────────────────────────────
//
// Wszystkie pola karty siedzą pod warunkiem `featured &&` (karty domyślnie nie
// ma), a zapisują się SCALAJĄCO na jednym kluczu `featured`. To najgorsza
// możliwa kombinacja dla pomyłki: pole, które nadpisuje cały obiekt zamiast go
// scalić, kasuje pozostałe pola karty i nikt tego nie widzi, dopóki redakcja
// nie wypełni drugiego pola. Dlatego każde pole ma tu własne przejście
// z asercją, że sąsiednie wartości ZOSTAŁY.
describe("MegaMenuEditor - pola karty wyróżnionej", () => {
  const FEATURED = {
    title_pl: "Tytuł",
    title_en: "Title",
    excerpt_pl: "Zajawka",
    excerpt_en: "Excerpt",
    href: "/promo",
    cta_pl: "Zobacz",
    cta_en: "See",
    image: "https://cdn.test/a.png",
    aspectRatio: "16/10",
    placeholderColor: "#e5e7eb",
    focalX: 40,
    focalY: 60,
  };
  /** Kolumna BEZ linków - wtedy pola „URL" karty nie mylą się z polami linku. */
  const withFeatured = (featured: Record<string, Json> = FEATURED) => ({
    columns: [{ ...LINK_COLUMN, links: [], featured }],
  });

  const featuredFrom = (written: Written): Record<string, unknown> => {
    const cols = written.at(-1)?.[1] as Array<Record<string, unknown>> | undefined;
    return (cols?.[0].featured ?? {}) as Record<string, unknown>;
  };

  it("adres obrazka ze slotu zapisuje się, a reszta karty zostaje", () => {
    const { written } = renderEditor(MegaMenuEditor, withFeatured());
    const url = document.querySelector<HTMLInputElement>(
      'input[placeholder="builder.imageSlot.urlPlaceholder"]',
    );
    if (!url) throw new Error("test: brak pola adresu obrazka");
    fireEvent.change(url, { target: { value: "https://cdn.test/nowy.png" } });
    const featured = featuredFrom(written);
    expect(featured.image).toBe("https://cdn.test/nowy.png");
    expect(featured.title_pl).toBe("Tytuł");
  });

  it("punkt centralny wskazany na podglądzie zapisuje procenty obu osi", () => {
    const { container, written } = renderEditor(MegaMenuEditor, withFeatured());
    const canvas = container.querySelector<HTMLElement>(".cursor-crosshair");
    if (!canvas) throw new Error("test: brak podglądu punktu centralnego");
    // happy-dom nie liczy układu, więc wymiar podglądu podajemy wprost -
    // bez niego procent wychodzi z dzielenia przez zero.
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 }) as DOMRect;
    fireEvent.mouseDown(canvas, { clientX: 150, clientY: 25 });
    const featured = featuredFrom(written);
    expect(featured.focalX).toBe(75);
    expect(featured.focalY).toBe(25);
  });

  it("procenty wpisane w pola liczbowe zapisują się na właściwej osi", () => {
    const { written } = renderEditor(MegaMenuEditor, withFeatured());
    const x = document.querySelector<HTMLInputElement>('input[placeholder="X%"]');
    const y = document.querySelector<HTMLInputElement>('input[placeholder="Y%"]');
    if (!x || !y) throw new Error("test: brak pól punktu centralnego");
    expect(x.value).toBe("40");
    expect(y.value).toBe("60");
    fireEvent.change(x, { target: { value: "10" } });
    expect(featuredFrom(written).focalX).toBe(10);
    fireEvent.change(y, { target: { value: "90" } });
    expect(featuredFrom(written).focalY).toBe(90);
  });

  it("punkt centralny bez zapisanych wartości startuje ze środka kadru", () => {
    renderEditor(MegaMenuEditor, withFeatured({ title_pl: "Tytuł" }));
    expect(document.querySelector<HTMLInputElement>('input[placeholder="X%"]')?.value).toBe("50");
    expect(document.querySelector<HTMLInputElement>('input[placeholder="Y%"]')?.value).toBe("50");
  });

  it("kolor tła podkładki zdjęty z pola wraca do wartości domyślnej", () => {
    const { written } = renderEditor(MegaMenuEditor, withFeatured());
    const color = document.querySelector<HTMLInputElement>("input.font-mono");
    if (!color) throw new Error("test: brak pola koloru podkładki");
    fireEvent.change(color, { target: { value: "#123456" } });
    expect(featuredFrom(written).placeholderColor).toBe("#123456");
    // Puste pole to „bez własnego koloru" - karta musi dostać kolor domyślny,
    // nie `undefined`, które przy zapisie do bazy znika z dokumentu.
    fireEvent.change(color, { target: { value: "" } });
    expect(featuredFrom(written).placeholderColor).toBe("#e5e7eb");
  });

  it.each([
    ["tytuł", "builder.megaMenuEditor.titlePh(lang=PL)", "title_pl", "Nowy tytuł"],
    ["CTA", "CTA PL", "cta_pl", "Przejdź"],
    ["adres", "URL", "href", "/nowy-promo"],
  ])("pole %s karty zapisuje się pod własnym kluczem", (_label, placeholder, key, value) => {
    const { written } = renderEditor(MegaMenuEditor, withFeatured());
    const field = document.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`);
    if (!field) throw new Error(`test: brak pola „${placeholder}”`);
    fireEvent.change(field, { target: { value } });
    const featured = featuredFrom(written);
    expect(featured[key]).toBe(value);
    // Sąsiednie pola karty nietknięte - zapis jest scalający.
    expect(featured.excerpt_pl).toBe("Zajawka");
  });

  it("zajawka karty zapisuje się pod klucz języka treści", () => {
    const { written } = renderEditor(MegaMenuEditor, withFeatured(), "en");
    const area = document.querySelector("textarea");
    if (!area) throw new Error("test: brak pola zajawki");
    fireEvent.change(area, { target: { value: "Short lead" } });
    const featured = featuredFrom(written);
    expect(featured.excerpt_en).toBe("Short lead");
    expect(featured.excerpt_pl).toBe("Zajawka");
  });

  it.each([
    ["16/9", "aspect-[16/9]"],
    ["4/3", "aspect-[4/3]"],
    ["1/1", "aspect-square"],
    ["3/4", "aspect-[3/4]"],
    ["16/10", "aspect-[16/10]"],
    // Proporcja spoza katalogu (stary dokument, ręczna edycja JSON-a) nie może
    // zostawić podglądu bez klasy proporcji - wtedy kadr ma zerową wysokość.
    ["21/9", "aspect-[16/10]"],
  ])("proporcja „%s” daje podglądowi klasę %s", (ratio, expected) => {
    const { container } = renderEditor(
      MegaMenuEditor,
      withFeatured({ ...FEATURED, aspectRatio: ratio }),
    );
    const canvas = container.querySelector<HTMLElement>(".cursor-crosshair");
    expect(canvas?.className).toContain(expected);
  });
});

describe("MegaMenuEditor - brzegi list i pól liczbowych", () => {
  it("adres linku zapisuje się tylko na edytowanym wierszu", () => {
    const { written } = renderEditor(MegaMenuEditor, { columns: [LINK_COLUMN] });
    const urls = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[placeholder="URL"]'),
    );
    expect(urls).toHaveLength(2);
    fireEvent.change(urls[1], { target: { value: "/dwa-nowe" } });
    const links = (written.at(-1)?.[1] as Array<Record<string, unknown>>)[0].links as Array<
      Record<string, unknown>
    >;
    expect(links[0].href).toBe("/jeden");
    expect(links[1].href).toBe("/dwa-nowe");
    expect(links[1].label_pl).toBe("Drugi");
  });

  it("wybór ikony z katalogu zapisuje jej nazwę na właściwym wierszu", () => {
    const { written } = renderEditor(MegaMenuEditor, { columns: [LINK_COLUMN] });
    const icons = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).filter((s) =>
      s.querySelector('option[value="none"]'),
    );
    expect(icons).toHaveLength(2);
    const name = MEGA_MENU_ICON_NAMES[0];
    fireEvent.change(icons[1], { target: { value: name } });
    const links = (written.at(-1)?.[1] as Array<Record<string, unknown>>)[0].links as Array<
      Record<string, unknown>
    >;
    expect(links[0].icon).toBe("");
    expect(links[1].icon).toBe(name);
  });

  it("wyczyszczenie szerokości stałej wraca do 1140 px, nie do dziury", () => {
    const { written } = renderEditor(MegaMenuEditor, { width: "fixed", widthPx: 1200 });
    const px = document.querySelector<HTMLInputElement>('input[type="number"]');
    if (!px) throw new Error("test: brak pola szerokości");
    fireEvent.change(px, { target: { value: "" } });
    // Puste pole liczbowe oddaje `undefined` - zapisany do dokumentu skasowałby
    // szerokość panelu, a renderer nie ma czym jej zastąpić.
    expect(written.at(-1)).toEqual(["widthPx", 1140]);
  });

  it("wyczyszczenie liczby wpisów kolumny kategorii wraca do 4", async () => {
    const { written } = renderEditor(MegaMenuEditor, { columns: [CATEGORY_COLUMN] });
    await screen.findByRole("option", { name: "Gospodarka" });
    const numbers = document.querySelectorAll<HTMLInputElement>('input[type="number"]');
    fireEvent.change(numbers[numbers.length - 1], { target: { value: "" } });
    const cols = written.at(-1)?.[1] as Array<Record<string, unknown>>;
    expect(cols[0].postCount).toBe(4);
  });

  it("wybór konkretnej kategorii zapisuje jej slug, nie znacznik listy", async () => {
    const { written } = renderEditor(MegaMenuEditor, {
      columns: [{ ...CATEGORY_COLUMN, categorySlug: "" }],
    });
    await screen.findByRole("option", { name: "Gospodarka" });
    const select = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).find((s) =>
      s.querySelector('option[value="gospodarka"]'),
    );
    if (!select) throw new Error("test: brak listy kategorii");
    fireEvent.change(select, { target: { value: "gospodarka" } });
    const cols = written.at(-1)?.[1] as Array<Record<string, unknown>>;
    expect(cols[0].categorySlug).toBe("gospodarka");
  });

  it("baza oddająca PUSTKĘ zostawia listę kategorii z samym „brak”", async () => {
    // PostgREST na pustym wyniku oddaje `data: null`. Bez straży `data ?? []`
    // kolumna kategorii wywala panel na świeżej instalacji.
    db.current.setResponse("categories", ok(null));
    const { container } = renderEditor(MegaMenuEditor, { columns: [CATEGORY_COLUMN] });
    await screen.findByRole("option", { name: "builder.megaMenuEditor.none" });
    const select = Array.from(container.querySelectorAll<HTMLSelectElement>("select")).find((s) =>
      s.querySelector('option[value="__none"]'),
    );
    expect(select?.querySelectorAll("option")).toHaveLength(1);
    expect(container.textContent).not.toContain("undefined");
  });
});

describe("SponsorsEditor - poziomy i sponsorzy", () => {
  const TIERS = [
    {
      id: "tier-1",
      name_pl: "Główni",
      name_en: "Main",
      size: "lg",
      sponsors: [
        {
          id: "s-1",
          name: "Alfa",
          logo: "https://cdn.test/alfa.png",
          url: "https://alfa.test",
          description_pl: "Opis",
          description_en: "Description",
        },
        { id: "s-2", name: "Beta", logo: "", url: "", description_pl: "", description_en: "" },
      ],
    },
    { id: "tier-2", name_pl: "Medialni", name_en: "Media", size: "sm", sponsors: [] },
  ];

  it("nagłówek i wstęp zapisują się pod klucze języka treści", () => {
    const { written } = renderEditor(SponsorsEditor, {}, "en");
    const heading = document.querySelector<HTMLInputElement>(
      'input[placeholder="Sponsors & partners"]',
    );
    if (!heading) throw new Error("test: brak pola nagłówka");
    fireEvent.change(heading, { target: { value: "Partners" } });
    const intro = document.querySelector("textarea");
    if (intro) fireEvent.change(intro, { target: { value: "Intro" } });
    expect(Object.fromEntries(written)).toMatchObject({
      heading_en: "Partners",
      intro_en: "Intro",
    });
  });

  it("wyszarzenie logotypów jest domyślnie włączone", () => {
    const { last } = renderEditor(SponsorsEditor, {});
    const box = screen.getByRole("switch");
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(last()).toEqual(["grayscale", false]);
  });

  it("kolor akcentu zapisuje pusty napis przy zdjęciu wartości", () => {
    const { last } = renderEditor(SponsorsEditor, { accentColor: "#ff8800" });
    const field = document.querySelector<HTMLInputElement>("input.font-mono");
    if (!field) throw new Error("test: brak pola koloru");
    fireEvent.change(field, { target: { value: "" } });
    expect(last()).toEqual(["accentColor", ""]);
  });

  it("dodanie poziomu numeruje go w obu językach", () => {
    const { last } = renderEditor(SponsorsEditor, { tiers: TIERS });
    fireEvent.click(screen.getAllByRole("button", { name: /common.add/ })[0]);
    const tiers = last()?.[1] as Array<Record<string, unknown>>;
    expect(tiers).toHaveLength(3);
    expect(tiers[2].name_pl).toBe("Poziom 3");
    expect(tiers[2].name_en).toBe("Tier 3");
    expect(tiers[2].sponsors).toEqual([]);
  });

  it("rozmiar logotypów zapisuje się per poziom", () => {
    const { last } = renderEditor(SponsorsEditor, { tiers: TIERS });
    const sizes = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).filter((s) =>
      s.querySelector('option[value="lg"]'),
    );
    fireEvent.change(sizes[1], { target: { value: "md" } });
    const tiers = last()?.[1] as Array<Record<string, unknown>>;
    expect(tiers[0].size).toBe("lg");
    expect(tiers[1].size).toBe("md");
  });

  it.each([
    ["wyżej", "Przesuń wyżej", 1, ["tier-2", "tier-1"]],
    ["niżej", "Przesuń niżej", 0, ["tier-2", "tier-1"]],
  ])("przenosi poziom %s", (_label, aria, index, expected) => {
    const { last } = renderEditor(SponsorsEditor, { tiers: TIERS });
    fireEvent.click(screen.getAllByLabelText(aria)[index]);
    const tiers = last()?.[1] as Array<Record<string, unknown>>;
    expect(tiers.map((t) => t.id)).toEqual(expected);
  });

  it("przeniesienie poza listę nie zmienia kolejności", () => {
    const { written } = renderEditor(SponsorsEditor, { tiers: TIERS });
    // Pierwszy poziom nie ma gdzie iść w górę, ostatni w dół - zapis musi być
    // tożsamy, a nie „przesuń na koniec”.
    fireEvent.click(screen.getAllByLabelText("Przesuń wyżej")[0]);
    fireEvent.click(screen.getAllByLabelText("Przesuń niżej").at(-1)!);
    for (const [, value] of written) {
      expect((value as Array<Record<string, unknown>>).map((t) => t.id)).toEqual([
        "tier-1",
        "tier-2",
      ]);
    }
  });

  it("edycja sponsora nie rusza pozostałych", () => {
    const { last } = renderEditor(SponsorsEditor, { tiers: TIERS });
    const names = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[value="Alfa"], input[value="Beta"]'),
    );
    fireEvent.change(names[1], { target: { value: "Beta Plus" } });
    const tiers = last()?.[1] as Array<Record<string, unknown>>;
    const sponsors = tiers[0].sponsors as Array<Record<string, unknown>>;
    expect(sponsors[0].name).toBe("Alfa");
    expect(sponsors[1].name).toBe("Beta Plus");
    expect(sponsors[0].logo).toBe("https://cdn.test/alfa.png");
  });

  it("treść bez poziomów pokazuje stan pusty", () => {
    renderEditor(SponsorsEditor, { tiers: "nie-tablica" });
    expect(screen.getByText("builder.listShell.empty")).toBeInTheDocument();
  });
});

describe("ImageSlot - adres i wysyłka", () => {
  function renderSlot(value = "") {
    const onChange = vi.fn();
    const view = renderWithQueryClient(
      <ImageSlot
        label="Zdjęcie"
        icon={<span data-testid="ikona-slotu" />}
        value={value}
        onChange={onChange}
        hint="16:9"
      />,
    );
    return { ...view, onChange };
  }

  it("pokazuje etykietę, podpowiedź i wartość", () => {
    renderSlot("https://cdn.test/a.png");
    expect(screen.getByText("Zdjęcie")).toBeInTheDocument();
    expect(screen.getByText("16:9")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://cdn.test/a.png")).toBeInTheDocument();
  });

  it("wpisany adres trafia do dokumentu", () => {
    const { onChange } = renderSlot();
    const input = document.querySelector<HTMLInputElement>('input[type="text"], input:not([type])');
    if (!input) throw new Error("test: brak pola adresu");
    fireEvent.change(input, { target: { value: "https://cdn.test/b.png" } });
    expect(onChange).toHaveBeenLastCalledWith("https://cdn.test/b.png");
  });

  it("wysyłka pliku zapisuje adres zwrócony przez magazyn", async () => {
    const { onChange, container } = renderSlot();
    const file = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!file) throw new Error("test: brak pola pliku");
    const png = new File(["x"], "logo.png", { type: "image/png" });
    fireEvent.change(file, { target: { files: [png] } });
    await waitFor(() => expect(uploadMedia).toHaveBeenCalled());
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("https://cdn.test/wyslany.png"));
  });

  it("plik ponad limit nie jest wysyłany", async () => {
    const onChange = vi.fn();
    const { container } = renderWithQueryClient(
      <ImageSlot
        label="Zdjęcie"
        icon={<span data-testid="ikona-slotu" />}
        value=""
        onChange={onChange}
        maxSizeMb={0}
      />,
    );
    const file = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!file) throw new Error("test: brak pola pliku");
    const big = new File([new Uint8Array(1024)], "duzy.png", { type: "image/png" });
    fireEvent.change(file, { target: { files: [big] } });
    await waitFor(() => expect(uploadMedia).not.toHaveBeenCalled());
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("ImageSlot - walidacja adresu i ścieżki błędu wysyłki", () => {
  function renderSlot(value = "", maxSizeMb?: number) {
    const onChange = vi.fn();
    const view = renderWithQueryClient(
      <ImageSlot
        label="Zdjęcie"
        icon={<span data-testid="ikona-slotu" />}
        value={value}
        onChange={onChange}
        {...(maxSizeMb === undefined ? {} : { maxSizeMb })}
      />,
    );
    return { ...view, onChange };
  }

  const urlInput = (): HTMLInputElement => {
    const input = document.querySelector<HTMLInputElement>('input[type="text"], input:not([type])');
    if (!input) throw new Error("test: brak pola adresu");
    return input;
  };
  const fileInput = (container: HTMLElement): HTMLInputElement => {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("test: brak pola pliku");
    return input;
  };

  it.each([
    ["adres bez protokołu", "cdn.test/a.png", "builder.imageSlot.urlInvalid"],
    ["zły protokół", "ftp://cdn.test/a.png", "builder.imageSlot.urlProtocol"],
  ])("%s jest zgłoszony jako błąd", (_label, value, key) => {
    const { container } = renderSlot(value);
    // Adres wpisany ręcznie trafia wprost do atrybutu `src` na stronie -
    // niepoprawny nie da żadnego obrazka, a redakcja nie wie dlaczego.
    expect(container.textContent).toContain(key);
    expect(urlInput().getAttribute("aria-invalid")).toBe("true");
  });

  it.each([
    ["obraz w treści strony (data:)", "data:image/png;base64,AAA"],
    ["adres względny w projekcie", "/media/a.png"],
    ["pełny adres https", "https://cdn.test/a.png"],
    ["pusty adres", ""],
  ])("%s jest przyjęty bez błędu", (_label, value) => {
    const { container } = renderSlot(value);
    expect(container.textContent).not.toContain("builder.imageSlot.urlInvalid");
    expect(container.textContent).not.toContain("builder.imageSlot.urlProtocol");
    expect(urlInput().getAttribute("aria-invalid")).toBeNull();
  });

  it("krzyżyk czyści adres, a pojawia się tylko gdy jest co czyścić", () => {
    const puste = renderSlot();
    expect(screen.queryByTitle("builder.common.delete")).toBeNull();
    puste.unmount();
    const { onChange } = renderSlot("https://cdn.test/a.png");
    fireEvent.click(screen.getByTitle("builder.common.delete"));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("adres z biblioteki mediów wchodzi do dokumentu", () => {
    const { onChange } = renderSlot();
    fireEvent.click(screen.getByText("builder.imageSlot.mediaLibrary"));
    fireEvent.click(screen.getByTestId("wybierz-z-biblioteki"));
    expect(onChange).toHaveBeenCalledWith("https://cdn.test/z-biblioteki.png");
  });

  it("plik o niedozwolonym typie nie jest wysyłany", async () => {
    const { container } = renderSlot();
    const svg = new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" });
    fireEvent.change(fileInput(container), { target: { files: [svg] } });
    // SVG jest odrzucany świadomie: bucket jest publiczny i serwuje bajty,
    // więc osadzony `<script>` wykonałby się w kontekście domeny.
    await waitFor(() => expect(container.textContent).toContain("builder.imageSlot.badType"));
    expect(uploadMedia).not.toHaveBeenCalled();
  });

  it("plik bez rozpoznanego typu jest opisany jako nieznany", async () => {
    const { container } = renderSlot();
    const dziwny = new File(["x"], "plik.bin", { type: "" });
    fireEvent.change(fileInput(container), { target: { files: [dziwny] } });
    await waitFor(() => expect(container.textContent).toContain("builder.imageSlot.unknownType"));
  });

  it("brak zalogowanego użytkownika przerywa wysyłkę z komunikatem", async () => {
    auth.session = null;
    const { container } = renderSlot();
    const png = new File(["x"], "a.png", { type: "image/png" });
    fireEvent.change(fileInput(container), { target: { files: [png] } });
    // Identyfikator autora wysyłki idzie do audytu mediów - bez sesji nie ma
    // czego zapisać, więc wysyłka musi się zatrzymać PRZED storage.
    await waitFor(() => expect(container.textContent).toContain("builder.imageSlot.uploadError"));
    expect(uploadMedia).not.toHaveBeenCalled();
  });

  it("błąd odczytu sesji jest pokazany, a nie zignorowany", async () => {
    auth.error = { message: "sesja wygasła" };
    const { container } = renderSlot();
    const png = new File(["x"], "a.png", { type: "image/png" });
    fireEvent.change(fileInput(container), { target: { files: [png] } });
    await waitFor(() => expect(container.textContent).toContain("builder.imageSlot.uploadError"));
    expect(uploadMedia).not.toHaveBeenCalled();
  });

  it("odrzucona wysyłka pokazuje komunikat i zwalnia przycisk", async () => {
    uploadMedia.mockImplementation(async () => {
      throw new Error("magazyn odrzucił plik");
    });
    const { container } = renderSlot();
    const png = new File(["x"], "a.png", { type: "image/png" });
    fireEvent.change(fileInput(container), { target: { files: [png] } });
    await waitFor(() => expect(container.textContent).toContain("builder.imageSlot.uploadError"));
    // Po nieudanej wysyłce przycisk musi wrócić do stanu klikalnego - inaczej
    // redakcja nie może spróbować ponownie bez przeładowania panelu.
    await waitFor(() =>
      expect(screen.getByText("builder.imageSlot.uploadFile").closest("button")).not.toBeDisabled(),
    );
  });

  it("wpisanie adresu gasi poprzedni błąd wysyłki", async () => {
    uploadMedia.mockImplementation(async () => {
      throw new Error("magazyn odrzucił plik");
    });
    const { container, onChange } = renderSlot();
    const png = new File(["x"], "a.png", { type: "image/png" });
    fireEvent.change(fileInput(container), { target: { files: [png] } });
    await waitFor(() => expect(container.textContent).toContain("builder.imageSlot.uploadError"));
    fireEvent.change(urlInput(), { target: { value: "https://cdn.test/b.png" } });
    expect(onChange).toHaveBeenLastCalledWith("https://cdn.test/b.png");
    expect(container.textContent).not.toContain("builder.imageSlot.uploadError");
  });

  it("podpowiedź ustępuje komunikatowi błędu", () => {
    const { container } = renderSlot("ftp://cdn.test/a.png");
    const onChange = vi.fn();
    const zHintem = renderWithQueryClient(
      <ImageSlot
        label="Zdjęcie"
        icon={<span />}
        value="https://cdn.test/a.png"
        onChange={onChange}
        hint="16:9"
      />,
    );
    // Dwa napisy w jednym miejscu byłyby nieczytelne: błąd wypiera podpowiedź.
    expect(container.textContent).toContain("builder.imageSlot.urlProtocol");
    expect(zHintem.container.textContent).toContain("16:9");
  });
});
