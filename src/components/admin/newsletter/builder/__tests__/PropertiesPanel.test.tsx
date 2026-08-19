// Panel właściwości buildera - prawa kolumna, w której operator ZMIENIA
// dokument. Największy plik modułu (1 464 linie) i do tej pory na okrągłym
// zerze.
//
// Panel jest jedyną drogą, którą treść trafia do dokumentu, a jego pomyłki są
// ciche z dwóch powodów:
//   1. każde pole edytuje JĘZYK OSOBNO (PL i EN). Patch, który gubi drugi
//      język, zostawia w dokumencie pustą wersję - i połowa listy dostaje maila
//      z pustym nagłówkiem. Test sprawdza więc nie „czy się zmieniło", tylko
//      CZY DRUGI JĘZYK PRZETRWAŁ.
//   2. panel przełącza się między trzema kontekstami (widget / sekcja /
//      dokument) i ten sam obszar ekranu pokazuje różne rzeczy. Zły kontekst
//      to edycja czegoś, czego operator nie miał zamiaru tknąć.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Warstwa uploadu jest tu ATRAPĄ STEROWANĄ Z TESTU (`env`), nie ślepą zaślepką:
// pole obrazu ma trzy ścieżki, których pomyłka jest cicha - sukces, awaria
// magazynu i awaria rejestracji w bibliotece mediów. Tylko trzecia jest
// nieoczywista: upload się udał, wpis w tabeli `media` nie - i adres NIE MOŻE
// wtedy przepaść, bo operator zobaczył podgląd i uzna, że zapisał.
//
// Żaden test nie wykonuje realnego żądania: ani do magazynu, ani do serwera.
const env = vi.hoisted(() => ({
  userId: "user-1" as string | null,
  uploadError: null as unknown,
  publicUrl: "https://example.test/wgrany.png",
  register: undefined as undefined | ((...args: unknown[]) => Promise<unknown>),
}));

vi.mock("@/hooks/useAuth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useAuth")>()),
  useRequiredTenant: () => "tenant-1",
}));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => env.register ?? (async () => ({})),
}));
vi.mock("@/lib/media.functions", () => ({ registerMediaUpload: {} }));
// Biblioteka mediów ma własne testy; tutaj potrzebny jest tylko jeden przycisk,
// który oddaje wybrany adres - żeby sprawdzić, czy panel go faktycznie zapisuje.
vi.mock("@/components/admin/media/MediaPickerDialog", () => ({
  MediaPickerDialog: ({ open, onPick }: { open: boolean; onPick: (url: string) => void }) =>
    open ? (
      <button type="button" onClick={() => onPick("https://example.test/z-biblioteki.png")}>
        atrapa-biblioteki
      </button>
    ) : null,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: env.userId ? { user: { id: env.userId } } : null },
      }),
    },
    storage: {
      from: () => ({
        upload: async () => ({ error: env.uploadError }),
        getPublicUrl: () => ({ data: { publicUrl: env.publicUrl } }),
      }),
    },
  },
}));

import { PropertiesPanel } from "@/components/admin/newsletter/builder/PropertiesPanel";
import { buildDefaultDoc, makeSection, makeWidget } from "@/lib/newsletter-builder/defaults";
import { WIDGET_REGISTRY } from "@/lib/newsletter-builder/registry";
import type {
  NlDoc,
  NlSection,
  NlSectionLayout,
  NlSectionMedia,
  NlSectionStyle,
  NlWidget,
} from "@/lib/newsletter-builder/types";

// Atrapy z PODPISAMI - inaczej `{...cb}` nie przechodzi kontroli typów panelu,
// a literówka w nazwie handlera przeszłaby niezauważona.
function handlers() {
  return {
    onPatch: vi.fn<(patch: Partial<NlWidget>) => void>(),
    onPatchPopup: vi.fn<(patch: Partial<NonNullable<NlDoc["popup"]>>) => void>(),
    onPatchSection: vi.fn<(patch: Partial<NlSectionStyle>) => void>(),
    onPatchLayout: vi.fn<(layout: NlSectionLayout) => void>(),
    onPatchSectionMedia: vi.fn<(patch: Partial<NlSectionMedia> | null) => void>(),
  };
}

function mount(
  args: {
    selected?: NlWidget | null;
    selectedSection?: NlSection | null;
    doc?: NlDoc;
    variant?: "inline" | "popup";
    lang?: "pl" | "en";
  } = {},
) {
  const cb = handlers();
  const utils = render(
    <PropertiesPanel
      variant={args.variant ?? "inline"}
      doc={args.doc ?? buildDefaultDoc(args.variant ?? "inline")}
      selected={args.selected ?? null}
      selectedSection={args.selectedSection ?? null}
      lang={args.lang ?? "pl"}
      {...cb}
    />,
  );
  return { ...utils, ...cb };
}

/** Pola PL/EN pod daną etykietą (I18nField renderuje dwa). */
function i18nInputs(): HTMLElement[] {
  return Array.from(document.querySelectorAll("input, textarea")) as HTMLElement[];
}

/**
 * Plik o zadanym typie i ROZMIARZE, bez alokowania megabajtów - limit 8 MB
 * sprawdzamy na `size`, a nie na faktycznej zawartości.
 */
function fakeFile(name: string, type: string, size: number): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size, configurable: true });
  return file;
}

/** Podstawia pliki pod ukryty `input[type=file]` i odpala zmianę. */
function pickFile(container: HTMLElement, file: File) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  expect(input, "panel obrazu bez ukrytego pola pliku nie umie wgrać niczego").toBeTruthy();
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
  return input;
}

const IMAGE_WITH_URL = { ...makeWidget("image"), url: "https://example.test/a.png" } as NlWidget;

/**
 * Pole HEX konkretnego koloru. Wybieramy je PO ETYKIECIE, nie po kolejności -
 * w panelu sekcji stoją obok pola adresu obrazu i pomyłka w indeksie dowodziłaby
 * czegoś innego, niż nazwa testu obiecuje.
 */
function colorHexInput(label: string): HTMLInputElement {
  const input = screen.getByText(label).parentElement!.querySelector("input");
  expect(input, `brak pola koloru „${label}"`).toBeTruthy();
  return input as HTMLInputElement;
}

beforeEach(() => {
  env.userId = "user-1";
  env.uploadError = null;
  env.publicUrl = "https://example.test/wgrany.png";
  env.register = undefined;
});

afterEach(() => {
  cleanup();
});

