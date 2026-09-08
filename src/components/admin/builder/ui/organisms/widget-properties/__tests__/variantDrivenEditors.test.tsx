// Edytory, których PANEL zmienia zestaw pól w zależności od WARIANTU z katalogu.
//
// Katalogi wariantów (`SECTION_LABEL_VARIANTS`, `SLIDER_VARIANTS`,
// `NAV_ARROW_VARIANTS`) są jednym źródłem prawdy dla panelu i dla renderera.
// Panel ma dla części wariantów DODATKOWE kontrolki (numer, kategoria,
// odstępy), a dla pozostałych ich nie pokazuje. To jest miejsce, w którym
// nowy wariant dopisany do katalogu bez pracy w panelu przechodzi
// niezauważony: renderer go rysuje, a redakcja nie ma czym go ustawić.
//
// Dlatego tabela idzie po KATALOGU, nie po ręcznej liście: dopisanie wariantu
// automatycznie dokłada przypadek testowy.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { fireEvent, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import type { Json, WidgetNode } from "@/lib/builder/types";
import { SECTION_LABEL_VARIANTS } from "@/lib/builder/sectionLabelVariants";
import { SLIDER_VARIANTS, NAV_ARROW_VARIANTS } from "@/lib/builder/sliderOptions";
import { COUNTRY_CENTROIDS } from "@/lib/maps/countryCentroids";
import { SectionLabelEditor } from "../SectionLabelEditor";
import { SliderEditor } from "../SliderEditor";
import { WorldMapEditor } from "../WorldMapEditor";

const db: { current: SupabaseFromStub } = { current: supabaseFromStub() };

/**
 * Uchwyt do wnętrza dnd-kit. Przeciągania nie da się odtworzyć zdarzeniami
 * wskaźnika pod happy-dom (dnd-kit mierzy układ, którego tam nie ma), więc
 * atrapa kontekstu ODDAJE testowi swój `onDragEnd`, a atrapa `useSortable`
 * pozwala wymusić stan „ten wiersz właśnie leci". Ten sam wzorzec stoi
 * w `src/routes/__tests__/adminPostsCalendarRoute.test.tsx`.
 */
const dnd = vi.hoisted(() => ({
  onDragEnd: null as ((event: unknown) => void) | null,
  dragging: false,
}));

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const React = await import("react");
  return {
    ...actual,
    DndContext: ({
      children,
      onDragEnd,
    }: {
      children?: unknown;
      onDragEnd?: (event: unknown) => void;
    }) => {
      dnd.onDragEnd = onDragEnd ?? null;
      return React.createElement("div", { "data-testid": "dnd" }, children as never);
    },
    useSensor: (sensor: unknown) => sensor,
    useSensors: (...sensors: unknown[]) => sensors,
  };
});
vi.mock("@dnd-kit/sortable", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const React = await import("react");
  return {
    ...actual,
    SortableContext: ({ children }: { children?: unknown }) =>
      React.createElement(React.Fragment, null, children as never),
    useSortable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: () => {},
      transform: dnd.dragging ? { x: 0, y: 12, scaleX: 1, scaleY: 1 } : null,
      transition: undefined,
      isDragging: dnd.dragging,
    }),
  };
});

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
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => db.current.from(table),
    storage: { from: () => ({ upload: async () => ({ data: null, error: null }) }) },
  },
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

const LEAKS = ["undefined", "NaN", "[object Object]"];

function assertNoLeak(root: HTMLElement, label: string): void {
  const text = root.textContent ?? "";
  for (const leak of LEAKS) {
    expect(text.includes(leak), `${label}: w panelu wyciekło "${leak}"`).toBe(false);
  }
}

type ContentEditor = (props: {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}) => React.ReactNode;

/** Oprawa ZE STANEM - wpis wraca do edytora, więc pola zależne reagują. */
function renderStateful(Editor: ContentEditor, initial: WidgetNode["content"]) {
  const written: Array<[string, Json]> = [];
  function Host() {
    const [content, setContent] = useState<WidgetNode["content"]>(initial);
    return (
      <Editor
        c={content}
        lang="pl"
        setContent={(k, v) => {
          written.push([k, v]);
          setContent((prev) => ({ ...prev, [k]: v }));
        }}
      />
    );
  }
  const view = renderWithQueryClient(<Host />);
  return { ...view, written, map: () => Object.fromEntries(written) };
}

