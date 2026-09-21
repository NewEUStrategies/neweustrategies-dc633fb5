// Szkielet powłoki panelu - pierwszy ekran `/admin`, zanim rozstrzygnie się sesja.
//
// PO CO TEN PLIK ISTNIEJE. „Wyrenderował się" nie jest tu żadnym dowodem:
// wyrenderuje się także wtedy, gdy przestanie robić to jedno, po co powstał.
// Przedmiotem dowodu jest PARYTET GEOMETRII z `AdminShell`.
//
// MECHANIZM DEFEKTU, który ten komponent zamyka. Sesja Supabase żyje
// w `localStorage`, więc rozstrzyga się dopiero po hydratacji (a do audytu CWV
// 2026-09-20 `/admin` było dodatkowo trasą `ssr: false`, czyli dokument
// przychodził z pustym ciałem). Pierwszy render trafia na
// `useAuth().loading`. Malowała się
// wtedy JEDNA wyśrodkowana kropka w `min-h-screen flex items-center
// justify-center`, po czym React podmieniał ją na pełną powłokę: pasek boczny
// 14 rem, pole wyszukiwania, lista nawigacji, siatka treści. To nie jest
// dokończenie układu, tylko jego całkowita wymiana - najgrubszy pojedynczy
// wkład do CLS 0,532 zmierzonego na tej ścieżce (próg „Poor" = 0,250).
//
// OD 2026-09-21 PARYTET JEST MECHANIZMEM, NIE OBIETNICĄ. Klasy nie są już
// przepisane po obu stronach z pamięci - obie biorą je z jednego modułu
// (`adminShellGeometry.ts`), a ten plik pilnuje, żeby żadna ze stron nie
// zaczęła znowu pisać ich u siebie. Asercje po ŹRÓDLE powłoki zostają: test
// przepisany z pamięci przechodzi dokładnie po tej zmianie, która psuje rzecz
// pilnowaną (ktoś zmienia pasek na `w-64` w powłoce i szkielet cicho przestaje
// pasować).
//
// GRANICA DOWODU. Nie mierzymy pikseli - happy-dom nie liczy układu, więc
// „zero przesunięcia" jest tu niemierzalne z definicji. Mierzymy DWIE rzeczy,
// które źródła ustalają: (1) że obie powłoki deklarują te same klasy i ten sam
// korzeń, (2) że ARKUSZ WIDZI SZKIELET TAK SAMO jak powłokę - bo o szerokości
// paska w wariancie `style-4` decyduje `styles.css` (`width: 3.5rem !important`),
// a nie klasa Tailwinda. Pomiar CLS należy do RUM-u i do testów przeglądarkowych.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { AdminShellSkeleton } from "../AdminShellSkeleton";
import {
  ADMIN_SHELL_ROOT_CLASS,
  ADMIN_SIDEBAR_FRAME_CLASS,
  ADMIN_SIDEBAR_WIDTH_CLASS,
  adminContentPaddingClass,
  adminSidebarWidthClass,
  isAdminSidebarCompact,
} from "../adminShellGeometry";
import { isCompactSidebarRoute } from "@/lib/admin/adminNav";
import { SIDEBAR_STYLES, type SidebarStyle } from "@/lib/builder/sidebarStyles";
import { hasSsrDisabled } from "@/lib/ci/publicRouteLoaders";

const SHELL_SOURCE = readFileSync("src/components/admin/AdminShell.tsx", "utf8");
const SKELETON_SOURCE = readFileSync("src/components/admin/AdminShellSkeleton.tsx", "utf8");
const ROUTE_SOURCE = readFileSync("src/routes/admin.tsx", "utf8");
const SITE_CSS = readFileSync("src/styles.css", "utf8");

/** Wszystkie warianty paska z panelu wyglądu - źródło listy, nie kopia. */
const ALL_STYLES: SidebarStyle[] = SIDEBAR_STYLES.map((entry) => entry.id);

afterEach(cleanup);

