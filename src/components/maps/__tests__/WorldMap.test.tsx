// Mapa świata z łukami połączeń - RENDER BEZPOŚREDNI komponentu.
//
// PO CO TEN PLIK ISTNIEJE. `WorldMap` był dotąd dotykany wyłącznie POŚREDNIO,
// przez `WorldMapWidgetView` (`src/components/builder/organisms/widget-view/
// __tests__/worldMapWidget.test.tsx`). Widget ma sztywny sufit: nigdy nie podaje
// `className` ani `labelClassName`, nigdy `loop={false}`, nigdy
// `showLabels={false}`, nigdy `fit="europe"`, nigdy niebezpiecznego `href`
// ani `avatar` i NIE emituje żadnego zdarzenia wskaźnika. Wszystko, co niżej,
// jest więc nieosiągalne przez tamten plik - nie dubluje go, domyka go.
//
// CO DOWODZI TEN PLIK.
//  1. CZYTNIK EKRANU DOSTAJE TE SAME DANE GEOGRAFICZNE, CO OKO. Rysunek jest
//     grafiką: bez tekstowego kanału mapa jest dla czytnika pustym prostokątem.
//     Test pilnuje, że lista `.sr-only` niesie KOMPLET połączeń - także te,
//     których etykiety wypadły z kadru albo których punkty nie mają nazwy
//     (wtedy jadą surowe współrzędne, nie „undefined").
//  2. SANITYZACJA ODSYŁACZY DZIAŁA W OBIE STRONY. `href` z `javascript:` nie
//     może zrobić z punktu linku, ale nie może też skasować znacznika -
//     KONSEKWENCJA defektu to albo XSS w publicznym widgecie, albo zniknięcie
//     punktu z mapy przy jednym złym wpisie w panelu.
//  3. KULLING ETYKIET POZA KADREM. Przy `fit="europe"` punkt w Ameryce albo na
//     Kamczatce ma pozycję procentową grubo poza płótnem; napis wyrenderowany
//     „gdzieś obok" wychodziłby na sąsiednie sekcje strony (warstwa etykiet jest
//     `absolute` nad SVG). Cztery porównania progu są tu trafione osobno.
//  4. `prefers-reduced-motion` WYGRYWA Z PROPSEM `animate`. Użytkownik, który
//     poprosił system o mniej ruchu, nie może dostać pętli animacji tylko
//     dlatego, że redakcja zaznaczyła w panelu „animuj".
//  5. `loop={false}` DAJE JEDNORAZOWE RYSOWANIE ZE SCHODKIEM. Cztery ternary
//     naraz (czas, opóźnienie, liczba powtórzeń, krzywa) - przestawienie
//     któregokolwiek zamienia „narysuj raz" w wieczną pętlę albo w skok.
//  6. NAJECHANIE NA ZNACZNIK PODŚWIETLA ZNACZNIK I JEGO ETYKIETĘ (i gaśnie po
//     zjechaniu z mapy). Łuku NIE podświetla - to defekt produkcyjny, przypięty
//     niżej jako `it.fails` z kontrolą dodatnią.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE (ma dowód w `worldMapWidget.test.tsx`):
// stanu pustego po polsku, kolorów z panelu (`lineColor`/`pointColor`/
// `dotColor`/`bgColor`), obecności/nieobecności `<style>` przy `animate`,
// nazwy `@keyframes` bez dwukropków, kadrów `world` i `auto`, bezpiecznego
// `href` prowadzącego do `/author/<slug>`, bezpiecznego `avatar` i `point.role`.
// Rachunku geometrii i klatek NIE dubluje wcale - to `src/lib/maps/__tests__/
// worldMapGeo.test.ts`; tutaj sprawdzamy WYŁĄCZNIE, co komponent z tym robi.
//
// RODO: nazwiska w etykietach są zmyślone, adresy zdjęć wskazują na example.com.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { MapArc } from "@/lib/maps/worldMapGeo";