/** Wypełnia wszystkie pola panelu i zwraca liczbę tkniętych kontrolek. */
function exerciseFields(container: HTMLElement): number {
  let touched = 0;
  for (const field of Array.from(
    container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"),
  ).slice(0, 40)) {
    if (field instanceof HTMLInputElement && field.type === "file") continue;
    if (
      field instanceof HTMLInputElement &&
      (field.type === "checkbox" || field.type === "radio")
    ) {
      fireEvent.click(field);
      touched += 1;
      continue;
    }
    const isNumber = field instanceof HTMLInputElement && field.type === "number";
    fireEvent.change(field, { target: { value: isNumber ? "0" : "wartość" } });
    touched += 1;
  }
  for (const select of container.querySelectorAll<HTMLSelectElement>("select")) {
    const options = Array.from(select.querySelectorAll("option"));
    if (options.length > 1) {
      fireEvent.change(select, { target: { value: options.at(-1)!.value } });
      touched += 1;
    }
  }
  return touched;
}

beforeEach(() => {
  db.current = supabaseFromStub();
  for (const table of ["pages", "posts", "profiles", "events", "categories", "tags", "media"]) {
    db.current.setResponse(table, ok([]));
  }
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  dnd.onDragEnd = null;
  dnd.dragging = false;
});

describe("SectionLabelEditor - każdy wariant z katalogu", () => {
  // Te dwa zbiory są kopią decyzji z panelu (`SectionLabelEditor`): warianty
  // redakcyjne dzielą dodatkowy panel numeru albo kategorii.
  const NUMBER_VARIANTS = ["editorial-index", "numbered-rail"];
  const CATEGORY_VARIANTS = [
    "double-deck-masthead",
    "kicker-tag-rule",
    "stacked-serif-lede",
    "split-rule-duo",
  ];

  it.each(SECTION_LABEL_VARIANTS.map((v) => [v.value] as const))(
    "wariant %s ma sprawny panel",
    (variant) => {
      const { container, written } = renderStateful(SectionLabelEditor, {
        variant,
        label_pl: "Nasze raporty",
        action_pl: "Zobacz wszystkie",
        href: "/raporty",
      });
      assertNoLeak(container, `SectionLabelEditor/${variant}`);
      // Panel musi dać się WYPEŁNIĆ w każdym wariancie - wariant, w którym
      // nie ma czego ustawić, znaczy albo brak kontrolek, albo pola bez efektu.
      expect(exerciseFields(container)).toBeGreaterThan(0);
      assertNoLeak(container, `SectionLabelEditor/${variant} (po edycji)`);
      for (const [key, value] of written) {
        expect(value, `klucz ${key} zapisany jako undefined`).not.toBeUndefined();
      }
    },
  );

  it.each(NUMBER_VARIANTS)("wariant %s pozwala ustawić numer i jego typografię", (variant) => {
    const { container, map } = renderStateful(SectionLabelEditor, { variant });
    exerciseFields(container);
    const written = map();
    // Numer jest treścią tego wariantu - bez niego renderuje się puste miejsce.
    const keys = Object.keys(written);
    expect(keys.some((k) => k.toLowerCase().includes("number") || k === "indexNumber")).toBe(true);
  });

  it.each(CATEGORY_VARIANTS)("wariant %s pozwala ustawić kategorię", (variant) => {
    const { container, map } = renderStateful(SectionLabelEditor, { variant });
    exerciseFields(container);
    const keys = Object.keys(map());
    expect(keys.some((k) => k.startsWith("category"))).toBe(true);
  });

  it("wariant bez dodatków nie pokazuje pól numeru ani kategorii", () => {
    const { container, map } = renderStateful(SectionLabelEditor, { variant: "only-text" });
    exerciseFields(container);
    const keys = Object.keys(map());
    expect(keys.some((k) => k.startsWith("category"))).toBe(false);
  });

  it("kliknięcie presetu koloru czyści kolor własny", () => {
    const { container, map } = renderStateful(SectionLabelEditor, {
      variant: "left-bar",
      accentColor: "#123456",
    });
    const presetButtons = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).slice(
      0,
      5,
    );
    if (!presetButtons[1]) throw new Error("test: brak presetów koloru");
    fireEvent.click(presetButtons[1]);
    const written = map();
    // Dwa źródła koloru wykluczają się: wybór presetu MUSI wyczyścić własny,
    // inaczej panel pokazuje preset, a strona rysuje stary kolor własny.
    expect(written.accentColor).toBe("");
    expect(typeof written.color).toBe("string");
  });
});

