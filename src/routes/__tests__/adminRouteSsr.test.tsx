// TRASA `/admin` - CO DOKŁADNIE POWSTAJE NA SERWERZE, A CO DOPIERO PO HYDRATACJI.
//
// PO CO TEN PLIK ISTNIEJE. `/admin` miało `ssr: false` z jednym, prawdziwym
// powodem: sesja Supabase żyje w `localStorage`, więc serwerowy render
// czegokolwiek, co od niej zależy, jest gwarantowanym rozjazdem hydratacji.
// Cena była jednak płacona CAŁYM dokumentem - puste ciało do końca bootu
// (FCP p75 4,52 s, CLS 0,53-0,68; audyt CWV 2026-09-20, F32 / plan 3.13).
// Trasa renderuje się dziś na serwerze, ale WYŁĄCZNIE jako `AdminShellSkeleton`
// liczony ze ścieżki. Ten plik pilnuje obu połówek tej umowy naraz, bo każda
// z nich sama w sobie jest przechodzona przez wersję, która łamie drugą:
//   * „szkielet jest w HTML-u" przechodzi także wtedy, gdy obok niego wyciekła
//     sesja (i wróciło `ssr: false` jako jedyne lekarstwo),
//   * „nie ma sesji w SSR" przechodzi także dla pustego ciała, czyli dla stanu
//     sprzed naprawy.
//
// GRANICA DOWODU. `renderToString` to JEDYNA metoda, która widzi wyjście
// serwera: `render()` z testing-library wykonuje efekty przed powrotem, więc
// pokazuje stan PO korekcie, a przedmiotem dowodu jest stan PRZED nią. Pikseli
// nie mierzymy - happy-dom nie liczy układu; parytet geometrii szkieletu
// i powłoki ma własny plik (`components/admin/__tests__/AdminShellSkeleton.test.tsx`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

const h = vi.hoisted(() => ({
  /** Ścieżka widziana przez `useRouterState` - jedyne wejście renderu SSR. */
  pathname: "/admin",
  /** Ile razy ktokolwiek sięgnął po sesję. W SSR musi zostać zerem. */
  authCalls: 0,
  /** Stan sesji oddawany przez atrapę `useAuth`. */
  auth: {
    loading: false,
    session: { user: { id: "u1" } } as unknown,
    isStaff: true,
  },
  /** Klucze odczytane z `localStorage`. W SSR musi zostać puste. */
  storageReads: [] as string[],
  /** Nagłówki `Cache-Control` ustawione przez `beforeLoad`. */
  cacheControl: [] as string[],
  /** Ile razy zarejestrowano nakładkę słownika admina. */
  i18nCalls: 0,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => {
    h.authCalls += 1;
    return h.auth;
  },
}));

vi.mock("@/components/admin/AdminShell", async () => {
  const { createElement } = await import("react");
  return {
    AdminShell: ({ children }: { children?: ReactNode }) =>
      createElement("div", { "data-testid": "admin-shell" }, children),
  };
});

// Nakładka słownika rejestruje klucze efektem ubocznym importu i ciągnie za
// sobą cały `@/lib/i18n` - w tym pliku nie ma nic do zrobienia, a jej import
// zamieniłby test trasy w test i18n (ta sama pułapka, co w `adminDashboardRoute`).
vi.mock("@/lib/i18n-admin-extras", () => ({
  ensureI18n: () => {
    h.i18nCalls += 1;
  },
}));

// Efekt serwerowy: w teście interesuje nas WARTOŚĆ intencji, nie h3.
vi.mock("@/lib/http/responseHeaders", () => ({
  setCacheControlHeader: (value: string) => void h.cacheControl.push(value),
  appendLinkHeader: () => {},
  readRouteCacheDirective: () => null,
}));

// `useHydrated` zostaje PRAWDZIWE - to ono jest przedmiotem dowodu. Atrapujemy
// wyłącznie to, co bez runtime'u routera nie ma jak zadziałać.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const { createElement } = await import("react");
  return {
    ...actual,
    useRouterState: <T,>({ select }: { select: (state: unknown) => T }): T =>
      select({ location: { pathname: h.pathname } }),
    useNavigate: () => () => Promise.resolve(),
    Outlet: () => createElement("div", { "data-testid": "admin-outlet" }),
  };
});

import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { cleanup, render, screen } from "@testing-library/react";
import { rememberSidebarStyle } from "@/lib/admin/sidebarStylePreference";
import { routeHead } from "@/test/routeHarness";
import { Route as AdminRoute } from "@/routes/admin";

