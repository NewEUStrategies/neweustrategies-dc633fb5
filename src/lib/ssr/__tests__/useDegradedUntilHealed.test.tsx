// „DEGRADACJA MÓWI PRAWDĘ, ALE LECZY SIĘ SAMA" - dowód dla wspólnego haka
// (`src/lib/ssr/useDegradedUntilHealed.ts`), z którego korzysta osiem tras
// publicznych.
//
// CO JEST PRZEDMIOTEM DOWODU - trzy rzeczy, każda z własnej awarii:
//
//   (a) WYLECZENIE. Loader, który nie dostał danych, zasiewa fallback ze
//       stemplem `updatedAt: 0` i oddaje `degraded: true`. Ładunek loadera jest
//       NIEZMIENNY przez życie dopasowania trasy, więc dopóki widok czytał samą
//       flagę, czytelnik oglądał komunikat awarii NAD listą, którą przeglądarka
//       dociągnęła sekundę później.
//   (b) NAWRÓT. Kiedy refetch znowu padnie, komunikat ma ZOSTAĆ - razem
//       z ponowieniem, które dotyczy DOKŁADNIE tego zapytania (bez nawigacji
//       i bez ponownego biegu loadera).
//   (c) HYDRATACJA. Przełączenie nie może nastąpić w PIERWSZYM renderze
//       klienta: React porównuje wtedy drzewo z HTML-em serwera i porzuca całe
//       poddrzewo, jeśli się różni. Bramką jest `getServerSnapshot`
//       z `useSyncExternalStore`, a nie „i tak zdąży": dane potrafią wejść do
//       cache'u MIĘDZY wygenerowaniem HTML-a a hydratacją i wtedy naiwny odczyt
//       stempla w renderze rozjeżdża hydratację - ten plik pokazuje oba warianty
//       obok siebie (KONTROLA NEGATYWNA).
//
// ŚRODOWISKO. Suita biegnie w happy-dom, więc `render()` z testing-library to
// ścieżka PRZEGLĄDARKI. Wyjście serwera widzi wyłącznie `renderToString`
// (`render()` wykonuje efekty przed powrotem, czyli pokazuje stan PO korekcie).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";

import { useDegradedUntilHealed } from "@/lib/ssr/useDegradedUntilHealed";

/** Klucz zapytania, który loader zasiewa fallbackiem, a komponent czyta. */
const KEY = ["stub", "lista"] as const;
/** Klucz SĄSIEDNI - do dowodu, że hak nie leczy się cudzym stemplem. */
const OTHER_KEY = ["stub", "inna-lista"] as const;

const ROW = "Analiza z backendu";
const RETRY = "ponów";

const h = vi.hoisted(() => ({
  /** Czy odczyt ma paść (blip backendu). */
  fails: true,
  /** Liczba wywołań `queryFn` - podstawa pomiaru ponowień. */
  reads: 0,
}));

function listOptions() {
  return {
    queryKey: KEY,
    queryFn: async (): Promise<string[]> => {
      h.reads += 1;
      if (h.fails) throw new Error("test: backend niedostępny");
      return [ROW];
    },
    retry: false,
  };
}

/**
 * Klient PO DEGRADACJI - dokładnie to, co zostawia `loadResilient`: pusta lista
 * ze stemplem `updatedAt: 0` i BEZ `queryFn` (po hydratacji wpis odtworzony
 * z dehydracji też jeszcze go nie ma - dokłada go dopiero obserwator).
 */
function seededClient(): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData<string[]>(KEY, [], { updatedAt: 0 });
  return queryClient;
}

/** Widok w kształcie tras: gałąź degradacji STOI POD odczytem zapytania. */
function Widok({ initialDegraded }: { initialDegraded: boolean }) {
  const { data } = useQuery(listOptions());
  const { degraded, retry } = useDegradedUntilHealed(KEY, initialDegraded);
  if (degraded) {
    return (
      <button type="button" onClick={retry}>
        {RETRY}
      </button>
    );
  }
  return (
    <ul>
      {(data ?? []).map((row) => (
        <li key={row}>{row}</li>
      ))}
    </ul>
  );
}

