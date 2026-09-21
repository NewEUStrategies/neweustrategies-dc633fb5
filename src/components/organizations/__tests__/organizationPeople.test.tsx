// CO TEN PLIK DOWODZI
// -------------------
// Sekcja osób ma dwie reguły, których złamanie jest CICHE:
//
// (1) ZERO TRAFIEŃ = SEKCJI NIE MA. Dopasowanie idzie po snapshocie tekstowym
//     (`profiles.current_company`), więc brak trafienia znaczy „nie umiemy
//     dopasować", a nie „nikt tu nie pracuje". Pusty nagłówek „Osoby" twierdzi
//     to drugie - i wygląda przy tym zupełnie poprawnie.
// (2) ZAPYTANIE DOSTAJE WSZYSTKIE WARIANTY NAZWY. Organizacja stoi w profilach
//     raz po polsku, raz po angielsku, raz nazwą z kartoteki CRM. Zawężenie do
//     jednej formy gubi część zespołu bez żadnego sygnału.
//
// Poza tym: każda osoba prowadzi na swój profil pod PRAWDZIWYM adresem, a
// stanowisko i odznaka weryfikacji są opcjonalne i nie zostawiają pustych
// wierszy.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE
// ---------------------------
// Kształtu zapytania (`.in`, limit, wyłączenie przy pustych nazwach) - to
// `src/lib/queries/__tests__/organization.test.ts`, gdzie stoi prawdziwa atrapa
// Supabase; tutaj `useQuery` jest atrapą, bo dowodzimy WIDOKU stanu, nie pobrania.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import type { OrganizationPerson } from "@/lib/queries/organization";

const state = vi.hoisted(() => ({
  people: [] as OrganizationPerson[],
  keys: [] as unknown[],
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: (options: { queryKey: unknown }) => {
    state.keys.push(options.queryKey);
    return { data: state.people };
  },
}));
// <Link> czyta kontekst routera - w teście prezentacyjnym wchodzi kotwica.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import { OrganizationPeople } from "@/components/organizations/OrganizationPeople";

function osoba(over: Partial<OrganizationPerson> = {}): OrganizationPerson {
  return {
    slug: "anna-nowak",
    name: "Anna Nowak",
    avatarUrl: null,
    jobTitle: "Analityczka",
    verified: false,
    ...over,
  };
}

function pokaz(names: readonly string[] = ["NATO"]) {
  return render(
    <OrganizationPeople
      companyNames={names}
      heading="organization.peopleHeading"
      verifiedLabel="organization.verified"
    />,
  );
}

beforeEach(() => {
  state.people = [];
  state.keys = [];
});

afterEach(cleanup);

describe("sekcja osób organizacji", () => {
  it("zero trafień usuwa CAŁĄ sekcję, razem z nagłówkiem", () => {
    pokaz();
    expect(screen.queryByText("organization.peopleHeading")).toBeNull();
    expect(document.body.textContent).toBe("");
  });

  it("wypisuje osoby i prowadzi każdą pod jej własny profil", () => {
    state.people = [osoba(), osoba({ slug: "jan-kowal", name: "Jan Kowal" })];
    pokaz();
    expect(screen.getByText("organization.peopleHeading")).toBeTruthy();
    const linki = Array.from(document.querySelectorAll("a[data-organization-person]"));
    expect(linki.map((a) => a.getAttribute("href"))).toEqual([
      "/author/anna-nowak",
      "/author/jan-kowal",
    ]);
  });

  it("zapytanie dostaje WSZYSTKIE warianty nazwy organizacji", () => {
    // Zawężenie do jednej formy gubi część zespołu bez żadnego sygnału.
    pokaz(["NATO", "North Atlantic Treaty Organization"]);
    expect(JSON.stringify(state.keys[0])).toContain("North Atlantic Treaty Organization");
    expect(JSON.stringify(state.keys[0])).toContain("NATO");
  });

  it("stanowisko jest opcjonalne - bez niego nie ma pustego wiersza", () => {
    state.people = [osoba({ jobTitle: null })];
    pokaz();
    expect(screen.getByText("Anna Nowak")).toBeTruthy();
    expect(screen.queryByText("Analityczka")).toBeNull();
  });

  it("bez zdjęcia wchodzą inicjały, a nie zepsuty obrazek", () => {
    state.people = [osoba()];
    pokaz();
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("AN")).toBeTruthy();
  });

  it("ze zdjęciem wchodzi obrazek dekoracyjny, bez dublowania nazwiska", () => {
    state.people = [osoba({ avatarUrl: "https://cdn.example/a.jpg" })];
    pokaz();
    const img = document.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://cdn.example/a.jpg");
    // Nazwisko stoi obok - powtórzone w `alt` czytnik przeczytałby dwa razy.
    expect(img?.getAttribute("alt")).toBe("");
  });

  it("odznakę weryfikacji dostaje tylko profil zweryfikowany", () => {
    state.people = [osoba({ verified: true }), osoba({ slug: "b", name: "Jan Kowal" })];
    pokaz();
    expect(screen.getAllByLabelText("organization.verified")).toHaveLength(1);
  });
});
