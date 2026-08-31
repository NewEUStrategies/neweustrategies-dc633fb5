// Wstawki reklamowe w środku artykułu: `src/components/ads/MidPostAds.tsx`.
//
// PO CO TEN PLIK ISTNIEJE. To jedyne miejsce w serwisie, które WSTRZYKUJE obce
// węzły w wyrenderowaną treść redakcyjną. Miało 6,1% pokrycia linii, a operuje
// bezpośrednio na DOM-ie artykułu: tworzy hosty, wstawia je między akapity,
// usuwa przy sprzątaniu i renderuje w nie Reacta portalem. Każdy z tych kroków
// psuje się w sposób, którego nie widać w kodzie:
//
//   * host wstawiony w złe miejsce = reklama w środku cytatu albo tabeli;
//   * host nieusunięty przy przebudowie = artykuł puchnie o kolejne kopie
//     reklamy przy każdej zmianie języka albo treści;
//   * zniesiony sufit dwóch wstawek = nieograniczona presja monetyzacyjna,
//     bo liczbę placementów ustala CMS, nie kod.
//
// ATRAPUJEMY WYŁĄCZNIE GRANICE: klienta Supabase (sieć/baza), beacon
// analityczny (sieć) i IntersectionObserver (brak silnika układu w happy-dom).
// `useAdPlacements`, `AdSlotView` i prawdziwy DOM biegną NIEATRAPOWANE.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useRef, type ReactElement } from "react";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
// Prawdziwa instancja i18next: bez niej `AdSlotView` woła `useTranslation()`
// bez instancji, sypie ostrzeżeniem i etykietuje slot GOŁYM KLUCZEM - test
// „przechodziłby" na napisie, którego użytkownik nigdy nie zobaczy.
import "@/test/i18nReal";

vi.mock("@/lib/analytics/events", () => ({
  beaconAdEvent: () => {},
  beaconPopupEvent: () => {},
}));

const stubs = vi.hoisted(() => ({ from: null as unknown }));
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  stubs.from = from;
  return {
    supabase: {
      from: from.from,
      auth: {
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      rpc: async () => ({ data: [], error: null }),
    },
  };
});

import { MidPostAds } from "@/components/ads/MidPostAds";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, type SupabaseFromStub } from "@/test/supabaseChain";
import type { AdContentContext } from "@/lib/ads/queries";
import type { AdPlacementWithSlot, AdSlot } from "@/lib/ads/types";

const from = () => stubs.from as SupabaseFromStub;
const HOST = "[data-ad-mid-host]";
const TENANT = "aaaaaaaa-0000-0000-0000-00000000000a";

/** Patrz komentarz w `footerSlideup.test.tsx` - happy-dom nie liczy układu. */
class ImmediateIntersectionObserver implements IntersectionObserver {
  readonly root: Element | null = null;
  readonly rootMargin: string = "";
  readonly thresholds: ReadonlyArray<number> = [];
  private readonly cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
  }
  observe(target: Element): void {
    this.cb([{ isIntersecting: true, target } as IntersectionObserverEntry], this);
  }
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

function slot(over: Partial<AdSlot> = {}): AdSlot {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    tenant_id: TENANT,
    name: "Kreacja śródtekstowa",
    kind: "image",
    status: "active",
    html: null,
    script: null,
    image_url: "https://cdn.example.com/srodtekst.png",
    image_link: null,
    image_alt: "Kreacja śródtekstowa",
    width: 300,
    height: 250,
    requires_consent: false,
    targeting: {},
    notes: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

let seq = 0;
function placement(over: Partial<AdPlacementWithSlot> = {}): AdPlacementWithSlot {
  seq += 1;
  return {
    id: `99999999-aaaa-bbbb-cccc-${String(seq).padStart(12, "0")}`,
    tenant_id: TENANT,
    slot_id: slot().id,
    position: "mid_post",
    page_type: "post",
    page_id: null,
    config: {},
    sort_order: 0,
    active: true,
    starts_at: null,
    ends_at: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    slot: slot(),
    ...over,
  };
}

function respondWith(rows: AdPlacementWithSlot[]): void {
  from().setResponse("ad_placements", ok(rows));
}

/** Artykuł o N akapitach - najczęstszy kształt treści w serwisie. */
function paragraphs(count: number): string {
  return Array.from({ length: count }, (_, i) => `<p>Akapit ${i + 1}</p>`).join("");
}

interface HarnessProps {
  html: string;
  scanKey?: string | number;
  content?: AdContentContext;
}

/**
 * Nośnik: `MidPostAds` nie renderuje własnej treści, tylko operuje na cudzym
 * drzewie przez ref - więc test musi dostarczyć artykuł tak, jak robi to
 * trasa `$.tsx`.
 */
function Article({ html, scanKey, content }: HarnessProps) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <>
      <div data-testid="artykul" ref={ref} dangerouslySetInnerHTML={{ __html: html }} />
      <MidPostAds
        articleRef={ref}
        pageType="post"
        pageId="post-1"
        scanKey={scanKey}
        content={content}
      />
    </>
  );
}