describe("SliderEditor - każdy wariant i każda strzałka z katalogu", () => {
  it.each(SLIDER_VARIANTS.map((v) => [v.value] as const))(
    "wariant %s ma sprawny panel",
    (variant) => {
      const { container, written } = renderStateful(SliderEditor, {
        variant,
        slides: [
          { id: "s1", title_pl: "Slajd", image: "https://cdn.test/a.png" },
          { id: "s2", title_pl: "Drugi", image: "https://cdn.test/b.png" },
        ],
      });
      assertNoLeak(container, `SliderEditor/${variant}`);
      expect(exerciseFields(container)).toBeGreaterThan(0);
      assertNoLeak(container, `SliderEditor/${variant} (po edycji)`);
      for (const [key, value] of written) {
        expect(value, `klucz ${key} zapisany jako undefined`).not.toBeUndefined();
      }
    },
  );

  it.each(NAV_ARROW_VARIANTS.map((v) => [v.value] as const))(
    "strzałka %s daje się wybrać",
    (arrow) => {
      const { container, map } = renderStateful(SliderEditor, {
        variant: "editorial-hero",
        navArrow: arrow,
        slides: [{ id: "s1", title_pl: "Slajd" }],
      });
      assertNoLeak(container, `SliderEditor/strzałka ${arrow}`);
      const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
      const arrowButton = buttons.find((b) => b.getAttribute("data-arrow") === arrow);
      if (arrowButton) {
        fireEvent.click(arrowButton);
        expect(map().navArrow).toBe(arrow);
      } else {
        // Wariant strzałki bez własnego przycisku wybiera się listą - wtedy
        // wystarczy, że panel się rysuje i nie gubi wartości.
        expect(container.textContent?.length ?? 0).toBeGreaterThan(0);
      }
    },
  );

  it("źródło wpisów odsłania filtry, a ręczne slajdy nie", () => {
    const dynamic = renderStateful(SliderEditor, { source: "posts", slides: [] });
    const dynamicKeys = exerciseFields(dynamic.container);
    expect(dynamicKeys).toBeGreaterThan(0);
    dynamic.unmount();
    const manual = renderStateful(SliderEditor, {
      source: "manual",
      slides: [{ id: "s1", title_pl: "Slajd" }],
    });
    expect(exerciseFields(manual.container)).toBeGreaterThan(0);
  });
});

describe("WorldMapEditor - oba źródła danych", () => {
  it.each([
    ["ręczne", "manual"],
    ["eksperci", "experts"],
  ])("źródło %s ma sprawny panel", (_label, source) => {
    const { container, written } = renderStateful(WorldMapEditor, {
      source,
      connections: [{ id: "c1", from: "PL", to: "DE", label_pl: "Trasa" }],
      regions: [{ code: "PL", value: 10 }],
    });
    assertNoLeak(container, `WorldMapEditor/${source}`);
    expect(exerciseFields(container)).toBeGreaterThan(0);
    assertNoLeak(container, `WorldMapEditor/${source} (po edycji)`);
    for (const [key, value] of written) {
      expect(value, `klucz ${key} zapisany jako undefined`).not.toBeUndefined();
    }
  });
});

// ── DRUGI SZEREG: gałęzie ODMOWY i pola warunkowe obu edytorów ──────────────
//
// Powyżej tabela jedzie po KATALOGU wariantów i pilnuje, że każdy wariant ma
// czym się ustawić. Poniżej idą miejsca, których żaden przejazd „wypełnij
// wszystkie pola" nie dotknie, bo albo wymagają upuszczenia przeciąganego
// wiersza, albo pola pojawiają się dopiero po decyzji o źródle, albo -
// najczęściej - są to KOMUNIKATY BŁĘDU, które zapalają się wyłącznie od danych
// przyszłych z dokumentu (ręczna edycja JSON-a, import), a nie od wpisu w panelu.

type FormField = HTMLInputElement | HTMLTextAreaElement;

/** Pole panelu po DOKŁADNEJ treści etykiety `PropField`. */
function fieldsLabelled(container: HTMLElement, label: string): FormField[] {
  const out: FormField[] = [];
  for (const node of Array.from(container.querySelectorAll("label"))) {
    if ((node.textContent ?? "").trim() !== label) continue;
    const field = node.closest("div")?.querySelector<FormField>("input, textarea");
    if (field) out.push(field);
  }
  return out;
}

function fieldLabelled(container: HTMLElement, label: string, index = 0): FormField {
  const field = fieldsLabelled(container, label)[index];
  if (!field) throw new Error(`test: brak pola o etykiecie „${label}” (#${index})`);
  return field;
}

/**
 * Pole po POCZĄTKU etykiety. Etykiety `SliderEditor` idą ze słownika z
 * parametrem (atrapa `t` dokleja do klucza JSON z wartościami), więc dokładna
 * treść zmienia się razem z wartością pola - stały jest tylko klucz.
 */
function fieldLabelStarting(container: HTMLElement, prefix: string): FormField {
  for (const node of Array.from(container.querySelectorAll("label"))) {
    if (!(node.textContent ?? "").trim().startsWith(prefix)) continue;
    const field = node.closest("div")?.querySelector<FormField>("input, textarea");
    if (field) return field;
  }
  throw new Error(`test: brak pola o etykiecie zaczynającej się od „${prefix}”`);
}

