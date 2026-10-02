// Trasa `/post/$slug` - stały adres wpisu z własnych listingów i kart,
// przekierowywany na adres kanoniczny `<ścieżka-rodzica>/<slug>`.
//
// PRZEDMIOT DOWODU TO KOD ODPOWIEDZI, CEL I INTENCJA CACHE - nie render. Trasa
// nie ma komponentu: loader zawsze rzuca. Trzy reguły:
//
//   1. WPIS ISTNIEJE -> 301 na `/$` z `_splat` = ścieżka kanoniczna. `_splat`
//      idzie SUROWY: router koduje każdy segment sam (`encodeURIComponent`
//      per segment, `/` zostaje), więc kodowanie tutaj dałoby `%25C5%25BC`.
//   2. WPISU BRAK -> TYMCZASOWE 302 na `/blog` z `private, no-store`. Wpis może
//      wrócić z kosza albo z ponownej publikacji; trwałe 301 albo
//      cache'owalne 302 zamroziłyby `/blog` jako jego miejsce docelowe.
//   3. 301 deklaruje KRÓTKĄ współdzieloną świeżość (audyt CWV, F13): każde
//      wejście z listingu nie może płacić dwóch dokumentów `no-store`.
//
// Błąd rozwiązywania (baza nie odpowiada) to NIE „wpisu brak": loader go
// przepuszcza do `errorComponent`, a ten loguje surowy błąd i daje ponowienie.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { isRedirect } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { errorCopy } from "@/lib/errorCopy";

const h = vi.hoisted(() => ({
  resolveLegacyPostPath: vi.fn(),
  setCacheControlHeader: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("@/lib/routing/legacyPostPath", () => ({
  resolveLegacyPostPath: h.resolveLegacyPostPath,
}));
vi.mock("@/lib/http/responseHeaders", () => ({
  setCacheControlHeader: h.setCacheControlHeader,
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useRouter: () => ({ invalidate: h.invalidate }),
}));

import { Route as LegacyPostRoute } from "@/routes/post.$slug";

type LegacyLoader = (ctx: { params: { slug: string } }) => Promise<unknown>;
type ErrorView = (props: { error: Error; reset: () => void }) => ReactNode;

/** STRAŻNIK, nie rzutowanie: framework nie wystawia loadera w typie wywoływalnym. */
function isLoader(value: unknown): value is LegacyLoader {
  return typeof value === "function";
}

function isErrorView(value: unknown): value is ErrorView {
  return typeof value === "function";
}

/** Co loader RZUCIŁ dla danego sluga - trasa nigdy nie zwraca danych. */
async function thrownFor(slug: string): Promise<unknown> {
  const loader: unknown = LegacyPostRoute.options.loader;
  if (!isLoader(loader)) throw new Error("test: trasa nie ma loadera w postaci funkcji");
  try {
    await loader({ params: { slug } });
  } catch (thrown) {
    return thrown;
  }
  throw new Error("test: loader zakończył się bez przekierowania");
}

async function redirectFor(slug: string) {
  const thrown = await thrownFor(slug);
  if (!isRedirect(thrown)) throw new Error("test: loader nie rzucił przekierowania routera");
  return thrown;
}

function errorView(): ErrorView {
  const view: unknown = LegacyPostRoute.options.errorComponent;
  if (!isErrorView(view)) throw new Error("test: trasa nie ma `errorComponent`");
  return view;
}

beforeEach(() => {
  h.resolveLegacyPostPath.mockReset();
  h.setCacheControlHeader.mockReset();
  h.invalidate.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("/post/$slug - wpis istnieje: trwałe przekierowanie na adres kanoniczny", () => {
  it("301 na `/$` ze ścieżką kanoniczną rozwiązaną dla TEGO sluga", async () => {
    h.resolveLegacyPostPath.mockResolvedValue("analizy/bezpieczenstwo/rola-ue");
    const redirect = await redirectFor("rola-ue");

    expect(h.resolveLegacyPostPath).toHaveBeenCalledWith("rola-ue");
    expect(redirect.status).toBe(301);
    expect(redirect.options).toMatchObject({
      to: "/$",
      params: { _splat: "analizy/bezpieczenstwo/rola-ue" },
      statusCode: 301,
    });
  });

  it("301 deklaruje krótką, WSPÓŁDZIELONĄ świeżość - nie `no-store`", async () => {
    h.resolveLegacyPostPath.mockResolvedValue("blog/rola-ue");
    await redirectFor("rola-ue");

    expect(h.setCacheControlHeader).toHaveBeenCalledTimes(1);
    expect(h.setCacheControlHeader).toHaveBeenCalledWith(
      "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
    );
  });

  it("slug z polskimi znakami idzie do routera SUROWY - router koduje segmenty raz", async () => {
    h.resolveLegacyPostPath.mockResolvedValue("analizy/zażółć-gęślą");
    const redirect = await redirectFor("zażółć-gęślą");

    expect(h.resolveLegacyPostPath).toHaveBeenCalledWith("zażółć-gęślą");
    expect(redirect.options.params).toEqual({ _splat: "analizy/zażółć-gęślą" });
    expect(redirect.options.href).toBeUndefined();
  });
});

describe("/post/$slug - wpisu brak: tymczasowe przekierowanie na listing", () => {
  it("302 na `/blog` - nie 301, wpis może wrócić z kosza", async () => {
    h.resolveLegacyPostPath.mockResolvedValue(null);
    const redirect = await redirectFor("usuniety-wpis");

    expect(redirect.status).toBe(302);
    expect(redirect.options).toMatchObject({ to: "/blog", statusCode: 302 });
  });

  it("302 NIE trafia do żadnego cache (`private, no-store`)", async () => {
    h.resolveLegacyPostPath.mockResolvedValue(null);
    await redirectFor("usuniety-wpis");

    expect(h.setCacheControlHeader).toHaveBeenCalledTimes(1);
    expect(h.setCacheControlHeader).toHaveBeenCalledWith("private, no-store");
  });
});

describe("/post/$slug - błąd rozwiązywania adresu", () => {
  it("awaria bazy NIE udaje „wpisu brak”: loader przepuszcza błąd, bez nagłówka cache", async () => {
    const failure = new Error("connection reset");
    h.resolveLegacyPostPath.mockRejectedValue(failure);

    expect(await thrownFor("rola-ue")).toBe(failure);
    expect(h.setCacheControlHeader).not.toHaveBeenCalled();
  });

  it("ekran błędu loguje surowy błąd, ale czytelnikowi pokazuje tylko komunikat", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const ErrorScreen = errorView();
    const failure = new Error("connection reset by peer 10.0.0.7");
    render(<ErrorScreen error={failure} reset={vi.fn()} />);

    const copy = errorCopy();
    expect(screen.getByRole("heading", { name: copy.errorTitle })).toBeInTheDocument();
    expect(screen.getByText(copy.errorBody)).toBeInTheDocument();
    expect(screen.queryByText(/connection reset/)).toBeNull();
    expect(logged).toHaveBeenCalledWith(failure);
  });

  it("„spróbuj ponownie” unieważnia dane routera i resetuje granicę błędu", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const ErrorScreen = errorView();
    const reset = vi.fn();
    render(<ErrorScreen error={new Error("x")} reset={reset} />);

    fireEvent.click(screen.getByRole("button", { name: errorCopy().tryAgain }));
    expect(h.invalidate).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
