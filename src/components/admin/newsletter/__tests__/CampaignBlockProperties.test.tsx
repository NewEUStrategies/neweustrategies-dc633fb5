// Panel właściwości bloku kampanii - jedyne miejsce, w którym redaktor wpisuje
// treść wychodzącego maila.
//
// KAMPANIA JEDZIE DO CAŁEJ LISTY I NIE DA SIĘ JEJ ODWOŁAĆ. Dlatego testy pytają
// nie „czy się wyrenderowało", ale co dokładnie wylądowało w dokumencie:
//   * każdy tekst jest DWUJĘZYCZNY (PL/EN obok siebie). Patch gubiący drugi
//     język wysyła połowie listy maila z pustym nagłówkiem;
//   * każda kontrolka musi być PODŁĄCZONA - pole, którego `onChange` nic nie
//     robi, przyjmuje wpisaną treść i ją gubi, a redaktor wychodzi przekonany,
//     że zapisał;
//   * limity (1-10 wpisów, 10 ręcznie wybranych) trzymają się zakresu także przy
//     śmieciach - mail z pustą listą wpisów wychodzi po cichu.
//
// Etykiety bierzemy z prawdziwej instancji i18n przez KLUCZE, żeby test nie
// zależał od copy - zmiana napisu w słowniku nie ma go wywalać.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const env = vi.hoisted(() => ({
  posts: [] as { id: string; slug: string; title_pl: string | null; title_en: string | null }[],
}));

// Wyszukiwanie wpisów idzie funkcją serwerową - w teście atrapa, żaden test nie
// wykonuje realnego żądania.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => async () => ({ json: JSON.stringify(env.posts) }),
}));
vi.mock("@/lib/newsletter-campaigns.functions", () => ({
  searchCampaignPosts: {},
  resolveCampaignDocPosts: {},
}));
// Biblioteka mediów ma własne testy; tu wystarczy przycisk oddający adres.
vi.mock("@/components/admin/media/MediaPickerDialog", () => ({
  MediaPickerDialog: ({ open, onPick }: { open: boolean; onPick: (url: string) => void }) =>
    open ? (
      <button type="button" onClick={() => onPick("https://example.test/z-mediow.png")}>
        atrapa-mediow
      </button>
    ) : null,
}));

import i18n from "@/lib/i18n";
import { CampaignBlockProperties } from "@/components/admin/newsletter/CampaignBlockProperties";
import {
  createEmailBlock,
  EMAIL_BLOCK_TYPES,
  type EmailBlock,
  type EmailBlockType,
  type EmailImageBlock,
  type EmailPostListBlock,
} from "@/lib/newsletter/emailDoc";

/** Etykieta ze słownika - test nie zależy od copy. */
const L = (key: string) => i18n.t(`adminNewsletter.blockProps.${key}`);

function mount(block: EmailBlock) {
  const onChange = vi.fn<(b: EmailBlock) => void>();
  const utils = renderWithQueryClient(
    <CampaignBlockProperties block={block} onChange={onChange} />,
  );
  return { ...utils, onChange };
}

function make<T extends EmailBlockType>(type: T, overrides: Record<string, unknown> = {}) {
  return { ...createEmailBlock(type), ...overrides } as EmailBlock;
}

/** Pole tekstowe pod daną etykietą - obraz ma dwa puste pola, więc szukanie po
 *  wartości byłoby niejednoznaczne. */
function fieldUnder(label: string): HTMLInputElement {
  const input = screen.getByText(label).parentElement!.querySelector("input");
  expect(input, `brak pola pod etykietą „${label}”`).toBeTruthy();
  return input as HTMLInputElement;
}

/** Ostatni patch przekazany do dokumentu. */
function lastPatch(onChange: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return onChange.mock.calls.at(-1)![0] as Record<string, unknown>;
}

beforeAll(async () => {
  await i18n.changeLanguage("pl");
});