/** Komponent trasy jako funkcja - STRAŻNIK, nie rzutowanie. */
function adminLayout(): () => ReactElement {
  const component: unknown = AdminRoute.options.component;
  if (typeof component !== "function") throw new Error("test: trasa nie ma komponentu");
  return component as () => ReactElement;
}

/** `beforeLoad` trasy wołany wprost - niesie efekty serwerowe, nie dane. */
function adminBeforeLoad(): () => void {
  const fn: unknown = AdminRoute.options.beforeLoad;
  if (typeof fn !== "function") throw new Error("test: trasa nie ma `beforeLoad`");
  return fn as () => void;
}

function ssrHtml(pathname: string): string {
  h.pathname = pathname;
  const Layout = adminLayout();
  return renderToString(<Layout />);
}

beforeEach(() => {
  h.pathname = "/admin";
  h.authCalls = 0;
  h.auth = { loading: false, session: { user: { id: "u1" } }, isStaff: true };
  h.storageReads = [];
  h.cacheControl = [];
  h.i18nCalls = 0;
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    /* atrapa magazynu z sekcji SSR - nie ma czego czyścić */
  }
});

describe("render serwerowy: szkielet i NIC POZA nim", () => {
  // Każdy odczyt magazynu w tej sekcji jest defektem, więc atrapa jest GŁOŚNA.
  // Sam licznik by nie wystarczył: `readRememberedSidebarStyle` ma własny
  // `try/catch`, więc cichy odczyt przeszedłby niezauważony.
  //
  // PODMIENIAMY WŁAŚCIWOŚĆ OKNA, nie metodę: happy-dom wystawia `localStorage`
  // przez Proxy, na którym `vi.spyOn` zakłada atrapę, ale `restoreAllMocks()`
  // jej NIE ZDEJMUJE - atrapa wyciekała do kolejnych plików opisu i wywracała
  // je na własnym wyjątku. ZMIERZONE, nie domysł.
  let storageDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    storageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => ({
        getItem: (key: string) => {
          h.storageReads.push(key);
          throw new Error(`test: render serwerowy siegnal do localStorage (${key})`);
        },
        setItem: () => {},
        removeItem: () => {},
        clear: () => {},
      }),
    });
  });

  afterEach(() => {
    if (storageDescriptor) Object.defineProperty(window, "localStorage", storageDescriptor);
    else Reflect.deleteProperty(window, "localStorage");
  });

  it("nie pyta o sesję ANI RAZU", () => {
    // To jest cały powód, dla którego `ssr: false` w ogóle stało w tej trasie.
    // Gdyby `useAuth` dochodziło do serwera, HTML zależałby od `localStorage`,
    // którego serwer nie ma - czyli rozjazd hydratacji przy każdym wejściu.
    const html = ssrHtml("/admin");
    expect(h.authCalls).toBe(0);
    expect(h.storageReads).toEqual([]);
    expect(html).toContain("data-admin-shell-skeleton");
  });

  it("nie renderuje treści panelu - `<Outlet/>` zostaje na kliencie", () => {
    const html = ssrHtml("/admin");
    expect(html).not.toContain('data-testid="admin-outlet"');
    // Pełny atrybut, nie sam napis: `admin-shell` jest PODCIĄGIEM
    // `data-admin-shell-skeleton`, więc luźna asercja oblewałaby zawsze.
    expect(html).not.toContain('data-testid="admin-shell"');
  });

  it("nie woła rejestracji słownika w renderze - to robi `beforeLoad`", () => {
    ssrHtml("/admin");
    expect(h.i18nCalls).toBe(0);
  });

  it.each([
    { path: "/admin", width: "w-56", label: "pulpit" },
    { path: "/admin/posts/abc123", width: "w-12", label: "edytor wpisu" },
    { path: "/admin/appearance/header", width: "w-12", label: "wygląd" },
  ])("szerokość paska liczy się ze ŚCIEŻKI ($label)", ({ path, width }) => {
    // Jedyne wejście, które serwer ZNA. Wariant zapamiętany w `localStorage`
    // jest wiedzą wyłącznie przeglądarki - wejście go tutaj byłoby rozjazdem
    // (atrapa magazynu wyżej rzuca, więc każda próba jest tu widoczna).
    expect(ssrHtml(path)).toContain(width);
    expect(h.storageReads).toEqual([]);
  });

  it("dwa rendery tej samej ścieżki dają bit w bit ten sam HTML", () => {
    // Determinizm jest warunkiem koniecznym hydratacji bez rozjazdu: gdyby
    // gdziekolwiek w tym drzewie siedział zegar albo magazyn, padłoby tutaj.
    expect(ssrHtml("/admin")).toBe(ssrHtml("/admin"));
  });
});

