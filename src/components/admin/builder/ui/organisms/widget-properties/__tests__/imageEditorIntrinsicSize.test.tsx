// ImageEditor: naturalny rozmiar pliku (`srcIntrinsic` / `srcDarkIntrinsic`).
//
// SKĄD TEN PLIK. Renderer dokłada obrazowi bez ramki atrybuty `width`/`height`
// z rozmiaru zapisanego w treści widgetu (Lighthouse `unsized-images`). Tej
// wartości nikt nie wpisuje - mierzy ją edytor w przeglądarce redaktora. Od
// tego, KIEDY mierzy i zapisuje, zależy historia cofania buildera i autozapis,
// więc reguły są przypięte tutaj:
//  1. ZAZNACZENIE widgetu (montaż edytora / zmiana `widgetId`) mierzy pliki raz
//     i zapisuje TYLKO różnicę - tak istniejąca treść dostaje rozmiar bez
//     ręcznej roboty. Instancja widgetu globalnego nie zapisuje nic.
//  2. ZMIANA pliku zeruje stary rozmiar w tym samym ruchu co adres (jeden krok
//     cofania) i mierzy nowy plik.
//  3. Zmiana TREŚCI przy tym samym widgecie (cofnij/ponów) nie mierzy i nie
//     zapisuje: każdy zapis czyści stos "ponów".
//  4. Wynik spóźniony (slot wskazuje już inny plik, edytor odmontowany) przepada.
//  5. ZAZNACZENIE NIE PISZE DO DOKUMENTU, GDY RENDERER WARTOŚCI NIE UŻYJE: obraz
//     w ramce ("Proporcje" inne niż auto) i widget, którego własny plik zastępuje
//     logo motywu, nie są ani mierzone, ani zapisywane - samo kliknięcie
//     dokładało tam krok "cofnij" bez widocznego skutku i uruchamiało autozapis.
//     Warunek to `intrinsicSlotUse` (lustro renderera, przypięte testem
//     parytetu). Ustawienia motywu przychodzą z tego samego cache'u co podgląd
//     na kanwie.
//  6. Przełączenie "Proporcji" na auto albo wyłączenie "Użyj logo witryny"
//     mierzy plik od razu - efekt z pkt 1 nie uruchomi się drugi raz dla tego
//     samego widgetu.
//  7. PLIK BEZ WŁASNEJ PROPORCJI (werdykt `noRatio` pomiaru) ZERUJE rozmiar
//     zapisany dla slotu - w odróżnieniu od pomiaru nieudanego, który zapisaną
//     wartość zostawia. Zerowanie idzie wyłącznie ścieżkami z pkt 1, 2 i 6 i
//     pod warunkiem z pkt 5: zaznaczenie nie pisze do slotu, którego renderer
//     nie użyje.
//
// `measureIntrinsicSize` jest atrapą (środowisko testowe nie ładuje obrazów);
// `ImageSlot` jest PRAWDZIWY - atrapa tylko podsłuchuje jego propsy, żeby test
// mógł wywołać `onChange` dokładnie tak, jak robi to pole adresu, upload i
// biblioteka mediów. Selecty schematu ("Proporcje", "Użyj logo witryny") też są
// prawdziwe i klikane jak przez redaktora.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactElement } from "react";
import type { Json, WidgetContent } from "@/lib/builder/types";

interface SlotProbeProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}

const probe = vi.hoisted(() => ({
  /** Wynik pomiaru per adres; brak wpisu = pomiar nieudany (`""`). */
  sizes: {} as Record<string, string>,
  /** Adresy plików, które się ładują, ale nie mają własnej proporcji. */
  noRatio: [] as string[],
  /** Adresy, o których pomiar poproszono, w kolejności. */
  calls: [] as string[],
  /** Tryb ręczny: pomiar czeka, aż test rozstrzygnie go przez `settle`. */
  manual: false,
  pending: [] as Array<{ url: string; resolve: (size: string) => void }>,
  /** Ostatnie propsy każdego slotu, po etykiecie. */
  slots: {} as Record<string, SlotProbeProps>,
}));

vi.mock("@/lib/media/measureIntrinsicSize", () => ({
  measureIntrinsicSize: (url: string) => {
    probe.calls.push(url);
    // Tryb ręczny: `settle(url, NO_RATIO)` rozstrzyga pomiar werdyktem "plik bez
    // własnej proporcji", każdy inny napis to rozmiar (albo `""` = porażka).
    const result = (size: string) =>
      size === "no-ratio" ? { size: "", noRatio: true } : { size, noRatio: false };
    if (!probe.manual) {
      return Promise.resolve(
        result(probe.noRatio.includes(url) ? "no-ratio" : (probe.sizes[url] ?? "")),
      );
    }
    return new Promise<ReturnType<typeof result>>((resolve) => {
      probe.pending.push({ url, resolve: (size) => resolve(result(size)) });
    });
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
    i18n: { language: "pl", changeLanguage: () => Promise.resolve() },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

// ImageSlot wymaga kontekstu tenanta z `useAuth`.
vi.mock("@/hooks/useAuth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useAuth")>()),
  useRequiredTenant: () => "tenant-test",
}));

vi.mock("../ImageSlot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ImageSlot")>();
  const RealSlot = actual.ImageSlot;
  return {
    ImageSlot: (props: Parameters<typeof RealSlot>[0]) => {
      probe.slots[props.label] = props;
      return <RealSlot {...props} />;
    },
  };
});

import { ImageEditor, IMAGE_EDITOR_HANDLED_KEYS } from "../ImageEditor";
import { WIDGET_SCHEMAS } from "@/lib/builder/schemas";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";