describe("parytet geometrii z AdminShell", () => {
  it("korzeń deklaruje te same klasy co powłoka", () => {
    const { container } = render(<AdminShellSkeleton />);
    const root = container.firstElementChild;
    expect(root).not.toBeNull();
    const className = root?.getAttribute("class") ?? "";
    for (const token of [...ADMIN_SHELL_ROOT_CLASS.split(" "), "flex"]) {
      expect(className).toContain(token);
    }
    // Ta sama klasa MUSI stać w źródle powłoki - inaczej parytet jest pozorny.
    // Powłoka bierze ją dziś z tej samej funkcji, co szkielet.
    expect(SHELL_SOURCE).toContain("adminShellRootClass");
  });

  it.each([
    { compact: false, width: ADMIN_SIDEBAR_WIDTH_CLASS.expanded },
    { compact: true, width: ADMIN_SIDEBAR_WIDTH_CLASS.compact },
  ])("pasek boczny ma szerokość $width (compact: $compact)", ({ compact, width }) => {
    const { container } = render(
      <AdminShellSkeleton path={compact ? "/admin/posts/abc" : "/admin"} />,
    );
    const aside = container.querySelector("aside");
    expect(aside).not.toBeNull();
    expect(aside?.getAttribute("class")).toContain(width);
    // Dowód, że to nie jest liczba wymyślona w teście: powłoka liczy ją tą
    // samą funkcją z tego samego modułu.
    expect(SHELL_SOURCE).toContain("adminSidebarWidthClass");
  });

  it("pasek jest przyklejony na pełną wysokość, dokładnie jak w powłoce", () => {
    const { container } = render(<AdminShellSkeleton />);
    const className = container.querySelector("aside")?.getAttribute("class") ?? "";
    for (const token of ADMIN_SIDEBAR_FRAME_CLASS.split(" ")) {
      expect(className).toContain(token);
    }
    expect(SHELL_SOURCE).toContain("ADMIN_SIDEBAR_FRAME_CLASS");
  });

  it("`hideSidebar` zdejmuje pasek I zdejmuje `flex` z korzenia", () => {
    // Ta druga połowa jest istotna: powłoka warunkuje `flex` tym samym propem
    // (studio wydarzenia wymienia całą ramę), więc szkielet z `flex` bez paska
    // dałby inny układ treści niż powłoka, która po nim nastąpi.
    const { container } = render(<AdminShellSkeleton hideSidebar />);
    expect(container.querySelector("aside")).toBeNull();
    expect(container.firstElementChild?.getAttribute("class")).not.toContain("flex ");
  });

  // GEOMETRIA ŻYJE W JEDNYM MODULE - i to jest asercja o ŹRÓDLE, bo dokładnie
  // tak ten defekt powstał: dwie listy klas, każda poprawna osobno.
  it("żadna ze stron nie przepisuje klas geometrii u siebie", () => {
    for (const source of [SHELL_SOURCE, SKELETON_SOURCE]) {
      expect(source).toContain('from "@/components/admin/adminShellGeometry"');
      // Literał szerokości w pliku komponentu znaczy, że ktoś obszedł moduł.
      expect(source).not.toMatch(/"w-56"|"w-12"/);
    }
  });
});

// WARIANT PASKA NAJEMCY - sedno defektu 176 px zmierzonego przez audyt.
//
// `AdminShell` zwija pasek, gdy najemca ma `style-4`. Szkielet, który tego nie
// wie, rezerwuje 224 px i sam produkuje przesunięcie do 48 px. Wariant jest
// jednak ZNANY NA SERWERZE (mapa `site_settings` rozgrzana przez loader
// korzenia), więc to nie jest wiedza wyłącznie przeglądarki - i dlatego
// szkielet przyjmuje go propem, a nie zgaduje.
describe("wariant paska najemcy steruje geometrią szkieletu", () => {
  it.each(ALL_STYLES)("`%s` daje tę samą szerokość, co formuła powłoki", (style) => {
    const { container } = render(<AdminShellSkeleton path="/admin" sidebarStyle={style} />);
    const expected = adminSidebarWidthClass(isAdminSidebarCompact({ isEditRoute: false, style }));
    expect(container.querySelector("aside")?.getAttribute("class")).toContain(expected);
  });

  it("brak wiedzy o wariancie zostaje brakiem - żadnego atrybutu na wyrost", () => {
    // `null` znaczy „fala 1 nie dowiozła ustawień". Postawienie tu `style-1`
    // byłoby zarezerwowaniem CUDZEJ geometrii: najemca ze `style-3` dostałby
    // pasek bez marginesu 0,75 rem, czyli przesunięcie 24 px przy podmianie.
    const { container } = render(<AdminShellSkeleton path="/admin" />);
    expect(container.querySelector("aside")?.hasAttribute("data-sidebar-style")).toBe(false);
  });

  it("wariant zwijający jest JEDEN i zna go także powłoka", () => {
    expect(isAdminSidebarCompact({ isEditRoute: false, style: "style-4" })).toBe(true);
    for (const style of ALL_STYLES.filter((s) => s !== "style-4")) {
      expect(isAdminSidebarCompact({ isEditRoute: false, style })).toBe(false);
    }
    expect(SHELL_SOURCE).toContain("isAdminSidebarCompact");
  });
});

