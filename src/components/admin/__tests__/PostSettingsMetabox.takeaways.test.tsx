// METABOX USTAWIEŃ WPISU - SEKCJA „Z TEGO ARTYKUŁU DOWIESZ SIĘ…"
// (`TakeawaysTab`, `TakeawayRow`, `TakeawaysPreviewCard`, `PanelHead`).
//
// CO TEN PLIK PRZYPINA (a czego montaż bez interakcji nie dowodzi):
//   1. PUNKTY SĄ DWUJĘZYCZNE I ROZŁĄCZNE. Edycja idzie do JĘZYKA AKTYWNEJ
//      zakładki i nie ma prawa dotknąć drugiej listy - a licznik „n/7" pokazuje
//      punkty NIEPUSTE, nie długość tablicy.
//   2. LIMITY POCHODZĄ Z JEDNEGO ŹRÓDŁA (`lib/keyTakeaways/limits`): 7 punktów
//      i 500 znaków. Do 2026-08-03 panel blokował na 6, baza dopuszczała 7,
//      a podpowiedź w tym samym panelu obiecywała „max 7" - dlatego asercje
//      czytają liczby z PARAMETRÓW klucza i18n, czyli z tego, co panel
//      naprawdę policzył.
//   3. LICZNIK ZNAKÓW MA CZTERY STANY (pusty / za krótki / w normie / za długi)
//      i to on jest jedyną informacją redakcyjną w tym wierszu.
//   4. PODGLĄD JEST STEROWNIKIEM: kliknięcie karty PL/EN PRZEŁĄCZA edytowany
//      język, a nie tylko podświetla kartę.
//   5. WARIANT WIZUALNY DZIEDZICZY Z GLOBALNYCH, dopóki wpis go nie nadpisze -
//      i wtedy podgląd musi pokazać nadpisany, nie globalny.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE:
//   - `KeyTakeaways` (molekuła z własną suitą) jest ATRAPĄ; tutaj liczy się
//     KONTRAKT podglądu: jakie punkty, jaki wariant i jaki język dostaje.
//   - `AccessSettingsPane` jest atrapą - jego zakładkę mierzy plik `...toc`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import {
  controlledHost,
  mountSettingsPane,
  type PropRecorder,
  type SettingsPaneSupabase,
} from "@/test/admin/settingsPaneHarness";

/** Propy, których podgląd żąda od molekuły `KeyTakeaways`. */
interface KeyTakeawaysProps {
  items: readonly string[];
  settingsOverride?: { variant: string };
  variantOverride?: "card" | "heading" | "ghost";
  langOverride?: "pl" | "en";
  className?: string;
}

