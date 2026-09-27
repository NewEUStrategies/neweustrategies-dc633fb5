// FAKTY KARTY „KTO TO OGLĄDA” (`useViewerCardFacts`). Hook decyduje, czy karta
// w ogóle istnieje, więc każdy z trzech stanów „bez karty” (gość, wiersz
// profilu w drodze, konto bez nazwy) i reguła nazwy z CRM-u mają tu swój
// przypadek. Zapytanie i sesja są atrapami - ich poprawność pilnują testy
// `useHeaderProfile` i `useAuth`, a tu liczy się wyłącznie złożenie faktów.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

interface HeaderProfileRow {
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  job_title?: string | null;
  current_company?: string | null;
  avatar_url?: string | null;
}

const h = vi.hoisted(() => ({
  user: null as { id: string; email?: string } | null,
  query: { data: undefined as HeaderProfileRow | null | undefined, isPending: false },
  profileUserIds: [] as (string | undefined)[],
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/lib/profile/useHeaderProfile", () => ({
  useHeaderProfile: (userId: string | undefined) => {
    h.profileUserIds.push(userId);
    return h.query;
  },
}));

import { useViewerCardFacts } from "@/lib/profile/useViewerCard";

const facts = () => renderHook(() => useViewerCardFacts()).result.current;

beforeEach(() => {
  h.user = { id: "user-me", email: "anna@example.com" };
  h.query = { data: undefined, isPending: false };
  h.profileUserIds = [];
});

describe("useViewerCardFacts", () => {
  it("gość bez sesji nie ma karty, a zapytanie profilu nie dostaje identyfikatora", () => {
    h.user = null;
    expect(facts()).toBeNull();
    expect(h.profileUserIds).toEqual([undefined]);
  });

  it("wiersz profilu w drodze nie daje karty z samym e-mailem (bez skoku układu)", () => {
    h.query = { data: undefined, isPending: true };
    expect(facts()).toBeNull();
    expect(h.profileUserIds).toEqual(["user-me"]);
  });

  it("pełny profil: nazwa wyświetlana, stanowisko, organizacja i zdjęcie", () => {
    h.query = {
      isPending: false,
      data: {
        display_name: "Anna Kowalska",
        first_name: "Anna",
        last_name: "Nowak",
        job_title: "Analityczka",
        current_company: "NASK",
        avatar_url: "https://example.com/anna.jpg",
      },
    };
    expect(facts()).toEqual({
      name: "Anna Kowalska",
      jobTitle: "Analityczka",
      company: "NASK",
      avatarUrl: "https://example.com/anna.jpg",
    });
  });

  it("bez nazwy wyświetlanej bierze imię i nazwisko, a brakujące pola są puste, nie zgadywane", () => {
    h.query = {
      isPending: false,
      data: {
        display_name: "  ",
        first_name: "Jan",
        last_name: "Kowalski",
        job_title: null,
        current_company: null,
        avatar_url: null,
      },
    };
    expect(facts()).toEqual({ name: "Jan Kowalski", jobTitle: "", company: "", avatarUrl: null });
  });

  it("konto bez wiersza profilu ma kartę z samym e-mailem jako nazwą", () => {
    h.query = { data: null, isPending: false };
    expect(facts()).toEqual({
      name: "anna@example.com",
      jobTitle: "",
      company: "",
      avatarUrl: null,
    });
  });

  it("konto bez nazwy i bez e-maila nie ma karty (inicjały „?” nie mówią, czyj to profil)", () => {
    h.user = { id: "user-me" };
    h.query = { data: null, isPending: false };
    expect(facts()).toBeNull();
  });
});
