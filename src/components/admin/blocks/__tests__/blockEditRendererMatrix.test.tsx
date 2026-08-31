// DYSPOZYTOR EDYTOROW (`BlockEditRenderer`) - macierz PRZEJAZDU po wszystkich
// typach blokow oferowanych redaktorowi.
//
// PO CO TEN PLIK, GDY JEST JUZ `blockEditorRegistryParity.test.ts`.
// Tamten plik czyta ZRODLA i pyta: czy dla kazdego typu z rejestru istnieje
// `case`. To bramka na PODLACZENIE. Ten plik pyta o co innego i przez inne
// medium: czy edytor tego typu DA SIE ZAMONTOWAC z domyslna instancja bloku
// z rejestru (`spec.create()`) i czy nie wpada w atrape `default`.
//
// Ta roznica nie jest akademicka. `case` moze istniec, a edytor rzucac przy
// montowaniu na domyslnych danych - np. gdy czyta `block.data.items[0]` bez
// zabezpieczenia, a `create()` daje puste `items`. Wtedy redaktor, ktory
// wstawia blok z palety, dostaje BIALY EKRAN calego edytora wpisu i traci
// niezapisana prace. Ten przejazd to wyklucza dla KAZDEGO typu naraz -
// i robi to na tych samych danych, jakie realnie produkuje paleta.
//
// CO MA TU JESZCZE DOWOD
//   * `BlockWithToolbar`: piec typow z WLASNYM paskiem (`paragraph`, `heading`,
//     `image`, `video`, `audio`) NIE dostaje paska generycznego - podwojny pasek
//     zaslania tresc i duplikuje sterowanie tym samym polem,
//   * pasek generyczny pojawia sie tylko dla bloku AKTYWNEGO,
//   * typ z rejestru BEZ `case` w dyspozytorze renderuje widoczna atrape
//     `[typ]` (a nie pusty obszar, po ktorym redaktor nie wie, ze cos jest nie
//     tak) - galaz `default` switcha. Swiadomie NIE testujemy typu spoza unii
//     `BlockType`: taki test wymagalby rzutowania poza kontrakt typow, a ta
//     sama galaz jest osiagalna prawdziwym, zarejestrowanym typem.
//
// CZEGO TU NIE MA
//   * asercji na WNETRZE poszczegolnych edytorow - kazdy z nich ma (albo
//     powinien miec) wlasny plik. Tutaj przedmiotem dowodu jest DYSPOZYTOR,
//   * atrap warstw wlasnych. Mockowane sa TYLKO granice: `sonner` (toasty)
//     i `<Link>` TanStack Routera (kontekst routera).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { BLOCK_SPECS, IMPLEMENTED_BLOCKS } from "@/lib/blocks/registry";
import type { Block, BlockType } from "@/lib/blocks/types";
import { BlockEditRenderer, BlockWithToolbar } from "../BlockEditRenderer";
import { realT } from "@/test/i18nReal";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// `<Link>` TanStack Routera czyta kontekst routera i rzuca bez `RouterProvider`
// (edytor `liveblog` linkuje do panelu moderacji). Wspolna atrapa z repo
// zamienia go na prawdziwy `<a href>` - granica frameworka, nie warstwa
// aplikacji. Bez tego edytor probowal siegnac po router i po siec.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

// Klient Supabase - granica danych. Edytor `poll` czyta liste ankiet, wiec bez
// atrapy przejazd probowal wyjsc w siec. Uzywamy wspolnego lancucha PostgREST
// z repo (`@/test/supabaseChain`), a nie wlasnej atrapy.
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, ok } = await import("@/test/supabaseChain");
  const stub = supabaseFromStub();
  stub.setResponse("polls", ok([]));
  return { supabase: stub };
});

// `fetch` - granica przegladarki. Edytor `data-map` dociaga statyczna geometrie
// z `public/geo/*.json`; w tescie ma NIE wychodzic w siec, a odpowiedziec pusta,
// poprawna geometria. Bez tego przejazd zglaszal ECONNREFUSED po zakonczeniu
// testu (nieobsluzone odrzucenie), czyli test dotykal sieci.
const prawdziwyFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ features: [] }),
    })) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = prawdziwyFetch;
});

const t = realT("pl");

const NIC = () => undefined;
const FALSZ = () => false;

