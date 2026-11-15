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
//
// `measureIntrinsicSize` jest atrapą (środowisko testowe nie ładuje obrazów);
// `ImageSlot` jest PRAWDZIWY - atrapa tylko podsłuchuje jego propsy, żeby test
// mógł wywołać `onChange` dokładnie tak, jak robi to pole adresu, upload i
// biblioteka mediów.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
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
    if (!probe.manual) return Promise.resolve(probe.sizes[url] ?? "");
    return new Promise<string>((resolve) => {
      probe.pending.push({ url, resolve });
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

const LIGHT_SLOT = "builder.imageEditor.slotLight";
const DARK_SLOT = "builder.imageEditor.slotDark";
const DARK_HINT = "builder.imageEditor.slotDarkHint";

const PHOTO = "https://cdn.example.test/panel.jpg";
const PHOTO_DARK = "https://cdn.example.test/panel-dark.jpg";
const NEW_PHOTO = "https://cdn.example.test/nowy.jpg";
const NEWER_PHOTO = "https://cdn.example.test/jeszcze-nowszy.jpg";

type Recorded = Array<[string, Json]>;
interface EditorProps {
  widgetId?: string;
  isGlobal?: boolean;
}

/** Edytor z rodzicem, który NIE stosuje zapisów - widać dokładnie, co edytor wysłał. */
function renderEditor(content: WidgetContent, props: EditorProps = { widgetId: "w1" }) {
  const calls: Recorded = [];
  const setContent = (key: string, value: Json) => {
    calls.push([key, value]);
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

/** Domyka mikrozadania (rozstrzygnięte pomiary) i wynikające z nich rendery. */
const flush = () => act(async () => {});

/** Zmiana pliku slotu tak, jak robi to pole adresu / upload / biblioteka. */
const changeSlot = (label: string, value: string) =>
  act(async () => {
    probe.slots[label].onChange(value);
  });

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

  it("bez rozmiaru: slot jasny bez podpowiedzi, ciemny z samym opisem", () => {
    renderEditor({ src: PHOTO, srcDark: PHOTO_DARK });

    expect(probe.slots[LIGHT_SLOT].hint).toBeUndefined();
    expect(probe.slots[DARK_SLOT].hint).toBe(DARK_HINT);
    expect(screen.queryByText(/ px$/)).toBeNull();
  });

  it("wartość innego typu niż napis jest traktowana jak brak rozmiaru", () => {
    renderEditor({ src: PHOTO, srcIntrinsic: 1200, srcDarkIntrinsic: null });

    expect(probe.slots[LIGHT_SLOT].hint).toBeUndefined();
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
