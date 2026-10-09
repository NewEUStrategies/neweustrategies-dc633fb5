// CONTENT-VISIBILITY SEKCJI (P3.3, fala 3).
//
// CO TU MA DOWÓD (zachowanie widoczne dla przeglądarki - HTML serwera i DOM po
// hydratacji, bez zaglądania w kod):
// * renderer treści z HTML-em serwera (`stream` + `lcpOwner`) owija ciągły ogon
//   sekcji od indeksu 2 W DOKUMENCIE w opakowania z inline `content-visibility:
//   auto` + `contain-intrinsic-size: auto <szacunek>px` (`data-cv`, szacunek
//   z `estimateSectionHeight`); sekcje 0-1, sekcje przed ostatnią sekcją bez cv
//   i ogon krótszy niż dwa wysokie ekrany zostają bez opakowania; blok cv
//   (reguły druku i wyłącznika + skrypt strażnika) jest jeden;
// * strażnik wejścia w połowie strony: wpis przywracania przewinięcia TanStacka
//   albo fragment w adresie ustawia `html[data-cv-off]`, pierwsze wejście nie;
// * hydratacja: te same opakowania i blok cv bez rozjazdu, także w wyspach
//   sekcji; klient NIE liczy planu, tylko czyta go z HTML-u serwera (kontrola:
//   HTML z inną liczbą hydratuje bez rozjazdu i ją zachowuje);
// * render czysto kliencki (nawigacja SPA, nowy dokument w tej samej instancji,
//   sekcja odsłonięta po hydratacji) - bez cv;
// * wyłączenia renderera (powłoka, popup, kanwa, podgląd, treść wpisu,
//   dokument ze spisem treści) i sekcji (typ widgetu spoza listy, kotwica
//   autora, `fixed`/`sticky` w klasie albo CSS, klasa autora sekcji, cień,
//   marginesy, rozciągnięcie, tło `attachment: fixed`, widget globalny,
//   kandydat LCP).
// Geometrię (pierwsza klatka, CLS przy przewijaniu, kotwice, powroty, druk)
// mierzy prawdziwa przeglądarka: `e2e/content-visibility.boot-home.spec.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { act, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { storageKey as scrollRestorationStorageKey } from "@tanstack/router-core";
import "@/test/i18nReal";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { BuilderModeProvider } from "@/lib/content-model/editorCanvas";
import { CurrentPostProvider } from "@/lib/content-model/postContext";
import { __resetBuilderDebugForTests } from "@/lib/builder/builderDebug";
import type { SectionNode } from "@/lib/builder/types";
import { BuilderRenderer } from "../BuilderRenderer";
import {
  column,
  doc,
  innerSection,
  section,
  simpleSection,
  stubObservers,
  widget,
} from "./builderRendererFixtures";

vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

// `isServer` z router-core rozstrzyga gałąź serwera (liczy rezerwę) i klienta
// (czyta ją z DOM-u). Pod vitestem moduł daje `undefined`; atrapa podaje `false`
// (klient), a `ssr()` przełącza na serwer na czas `renderToString`.
const env = vi.hoisted(() => ({ server: false as boolean | undefined }));
vi.mock("@tanstack/router-core/isServer", () => ({
  get isServer() {
    return env.server;
  },
}));

// SESJA CZYTELNIKA (jak w `builderRenderer.streaming.test.tsx`): domyślnie gość
// (prawdziwy `useAuth`); `auth.set()` po hydratacji przerysowuje konsumentów - jak
// rozstrzygnięcie sesji w produkcji.
const auth = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const store = {
    session: null as { user: { id: string } } | null,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    snapshot: () => store.session,
    set(session: { user: { id: string } } | null) {
      store.session = session;
      for (const listener of listeners) listener();
    },
  };
  return store;
});
vi.mock("@/hooks/useAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useAuth")>();
  const { useSyncExternalStore } = await import("react");
  return {
    ...actual,
    useAuth: () => {
      const base = actual.useAuth();
      const session = useSyncExternalStore(auth.subscribe, auth.snapshot, auth.snapshot);
      return session ? { ...base, session, user: session.user, loading: false } : base;
    },
  };
});

const nowyKlient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

function ssr(ui: ReactElement): string {
  env.server = true;
  try {
    return renderToString(<QueryClientProvider client={nowyKlient()}>{ui}</QueryClientProvider>);
  } finally {
    env.server = false;
  }
}

function ssrDom(ui: ReactElement): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = ssr(ui);
  return host;
}

/** Opakowania z `content-visibility` - identyfikatory sekcji w środku, w kolejności dokumentu. */
const cvIds = (root: ParentNode) =>
  [...root.querySelectorAll<HTMLElement>("[data-cv]")]
    .filter((el) => /content-visibility:\s*auto/.test(el.getAttribute("style") ?? ""))
    .map((el) => el.querySelector("[data-sec-id]")?.getAttribute("data-sec-id"));