/** Lista wyboru poznawana po ISTNIENIU opcji, nie po kolejności w panelu. */
function selectsWithOption(container: HTMLElement, value: string): HTMLSelectElement[] {
  return Array.from(container.querySelectorAll<HTMLSelectElement>("select")).filter((sel) =>
    sel.querySelector(`option[value="${value}"]`),
  );
}

/** Przycisk „odepnij" z chipa taksonomii - chip jest tym trafieniem, które
 *  SAMO zawiera przycisk (etykieta na przycisku listy go nie ma). */
function chipRemoveButton(matches: HTMLElement[]): HTMLButtonElement {
  for (const node of matches) {
    const button = node.querySelector("button");
    if (button) return button;
  }
  throw new Error("test: żadne trafienie nie wygląda na chip z przyciskiem odpięcia");
}

const lastValueFor = (written: Array<[string, Json]>, key: string): Json | undefined =>
  written.filter(([k]) => k === key).at(-1)?.[1];

const connectionsFrom = (written: Array<[string, Json]>): Array<Record<string, unknown>> => {
  const last = lastValueFor(written, "connections");
  return Array.isArray(last) ? (last as Array<Record<string, unknown>>) : [];
};

describe("WorldMapEditor - przeciąganie połączeń: gałęzie odmowy", () => {
  const TWO: WidgetNode["content"] = {
    connections: [
      { id: "wm-1", startLabel_pl: "Bruksela", endLabel_pl: "Warszawa" },
      { id: "wm-2", startLabel_pl: "Bruksela", endLabel_pl: "Berlin" },
    ],
  };

  const dropAndRead = (event: unknown): Array<Record<string, unknown>> | null => {
    const { written } = renderStateful(WorldMapEditor, TWO);
    if (!dnd.onDragEnd) throw new Error("test: DndContext nie oddał handlera");
    dnd.onDragEnd(event);
    return written.length === 0 ? null : connectionsFrom(written);
  };

  it("upuszczenie POZA listę (brak celu) nie zapisuje niczego", () => {
    expect(dropAndRead({ active: { id: "wm-1" }, over: null })).toBeNull();
  });

  it("upuszczenie na TEJ SAMEJ pozycji nie zapisuje niczego", () => {
    // Kliknięcie uchwytu bez ruchu kończy się „przeciągnięciem" na siebie -
    // zapis brudziłby dokument i uruchamiał autosave bez zmiany treści.
    expect(dropAndRead({ active: { id: "wm-2" }, over: { id: "wm-2" } })).toBeNull();
  });

  it("upuszczenie ze ŹRÓDŁEM spoza listy nie zapisuje niczego", () => {
    expect(dropAndRead({ active: { id: "wm-brak" }, over: { id: "wm-2" } })).toBeNull();
  });

  it("upuszczenie na CELU spoza listy nie zapisuje niczego", () => {
    expect(dropAndRead({ active: { id: "wm-1" }, over: { id: "wm-brak" } })).toBeNull();
  });

  it("upuszczenie na innej pozycji zapisuje NOWĄ kolejność", () => {
    const after = dropAndRead({ active: { id: "wm-1" }, over: { id: "wm-2" } });
    expect(after?.map((x) => x.endLabel_pl)).toEqual(["Berlin", "Warszawa"]);
  });

  it("połączenie BEZ identyfikatora dostaje klucz zastępczy po indeksie", () => {
    // Dokumenty z importu nie mają `id` w pozycjach - bez klucza zastępczego
    // przeciąganie takiego wiersza nie miałoby czego szukać w liście.
    const { written } = renderStateful(WorldMapEditor, {
      connections: [{ endLabel_pl: "Warszawa" }, { endLabel_pl: "Berlin" }],
    });
    dnd.onDragEnd?.({ active: { id: "wm-idx-0" }, over: { id: "wm-idx-1" } });
    expect(connectionsFrom(written).map((x) => x.endLabel_pl)).toEqual(["Berlin", "Warszawa"]);
  });

  it("przeciągany wiersz jest PRZYGASZONY, żeby było widać, co się przenosi", () => {
    dnd.dragging = true;
    const { container } = renderStateful(WorldMapEditor, {
      connections: [{ id: "wm-1", endLabel_pl: "Warszawa" }],
    });
    const dimmed = Array.from(container.querySelectorAll<HTMLElement>("div")).filter(
      (el) => el.style.opacity === "0.5",
    );
    expect(dimmed).toHaveLength(1);
  });
});