/** Wariant pilnujący PARYTETU KLUCZY (reguła W4 bramki `check:loader-policy`). */
function WidokZRozjazdemKlucza({ initialDegraded }: { initialDegraded: boolean }) {
  const { data } = useQuery(listOptions());
  const { degraded } = useDegradedUntilHealed(OTHER_KEY, initialDegraded);
  if (degraded) return <span>{RETRY}</span>;
  return <ul>{(data ?? []).map((row) => <li key={row}>{row}</li>)}</ul>;
}

/**
 * KONTROLA NEGATYWNA dla (c): odczyt stempla WPROST w renderze, czyli wariant
 * sprzed wspólnego haka. Bez bramki hydratacji pierwszy render klienta ogłasza
 * wyleczenie, którego serwerowy HTML nie zna.
 */
function WidokBezBramkiHydratacji({ initialDegraded }: { initialDegraded: boolean }) {
  const queryClient = useQueryClient();
  const { data } = useQuery(listOptions());
  const degraded = initialDegraded && (queryClient.getQueryState(KEY)?.dataUpdatedAt ?? 0) === 0;
  if (degraded) return <button type="button">{RETRY}</button>;
  return (
    <ul>
      {(data ?? []).map((row) => (
        <li key={row}>{row}</li>
      ))}
    </ul>
  );
}

function withClient(queryClient: QueryClient, node: ReactElement): ReactElement {
  return <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>;
}

/**
 * Hydratacja serwerowego HTML-a z rejestrem `console.error` - React 19 zgłasza
 * tam rozjazd. Zwraca zebrane komunikaty i kontener, żeby test mógł dowieść
 * też tego, że poddrzewo ŻYJE (inaczej „zero błędów" przechodziłoby na pustce).
 */
async function hydrateAndCollect(
  queryClient: QueryClient,
  node: ReactElement,
  html: string,
): Promise<{ errors: unknown[]; container: HTMLElement }> {
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);

  const errors: unknown[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args);
  });
  await act(async () => {
    hydrateRoot(container, withClient(queryClient, node));
  });
  spy.mockRestore();
  return { errors, container };
}

beforeEach(() => {
  h.fails = true;
  h.reads = 0;
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("useDegradedUntilHealed - (a) degradacja znika po udanym refetchu", () => {
  it("zasiany fallback ustępuje prawdziwym danym BEZ nawigacji", async () => {
    // SEDNO NAPRAWY. Do tej pory komunikat wisiał do kolejnej nawigacji albo
    // przeładowania, choć dane były już w cache'u.
    h.fails = false;
    const queryClient = seededClient();
    render(withClient(queryClient, <Widok initialDegraded />));

    // Pierwszy render (jeszcze przed refetchem) mówi prawdę: degradacja.
    expect(screen.getByRole("button", { name: RETRY })).toBeInTheDocument();

    expect(await screen.findByText(ROW)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: RETRY })).toBeNull();
  });

  it("KONTROLA POZYTYWNA: bez degradacji w loaderze komunikat nie pojawia się w ogóle", async () => {
    // Bez tej pary poprzedni test przechodziłby też wtedy, gdyby hak oddawał
    // `degraded` zawsze na starcie.
    h.fails = false;
    const queryClient = seededClient();
    render(withClient(queryClient, <Widok initialDegraded={false} />));

    expect(screen.queryByRole("button", { name: RETRY })).toBeNull();
    expect(await screen.findByText(ROW)).toBeInTheDocument();
  });

  it("padnięte zapytanie przy CZYSTYM starcie NIE podnosi degradacji", async () => {
    // Hak wyłącznie ZDEJMUJE flagę loadera. Podnoszenie jej odebrałoby trasom
    // ich własną obsługę błędu (`isError`) i zrobiło z jednego haka wspólną
    // granicę błędów siedmiu powierzchni.
    const queryClient = seededClient();
    render(withClient(queryClient, <Widok initialDegraded={false} />));

    await waitFor(() => expect(h.reads).toBe(1));
    expect(screen.queryByRole("button", { name: RETRY })).toBeNull();
  });

  it("stempel SĄSIEDNIEGO klucza nie leczy - parytet kluczy jest warunkiem", async () => {
    // Rozjazd klucza loader/komponent daje widok, który nie wyleczy się NIGDY.
    // Ta asercja jest tu po to, żeby dowód z (a) nie przechodził na dowolnym
    // ruchu w cache'u.
    h.fails = false;
    const queryClient = seededClient();
    render(withClient(queryClient, <WidokZRozjazdemKlucza initialDegraded />));

    await waitFor(() => expect(h.reads).toBe(1));
    expect(screen.getByText(RETRY)).toBeInTheDocument();
  });
});