const stubs = vi.hoisted(() => ({
  supabase: null as unknown,
  takeaways: null as unknown,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { settingsPaneSupabase: make } = await import("@/test/admin/settingsPaneHarness");
  const sb = make();
  stubs.supabase = sb;
  return { supabase: sb.client };
});

vi.mock("@/lib/ssrCache", () => ({
  edgeTtlCache: async <T,>(_key: string, _ttl: number, fn: () => Promise<T>) => fn(),
  invalidateEdgeTtlCache: async () => {},
  clearEdgeTtlCache: () => {},
}));

vi.mock("sonner", async () => {
  const { paneToastSpies: make } = await import("@/test/admin/settingsPaneHarness");
  return make().sonner();
});

vi.mock("@/components/admin/AccessSettingsPane", () => ({
  AccessSettingsPane: () => null,
}));

vi.mock("@/components/molecules/KeyTakeaways", async () => {
  const react = await import("react");
  const { propRecorder: rec } = await import("@/test/admin/settingsPaneHarness");
  const recorder = rec<KeyTakeawaysProps>();
  stubs.takeaways = recorder;
  return {
    KeyTakeaways: (props: KeyTakeawaysProps) => {
      recorder.calls.push(props);
      return react.createElement(
        "div",
        { "data-testid": `kt-${props.langOverride ?? "?"}` },
        props.items.join(" | "),
      );
    },
  };
});

vi.mock("@/components/ui/select", async () => {
  const react = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(react);
});

vi.mock("@/components/ui/switch", async () => {
  const react = await import("react");
  const { radixSwitchStub } = await import("@/test/reactStubs");
  return radixSwitchStub(react);
});

vi.mock("@/components/ui/tabs", async () => {
  const react = await import("react");
  const { radixTabsStub } = await import("@/test/reactStubs");
  return radixTabsStub(react);
});

import { PostSettingsMetabox } from "@/components/admin/PostSettingsMetabox";

const sb = () => stubs.supabase as SettingsPaneSupabase;
const preview = () => stubs.takeaways as PropRecorder<KeyTakeawaysProps>;

type Variant = "card" | "heading" | "ghost" | null;

interface TakeawaysState {
  pl: string[];
  en: string[];
  variant: Variant;
}

interface MountOptions {
  pl?: string[];
  en?: string[];
  variant?: Variant;
  /** Mapa `site_settings` - globalny wariant sekcji. */
  settings?: Record<string, unknown>;
  /** `false` = rodzic nie daje handlera wariantu (blok wariantów nie istnieje). */
  withVariantChange?: boolean;
  hideTab?: boolean;
}

/** Montaż + wejście na zakładkę punktów (metabox startuje na ToC). */
function mountTakeaways(options: MountOptions = {}) {
  const host = controlledHost<TakeawaysState>(
    { pl: options.pl ?? [], en: options.en ?? [], variant: options.variant ?? null },
    (value, onChange) => (
      <PostSettingsMetabox
        entityType="post"
        entityId="post-42"
        tocOverride={null}
        onTocOverrideChange={() => {}}
        takeawaysPl={value.pl}
        takeawaysEn={value.en}
        onTakeawaysChange={(lang, next) =>
          onChange(lang === "pl" ? { ...value, pl: next } : { ...value, en: next })
        }
        takeawaysVariant={value.variant}
        onTakeawaysVariantChange={
          options.withVariantChange === false
            ? undefined
            : (next) => onChange({ ...value, variant: next })
        }
        hideTakeawaysTab={options.hideTab ?? false}
      />
    ),
  );
  const view = mountSettingsPane(host.node, {
    seed: [{ queryKey: ["site_settings_public", "all"], data: options.settings ?? {} }],
  });
  const tab = [...screen.getByRole("navigation").querySelectorAll("button")].find(
    (node) => node.textContent === "admin.metabox.tabs.takeaways",
  );
  if (tab) fireEvent.click(tab);
  return { host, view, hasTab: !!tab };
}

const langTab = (label: "pl" | "en"): HTMLElement => {
  const found = screen
    .getAllByRole("tab")
    .find((node) => node.textContent?.includes(label.toUpperCase()));
  if (!found) throw new Error(`test: brak zakładki językowej ${label}`);
  return found;
};

const rows = (container: HTMLElement): HTMLTextAreaElement[] => [
  ...container.querySelectorAll<HTMLTextAreaElement>("textarea"),
];

const addButton = () => screen.getByRole("button", { name: /post.takeaways.add/ });

const removeButtons = () =>
  screen.getAllByRole("button", { name: "admin.metabox.takeaways.row.remove" });

const variantButton = (label: string): HTMLElement => {
  const found = screen
    .getAllByRole("button")
    .find((node) => node.querySelector(".text-\\[11px\\]")?.textContent === label);
  if (!found) throw new Error(`test: brak przycisku wariantu "${label}"`);
  return found;
};

const previewCard = (lang: "pl" | "en"): HTMLElement =>
  screen.getByRole("button", { name: `Edytuj wersję ${lang.toUpperCase()}` });

beforeEach(() => {
  sb().reset();
  preview().reset();
});

afterEach(() => {
  cleanup();
});

describe("PostSettingsMetabox - zakładka punktów", () => {
  it("pusta lista zaprasza do dodania punktu i podaje limity z jednego źródła", () => {
    const { view } = mountTakeaways();

    expect(screen.getByText("admin.metabox.takeaways.title")).toBeInTheDocument();
    // Limity w podpowiedzi to PARAMETRY klucza - liczby policzył panel.
    expect(
      screen.getByText("admin.metabox.takeaways.hint(max=7,min=90,rec=200)"),
    ).toBeInTheDocument();
    expect(screen.getByText("post.takeaways.empty")).toBeInTheDocument();
    expect(rows(view.container)).toHaveLength(0);
    expect(addButton()).toBeEnabled();
    expect(screen.getByRole("link", { name: /Ustawienia globalne/ })).toHaveAttribute(
      "href",
      "/admin/key-takeaways",
    );
    // Bez treści w żadnym języku podgląd nie rysuje kart.
    expect(screen.getByText("admin.metabox.takeaways.preview.empty")).toBeInTheDocument();
    expect(preview().calls).toHaveLength(0);
  });

  it("ukrycie zakładki zdejmuje ją mimo handlera rodzica", () => {
    const { hasTab } = mountTakeaways({ hideTab: true, pl: ["Punkt pierwszy"] });

    expect(hasTab).toBe(false);
    expect(screen.queryByText("admin.metabox.takeaways.title")).toBeNull();
  });

  it("licznik zakładek językowych liczy punkty NIEPUSTE, nie długość tablicy", () => {
    mountTakeaways({ pl: ["Pierwszy wniosek z materiału", "   ", ""], en: ["First takeaway"] });

    expect(langTab("pl").textContent).toContain("PL (1/7)");
    expect(langTab("en").textContent).toContain("EN (1/7)");
  });

  it("dodawanie punktów zatrzymuje się na siódmym", () => {
    const { host, view } = mountTakeaways({ pl: ["a", "b", "c", "d", "e", "f"] });

    fireEvent.click(addButton());

    expect(host.current().pl).toHaveLength(7);
    expect(rows(view.container)).toHaveLength(7);
    expect(addButton()).toBeDisabled();
    // Ósmy punkt nie ma prawa dojść nawet po kliknięciu zablokowanego przycisku.
    fireEvent.click(addButton());
    expect(host.current().pl).toHaveLength(7);
  });

  it("edycja punktu trafia do JĘZYKA AKTYWNEJ zakładki", () => {
    const { host, view } = mountTakeaways({ pl: [""], en: [""] });

    fireEvent.change(rows(view.container)[0], { target: { value: "Wniosek po polsku" } });
    expect(host.current()).toMatchObject({ pl: ["Wniosek po polsku"], en: [""] });

    fireEvent.click(langTab("en"));
    fireEvent.change(rows(view.container)[0], { target: { value: "Takeaway in English" } });

    expect(host.current()).toMatchObject({
      pl: ["Wniosek po polsku"],
      en: ["Takeaway in English"],
    });
  });

  it("wpis dłuższy niż limit jest OBCINANY do 500 znaków, nie odrzucany", () => {
    const { host, view } = mountTakeaways({ pl: [""] });

    fireEvent.change(rows(view.container)[0], { target: { value: "x".repeat(620) } });

    expect(host.current().pl[0]).toHaveLength(500);
    expect(rows(view.container)[0].getAttribute("maxlength")).toBe("500");
  });

  it("usunięcie punktu zostawia pozostałe w kolejności", () => {
    const { host, view } = mountTakeaways({ pl: ["Pierwszy", "Drugi", "Trzeci"] });

    fireEvent.click(removeButtons()[1]);

    expect(host.current().pl).toEqual(["Pierwszy", "Trzeci"]);
    expect(rows(view.container).map((row) => row.value)).toEqual(["Pierwszy", "Trzeci"]);
  });

  it("licznik znaków rozróżnia pusty, za krótki, w normie i za długi", () => {
    const { view } = mountTakeaways({
      pl: ["", "Za krótki punkt", "P".repeat(120), "P".repeat(260)],
    });
    const statuses = [...view.container.querySelectorAll("li")].map((row) => {
      const [message, counter] = [...row.querySelectorAll("span")].slice(-2);
      return { message: message.textContent, counter: counter.textContent };
    });

    expect(statuses[0].message).toBe("");
    expect(statuses[0].counter).toBe(
      "admin.metabox.takeaways.row.counter(len=0,max=500,min=90,rec=200)",
    );
    expect(statuses[1].message).toBe("admin.metabox.takeaways.row.tooShort(min=90)");
    expect(statuses[2].message).toBe("admin.metabox.takeaways.row.ok");
    expect(statuses[3].message).toBe("admin.metabox.takeaways.row.tooLong");
    expect(statuses[3].counter).toBe(
      "admin.metabox.takeaways.row.counter(len=260,max=500,min=90,rec=200)",
    );
    // Kolor jest częścią komunikatu redakcyjnego - inaczej „za długi" niczym
    // się nie różni od „w normie".
    const rowClasses = [...view.container.querySelectorAll("li")].map(
      (row) => row.querySelector("div.mt-1")?.className ?? "",
    );
    expect(rowClasses[1]).toContain("text-yellow-600");
    expect(rowClasses[2]).toContain("text-green-600");
    expect(rowClasses[3]).toContain("text-orange-600");
  });
});

describe("PostSettingsMetabox - podgląd punktów", () => {
  it("podgląd rysuje obie wersje i oddaje molekule punkty NIEPUSTE", () => {
    mountTakeaways({
      pl: ["Wniosek polski", "  ", "Drugi wniosek"],
      en: ["English takeaway"],
    });

    expect(previewCard("pl")).toHaveAttribute("aria-pressed", "true");
    expect(previewCard("en")).toHaveAttribute("aria-pressed", "false");
    expect(previewCard("pl").textContent).toContain("edytowana");
    expect(previewCard("en").textContent).not.toContain("edytowana");
    expect(screen.getByTestId("kt-pl").textContent).toBe("Wniosek polski | Drugi wniosek");
    expect(screen.getByTestId("kt-en").textContent).toBe("English takeaway");

    const plProps = preview().calls.find((props) => props.langOverride === "pl");
    expect(plProps?.items).toEqual(["Wniosek polski", "Drugi wniosek"]);
    expect(plProps?.variantOverride).toBe("card");
    expect(plProps?.settingsOverride?.variant).toBe("card");
    expect(plProps?.className).toBe("my-0");
  });

  it("kliknięcie karty podglądu PRZEŁĄCZA edytowany język", () => {
    const { host, view } = mountTakeaways({ pl: ["Wniosek polski"], en: ["English takeaway"] });

    fireEvent.click(previewCard("en"));

    expect(previewCard("en")).toHaveAttribute("aria-pressed", "true");
    expect(rows(view.container).map((row) => row.value)).toEqual(["English takeaway"]);
    fireEvent.change(rows(view.container)[0], { target: { value: "Zmieniony po angielsku" } });
    expect(host.current()).toMatchObject({
      pl: ["Wniosek polski"],
      en: ["Zmieniony po angielsku"],
    });

    // Powrót kartą polską - obie karty są sterownikiem, nie tylko angielska.
    fireEvent.click(previewCard("pl"));
    expect(previewCard("pl")).toHaveAttribute("aria-pressed", "true");
    expect(rows(view.container).map((row) => row.value)).toEqual(["Wniosek polski"]);
  });

  it("język bez punktów pokazuje własny komunikat, a nie pustą kartę", () => {
    mountTakeaways({ pl: ["Tylko polski wniosek"], en: [] });

    expect(previewCard("en").textContent).toContain("No bullets in the English version.");
    expect(screen.queryByTestId("kt-en")).toBeNull();
    expect(screen.getByTestId("kt-pl")).toBeInTheDocument();
    // Liczba punktów w nagłówku karty to plakietka obok języka.
    expect(previewCard("pl").textContent).toContain("Wersja PL");
  });
});

describe("PostSettingsMetabox - wariant sekcji", () => {
  it("bez nadpisania podgląd dziedziczy wariant globalny z `site_settings`", () => {
    mountTakeaways({
      pl: ["Wniosek polski"],
      settings: { key_takeaways: { variant: "ghost" } },
    });

    expect(screen.getByText("admin.metabox.takeaways.variant.legend")).toBeInTheDocument();
    expect(screen.getByText("admin.metabox.takeaways.preview.activeVariant")).toBeInTheDocument();
    const props = preview().calls.find((entry) => entry.langOverride === "pl");
    expect(props?.variantOverride).toBe("ghost");
    expect(screen.queryByText("override")).toBeNull();
  });

  it("wybór wariantu nadpisuje globalny i oznacza to plakietką", () => {
    const { host } = mountTakeaways({
      pl: ["Wniosek polski"],
      settings: { key_takeaways: { variant: "ghost" } },
    });
    preview().reset();

    fireEvent.click(variantButton("B"));

    expect(host.current().variant).toBe("heading");
    expect(screen.getByText("override")).toBeInTheDocument();
    const props = preview().calls.find((entry) => entry.langOverride === "pl");
    expect(props?.variantOverride).toBe("heading");
    // Globalny wariant nadal widać obok legendy - to alternatywa dla nadpisania.
    expect(screen.getByText("ghost")).toBeInTheDocument();
  });

  it("powrót na `Dziedzicz` zdejmuje nadpisanie wpisu", () => {
    const { host } = mountTakeaways({
      pl: ["Wniosek polski"],
      variant: "card",
      settings: { key_takeaways: { variant: "ghost" } },
    });

    expect(screen.getByText("override")).toBeInTheDocument();
    fireEvent.click(variantButton("admin.metabox.takeaways.variant.inheritLabel"));

    expect(host.current().variant).toBeNull();
    expect(screen.queryByText("override")).toBeNull();
  });

  it("bez handlera wariantu blok wyboru w ogóle nie istnieje", () => {
    mountTakeaways({ pl: ["Wniosek polski"], withVariantChange: false });

    expect(screen.queryByText("admin.metabox.takeaways.variant.legend")).toBeNull();
    // Sama sekcja punktów zostaje - wariant jest opcjonalny.
    expect(screen.getByText("admin.metabox.takeaways.title")).toBeInTheDocument();
  });
});