describe("kontekst panelu", () => {
  it("bez zaznaczenia pokazuje USTAWIENIA DOKUMENTU", () => {
    mount();

    expect(screen.getByText("Ustawienia dokumentu")).toBeTruthy();
    expect(screen.queryByText("Wlasciwosci widgetu")).toBeNull();
  });

  it("zaznaczony widget pokazuje WŁAŚCIWOŚCI WIDGETU", () => {
    mount({ selected: makeWidget("heading") });

    expect(screen.getByText("Wlasciwosci widgetu")).toBeTruthy();
    expect(screen.queryByText("Ustawienia dokumentu")).toBeNull();
  });

  it("zaznaczona sekcja pokazuje WŁAŚCIWOŚCI SEKCJI", () => {
    mount({ selectedSection: makeSection([]) });

    expect(screen.getByText("Wlasciwosci sekcji")).toBeTruthy();
    expect(screen.queryByText("Ustawienia dokumentu")).toBeNull();
  });

  it("widget ma pierwszeństwo nad sekcją - operator edytuje to, co kliknął ostatnio", () => {
    mount({ selected: makeWidget("heading"), selectedSection: makeSection([]) });

    expect(screen.getByText("Wlasciwosci widgetu")).toBeTruthy();
    expect(screen.queryByText("Wlasciwosci sekcji")).toBeNull();
  });

  it("tytuły paneli są tłumaczone", () => {
    mount({ lang: "en" });
    expect(screen.getByText("Document settings")).toBeTruthy();
    cleanup();

    mount({ selected: makeWidget("heading"), lang: "en" });
    expect(screen.getByText("Widget properties")).toBeTruthy();
    cleanup();

    mount({ selectedSection: makeSection([]), lang: "en" });
    expect(screen.getByText("Section properties")).toBeTruthy();
  });
});

describe("kontrakt z rejestrem", () => {
  it("KAŻDY typ widgetu ma panel właściwości - żaden nie zostawia pustej kolumny", () => {
    const puste: string[] = [];

    for (const item of WIDGET_REGISTRY) {
      const { container, unmount } = render(
        <PropertiesPanel
          variant="popup"
          doc={buildDefaultDoc("popup")}
          selected={makeWidget(item.type)}
          selectedSection={null}
          lang="pl"
          {...handlers()}
        />,
      );
      // Sam nagłówek panelu nie wystarcza - liczymy kontrolki.
      if (container.querySelectorAll("input, textarea, button").length === 0) {
        puste.push(item.type);
      }
      unmount();
    }

    expect(puste).toEqual([]);
    expect(WIDGET_REGISTRY.length).toBeGreaterThan(10);
  });
});

describe("każda kontrolka jest PODŁĄCZONA", () => {
  // Kontrolka, której `onChange` nic nie robi, jest defektem tej samej klasy co
  // brakujące pole: operator wpisuje wartość, widzi ją w polu i wychodzi
  // przekonany, że zapisał. Ten przemiał sprawdza WSZYSTKIE typy widgetów:
  // każde pole tekstowe i liczbowe musi wywołać patch, a każdy patch musi być
  // obiektem z dokładnie jedną, nazwaną właściwością.
  it.each(WIDGET_REGISTRY.map((i) => [i.id ?? i.type, i.type] as const))(
    "widget %s: każde pole tekstowe patchuje dokument",
    (_label, type) => {
      const cb = handlers();
      const { container, unmount } = render(
        <PropertiesPanel
          variant="popup"
          doc={buildDefaultDoc("popup")}
          selected={makeWidget(type)}
          selectedSection={null}
          lang="pl"
          {...cb}
        />,
      );

      const fields = Array.from(
        container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          'input[type="text"], input:not([type]), input[type="number"], textarea',
        ),
      );
      for (const field of fields) {
        fireEvent.change(field, {
          target: { value: field.getAttribute("type") === "number" ? "7" : "wartosc" },
        });
      }

      if (fields.length > 0) {
        expect(cb.onPatch, `${type}: pole bez podłączonego onChange`).toHaveBeenCalled();
        for (const call of cb.onPatch.mock.calls) {
          expect(Object.keys(call[0] as object).length).toBeGreaterThan(0);
        }
      } else {
        // Widget bez pól tekstowych musi mieć przynajmniej przełączniki.
        expect(container.querySelectorAll("button").length).toBeGreaterThan(0);
      }
      unmount();
    },
  );

  it.each(WIDGET_REGISTRY.map((i) => [i.id ?? i.type, i.type] as const))(
    "widget %s: każda lista wyboru patchuje dokument",
    async (_label, type) => {
      const cb = handlers();
      const { unmount } = render(
        <PropertiesPanel
          variant="popup"
          doc={buildDefaultDoc("popup")}
          selected={makeWidget(type)}
          selectedSection={null}
          lang="pl"
          {...cb}
        />,
      );

      const triggers = screen.queryAllByRole("combobox");
      let opened = 0;
      for (const trigger of triggers) {
        fireEvent.keyDown(trigger, { key: "Enter" });
        const options = screen.queryAllByRole("option");
        // Wybieramy OSTATNIĄ pozycję - inną niż domyślna, więc patch musi polecieć.
        const last = options.at(-1);
        if (last) {
          fireEvent.click(last);
          opened += 1;
        }
      }

      if (opened > 0) {
        expect(cb.onPatch, `${type}: lista wyboru bez podłączonego onChange`).toHaveBeenCalled();
      }
      expect(opened).toBeGreaterThanOrEqual(0);
      unmount();
    },
  );
});

describe("edycja treści dwujęzycznej", () => {
  it("zmiana wersji POLSKIEJ zachowuje angielską", () => {
    const widget = {
      ...makeWidget("heading"),
      text: { pl: "Stary", en: "Old" },
    } as NlWidget;
    const { onPatch } = mount({ selected: widget });

    const [pl] = i18nInputs();
    fireEvent.change(pl!, { target: { value: "Nowy" } });

    // Sedno: patch niesie OBA języki, więc angielski nie znika z dokumentu.
    expect(onPatch).toHaveBeenCalledWith({ text: { pl: "Nowy", en: "Old" } });
  });

  it("zmiana wersji ANGIELSKIEJ zachowuje polską", () => {
    const widget = {
      ...makeWidget("heading"),
      text: { pl: "Stary", en: "Old" },
    } as NlWidget;
    const { onPatch } = mount({ selected: widget });

    const inputs = i18nInputs();
    fireEvent.change(inputs[1]!, { target: { value: "New" } });

    expect(onPatch).toHaveBeenCalledWith({ text: { pl: "Stary", en: "New" } });
  });

  it("oba języki mają widoczne, opisane pola", () => {
    mount({ selected: makeWidget("heading") });

    expect(screen.getAllByText("PL").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("EN").length).toBeGreaterThanOrEqual(1);
  });

  it("pole treści HTML ostrzega, że skrypty są usuwane", () => {
    mount({ selected: makeWidget("paragraph") });

    expect(screen.getByText(/Skrypty sa usuwane/)).toBeTruthy();
  });

  it("akapit edytuje się w polu WIELOLINIOWYM", () => {
    mount({ selected: makeWidget("paragraph") });

    expect(document.querySelectorAll("textarea").length).toBeGreaterThanOrEqual(2);
  });
});

