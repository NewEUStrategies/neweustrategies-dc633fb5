// Fakty karty „kto to ogląda" (`useViewerCardFacts`) - jedno źródło dla strony
// wydarzenia i dla podglądu w studiu.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW. Hook stał na zerze w tym katalogu:
// jedyni konsumenci w testach (`EventMePanel`, podgląd studia) podmieniają go
// atrapą, a bramka parytetu podglądu renderuje wyłącznie gościa. Tymczasem
// niesie trzy obietnice widoczne tylko dla użytkownika:
//   * gość nie widzi karty wcale, a strona nie pyta bazy o jego profil,
//   * karta nie mignie samym e-mailem, zanim dojedzie wiersz profilu
//     (skok układu obok banera),
//   * pola, których nie ma, schodzą na pusty napis / `null`, a nie na zmyśloną
//     wartość - o tym, czy linia w karcie istnieje, decyduje molekuła.
//
// Hook czyta PRAWDZIWY `useHeaderProfile` (ten sam klucz co pasek konta), więc
// atrapą jest wyłącznie klient Supabase i kontekst sesji - nie sam moduł.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ok, PROFILE_IDS, supabaseFromStub, type SupabaseResult } from "@/test/profile/fixtures";
import { useHeaderProfile, type HeaderProfile } from "../useHeaderProfile";

const h = vi.hoisted(() => ({
  auth: { user: null as { id: string; email?: string } | null },
}));

const stubs = vi.hoisted(() => ({ from: null as unknown }));

vi.mock("@/integrations/supabase/client", async () => {
  const fixtures = await import("@/test/profile/fixtures");
  const from = fixtures.supabaseFromStub();
  stubs.from = from;
  return { supabase: { from: from.from } };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.auth.user }),
}));

import { useViewerCardFacts, type ViewerCardFacts } from "../useViewerCard";

type FromStub = ReturnType<typeof supabaseFromStub>;
const db = () => stubs.from as FromStub;

const EMAIL = "anna.nowak@example.org";

function headerRow(overrides: Partial<HeaderProfile> = {}): HeaderProfile {
  return {
    first_name: "Anna",
    last_name: "Nowak",
    display_name: "Anna Nowak-Kowalska",
    avatar_url: "https://cdn.example/avatar.jpg",
    job_title: "Head of EU Affairs",
    current_company: "New European Strategies",
    ...overrides,
  };
}

/**
 * Renderuje hook i zapisuje KAŻDĄ wartość, którą zobaczyła karta.
 *
 * Obok karty w tym samym komponencie siedzi `useHeaderProfile` - ten sam wpis
 * cache, więc oba odświeżają się w JEDNYM renderze. Dzięki temu test wie, że
 * zapytanie o wiersz naprawdę się zakończyło, a `null` karty jest decyzją
 * hooka, a nie stanem „jeszcze nie wiadomo”.
 */
function renderFacts() {
  const seen: Array<ViewerCardFacts | null> = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = renderHook(
    () => {
      const facts = useViewerCardFacts();
      const header = useHeaderProfile(h.auth.user?.id);
      seen.push(facts);
      return { facts, loaded: header.isSuccess };
    },
    { wrapper },
  );
  return { ...view, seen };
}

beforeEach(() => {
  h.auth.user = { id: PROFILE_IDS.me, email: EMAIL };
  db().reset();
});