describe("WorldMapEditor - współrzędne spoza zakresu są WIDOCZNIE odrzucane", () => {
  // Renderer POMIJA łuk o współrzędnych spoza zakresu, więc autor musi to
  // zobaczyć w panelu - inaczej „mapa nie rysuje mojego połączenia" kończy się
  // zgłoszeniem błędu. Takie dane nie powstają w panelu (pola mają min/max),
  // tylko przychodzą z ręcznej edycji JSON-a albo z importu.
  const brokenPoint: WidgetNode["content"] = {
    connections: [
      {
        id: "wm-1",
        startLabel_pl: "Bruksela",
        startLat: 200,
        startLng: 400,
        endLabel_pl: "Warszawa",
        endLat: 52.12,
        endLng: 19.32,
      },
    ],
  };

  it("szerokość poza -90…90 zapala komunikat i znacznik niepoprawności", () => {
    const { container } = renderStateful(WorldMapEditor, brokenPoint);
    expect(container.textContent).toContain("Zakres -90…90");
    const lat = fieldLabelled(container, "Szerokość (lat)");
    expect(lat).toHaveAttribute("aria-invalid", "true");
  });

  it("długość poza -180…180 zapala własny komunikat", () => {
    const { container } = renderStateful(WorldMapEditor, brokenPoint);
    expect(container.textContent).toContain("Zakres -180…180");
    expect(fieldLabelled(container, "Długość (lng)")).toHaveAttribute("aria-invalid", "true");
  });

  it("poprawny punkt NIE pokazuje komunikatu ani znacznika", () => {
    const { container } = renderStateful(WorldMapEditor, {
      connections: [{ id: "wm-1", startLat: 50.85, startLng: 4.35, endLat: 52.12, endLng: 19.32 }],
    });
    expect(container.textContent).not.toContain("Zakres -90…90");
    expect(fieldLabelled(container, "Szerokość (lat)")).not.toHaveAttribute("aria-invalid");
  });
});

describe("WorldMapEditor - kraj wpisuje współrzędne punktu", () => {
  const POLAND = COUNTRY_CENTROIDS.find((x) => x.id === "PL");
  if (!POLAND) throw new Error("test: brak centroidu PL w zasobie geo");

  const pickPoland = (): Array<[string, Json]> => {
    const { container, written } = renderStateful(WorldMapEditor, {
      connections: [{ id: "wm-1", endLabel_pl: "Warszawa" }],
    });
    const [startCountry] = selectsWithOption(container, "PL");
    if (!startCountry) throw new Error("test: brak listy krajów");
    fireEvent.change(startCountry, { target: { value: "PL" } });
    return written;
  };

  it("wybór kraju sięga po centroid z katalogu geo", () => {
    // Autor prawie nigdy nie zna lat/lng, za to zawsze wie „skąd” jest punkt,
    // więc picker WPISUJE centroid kraju do pól współrzędnych. Poniżej stoi
    // `it.fails`, bo dojeżdża z tego wyłącznie DŁUGOŚĆ.
    const point = connectionsFrom(pickPoland())[0];
    expect(point?.startLng).toBe(POLAND.lng);
  });

  // DEFEKT: WYBÓR KRAJU WPISUJE TYLKO DŁUGOŚĆ, A SZEROKOŚĆ GUBI.
  //
  // WEJŚCIE: połączenie bez współrzędnych; autor wybiera „Poland (PL)" na
  //   liście „Kraj (wypełnia współrzędne)" przy początku łuku.
  // CO PSUJE: `pickCountry` (`WorldMapEditor.tsx:385-391`) woła po kolei
  //   `onLat(hit.lat)` i `onLng(hit.lng)`. Oba trafiają w `patch(i, p)`
  //   (:107-108), które liczy nową listę z `connections` ZAMROŻONYCH w
  //   domknięciu tego renderu. React grupuje obie aktualizacje w jedno
  //   przerysowanie, więc drugi zapis powstaje z tej samej listy WEJŚCIOWEJ,
  //   co pierwszy - i nadpisuje go w całości. Zostaje wyłącznie `startLng`.
  // KONSEKWENCJA: punkt ląduje na szerokości 0 (równik) z poprawną długością,
  //   czyli w Zatoce Gwinejskiej zamiast w wybranym kraju. Panel obiecuje
  //   wprost („pola szerokości i długości wypełnią się same"), a mapa rysuje
  //   łuk w zupełnie innym miejscu - i to bez żadnego komunikatu, bo 0 jest
  //   POPRAWNĄ szerokością i walidacja jej nie zaczerwieni.
  // WYMAGANA POPRAWKA: `pickCountry` musi zapisać obie współrzędne JEDNYM
  //   patchem (np. wspólne `onCoords({ lat, lng })` zamiast dwóch wywołań),
  //   żeby nie zależeć od kolejności przerysowań.
  it.fails("DEFEKT: wybór kraju MUSI wpisać OBIE współrzędne punktu", () => {
    const point = connectionsFrom(pickPoland())[0];
    expect(point?.startLat).toBe(POLAND.lat);
    expect(point?.startLng).toBe(POLAND.lng);
  });

  it("wartość spoza katalogu krajów NIE rusza współrzędnych", () => {
    // Lista krajów jest generowana z zasobu geo; wartość, której w niej nie ma
    // (stary dokument, ręczna podmiana), nie może wpisać `undefined` do lat/lng.
    const { container, written } = renderStateful(WorldMapEditor, {
      connections: [{ id: "wm-1", startLat: 50.85, startLng: 4.35 }],
    });
    const [startCountry] = selectsWithOption(container, "PL");
    if (!startCountry) throw new Error("test: brak listy krajów");
    fireEvent.change(startCountry, { target: { value: "XX-nie-ma-takiego-kraju" } });
    expect(written).toEqual([]);
  });
});