const h = vi.hoisted(() => ({
  /** Odpowiedź systemowej preferencji ruchu - przestawialna w teście. */
  reduced: false,
}));

// Hook czyta `matchMedia` w efekcie i ma własny dowód
// (`src/hooks/__tests__`); tutaj potrzebna jest wyłącznie jego ODPOWIEDŹ,
// bo happy-dom nie ma prawdziwego `MediaQueryList`.
vi.mock("@/hooks/usePrefersReducedMotion", () => ({
  usePrefersReducedMotion: () => h.reduced,
}));

import { WorldMap } from "@/components/maps/WorldMap";
import { axeViolations, summarize } from "@/test/axe";

const BRUSSELS = { lat: 50.85, lng: 4.35 };
const WARSAW = { lat: 52.23, lng: 21.01 };
/** Punkt daleko na zachód od kadru Europy - progi `left < -5`. */
const WASHINGTON = { lat: 38.9, lng: -77.04 };
/** Punkt daleko na wschód - próg `left > 105`. */
const KAMCHATKA = { lat: 53.0, lng: 158.65 };
/** Punkt daleko na północ w tym samym pasie X - próg `top < -5`. */
const POLAR = { lat: 80.0, lng: 10.0 };
/** Punkt daleko na południe w tym samym pasie X - próg `top > 105`. */
const EQUATOR = { lat: 0.0, lng: 10.0 };

const oneArc: MapArc[] = [
  { start: { ...BRUSSELS, label: "Bruksela" }, end: { ...WARSAW, label: "Warszawa" } },
];

afterEach(() => {
  cleanup();
  h.reduced = false;
});

function root(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(".nes-world-map");
  if (!el) throw new Error("nie znaleziono płótna mapy");
  return el;
}

function srLines(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("ul.sr-only li")).map((li) => li.textContent ?? "");
}

function chips(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".nes-world-map__chip"));
}

function markers(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".nes-world-map__marker"));
}

