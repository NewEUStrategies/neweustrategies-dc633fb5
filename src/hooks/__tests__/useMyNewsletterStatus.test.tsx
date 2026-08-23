// "CZY JESTEM JUŻ ZAPISANY DO NEWSLETTERA" - warstwa danych panelu subskrybenta.
//
// CO TU JEST PRZEDMIOTEM DOWODU.
//   1. ANONIMOWY ODWIEDZAJĄCY NIE WOŁA SERWERA. Zapytanie chodzi wyłącznie
//      z sesją; gdyby `enabled` puściło anonima, każde wejście na stronę
//      z formularzem generowałoby odpytanie kończące się 401, a odwiedzający
//      zamiast formularza zobaczyłby spinner.
//   2. KLUCZ CACHE ZAWIERA UŻYTKOWNIKA. Bez tego po przelogowaniu React Query
//      podałby status POPRZEDNIEJ osoby - czyjś adres e-mail i czyjeś tematy
//      na ekranie kolejnego zalogowanego. To wyciek danych osobowych w UI.
//   3. ZAPIS TEMATÓW UNIEWAŻNIA ODCZYT. Bez tego panel po zapisie pokazuje
//      stare tematy, więc subskrybent zapisuje je drugi raz, przekonany,
//      że pierwszy zapis nie przeszedł.
//
// Warstwa serwerowa (`newsletter-status.functions.ts`) jest tu ATRAPĄ celowo:
// przedmiotem dowodu jest okablowanie hooka, nie zapytanie do bazy. Zero sieci.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MyNewsletterStatus } from "@/lib/newsletter-status.functions";

const h = vi.hoisted(() => ({
  user: null as { id: string } | null,
  fetchStatus: vi.fn(),
  updateTopics: vi.fn(),
  /** Znacznik server fn, po którym atrapa `useServerFn` rozpoznaje wywołanie. */
  getFn: { name: "getMyNewsletterStatus" },
  updateFn: { name: "updateMyNewsletterTopics" },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.user }),
}));

vi.mock("@/lib/newsletter-status.functions", () => ({
  getMyNewsletterStatus: h.getFn,
  updateMyNewsletterTopics: h.updateFn,
}));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => (fn === h.getFn ? h.fetchStatus : h.updateTopics),
}));

import { useMyNewsletterStatus, useUpdateMyNewsletterTopics } from "@/hooks/useMyNewsletterStatus";

const STATUS: MyNewsletterStatus = {
  subscribed: true,
  status: "subscribed",
  email: "anna@example.org",
  listName: "Stopka strony",
  mailingLists: ["Analizy"],
  topics: ["Energia", "Handel"],
  since: "2026-05-04T09:00:00.000Z",
};

function harness() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, invalidateSpy, wrapper };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-22T10:00:00.000Z"));
  h.user = { id: "user-1" };
  h.fetchStatus.mockReset().mockResolvedValue(STATUS);
  h.updateTopics.mockReset().mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
describe("useMyNewsletterStatus", () => {
  it("anonimowy odwiedzający nie odpytuje serwera i od razu widzi klasyczny formularz", async () => {
    h.user = null;
    const { wrapper } = harness();
    const view = renderHook(() => useMyNewsletterStatus(), { wrapper });

    await waitFor(() => expect(view.result.current.isLoading).toBe(false));
    expect(h.fetchStatus).not.toHaveBeenCalled();
    expect(view.result.current.data).toBeNull();
  });

  it("zanim odpowiedź wróci, panel wie, że jeszcze nie wie", () => {
    h.fetchStatus.mockReturnValue(new Promise(() => {}));
    const { wrapper } = harness();
    const view = renderHook(() => useMyNewsletterStatus(), { wrapper });

    expect(view.result.current.isLoading).toBe(true);
    expect(view.result.current.data).toBeNull();
  });

  it("zalogowany subskrybent dostaje swój status, listy i tematy", async () => {
    const { wrapper } = harness();
    const view = renderHook(() => useMyNewsletterStatus(), { wrapper });

    await waitFor(() => expect(view.result.current.data).not.toBeNull());
    expect(view.result.current.data).toEqual(STATUS);
    expect(h.fetchStatus).toHaveBeenCalledTimes(1);
  });

  it("status jest cache'owany POD UŻYTKOWNIKIEM - kolejna osoba nie zobaczy cudzego adresu", async () => {
    const { wrapper, client } = harness();
    const view = renderHook(() => useMyNewsletterStatus(), { wrapper });
    await waitFor(() => expect(view.result.current.data).not.toBeNull());

    const keys = client
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey);
    expect(keys).toContainEqual(["newsletter", "my-status", "user-1"]);
  });

  it("odmowa serwera nie podstawia pod panel pustego, ale 'poprawnego' statusu", async () => {
    h.fetchStatus.mockRejectedValue(new Error("Unauthorized"));
    const { wrapper } = harness();
    const view = renderHook(() => useMyNewsletterStatus(), { wrapper });

    await waitFor(() => expect(view.result.current.isLoading).toBe(false));
    // `null` znaczy "nie wiadomo" - panel pokazuje wtedy zwykły formularz,
    // a nie fałszywe "nie jesteś zapisany".
    expect(view.result.current.data).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("useUpdateMyNewsletterTopics", () => {
  it("zapis tematów jedzie na serwer w kopercie { data }", async () => {
    const { wrapper } = harness();
    const view = renderHook(() => useUpdateMyNewsletterTopics(), { wrapper });

    await act(async () => {
      await view.result.current.mutateAsync({
        topics: ["Energia"],
        mailingLists: ["Analizy"],
      });
    });

    expect(h.updateTopics).toHaveBeenCalledWith({
      data: { topics: ["Energia"], mailingLists: ["Analizy"] },
    });
  });

  it("po udanym zapisie status jest unieważniony - panel nie pokazuje starych tematów", async () => {
    const { wrapper, invalidateSpy } = harness();
    const view = renderHook(() => useUpdateMyNewsletterTopics(), { wrapper });

    await act(async () => {
      await view.result.current.mutateAsync({ topics: [], mailingLists: [] });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["newsletter", "my-status"] });
  });

  it("nieudany zapis nie unieważnia cache i zgłasza błąd zamiast udawać sukces", async () => {
    h.updateTopics.mockRejectedValue(new Error("Unauthorized"));
    const { wrapper, invalidateSpy } = harness();
    const view = renderHook(() => useUpdateMyNewsletterTopics(), { wrapper });

    await act(async () => {
      await expect(
        view.result.current.mutateAsync({ topics: ["X"], mailingLists: [] }),
      ).rejects.toThrow("Unauthorized");
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