describe("useDegradedUntilHealed - (b) nieudany refetch zostawia komunikat i ponowienie", () => {
  it("po drugiej awarii komunikat ZOSTAJE", async () => {
    const queryClient = seededClient();
    render(withClient(queryClient, <Widok initialDegraded />));

    await waitFor(() => expect(h.reads).toBe(1));
    expect(screen.getByRole("button", { name: RETRY })).toBeInTheDocument();
    expect(screen.queryByText(ROW)).toBeNull();
  });

  it("ponowienie pyta backend JESZCZE RAZ i leczy widok, gdy ten wrócił", async () => {
    const queryClient = seededClient();
    render(withClient(queryClient, <Widok initialDegraded />));
    await waitFor(() => expect(h.reads).toBe(1));

    h.fails = false;
    fireEvent.click(screen.getByRole("button", { name: RETRY }));

    expect(await screen.findByText(ROW)).toBeInTheDocument();
    expect(h.reads).toBe(2);
    expect(screen.queryByRole("button", { name: RETRY })).toBeNull();
  });

  it("ponowienie przy wciąż padniętym backendzie NIE kasuje komunikatu", async () => {
    // Bez tej pary poprzedni test dowodziłby tylko tego, że klik cokolwiek robi.
    const queryClient = seededClient();
    render(withClient(queryClient, <Widok initialDegraded />));
    await waitFor(() => expect(h.reads).toBe(1));

    fireEvent.click(screen.getByRole("button", { name: RETRY }));

    await waitFor(() => expect(h.reads).toBe(2));
    expect(screen.getByRole("button", { name: RETRY })).toBeInTheDocument();
  });
});

describe("useDegradedUntilHealed - (c) hydratacja bez rozjazdu", () => {
  it("pierwszy render klienta jest identyczny z serwerowym, choć dane dojechały PRZED hydratacją", async () => {
    // UKŁAD, KTÓRY ŁAMIE NAIWNĄ WERSJĘ: HTML wyszedł zdegradowany, a wpis
    // w cache'u zdążył dostać prawdziwy stempel, zanim ruszyła hydratacja
    // (dehydracja strumieniowa, wcześniejszy prefetch). Hak MUSI oddać wtedy
    // wartość serwerową i przełączyć się dopiero w kolejnym renderze.
    const queryClient = seededClient();
    const html = renderToString(withClient(queryClient, <Widok initialDegraded />));
    expect(html).toContain(RETRY);

    queryClient.setQueryData<string[]>(KEY, [ROW]);
    const { errors, container } = await hydrateAndCollect(
      queryClient,
      <Widok initialDegraded />,
      html,
    );

    expect(errors).toEqual([]);
    // KONTROLA DODATNIA: poddrzewo żyje i PO hydratacji pokazuje już prawdę.
    expect(container.textContent).toContain(ROW);
  });

  it("KONTROLA NEGATYWNA: ten sam układ BEZ bramki hydratacji rozjeżdża hydratację", async () => {
    // Bez tej pary poprzedni test przechodziłby także dla implementacji, która
    // bramki nie ma - czyli nie dowodziłby niczego o mechanizmie.
    const queryClient = seededClient();
    const html = renderToString(withClient(queryClient, <WidokBezBramkiHydratacji initialDegraded />));
    expect(html).toContain(RETRY);

    queryClient.setQueryData<string[]>(KEY, [ROW]);
    const { errors } = await hydrateAndCollect(
      queryClient,
      <WidokBezBramkiHydratacji initialDegraded />,
      html,
    );

    expect(errors.length).toBeGreaterThan(0);
  });

  it("dwa rendery serwerowe tego samego stanu dają bit w bit ten sam HTML", () => {
    // Determinizm jest warunkiem koniecznym hydratacji bez rozjazdu: gdyby hak
    // czytał gdziekolwiek zegar albo magazyn przeglądarki, padłoby tutaj.
    const queryClient = seededClient();
    const first = renderToString(withClient(queryClient, <Widok initialDegraded />));
    const second = renderToString(withClient(queryClient, <Widok initialDegraded />));
    expect(first).toBe(second);
  });
});