describe("hydratacja: klient nie porzuca serwerowego poddrzewa", () => {
  it("pierwszy render klienta jest identyczny z serwerowym", async () => {
    // React 19 raportuje rozjazd hydratacji przez `console.error`. Test, który
    // tylko sprawdza, że „coś się wyrenderowało", przepuszcza porzucenie
    // całego poddrzewa - czyli utratę dokładnie tego HTML-a, po który jest SSR.
    const html = ssrHtml("/admin");
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);

    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    const Layout = adminLayout();
    await act(async () => {
      hydrateRoot(container, <Layout />);
    });
    spy.mockRestore();

    expect(errors).toEqual([]);
    // Kontrola dodatnia: po hydratacji poddrzewo ŻYJE, czyli test nie
    // przechodzi na pustce.
    expect(container.querySelector('[data-testid="admin-shell"]')).not.toBeNull();
    container.remove();
  });
});

describe("po hydratacji: panel montuje się normalnie", () => {
  it("z sesją personelu renderuje powłokę z treścią trasy", () => {
    const Layout = adminLayout();
    render(<Layout />);
    expect(screen.getByTestId("admin-shell")).toBeInTheDocument();
    expect(screen.getByTestId("admin-outlet")).toBeInTheDocument();
    expect(h.authCalls).toBeGreaterThan(0);
  });

  it("czekając na sesję dokłada do szkieletu wariant ZAPAMIĘTANY", () => {
    // Tego członu serwer nie zna, ale klient owszem - i bez niego najemca ze
    // `style-4` czekałby na sesję przy pasku 224 px, żeby zobaczyć 48 px.
    rememberSidebarStyle("style-4");
    h.auth = { loading: true, session: null, isStaff: false };
    const Layout = adminLayout();
    const { container } = render(<Layout />);
    expect(container.querySelector("aside")?.getAttribute("class")).toContain("w-12");
  });

  it("bez uprawnień nie renderuje NICZEGO", () => {
    h.auth = { loading: false, session: null, isStaff: false };
    const Layout = adminLayout();
    const { container } = render(<Layout />);
    expect(container.innerHTML).toBe("");
  });
});

describe("kontrakt dokumentu panelu", () => {
  it("trasa nie wyłącza już renderu serwerowego", () => {
    // `ssr: 'data-only'` też jest tu porażką: biegnie loaderami, ale ciała nie
    // renderuje, czyli oddaje dokładnie to puste ciało, które naprawiamy.
    expect(AdminRoute.options.ssr).toBeUndefined();
  });

  it("`beforeLoad` zamyka dokument przed każdym cache'em", () => {
    // Deny-lista NES Edge Cache mówi „nie zapisuj" tylko NASZEMU brzegowi;
    // odpowiedź wychodziła bez żadnego `Cache-Control`. Odkąd dokument niesie
    // HTML, intencja musi być na drucie.
    adminBeforeLoad()();
    expect(h.cacheControl).toContain("private, no-store");
  });

  it("`beforeLoad` rejestruje nakładkę słownika admina", () => {
    adminBeforeLoad()();
    expect(h.i18nCalls).toBe(1);
  });

  it("`head()` niesie arkusz panelu - dlatego SSR startuje jego pobranie", () => {
    // To jest druga połowa zysku FCP: przy `ssr: false` router w ogóle nie
    // ładował chunku trasy na serwerze (`loadNormalChunks` bierze wyłącznie
    // dopasowania `ssr === true`), więc `admin-styles.css` odkrywała
    // przeglądarka dopiero PO zhydratowaniu bootu - szeregowo, nie równolegle.
    //
    // GRANICA DOWODU: `?url` rozwiązuje BUNDLER, a vitest oddaje z tego importu
    // pusty napis - mierzymy więc DEKLARACJĘ arkusza w `head()`, nie jego
    // adres. Że tym arkuszem jest `admin-styles.css` i że nikt inny go nie
    // importuje, pilnuje `lib/ci/__tests__/platformBuildGuards.test.ts`.
    const links = routeHead(AdminRoute).links ?? [];
    const sheets = links.filter((link) => link.rel === "stylesheet");
    expect(sheets).toHaveLength(1);
    expect(sheets[0]).toHaveProperty("href");
  });

  it("panel zostaje poza indeksem", () => {
    const meta = routeHead(AdminRoute).meta ?? [];
    expect(meta).toContainEqual({ name: "robots", content: "noindex, nofollow" });
  });
});