// ARKUSZ MUSI WIDZIEĆ SZKIELET TAK SAMO JAK POWŁOKĘ.
//
// To jest druga połowa defektu i była niewidoczna w klasach Tailwinda.
// `styles.css` nadaje paskowi wymiary przez `aside[data-sidebar="sidebar"]
// [data-sidebar-style="..."]`: `style-4` dostaje `width: 3.5rem !important`
// (56 px - ani `w-56`, ani `w-12`), a `style-3` margines `0.75rem` i niższy
// ekran. Szkielet bez tej pary atrybutów maluje inny prostokąt niż powłoka,
// nawet gdy obie deklarują tę samą klasę szerokości - czyli „naprawa" CLS
// zostawiała po sobie resztkowe przesunięcie na dwóch z sześciu wariantów.
describe("selektory arkusza trafiają w szkielet", () => {
  /** Blok reguł dokładnie tego selektora wariantu (bez potomków). */
  function styleBlock(style: SidebarStyle): string {
    const selector = `aside[data-sidebar="sidebar"][data-sidebar-style="${style}"] {`;
    const at = SITE_CSS.indexOf(selector);
    if (at === -1) return "";
    const end = SITE_CSS.indexOf("}", at);
    return SITE_CSS.slice(at + selector.length, end);
  }

  it.each(ALL_STYLES)("`%s`: szkielet pasuje do selektora wariantu", (style) => {
    const { container } = render(<AdminShellSkeleton path="/admin" sidebarStyle={style} />);
    const aside = container.querySelector("aside");
    expect(aside).not.toBeNull();
    expect(aside?.matches(`aside[data-sidebar="sidebar"][data-sidebar-style="${style}"]`)).toBe(
      true,
    );
  });

  it.each(["style-3", "style-4"] as const)(
    "`%s` niesie w arkuszu WYMIAR, więc atrybut jest geometrią, nie ozdobą",
    (style) => {
      // Kontrola dodatnia dla testu wyżej: gdyby te reguły zniknęły z arkusza,
      // asercja „selektor trafia" pilnowałaby czegoś, co nic nie znaczy.
      expect(styleBlock(style)).toMatch(/width|margin|height/);
    },
  );

  it("powłoka stawia tę samą parę atrybutów", () => {
    expect(SHELL_SOURCE).toContain('data-sidebar="sidebar"');
    expect(SHELL_SOURCE).toContain("data-sidebar-style=");
    expect(SKELETON_SOURCE).toContain('data-sidebar="sidebar"');
    expect(SKELETON_SOURCE).toContain("data-sidebar-style=");
  });
});