describe("useViewerCardFacts - kiedy karty NIE MA", () => {
  it("gość nie dostaje karty, a strona nie pyta bazy o profil", async () => {
    h.auth.user = null;
    const { result } = renderFacts();

    await Promise.resolve();
    expect(result.current.facts).toBeNull();
    // Zapytanie o `profiles` bez sesji to round-trip, który i tak wróciłby
    // pusty - i kolejna okazja do odczytu cudzego wiersza, gdyby RLS zawiódł.
    expect(db().chains).toHaveLength(0);
  });

  it("wiersz profilu W DRODZE: karta nie miga samym e-mailem, pojawia się raz, w całości", async () => {
    let release: () => void = () => {};
    db().setResponse(
      "profiles",
      () =>
        new Promise<SupabaseResult>((resolve) => {
          release = () => resolve(ok(headerRow()));
        }),
    );

    const { result, seen } = renderFacts();

    // Dopóki zapytanie trwa, karty nie ma - e-mail jest znany od razu, ale
    // karta z samym adresem urosłaby za chwilę o dwie linie obok banera.
    expect(result.current.facts).toBeNull();
    await waitFor(() => expect(db().chainsFor("profiles")).toHaveLength(1));
    expect(result.current).toEqual({ facts: null, loaded: false });

    release();
    await waitFor(() => expect(result.current.loaded).toBe(true));

    expect(result.current.facts?.name).toBe("Anna Nowak-Kowalska");
    // Żaden render nie pokazał karty z samym e-mailem.
    expect(seen.some((facts) => facts?.name === EMAIL)).toBe(false);
  });

  it("konto BEZ wiersza profilu i bez e-maila nie dostaje karty z inicjałami „?”", async () => {
    // Nie ma czego wpisać w nazwę - karta nie powiedziałaby, czyj to profil.
    h.auth.user = { id: PROFILE_IDS.me };
    db().setResponse("profiles", ok(null));
    const { result } = renderFacts();

    // Zapytanie DOJECHAŁO (odpowiedź to `null`) - brak karty jest decyzją,
    // nie stanem oczekiwania.
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.facts).toBeNull();
  });

  it("wiersz z pustymi polami nazwy i konto bez e-maila - też bez karty", async () => {
    h.auth.user = { id: PROFILE_IDS.me };
    db().setResponse(
      "profiles",
      ok(headerRow({ display_name: "  ", first_name: null, last_name: "" })),
    );
    const { result } = renderFacts();

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.facts).toBeNull();
  });
});

describe("useViewerCardFacts - fakty karty", () => {
  it("komplet pól profilu przechodzi do karty 1:1", async () => {
    db().setResponse("profiles", ok(headerRow()));
    const { result } = renderFacts();

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.facts).toEqual({
      name: "Anna Nowak-Kowalska",
      jobTitle: "Head of EU Affairs",
      company: "New European Strategies",
      avatarUrl: "https://cdn.example/avatar.jpg",
    });
    // Ten sam wiersz, co pasek konta - zawężony do id zalogowanego.
    expect(db().lastChain("profiles")?.argsOf("eq")).toEqual(["id", PROFILE_IDS.me]);
  });

  it("bez nazwy wyświetlanej karta bierze imię i nazwisko - reguła z CRM-u", async () => {
    db().setResponse("profiles", ok(headerRow({ display_name: null })));
    const { result } = renderFacts();

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.facts?.name).toBe("Anna Nowak");
  });

  it("brakujące stanowisko, organizacja i zdjęcie schodzą na pusty napis i `null`", async () => {
    // Pusty napis, nie zmyślona wartość: o tym, czy linia w karcie istnieje,
    // decyduje molekuła `EventViewerCard`. `null` zdjęcia znaczy „inicjały”.
    db().setResponse(
      "profiles",
      ok(headerRow({ job_title: null, current_company: null, avatar_url: null })),
    );
    const { result } = renderFacts();

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.facts).toEqual({
      name: "Anna Nowak-Kowalska",
      jobTitle: "",
      company: "",
      avatarUrl: null,
    });
  });

  it("bez imienia i nazwiska karta nazywa osobę e-mailem - ostatni szczebel reguły", async () => {
    db().setResponse(
      "profiles",
      ok(headerRow({ display_name: null, first_name: null, last_name: null })),
    );
    const { result } = renderFacts();

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.facts?.name).toBe(EMAIL);
  });

  it("konto bez wiersza profilu, ale z e-mailem: karta z adresem i bez zmyślonych linii", async () => {
    // Zachowanie ZMIERZONE, nie domniemane: reguła nazwy z CRM-u schodzi na
    // e-mail także wtedy, gdy wiersza `profiles` nie ma wcale - a wszystkie
    // pozostałe fakty karty zostają puste.
    db().setResponse("profiles", ok(null));
    const { result } = renderFacts();

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.facts).toEqual({
      name: EMAIL,
      jobTitle: "",
      company: "",
      avatarUrl: null,
    });
  });
});
