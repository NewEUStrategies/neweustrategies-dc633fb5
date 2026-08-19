// Sześć zakładek edytora popupu rejestracji - przemiał po WSZYSTKICH kontrolkach.
//
// PO CO PRZEMIAŁ, A NIE OSOBNE PRZYPADKI. Ten edytor to kilkadziesiąt pokrętek
// nad JEDNYM zagnieżdżonym obiektem `popup_design`. Dwie klasy błędu są tu
// niewidoczne na oczy:
//   1. KONTROLKA NIEPODŁĄCZONA - operator przesuwa suwak, widzi zmianę w polu,
//      wychodzi przekonany, że zapisał, a w dokumencie nie ma nic;
//   2. PATCH CZĘŚCIOWY - zmiana jednego pokrętła zapisuje `popup_design` bez
//      pozostałych gałęzi, więc do bazy leci NIEPEŁNY JSON i reszta ustawień
//      wraca do domyślnych. To najgorszy przypadek, bo znika praca, której
//      operator w tym momencie nie widzi na ekranie.
//
// Dlatego przemiał wymusza zmianę na każdym polu każdej zakładki i sprawdza
// KAŻDY patch: musi być niepusty i - gdy dotyczy `popup_design` - musi zawierać
// komplet gałęzi.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ guard: vi.fn() }));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    // Klucze zamiast treści - test celuje w reguły, nie w copy.
    t: (key: string, opts?: Record<string, unknown>) =>
      typeof opts?.index === "number" ? `${key}:${opts.index}` : key,
  }),
}));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => h.guard,
}));
vi.mock("@/lib/auth/bruteforce.functions", () => ({ preAuthGuard: {} }));
vi.mock("@/lib/newsletter.functions", () => ({ subscribeToNewsletter: {} }));
vi.mock("@/lib/newsletter/popupTelemetry", () => ({
  trackNewsletterPopupEvent: vi.fn(),
  newsletterPopupSessionId: () => "test-session",
}));
vi.mock("@/hooks/useAuthSettings", () => ({
  useAuthSettings: () => ({ allow_public_signup: true, logged_in_redirect_url: "/" }),
}));
vi.mock("@/lib/brand/useBrandLogoUrl", () => ({ useBrandLogoUrl: () => null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signUp: vi.fn(), signInWithOAuth: vi.fn() } },
}));
vi.mock("@/components/admin/builder/ui/organisms/widget-properties/ImageSlot", () => ({
  ImageSlot: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
  }) => <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />,
}));
vi.mock("@/components/admin/builder/ui/molecules/LucideIconPicker", () => ({
  LucideIconPicker: ({ onChange }: { onChange: (v?: string) => void }) => (
    <button type="button" aria-label="picker-ikon" onClick={() => onChange("Star")} />
  ),
}));
vi.mock("@/lib/icons/DynamicIcon", () => ({
  DynamicIcon: ({ name }: { name: string }) => <span data-testid="ikona">{name}</span>,
}));

import { SignupPopupEditor } from "@/components/admin/popups/signup/SignupPopupEditor";
import { defaultNewsletterSettings, type NewsletterSettings } from "@/hooks/useNewsletterSettings";
import { defaultPopupDesign } from "@/lib/newsletter/popupDesign";

const TAB_IDS = ["layout", "gallery", "form", "fields", "consents", "colors"] as const;

/** Gałęzie `popup_design` - patch musi nieść je WSZYSTKIE. */
const DESIGN_BRANCHES = Object.keys(defaultPopupDesign()).sort();

function settings(overrides: Partial<NewsletterSettings> = {}): NewsletterSettings {
  return {
    ...defaultNewsletterSettings(),
    popup_enabled: true,
    popup_layout: "showcase",
    ...overrides,
  };
}

const onChange = vi.fn<(patch: Partial<NewsletterSettings>) => void>();

function mount(value: NewsletterSettings = settings()) {
  return render(<SignupPopupEditor value={value} onChange={onChange} />);
}

/**
 * Przycisk zakładki. Klucz etykiety powtarza się w treści zakładki (nagłówek
 * sekcji), więc rozstrzyga `aria-pressed` - tylko przyciski paska zakładek je mają.
 */
function tabButton(id: string): HTMLButtonElement {
  const button = screen
    .getAllByText(`adminPopupSignup.tabs.${id}`)
    .map((el) => el.closest("button"))
    .find((b): b is HTMLButtonElement => !!b?.hasAttribute("aria-pressed"));
  expect(button, `brak przycisku zakładki ${id}`).toBeTruthy();
  return button!;
}

const clickTab = (id: string) => fireEvent.click(tabButton(id));