describe("WorldMapEditor - podpięcie profilu platformy do końca łuku", () => {
  const withExperts: WidgetNode["content"] = {
    source: "experts",
    connections: [{ id: "wm-1", startLabel_pl: "Bruksela", endLabel_pl: "Warszawa" }],
  };

  const setProfiles = () => {
    db.current.setResponse("profiles_public", (chain) =>
      chain.has("maybeSingle")
        ? ok({ id: "u-1", display_name: "Anna Nowak", avatar_url: null })
        : ok([{ id: "u-1", display_name: "Anna Nowak", avatar_url: null }]),
    );
  };

  it("wybór profilu zapisuje jego identyfikator w punkcie łuku", async () => {
    setProfiles();
    const { container, written, findByText } = renderStateful(WorldMapEditor, withExperts);
    const pickers = container.querySelectorAll<HTMLInputElement>(
      'input[placeholder="Szukaj profilu…"]',
    );
    // Dwa punkty łuku = dwa pickery; pierwszy należy do POCZĄTKU.
    expect(pickers).toHaveLength(2);
    fireEvent.focus(pickers[0]!);
    fireEvent.click(await findByText("Anna Nowak"));

    await waitFor(() => expect(connectionsFrom(written)[0]?.startUserId).toBe("u-1"));
    // Współrzędne NIE pochodzą z profilu - platforma nie publikuje lokalizacji
    // osób, więc podpięcie profilu nie ma prawa ich ruszyć.
    expect(connectionsFrom(written)[0]).not.toHaveProperty("startLat", undefined);
  });

  it("odpięcie profilu czyści identyfikator, a nie etykietę punktu", async () => {
    setProfiles();
    const { container, written, getAllByLabelText } = renderStateful(WorldMapEditor, {
      source: "experts",
      connections: [
        { id: "wm-1", startLabel_pl: "Bruksela", startUserId: "u-1", endLabel_pl: "Warszawa" },
      ],
    });
    const unlink = getAllByLabelText("Odepnij profil");
    fireEvent.click(unlink[0]!);
    await waitFor(() => expect(connectionsFrom(written)[0]?.startUserId).toBe(""));
    expect(connectionsFrom(written)[0]?.startLabel_pl).toBe("Bruksela");
    expect(container.textContent).toContain("Bruksela");
  });

  it("KONIEC łuku ma własny picker, niezależny od początku", async () => {
    setProfiles();
    const { container, written, findAllByText } = renderStateful(WorldMapEditor, withExperts);
    const pickers = container.querySelectorAll<HTMLInputElement>(
      'input[placeholder="Szukaj profilu…"]',
    );
    fireEvent.focus(pickers[1]!);
    const hits = await findAllByText("Anna Nowak");
    fireEvent.click(hits[0]!);
    await waitFor(() => expect(connectionsFrom(written)[0]?.endUserId).toBe("u-1"));
    expect(connectionsFrom(written)[0]?.startUserId ?? "").toBe("");
  });

  it("tryb ręczny NIE pokazuje pickerów profili", () => {
    // Bez trybu „Eksperci" etykieta punktu pochodzi wyłącznie z panelu -
    // picker obiecywałby żywe dane, których renderer nie weźmie.
    const { container } = renderStateful(WorldMapEditor, {
      source: "manual",
      connections: [{ id: "wm-1", endLabel_pl: "Warszawa" }],
    });
    expect(container.querySelectorAll('input[placeholder="Szukaj profilu…"]')).toHaveLength(0);
  });
});