describe("WorldMap - alternatywa tekstowa dla danych geograficznych", () => {
  it("lista dla czytnika niesie KOMPLET połączeń, po jednej pozycji na łuk", () => {
    const { container } = render(
      <WorldMap
        dots={[
          ...oneArc,
          {
            start: { ...BRUSSELS, label: "Bruksela" },
            end: { ...KAMCHATKA, label: "Pietropawłowsk" },
          },
        ]}
      />,
    );
    // Pierwsza pozycja jest nagłówkiem listy, dalej po jednym połączeniu.
    // KONSEKWENCJA: brakująca pozycja = połączenie widoczne dla oka i niewidoczne
    // dla czytnika oraz dla wyszukiwarki, która czyta tę listę jako treść.
    expect(srLines(container)).toEqual([
      "Połączenia na mapie",
      "z Bruksela do Warszawa",
      "z Bruksela do Pietropawłowsk",
    ]);
  });

  it("punkt bez nazwy oddaje czytnikowi SUROWE współrzędne, a nie pustkę", () => {
    const { container } = render(<WorldMap dots={[{ start: BRUSSELS, end: WARSAW }]} />);
    // KONSEKWENCJA: bez tego zapasu czytnik dostaje „z  do " - łuk istnieje
    // na rysunku, a w kanale tekstowym nie ma żadnej informacji o tym, GDZIE.
    expect(srLines(container)[1]).toBe("z 50.85, 4.35 do 52.23, 21.01");
    // Ten sam wpis dowodzi drugiej rzeczy: znacznik bez nazwy i bez odsyłacza
    // nie udaje grafiki z podpowiedzią ani nie wchodzi w kolejność tabulacji.
    for (const m of markers(container)) {
      expect(m.getAttribute("role")).toBeNull();
      expect(m.getAttribute("aria-label")).toBeNull();
      expect(m.getAttribute("tabindex")).toBeNull();
    }
    // ... i nie renderuje etykiety, której nie ma czym wypełnić.
    expect(chips(container)).toHaveLength(0);
  });

  it("czytnik NIE traci połączeń, których etykiety wypadły z kadru", () => {
    const { container } = render(
      <WorldMap
        fit="europe"
        dots={[
          {
            start: { ...BRUSSELS, label: "Bruksela" },
            end: { ...WASHINGTON, label: "Waszyngton" },
          },
          {
            start: { ...BRUSSELS, label: "Bruksela" },
            end: { ...KAMCHATKA, label: "Pietropawłowsk" },
          },
          { start: { ...BRUSSELS, label: "Bruksela" }, end: { ...POLAR, label: "Longyearbyen" } },
          { start: { ...BRUSSELS, label: "Bruksela" }, end: { ...EQUATOR, label: "Libreville" } },
        ]}
      />,
    );
    // W kadrze Europy widać JEDEN napis (centralę) - pozostałe cztery leżą
    // poza płótnem i muszą zostać przycięte, inaczej `absolute` wyrzuca je
    // na sąsiednie sekcje strony.
    expect(chips(container)).toHaveLength(1);
    expect(chips(container)[0].textContent).toContain("Bruksela");
    // KONSEKWENCJA, gdyby kulling obcinał też kanał tekstowy: mapa w kadrze
    // regionalnym przestawałaby ogłaszać połączenia międzykontynentalne.
    const lines = srLines(container);
    expect(lines).toHaveLength(5);
    for (const city of ["Waszyngton", "Pietropawłowsk", "Longyearbyen", "Libreville"]) {
      expect(lines.join(" | ")).toContain(city);
    }
  });

  it("nie wnosi naruszeń dostępności - ani z linkami punktów, ani bez", async () => {
    const { container, unmount } = render(
      <WorldMap
        dots={[
          {
            start: {
              ...BRUSSELS,
              label: "Zofia Wiatrak",
              href: "/author/zofia-wiatrak",
              role: "Dyrektorka programowa",
              avatar: "https://cdn.example.com/z.webp",
            },
            end: { ...WARSAW, label: "Warszawa" },
          },
        ]}
      />,
    );
    const withLinks = await axeViolations(container);
    expect(withLinks, summarize(withLinks)).toEqual([]);
    unmount();

    const plain = render(<WorldMap dots={oneArc} showLabels={false} />);
    const noLabels = await axeViolations(plain.container);
    expect(noLabels, summarize(noLabels)).toEqual([]);
  });

  it("angielski stan pusty mówi po angielsku i przyjmuje `className`", () => {
    const { container } = render(<WorldMap dots={[]} lang="en" className="nes-empty-marker" />);
    // KONSEKWENCJA: pusty widget w wersji EN pokazywałby polskie zdanie -
    // widać to natychmiast na stronie publicznej.
    expect(screen.getByText("No connections to display on the map.")).toBeTruthy();
    // `className` musi dojechać także do stanu pustego, bo to on trzyma odstępy
    // sekcji - inaczej pusty widget wypada z siatki układu.
    expect(container.firstElementChild?.className).toContain("nes-empty-marker");
    expect(container.querySelector(".nes-world-map")).toBeNull();
  });
});