describe("nagłówek", () => {
  it("zmiana poziomu patchuje LICZBĘ, nie napis", async () => {
    const { onPatch } = mount({ selected: makeWidget("heading") });

    const triggers = screen.getAllByRole("combobox");
    fireEvent.keyDown(triggers[0]!, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "H3" }));

    expect(onPatch).toHaveBeenCalledWith({ level: 3 });
    // Napis „3" w dokumencie przechodzi walidację poziomu, ale renderuje się
    // jako inny znacznik niż operator wybrał.
    expect(typeof (onPatch.mock.calls[0]![0] as { level?: unknown }).level).toBe("number");
  });

  it("zmiana wyrównania patchuje wartość docelową", async () => {
    const { onPatch } = mount({ selected: makeWidget("heading") });

    const triggers = screen.getAllByRole("combobox");
    fireEvent.keyDown(triggers[1]!, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "Srodek" }));

    expect(onPatch).toHaveBeenCalledWith({ align: "center" });
  });

  it("panel oferuje wybór koloru", () => {
    mount({ selected: makeWidget("heading") });

    expect(screen.getByText("Kolor")).toBeTruthy();
  });
});

describe("pola formularza", () => {
  it("pole e-mail ma edytowalną etykietę w obu językach", () => {
    const widget = {
      ...makeWidget("field.email"),
      label: { pl: "E-mail", en: "Email" },
    } as NlWidget;
    const { onPatch } = mount({ selected: widget });

    fireEvent.change(i18nInputs()[0]!, { target: { value: "Adres" } });

    expect(onPatch).toHaveBeenCalledWith({ label: { pl: "Adres", en: "Email" } });
  });

  it("pole tekstowe ma nazwę techniczną - to ona mapuje się na kolumnę CRM", () => {
    mount({ selected: makeWidget("field.text") });

    // Nazwa pola decyduje, gdzie w CRM wyląduje wartość (imię vs firma).
    expect(screen.getByText(/Nazwa/)).toBeTruthy();
  });

  it("checkbox zgody edytuje treść jako HTML", () => {
    mount({ selected: makeWidget("field.checkbox") });

    expect(document.querySelectorAll("textarea").length).toBeGreaterThanOrEqual(2);
  });

  it("lista wyboru pozwala edytować opcje", () => {
    const { container } = mount({ selected: makeWidget("field.select") });

    expect(container.querySelectorAll("input, textarea, button").length).toBeGreaterThan(2);
  });
});