/**
 * Kontrolki WEWNĄTRZ otwartej zakładki. Pasek zakładek i przełączniki podglądu
 * też mają `aria-pressed`, więc przemiał po całym drzewie przełączałby zakładki
 * w trakcie własnego przebiegu; karty sekcji ograniczają zasięg do treści.
 */
function inTab<T extends Element>(container: HTMLElement, selector: string): T[] {
  return Array.from(container.querySelectorAll<HTMLElement>("section.rounded-md")).flatMap((card) =>
    Array.from(card.querySelectorAll<T>(selector)),
  );
}

/** Ostatni patch. */
function lastPatch(): Partial<NewsletterSettings> {
  return onChange.mock.calls.at(-1)![0];
}

/**
 * Sprawdza KAŻDY patch, jaki poszedł: niepusty, a gdy dotyczy `popup_design` -
 * z kompletem gałęzi. Niepełny JSON w bazie cofa resztę ustawień do domyślnych.
 */
function assertPatchesComplete(where: string) {
  expect(
    onChange.mock.calls.length,
    `${where}: żadna kontrolka nie zapisała zmiany`,
  ).toBeGreaterThan(0);
  for (const [patch] of onChange.mock.calls) {
    expect(Object.keys(patch as object).length, `${where}: pusty patch`).toBeGreaterThan(0);
    const design = (patch as { popup_design?: Record<string, unknown> }).popup_design;
    if (design) {
      expect(Object.keys(design).sort(), `${where}: niepełny popup_design`).toEqual(
        DESIGN_BRANCHES,
      );
    }
  }
}