describe("WorldMap - klasy przekazane przez wołającego", () => {
  it("`className` siedzi na płótnie, a `labelClassName` na każdym napisie", () => {
    const { container } = render(
      <WorldMap dots={oneArc} className="nes-map-marker" labelClassName="nes-chip-marker" />,
    );
    expect(root(container).className).toContain("nes-map-marker");
    expect(root(container).className).toContain("nes-world-map");
    const all = chips(container);
    expect(all).toHaveLength(2);
    // KONSEKWENCJA: bez tego wołający nie ma jak zmienić typografii napisów,
    // a widget mapy w innym motywie sekcji wygląda jak wklejony z obcej strony.
    for (const chip of all) expect(chip.className).toContain("nes-chip-marker");
  });

  it("bez `className` ani stan pusty, ani płótno nie emitują wiszącej klasy", () => {
    const empty = render(<WorldMap dots={[]} />);
    const emptyCls = empty.container.firstElementChild?.getAttribute("class") ?? "";
    // KONSEKWENCJA: `[...].join(" ")` bez `filter(Boolean)` daje `class="a b "`,
    // a przy sklejaniu z klasą motywu - `"a b  c"`. To nie psuje wyglądu, ale
    // psuje każdą asercję CSS-ową i każdy selektor `[class="..."]` w e2e.
    expect(emptyCls.split(" ").includes("")).toBe(false);
    empty.unmount();

    const drawn = render(<WorldMap dots={oneArc} />);
    const drawnCls = root(drawn.container).getAttribute("class") ?? "";
    expect(drawnCls.split(" ").includes("")).toBe(false);
  });

  it("`showLabels={false}` zdejmuje CAŁĄ warstwę napisów, ale nie kanał tekstowy", () => {
    const { container } = render(<WorldMap dots={oneArc} showLabels={false} />);
    expect(chips(container)).toHaveLength(0);
    expect(container.querySelectorAll(".nes-world-map__label")).toHaveLength(0);
    // KONSEKWENCJA: gdyby wyłączenie napisów zabierało też listę `.sr-only`,
    // „mapa dekoracyjna" stawałaby się dla czytnika całkowicie pusta.
    expect(srLines(container)).toHaveLength(2);
    // Znaczniki zostają - to one są mapą, nie napisy.
    expect(markers(container)).toHaveLength(2);
  });
});

describe("WorldMap - sanityzacja odsyłaczy i zdjęć punktu", () => {
  it("`href` z `javascript:` NIE robi linku, ale znacznik i napis zostają", () => {
    const { container } = render(
      <WorldMap
        dots={[
          {
            start: { ...BRUSSELS, label: "Bruksela", href: "javascript:alert(1)" },
            end: { ...WARSAW, label: "Warszawa" },
          },
        ]}
      />,
    );
    // KONSEKWENCJA defektu w jedną stronę: wykonanie skryptu z pola panelu
    // na stronie publicznej. W drugą: punkt znika z mapy przy jednym złym wpisie.
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(markers(container)).toHaveLength(2);
    expect(chips(container)).toHaveLength(2);
    // Bez linku znacznik z nazwą jest grafiką z etykietą i wchodzi w tabulację.
    const labelled = markers(container).filter((m) => m.getAttribute("role") === "img");
    expect(labelled).toHaveLength(2);
    expect(labelled.map((m) => m.getAttribute("tabindex"))).toEqual(["0", "0"]);
    expect(
      Array.from(container.querySelectorAll(".nes-world-map__label")).map((el) => el.tagName),
    ).toEqual(["SPAN", "SPAN"]);
  });

  it("`avatar` z `javascript:` nie wchodzi do `<img>` i nie robi z napisu karty", () => {
    const { container } = render(
      <WorldMap
        dots={[
          {
            start: { ...BRUSSELS, label: "Zofia Wiatrak", avatar: "javascript:alert(1)" },
            end: { ...WARSAW, label: "Warszawa" },
          },
        ]}
      />,
    );
    // KONSEKWENCJA: `src` z `javascript:` to wektor wykonania, a wariant
    // „bogaty" bez zdjęcia rysuje puste okno w napisie.
    expect(container.querySelectorAll(".nes-world-map__chip img")).toHaveLength(0);
    expect(container.querySelectorAll(".nes-world-map__chip--rich")).toHaveLength(0);
  });
});