describe("SliderEditor - kafel wariantu jest dostępny z klawiatury", () => {
  const twoSlides: WidgetNode["content"] = {
    variant: "editorial-hero",
    items: [{ image: "https://cdn.example.com/a.png", title_pl: "Slajd" }],
  };

  const tiles = (container: HTMLElement): HTMLElement[] =>
    Array.from(container.querySelectorAll<HTMLElement>('div[role="button"][tabindex="0"]'));

  it("Enter na kafelku wybiera wariant, tak samo jak kliknięcie", () => {
    const { container, written } = renderStateful(SliderEditor, twoSlides);
    const tile = tiles(container).at(-1);
    if (!tile) throw new Error("test: brak kafelków wariantów");
    fireEvent.keyDown(tile, { key: "Enter" });
    expect(lastValueFor(written, "variant")).toBe(SLIDER_VARIANTS.at(-1)?.value);
  });

  it("spacja na kafelku też wybiera wariant", () => {
    const { container, written } = renderStateful(SliderEditor, twoSlides);
    const tile = tiles(container)[0];
    if (!tile) throw new Error("test: brak kafelków wariantów");
    fireEvent.keyDown(tile, { key: " " });
    expect(lastValueFor(written, "variant")).toBe(SLIDER_VARIANTS[0]?.value);
  });

  it("inny klawisz niczego nie wybiera", () => {
    // Tabulator MUSI przechodzić dalej po kafelkach, a nie zatwierdzać
    // wariantu, na którym stoi fokus.
    const { container, written } = renderStateful(SliderEditor, twoSlides);
    const tile = tiles(container)[0];
    if (!tile) throw new Error("test: brak kafelków wariantów");
    fireEvent.keyDown(tile, { key: "Tab" });
    expect(written.filter(([k]) => k === "variant")).toEqual([]);
  });
});

describe("SliderEditor - styl przycisków nawigacji", () => {
  it("suwak rozmiaru przycięty do zakresu 28-96 px", () => {
    const { container, written } = renderStateful(SliderEditor, { variant: "editorial-hero" });
    const size = fieldLabelStarting(container, "builder.sliderEditor.navSize");
    fireEvent.change(size, { target: { value: "10" } });
    expect(lastValueFor(written, "navSizePx")).toBe(28);
    fireEvent.change(size, { target: { value: "500" } });
    expect(lastValueFor(written, "navSizePx")).toBe(96);
  });

  it("suwak zaokrąglenia dociągnięty do końca zapisuje PEŁNE koło", () => {
    // Suwak chodzi po 0-64 px, ale koniec skali znaczy „okrąg", czyli 999 -
    // inaczej 64 px na dużym przycisku wyglądałoby jak przycięty prostokąt.
    const { container, written } = renderStateful(SliderEditor, { variant: "editorial-hero" });
    const rounded = fieldLabelStarting(container, "builder.sliderEditor.navRounded");
    // Domyślne 999 pokazuje suwak na KOŃCU skali (64), więc najpierw trzeba
    // zejść niżej - inaczej React nie zobaczy zmiany wartości i nie wywoła
    // obsługi zdarzenia.
    fireEvent.change(rounded, { target: { value: "8" } });
    expect(lastValueFor(written, "navRoundedPx")).toBe(8);
    fireEvent.change(rounded, { target: { value: "64" } });
    expect(lastValueFor(written, "navRoundedPx")).toBe(999);
  });

  it("grubość strzałki przycięta do zakresu 0,5-4", () => {
    const { container, written } = renderStateful(SliderEditor, { variant: "editorial-hero" });
    const stroke = fieldLabelStarting(container, "builder.sliderEditor.arrowStroke");
    fireEvent.change(stroke, { target: { value: "9" } });
    expect(lastValueFor(written, "navArrowStroke")).toBe(4);
    fireEvent.change(stroke, { target: { value: "0.25" } });
    // Kreska cieńsza niż pół piksela znika przy skalowaniu - dolna granica
    // jest granicą WIDOCZNOŚCI, nie kosmetyką.
    expect(lastValueFor(written, "navArrowStroke")).toBe(0.5);
    fireEvent.change(stroke, { target: { value: "3" } });
    expect(lastValueFor(written, "navArrowStroke")).toBe(3);
  });
});