beforeEach(() => {
  onChange.mockReset();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
describe("przełączanie zakładek", () => {
  it("każda zakładka DA SIĘ otworzyć i pokazuje własną treść", () => {
    const { container } = mount();

    for (const id of TAB_IDS) {
      clickTab(id);
      expect(
        tabButton(id).getAttribute("aria-pressed"),
        `zakładka ${id} nie została zaznaczona`,
      ).toBe("true");
      expect(
        container.querySelectorAll("section.rounded-md").length,
        `zakładka ${id} nie pokazała żadnej sekcji`,
      ).toBeGreaterThan(0);
    }
  });

  it("otwarta jest DOKŁADNIE jedna zakładka", () => {
    mount();

    clickTab("colors");

    const pressed = TAB_IDS.filter((id) => tabButton(id).getAttribute("aria-pressed") === "true");
    expect(pressed).toEqual(["colors"]);
  });

  it("samo przełączanie zakładek NIE zapisuje niczego", () => {
    // Zakładka to widok, nie zmiana - zapis przy przełączeniu zapalałby
    // „niezapisane zmiany" bez powodu.
    mount();

    for (const id of TAB_IDS) clickTab(id);

    expect(onChange).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("każda kontrolka jest PODŁĄCZONA i zapisuje KOMPLETNY dokument", () => {
  it.each(TAB_IDS)("zakładka %s: pola tekstowe i liczbowe", (id) => {
    const { container } = mount();
    clickTab(id);

    const fields = inTab<HTMLInputElement | HTMLTextAreaElement>(
      container,
      'input[type="text"], input:not([type]), input[type="number"], textarea',
    );
    for (const field of fields) {
      // Pola liczbowe mają WŁASNE zakresy (szerokość panelu startuje od 480 px,
      // rotacja galerii od 800 ms). Wartość poza zakresem nie leci do dokumentu
      // z projektu - trzymamy więc środek zakresu każdego pola, żeby przemiał
      // sprawdzał podłączenie kontrolki, a nie klamrowanie.
      if (field.getAttribute("type") === "number") {
        const min = Number(field.getAttribute("min") ?? 0);
        const max = Number(field.getAttribute("max") ?? 100);
        fireEvent.change(field, { target: { value: String(Math.round((min + max) / 2)) } });
      } else {
        fireEvent.change(field, { target: { value: "wartosc" } });
      }
    }

    if (fields.length > 0) {
      assertPatchesComplete(`zakładka ${id}`);
    } else {
      // Zakładka bez pól tekstowych musi mieć przynajmniej przełączniki.
      expect(inTab(container, "button, input").length).toBeGreaterThan(0);
    }
  });

  it.each(TAB_IDS)("zakładka %s: przełączniki", (id) => {
    const { container } = mount();
    clickTab(id);

    const toggles = inTab<HTMLButtonElement>(container, '[role="checkbox"]:not([disabled])');
    for (const toggle of toggles) fireEvent.click(toggle);

    if (toggles.length > 0) {
      assertPatchesComplete(`zakładka ${id}`);
    } else {
      expect(inTab(container, "button").length).toBeGreaterThan(0);
    }
  });

  it.each(TAB_IDS)("zakładka %s: wybory segmentowane", (id) => {
    const { container } = mount();
    clickTab(id);

    const pressable = inTab<HTMLButtonElement>(container, 'button[aria-pressed="false"]');
    for (const button of pressable) fireEvent.click(button);

    if (pressable.length > 0) {
      assertPatchesComplete(`zakładka ${id}`);
    } else {
      expect(inTab(container, "button").length).toBeGreaterThan(0);
    }
  });

  it.each(TAB_IDS)("zakładka %s: pola koloru", (id) => {
    const { container } = mount();
    clickTab(id);

    const swatches = inTab<HTMLInputElement>(container, 'input[type="color"]');
    swatches.forEach((swatch, i) =>
      fireEvent.change(swatch, { target: { value: `#11223${i % 10}` } }),
    );

    if (swatches.length > 0) {
      assertPatchesComplete(`zakładka ${id}`);
    } else {
      expect(inTab(container, "button, input").length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
describe("podgląd na żywo", () => {
  it("startuje na palecie rozstrzygniętej z ustawień", () => {
    mount();

    expect(screen.getByText("adminPopupSignup.preview.dark").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("przełącznik języka nie rusza ustawień", () => {
    mount();

    fireEvent.click(screen.getByText("EN"));

    expect(screen.getByText("EN").getAttribute("aria-pressed")).toBe("true");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("przełącznik palety nie rusza ustawień", () => {
    // Podgląd to narzędzie oglądania, nie edycji - zapis przy podejrzeniu
    // jasnej palety zmieniałby to, co widzi odwiedzający.
    mount();

    fireEvent.click(screen.getByText("adminPopupSignup.preview.light"));

    expect(screen.getByText("adminPopupSignup.preview.light").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("wymuszona paleta wygrywa nad schematem z ustawień", () => {
    mount(
      settings({
        popup_design: { ...defaultPopupDesign(), colorScheme: "light" },
      }),
    );
    expect(screen.getByText("adminPopupSignup.preview.light").getAttribute("aria-pressed")).toBe(
      "true",
    );

    fireEvent.click(screen.getByText("adminPopupSignup.preview.dark"));

    expect(screen.getByText("adminPopupSignup.preview.dark").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });
});

// ---------------------------------------------------------------------------
describe("rozdział warstw zapisu", () => {
  it("paleta CIEMNA idzie do kolumn tabeli, nie do JSON-a prezentacji", () => {
    // Kolumny są starsze niż `popup_design` i nadal zasilają maile - zapis
    // ciemnej palety wyłącznie w JSON-ie rozjechałby popup z resztą systemu.
    mount();
    clickTab("colors");

    const swatches = screen.getAllByLabelText("adminPopupSignup.colors.accent");
    fireEvent.change(swatches[0]!, { target: { value: "#123456" } });

    expect(lastPatch()).toEqual({ popup_accent_color: "#123456" });
  });

  it("paleta JASNA idzie do JSON-a prezentacji, nie do kolumn", () => {
    mount();
    clickTab("colors");

    const swatches = screen.getAllByLabelText("adminPopupSignup.colors.bg");
    fireEvent.change(swatches[1]!, { target: { value: "#f5f5f5" } });

    expect(lastPatch().popup_design?.light.bg).toBe("#f5f5f5");
    expect(lastPatch().popup_bg_color).toBeUndefined();
  });

  it("pola formularza jadą OSOBNĄ kolumną, z kompletem definicji", () => {
    // Częściowa lista pól znaczy formularz bez pola, które operator widział
    // jako włączone.
    mount();
    clickTab("fields");

    const inputs = screen.getAllByLabelText(/adminPopupSignup\.fields\.labelPl/);
    fireEvent.change(inputs[0]!, { target: { value: "Twoje imię" } });

    const fields = lastPatch().popup_fields;
    expect(fields?.length).toBe(defaultNewsletterSettings().popup_fields.length);
    expect(fields?.find((f) => f.key === "email")).toMatchObject({
      enabled: true,
      required: true,
    });
  });
});

// ---------------------------------------------------------------------------
describe("sekcje warunkowe", () => {
  it("próg przewinięcia jest widoczny TYLKO dla wyzwalacza scroll", () => {
    // Pole bez skutku uczy operatora ustawiać coś na darmo.
    mount(settings({ popup_trigger: "delay" }));
    clickTab("layout");
    expect(screen.queryByText("adminPopupSignup.trigger.scrollPercent")).toBeNull();
    cleanup();

    mount(settings({ popup_trigger: "scroll" }));
    clickTab("layout");
    expect(screen.getByText("adminPopupSignup.trigger.scrollPercent")).toBeTruthy();
  });

  it("próg przewinięcia patchuje ustawienia", () => {
    const { container } = mount(settings({ popup_trigger: "scroll", popup_scroll_percent: 50 }));
    clickTab("layout");

    const field = inTab<HTMLInputElement>(container, 'input[type="number"]').find(
      (i) => i.getAttribute("max") === "100" && i.getAttribute("min") === "1",
    )!;
    fireEvent.change(field, { target: { value: "75" } });

    expect(lastPatch()).toEqual({ popup_scroll_percent: 75 });
  });

  it("szerokość panelu ma WŁASNY zakres i patchuje prezentację", () => {
    // 480-1600 px: wartość „3" (jak w naiwnym przemiale) nigdy by tu nie doszła.
    const { container } = mount();
    clickTab("layout");

    const field = inTab<HTMLInputElement>(container, 'input[type="number"]').find(
      (i) => i.getAttribute("min") === "480",
    )!;
    fireEvent.change(field, { target: { value: "1000" } });

    expect(lastPatch().popup_design?.panel.maxWidthPx).toBe(1000);
    expect(Object.keys(lastPatch().popup_design!).sort()).toEqual(DESIGN_BRANCHES);
  });

  it("galeria BEZ układu showcase mówi, że dotyczy tylko showcase", () => {
    // Inaczej operator innego układu ustawia bloki, których nikt nie zobaczy.
    mount(settings({ popup_layout: "stacked" }));
    clickTab("gallery");

    expect(screen.getByText("adminPopupSignup.gallery.onlyShowcase")).toBeTruthy();
    expect(screen.queryByText("adminPopupSignup.gallery.rotate")).toBeNull();
  });

  it("poza showcase galeria oferuje grafikę boczną i okładkę", () => {
    mount(settings({ popup_layout: "stacked" }));
    clickTab("gallery");

    fireEvent.change(screen.getByLabelText("adminPopupSignup.gallery.sideImage"), {
      target: { value: "https://example.test/bok.png" },
    });

    expect(lastPatch()).toEqual({ popup_side_image_url: "https://example.test/bok.png" });
  });

  it("wyczyszczona grafika boczna zapisuje NULL, nie pusty napis", () => {
    mount(
      settings({ popup_layout: "stacked", popup_side_image_url: "https://example.test/a.png" }),
    );
    clickTab("gallery");

    fireEvent.change(screen.getByLabelText("adminPopupSignup.gallery.sideImage"), {
      target: { value: "" },
    });

    expect(lastPatch()).toEqual({ popup_side_image_url: null });
  });

  it("okładka poza showcase też patchuje się na NULL po wyczyszczeniu", () => {
    mount(settings({ popup_layout: "stacked", popup_cover_url: "https://example.test/c.png" }));
    clickTab("gallery");

    fireEvent.change(screen.getByLabelText("adminPopupSignup.gallery.coverImage"), {
      target: { value: "" },
    });

    expect(lastPatch()).toEqual({ popup_cover_url: null });
  });

  it("OSTRZEŻENIE O KONTRAŚCIE zapala się dla obu palet", () => {
    // To jedyna bariera przed wypuszczeniem popupu z nieczytelnym tekstem.
    mount(
      settings({
        popup_bg_color: "#777777",
        popup_text_color: "#888888",
        popup_muted_color: "#7a7a7a",
        popup_design: {
          ...defaultPopupDesign(),
          light: { ...defaultPopupDesign().light, bg: "#777777", fg: "#888888", muted: "#7a7a7a" },
        },
      }),
    );
    clickTab("colors");

    expect(screen.getAllByText(/adminPopupSignup\.colors\.contrastWarn/).length).toBeGreaterThan(1);
  });

  it("czytelne kolory NIE zapalają ostrzeżenia", () => {
    mount(
      settings({
        popup_bg_color: "#000000",
        popup_text_color: "#ffffff",
        popup_muted_color: "#eeeeee",
        popup_design: {
          ...defaultPopupDesign(),
          light: { ...defaultPopupDesign().light, bg: "#ffffff", fg: "#000000", muted: "#111111" },
        },
      }),
    );
    clickTab("colors");

    expect(screen.queryByText(/adminPopupSignup\.colors\.contrastWarn/)).toBeNull();
  });

  it("RESET nadpisań kontrolek czyści je dla WSKAZANEJ palety", () => {
    mount();
    clickTab("colors");

    const resets = screen.getAllByText("adminPopupSignup.colors.reset");
    expect(resets.length).toBe(2);
    fireEvent.click(resets[0]!);

    expect(Object.keys(lastPatch().popup_design!).sort()).toEqual(DESIGN_BRANCHES);
    expect(lastPatch().popup_design?.controls.dark).toEqual(defaultPopupDesign().controls.dark);
  });
});