describe("WorldMap - harmonogram animacji", () => {
  it("`prefers-reduced-motion` wygrywa z `animate` włączonym w panelu", () => {
    h.reduced = true;
    const { container } = render(<WorldMap dots={oneArc} animate />);
    // KONSEKWENCJA: prośba systemowa o mniej ruchu jest ustawieniem
    // dostępności, nie sugestią - pętla animacji wywołuje u części osób
    // zawroty głowy, a widget nie ma innego wyłącznika po stronie widza.
    expect(container.querySelector("style")).toBeNull();
    expect(container.querySelectorAll(".nes-world-map__spark")).toHaveLength(0);
    expect(container.querySelectorAll(".nes-world-map__pulse")).toHaveLength(0);
    // Łuki są narysowane - stan KOŃCOWY, nie brak mapy.
    expect(container.querySelectorAll(".nes-world-map__arc")).toHaveLength(2);
  });

  it("`loop={false}` rysuje RAZ, ze schodkiem opóźnień i krzywą dobicia", () => {
    const { container } = render(
      <WorldMap
        dots={[
          ...oneArc,
          {
            start: { ...BRUSSELS, label: "Bruksela" },
            end: { ...KAMCHATKA, label: "Pietropawłowsk" },
          },
        ]}
        loop={false}
        animationDuration={3}
      />,
    );
    const arcs = Array.from(
      container.querySelectorAll<SVGPathElement>(
        ".nes-world-map__arc:not(.nes-world-map__arc--glow)",
      ),
    );
    expect(arcs).toHaveLength(2);
    // KONSEKWENCJA każdego z czterech ternary osobno: czas cyklu zamiast czasu
    // rysowania rozciąga animację o pauzę; brak schodka startuje oba łuki
    // razem; `infinite` zamiast `1` daje wieczną pętlę mimo `loop={false}`;
    // `linear` zamiast krzywej odbiera dobicie do celu.
    expect(arcs.map((p) => p.style.animationDuration)).toEqual(["3s", "3s"]);
    expect(arcs.map((p) => p.style.animationDelay)).toEqual(["0s", "0.3s"]);
    expect(arcs.map((p) => p.style.animationIterationCount)).toEqual(["1", "1"]);
    expect(arcs[0].style.animationTimingFunction).toBe("cubic-bezier(0.22, 0.61, 0.36, 1)");
    // Iskra biegnie w tym samym oknie, ale ZAWSZE liniowo (to harmonogram).
    const sparks = Array.from(container.querySelectorAll<SVGPathElement>(".nes-world-map__spark"));
    expect(sparks.map((p) => p.style.animationDelay)).toEqual(["0s", "0.3s"]);
    expect(sparks.map((p) => p.style.animationIterationCount)).toEqual(["1", "1"]);
    expect(sparks.map((p) => p.style.animationTimingFunction)).toEqual(["linear", "linear"]);
    // Klatki obu łuków są RÓŻNE (osobna reguła na łuk), a nie jedna wspólna.
    const css = container.querySelector("style")?.textContent ?? "";
    expect(css.match(/@keyframes nes-wm-[^-]*-0\{/)).not.toBeNull();
    expect(css.match(/@keyframes nes-wm-[^-]*-1\{/)).not.toBeNull();
  });
});

describe("WorldMap - podświetlenie po najechaniu i ognisku", () => {
  /** Etykieta-link: jedyny wariant, w którym napis reaguje na wskaźnik. */
  const linked: MapArc[] = [
    {
      start: { ...BRUSSELS, label: "Bruksela", href: "/o-nas" },
      end: { ...WARSAW, label: "Warszawa" },
    },
  ];

  it("najechanie na znacznik podświetla znacznik i JEGO napis, zjechanie z mapy gasi", () => {
    const { container } = render(<WorldMap dots={oneArc} />);
    const [first, second] = markers(container);
    fireEvent.mouseOver(first);
    // KONSEKWENCJA: bez sparowania znacznika z napisem po tym samym kluczu
    // podświetla się cudzy napis - na mapie z centralą i pięcioma celami
    // wygląda to jak losowe miganie.
    expect(first.getAttribute("data-active")).toBe("true");
    expect(second.getAttribute("data-active")).toBeNull();
    const active = container.querySelectorAll('.nes-world-map__label[data-active="true"]');
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toContain("Bruksela");

    fireEvent.mouseOut(root(container));
    // KONSEKWENCJA: bez zerowania na wyjściu z płótna podświetlenie zostaje
    // zapalone po zjechaniu kursorem - mapa wygląda na zablokowaną.
    expect(container.querySelectorAll('[data-active="true"]')).toHaveLength(0);
  });

  it("ognisko z klawiatury podświetla tak samo jak wskaźnik, a jego zdjęcie gasi", () => {
    const { container } = render(<WorldMap dots={oneArc} />);
    const first = markers(container)[0];
    // Znacznik bez odsyłacza, z nazwą, ma `tabIndex=0` - jest realnym
    // przystankiem tabulacji, więc MUSI reagować na ognisko, nie tylko na mysz.
    expect(first.getAttribute("tabindex")).toBe("0");
    fireEvent.focusIn(first);
    expect(first.getAttribute("data-active")).toBe("true");
    fireEvent.focusOut(first);
    expect(first.getAttribute("data-active")).toBeNull();
  });

  it("napis-link reaguje na wskaźnik i ognisko tak samo jak jego znacznik", () => {
    const { container } = render(<WorldMap dots={linked} />);
    const link = container.querySelector<HTMLElement>("a.nes-world-map__label");
    if (!link) throw new Error("brak napisu-linku");
    // Napis jest `aria-hidden` i poza tabulacją (kanałem dla czytnika jest
    // lista `.sr-only`), ale wskaźnik i ognisko myszy nadal muszą go zapalać -
    // inaczej duży, wygodny cel trafień jest martwy.
    expect(link.getAttribute("tabindex")).toBe("-1");
    fireEvent.mouseOver(link);
    expect(link.getAttribute("data-active")).toBe("true");
    fireEvent.focusOut(link);
    expect(link.getAttribute("data-active")).toBeNull();
    fireEvent.focusIn(link);
    expect(link.getAttribute("data-active")).toBe("true");
  });

  it("KONTROLA DODATNIA do defektu niżej: dziś podświetla się znacznik i napis", () => {
    const { container } = render(<WorldMap dots={oneArc} />);
    fireEvent.mouseOver(markers(container)[0]);
    // Ta asercja opisuje DZISIEJSZE zachowanie i musi zzielenieć zawsze -
    // bez niej `it.fails` niżej nie dowodziłby niczego (mógłby padać dlatego,
    // że podświetlenie nie działa w ogóle).
    expect(container.querySelectorAll('[data-active="true"]').length).toBeGreaterThan(0);
  });

  it.fails(
    "DEFEKT: najechanie na znacznik nie podświetla ŻADNEGO łuku, choć grupa łuku ma na to zaczep",
    () => {
      const { container } = render(<WorldMap dots={oneArc} />);
      fireEvent.mouseOver(markers(container)[0]);
      // KONTRAKT, którego dziś NIE MA. `WorldMap.tsx:268` renderuje na grupie
      // łuku `data-active={hovered === arc.key ? "true" : undefined}`, czyli
      // deklaruje wprost: najechanie na punkt ma wyróżnić trasę, która z niego
      // wychodzi. To NIE DZIAŁA I NIE MOŻE zadziałać: `hovered` przyjmuje
      // wyłącznie klucze ZNACZNIKÓW (`resolveMarkers` -> "409.8,87.0"), a
      // porównanie idzie z kluczem ŁUKU (`resolveArcs` ->
      // "0-50.85,4.35-52.23,21.01"). Te dwie przestrzenie kluczy nie mają
      // części wspólnej, bo x >= 0 dla każdej poprawnej długości geograficznej.
      //
      // KONSEKWENCJA: na mapie „centrala -> pięć stolic" najechanie na punkt
      // docelowy nie mówi, KTÓRA linia do niego prowadzi - a to jest jedyna
      // informacja, po którą się na taką mapę patrzy. Dodatkowo w
      // `src/styles.css` nie ma ani jednej reguły na `[data-active]` przy łuku
      // (są tylko `.nes-world-map__marker` i `.nes-world-map__label`), więc
      // atrybut jest dziś martwy w DWÓCH miejscach naraz.
      //
      // NAPRAWA (świadomie NIE robiona na slepo w tym przebiegu, bo zmienia
      // kontrakt `resolveMarkers`): znacznik musi nieść klucze łuków, które
      // się w nim kończą, a `hovered` porównywać po tym zbiorze.
      const arcGroups = Array.from(container.querySelectorAll("g[data-active]")).filter(
        (g) => !g.classList.contains("nes-world-map__marker"),
      );
      expect(arcGroups.length).toBeGreaterThan(0);
    },
  );
});

describe("WorldMap - punkt z odsyłaczem, ale BEZ nazwy", () => {
  /**
   * Kombinacja osiągalna z panelu: połączenie wpisane ręcznie ma `href`
   * (wspólny dla łuku), a pole etykiety zostało puste.
   */
  const nameless: MapArc[] = [
    { start: { ...BRUSSELS, href: "/o-nas" }, end: { ...WARSAW, label: "Warszawa" } },
  ];

  it("KONTROLA DODATNIA: taki punkt jest dziś linkiem i nie dostaje `aria-label`", () => {
    const { container } = render(<WorldMap dots={nameless} />);
    const links = Array.from(container.querySelectorAll("a"));
    // To opis DZISIEJSZEGO zachowania: gałąź `point.label || undefined`
    // schodzi na `undefined`, więc atrybutu nie ma wcale (a nie jest pusty).
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/o-nas");
    expect(links[0].hasAttribute("aria-label")).toBe(false);
    // Bez tej kontroli `it.fails` niżej mógłby przechodzić dlatego, że linku
    // nie ma w ogóle - a wtedy nie dowodziłby żadnego defektu.
  });

  it("KONTROLA DODATNIA: ten sam punkt Z nazwą daje linkowi nazwę dostępną", async () => {
    const { container } = render(
      <WorldMap
        dots={[
          {
            start: { ...BRUSSELS, label: "Bruksela", href: "/o-nas" },
            end: { ...WARSAW, label: "Warszawa" },
          },
        ]}
      />,
    );
    expect(container.querySelector("a")?.getAttribute("aria-label")).toBe("Bruksela");
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it.fails("DEFEKT: link punktu bez etykiety nie ma ŻADNEJ nazwy dostępnej", async () => {
    const { container } = render(<WorldMap dots={nameless} />);
    // KONTRAKT, którego dziś NIE MA. Punkt z odsyłaczem staje się `<a>`, żeby
    // dał się otworzyć klawiaturą i był ogłoszony jako link (tak mówi komentarz
    // produkcji w liniach 360-362). Gdy etykieta jest pusta, `aria-label`
    // schodzi na `undefined`, a wnętrze linku to same figury SVG - link nie ma
    // NAZWY.
    //
    // KONSEKWENCJA: czytnik ekranu ogłasza „link" i nic więcej, a przy kilku
    // takich punktach - „link, link, link". Osoba korzystająca z listy linków
    // strony dostaje pozycje bez treści i nie ma jak wybrać właściwej. To
    // naruszenie WCAG 2.4.4 / 4.1.2 (axe: `link-name`, waga „serious").
    //
    // NAPRAWA jest decyzją produktową, nie mechaniczną, dlatego jej tu NIE ma:
    // albo punkt bez nazwy przestaje być linkiem (zostaje `<g>`, tak jak punkt
    // bez `href`), albo nazwa schodzi na współrzędne - tak jak robi to już
    // lista `.sr-only`. Do rozstrzygnięcia z właścicielem widgetu.
    const violations = await axeViolations(container);
    expect(
      violations.map((v) => v.id),
      summarize(violations),
    ).not.toContain("link-name");
  });
});