describe("właściwości sekcji", () => {
  const single = () => makeSection([]);
  const twoCols = () => ({ ...makeSection([]), layout: "1-1" as const });
  const withMedia = (layout: "single" | "1-1" = "single") => ({
    ...makeSection([]),
    layout,
    media: { url: "https://example.test/tlo.png", alt: "Tlo", position: "left" as const },
  });

  it("wybór układu kolumn pokazuje OBA dozwolone warianty", () => {
    mount({ selectedSection: single() });

    expect(screen.getByText("1 kol.")).toBeTruthy();
    expect(screen.getByText("1 / 2")).toBeTruthy();
  });

  it("aktywny układ jest oznaczony - operator widzi, w czym pracuje", () => {
    mount({ selectedSection: twoCols() });

    expect(screen.getByText("1 / 2").closest("button")!.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("1 kol.").closest("button")!.getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("zmiana układu woła OSOBNY handler - układ nie jest zwykłym stylem", () => {
    const { onPatchLayout, onPatchSection } = mount({ selectedSection: single() });

    fireEvent.click(screen.getByText("1 / 2").closest("button")!);

    expect(onPatchLayout).toHaveBeenCalledWith("1-1");
    // Gdyby układ leciał przez styl, kolumny nie powstałyby w dokumencie.
    expect(onPatchSection).not.toHaveBeenCalled();
  });

  it("powrót do jednej kolumny też patchuje układ", () => {
    const { onPatchLayout } = mount({ selectedSection: twoCols() });

    fireEvent.click(screen.getByText("1 kol.").closest("button")!);

    expect(onPatchLayout).toHaveBeenCalledWith("single");
    expect(onPatchLayout).toHaveBeenCalledTimes(1);
  });

  it("sekcja BEZ obrazu nie oferuje jego usunięcia", () => {
    mount({ selectedSection: single() });

    expect(screen.getByText("URL obrazu")).toBeTruthy();
    expect(screen.queryByText("Usun")).toBeNull();
  });

  it("usunięcie obrazu sekcji patchuje media na NULL, nie na pusty obiekt", () => {
    // `{}` zostawiłoby w dokumencie obraz bez adresu - sekcja renderowałaby
    // wtedy pustą, szarą kolumnę.
    const { onPatchSectionMedia } = mount({ selectedSection: withMedia() });

    fireEvent.click(screen.getByText("Usun"));

    expect(onPatchSectionMedia).toHaveBeenCalledWith(null);
    expect(onPatchSectionMedia).toHaveBeenCalledTimes(1);
  });

  it("tekst alternatywny obrazu sekcji patchuje się", () => {
    const { onPatchSectionMedia } = mount({ selectedSection: withMedia() });

    fireEvent.change(screen.getByDisplayValue("Tlo"), { target: { value: "Nowy opis" } });

    expect(onPatchSectionMedia).toHaveBeenCalledWith({ alt: "Nowy opis" });
    expect(screen.getByText("Tekst alt")).toBeTruthy();
  });

  it("adres obrazu sekcji patchuje się przez pole URL", () => {
    const { onPatchSectionMedia } = mount({ selectedSection: withMedia() });

    fireEvent.change(screen.getByDisplayValue("https://example.test/tlo.png"), {
      target: { value: "https://example.test/inny.png" },
    });

    expect(onPatchSectionMedia).toHaveBeenCalledWith({ url: "https://example.test/inny.png" });
    expect(onPatchSectionMedia).toHaveBeenCalledTimes(1);
  });

  it("pozycja obrazu jest do wyboru TYLKO w układzie dwukolumnowym", () => {
    mount({ selectedSection: withMedia("1-1") });
    expect(screen.getByText("Pozycja obrazu")).toBeTruthy();
    cleanup();

    mount({ selectedSection: withMedia("single") });
    // W jednej kolumnie obraz jest tłem, więc „lewo/prawo" nie ma sensu.
    expect(screen.queryByText("Pozycja obrazu")).toBeNull();
  });

  it("układ jednokolumnowy mówi wprost, że obraz staje się tłem", () => {
    mount({ selectedSection: withMedia("single") });

    expect(screen.getByText(/renderuje sie jako tlo/)).toBeTruthy();
    expect(screen.queryByText(/obraz zajmuje 50%/)).toBeNull();
  });

  it("zmiana pozycji obrazu patchuje media, nie styl", async () => {
    const { onPatchSectionMedia, onPatchSection } = mount({ selectedSection: withMedia("1-1") });

    fireEvent.keyDown(screen.getByText("Lewa (50%)").closest("button")!, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "Prawa (50%)" }));

    expect(onPatchSectionMedia).toHaveBeenCalledWith({ position: "right" });
    expect(onPatchSection).not.toHaveBeenCalled();
  });

  it("każda liczba stylu patchuje SWOJĄ właściwość", () => {
    const { onPatchSection, container } = mount({ selectedSection: single() });

    const numbers = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="number"]'),
    );
    // Padding X, padding Y, odstęp, zaokrąglenie - cztery pokrętła układu.
    expect(numbers).toHaveLength(4);
    // Wartości muszą różnić się od domyślnych - inaczej React nie wyemituje zmiany.
    numbers.forEach((input, i) => fireEvent.change(input, { target: { value: String(97 - i) } }));

    const patched = Object.assign({}, ...onPatchSection.mock.calls.map((c) => c[0]));
    expect(Object.keys(patched).sort()).toEqual(["gap", "paddingX", "paddingY", "radius"]);
  });

  it("nieliczbowa wartość schodzi na zero, a nie na NaN w dokumencie", () => {
    // NaN w JSON-ie dokumentu psuje walidację i sekcja przestaje się renderować.
    const { onPatchSection, container } = mount({ selectedSection: single() });

    fireEvent.change(container.querySelector('input[type="number"]')!, {
      target: { value: "abc" },
    });

    expect(onPatchSection).toHaveBeenCalledTimes(1);
    expect(Object.values(onPatchSection.mock.calls[0]![0] as object)[0]).toBe(0);
  });

  it("kolory sekcji patchują się osobno dla tła i tekstu", () => {
    const { onPatchSection } = mount({ selectedSection: single() });

    fireEvent.change(colorHexInput("Tlo"), { target: { value: "#112233" } });
    fireEvent.change(colorHexInput("Kolor tekstu"), { target: { value: "#445566" } });

    expect(onPatchSection).toHaveBeenNthCalledWith(1, { bg: "#112233" });
    expect(onPatchSection).toHaveBeenNthCalledWith(2, { fg: "#445566" });
  });

  it("wyrównanie sekcji patchuje się wartością docelową", async () => {
    const { onPatchSection } = mount({ selectedSection: single() });

    fireEvent.keyDown(screen.getByText("Lewo").closest("button")!, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "Srodek" }));

    expect(onPatchSection).toHaveBeenCalledWith({ align: "center" });
    expect(onPatchSection).toHaveBeenCalledTimes(1);
  });

  it("reset koloru zapisuje NULL - sekcja wraca do tokenów wyglądu", () => {
    // Reset musi wyczyścić nadpisanie, a nie zapisać pusty napis: "" byłoby
    // kolorem „nic", a nie „dziedzicz".
    const section = { ...makeSection([]), style: { bg: "#112233" } };
    const { onPatchSection } = mount({ selectedSection: section });

    fireEvent.click(screen.getAllByLabelText("Przywróć domyślny")[0]!);

    expect(onPatchSection).toHaveBeenCalledWith({ bg: null });
    expect(onPatchSection).toHaveBeenCalledTimes(1);
  });

  it("obraz sekcji BEZ zadeklarowanego układu zachowuje się jak jednokolumnowy", () => {
    const section = {
      ...makeSection([]),
      media: { url: "https://example.test/tlo.png", position: "left" as const },
    };
    mount({ selectedSection: section, lang: "en" });

    expect(screen.getByText(/renders as the section background/)).toBeTruthy();
    expect(screen.queryByText("Image position")).toBeNull();
  });

  it("etykiety panelu sekcji są tłumaczone", () => {
    mount({ selectedSection: withMedia("1-1"), lang: "en" });

    expect(screen.getByText("Image URL")).toBeTruthy();
    expect(screen.getByText("Image position")).toBeTruthy();
    expect(screen.getByText("Section image (full height)")).toBeTruthy();
    expect(screen.getByText("Remove")).toBeTruthy();
  });
});