const sekcja = (root: ParentNode, id: string) =>
  root.querySelector<HTMLElement>(`[data-sec-id="${id}"]`);

/** Opakowanie cv sekcji (najbliższy przodek z `data-cv`) albo `null`. */
const opakowanie = (root: ParentNode, id: string) =>
  sekcja(root, id)?.parentElement?.closest<HTMLElement>("[data-cv]") ?? null;

/** Deklaracje cv w stylu inline opakowania (dokładnie to, co dostaje przeglądarka). */
const cvStyle = (el: HTMLElement | null) =>
  (el?.getAttribute("style") ?? "").match(
    /content-visibility:\s*auto;\s*contain-intrinsic-size:\s*auto \d+px/,
  )?.[0];

/** Blok cv renderera: `<style>` z regułami i `<script>` strażnika. */
const blokCv = (root: ParentNode) => ({
  style: [...root.querySelectorAll("style")].filter((el) =>
    el.textContent?.includes("content-visibility:visible"),
  ),
  script: [...root.querySelectorAll("script")].filter((el) =>
    el.textContent?.includes("data-cv-off"),
  ),
});

/** Sekcja z wysokością autora 900 px - szacunek 948 px (900 + 48 px oddechu sekcji). */
const wysoka = (id: string, extra: Partial<SectionNode> = {}) =>
  simpleSection(id, { layout: { height: "fixed", heightValue: 900 }, ...extra });

/** Strona: dwie zwykłe sekcje nad zgięciem i wysokie dalej (ogon >= 2600 px szacunku). */
const strona = (n = 5) =>
  doc(Array.from({ length: n }, (_, i) => (i < 2 ? simpleSection(`s${i}`) : wysoka(`s${i}`))));

/** Renderer treści strony: strumieniowany właściciel kandydata LCP (strona główna, strony CMS). */
const tresc = (document_ = strona()) => (
  <BuilderRenderer doc={document_} lang="pl" stream lcpOwner />
);

interface Hydrated {
  readonly host: HTMLElement;
  readonly recoverable: unknown[];
  readonly mismatches: string[];
  readonly rerender: (ui: ReactElement) => Promise<void>;
}

const hydratedRoots: Array<{ root: Root; host: HTMLElement }> = [];

async function unmountHydrated() {
  for (const { root, host } of hydratedRoots.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
}

/** HTML serwera w DOM-ie, potem `hydrateRoot` (`isServer` = fałsz), jak pierwsza wizyta. */
async function hydrated(
  ui: ReactElement,
  przedHydratacja?: (host: HTMLElement) => void,
): Promise<Hydrated> {
  await unmountHydrated();
  const host = document.createElement("div");
  host.innerHTML = ssr(ui);
  document.body.append(host);
  przedHydratacja?.(host);
  const recoverable: unknown[] = [];
  const mismatches: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    const text = args.map(String).join(" ");
    if (/hydrat|didn't match/i.test(text)) mismatches.push(text);
  });
  const client = nowyKlient();
  let root: Root;
  try {
    root = hydrateRoot(host, <QueryClientProvider client={client}>{ui}</QueryClientProvider>, {
      onRecoverableError: (error) => recoverable.push(error),
    });
    hydratedRoots.push({ root, host });
    await act(async () => {});
  } finally {
    spy.mockRestore();
  }
  const rerender = async (next: ReactElement) => {
    await act(async () =>
      root.render(<QueryClientProvider client={client}>{next}</QueryClientProvider>),
    );
  };
  return { host, recoverable, mismatches, rerender };
}

let observers: ReturnType<typeof stubObservers>;

beforeEach(() => {
  observers = stubObservers();
  __resetBuilderDebugForTests();
});

afterEach(async () => {
  await unmountHydrated();
  cleanup();
  observers.restore();
  __resetBuilderDebugForTests();
  window.localStorage.clear();
  vi.restoreAllMocks();
  auth.session = null;
});