describe("dekoracyjność", () => {
  it("cały blok jest ukryty przed technologią asystującą", () => {
    // Ta sama doktryna, co w `EventsListSkeleton`: kilkanaście pustych
    // prostokątów ogłoszonych czytnikowi ekranu to szum, nie komunikat.
    const { container } = render(<AdminShellSkeleton />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("nie ma w środku ANI JEDNEGO znaku tekstu", () => {
    // Napis w bloku `aria-hidden` jest napisem, którego nikt nie usłyszy -
    // a w tym pliku byłby dodatkowo napisem JEDNOJĘZYCZNYM, bo szkielet stoi
    // przed rozstrzygnięciem słownika i nie ma jak go przetłumaczyć.
    const { container } = render(<AdminShellSkeleton />);
    expect((container.textContent ?? "").trim()).toBe("");
  });

  it("nie ma w środku ani jednej kontrolki - nie ma czego kliknąć ani sfokusować", () => {
    const { container } = render(<AdminShellSkeleton />);
    expect(container.querySelectorAll("button, a, input, [tabindex]").length).toBe(0);
  });
});

describe("niezależność", () => {
  it("nie potrzebuje słownika ani routera - renderuje się na gołym React", () => {
    // To jest cały sens tego komponentu: stoi PRZED rozstrzygnięciem sesji,
    // więc nie wolno mu czekać na cokolwiek, co samo się jeszcze ładuje.
    // Brak atrap w tym pliku (`vi.mock`) jest tu dowodem, a nie przeoczeniem.
    expect(() => render(<AdminShellSkeleton />)).not.toThrow();
  });
});

// PROP, KTÓREGO PRODUKCJA NIE USTAWIA, JEST PROPEM MARTWYM - a tu był gorszy
// niż martwy. `AdminShell` zwija pasek do 48 px, gdy najemca ma `style-4`
// (albo gdy trasa jest edytorem). Szkielet, który tego nie wie, maluje 224 px
// i sam produkuje przesunięcie o 176 px. Defekt był NIEWIDOCZNY dla testów
// renderujących sam szkielet, bo szkielet obsługiwał wariant poprawnie;
// brakowało WOŁAJĄCEGO. Dlatego asercja idzie po ŹRÓDLE trasy.
describe("trasa panelu faktycznie steruje geometrią szkieletu", () => {
  it("routes/admin.tsx przekazuje ścieżkę I wariant paska", () => {
    const usages = ROUTE_SOURCE.match(/<AdminShellSkeleton[\s\S]*?\/>/g) ?? [];
    expect(usages.length).toBeGreaterThan(0);
    for (const usage of usages) {
      expect(usage).toContain("path=");
      expect(usage).toContain("sidebarStyle=");
    }
  });

  it("decyzja o zwinięciu ma JEDNO źródło - `isCompactSidebarRoute`", () => {
    // Powłoka i szkielet muszą pytać tę samą funkcję. Dopóki predykat był
    // literałem regexpowym wewnątrz powłoki, szkielet nie miał jak go poznać.
    expect(SHELL_SOURCE).toContain("isCompactSidebarRoute");
    expect(SKELETON_SOURCE).toContain("isCompactSidebarRoute");
    // I nikt nie przepisuje go z pamięci obok.
    expect(SHELL_SOURCE).not.toMatch(/\/\^\\\/admin\\\/\(posts\|pages\)/);
    expect(SKELETON_SOURCE).not.toMatch(/\/\^\\\/admin\\\/\(posts\|pages\)/);
  });

  it("trasa czyta wariant z USTAWIEŃ, nie tylko z pamięci przeglądarki", () => {
    // Bez tego członu najemca ze `style-4` dostaje 224 px przy pierwszym
    // w życiu wejściu na daną przeglądarkę - a z serwerowym HTML-em to jest
    // przesunięcie widoczne w polu, nie hipotetyczne.
    expect(ROUTE_SOURCE).toContain("sidebarStyleFromSettings");
    expect(ROUTE_SOURCE).toContain("siteSettingsQueryOptions");
    // Pamięć przeglądarki zostaje jako źródło ZAPASOWE, nie główne.
    expect(ROUTE_SOURCE).toContain("readRememberedSidebarStyle");
  });
});

// WYSOKOŚĆ JEST DRUGĄ POŁOWĄ PARYTETU, i do tej pory nie była mierzona wcale.
//
// Szerokość paska pilnują asercje wyżej, ale CLS liczy przesunięcia w OBU
// osiach. Podmiana szkieletu na powłokę dzieje się w tym samym kontenerze, więc
// pytanie brzmi: czy kontener ma w obu stanach tę samą REZERWĘ pionową. Gdyby
// szkielet kończył się na wysokości swojej zawartości, dokument skurczyłby się
// w chwili rozstrzygnięcia sesji i odrósł, gdy dojadą dane ekranu - dwa
// przesunięcia zamiast zera, i to na każdej trasie panelu naraz.
describe("parytet wysokości - kontener nie kurczy się przy podmianie", () => {
  it.each([
    { hideSidebar: false, label: "z paskiem" },
    { hideSidebar: true, label: "bez paska (studio wydarzenia)" },
  ])("korzeń rezerwuje pełny ekran $label", ({ hideSidebar }) => {
    const { container } = render(<AdminShellSkeleton hideSidebar={hideSidebar} />);
    const className = container.firstElementChild?.getAttribute("class") ?? "";
    expect(className).toContain("min-h-screen");
    // Powłoka deklaruje TĘ SAMĄ rezerwę na TYM SAMYM korzeniu - inaczej
    // parytet byłby przypadkiem, a nie kontraktem.
    expect(ADMIN_SHELL_ROOT_CLASS).toContain("min-h-screen");
  });

  it("pasek boczny zajmuje dokładnie jeden ekran, tak jak w powłoce", () => {
    const { container } = render(<AdminShellSkeleton />);
    const className = container.querySelector("aside")?.getAttribute("class") ?? "";
    for (const token of ["h-screen", "max-h-screen", "self-start"]) {
      expect(className).toContain(token);
      expect(ADMIN_SIDEBAR_FRAME_CLASS).toContain(token);
    }
  });

  it("kolumna treści rośnie tak samo jak w powłoce", () => {
    const { container } = render(<AdminShellSkeleton />);
    expect(container.querySelector("main")?.getAttribute("class")).toContain("flex-1");
    expect(SHELL_SOURCE).toContain("adminContentColumnClass");
  });

  it("treść ma rezerwę pionową, a nie wysokość własnej zawartości", () => {
    // `h-[70vh]` nie jest zgadywaniem układu konkretnego ekranu (patrz komentarz
    // w komponencie) - jest REZERWĄ, dzięki której dokument ma pełną wysokość,
    // zanim cokolwiek się dowiezie.
    const { container } = render(<AdminShellSkeleton />);
    const reserve = container.querySelector("main .h-\\[70vh\\]");
    expect(reserve).not.toBeNull();
  });

  // PADDING KOLUMNY TREŚCI to najcichszy człon parytetu: szkielet rysował
  // `p-4 md:p-6`, a powłoka na tych samych trasach `px-3 py-4 lg:px-5 lg:py-6`
  // albo `p-2` w edytorze. Przy podmianie cała treść przesuwała się więc
  // o 4-16 px w poziomie na KAŻDEJ trasie panelu, niezależnie od paska.
  it.each([
    { path: "/admin", label: "pulpit" },
    { path: "/admin/posts/abc123", label: "edytor wpisu" },
    { path: "/admin/theme-options", label: "opcje motywu" },
  ])("padding treści zgadza się z powłoką ($label)", ({ path }) => {
    const { container } = render(<AdminShellSkeleton path={path} />);
    const expected = adminContentPaddingClass({
      isEditRoute: isCompactSidebarRoute(path),
      isThemeOptions: path.startsWith("/admin/theme-options"),
    });
    const inner = container.querySelector("main > div")?.getAttribute("class") ?? "";
    for (const token of expected.split(" ")) expect(inner).toContain(token);
    expect(SHELL_SOURCE).toContain("adminContentPaddingClass");
  });
});

// SSR SZKIELETU (audyt CWV 2026-09-20, F32 / plan 3.13): ten komponent nie jest
// już tylko pierwszym renderem KLIENTA - wychodzi z serwera. Zachowanie trasy
// dowodzi `src/routes/__tests__/adminRouteSsr.test.tsx`; tutaj pilnujemy tylko
// tego, żeby decyzja o SSR nie wróciła po cichu do `ssr: false`.
describe("szkielet stoi w dokumencie serwerowym", () => {
  it("trasa panelu nie wyłącza renderu serwerowego", () => {
    // Predykat produkcyjnej bramki (`lib/ci/publicRouteLoaders`), a nie własny
    // regexp: czyta BLOK OPCJI trasy, więc nie myli deklaracji z komentarzem
    // (a ten plik trasy `ssr: false` cytuje - opisuje, dlaczego go już nie ma).
    expect(hasSsrDisabled(ROUTE_SOURCE)).toBe(false);
  });

  it("część zależna od sesji jest za bramką hydratacji", () => {
    // Bez tej bramki `useAuth` (czyli `localStorage`) trafiłby do renderu
    // serwerowego - to jest dokładnie ten rozjazd, przez który trasa miała
    // `ssr: false`.
    expect(ROUTE_SOURCE).toContain("useHydrated");
  });

  it("wariant kompaktowy z URL-a zgadza się z predykatem powłoki", () => {
    // Serwer zna z formuły powłoki DWA człony - trasę i ustawienia najemcy.
    // Ten test wiąże predykat trasy z narysowaną szerokością, żeby zmiana
    // jednego bez drugiego była czerwona.
    for (const path of ["/admin", "/admin/posts/abc", "/admin/appearance/header"]) {
      const compact = isCompactSidebarRoute(path);
      const { container } = render(<AdminShellSkeleton path={path} />);
      expect(container.querySelector("aside")?.getAttribute("class")).toContain(
        adminSidebarWidthClass(compact),
      );
      cleanup();
    }
  });
});
