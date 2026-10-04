// Pasek kursu NBP w kasie wersji EN - `FxRateNotice.tsx`.
//
// RYZYKO. Kupujący po angielsku płaci w EUR kwotę przeliczoną z PLN. Pasek
// jest jedynym miejscem, które mówi mu, z JAKIEGO kursu ta kwota pochodzi -
// więc nie może:
//   * udawać świeżego kursu NBP, gdy kwoty liczy kurs awaryjny albo
//     przeterminowany (to byłaby nieprawdziwa informacja o cenie),
//   * ukryć przyczyny awarii kursu, gdy działa kotwica awaryjna,
//   * pokazać czegokolwiek, gdy endpoint kursu odmówi (429) albo sieć padnie -
//     pusty/zmyślony pasek jest gorszy niż brak paska,
//   * pojawić się w wariancie PLN, w którym kurs nie wpływa na kwotę.
//
// GRANICA ATRAP: `fetch` (endpoint `/api/public/fx-rate`) i tłumacz (echo
// klucza z parametrami - widać DOKŁADNIE, jaki kurs i jaka data trafiają do
// zdania). Formatowanie daty biegnie prawdziwe.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ lang: "pl" }));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);

import { FxRateNotice } from "@/components/checkout/FxRateNotice";

type FxPayload = {
  status: "ok" | "stale" | "fallback";
  eurPln: number;
  effectiveDate: string | null;
  source: "nbp" | "fallback" | "override";
  fetchedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastAttempts: number;
  stale: boolean;
};

/** Kurs świeży z NBP. Godzina 10:00 UTC to ten sam dzień w każdej strefie od UTC-10 do UTC+13. */
const FRESH: FxPayload = {
  status: "ok",
  eurPln: 4.265,
  effectiveDate: "2026-08-13",
  source: "nbp",
  fetchedAt: "2026-08-14T10:00:00.000Z",
  lastSuccessAt: "2026-08-14T10:00:00.000Z",
  lastError: null,
  lastAttempts: 1,
  stale: false,
};

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

function respond(payload: FxPayload): void {
  fetchMock.mockResolvedValue(Response.json(payload));
}

function mount(displayCurrency: "PLN" | "EUR" = "EUR") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <FxRateNotice displayCurrency={displayCurrency} />
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

/** Czeka, aż zapytanie o kurs się rozstrzygnie (także wtedy, gdy nic nie rysuje). */
async function settled(queryClient: QueryClient): Promise<void> {
  await waitFor(() =>
    expect(queryClient.getQueryState(["fx-rate-status"])?.status).toBe("success"),
  );
}

// Strefa procesu przed testem - test godziny przestawia ją na strefę „przeglądarki"
// spoza Warszawy, więc trzeba ją oddać następnym przypadkom.
const ORIGINAL_TZ = process.env.TZ;

