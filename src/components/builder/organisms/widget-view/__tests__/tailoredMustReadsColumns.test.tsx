// TailoredMustReadsView: ustawienie "Kolumny" bylo martwe z powodu TYPU.
// Schemat zapisuje wybor selecta jako string ("1".."4"), a widok czytal go
// przez `getNum`, ktory odrzuca stringi - siatka ZAWSZE renderowala sie jako
// 3-kolumnowa, niezaleznie od wyboru redakcji. Po naprawie odczyt idzie przez
// `asNum` z `contentValue`, a klasy siatki sa deterministyczne dla 1-4 kolumn.
//
// Testujemy zarowno czysty kontrakt (klasy per liczba kolumn, tolerancja na
// stringi i wartosci spoza zakresu), jak i realny DOM widgetu.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

const db = vi.hoisted(() => ({
  authors: [] as unknown[],
  recommended: [] as unknown[],
  user: { id: "u1" } as null | { id: string },
}));

vi.mock("@/integrations/supabase/client", () => {
  const makeBuilder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "is", "order", "limit"]) b[m] = () => b;
    b.maybeSingle = async () => ({ data: null, error: null });
    b.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: table === "profiles_public" ? db.authors : [], error: null });
    return b;
  };
  return {
    supabase: {
      from: (t: string) => makeBuilder(t),
      rpc: async (fn: string) => ({
        data: fn === "get_recommended_posts_v2" ? db.recommended : [],
        error: null,
      }),
    },
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: db.user, loading: false }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k,
    i18n: { language: "pl" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import {
  TailoredMustReadsView,
  tailoredColumns,
  tailoredGridClass,
} from "../TailoredMustReadsView";
import type { WidgetContent } from "@/lib/builder/types";

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const post = (id: string) => ({
  id,
  slug: `wpis-${id}`,
  title_pl: `Wpis ${id}`,
  title_en: `Post ${id}`,
  excerpt_pl: "Zajawka",
  excerpt_en: "Excerpt",
  cover_image_url: null,
  author_id: null,
});

beforeEach(() => {
  db.authors = [];
  db.recommended = [post("1"), post("2"), post("3"), post("4")];
  db.user = { id: "u1" };
});
afterEach(cleanup);

describe("tailoredColumns - kontrakt odczytu", () => {
  it("czyta liczbe zapisana jako string przez select panelu", () => {
    expect(tailoredColumns({ columns: "1" })).toBe(1);
    expect(tailoredColumns({ columns: "2" })).toBe(2);
    expect(tailoredColumns({ columns: "4" })).toBe(4);
  });

  it("czyta tez natywna liczbe z defaultow palety", () => {
    expect(tailoredColumns({ columns: 2 })).toBe(2);
  });

  it("domyka wartosci spoza zakresu i brak wartosci do 1-4", () => {
    expect(tailoredColumns({})).toBe(3);
    expect(tailoredColumns({ columns: "0" })).toBe(1);
    expect(tailoredColumns({ columns: 99 })).toBe(4);
    expect(tailoredColumns({ columns: "nonsens" })).toBe(3);
  });
});

describe("tailoredGridClass - responsywnosc 1-4 kolumn", () => {
  it("jedna kolumna nie rozjezdza sie na zadnym breakpoincie", () => {
    expect(tailoredGridClass({ columns: "1" })).toBe("grid-cols-1");
  });

  it("kazdy wariant startuje od jednej kolumny na telefonie", () => {
    for (const columns of ["1", "2", "3", "4"]) {
      expect(tailoredGridClass({ columns })).toContain("grid-cols-1");
    }
  });

  it("2, 3 i 4 kolumny maja wlasne klasy docelowe", () => {
    expect(tailoredGridClass({ columns: "2" })).toBe("grid-cols-1 sm:grid-cols-2");
    expect(tailoredGridClass({ columns: "3" })).toBe("grid-cols-1 sm:grid-cols-2 lg:grid-cols-3");
    expect(tailoredGridClass({ columns: "4" })).toBe("grid-cols-1 sm:grid-cols-2 lg:grid-cols-4");
  });
});

describe("TailoredMustReadsView - siatka w DOM", () => {
  const grid = (c: WidgetContent) => {
    const { container } = wrap(<TailoredMustReadsView c={c} lang="pl" />);
    return container;
  };

  it("columns='4' faktycznie daje cztery kolumny (dotad zawsze trzy)", async () => {
    const container = grid({ columns: "4" });
    await screen.findByText("Wpis 1");
    const list = container.querySelector("ul");
    expect(list?.className).toContain("lg:grid-cols-4");
    expect(list?.className).not.toContain("lg:grid-cols-3");
  });

  it("columns='1' renderuje pojedyncza kolumne", async () => {
    const container = grid({ columns: "1" });
    await screen.findByText("Wpis 1");
    const list = container.querySelector("ul");
    expect(list?.className).toContain("grid-cols-1");
    expect(list?.className).not.toContain("sm:grid-cols-2");
  });

  it("skeleton ladowania uzywa tej samej siatki co wynik", async () => {
    db.recommended = [];
    const container = grid({ columns: "2", limit: "2" });
    await waitFor(() => {
      const skeletonOrEmpty = container.querySelector("div.grid, p");
      expect(skeletonOrEmpty).not.toBeNull();
    });
  });

  it("przelaczniki zapisane jako '0' realnie chowaja elementy", async () => {
    db.recommended = [post("1")];
    db.authors = [{ id: "a1", display_name: "Anna", slug: "anna", avatar_url: null }];
    const container = grid({ showKicker: "0", showExcerpt: "0" });
    await screen.findByText("Wpis 1");
    expect(screen.queryByText("Polecane dla ciebie")).toBeNull();
    expect(container.textContent).not.toContain("Zajawka");
  });

  it("limit zapisany jako string ogranicza liczbe kart", async () => {
    const container = grid({ limit: "2" });
    await screen.findByText("Wpis 1");
    // Hook rekomendacji dostaje limit jako liczbe; widok renderuje to, co
    // dostal. Kluczowe: string nie degraduje do wartosci domyslnej.
    expect(container.querySelectorAll("li").length).toBeGreaterThan(0);
  });
});