const LIGHT_SLOT = "builder.imageEditor.slotLight";
const DARK_SLOT = "builder.imageEditor.slotDark";
const DARK_HINT = "builder.imageEditor.slotDarkHint";
const NOT_STORED = "builder.imageEditor.sizeNotStored";
/** Werdykt atrapy pomiaru w trybie ręcznym: plik bez własnej proporcji. */
const NO_RATIO = "no-ratio";

const PHOTO = "https://cdn.example.test/panel.jpg";
const PHOTO_DARK = "https://cdn.example.test/panel-dark.jpg";
const NEW_PHOTO = "https://cdn.example.test/nowy.jpg";
const NEWER_PHOTO = "https://cdn.example.test/jeszcze-nowszy.jpg";
const SITE_LOGO = "https://cdn.example.test/logo-witryny.svg";
/** SVG bez `viewBox` i bez `width`/`height`: ładuje się, ale nie ma proporcji. */
const SHAPELESS = "https://cdn.example.test/bez-proporcji.svg";

type Recorded = Array<[string, Json]>;
interface EditorProps {
  widgetId?: string;
  isGlobal?: boolean;
}

/**
 * Edytor z rodzicem, który NIE stosuje zapisów - widać dokładnie, co edytor wysłał.
 * `siteLogo` to `theme_options.logo` zasiane we wspólnym cache'u ustawień, tak jak
 * ma je podgląd na kanwie; bez niego cache jest pusty (witryna bez logo).
 */