beforeEach(() => {
  h.lang = "pl";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe("FxRateNotice - źródło kursu", () => {
  it("świeży kurs NBP: tytuł „aktualny”, kurs z 4 miejscami, tabela A i czas pobrania", async () => {
    respond(FRESH);
    mount();

    expect(await screen.findByText("checkout.fx.freshTitle")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/public/fx-rate", {
      headers: { Accept: "application/json" },
    });
    const status = screen.getByRole("status");
    // Zielony pasek jest zarezerwowany dla świeżego kursu NBP.
    expect(status).toHaveClass("border-emerald-500/30");
    expect(status).toHaveTextContent("checkout.fx.rate(rate=4.2650)");
    expect(status).toHaveTextContent("checkout.fx.tableA(date=2026-08-13)");
    expect(status).toHaveTextContent(
      /checkout\.fx\.fetchedAt\(when=14 sierpnia 2026, \d{2}:\d{2}\)/,
    );
    // Świeży kurs NBP nie ma czego tłumaczyć - linii z przyczyną nie ma.
    expect(status).not.toHaveTextContent("checkout.fx.reason");
  });

  it("przeterminowany kurs NBP mówi „przeterminowany”, a nie „aktualny”", async () => {
    respond({ ...FRESH, status: "stale", stale: true, lastError: "NBP HTTP 503" });
    mount();

    expect(await screen.findByText("checkout.fx.staleTitle")).toBeInTheDocument();
    expect(screen.queryByText("checkout.fx.freshTitle")).not.toBeInTheDocument();
    expect(screen.queryByText("checkout.fx.fallbackTitle")).not.toBeInTheDocument();
    const status = screen.getByRole("status");
    // Ani zieleń „świeżego” kursu, ani bursztyn kotwicy awaryjnej - ton neutralny.
    expect(status).toHaveClass("border-muted");
    expect(status).not.toHaveClass("border-emerald-500/30");
    expect(status).not.toHaveClass("border-brand/30");
    // Kwota wciąż pochodzi z ostatniego udanego odczytu NBP - z jego tabelą.
    expect(status).toHaveTextContent("checkout.fx.tableA(date=2026-08-13)");
    // Linia z przyczyną należy do kotwicy awaryjnej; kurs z NBP jej nie dostaje,
    // nawet gdy ostatnia próba odświeżenia zapisała błąd.
    expect(status).not.toHaveTextContent("checkout.fx.reason");
  });

  it("kurs awaryjny ostrzega, podaje przyczynę i czas ostatniej próby", async () => {
    respond({
      ...FRESH,
      status: "fallback",
      source: "fallback",
      eurPln: 4.3,
      effectiveDate: null,
      lastSuccessAt: null,
      fetchedAt: "2026-08-14T10:05:00.000Z",
      lastError: "NBP: invalid mid value",
      lastAttempts: 3,
    });
    mount();

    expect(await screen.findByText("checkout.fx.fallbackTitle")).toBeInTheDocument();
    const status = screen.getByRole("status");
    expect(status).toHaveClass("border-brand/30");
    expect(status).toHaveTextContent("checkout.fx.rate(rate=4.3000)");
    // Kotwica nie ma daty tabeli NBP - zdanie o tabeli A byłoby nieprawdą.
    expect(status).not.toHaveTextContent("checkout.fx.tableA");
    // Bez udanego odczytu czas bierzemy z ostatniej próby.
    expect(status).toHaveTextContent(/when=14 sierpnia 2026, \d{2}:\d{2}/);
    expect(status).toHaveTextContent("checkout.fx.reason(reason=NBP: invalid mid value)");
  });

  it("ręczny kurs (override) bez zapisanej przyczyny nie dokleja pustej linii „Powód”", async () => {
    respond({
      ...FRESH,
      status: "fallback",
      source: "override",
      lastError: null,
      fetchedAt: null,
      lastSuccessAt: null,
    });
    mount();

    expect(await screen.findByText("checkout.fx.fallbackTitle")).toBeInTheDocument();
    const status = screen.getByRole("status");
    expect(status).not.toHaveTextContent("checkout.fx.reason");
    // Bez żadnego znacznika czasu nie zmyślamy „Pobrano: ...".
    expect(status).not.toHaveTextContent("checkout.fx.fetchedAt");
  });

  it("godzina pobrania jest w tej samej strefie co data, a nie w strefie przeglądarki", async () => {
    // 22:30 UTC 13 sierpnia to 00:30 CEST 14 sierpnia. Data idzie przez
    // `formatDate` (strefa serwisu), więc godzina musi iść tą samą drogą -
    // inaczej kupujący spoza Warszawy dostaje datę z jednej doby i godzinę
    // z drugiej.
    // Strefa „przeglądarki" jest JAWNA: na maszynie w strefie Warszawy obie
    // drogi dają to samo i test nie odróżniłby naprawy od regresji. W Nowym
    // Jorku ta sama chwila to 18:30 13 sierpnia.
    process.env.TZ = "America/New_York";
    respond({
      ...FRESH,
      fetchedAt: "2026-08-13T22:30:00.000Z",
      lastSuccessAt: "2026-08-13T22:30:00.000Z",
    });
    mount();

    expect(await screen.findByText("checkout.fx.freshTitle")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "checkout.fx.fetchedAt(when=14 sierpnia 2026, 00:30)",
    );
  });

  it("po angielsku data pobrania jest po angielsku", async () => {
    h.lang = "en";
    respond(FRESH);
    mount();

    expect(await screen.findByText("checkout.fx.freshTitle")).toBeInTheDocument();
    // 10:00 UTC to 12:00 w Warszawie - godzina też idzie przez strefę serwisu,
    // w zapisie 24-godzinnym en-GB (konwencja domu, nie en-US „12:00 PM").
    expect(screen.getByRole("status")).toHaveTextContent(
      "checkout.fx.fetchedAt(when=14 August 2026, 12:00)",
    );
  });
});

describe("FxRateNotice - kiedy pasek milczy", () => {
  it("w wariancie PLN nie rysuje niczego (kurs nie wpływa na kwotę)", async () => {
    respond(FRESH);
    const { container, queryClient } = mount("PLN");

    await settled(queryClient);
    expect(container).toBeEmptyDOMElement();
  });

  it("odmowa endpointu (429 rate_limited) chowa pasek zamiast pokazać pusty kurs", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ status: "rate_limited", message: "Too many requests." }, { status: 429 }),
    );
    const { container, queryClient } = mount();

    await settled(queryClient);
    expect(queryClient.getQueryData(["fx-rate-status"])).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it("zerwana sieć chowa pasek i nie wywraca kasy", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const { container, queryClient } = mount();

    await settled(queryClient);
    expect(queryClient.getQueryData(["fx-rate-status"])).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });
});