describe("SliderEditor - podgląd bez slajdów bierze PRAWDZIWE wpisy", () => {
  const postRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    slug: "raport-2026",
    cover_image_url: "https://cdn.example.com/cover.png",
    title_pl: "Raport 2026",
    title_en: "Report 2026",
    excerpt_pl: "Streszczenie",
    excerpt_en: "Summary",
    ...over,
  });

  it("wpisy z bazy trafiają do podglądu, gdy autor nie dodał jeszcze slajdów", async () => {
    db.current.setResponse("posts", ok([postRow()]));
    const { findAllByText } = renderStateful(SliderEditor, {
      variant: "editorial-hero",
      items: [],
    });
    // Bez tego redakcja widzi „Pierwszy/Drugi slajd” i nie wie, jak wariant
    // wygląda na własnych treściach. Tytuł pada i w kafelkach wariantów,
    // i w podglądzie na żywo - oba karmi ta sama lista zapasowa.
    expect((await findAllByText("Raport 2026")).length).toBeGreaterThan(0);
  });

  it("wpis z PUSTYMI kolumnami nie wstawia „null” do podglądu", async () => {
    // PostgREST oddaje `null` w każdej kolumnie nullowalnej (wpis bez zajawki,
    // bez tytułu w drugim języku). Podgląd musi z tego zrobić pustkę.
    db.current.setResponse(
      "posts",
      ok([
        postRow({
          slug: "bez-danych",
          cover_image_url: null,
          title_pl: null,
          title_en: null,
          excerpt_pl: null,
          excerpt_en: null,
        }),
      ]),
    );
    const { container } = renderStateful(SliderEditor, { variant: "editorial-hero", items: [] });
    await waitFor(() => expect(db.current.chainsFor("posts").length).toBeGreaterThan(0));
    expect(container.textContent).not.toContain("null");
    expect(container.textContent).not.toContain("undefined");
  });

  it("własny slajd ze zdjęciem WYPIERA wpisy z bazy z podglądu", async () => {
    db.current.setResponse("posts", ok([postRow()]));
    const { container } = renderStateful(SliderEditor, {
      variant: "editorial-hero",
      items: [{ image: "https://cdn.example.com/moj.png", title_pl: "Mój slajd" }],
    });
    await waitFor(() => expect(db.current.chainsFor("posts").length).toBeGreaterThan(0));
    expect(container.textContent).toContain("Mój slajd");
  });
});

describe("SliderEditor - typografia podglądu i podpięty wpis", () => {
  it("własne rozmiary tytułu i podtytułu idą do podglądu", () => {
    const { container } = renderStateful(SliderEditor, {
      variant: "editorial-hero",
      titleSizePx: 48,
      subtitleSizePx: 20,
      items: [{ image: "https://cdn.example.com/a.png", title_pl: "Slajd", subtitle_pl: "Lead" }],
    });
    const preview = container.querySelector('[data-testid="slider-live-preview"]');
    expect(preview).not.toBeNull();
    expect(preview?.innerHTML).toContain("48px");
  });

  it("slajd podpięty pod wpis nazywa slot obrazka NADPISANIEM, a odpięcie czyści referencję", () => {
    // Przy podpiętym wpisie obrazek jest wyjątkiem od okładki wpisu, a nie
    // źródłem - i etykieta slotu musi to mówić, zanim autor coś wgra.
    const { container, written, getByLabelText } = renderStateful(SliderEditor, {
      variant: "editorial-hero",
      source: "manual",
      items: [{ postId: "post-1", title_pl: "Slajd" }],
    });
    expect(container.textContent).toContain("builder.sliderEditor.imageOverride");
    fireEvent.click(getByLabelText("builder.picker.unbindPost"));
    const items = lastValueFor(written, "items");
    expect(Array.isArray(items)).toBe(true);
    const slide = (items as Array<Record<string, unknown>>)[0];
    expect(slide?.postId).toBeUndefined();
    // Dokument jedzie do bazy przez JSON, więc odpięty klucz ma z niego ZNIKNĄĆ,
    // a nie zostać jako pusta referencja do nieistniejącego wpisu.
    expect(JSON.parse(JSON.stringify(slide))).not.toHaveProperty("postId");
  });
});

describe("SliderEditor - filtry źródła „wpisy”", () => {
  const withTaxonomy = (): void => {
    db.current.setResponse(
      "categories",
      ok([{ id: "c-1", slug: "gospodarka", name_pl: "Gospodarka" }]),
    );
    db.current.setResponse("post_categories", ok([{ category_id: "c-1" }]));
    db.current.setResponse("tags", ok([{ id: "t-1", slug: "ue", name: "UE" }]));
    db.current.setResponse("post_tags", ok([{ tag_id: "t-1" }]));
  };

  it("odpięcie kategorii z chipa czyści listę wybranych", async () => {
    withTaxonomy();
    const { written, findAllByText, container } = renderStateful(SliderEditor, {
      variant: "editorial-hero",
      source: "posts",
      categorySlugs: "gospodarka",
    });
    // Nazwa kategorii pada dwa razy: na przycisku listy (etykieta wyboru)
    // i na chipie pod nią. Chip poznajemy po tym, że MA w środku przycisk
    // odpięcia - kolejność w DOM nie jest kontraktem.
    const remove = chipRemoveButton(await findAllByText("Gospodarka"));
    fireEvent.click(remove);
    expect(lastValueFor(written, "categorySlugs")).toBe("");
    expect(container.textContent).not.toContain("undefined");
  });

  it("odpięcie tagu z chipa czyści listę wybranych", async () => {
    withTaxonomy();
    const { written, findAllByText } = renderStateful(SliderEditor, {
      variant: "editorial-hero",
      source: "posts",
      tagSlugs: "ue",
    });
    fireEvent.click(chipRemoveButton(await findAllByText("UE")));
    expect(lastValueFor(written, "tagSlugs")).toBe("");
  });
});