describe("content-visibility ogona sekcji od indeksu 2 (P3.3)", () => {
  it("SSR renderera treści: ogon od trzeciej sekcji w opakowaniach z cv i rezerwą z szacunku, dwie pierwsze bez; jeden blok cv przed sekcjami", () => {
    const host = ssrDom(tresc());

    expect(cvIds(host)).toEqual(["s2", "s3", "s4"]);
    expect(cvStyle(opakowanie(host, "s2"))).toBe(
      "content-visibility:auto;contain-intrinsic-size:auto 948px",
    );
    expect(opakowanie(host, "s2")?.getAttribute("data-cv")).toBe("948");
    expect(opakowanie(host, "s2")?.getAttribute("data-cv-i")).toBe("2");
    expect(opakowanie(host, "s0")).toBeNull();
    expect(opakowanie(host, "s1")).toBeNull();
    // Sama sekcja bez cv - cv siedzi na opakowaniu (razem ze szkieletem strumienia).
    expect(sekcja(host, "s2")?.getAttribute("style")).not.toContain("content-visibility");
    const blok = blokCv(host);
    expect(blok.style).toHaveLength(1);
    expect(blok.style[0].textContent).toContain(
      "@media print{[data-cv]{content-visibility:visible!important}}",
    );
    expect(blok.style[0].textContent).toContain(
      "[data-cv-off] [data-cv]{content-visibility:visible!important}",
    );
    expect(blok.script).toHaveLength(1);
    // Blok stoi PRZED sekcjami: strażnik działa, zanim parser dojdzie do opakowań.
    expect(
      blok.script[0].compareDocumentPosition(opakowanie(host, "s2")!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  // Nasłuchy, które skrypt strażnika założył na oknie w danym teście (zdejmowane po teście,
  // żeby kolejne uruchomienia nie dublowały się w tym samym oknie happy-dom).
  const nasluchyStraznika: Array<[string, EventListener, (boolean | AddEventListenerOptions)?]> =
    [];
  const html = document.documentElement;
  /**
   * Skrypt strażnika z HTML-u serwera, wykonany tak, jak w przeglądarce przy parsowaniu
   * (`addEventListener` skryptu = okno; podstawione tylko po to, by zapamiętać nasłuchy).
   */
  const uruchomStraznika = (host: ParentNode = ssrDom(tresc())) => {
    const script = blokCv(host).script[0];
    const dodaj = (type: string, fn: EventListener, opcje?: boolean | AddEventListenerOptions) => {
      window.addEventListener(type, fn, opcje);
      nasluchyStraznika.push([type, fn, opcje]);
    };
    new Function("addEventListener", script.textContent ?? "")(dodaj);
    return html.hasAttribute("data-cv-off");
  };

  afterEach(() => {
    for (const [type, fn, opcje] of nasluchyStraznika.splice(0)) {
      window.removeEventListener(type, fn, opcje);
    }
  });

  describe("strażnik wejścia w połowie strony", () => {
    afterEach(() => {
      html.removeAttribute("data-cv-off");
      window.sessionStorage.clear();
      window.history.replaceState(null, "", "/");
    });

    it("pierwsze wejście (bez wpisu przywracania i fragmentu): cv zostaje", () => {
      expect(uruchomStraznika()).toBe(false);
    });

    it("przeładowanie w połowie strony (wpis okna TanStacka dla bieżącego klucza historii): cv wyłączone", () => {
      window.history.replaceState({ __TSR_key: "k-1" }, "", "/");
      window.sessionStorage.setItem(
        scrollRestorationStorageKey,
        JSON.stringify({ "k-1": { window: { scrollX: 0, scrollY: 2400 } } }),
      );
      expect(uruchomStraznika()).toBe(true);
    });

    it("wpis przywracania na samej górze albo innego wpisu historii: cv zostaje", () => {
      window.history.replaceState({ __TSR_key: "k-1" }, "", "/");
      window.sessionStorage.setItem(
        scrollRestorationStorageKey,
        JSON.stringify({
          "k-1": { window: { scrollX: 0, scrollY: 0 } },
          "k-2": { window: { scrollX: 0, scrollY: 2400 } },
        }),
      );
      expect(uruchomStraznika()).toBe(false);
    });

    it("adres z fragmentem (`/#kontakt`): cv wyłączone", () => {
      window.history.replaceState(null, "", "/#kontakt");
      expect(uruchomStraznika()).toBe(true);
    });

    it("uszkodzony wpis w `sessionStorage` nie rzuca i nie wyłącza cv", () => {
      window.history.replaceState({ __TSR_key: "k-1" }, "", "/");
      window.sessionStorage.setItem(scrollRestorationStorageKey, "{nie-json");
      expect(uruchomStraznika()).toBe(false);
    });

    // Fragment tekstowy (`/#:~:text=…`): Chromium wycina dyrektywę z adresu dokumentu
    // (`location.hash` pusty), zostaje ona w nazwie wpisu nawigacji tego dokumentu.
    const wpisNawigacji = (...nazwy: string[]) =>
      vi
        .spyOn(performance, "getEntriesByType")
        .mockImplementation((typ) =>
          typ === "navigation"
            ? nazwy.map((name) => ({ name, entryType: typ }) as PerformanceEntry)
            : [],
        );

    it("wejście z fragmentem tekstowym (`/#:~:text=…`, `location.hash` pusty): cv wyłączone", () => {
      window.history.replaceState(null, "", "/");
      wpisNawigacji(`${location.origin}/#:~:text=Zapisz%20si%C4%99%20do%20newslettera`);
      expect(location.hash).toBe("");
      expect(uruchomStraznika()).toBe(true);
    });

    it("fragment tekstowy przy uszkodzonym wpisie w `sessionStorage`: cv wyłączone (osobne sprawdzenie)", () => {
      window.history.replaceState({ __TSR_key: "k-1" }, "", "/");
      window.sessionStorage.setItem(scrollRestorationStorageKey, "{nie-json");
      wpisNawigacji(`${location.origin}/strona#:~:text=cel`);
      expect(uruchomStraznika()).toBe(true);
    });

    it("`:~:` poza fragmentem (zapytanie) albo zwykły wpis nawigacji: cv zostaje", () => {
      wpisNawigacji(`${location.origin}/szukaj?q=:~:text=cel`);
      expect(uruchomStraznika()).toBe(false);
    });

    it("brak wpisu nawigacji nie rzuca i nie blokuje przywrócenia przewinięcia", () => {
      wpisNawigacji();
      expect(uruchomStraznika()).toBe(false);
      window.history.replaceState({ __TSR_key: "k-1" }, "", "/");
      window.sessionStorage.setItem(
        scrollRestorationStorageKey,
        JSON.stringify({ "k-1": { window: { scrollX: 0, scrollY: 2400 } } }),
      );
      expect(uruchomStraznika()).toBe(true);
    });
  });

  // KOTWICA PO WCZYTANIU (BuilderRenderer.tsx): pierwsza nawigacja do fragmentu, którego cel
  // leży w obszarze cv, wyłącza cv ZANIM przeglądarka policzy przewinięcie. Geometrię
  // (lądowanie celu pod nagłówkiem na wolnym telefonie) mierzy e2e
  // `content-visibility.boot-home.spec.ts`; tu - które nawigacje przełączają wyłącznik.
  describe("strażnik: nawigacja do fragmentu po wczytaniu", () => {
    let stronaHtml: HTMLElement;
    let przewiniecia: string[];
    /** Wywołania `requestAnimationFrame` strażnika - test sam „maluje" klatkę (`klatka()`). */
    let klatki: FrameRequestCallback[];
    const klatka = () => {
      for (const cb of klatki.splice(0)) cb(performance.now());
    };

    /** Dokument z HTML-em serwera: cel w ogonie z cv (`s3`), cel nad ogonem (`s0`), cel za rendererem. */
    beforeEach(() => {
      stronaHtml = ssrDom(tresc());
      sekcja(stronaHtml, "s0")!.id = "gora";
      sekcja(stronaHtml, "s3")!.id = "cel";
      sekcja(stronaHtml, "s4")!.id = "zażółć";
      const stopka = document.createElement("footer");
      stopka.id = "stopka";
      stronaHtml.append(stopka);
      document.body.append(stronaHtml);
      przewiniecia = [];
      klatki = [];
      vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) {
        przewiniecia.push(this.id);
      });
      vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
        klatki.push(cb);
        return klatki.length;
      });
      expect(uruchomStraznika(stronaHtml)).toBe(false);
    });

    afterEach(() => {
      stronaHtml.remove();
      html.removeAttribute("data-cv-off");
      window.history.replaceState(null, "", "/");
    });

    /**
     * Klik w link (jak przeglądarka: zdarzenie przed domyślną akcją). Zwraca stan wyłącznika
     * w chwili, gdy klik dociera do samego linku - czyli przed nawigacją i przewinięciem.
     * Ten sam nasłuch anuluje domyślną akcję (happy-dom nie nawiguje ani nie otwiera okna).
     */
    const kliknij = (href: string, init: MouseEventInit = {}, target?: string) => {
      const a = document.createElement("a");
      a.href = href;
      if (target) a.target = target;
      a.append(document.createElement("span"));
      stronaHtml.append(a);
      let wChwiliKliku: boolean | null = null;
      a.addEventListener("click", (event) => {
        wChwiliKliku = html.hasAttribute("data-cv-off");
        event.preventDefault();
      });
      a.firstElementChild!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, ...init }),
      );
      a.remove();
      return wChwiliKliku;
    };

    it("klik w link `#id` do celu w ogonie z cv wyłącza cv, zanim klik dotrze do linku (przed przewinięciem)", () => {
      expect(kliknij("#cel")).toBe(true);
      klatka();
      expect(przewiniecia).toEqual([]);
    });

    it("klik w link do celu za obszarem cv (stopka) i w link z adresem tej samej strony (`/#id`, link routera) też", () => {
      expect(kliknij("#stopka")).toBe(true);
      html.removeAttribute("data-cv-off");
      expect(kliknij(`${location.pathname}#cel`)).toBe(true);
    });

    it("identyfikator z kodowaniem procentowym w `href` trafia w cel", () => {
      expect(kliknij(`#${encodeURIComponent("zażółć")}`)).toBe(true);
    });

    it.each<[string, string, MouseEventInit, string?]>([
      ["cel nad ogonem z cv (link „przejdź do treści”)", "#gora", {}],
      ["fragment bez elementu", "#nie-ma-takiego", {}],
      ["pusty fragment (`#`)", "#", {}],
      ["fragment innego dokumentu", "/inna-strona#cel", {}],
      ["klik z modyfikatorem (nowa karta)", "#cel", { ctrlKey: true }],
      ["link z `target=_blank`", "#cel", {}, "_blank"],
    ])("cv zostaje: %s", (_, href, init, target) => {
      expect(kliknij(href, init, target)).toBe(false);
      expect(html.hasAttribute("data-cv-off")).toBe(false);
    });

    /** Położenie celu w widoku w chwili zdarzenia (przy włączonym cv - na pasach z szacunku). */
    const celNa = (id: string, top: number) =>
      vi
        .spyOn(document.getElementById(id)!, "getBoundingClientRect")
        .mockReturnValue(new DOMRect(0, top, 300, 120));

    it("`popstate` PRZED przewinięciem (Chromium: cel jeszcze daleko pod widokiem) wyłącza cv i niczego nie przewija - przewija przeglądarka", () => {
      celNa("cel", 4000);
      window.history.replaceState(null, "", "/#cel");
      window.dispatchEvent(new PopStateEvent("popstate"));
      expect(html.hasAttribute("data-cv-off")).toBe(true);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      klatka();
      expect(przewiniecia).toEqual([]);
    });

    it("`popstate` PO przewinięciu na pasach (WebKit: cel już w widoku) wyłącza cv i przewija cel w najbliższej klatce - już po nasłuchu `popstate` routera", () => {
      celNa("cel", 244);
      // Nasłuch routera (TanStack zapisuje w nim pozycję wpisu, z którego się wychodzi)
      // stoi za strażnikiem: w tej chwili nic jeszcze nie może być przewinięte.
      let przewinieciaWNasluchuRoutera: string[] | null = null;
      const router = () => (przewinieciaWNasluchuRoutera = [...przewiniecia]);
      window.addEventListener("popstate", router);
      window.history.replaceState(null, "", "/#cel");
      window.dispatchEvent(new PopStateEvent("popstate"));
      window.removeEventListener("popstate", router);
      expect(html.hasAttribute("data-cv-off")).toBe(true);
      expect(przewinieciaWNasluchuRoutera).toEqual([]);
      klatka();
      expect(przewiniecia).toEqual(["cel"]);
      // `hashchange` tej samej nawigacji niczego nie powtarza (użytkownik mógł już przewijać).
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      klatka();
      expect(przewiniecia).toEqual(["cel"]);
    });

    it("`popstate` bez fragmentu albo z celem nad ogonem: cv zostaje", () => {
      window.history.replaceState(null, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
      window.history.replaceState(null, "", "/#gora");
      window.dispatchEvent(new PopStateEvent("popstate"));
      klatka();
      expect(html.hasAttribute("data-cv-off")).toBe(false);
      expect(przewiniecia).toEqual([]);
    });

    it("`hashchange` przy włączonym cv (silnik bez `popstate` przy fragmencie, cel już w widoku): wyłącza cv i przewija do celu w najbliższej klatce", () => {
      celNa("cel", 244);
      window.history.replaceState(null, "", "/#cel");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      expect(html.hasAttribute("data-cv-off")).toBe(true);
      klatka();
      expect(przewiniecia).toEqual(["cel"]);
    });

    it("cv wyłączone wcześniej (klik albo poprzednia nawigacja): `popstate` i `hashchange` niczego nie przewijają", () => {
      expect(kliknij("#cel")).toBe(true);
      celNa("cel", 244);
      for (const hash of ["#cel", "#stopka"]) {
        window.history.replaceState(null, "", `/${hash}`);
        window.dispatchEvent(new PopStateEvent("popstate"));
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      }
      klatka();
      expect(przewiniecia).toEqual([]);
    });

    it("dokument bez opakowań cv (render kliencki po nawigacji SPA): nawigacje niczego nie przełączają", () => {
      for (const w of stronaHtml.querySelectorAll("[data-cv]")) w.remove();
      const cel = document.createElement("div");
      cel.id = "cel-spa";
      stronaHtml.append(cel);
      expect(kliknij("#cel-spa")).toBe(false);
      window.history.replaceState(null, "", "/#cel-spa");
      window.dispatchEvent(new PopStateEvent("popstate"));
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      klatka();
      expect(html.hasAttribute("data-cv-off")).toBe(false);
      expect(przewiniecia).toEqual([]);
    });
  });

  it("rezerwa idzie z konfiguracji sekcji (szacunek szkieletu strumienia)", () => {
    const host = ssrDom(
      tresc(
        doc([
          simpleSection("s0"),
          simpleSection("s1"),
          simpleSection("s2", { layout: { height: "fixed", heightValue: 2000 } }),
          wysoka("s3"),
          wysoka("s4"),
        ]),
      ),
    );

    // 2000 px autora + 48 px oddechu sekcji przycięte do górnej granicy szacunku (1200 px).
    expect(cvStyle(opakowanie(host, "s2"))).toBe(
      "content-visibility:auto;contain-intrinsic-size:auto 1200px",
    );
    // Styl układu sekcji zostaje nietknięty.
    expect(sekcja(host, "s2")?.getAttribute("style")).toContain("height:2000px");
  });

  it("ogon krótszy niż dwa wysokie ekrany (suma szacunków < 2600 px) zostaje bez cv i bez bloku", () => {
    const host = ssrDom(tresc(doc(Array.from({ length: 6 }, (_, i) => simpleSection(`s${i}`)))));

    expect(sekcja(host, "s5")).not.toBeNull();
    expect(cvIds(host)).toEqual([]);
    expect(blokCv(host)).toEqual({ style: [], script: [] });
  });

  it("cv dostaje tylko ciągły ogon: sekcja bez cv w środku zamyka ogon (nic bez cv nie stoi za sekcją z cv)", () => {
    const zKotwica = wysoka("s3", { advanced: { htmlId: "kontakt" } });
    const host = ssrDom(
      tresc(
        doc([
          simpleSection("s0"),
          simpleSection("s1"),
          wysoka("s2"),
          zKotwica,
          wysoka("s4"),
          wysoka("s5"),
          wysoka("s6"),
        ]),
      ),
    );

    expect(cvIds(host)).toEqual(["s4", "s5", "s6"]);
    expect(opakowanie(host, "s2")).toBeNull();
    expect(opakowanie(host, "s3")).toBeNull();
  });

  it("indeks liczy się W DOKUMENCIE, nie wśród widocznych: sekcja ukryta regułą dostępu nie przesuwa progu", () => {
    const tylkoDlaCzlonkow = simpleSection("s0", { advanced: { access: { auth: "user" } } });
    const host = ssrDom(
      tresc(doc([tylkoDlaCzlonkow, simpleSection("s1"), wysoka("s2"), wysoka("s3"), wysoka("s4")])),
    );

    expect(sekcja(host, "s0")).toBeNull();
    expect(cvIds(host)).toEqual(["s2", "s3", "s4"]);
  });

  it("hydratacja: te same opakowania i blok cv bez rozjazdu, także po uwodnieniu wysp sekcji", async () => {
    // Zapisana sesja: wyspy sekcji hydratują od razu (bez kolejki widoczności).
    window.localStorage.setItem("sb-placeholder-auth-token", '{"access_token":"t"}');
    const view = await hydrated(tresc());

    expect(view.recoverable).toEqual([]);
    expect(view.mismatches).toEqual([]);
    expect(
      view.host.querySelector('[data-island-id="sec-s3"]')?.getAttribute("data-island-state"),
    ).toBe("hydrated");
    expect(cvIds(view.host)).toEqual(["s2", "s3", "s4"]);
    expect(cvStyle(opakowanie(view.host, "s3"))).toBe(
      "content-visibility:auto;contain-intrinsic-size:auto 948px",
    );
    const blok = blokCv(view.host);
    expect(blok.style).toHaveLength(1);
    expect(blok.script).toHaveLength(1);
    expect(blok.script[0].textContent).toContain(scrollRestorationStorageKey);

    // Kolejny render tej samej instancji (np. korekta urządzenia) nie zdejmuje cv ani
    // treści bloku (klient renderuje go z pustym `__html`, którego React nie przepisuje).
    await view.rerender(tresc());
    expect(cvIds(view.host)).toEqual(["s2", "s3", "s4"]);
    expect(blokCv(view.host).style).toHaveLength(1);
    expect(blokCv(view.host).script[0]?.textContent).toContain(scrollRestorationStorageKey);
  });

  it("hydratacja czyta plan z HTML-u serwera zamiast liczyć go od nowa", async () => {
    window.localStorage.setItem("sb-placeholder-auth-token", '{"access_token":"t"}');
    const view = await hydrated(tresc(), (host) => {
      // Inna liczba niż szacunek klienta: liczący klient zgłosiłby rozjazd stylu.
      const s3 = opakowanie(host, "s3")!;
      s3.setAttribute("data-cv", "999");
      s3.setAttribute(
        "style",
        (s3.getAttribute("style") ?? "").replace("auto 948px", "auto 999px"),
      );
    });

    expect(view.recoverable).toEqual([]);
    expect(view.mismatches).toEqual([]);
    expect(cvStyle(opakowanie(view.host, "s3"))).toBe(
      "content-visibility:auto;contain-intrinsic-size:auto 999px",
    );
    await view.rerender(tresc());
    expect(opakowanie(view.host, "s3")?.getAttribute("data-cv")).toBe("999");
    expect(cvStyle(opakowanie(view.host, "s3"))).toContain("auto 999px");
  });

  it("sekcja odsłonięta po hydratacji (sesja) renderuje się po stronie klienta - bez opakowania cv", async () => {
    const tylkoZalogowani = wysoka("s5", { advanced: { access: { auth: "user" } } });
    const view = await hydrated(tresc(doc([...strona().sections, tylkoZalogowani])));
    expect(sekcja(view.host, "s5")).toBeNull();

    await act(async () => auth.set({ user: { id: "u-1" } }));

    expect(sekcja(view.host, "s5")).not.toBeNull();
    expect(opakowanie(view.host, "s5")).toBeNull();
    expect(cvIds(view.host)).toEqual(["s2", "s3", "s4"]);
  });

  it("render czysto kliencki (nawigacja SPA): bez cv i bez bloku cv - przywrócenie przewinięcia liczy na prawdziwym układzie", () => {
    const { container } = renderWithQueryClient(tresc());

    expect(container.querySelectorAll("[data-sec-id]")).toHaveLength(5);
    expect(cvIds(container)).toEqual([]);
    expect(container.querySelector("[data-cv]")).toBeNull();
    expect(blokCv(container)).toEqual({ style: [], script: [] });
  });

  it("ta sama instancja z nowym dokumentem (trasa `$`, /a -> /b): sekcje nowego dokumentu bez cv", async () => {
    const view = await hydrated(tresc());
    expect(cvIds(view.host)).toEqual(["s2", "s3", "s4"]);

    const inny = doc(Array.from({ length: 4 }, (_, i) => wysoka(`b${i}`)));
    await view.rerender(tresc(inny));

    expect(view.host.querySelectorAll("[data-sec-id]")).toHaveLength(4);
    expect(view.host.querySelector("[data-cv]")).toBeNull();
  });

  const toc = (id: string) =>
    section(id, [column(`${id}-c`, [widget(`${id}-toc`, "toc", { content: {} })])]);

  it.each([
    [
      "renderer bez `lcpOwner` (strona wpisu z okładką nad treścią)",
      <BuilderRenderer doc={strona()} lang="pl" stream />,
    ],
    [
      "renderer bez `stream` (nagłówek, stopka, popup)",
      <BuilderRenderer doc={strona()} lang="pl" lcpOwner />,
    ],
    ["powłoka (`chrome`)", <BuilderRenderer doc={strona()} lang="pl" chrome />],
    [
      "podgląd edytora (`editorPreview`)",
      <BuilderRenderer doc={strona()} lang="pl" stream lcpOwner editorPreview />,
    ],
    ["kanwa buildera", <BuilderModeProvider mode="light">{tresc()}</BuilderModeProvider>],
    [
      "treść wpisu (spis treści i skrypty `.article-body` czytają geometrię nagłówków)",
      <CurrentPostProvider value={{ kind: "post", id: "p-1" }}>{tresc()}</CurrentPostProvider>,
    ],
    [
      "dokument ze spisem treści (AGENTS.md: aktywność spisu z geometrii nagłówków)",
      tresc(doc([toc("s9"), ...strona().sections])),
    ],
  ] as const)("bez cv w całym rendererze: %s", (_, ui) => {
    const host = ssrDom(ui);

    expect(host.querySelectorAll("[data-sec-id]").length).toBeGreaterThanOrEqual(5);
    expect(host.querySelector("[data-cv]")).toBeNull();
    expect(blokCv(host)).toEqual({ style: [], script: [] });
  });

  it("strona CMS (kontekst `page`) dostaje cv jak strona główna", () => {
    const host = ssrDom(
      <CurrentPostProvider value={{ kind: "page", id: "pg-1" }}>{tresc()}</CurrentPostProvider>,
    );
    expect(cvIds(host)).toEqual(["s2", "s3", "s4"]);
  });

  const naglowek = (id: string, extra = {}) => widget(id, "heading", extra);
  const wysokaZ = (
    id: string,
    children: SectionNode["children"],
    extra: Partial<SectionNode> = {},
  ) => section(id, children, { layout: { height: "fixed", heightValue: 900 }, ...extra });

  it.each<[string, SectionNode]>([
    [
      "widget spoza listy bezpiecznych (wideo)",
      wysokaZ("x", [column("x-c", [naglowek("x-h"), widget("x-v", "video", { content: {} })])]),
    ],
    [
      "widget wyszukiwarki (treść wylewa się poza sekcję)",
      wysokaZ("x", [column("x-c", [widget("x-s", "search-button", { content: {} })])]),
    ],
    ["kotwica autora na sekcji", wysoka("x", { advanced: { htmlId: "kontakt" } })],
    [
      "kotwica autora na kolumnie",
      wysokaZ("x", [column("x-c", [naglowek("x-h")], { advanced: { htmlId: "program" } })]),
    ],
    [
      "kotwica autora na widgecie",
      wysokaZ("x", [column("x-c", [naglowek("x-h", { advanced: { htmlId: "cel" } })])]),
    ],
    [
      "kotwica autora na sekcji wewnętrznej",
      wysokaZ("x", [
        innerSection("x-i", [column("x-ic", [naglowek("x-h")])], {
          advanced: { htmlId: "wewnatrz" },
        }),
      ]),
    ],
    ["klasa autora `sticky` na sekcji", wysoka("x", { advanced: { cssClass: "sticky top-0" } })],
    [
      "dowolna klasa autora na sekcji (np. ujemny margines)",
      wysoka("x", { advanced: { cssClass: "-mt-12" } }),
    ],
    [
      "CSS autora z `position: fixed` na widgecie",
      wysokaZ("x", [
        column("x-c", [naglowek("x-h", { advanced: { customCss: "selector{position:fixed}" } })]),
      ]),
    ],
    [
      "tło sekcji `attachment: fixed`",
      wysoka("x", { background: { type: "classic", attachment: "fixed" } }),
    ],
    [
      "cień sekcji (malowany poza jej pudełkiem)",
      wysoka("x", { border: { boxShadow: "0 10px 30px rgba(0,0,0,.2)" } }),
    ],
    [
      "pionowy margines sekcji (zlewa się z sąsiadem)",
      wysoka("x", { layout: { height: "fixed", heightValue: 900, marginTop: 24 } }),
    ],
    [
      "sekcja rozciągnięta na 100vw",
      wysoka("x", { layout: { height: "fixed", heightValue: 900, stretch: true } }),
    ],
    [
      "widget globalny (treść z innego rekordu)",
      wysokaZ("x", [column("x-c", [naglowek("x-h", { globalId: "g-1" })])]),
    ],
  ])("sekcja bez cv: %s (zamyka ogon - cv mają tylko sekcje za nią)", (_, wykluczona) => {
    const host = ssrDom(
      tresc(
        doc([
          simpleSection("s0"),
          simpleSection("s1"),
          wykluczona,
          wysoka("s3"),
          wysoka("s4"),
          wysoka("s5"),
        ]),
      ),
    );

    expect(sekcja(host, "x")).not.toBeNull();
    expect(opakowanie(host, "x")).toBeNull();
    expect(cvIds(host)).toEqual(["s3", "s4", "s5"]);
  });

  it("sekcja z kandydatem LCP zostaje bez cv", () => {
    const zObrazem = section("s2", [
      column("s2-c", [
        widget("s2-img", "image", {
          content: { src: "https://example.org/obraz.png", alt_pl: "Obraz" },
        }),
      ]),
    ]);
    const host = ssrDom(
      tresc(
        doc([
          simpleSection("s0"),
          simpleSection("s1"),
          zObrazem,
          wysoka("s3"),
          wysoka("s4"),
          wysoka("s5"),
        ]),
      ),
    );

    expect(sekcja(host, "s2")?.querySelector("img[data-lcp-candidate]")).not.toBeNull();
    expect(opakowanie(host, "s2")).toBeNull();
    expect(cvIds(host)).toEqual(["s3", "s4", "s5"]);
  });

  it("obraz poza kandydatem LCP nie wyklucza sekcji", () => {
    const obraz = (id: string, extra: Partial<SectionNode> = {}) =>
      section(
        id,
        [
          column(`${id}-c`, [
            widget(`${id}-img`, "image", {
              content: { src: `https://example.org/${id}.png`, alt_pl: id },
            }),
          ]),
        ],
        extra,
      );
    const host = ssrDom(
      tresc(
        doc([
          obraz("s0"),
          simpleSection("s1"),
          obraz("s2", { layout: { height: "fixed", heightValue: 900 } }),
          wysoka("s3"),
          wysoka("s4"),
        ]),
      ),
    );

    expect(sekcja(host, "s0")?.querySelector("img[data-lcp-candidate]")).not.toBeNull();
    expect(sekcja(host, "s2")?.querySelector("img[data-lcp-candidate]")).toBeNull();
    expect(cvIds(host)).toEqual(["s2", "s3", "s4"]);
  });
});