function renderEditor(
  content: WidgetContent,
  props: EditorProps = { widgetId: "w1" },
  siteLogo?: Record<string, unknown>,
) {
  const calls: Recorded = [];
  const setContent = (key: string, value: Json) => {
    calls.push([key, value]);
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (siteLogo) {
    client.setQueryData(siteSettingsQueryOptions.queryKey, { theme_options: { logo: siteLogo } });
  }
  const ui = (c: WidgetContent, extra: EditorProps): ReactElement => (
    <QueryClientProvider client={client}>
      <ImageEditor c={c} lang="pl" setContent={setContent} {...extra} />
    </QueryClientProvider>
  );
  const view = render(ui(content, props));
  return {
    calls,
    rerender: (c: WidgetContent, extra: EditorProps = props) => view.rerender(ui(c, extra)),
    unmount: view.unmount,
  };
}

/** Edytor z rodzicem jak w builderze: każdy zapis trafia do treści i wraca propsem. */
function renderLiveEditor(initial: WidgetContent) {
  const calls: Recorded = [];
  const state: { content: WidgetContent } = { content: initial };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Host() {
    const [content, setContentState] = useState<WidgetContent>(initial);
    state.content = content;
    return (
      <ImageEditor
        c={content}
        lang="pl"
        widgetId="w1"
        setContent={(key, value) => {
          calls.push([key, value]);
          setContentState((prev) => ({ ...prev, [key]: value }));
        }}
      />
    );
  }
  render(
    <QueryClientProvider client={client}>
      <Host />
    </QueryClientProvider>,
  );
  return { calls, state };
}

/**
 * Rodzic jak builder z ZAZNACZENIEM: treść każdego widgetu żyje w dokumencie,
 * panel pokazuje edytor zaznaczonego obrazu (ta sama instancja edytora przy
 * przejściu między obrazami, odmontowanie przy odznaczeniu), a `setContent`
 * jest związany z widgetem zaznaczonym w chwili renderu - jak
 * `updateWidget(selectedWidget.id, ...)` w `Builder.tsx`.
 */
function renderSelection(
  initial: Record<string, WidgetContent>,
  selected: string | null,
  globals: ReadonlySet<string> = new Set(),
) {
  const doc: Record<string, WidgetContent> = { ...initial };
  const control: { select: (id: string | null) => void } = { select: () => {} };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Host() {
    const [current, setCurrent] = useState<string | null>(selected);
    const [, setRevision] = useState(0);
    control.select = setCurrent;
    if (!current) return null;
    return (
      <ImageEditor
        c={doc[current]}
        lang="pl"
        widgetId={current}
        isGlobal={globals.has(current)}
        setContent={(key, value) => {
          doc[current] = { ...doc[current], [key]: value };
          setRevision((revision) => revision + 1);
        }}
      />
    );
  }
  render(
    <QueryClientProvider client={client}>
      <Host />
    </QueryClientProvider>,
  );
  return {
    doc,
    select: (id: string | null) =>
      act(async () => {
        control.select(id);
      }),
  };
}

/** Domyka mikrozadania (rozstrzygnięte pomiary) i wynikające z nich rendery. */
const flush = () => act(async () => {});

/** Zmiana pliku slotu tak, jak robi to pole adresu / upload / biblioteka. */
const changeSlot = (label: string, value: string) =>
  act(async () => {
    probe.slots[label].onChange(value);
  });

/** PropField nie wiąże etykiety z kontrolką przez htmlFor - szukamy po wrapperze. */
function selectFor(label: string): HTMLElement {
  const control = screen
    .getByText(label)
    .closest("div")
    ?.querySelector<HTMLElement>("[role='combobox']");
  if (!control) throw new Error(`Brak selecta dla pola "${label}"`);
  return control;
}

/** Otwiera selecta Radiksa i klika opcję - jak redaktor w panelu. */
const pickOption = async (label: string, optionLabel: string) => {
  fireEvent.keyDown(selectFor(label), { key: "ArrowDown" });
  fireEvent.click(within(screen.getByRole("listbox")).getByText(optionLabel));
  await flush();
};

/** Rozstrzyga wstrzymany pomiar adresu (tryb ręczny). */
const settle = (url: string, size: string) =>
  act(async () => {
    const index = probe.pending.findIndex((entry) => entry.url === url);
    if (index < 0) throw new Error(`Brak wstrzymanego pomiaru dla ${url}`);
    const [entry] = probe.pending.splice(index, 1);
    entry.resolve(size);
  });

beforeEach(() => {
  probe.sizes = {};
  probe.noRatio = [];
  probe.calls = [];
  probe.manual = false;
  probe.pending = [];
  probe.slots = {};
});

afterEach(cleanup);

describe("ImageEditor - pomiar po zaznaczeniu widgetu", () => {
  it("plik bez zapisanego rozmiaru: dokładnie jeden zapis `srcIntrinsic`", async () => {
    probe.sizes = { [PHOTO]: "1200x675" };
    const { calls } = renderEditor({ src: PHOTO });
    await flush();

    expect(probe.calls).toEqual([PHOTO]);
    expect(calls).toEqual([["srcIntrinsic", "1200x675"]]);
  });

  it("oba sloty: każdy plik dostaje własny klucz", async () => {
    probe.sizes = { [PHOTO]: "1200x675", [PHOTO_DARK]: "800x600" };
    const { calls } = renderEditor({ src: PHOTO, srcDark: PHOTO_DARK });
    await flush();

    expect(probe.calls).toEqual([PHOTO, PHOTO_DARK]);
    expect(calls).toEqual([
      ["srcIntrinsic", "1200x675"],
      ["srcDarkIntrinsic", "800x600"],
    ]);
  });

  it("zapisany rozmiar zgodny z pomiarem: żadnego zapisu (zaznaczenie nie brudzi historii)", async () => {
    probe.sizes = { [PHOTO]: "1200x675", [PHOTO_DARK]: "800x600" };
    const { calls } = renderEditor({
      src: PHOTO,
      srcDark: PHOTO_DARK,
      srcIntrinsic: "1200x675",
      srcDarkIntrinsic: "800x600",
    });
    await flush();

    expect(probe.calls).toEqual([PHOTO, PHOTO_DARK]);
    expect(calls).toEqual([]);
  });

  it("zapisany rozmiar NIEAKTUALNY (plik podmieniony poza edytorem): jeden zapis poprawki", async () => {
    probe.sizes = { [PHOTO]: "1200x675" };
    const { calls } = renderEditor({ src: PHOTO, srcIntrinsic: "640x480" });
    await flush();

    expect(calls).toEqual([["srcIntrinsic", "1200x675"]]);
  });

  it("nieudany pomiar nie kasuje zapisanego rozmiaru i niczego nie zapisuje", async () => {
    const { calls } = renderEditor({ src: PHOTO, srcIntrinsic: "1200x675" });
    await flush();

    expect(probe.calls).toEqual([PHOTO]);
    expect(calls).toEqual([]);
  });

  it("pusty widget: żadnego pomiaru", async () => {
    const { calls } = renderEditor({});
    await flush();

    expect(probe.calls).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("instancja widgetu globalnego: zaznaczenie nie mierzy i nie zapisuje", async () => {
    probe.sizes = { [PHOTO]: "1200x675" };
    const { calls } = renderEditor({ src: PHOTO }, { widgetId: "w1", isGlobal: true });
    await flush();

    expect(probe.calls).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("zaznaczenie INNEGO widgetu (nowe `widgetId`) mierzy jego pliki", async () => {
    probe.sizes = { [PHOTO]: "1200x675", [NEW_PHOTO]: "640x480" };
    const { calls, rerender } = renderEditor({ src: PHOTO, srcIntrinsic: "1200x675" });
    await flush();
    expect(calls).toEqual([]);

    rerender({ src: NEW_PHOTO }, { widgetId: "w2" });
    await flush();

    expect(probe.calls).toEqual([PHOTO, NEW_PHOTO]);
    expect(calls).toEqual([["srcIntrinsic", "640x480"]]);
  });

  it("ten sam widget ze zmienioną treścią (cofnij/ponów): bez pomiaru i bez zapisu", async () => {
    probe.sizes = { [PHOTO]: "1200x675", [NEW_PHOTO]: "640x480" };
    const { calls, rerender } = renderEditor({ src: NEW_PHOTO, srcIntrinsic: "640x480" });
    await flush();
    expect(probe.calls).toEqual([NEW_PHOTO]);

    // "Cofnij" przywraca poprzedni plik z jego rozmiarem...
    rerender({ src: PHOTO, srcIntrinsic: "1200x675" });
    await flush();
    // ...a kolejne cofnięcie - stan sprzed pomiaru (adres bez rozmiaru).
    rerender({ src: PHOTO });
    await flush();

    expect(probe.calls).toEqual([NEW_PHOTO]);
    expect(calls).toEqual([]);
  });
});

describe("ImageEditor - zaznaczenie mierzy tylko to, czego użyje renderer", () => {
  it.each(["16/9", "1/1", "4/3"])(
    'obraz w ramce ("Proporcje" %s): zaznaczenie nie mierzy i nie zapisuje',
    async (ratio) => {
      probe.sizes = { [PHOTO]: "1200x675", [PHOTO_DARK]: "800x600" };
      const { calls } = renderEditor({ src: PHOTO, srcDark: PHOTO_DARK, ratio });
      await flush();

      expect(probe.calls).toEqual([]);
      expect(calls).toEqual([]);
    },
  );

  it.each([["auto"], [""]])(
    '"Proporcje" %j to obraz bez ramki: plik jest mierzony',
    async (ratio) => {
      probe.sizes = { [PHOTO]: "1200x675" };
      const { calls } = renderEditor({ src: PHOTO, ratio });
      await flush();

      expect(calls).toEqual([["srcIntrinsic", "1200x675"]]);
    },
  );

  it('"Użyj logo witryny" przy skonfigurowanym logo: własny plik nie jest rysowany, więc ani mierzony', async () => {
    probe.sizes = { [PHOTO]: "1200x675" };
    const { calls } = renderEditor({ src: PHOTO, useSiteLogo: "main" }, undefined, {
      main: SITE_LOGO,
    });
    await flush();

    expect(probe.calls).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('alt ze słowem "logo" przy skonfigurowanym logo: jak wyżej', async () => {
    probe.sizes = { [PHOTO]: "1200x675" };
    const { calls } = renderEditor({ src: PHOTO, alt_pl: "Logo", alt_en: "Logo" }, undefined, {
      main: SITE_LOGO,
    });
    await flush();

    expect(probe.calls).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('"Użyj logo witryny", ale witryna nie ma logo: renderer rysuje własny plik, więc jest mierzony', async () => {
    probe.sizes = { [PHOTO]: "1200x675" };
    const { calls } = renderEditor({ src: PHOTO, useSiteLogo: "main" }, undefined, {});
    await flush();

    expect(calls).toEqual([["srcIntrinsic", "1200x675"]]);
  });

  it("plik widgetu ma wpis na liście rozmiarów motywu: renderer bierze tamten, więc nic nie mierzymy", async () => {
    probe.sizes = { [SITE_LOGO]: "350x150" };
    const { calls } = renderEditor({ src: SITE_LOGO }, undefined, {
      main: SITE_LOGO,
      intrinsic: [[SITE_LOGO, "350x150"]],
    });
    await flush();

    expect(probe.calls).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("ten sam adres w obu slotach: renderer czyta tylko `srcIntrinsic`, więc mierzony jest jeden slot", async () => {
    probe.sizes = { [PHOTO]: "1200x675" };
    const { calls } = renderEditor({ src: PHOTO, srcDark: PHOTO });
    await flush();

    expect(probe.calls).toEqual([PHOTO]);
    expect(calls).toEqual([["srcIntrinsic", "1200x675"]]);
  });

  it("wynik, który wraca, gdy obraz dostał już ramkę, przepada", async () => {
    probe.manual = true;
    const { calls, rerender } = renderEditor({ src: PHOTO });
    expect(probe.calls).toEqual([PHOTO]);

    // Rodzic oddaje treść z ramką (np. "ponów"), zanim pomiar wróci.
    rerender({ src: PHOTO, ratio: "16/9" });
    await flush();
    await settle(PHOTO, "1200x675");

    expect(calls).toEqual([]);
  });

  it("zmiana pliku w obrazie w ramce nadal mierzy nowy plik (to edycja, nie zaznaczenie)", async () => {
    probe.sizes = { [NEW_PHOTO]: "640x480" };
    const { calls } = renderEditor({ src: PHOTO, ratio: "16/9" });
    await flush();
    expect(probe.calls).toEqual([]);

    await changeSlot(LIGHT_SLOT, NEW_PHOTO);

    expect(calls).toEqual([
      ["src", NEW_PHOTO],
      ["srcIntrinsic", "640x480"],
    ]);
  });
});

describe("ImageEditor - ustawienie, które włącza użycie rozmiaru, mierzy plik od razu", () => {
  it('"Proporcje" z 16:9 na auto: zapis proporcji, potem rozmiary obu plików', async () => {
    probe.sizes = { [PHOTO]: "1200x675", [PHOTO_DARK]: "800x600" };
    const { calls } = renderEditor({ src: PHOTO, srcDark: PHOTO_DARK, ratio: "16/9" });
    await flush();
    expect(calls).toEqual([]);

    await pickOption("Proporcje", "auto");

    expect(probe.calls).toEqual([PHOTO, PHOTO_DARK]);
    expect(calls).toEqual([
      ["ratio", "auto"],
      ["srcIntrinsic", "1200x675"],
      ["srcDarkIntrinsic", "800x600"],
    ]);
  });

  it('"Proporcje" na auto przy zapisanym, zgodnym rozmiarze: sam zapis proporcji', async () => {
    probe.sizes = { [PHOTO]: "1200x675" };
    const { calls } = renderEditor({ src: PHOTO, srcIntrinsic: "1200x675", ratio: "16/9" });
    await flush();

    await pickOption("Proporcje", "auto");

    expect(probe.calls).toEqual([PHOTO]);
    expect(calls).toEqual([["ratio", "auto"]]);
  });

  it('"Proporcje" z ramki na inną ramkę i z auto na ramkę: bez pomiaru', async () => {
    probe.sizes = { [PHOTO]: "1200x675" };
    const framed = renderEditor({ src: PHOTO, ratio: "16/9" });
    await flush();
    await pickOption("Proporcje", "1:1");
    expect(probe.calls).toEqual([]);
    expect(framed.calls).toEqual([["ratio", "1/1"]]);
    cleanup();

    const unframed = renderEditor({ src: PHOTO, srcIntrinsic: "1200x675" });
    await flush();
    probe.calls = [];
    await pickOption("Proporcje", "16:9");
    expect(probe.calls).toEqual([]);
    expect(unframed.calls).toEqual([["ratio", "16/9"]]);
  });

  it('wyłączenie "Użyj logo witryny": własny plik wraca do renderu i jest mierzony', async () => {
    probe.sizes = { [PHOTO]: "1200x675" };
    const { calls } = renderEditor({ src: PHOTO, useSiteLogo: "main" }, undefined, {
      main: SITE_LOGO,
    });
    await flush();
    expect(probe.calls).toEqual([]);

    await pickOption("Użyj logo witryny", "nie - własna grafika poniżej");

    expect(probe.calls).toEqual([PHOTO]);
    expect(calls).toEqual([
      ["useSiteLogo", ""],
      ["srcIntrinsic", "1200x675"],
    ]);
  });

  it('włączenie "Użyj logo witryny" niczego nie mierzy', async () => {
    probe.sizes = { [PHOTO]: "1200x675" };
    const { calls } = renderEditor({ src: PHOTO, srcIntrinsic: "1200x675" }, undefined, {
      main: SITE_LOGO,
    });
    await flush();
    probe.calls = [];

    await pickOption("Użyj logo witryny", "logo główne");

    expect(probe.calls).toEqual([]);
    expect(calls).toEqual([["useSiteLogo", "main"]]);
  });

  it("instancja widgetu globalnego: zdjęcie ramki to edycja redaktora, więc plik JEST mierzony", async () => {
    probe.sizes = { [PHOTO]: "1200x675" };
    const { calls } = renderEditor(
      { src: PHOTO, ratio: "16/9" },
      { widgetId: "w1", isGlobal: true },
    );
    await flush();
    expect(probe.calls).toEqual([]);

    await pickOption("Proporcje", "auto");

    expect(calls).toEqual([
      ["ratio", "auto"],
      ["srcIntrinsic", "1200x675"],
    ]);
  });

  it("rodzic stosujący zapisy: po zdjęciu ramki treść kończy z proporcją auto i rozmiarem pliku", async () => {
    probe.sizes = { [PHOTO]: "1200x675" };
    const { calls, state } = renderLiveEditor({ src: PHOTO, ratio: "16/9" });
    await flush();
    expect(calls).toEqual([]);

    await pickOption("Proporcje", "auto");

    expect(state.content).toEqual({ src: PHOTO, ratio: "auto", srcIntrinsic: "1200x675" });
    expect(probe.calls).toEqual([PHOTO]);
  });
});

describe("ImageEditor - plik bez własnej proporcji zeruje zapisany rozmiar", () => {
  it("zaznaczenie: zapisany rozmiar zastępczy znika jednym zapisem pustej wartości", async () => {
    probe.noRatio = [SHAPELESS];
    const { calls } = renderEditor({ src: SHAPELESS, srcIntrinsic: "300x150" });
    await flush();

    expect(probe.calls).toEqual([SHAPELESS]);
    expect(calls).toEqual([["srcIntrinsic", ""]]);
  });

  it("zaznaczenie: slot bez zapisanego rozmiaru nie dostaje żadnego zapisu", async () => {
    probe.noRatio = [SHAPELESS];
    const { calls } = renderEditor({ src: SHAPELESS });
    await flush();

    expect(probe.calls).toEqual([SHAPELESS]);
    expect(calls).toEqual([]);
  });

  it("slot ciemny: zerowany jest tylko `srcDarkIntrinsic`", async () => {
    probe.noRatio = [SHAPELESS];
    probe.sizes = { [PHOTO]: "1200x675" };
    const { calls } = renderEditor({
      src: PHOTO,
      srcDark: SHAPELESS,
      srcIntrinsic: "1200x675",
      srcDarkIntrinsic: "300x150",
    });
    await flush();

    expect(calls).toEqual([["srcDarkIntrinsic", ""]]);
  });

  it("pomiar NIEUDANY zapisanego rozmiaru nie rusza - zeruje tylko werdykt o braku proporcji", async () => {
    // Ten sam stan, dwa różne wyniki pomiaru.
    const failed = renderEditor({ src: SHAPELESS, srcIntrinsic: "300x150" });
    await flush();
    expect(failed.calls).toEqual([]);
    cleanup();

    probe.noRatio = [SHAPELESS];
    const shapeless = renderEditor({ src: SHAPELESS, srcIntrinsic: "300x150" });
    await flush();
    expect(shapeless.calls).toEqual([["srcIntrinsic", ""]]);
  });

  it("zaznaczenie nie pisze do slotu, którego renderer nie użyje: obraz w ramce zostaje nietknięty", async () => {
    probe.noRatio = [SHAPELESS];
    const { calls } = renderEditor({ src: SHAPELESS, srcIntrinsic: "300x150", ratio: "16/9" });
    await flush();

    expect(probe.calls).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("instancja widgetu globalnego: zaznaczenie niczego nie zeruje", async () => {
    probe.noRatio = [SHAPELESS];
    const { calls } = renderEditor(
      { src: SHAPELESS, srcIntrinsic: "300x150" },
      { widgetId: "w1", isGlobal: true },
    );
    await flush();

    expect(probe.calls).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('"Proporcje" na auto: plik wraca do renderu bez ramki, więc jego rozmiar zastępczy jest zerowany', async () => {
    probe.noRatio = [SHAPELESS];
    const { calls } = renderEditor({ src: SHAPELESS, srcIntrinsic: "300x150", ratio: "16/9" });
    await flush();
    expect(calls).toEqual([]);

    await pickOption("Proporcje", "auto");

    expect(probe.calls).toEqual([SHAPELESS]);
    expect(calls).toEqual([
      ["ratio", "auto"],
      ["srcIntrinsic", ""],
    ]);
  });

  it("zmiana pliku na plik bez proporcji: rozmiar zerowany RAZ, w kroku zmiany adresu", async () => {
    probe.sizes = { [PHOTO]: "1200x675" };
    probe.noRatio = [SHAPELESS];
    const { calls } = renderEditor({ src: PHOTO, srcIntrinsic: "1200x675" });
    await flush();

    await changeSlot(LIGHT_SLOT, SHAPELESS);

    expect(calls).toEqual([
      ["src", SHAPELESS],
      ["srcIntrinsic", ""],
    ]);
  });

  it("werdykt, który wraca, gdy slot wskazuje już inny plik, przepada", async () => {
    probe.manual = true;
    const { calls } = renderEditor({ src: SHAPELESS, srcIntrinsic: "300x150" });

    await changeSlot(LIGHT_SLOT, NEW_PHOTO);
    await settle(NEW_PHOTO, "640x480");
    // Pomiar z zaznaczenia (stary plik) wraca jako ostatni.
    await settle(SHAPELESS, NO_RATIO);

    expect(calls).toEqual([
      ["src", NEW_PHOTO],
      ["srcIntrinsic", ""],
      ["srcIntrinsic", "640x480"],
    ]);
  });

  it("werdykt, który wraca, gdy obraz dostał już ramkę, przepada (rozmiar zostaje)", async () => {
    probe.manual = true;
    const { calls, rerender } = renderEditor({ src: SHAPELESS, srcIntrinsic: "300x150" });

    rerender({ src: SHAPELESS, srcIntrinsic: "300x150", ratio: "16/9" });
    await flush();
    await settle(SHAPELESS, NO_RATIO);

    expect(calls).toEqual([]);
  });

  it("werdykt, który wraca po odmontowaniu edytora, przepada", async () => {
    probe.manual = true;
    const { calls, unmount } = renderEditor({ src: SHAPELESS, srcIntrinsic: "300x150" });

    unmount();
    await settle(SHAPELESS, NO_RATIO);

    expect(calls).toEqual([]);
  });

  it("rodzic stosujący zapisy: treść kończy z pustym rozmiarem, podpowiedź mówi o braku wymiarów, a pomiar nie rusza drugi raz", async () => {
    probe.noRatio = [SHAPELESS];
    const { calls, state } = renderLiveEditor({ src: SHAPELESS, srcIntrinsic: "300x150" });
    await flush();

    expect(state.content).toEqual({ src: SHAPELESS, srcIntrinsic: "" });
    expect(calls).toEqual([["srcIntrinsic", ""]]);
    expect(probe.calls).toEqual([SHAPELESS]);
    expect(probe.slots[LIGHT_SLOT].hint).toBe(NOT_STORED);
  });
});

describe("ImageEditor - zmiana pliku", () => {
  it("slot jasny z zapisanym rozmiarem: adres, wyzerowanie, potem nowy rozmiar - w tej kolejności", async () => {
    probe.sizes = { [PHOTO]: "1200x675", [NEW_PHOTO]: "640x480" };
    const { calls } = renderEditor({ src: PHOTO, srcIntrinsic: "1200x675" });
    await flush();
    expect(calls).toEqual([]);

    await changeSlot(LIGHT_SLOT, NEW_PHOTO);

    expect(calls).toEqual([
      ["src", NEW_PHOTO],
      ["srcIntrinsic", ""],
      ["srcIntrinsic", "640x480"],
    ]);
  });

  it("slot bez zapisanego rozmiaru: nie ma czego zerować", async () => {
    probe.sizes = { [NEW_PHOTO]: "640x480" };
    const { calls } = renderEditor({});

    await changeSlot(LIGHT_SLOT, NEW_PHOTO);

    expect(calls).toEqual([
      ["src", NEW_PHOTO],
      ["srcIntrinsic", "640x480"],
    ]);
  });

  it("slot ciemny pisze do `srcDark` / `srcDarkIntrinsic` i nie rusza jasnego", async () => {
    probe.sizes = { [PHOTO]: "1200x675", [PHOTO_DARK]: "800x600", [NEW_PHOTO]: "640x480" };
    const { calls } = renderEditor({
      src: PHOTO,
      srcDark: PHOTO_DARK,
      srcIntrinsic: "1200x675",
      srcDarkIntrinsic: "800x600",
    });
    await flush();

    await changeSlot(DARK_SLOT, NEW_PHOTO);

    expect(calls).toEqual([
      ["srcDark", NEW_PHOTO],
      ["srcDarkIntrinsic", ""],
      ["srcDarkIntrinsic", "640x480"],
    ]);
  });

  it("wyczyszczenie slotu zeruje rozmiar i niczego nie mierzy", async () => {
    probe.sizes = { [PHOTO]: "1200x675" };
    const { calls } = renderEditor({ src: PHOTO, srcIntrinsic: "1200x675" });
    await flush();
    probe.calls = [];

    await changeSlot(LIGHT_SLOT, "");

    expect(calls).toEqual([
      ["src", ""],
      ["srcIntrinsic", ""],
    ]);
    expect(probe.calls).toEqual([]);
  });

  it("nieudany pomiar nowego pliku: rozmiar zostaje pusty (render bez atrybutów)", async () => {
    probe.sizes = { [PHOTO]: "1200x675" };
    const { calls } = renderEditor({ src: PHOTO, srcIntrinsic: "1200x675" });
    await flush();

    await changeSlot(LIGHT_SLOT, NEW_PHOTO);

    expect(calls).toEqual([
      ["src", NEW_PHOTO],
      ["srcIntrinsic", ""],
    ]);
  });

  it("instancja widgetu globalnego: realna zmiana pliku JEST mierzona", async () => {
    probe.sizes = { [NEW_PHOTO]: "640x480" };
    const { calls } = renderEditor({ src: PHOTO }, { widgetId: "w1", isGlobal: true });
    await flush();
    expect(probe.calls).toEqual([]);

    await changeSlot(LIGHT_SLOT, NEW_PHOTO);

    expect(probe.calls).toEqual([NEW_PHOTO]);
    expect(calls).toEqual([
      ["src", NEW_PHOTO],
      ["srcIntrinsic", "640x480"],
    ]);
  });

  it("wynik, który wraca po KOLEJNEJ zmianie adresu, przepada", async () => {
    probe.manual = true;
    const { calls } = renderEditor({});

    await changeSlot(LIGHT_SLOT, NEW_PHOTO);
    await changeSlot(LIGHT_SLOT, NEWER_PHOTO);
    // Pierwszy pomiar wraca jako drugi - slot wskazuje już inny plik.
    await settle(NEWER_PHOTO, "320x200");
    await settle(NEW_PHOTO, "640x480");

    expect(calls).toEqual([
      ["src", NEW_PHOTO],
      ["src", NEWER_PHOTO],
      ["srcIntrinsic", "320x200"],
    ]);
  });

  it("wynik, który wraca po cofnięciu zmiany przez rodzica, przepada", async () => {
    probe.manual = true;
    const { calls, rerender } = renderEditor({ src: PHOTO, srcIntrinsic: "1200x675" });
    await settle(PHOTO, "1200x675");

    await changeSlot(LIGHT_SLOT, NEW_PHOTO);
    // "Cofnij": rodzic oddaje poprzednią treść, zanim pomiar nowego pliku wróci.
    rerender({ src: PHOTO, srcIntrinsic: "1200x675" });
    await flush();
    await settle(NEW_PHOTO, "640x480");

    expect(calls).toEqual([
      ["src", NEW_PHOTO],
      ["srcIntrinsic", ""],
    ]);
  });

  it("wynik, który wraca po odmontowaniu edytora, przepada", async () => {
    probe.manual = true;
    const { calls, unmount } = renderEditor({ src: PHOTO });

    unmount();
    await settle(PHOTO, "1200x675");

    expect(calls).toEqual([]);
  });

  it("dwa pomiary tego samego pliku (zaznaczenie + zmiana na ten sam adres) dają jeden zapis rozmiaru", async () => {
    probe.manual = true;
    const { calls } = renderEditor({ src: PHOTO });

    await changeSlot(LIGHT_SLOT, PHOTO);
    await settle(PHOTO, "1200x675");
    await settle(PHOTO, "1200x675");

    expect(calls).toEqual([
      ["src", PHOTO],
      ["srcIntrinsic", "1200x675"],
    ]);
  });
});

// ZNANE OGRANICZENIE (pkt 4): pomiar nowego pliku przepada, gdy redaktor odznaczy
// widget albo zaznaczy inny, zanim wynik wróci - treść zostaje z nowym adresem
// i PUSTYM rozmiarem (strona renderuje znacznik bez atrybutów, jak przed tą
// funkcją). Wyniku nie dopisujemy po fakcie: zapis do widgetu, którego redaktor
// już nie edytuje, dokładałby krok "cofnij" i czyścił stos "ponów" poza jego
// działaniem. Stan naprawia się sam przy kolejnym zaznaczeniu - i to jest tu
// przypięte - a do tego czasu edytor pokazuje, że wymiary nie są zapisane.
describe("ImageEditor - pomiar utracony przez zmianę zaznaczenia", () => {
  it("odznaczenie przed powrotem pomiaru: rozmiar zostaje pusty, a ponowne zaznaczenie mierzy plik jeszcze raz i go zapisuje", async () => {
    probe.manual = true;
    const { doc, select } = renderSelection({ w1: { src: PHOTO, srcIntrinsic: "1200x675" } }, "w1");
    await settle(PHOTO, "1200x675");

    await changeSlot(LIGHT_SLOT, NEW_PHOTO);
    await select(null);
    await settle(NEW_PHOTO, "640x480");
    expect(doc.w1).toEqual({ src: NEW_PHOTO, srcIntrinsic: "" });

    await select("w1");
    expect(probe.pending.map((entry) => entry.url)).toEqual([NEW_PHOTO]);
    expect(probe.slots[LIGHT_SLOT].hint).toBe(NOT_STORED);
    await settle(NEW_PHOTO, "640x480");

    expect(doc.w1).toEqual({ src: NEW_PHOTO, srcIntrinsic: "640x480" });
    expect(probe.slots[LIGHT_SLOT].hint).toBe("640 × 480 px");
  });

  it("zaznaczenie INNEGO obrazu przed powrotem pomiaru: wynik nie trafia do żadnego widgetu, powrót mierzy ponownie", async () => {
    probe.manual = true;
    const { doc, select } = renderSelection(
      {
        w1: { src: PHOTO, srcIntrinsic: "1200x675" },
        w2: { src: PHOTO_DARK, srcIntrinsic: "800x600" },
      },
      "w1",
    );
    await settle(PHOTO, "1200x675");

    await changeSlot(LIGHT_SLOT, NEW_PHOTO);
    await select("w2");
    await settle(NEW_PHOTO, "640x480");
    await settle(PHOTO_DARK, "800x600");
    expect(doc).toEqual({
      w1: { src: NEW_PHOTO, srcIntrinsic: "" },
      w2: { src: PHOTO_DARK, srcIntrinsic: "800x600" },
    });

    await select("w1");
    await settle(NEW_PHOTO, "640x480");

    expect(doc).toEqual({
      w1: { src: NEW_PHOTO, srcIntrinsic: "640x480" },
      w2: { src: PHOTO_DARK, srcIntrinsic: "800x600" },
    });
  });

  it("instancja widgetu globalnego: zaznaczenie nie mierzy, więc rozmiar zostaje pusty - podpowiedź to pokazuje", async () => {
    probe.manual = true;
    const { doc, select } = renderSelection({ g1: { src: PHOTO } }, "g1", new Set(["g1"]));

    await changeSlot(LIGHT_SLOT, NEW_PHOTO);
    await select(null);
    await settle(NEW_PHOTO, "640x480");
    await select("g1");

    expect(probe.pending).toEqual([]);
    expect(doc.g1).toEqual({ src: NEW_PHOTO });
    expect(probe.slots[LIGHT_SLOT].hint).toBe(NOT_STORED);
  });
});

describe("ImageEditor - rodzic stosujący zapisy (jak builder)", () => {
  it("po zmianie pliku treść kończy z nowym adresem i JEGO rozmiarem", async () => {
    probe.sizes = { [PHOTO]: "1200x675", [NEW_PHOTO]: "640x480" };
    const { calls, state } = renderLiveEditor({ src: PHOTO });
    await flush();
    expect(state.content).toEqual({ src: PHOTO, srcIntrinsic: "1200x675" });

    await changeSlot(LIGHT_SLOT, NEW_PHOTO);

    expect(state.content).toEqual({ src: NEW_PHOTO, srcIntrinsic: "640x480" });
    // Zapis rozmiaru wraca propsem, ale NIE uruchamia kolejnego pomiaru.
    expect(probe.calls).toEqual([PHOTO, NEW_PHOTO]);
    expect(calls).toEqual([
      ["srcIntrinsic", "1200x675"],
      ["src", NEW_PHOTO],
      ["srcIntrinsic", ""],
      ["srcIntrinsic", "640x480"],
    ]);
  });
});

describe("ImageEditor - podpowiedź z rozmiarem i kontrakt panelu", () => {
  it("pokazuje zmierzony rozmiar pod slotem jasnym, a pod ciemnym obok jego opisu", () => {
    renderEditor({
      src: PHOTO,
      srcDark: PHOTO_DARK,
      srcIntrinsic: "1200x675",
      srcDarkIntrinsic: "800x600",
    });

    expect(screen.getByText("1200 × 675 px")).toBeInTheDocument();
    expect(screen.getByText(`${DARK_HINT} · 800 × 600 px`)).toBeInTheDocument();
  });

  it("bez rozmiaru, gdy renderer go nie użyje (obraz w ramce): slot jasny bez podpowiedzi, ciemny z samym opisem", () => {
    renderEditor({ src: PHOTO, srcDark: PHOTO_DARK, ratio: "16/9" });

    expect(probe.slots[LIGHT_SLOT].hint).toBeUndefined();
    expect(probe.slots[DARK_SLOT].hint).toBe(DARK_HINT);
    expect(screen.queryByText(/ px$/)).toBeNull();
  });

  it("bez rozmiaru, gdy renderer by go użył: podpowiedź mówi, że wymiary nie są jeszcze zapisane", async () => {
    // Pomiar się nie udaje (brak wpisu w `probe.sizes`), więc stan zostaje.
    renderEditor({ src: PHOTO, srcDark: PHOTO_DARK });
    await flush();

    expect(probe.slots[LIGHT_SLOT].hint).toBe(NOT_STORED);
    expect(probe.slots[DARK_SLOT].hint).toBe(`${DARK_HINT} · ${NOT_STORED}`);
    expect(screen.getByText(NOT_STORED)).toBeInTheDocument();
    expect(screen.queryByText(/ px$/)).toBeNull();
  });

  it("pusty slot nie ma czego mierzyć: bez podpowiedzi o wymiarach", () => {
    renderEditor({ src: PHOTO, srcIntrinsic: "1200x675" });

    expect(probe.slots[LIGHT_SLOT].hint).toBe("1200 × 675 px");
    expect(probe.slots[DARK_SLOT].hint).toBe(DARK_HINT);
  });

  it("własny plik zastąpiony logo motywu: bez podpowiedzi o wymiarach", () => {
    renderEditor({ src: PHOTO, useSiteLogo: "main" }, undefined, { main: SITE_LOGO });

    expect(probe.slots[LIGHT_SLOT].hint).toBeUndefined();
    expect(probe.slots[DARK_SLOT].hint).toBe(DARK_HINT);
  });

  it("po zapisaniu pomiaru podpowiedź przechodzi z braku wymiarów na rozmiar pliku", async () => {
    probe.manual = true;
    renderLiveEditor({ src: PHOTO });
    expect(probe.slots[LIGHT_SLOT].hint).toBe(NOT_STORED);

    await settle(PHOTO, "1200x675");

    expect(probe.slots[LIGHT_SLOT].hint).toBe("1200 × 675 px");
  });

  it("wartość innego typu niż napis jest traktowana jak brak rozmiaru", () => {
    renderEditor({ src: PHOTO, srcIntrinsic: 1200, srcDarkIntrinsic: null });

    expect(probe.slots[LIGHT_SLOT].hint).toBe(NOT_STORED);
    expect(probe.slots[DARK_SLOT].hint).toBe(DARK_HINT);
  });

  it("rozmiar to wartość mierzona: nie jest polem schematu ani kluczem obsługiwanym przez edytor", () => {
    const schemaKeys = (WIDGET_SCHEMAS.image ?? []).map((field) => field.key);

    for (const key of ["srcIntrinsic", "srcDarkIntrinsic"]) {
      expect(schemaKeys).not.toContain(key);
      expect(IMAGE_EDITOR_HANDLED_KEYS.has(key)).toBe(false);
    }
  });
});