async function renderArticle(props: HarnessProps) {
  const view = renderWithQueryClient(<Article {...props} />);
  await waitFor(() => expect(from().chainsFor("ad_placements").length).toBeGreaterThan(0));
  return view;
}

/** `rerender` z RTL gubi opakowanie providera - dokładamy je z powrotem. */
function withClient(client: QueryClient, ui: ReactElement) {
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

function article(): HTMLElement {
  return screen.getByTestId("artykul");
}

function hosts(): HTMLElement[] {
  return Array.from(article().querySelectorAll<HTMLElement>(HOST));
}

/** Tekst akapitu, PO którym stanął host - czytelniejsze niż indeksy w asercji. */
function afterText(host: HTMLElement): string | null {
  return host.previousElementSibling?.textContent ?? null;
}

const realIntersectionObserver = globalThis.IntersectionObserver;

beforeEach(() => {
  globalThis.IntersectionObserver = ImmediateIntersectionObserver;
  from().reset();
  respondWith([]);
});

afterEach(() => {
  cleanup();
  globalThis.IntersectionObserver = realIntersectionObserver;
});

// ---------------------------------------------------------------------------
describe("wstawka po N-tym akapicie", () => {
  it("ląduje dokładnie za akapitem wskazanym w konfiguracji", async () => {
    respondWith([placement({ config: { paragraph: 3 } })]);

    await renderArticle({ html: paragraphs(6) });

    await waitFor(() => expect(hosts()).toHaveLength(1));
    expect(afterText(hosts()[0])).toBe("Akapit 3");
  });

  it("bez konfiguracji staje za czwartym akapitem", async () => {
    respondWith([placement({ config: {} })]);

    await renderArticle({ html: paragraphs(8) });

    // Wartość domyślna jest kontraktem produktowym: reklama ma trafić poniżej
    // pierwszego ekranu, ale zanim czytelnik odpadnie od tekstu.
    await waitFor(() => expect(hosts()).toHaveLength(1));
    expect(afterText(hosts()[0])).toBe("Akapit 4");
  });

  it("konfiguracja 1 stawia wstawkę zaraz za pierwszym akapitem", async () => {
    respondWith([placement({ config: { paragraph: 1 } })]);

    await renderArticle({ html: paragraphs(5) });

    await waitFor(() => expect(hosts()).toHaveLength(1));
    expect(afterText(hosts()[0])).toBe("Akapit 1");
  });

  it("konfiguracja zerowa lub ujemna nie wpycha reklamy PRZED tekst", async () => {
    respondWith([placement({ config: { paragraph: 0 } })]);

    await renderArticle({ html: paragraphs(5) });

    // Reklama przed pierwszym zdaniem artykułu to strefa `top_of_post`,
    // a nie `mid_post` - klamra na 1 pilnuje tego rozgraniczenia.
    await waitFor(() => expect(hosts()).toHaveLength(1));
    expect(afterText(hosts()[0])).toBe("Akapit 1");
  });

  it("kreacja renderuje się WEWNĄTRZ wstawionego hosta", async () => {
    respondWith([placement({ config: { paragraph: 2 } })]);

    await renderArticle({ html: paragraphs(5) });

    await waitFor(() => expect(hosts()).toHaveLength(1));
    // Portal jest jedynym powodem, dla którego ten komponent w ogóle istnieje:
    // React ma renderować W treść, nie obok niej.
    expect(hosts()[0].querySelector("[data-ad-slot]")).not.toBeNull();
    expect(await screen.findByAltText("Kreacja śródtekstowa")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe("treść krótsza niż wskazany akapit", () => {
  it("wstawka spada na OSTATNI akapit, zamiast zniknąć", async () => {
    respondWith([placement({ config: { paragraph: 9 } })]);

    await renderArticle({ html: paragraphs(3) });

    // Krótkie notatki są w serwisie normą; gdyby wstawka znikała, redakcja
    // musiałaby konfigurować placementy per długość tekstu.
    await waitFor(() => expect(hosts()).toHaveLength(1));
    expect(afterText(hosts()[0])).toBe("Akapit 3");
  });

  it("artykuł BEZ akapitów nie dostaje żadnej wstawki", async () => {
    respondWith([placement({ config: { paragraph: 2 } })]);

    await renderArticle({ html: "<h2>Sam nagłówek</h2><ul><li>punkt</li></ul>" });

    await waitFor(() => expect(from().chainsFor("ad_placements").length).toBeGreaterThan(0));
    expect(hosts()).toHaveLength(0);
  });

  it("konfiguracja NIE-liczbowa nie wywraca artykułu", async () => {
    respondWith([placement({ config: { paragraph: "co drugi" } })]);

    await renderArticle({ html: paragraphs(5) });

    // jsonb nie wymusza typu. Pominięcie wstawki jest gorszym przychodem,
    // ale lepszym artykułem niż wyjątek w trakcie renderu treści.
    await waitFor(() => expect(from().chainsFor("ad_placements").length).toBeGreaterThan(0));
    expect(hosts()).toHaveLength(0);
    expect(article().querySelectorAll("p")).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
describe("wiele wstawek i twardy sufit", () => {
  it("dwie kampanie trafiają w dwa różne miejsca, w kolejności czytania", async () => {
    respondWith([placement({ config: { paragraph: 2 } }), placement({ config: { paragraph: 5 } })]);

    await renderArticle({ html: paragraphs(8) });

    await waitFor(() => expect(hosts()).toHaveLength(2));
    expect(hosts().map(afterText)).toEqual(["Akapit 2", "Akapit 5"]);
  });

  it("NIGDY nie wstawia więcej niż dwóch reklam w jeden artykuł", async () => {
    respondWith([
      placement({ config: { paragraph: 2 } }),
      placement({ config: { paragraph: 4 } }),
      placement({ config: { paragraph: 6 } }),
      placement({ config: { paragraph: 8 } }),
    ]);

    await renderArticle({ html: paragraphs(12) });

    // Liczbę placementów ustala CMS bez żadnego limitu, więc TO jest jedyne
    // miejsce, w którym artykuł broni się przed ścianą reklam.
    await waitFor(() => expect(hosts()).toHaveLength(2));
    expect(hosts().map(afterText)).toEqual(["Akapit 2", "Akapit 4"]);
  });

  it("wygrywają NAJWCZEŚNIEJSZE wstawki, niezależnie od kolejności z bazy", async () => {
    respondWith([
      placement({ config: { paragraph: 9 } }),
      placement({ config: { paragraph: 3 } }),
      placement({ config: { paragraph: 6 } }),
    ]);

    await renderArticle({ html: paragraphs(12) });

    await waitFor(() => expect(hosts()).toHaveLength(2));
    expect(hosts().map(afterText)).toEqual(["Akapit 3", "Akapit 6"]);
  });

  it("dwie kampanie w krótkim tekście lądują obie za ostatnim akapitem", async () => {
    respondWith([placement({ config: { paragraph: 6 } }), placement({ config: { paragraph: 7 } })]);

    await renderArticle({ html: paragraphs(2) });

    // Utrwalony stan faktyczny klamry: przy tekście krótszym niż konfiguracja
    // obie wstawki schodzą na koniec i stoją obok siebie, ZA całą treścią.
    // To najgorszy przypadek presji monetyzacyjnej, jaki ten komponent
    // dopuszcza - i dlatego ma tu jawny zapis, a nie milczące przejście.
    await waitFor(() => expect(hosts()).toHaveLength(2));
    expect(Array.from(article().children).map((el) => el.tagName)).toEqual([
      "P",
      "P",
      "DIV",
      "DIV",
    ]);
  });
});

// ---------------------------------------------------------------------------
describe("brak kampanii i sprzątanie DOM-u", () => {
  it("bez kampanii nie dotyka treści artykułu", async () => {
    respondWith([]);

    const { container } = await renderArticle({ html: paragraphs(5) });

    expect(hosts()).toHaveLength(0);
    expect(container.querySelectorAll("p")).toHaveLength(5);
  });

  it("odmontowanie zabiera hosty ze sobą - artykuł zostaje czysty", async () => {
    respondWith([placement({ config: { paragraph: 2 } })]);
    const { unmount } = await renderArticle({ html: paragraphs(5) });
    await waitFor(() => expect(hosts()).toHaveLength(1));
    const root = article();

    unmount();

    // Osierocony host to pusta dziura w treści przy powrocie na tę samą trasę.
    expect(root.querySelectorAll(HOST)).toHaveLength(0);
  });

  it("przebudowa po zmianie treści NIE mnoży wstawek", async () => {
    respondWith([placement({ config: { paragraph: 2 } })]);
    const { rerender, queryClient } = await renderArticle({
      html: paragraphs(5),
      scanKey: "pl",
    });
    await waitFor(() => expect(hosts()).toHaveLength(1));

    rerender(withClient(queryClient, <Article html={paragraphs(5)} scanKey="en" />));

    // Zmiana języka artykułu przerysowuje treść; bez sprzątania hostów każde
    // przełączenie dokładałoby kolejną kopię tej samej reklamy.
    await waitFor(() => expect(hosts()).toHaveLength(1));
  });

  it("host niesie identyfikator placementu - da się go powiązać z kampanią", async () => {
    const p = placement({ config: { paragraph: 2 } });
    respondWith([p]);

    await renderArticle({ html: paragraphs(5) });

    await waitFor(() => expect(hosts()).toHaveLength(1));
    expect(hosts()[0].getAttribute("data-ad-mid-host")).toBe(p.id);
  });
});

// ---------------------------------------------------------------------------
describe("wstawka a struktura treści", () => {
  it("w płaskim artykule host jest bezpośrednim dzieckiem treści", async () => {
    respondWith([placement({ config: { paragraph: 2 } })]);

    await renderArticle({ html: paragraphs(5) });

    await waitFor(() => expect(hosts()).toHaveLength(1));
    expect(hosts()[0].parentElement).toBe(article());
  });

  // -------------------------------------------------------------------------
  // DEFEKT NAPRAWIONY (08.2026) - test biegnie normalnie.
  //
  // CO BYŁO ZŁE. Wybór miejsca wstawki liczył WSZYSTKIE elementy `<p>` w drzewie
  // artykułu (`root.querySelectorAll("p")`), a host wstawiał się rodzeństwem
  // trafionego akapitu (`target.parentNode.insertBefore`). Akapity zagnieżdżone -
  // w cytacie blokowym, w `<figure>`, w pozycji listy, w komórce tabeli - liczyły
  // się więc na równi z akapitami głównego toku, a reklama lądowała WEWNĄTRZ tego
  // pojemnika. Przy cytacie z dwóch akapitów wstawka rozcinała cytat na pół.
  //
  // DLACZEGO TO BYŁO RYZYKO. Po pierwsze wizualnie: host dziedziczył styl cytatu
  // (wcięcie, kursywa, lewa krecha), więc reklama wyglądała jak część cytowanego
  // źródła, a klasa `my-8` liczona na pełną szerokość kolumny przestawała pasować.
  // Po drugie - i poważniej - semantycznie: treść reklamowa znajdowała się wtedy
  // wewnątrz `<blockquote>`, czyli formalnie w obrębie cudzej wypowiedzi.
  // Dla serwisu analitycznego, który cytuje dokumenty i wypowiedzi polityków,
  // to nie była usterka kosmetyczna - to było przypisanie komuś treści reklamowej.
  // Liczenie akapitów zagnieżdżonych psuło przy okazji SAM numer wstawki: cytat
  // z trzema akapitami przesuwał „po czwartym akapicie" o trzy pozycje w górę.
  //
  // JAK NAPRAWIONE. „Akapit głównego toku" jest teraz zdefiniowany PRZEZ
  // WYKLUCZENIE: akapit należy do toku, dopóki nie siedzi w cytacie, figurze,
  // pozycji listy, komórce tabeli, ramce bocznej, `<details>` ani formularzu
  // (`NON_FLOW_CONTAINERS` w `MidPostAds.tsx`). Kanoniczne `:scope > p` zostało
  // odrzucone świadomie: zabrałoby wstawki KAŻDEMU artykułowi owiniętemu
  // dodatkowym `<div>`, a takie wychodzą z buildera bloków. Kryterium przez
  // wykluczenie zostawia dowolnie głębokie `<div>`-y i wycina dokładnie te
  // pojemniki, w których reklama znaczy coś innego, niż znaczy w toku tekstu.
  it("host NIE ląduje wewnątrz cytatu blokowego", async () => {
    respondWith([placement({ config: { paragraph: 2 } })]);

    await renderArticle({
      html:
        "<p>Akapit 1</p>" +
        "<blockquote><p>Cytat, zdanie pierwsze</p><p>Cytat, zdanie drugie</p></blockquote>" +
        "<p>Akapit 2</p>",
    });

    await waitFor(() => expect(hosts()).toHaveLength(1));
    expect(hosts()[0].closest("blockquote")).toBeNull();
    // Akapity cytatu nie liczą się też do NUMERU wstawki: „po drugim akapicie"
    // to drugi akapit głównego toku, a nie drugi `<p>` w drzewie.
    expect(afterText(hosts()[0])).toBe("Akapit 2");
  });
});