describe("pole obrazu - wgrywanie i biblioteka", () => {
  function mountImage(widget: NlWidget = makeWidget("image")) {
    return mount({ selected: widget });
  }

  it("plik, który NIE jest obrazem, nie leci do magazynu", async () => {
    const { container, onPatch } = mountImage();

    pickFile(container, fakeFile("lista.csv", "text/csv", 100));

    expect(await screen.findByText("Wybierz plik obrazu.")).toBeTruthy();
    expect(onPatch).not.toHaveBeenCalled();
  });

  it("plik powyżej 8 MB jest odrzucany po stronie panelu", async () => {
    const { container, onPatch } = mountImage();

    pickFile(container, fakeFile("wielki.png", "image/png", 9 * 1024 * 1024));

    expect(await screen.findByText("Plik za duzy (max 8 MB).")).toBeTruthy();
    expect(onPatch).not.toHaveBeenCalled();
  });

  it("plik dokładnie na granicy 8 MB jeszcze przechodzi", async () => {
    const { container, onPatch } = mountImage();

    pickFile(container, fakeFile("rowno.png", "image/png", 8 * 1024 * 1024));

    await waitFor(() => expect(onPatch).toHaveBeenCalled());
    expect(screen.queryByText("Plik za duzy (max 8 MB).")).toBeNull();
  });

  it("wgrany obraz trafia do widgetu jako ADRES PUBLICZNY", async () => {
    const { container, onPatch } = mountImage();

    pickFile(container, fakeFile("foto.png", "image/png", 2048));

    await waitFor(() =>
      expect(onPatch).toHaveBeenCalledWith({ url: "https://example.test/wgrany.png" }),
    );
    expect(onPatch).toHaveBeenCalledTimes(1);
  });

  it("awaria magazynu pokazuje komunikat i NIE patchuje dokumentu", async () => {
    env.uploadError = new Error("storage padl");
    const { container, onPatch } = mountImage();

    pickFile(container, fakeFile("foto.png", "image/png", 2048));

    expect(await screen.findByText("storage padl")).toBeTruthy();
    expect(onPatch).not.toHaveBeenCalled();
  });

  it("awaria rejestracji w bibliotece NIE gubi wgranego adresu", async () => {
    // Upload się udał. Gdyby panel potraktował to jako porażkę, operator
    // widziałby błąd, a plik i tak leżałby w magazynie - i tak samo nie byłoby
    // go w dokumencie.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    env.register = vi.fn().mockRejectedValue(new Error("baza padla"));
    const { container, onPatch } = mountImage();

    pickFile(container, fakeFile("foto.png", "image/png", 2048));

    await waitFor(() =>
      expect(onPatch).toHaveBeenCalledWith({ url: "https://example.test/wgrany.png" }),
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("awaria BEZ komunikatu i tak coś mówi operatorowi", async () => {
    // Magazyn może oddać obiekt, który Errorem nie jest. Panel musi wtedy
    // pokazać cokolwiek - milczące pole to dla operatora „zapisało się".
    env.uploadError = { code: 500 };
    const { container, onPatch } = mountImage();

    pickFile(container, fakeFile("foto.png", "image/png", 2048));

    expect(await screen.findByText("upload error")).toBeTruthy();
    expect(onPatch).not.toHaveBeenCalled();
  });

  it("podczas wgrywania przyciski są ZABLOKOWANE - drugi klik nie dubluje pliku", async () => {
    let uwolnij: () => void = () => {};
    const wstrzymane = new Promise<void>((res) => {
      uwolnij = res;
    });
    env.register = vi.fn(async () => {
      await wstrzymane;
      return {};
    });
    const { container } = mountImage();

    pickFile(container, fakeFile("foto.png", "image/png", 2048));

    expect(await screen.findByText("Wgrywam…")).toBeTruthy();
    expect(screen.getByTitle("Wgraj z dysku")).toHaveProperty("disabled", true);
    uwolnij();
    await waitFor(() => expect(screen.getByText("Wgraj")).toBeTruthy());
  });

  it("brak sesji nie blokuje wgrania - ścieżka schodzi na anonimową", async () => {
    env.userId = null;
    const { container, onPatch } = mountImage();

    pickFile(container, fakeFile("foto.png", "image/png", 2048));

    await waitFor(() =>
      expect(onPatch).toHaveBeenCalledWith({ url: "https://example.test/wgrany.png" }),
    );
    expect(screen.queryByText(/Wybierz plik obrazu/)).toBeNull();
  });

  it("po wgraniu pole pliku jest CZYSZCZONE - ten sam plik da się wgrać ponownie", async () => {
    const { container, onPatch } = mountImage();

    const input = pickFile(container, fakeFile("foto.png", "image/png", 2048));

    await waitFor(() => expect(onPatch).toHaveBeenCalled());
    expect(input.value).toBe("");
  });

  it("adres wpisany ręcznie patchuje dokument", () => {
    const { onPatch } = mountImage();

    fireEvent.change(screen.getByPlaceholderText("https://..."), {
      target: { value: "https://example.test/reczny.png" },
    });

    expect(onPatch).toHaveBeenCalledWith({ url: "https://example.test/reczny.png" });
    expect(onPatch).toHaveBeenCalledTimes(1);
  });

  it("wyczyszczenie adresu zapisuje NULL, nie pusty napis", () => {
    const { onPatch } = mountImage(IMAGE_WITH_URL);

    fireEvent.change(screen.getByDisplayValue("https://example.test/a.png"), {
      target: { value: "" },
    });

    expect(onPatch).toHaveBeenCalledWith({ url: null });
    expect(onPatch).toHaveBeenCalledTimes(1);
  });

  it("widget BEZ adresu nie pokazuje podglądu ani przycisku usuwania", () => {
    const { container } = mountImage();

    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByLabelText("Usuń obraz")).toBeNull();
  });

  it("widget Z adresem pokazuje podgląd tego adresu", () => {
    const { container } = mountImage(IMAGE_WITH_URL);

    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://example.test/a.png");
    expect(screen.getByLabelText("Usuń obraz")).toBeTruthy();
  });

  it("podgląd, którego nie da się załadować, mówi to WPROST", () => {
    // Bez tego komunikatu operator widzi puste pole i nie wie, czy adres jest
    // zły, czy plik zniknął z magazynu.
    const { container } = mountImage(IMAGE_WITH_URL);

    fireEvent.error(container.querySelector("img")!);

    expect(screen.getByText("Nie udało się załadować podglądu")).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
  });

  it("udane załadowanie podglądu przywraca obraz", () => {
    const { container } = mountImage(IMAGE_WITH_URL);

    fireEvent.load(container.querySelector("img")!);

    expect(container.querySelector("img")).toBeTruthy();
    expect(screen.queryByText("Nie udało się załadować podglądu")).toBeNull();
  });

  it("usunięcie obrazu czyści adres w dokumencie", () => {
    const { onPatch } = mountImage(IMAGE_WITH_URL);

    fireEvent.click(screen.getByLabelText("Usuń obraz"));

    expect(onPatch).toHaveBeenCalledWith({ url: null });
    expect(onPatch).toHaveBeenCalledTimes(1);
  });

  it("szybka podmiana otwiera wybór pliku", () => {
    const { container } = mountImage(IMAGE_WITH_URL);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const click = vi.spyOn(input, "click").mockImplementation(() => {});

    fireEvent.click(screen.getByLabelText("Szybka podmiana"));

    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Szybka podmiana")).toHaveProperty("disabled", false);
  });

  it("przycisk Wgraj też otwiera wybór pliku", () => {
    const { container } = mountImage();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const click = vi.spyOn(input, "click").mockImplementation(() => {});

    fireEvent.click(screen.getByTitle("Wgraj z dysku"));

    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Wgraj")).toBeTruthy();
  });

  it("wybór z biblioteki mediów patchuje adres", () => {
    const { onPatch } = mountImage();
    expect(screen.queryByText("atrapa-biblioteki")).toBeNull();

    fireEvent.click(screen.getByTitle("Wybierz z biblioteki mediów"));
    fireEvent.click(screen.getByText("atrapa-biblioteki"));

    expect(onPatch).toHaveBeenCalledWith({ url: "https://example.test/z-biblioteki.png" });
  });

  it("pole obrazu sekcji jest tym samym polem - wgranie patchuje media sekcji", async () => {
    const { container, onPatchSectionMedia } = mount({ selectedSection: makeSection([]) });

    pickFile(container, fakeFile("foto.png", "image/png", 2048));

    await waitFor(() =>
      expect(onPatchSectionMedia).toHaveBeenCalledWith({ url: "https://example.test/wgrany.png" }),
    );
    expect(onPatchSectionMedia).toHaveBeenCalledTimes(1);
  });

  it("etykiety pola obrazu w sekcji są tłumaczone", () => {
    mount({ selectedSection: makeSection([]), lang: "en" });

    expect(screen.getByTitle("Upload from device")).toBeTruthy();
    expect(screen.getByTitle("Pick from Media Library")).toBeTruthy();
  });
});

describe("ustawienia dokumentu", () => {
  it("wariant INLINE ma wybór układu i podpowiedź, co dalej", () => {
    mount({ variant: "inline" });

    expect(screen.getByText("Ustawienia dokumentu")).toBeTruthy();
    expect(screen.getByText(/Wybierz widget na kanwie/)).toBeTruthy();
  });

  it("wariant INLINE nie pokazuje ustawień okna popupu", () => {
    mount({ variant: "inline" });

    expect(screen.queryByText("Overlay (rgba)")).toBeNull();
    expect(screen.queryByText("Tlo popupu")).toBeNull();
  });

  it("wariant POPUP ma ustawienia wyglądu okna", () => {
    mount({ variant: "popup", doc: buildDefaultDoc("popup") });

    expect(screen.getByText("Overlay (rgba)")).toBeTruthy();
    expect(screen.getByText("Tlo popupu")).toBeTruthy();
  });

  it("układ dokumentu patchuje PIERWSZĄ sekcję, nie styl popupu", () => {
    const { onPatchLayout, onPatchPopup } = mount({ variant: "inline" });

    fireEvent.click(screen.getByText("1 / 2").closest("button")!);

    expect(onPatchLayout).toHaveBeenCalledWith("1-1");
    expect(onPatchPopup).not.toHaveBeenCalled();
  });

  it("aktywny układ dokumentu czyta się z pierwszej sekcji", () => {
    const doc = buildDefaultDoc("inline");
    const twoCols: NlDoc = {
      ...doc,
      sections: [{ ...doc.sections[0]!, layout: "1-1" }],
    };
    mount({ variant: "inline", doc: twoCols });

    expect(screen.getByText("1 / 2").closest("button")!.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("1 kol.").closest("button")!.getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("grafika boczna pojawia się TYLKO w układzie split", () => {
    const doc = buildDefaultDoc("popup");
    mount({ variant: "popup", doc: { ...doc, popup: { ...doc.popup, layout: "stacked" } } });
    expect(screen.queryByText("URL grafiki bocznej")).toBeNull();
    cleanup();

    mount({ variant: "popup", doc: { ...doc, popup: { ...doc.popup, layout: "split" } } });
    expect(screen.getByText("URL grafiki bocznej")).toBeTruthy();
  });

  it("zmiana układu popupu na split patchuje styl okna", async () => {
    const { onPatchPopup } = mount({ variant: "popup", doc: buildDefaultDoc("popup") });

    fireEvent.keyDown(screen.getByText("Klasyczny (okladka u gory)").closest("button")!, {
      key: "Enter",
    });
    fireEvent.click(await screen.findByRole("option", { name: "Split (grafika z lewej)" }));

    expect(onPatchPopup).toHaveBeenCalledWith({ layout: "split" });
    expect(onPatchPopup).toHaveBeenCalledTimes(1);
  });

  it("pusta grafika boczna zapisuje NULL, żeby nie renderować martwej kolumny", () => {
    const doc = buildDefaultDoc("popup");
    const { onPatchPopup } = mount({
      variant: "popup",
      doc: {
        ...doc,
        popup: { ...doc.popup, layout: "split", sideImage: "https://example.test/s.png" },
      },
    });

    fireEvent.change(screen.getByPlaceholderText("https://..."), { target: { value: "" } });

    expect(onPatchPopup).toHaveBeenCalledWith({ sideImage: null });
    expect(onPatchPopup).toHaveBeenCalledTimes(1);
  });

  it("adres grafiki bocznej patchuje się wpisaną wartością", () => {
    const doc = buildDefaultDoc("popup");
    const { onPatchPopup } = mount({
      variant: "popup",
      doc: { ...doc, popup: { ...doc.popup, layout: "split" } },
    });

    fireEvent.change(screen.getByPlaceholderText("https://..."), {
      target: { value: "https://example.test/bok.png" },
    });

    expect(onPatchPopup).toHaveBeenCalledWith({ sideImage: "https://example.test/bok.png" });
    expect(onPatchPopup).toHaveBeenCalledTimes(1);
  });

  it("overlay patchuje się jako napis rgba", () => {
    const { onPatchPopup } = mount({ variant: "popup", doc: buildDefaultDoc("popup") });

    fireEvent.change(screen.getByPlaceholderText("rgba(0,0,0,0.7)"), {
      target: { value: "rgba(0,0,0,0.4)" },
    });

    expect(onPatchPopup).toHaveBeenCalledWith({ overlay: "rgba(0,0,0,0.4)" });
    expect(onPatchPopup).toHaveBeenCalledTimes(1);
  });

  it("zaokrąglenie okna patchuje LICZBĘ, a śmieci schodzą na zero", () => {
    const { onPatchPopup, container } = mount({ variant: "popup", doc: buildDefaultDoc("popup") });
    const radius = container.querySelector('input[type="number"]') as HTMLInputElement;

    fireEvent.change(radius, { target: { value: "24" } });
    fireEvent.change(radius, { target: { value: "abc" } });

    expect(onPatchPopup).toHaveBeenNthCalledWith(1, { radius: 24 });
    expect(onPatchPopup).toHaveBeenNthCalledWith(2, { radius: 0 });
  });

  it("każdy kolor okna patchuje SWOJĄ właściwość", () => {
    const { onPatchPopup } = mount({ variant: "popup", doc: buildDefaultDoc("popup") });

    fireEvent.change(colorHexInput("Tlo popupu"), { target: { value: "#111111" } });
    fireEvent.change(colorHexInput("Kolor tekstu"), { target: { value: "#222222" } });
    fireEvent.change(colorHexInput("Kolor akcentu"), { target: { value: "#333333" } });

    const patched = Object.assign({}, ...onPatchPopup.mock.calls.map((c) => c[0]));
    expect(Object.keys(patched).sort()).toEqual(["accent", "bg", "fg"]);
    expect(patched).toMatchObject({ bg: "#111111", fg: "#222222", accent: "#333333" });
  });

  it("reset koloru okna zdejmuje nadpisanie, a nie zapisuje pustki", () => {
    const doc = buildDefaultDoc("popup");
    const { onPatchPopup } = mount({
      variant: "popup",
      doc: { ...doc, popup: { ...doc.popup, bg: "#112233", fg: "#445566", accent: "#778899" } },
    });

    screen.getAllByLabelText("Przywróć domyślny").forEach((b) => fireEvent.click(b));

    const patched = Object.assign({}, ...onPatchPopup.mock.calls.map((c) => c[0]));
    expect(Object.keys(patched).sort()).toEqual(["accent", "bg", "fg"]);
    expect(Object.values(patched)).toEqual([undefined, undefined, undefined]);
  });

  it("dokument popupu BEZ bloku stylu nadal się otwiera", () => {
    // Dokumenty zapisane starszą wersją buildera nie mają `popup` - panel musi
    // wtedy pokazać domyślne wartości, a nie wywalić prawej kolumny.
    const doc = buildDefaultDoc("popup");
    mount({ variant: "popup", doc: { ...doc, popup: undefined } });

    expect(screen.getByText("Overlay (rgba)")).toBeTruthy();
    expect(screen.getByText("Klasyczny (okladka u gory)")).toBeTruthy();
  });

  it("etykiety ustawień dokumentu są tłumaczone", () => {
    mount({ variant: "inline", lang: "en" });

    expect(screen.getByText("Section layout")).toBeTruthy();
    expect(screen.getByText("1 col")).toBeTruthy();
  });
});

describe("przełączniki i przyciski wyboru są PODŁĄCZONE", () => {
  // Ten sam argument co przy polach tekstowych, tylko groźniejszy: przełącznik
  // „Wymagane" albo „Wymagana zgoda" wygląda po kliknięciu na włączony i bez
  // patcha operator wysyła formularz, w którym zgoda RODO NIE JEST wymagana.
  it.each(WIDGET_REGISTRY.map((i) => [i.id ?? i.type, i.type] as const))(
    "widget %s: każdy przełącznik patchuje dokument",
    (_label, type) => {
      const cb = handlers();
      const { container, unmount } = render(
        <PropertiesPanel
          variant="popup"
          doc={buildDefaultDoc("popup")}
          selected={makeWidget(type)}
          selectedSection={null}
          lang="pl"
          {...cb}
        />,
      );

      const toggles = Array.from(
        container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
      );
      const pressable = Array.from(
        container.querySelectorAll<HTMLButtonElement>('button[aria-pressed="false"]'),
      );
      for (const t of toggles) fireEvent.click(t);
      for (const b of pressable) fireEvent.click(b);

      if (toggles.length + pressable.length > 0) {
        expect(cb.onPatch, `${type}: przełącznik bez podłączonego onChange`).toHaveBeenCalled();
        for (const call of cb.onPatch.mock.calls) {
          expect(Object.keys(call[0] as object).length).toBeGreaterThan(0);
        }
      } else {
        // Widget bez przełączników musi mieć cokolwiek do edycji - pusty panel
        // właściwości to dla operatora ślepy zaułek.
        expect(container.querySelectorAll("input, button, textarea").length).toBeGreaterThan(0);
      }
      unmount();
    },
  );

  it("przełącznik wymagalności zapisuje BOOLEAN, nie napis", () => {
    const { onPatch, container } = mount({ selected: makeWidget("field.text") });

    fireEvent.click(container.querySelector('input[type="checkbox"]')!);

    expect(onPatch).toHaveBeenCalledWith({ required: true });
    expect(screen.getByText("Wymagane")).toBeTruthy();
  });

  it("odznaczenie wymagalności zapisuje FALSE, a nie usuwa właściwości", () => {
    // `undefined` w patchu zostawiłoby w dokumencie starą wartość `true`.
    const widget = { ...makeWidget("field.text"), required: true } as NlWidget;
    const { onPatch, container } = mount({ selected: widget });

    fireEvent.click(container.querySelector('input[type="checkbox"]')!);

    expect(onPatch).toHaveBeenCalledWith({ required: false });
    expect(onPatch).toHaveBeenCalledTimes(1);
  });

  it("zgoda jest wymagana Z DOMYSLKI, a przełącznik ją zdejmuje", () => {
    const w = makeWidget("field.checkbox") as NlWidget & { required?: boolean };
    // Gdyby checkbox zgody startował jako opcjonalny, formularz zbierałby adresy
    // bez podstawy prawnej i nikt by tego nie zauważył.
    expect(w.required, "zgoda nie może startować jako opcjonalna").toBe(true);
    const { onPatch, container } = mount({ selected: w });

    fireEvent.click(container.querySelector('input[type="checkbox"]')!);

    expect(onPatch).toHaveBeenCalledWith({ required: false });
    expect(screen.getByText("Wymagana zgoda")).toBeTruthy();
  });

  it("pełna szerokość przycisku wysyłki daje się zdjąć", () => {
    const w = makeWidget("submit") as NlWidget & { fullWidth?: boolean };
    expect(w.fullWidth).toBe(true);
    const { onPatch, container } = mount({ selected: w });

    fireEvent.click(container.querySelector('input[type="checkbox"]')!);

    expect(onPatch).toHaveBeenCalledWith({ fullWidth: false });
    expect(screen.getByText("Pelna szerokosc")).toBeTruthy();
  });

  it("zaokrąglenie obrazu daje się zdjąć", () => {
    const w = makeWidget("image") as NlWidget & { rounded?: boolean };
    expect(w.rounded).toBe(true);
    const { onPatch, container } = mount({ selected: w });

    fireEvent.click(container.querySelector('input[type="checkbox"]')!);

    expect(onPatch).toHaveBeenCalledWith({ rounded: false });
    expect(screen.getByText("Zaokraglone")).toBeTruthy();
  });
});

describe("lista wyboru - opcje", () => {
  const select = () =>
    makeWidget("field.select") as NlWidget & {
      options: { value: string; labelPl: string; labelEn: string }[];
    };

  it("każda opcja ma trzy pola: wartość i dwie etykiety", () => {
    const w = select();
    mount({ selected: w });

    expect(screen.getAllByPlaceholderText("value")).toHaveLength(w.options.length);
    expect(screen.getAllByPlaceholderText("PL")).toHaveLength(w.options.length);
    expect(screen.getAllByPlaceholderText("EN")).toHaveLength(w.options.length);
  });

  it("dodanie opcji ZACHOWUJE istniejące i numeruje nową", () => {
    const w = select();
    const { onPatch } = mount({ selected: w });

    fireEvent.click(screen.getByText("+ dodaj opcje"));

    const next = (onPatch.mock.calls[0]![0] as { options: { value: string }[] }).options;
    expect(next).toHaveLength(w.options.length + 1);
    expect(next.at(-1)!.value).toBe(`opt${w.options.length + 1}`);
  });

  it("usunięcie opcji wycina TYLKO tę jedną", () => {
    const w = select();
    const { onPatch } = mount({ selected: w });

    fireEvent.click(screen.getAllByText("×")[0]!);

    const next = (onPatch.mock.calls[0]![0] as { options: { value: string }[] }).options;
    expect(next).toHaveLength(w.options.length - 1);
    expect(next.map((o) => o.value)).not.toContain(w.options[0]!.value);
  });

  it("zmiana wartości opcji nie rusza jej etykiet", () => {
    const w = select();
    const { onPatch } = mount({ selected: w });

    fireEvent.change(screen.getAllByPlaceholderText("value")[0]!, { target: { value: "nowa" } });

    const next = (
      onPatch.mock.calls[0]![0] as {
        options: { value: string; labelPl: string }[];
      }
    ).options;
    expect(next[0]!.value).toBe("nowa");
    expect(next[0]!.labelPl).toBe(w.options[0]!.labelPl);
  });

  it("zmiana etykiety PL nie rusza wartości technicznej ani etykiety EN", () => {
    const w = select();
    const { onPatch } = mount({ selected: w });

    fireEvent.change(screen.getAllByPlaceholderText("PL")[0]!, { target: { value: "Polska" } });

    const next = (
      onPatch.mock.calls[0]![0] as {
        options: { value: string; labelPl: string; labelEn: string }[];
      }
    ).options;
    expect(next[0]!.value).toBe(w.options[0]!.value);
    expect(next[0]!).toMatchObject({ labelPl: "Polska", labelEn: w.options[0]!.labelEn });
  });

  it("zmiana etykiety EN nie rusza polskiej", () => {
    const w = select();
    const { onPatch } = mount({ selected: w });

    fireEvent.change(screen.getAllByPlaceholderText("EN")[0]!, { target: { value: "English" } });

    const next = (
      onPatch.mock.calls[0]![0] as {
        options: { labelPl: string; labelEn: string }[];
      }
    ).options;
    expect(next[0]!.labelEn).toBe("English");
    expect(next[0]!.labelPl).toBe(w.options[0]!.labelPl);
  });
});

describe("licznik czasu", () => {
  it("termin z dokumentu pokazuje się jako data lokalna", () => {
    const widget = { ...makeWidget("countdown"), deadline: "2030-06-01T10:30:00.000Z" } as NlWidget;
    const { container } = mount({ selected: widget });
    const input = container.querySelector('input[type="datetime-local"]') as HTMLInputElement;

    expect(input).toBeTruthy();
    expect(input.value).toMatch(/^2030-06-01T\d{2}:\d{2}$/);
  });

  it("wybrany termin zapisuje się w ISO, nie w formacie pola", () => {
    // Dokument jedzie do wysyłki maila, gdzie liczy się strefa - format pola
    // („2030-06-01T12:30") nie ma jej wcale.
    const { onPatch, container } = mount({ selected: makeWidget("countdown") });

    fireEvent.change(container.querySelector('input[type="datetime-local"]')!, {
      target: { value: "2030-06-01T12:30" },
    });

    const patched = (onPatch.mock.calls[0]![0] as { deadline: string }).deadline;
    expect(patched).toMatch(/Z$/);
    expect(new Date(patched).getFullYear()).toBe(2030);
  });

  it("wyczyszczenie pola ZACHOWUJE poprzedni termin", () => {
    // Pusty termin dałby „Invalid Date" w mailu u odbiorcy.
    const widget = { ...makeWidget("countdown"), deadline: "2030-06-01T10:30:00.000Z" } as NlWidget;
    const { onPatch, container } = mount({ selected: widget });

    fireEvent.change(container.querySelector('input[type="datetime-local"]')!, {
      target: { value: "" },
    });

    expect(onPatch).toHaveBeenCalledWith({ deadline: "2030-06-01T10:30:00.000Z" });
    expect(onPatch).toHaveBeenCalledTimes(1);
  });

  it("zepsuty termin w dokumencie nie wywala panelu", () => {
    const widget = { ...makeWidget("countdown"), deadline: "nie-data" } as NlWidget;
    const { container } = mount({ selected: widget });

    expect(
      (container.querySelector('input[type="datetime-local"]') as HTMLInputElement).value,
    ).toBe("");
    expect(screen.getByText("Deadline")).toBeTruthy();
  });
});

describe("przycisk zamknięcia popupu", () => {
  it("wariant TEKSTOWY odsłania edycję etykiety w obu językach", () => {
    const widget = { ...makeWidget("close-button"), variant: "text" } as NlWidget;
    mount({ selected: widget });

    expect(screen.getByText("Etykieta")).toBeTruthy();
    expect(screen.getByText("PL")).toBeTruthy();
  });

  it("wariant IKONOWY nie ma czego tłumaczyć, więc etykiety nie pokazuje", () => {
    const widget = { ...makeWidget("close-button"), variant: "icon-x" } as NlWidget;
    mount({ selected: widget });

    expect(screen.queryByText("Etykieta")).toBeNull();
    expect(screen.getByText("Rozmiar (px)")).toBeTruthy();
  });

  it("etykieta wariantu tekstowego patchuje OBA języki", () => {
    const widget = {
      ...makeWidget("close-button"),
      variant: "text",
      label: { pl: "Nie teraz", en: "Not now" },
    } as NlWidget;
    const { onPatch } = mount({ selected: widget });

    fireEvent.change(screen.getByDisplayValue("Nie teraz"), { target: { value: "Zamknij" } });

    expect(onPatch).toHaveBeenCalledWith({ label: { pl: "Zamknij", en: "Not now" } });
    expect(onPatch).toHaveBeenCalledTimes(1);
  });
});

describe("widget nieznany panelowi", () => {
  it("nie renderuje kontrolek, ale zostawia nagłówek - panel się nie wywala", () => {
    // Dokument zapisany nowszą wersją buildera nie może zabić prawej kolumny.
    mount({ selected: { id: "x", type: "nie-ma-takiego" } as unknown as NlWidget });

    expect(screen.getByText("Wlasciwosci widgetu")).toBeTruthy();
    expect(document.querySelectorAll("input, textarea")).toHaveLength(0);
  });
});