beforeEach(() => {
  env.posts = [];
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
describe("kontrakt z listą typów bloków", () => {
  it("KAŻDY typ bloku ma panel - żaden nie zostawia pustej kolumny", () => {
    const puste: string[] = [];

    for (const type of EMAIL_BLOCK_TYPES) {
      const { container, unmount } = mount(createEmailBlock(type));
      if (container.innerHTML.trim() === "") puste.push(type);
      unmount();
    }

    expect(puste).toEqual([]);
    expect(EMAIL_BLOCK_TYPES.length).toBeGreaterThan(5);
  });

  it.each(EMAIL_BLOCK_TYPES.filter((t) => t !== "divider"))(
    "blok %s: każde pole tekstowe patchuje dokument",
    (type) => {
      // Kontrolka, której `onChange` nic nie robi, renderuje się identycznie jak
      // podłączona - dlatego przemiał wymusza zmianę na każdym polu.
      const { container, onChange, unmount } = mount(createEmailBlock(type));

      const fields = Array.from(
        container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          'input[type="text"], input:not([type]), input[type="number"], textarea',
        ),
      );
      expect(fields.length, `${type}: panel bez ani jednego pola do edycji`).toBeGreaterThan(0);
      for (const field of fields) {
        fireEvent.change(field, {
          target: { value: field.getAttribute("type") === "number" ? "5" : "wartosc" },
        });
      }

      expect(onChange, `${type}: pole bez podłączonego onChange`).toHaveBeenCalled();
      for (const call of onChange.mock.calls) {
        expect((call[0] as EmailBlock).type).toBe(type);
      }
      unmount();
    },
  );

  it("separator nie ma czego edytować, ale MÓWI to redaktorowi", () => {
    const { container } = mount(createEmailBlock("divider"));

    expect(screen.getByText(L("dividerHint"))).toBeTruthy();
    expect(container.querySelectorAll("input, textarea")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("nagłówek", () => {
  it("zmiana wersji POLSKIEJ zachowuje angielską", () => {
    const block = make("heading", { text: { pl: "Tytuł", en: "Title" } });
    const { onChange } = mount(block);

    fireEvent.change(screen.getByDisplayValue("Tytuł"), { target: { value: "Nowy" } });

    expect(lastPatch(onChange).text).toEqual({ pl: "Nowy", en: "Title" });
    // Identyfikator i typ bloku zostają - inaczej edycja treści tworzyłaby
    // nowy blok, a zaznaczenie w kreatorze wskazywałoby w pustkę.
    expect(lastPatch(onChange)).toMatchObject({ id: block.id, type: "heading" });
  });

  it("zmiana wersji ANGIELSKIEJ zachowuje polską", () => {
    const block = make("heading", { text: { pl: "Tytuł", en: "Title" } });
    const { onChange } = mount(block);

    fireEvent.change(screen.getByDisplayValue("Title"), { target: { value: "New" } });

    expect(lastPatch(onChange).text).toEqual({ pl: "Tytuł", en: "New" });
    expect(lastPatch(onChange)).toMatchObject({ id: block.id, type: "heading" });
  });

  it("oba języki mają WIDOCZNE, opisane pola", () => {
    mount(make("heading"));

    expect(screen.getByPlaceholderText("PL")).toBeTruthy();
    expect(screen.getByPlaceholderText("EN")).toBeTruthy();
    expect(screen.getByText(L("text"))).toBeTruthy();
  });

  it("poziom nagłówka patchuje LICZBĘ, nie napis", async () => {
    // Napis „2" wyszedłby w HTML-u maila jako inny znacznik, niż redaktor wybrał.
    const { onChange } = mount(make("heading", { level: 1 }));

    fireEvent.keyDown(screen.getByText("H1").closest("button")!, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "H2" }));

    expect(lastPatch(onChange).level).toBe(2);
    expect(typeof lastPatch(onChange).level).toBe("number");
  });

  it("wyrównanie patchuje wartość docelową", async () => {
    const { onChange } = mount(make("heading", { align: "left" }));

    fireEvent.keyDown(screen.getByText(L("alignLeft")).closest("button")!, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: L("alignCenter") }));

    expect(lastPatch(onChange).align).toBe("center");
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
describe("akapit, cytat i nota stopki", () => {
  it("akapit edytuje się w polu WIELOLINIOWYM - treść maila to nie jedna linijka", () => {
    const { container } = mount(make("paragraph"));

    expect(container.querySelectorAll("textarea")).toHaveLength(2);
    expect(screen.getByText(L("richContent"))).toBeTruthy();
  });

  it("akapit ma WŁASNE wyrównanie - dziedziczenie po nagłówku rozjeżdżałoby układ", async () => {
    const { onChange } = mount(make("paragraph", { align: "left" }));

    fireEvent.keyDown(screen.getByText(L("alignLeft")).closest("button")!, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: L("alignCenter") }));

    expect(lastPatch(onChange)).toMatchObject({ type: "paragraph", align: "center" });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("cytat ma osobne pole AUTORA, dwujęzyczne", () => {
    const block = make("quote", {
      text: { pl: "Cytat", en: "Quote" },
      attribution: { pl: "Jan", en: "John" },
    });
    const { onChange } = mount(block);

    fireEvent.change(screen.getByDisplayValue("Jan"), { target: { value: "Anna" } });

    expect(lastPatch(onChange).attribution).toEqual({ pl: "Anna", en: "John" });
    expect(screen.getByText(L("attribution"))).toBeTruthy();
  });

  it("nota stopki jest wielolinijkowa i dwujęzyczna", () => {
    const { container } = mount(make("footer-note"));

    expect(container.querySelectorAll("textarea")).toHaveLength(2);
    expect(screen.getByText(L("footerNote"))).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe("obraz", () => {
  it("blok BEZ obrazu proponuje wybór, nie podmianę", () => {
    const { container } = mount(make("image", { url: null }));

    expect(screen.getByText(L("choose"))).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
  });

  it("blok Z obrazem pokazuje miniaturę i pozwala go ZDJĄĆ", () => {
    const { container } = mount(make("image", { url: "https://example.test/a.png" }));

    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://example.test/a.png");
    expect(screen.getByText(L("change"))).toBeTruthy();
  });

  it("wybór z biblioteki mediów zapisuje adres w bloku", () => {
    const { onChange } = mount(make("image", { url: null }));

    fireEvent.click(screen.getByText(L("choose")));
    fireEvent.click(screen.getByText("atrapa-mediow"));

    expect(lastPatch(onChange).url).toBe("https://example.test/z-mediow.png");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("usunięcie obrazu zapisuje NULL, nie pusty napis", () => {
    const { onChange } = mount(make("image", { url: "https://example.test/a.png" }));

    fireEvent.click(screen.getByText(L("remove")));

    expect(lastPatch(onChange).url).toBeNull();
    // Pusty napis dałby w mailu <img src=""> - przeglądarka pobiera wtedy
    // samą stronę i pokazuje ikonę błędu.
    expect(lastPatch(onChange).url).not.toBe("");
  });

  it("tekst alternatywny patchuje się - obraz bez opisu jest niedostępny", () => {
    const { onChange } = mount(make("image", { alt: "" }));

    fireEvent.change(fieldUnder(L("altText")), { target: { value: "Opis obrazu" } });

    expect(lastPatch(onChange).alt).toBe("Opis obrazu");
    expect(screen.getByText(L("altText"))).toBeTruthy();
  });

  it("wyczyszczony link zapisuje NULL - pusty napis dałby martwe <a> w mailu", () => {
    const { onChange } = mount(make("image", { alt: "Opis", href: "https://example.test/cel" }));

    fireEvent.change(screen.getByDisplayValue("https://example.test/cel"), {
      target: { value: "" },
    });

    expect(lastPatch(onChange).href).toBeNull();
    // Opis alternatywny ZOSTAJE - czyszczenie linku nie rusza dostępności.
    expect(lastPatch(onChange).alt).toBe("Opis");
  });
});

// ---------------------------------------------------------------------------
describe("przycisk akcji", () => {
  it("etykieta jest dwujęzyczna, a adres jeden", () => {
    const block = make("button", {
      label: { pl: "Czytaj", en: "Read" },
      url: "https://example.test/wpis",
    });
    const { onChange } = mount(block);

    fireEvent.change(screen.getByDisplayValue("https://example.test/wpis"), {
      target: { value: "https://example.test/inny" },
    });

    expect(lastPatch(onChange).url).toBe("https://example.test/inny");
    expect((lastPatch(onChange).label as { pl: string }).pl).toBe("Czytaj");
  });

  it("przycisk ma własne wyrównanie", async () => {
    const { onChange } = mount(make("button", { align: "left" }));

    fireEvent.keyDown(screen.getByText(L("alignLeft")).closest("button")!, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: L("alignCenter") }));

    expect(lastPatch(onChange)).toMatchObject({ type: "button", align: "center" });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
describe("odstęp", () => {
  it("wysokość patchuje LICZBĘ", () => {
    const { container, onChange } = mount(make("spacer", { size: 24 }));

    fireEvent.change(container.querySelector('input[type="number"]')!, { target: { value: "48" } });

    expect(lastPatch(onChange).size).toBe(48);
    expect(screen.getByText(L("heightPx"))).toBeTruthy();
  });

  it("wyczyszczone pole schodzi na 24 px, a nie na NaN", () => {
    // NaN w dokumencie wychodzi mailem z odstępem „NaNpx", który klient poczty
    // ignoruje - układ maila rozjeżdża się bez śladu w panelu.
    const { container, onChange } = mount(make("spacer", { size: 40 }));

    fireEvent.change(container.querySelector('input[type="number"]')!, { target: { value: "" } });

    expect(lastPatch(onChange).size).toBe(24);
    expect(Number.isNaN(lastPatch(onChange).size as number)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("blok najnowszych wpisów", () => {
  function postListBlock(overrides: Partial<EmailPostListBlock> = {}) {
    return { ...(createEmailBlock("post-list") as EmailPostListBlock), ...overrides } as EmailBlock;
  }

  it("tryb NAJNOWSZE pokazuje liczbę wpisów i kategorię", () => {
    mount(postListBlock({ mode: "latest" }));

    expect(screen.getByText(L("postCount"))).toBeTruthy();
    expect(screen.getByText(L("categorySlug"))).toBeTruthy();
  });

  it("tryb NAJNOWSZE nie pokazuje wyszukiwarki wpisów", () => {
    mount(postListBlock({ mode: "latest" }));

    expect(screen.queryByPlaceholderText(L("searchPost"))).toBeNull();
    expect(screen.getByText(L("source"))).toBeTruthy();
  });

  it("tryb RĘCZNY zamienia liczbę wpisów na wyszukiwarkę", () => {
    mount(postListBlock({ mode: "manual" }));

    expect(screen.getByPlaceholderText(L("searchPost"))).toBeTruthy();
    expect(screen.queryByText(L("postCount"))).toBeNull();
  });

  it("przełączenie źródła na RĘCZNE patchuje tryb", async () => {
    const { onChange } = mount(postListBlock({ mode: "latest" }));

    fireEvent.keyDown(screen.getByText(L("sourceLatest")).closest("button")!, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: L("sourceManual") }));

    expect(lastPatch(onChange).mode).toBe("manual");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("przełączenie układu na KARTY patchuje układ", async () => {
    const { onChange } = mount(postListBlock({ layout: "list" }));

    fireEvent.keyDown(screen.getByText(L("layoutList")).closest("button")!, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: L("layoutCards") }));

    expect(lastPatch(onChange).layout).toBe("cards");
    // Wartość, nie przetłumaczona etykieta opcji.
    expect(lastPatch(onChange).layout).not.toBe(L("layoutCards"));
  });

  it("liczba wpisów jest PRZYCINANA do 1-10", () => {
    const { container, onChange } = mount(postListBlock({ mode: "latest", count: 3 }));
    const input = container.querySelector('input[type="number"]')!;

    fireEvent.change(input, { target: { value: "99" } });
    fireEvent.change(input, { target: { value: "-3" } });

    expect(onChange.mock.calls[0]![0]).toMatchObject({ count: 10 });
    expect(onChange.mock.calls[1]![0]).toMatchObject({ count: 1 });
  });

  it("wyczyszczona liczba wpisów schodzi na 3", () => {
    const { container, onChange } = mount(postListBlock({ mode: "latest", count: 7 }));

    fireEvent.change(container.querySelector('input[type="number"]')!, { target: { value: "" } });

    expect(lastPatch(onChange).count).toBe(3);
    // Liczba, nie NaN - NaN w dokumencie wywala renderer maila.
    expect(Number.isFinite(lastPatch(onChange).count)).toBe(true);
  });

  it("wyczyszczona kategoria zapisuje NULL - pusty slug nie filtruje niczego", () => {
    const { onChange } = mount(postListBlock({ mode: "latest", categorySlug: "eu" }));

    fireEvent.change(screen.getByDisplayValue("eu"), { target: { value: "" } });

    expect(lastPatch(onChange).categorySlug).toBeNull();
    expect(lastPatch(onChange).categorySlug).not.toBe("");
  });

  it("przełącznik zajawek patchuje BOOLEAN", () => {
    const { onChange } = mount(postListBlock({ showExcerpt: false }));

    fireEvent.click(screen.getByRole("switch"));

    expect(lastPatch(onChange).showExcerpt).toBe(true);
    expect(screen.getByText(L("showExcerpts"))).toBeTruthy();
  });

  it("nagłówek sekcji jest dwujęzyczny", () => {
    const { onChange } = mount(postListBlock({ heading: { pl: "Ostatnio", en: "Recently" } }));

    fireEvent.change(screen.getByDisplayValue("Ostatnio"), { target: { value: "Nowości" } });

    expect(lastPatch(onChange).heading).toEqual({ pl: "Nowości", en: "Recently" });
    // Angielska wersja zostaje - dwujęzyczność jest tu warunkiem, nie dodatkiem.
    const heading = lastPatch(onChange).heading as { pl: string; en: string };
    expect(heading.en).toBe("Recently");
  });
});

// ---------------------------------------------------------------------------
describe("ręczny wybór wpisów", () => {
  const WPISY = [
    { id: "p1", slug: "pierwszy", title_pl: "Pierwszy wpis", title_en: "First post" },
    { id: "p2", slug: "drugi", title_pl: "Drugi wpis", title_en: "Second post" },
  ];

  function manualBlock(postIds: string[] = []) {
    return {
      ...(createEmailBlock("post-list") as EmailPostListBlock),
      mode: "manual" as const,
      postIds,
    } as EmailBlock;
  }

  it("bez wyników mówi to WPROST, zamiast pokazywać pustą ramkę", async () => {
    env.posts = [];
    mount(manualBlock());

    expect(await screen.findByText(L("noResults"))).toBeTruthy();
    expect(screen.getByPlaceholderText(L("searchPost"))).toBeTruthy();
  });

  it("wyniki wyszukiwania pokazują tytuły wpisów", async () => {
    env.posts = WPISY;
    mount(manualBlock());

    expect(await screen.findByText("Pierwszy wpis")).toBeTruthy();
    expect(screen.getByText("Drugi wpis")).toBeTruthy();
  });

  it("zaznaczenie wpisu DOKŁADA go do bloku", async () => {
    env.posts = WPISY;
    const { onChange } = mount(manualBlock());
    await screen.findByText("Pierwszy wpis");

    fireEvent.click(screen.getAllByRole("checkbox")[0]!);

    expect(lastPatch(onChange).postIds).toEqual(["p1"]);
    // Identyfikator, nie slug ani tytuł - to on wiąże blok z wpisem.
    expect(lastPatch(onChange).postIds).not.toContain("pierwszy");
  });

  it("odznaczenie ZDEJMUJE wpis, zostawiając pozostałe", async () => {
    env.posts = WPISY;
    const { onChange } = mount(manualBlock(["p1", "p2"]));
    await screen.findByText("Pierwszy wpis");

    fireEvent.click(screen.getAllByRole("checkbox")[0]!);

    expect(lastPatch(onChange).postIds).toEqual(["p2"]);
    // Odznaczenie zdejmuje JEDEN wpis, nie czyści całego wyboru.
    expect(lastPatch(onChange).postIds).toHaveLength(1);
  });

  it("licznik pokazuje, ILE z dziesięciu jest wybranych", async () => {
    env.posts = WPISY;
    mount(manualBlock(["p1", "p2"]));
    await screen.findByText("Pierwszy wpis");

    expect(screen.getByText(`${L("selected")}: 2/10`)).toBeTruthy();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });

  it("już wybrane wpisy są ZAZNACZONE na liście", async () => {
    env.posts = WPISY;
    mount(manualBlock(["p2"]));
    await screen.findByText("Drugi wpis");

    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes[0]!.checked).toBe(false);
    expect(boxes[1]!.checked).toBe(true);
  });

  it("wpis bez polskiego tytułu podpisuje się SLUGIEM, a nie pustką", async () => {
    // Bezimienna pozycja na liście to wpis, którego redaktor nie potrafi wybrać.
    env.posts = [{ id: "p3", slug: "bez-tytulu", title_pl: null, title_en: null }];
    mount(manualBlock());

    expect(await screen.findByText("bez-tytulu")).toBeTruthy();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  });

  it("wpisanie frazy nie gubi listy wybranych", async () => {
    env.posts = WPISY;
    const { onChange } = mount(manualBlock(["p1"]));
    await screen.findByText("Pierwszy wpis");

    fireEvent.change(screen.getByPlaceholderText(L("searchPost")), { target: { value: "drugi" } });

    expect(screen.getByText(`${L("selected")}: 1/10`)).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("tłumaczenia panelu", () => {
  it("etykiety idą za językiem interfejsu", async () => {
    await i18n.changeLanguage("en");
    try {
      mount(make("heading"));

      expect(screen.getByText(i18n.t("adminNewsletter.blockProps.text"))).toBeTruthy();
      expect(screen.getByText(i18n.t("adminNewsletter.blockProps.alignment"))).toBeTruthy();
    } finally {
      await i18n.changeLanguage("pl");
    }
  });

  it("angielski tytuł wpisu wygrywa w angielskim interfejsie", async () => {
    env.posts = [{ id: "p1", slug: "s", title_pl: "Polski", title_en: "English" }];
    await i18n.changeLanguage("en");
    try {
      mount({
        ...(createEmailBlock("post-list") as EmailPostListBlock),
        mode: "manual",
        postIds: [],
      } as EmailBlock);

      expect(await screen.findByText("English")).toBeTruthy();
      expect(screen.queryByText("Polski")).toBeNull();
    } finally {
      await i18n.changeLanguage("pl");
    }
  });
});

// Typ używany tylko dla czytelności asercji obrazu.
export type _ImageBlockUsed = EmailImageBlock;