// Kilka edytorow (`liveblog`, `poll`, `author-bio`, `data-map`) czyta dane
// przez `useQuery`, wiec caly przejazd idzie przez wspolny harness react-query
// z repo. Bez niego montowaly sie z bledem „No QueryClient set" - i to jest
// realny wymog tych edytorow, nie ustepstwo testu.
function zamontuj(block: Block, isActive = false) {
  const onChange = vi.fn<(n: Block) => void>();
  const view = renderWithQueryClient(
    <BlockEditRenderer
      block={block}
      isActive={isActive}
      onChange={onChange}
      onTransform={NIC}
      onInsertAfter={NIC}
      onDeleteEmpty={NIC}
      onMergeWithPrevious={FALSZ}
      onFocusPrevious={FALSZ}
      onFocusNext={FALSZ}
      onSelectAllBlocks={NIC}
      onExtendBlockSelection={FALSZ}
    />,
  );
  return { onChange, view };
}

// Typy realnie oferowane redaktorowi w palecie - dokladnie ta lista, ktora
// filtruje `searchBlockSpecs`, wiec macierz nie moze sie rozjechac z UI.
//
// `link-preview` jest z przejazdu WYLACZONY SWIADOMIE: ten typ nie ma `case`
// w dyspozytorze i wpada w atrape `default`, co jest znanym, zarejestrowanym
// defektem - `blockEditorRegistryParity.test.ts` trzyma na to `it.fails` i tam
// jest jego pelny opis. Drugi `it.fails` na ten sam rozjazd byloby dublowaniem
// tej samej porazki; ponizej jest za to asercja STANU FAKTYCZNEGO, zeby bylo
// widac, co redaktor dziś dostaje.
const BEZ_EDYTORA: readonly string[] = ["link-preview"];

const OFEROWANE: readonly BlockType[] = IMPLEMENTED_BLOCKS.filter(
  (typ) => typ in BLOCK_SPECS && !BEZ_EDYTORA.includes(typ),
) as readonly BlockType[];

describe("BlockEditRenderer - macierz typow z palety", () => {
  it("lista typów do przejazdu jest niepusta i pokrywa się z rejestrem", () => {
    expect(OFEROWANE.length).toBeGreaterThan(50);
  });

  it.each(OFEROWANE)("typ %s montuje się z domyślnej instancji z rejestru", (typ) => {
    const blok = BLOCK_SPECS[typ].create();
    expect(blok.type).toBe(typ);
    const { view } = zamontuj(blok);
    // Atrapa `default` to dokładnie `[typ]` - jej obecność znaczy, że edytor
    // jest nieosiągalny z panelu.
    expect(view.container.textContent).not.toBe(`[${typ}]`);
    expect(view.container.firstChild).not.toBeNull();
  });

  it.each(OFEROWANE)("typ %s montuje się także jako AKTYWNY (pasek + edytor)", (typ) => {
    const blok = BLOCK_SPECS[typ].create();
    const { view } = zamontuj(blok, true);
    expect(view.container.textContent).not.toBe(`[${typ}]`);
  });

  it("typ z rejestru BEZ case'a w dyspozytorze pokazuje atrapę (stan faktyczny)", () => {
    // Kontrola stanu dla defektu opisanego w `blockEditorRegistryParity`:
    // dopóki brakuje podłączenia, redaktor widzi `[link-preview]` zamiast
    // gotowego edytora `edit/LinkPreviewBlock.tsx`.
    const { view } = zamontuj({ id: "lp1", type: "link-preview", data: {} } as Block);
    expect(view.container.textContent).toBe("[link-preview]");
  });
});

describe("BlockWithToolbar - kto dostaje pasek generyczny", () => {
  function zamontujObudowe(typ: string, isActive: boolean) {
    const blok = { id: "b1", type: typ, data: {} } as Block;
    return render(
      <BlockWithToolbar block={blok} isActive={isActive} onChange={NIC}>
        <div data-testid="tresc" />
      </BlockWithToolbar>,
    );
  }

  it.each(["paragraph", "heading", "image", "video", "audio"])(
    "typ %s ma WŁASNY pasek - generyczny się nie dokłada",
    (typ) => {
      zamontujObudowe(typ, true);
      expect(screen.getByTestId("tresc")).toBeInTheDocument();
      expect(document.querySelector('[data-widget-toolbar="generic"]')).toBeNull();
      // Kryterium niezależne od atrybutu: pasek generyczny niesie przycisk
      // wariantu/koloru, którego przy własnym pasku być nie może.
      expect(screen.queryByRole("button", { name: t("blocks.actions.remove") })).toBeNull();
    },
  );

  it("blok bez własnego paska dostaje pasek generyczny, gdy jest AKTYWNY", () => {
    const { container } = zamontujObudowe("callout", true);
    expect(screen.getByTestId("tresc")).toBeInTheDocument();
    // Pasek generyczny renderuje przyciski - treść sama ich nie ma.
    expect(container.querySelectorAll("button").length).toBeGreaterThan(0);
  });

  it("blok NIEaktywny nie dostaje paska generycznego", () => {
    const { container } = zamontujObudowe("callout", false);
    expect(screen.getByTestId("tresc")).toBeInTheDocument();
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});
