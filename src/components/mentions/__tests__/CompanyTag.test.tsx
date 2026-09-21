// Firma jako tag z dymkiem marki - `CompanyTag`.
//
// CO TEN PLIK DOWODZI.
// (1) BRAK FIRMY NIE ZOSTAWIA DZIURY. Komponent zwraca `null`, więc wywołujący
//     nie musi warunkować renderu ani pamiętać o separatorze - separator należy
//     do tego komponentu i znika razem z nim. To jest CAŁY mechanizm obietnicy
//     „brak firmy = element znika w całości, bez pustego `<span>`".
// (2) LENIWOŚĆ. Zapytanie o markę rusza DOPIERO po otwarciu dymka. Lista
//     dwudziestu odpowiedzi nie może zrobić dwudziestu wyjść do bazy przy
//     renderze - a regresja jest niewidoczna gołym okiem, bo wygląd nie zmienia
//     się ani na jotę.
// (3) BRAK TRAFIENIA W KARTOTECE TO NORMALNY STAN. Nazwa firmy w profilu jest
//     snapshotem tekstowym, więc „nie znaleziono marki" ma pokazać samą nazwę,
//     a nie komunikat o błędzie i nie puste pudełko.
// (4) Z MARKĄ dymek pokazuje logo, branżę i odnośnik do strony - z pełnym
//     `rel` wyjścia na zewnątrz.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// (a) WARSTWY DANYCH `useCompanyBrand` (RPC `crm_company_brand`, klucz cache,
//     czyszczenie pól) - tu jest atrapą; testujemy WIDOK stanu, nie pobranie.
// (b) BIBLIOTEK: pozycjonowania i opóźnień Radiksa - dymek otwieramy fokusem
//     (dostępna droga klawiaturą) i czekamy `waitFor`.
// (c) MIEJSCA UŻYCIA (bylina wpisu klubowego) - to `ClubAuthorIdentity`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type { CompanyBrand } from "@/lib/mentions/useCompanyBrand";

const state = vi.hoisted(() => ({
  brand: { data: null as CompanyBrand | null, isPending: false },
  calls: [] as Array<{ name: string | null; enabled: boolean }>,
}));

vi.mock("@/lib/mentions/useCompanyBrand", () => ({
  useCompanyBrand: (name: string | null, enabled: boolean) => {
    state.calls.push({ name, enabled });
    return state.brand;
  },
}));

import { CompanyTag } from "@/components/mentions/CompanyTag";

const LABELS = { website: "etykieta.website" };

function brand(over: Partial<CompanyBrand> = {}): CompanyBrand {
  return { name: "ACME S.A.", logoUrl: null, website: null, branch: null, ...over };
}

function triggerFor(name: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-company="${name}"]`);
  if (found === null) throw new Error(`test: brak tagu firmy "${name}"`);
  return found;
}

async function openCard(trigger: HTMLElement): Promise<HTMLElement> {
  fireEvent.focusIn(trigger);
  return await waitFor(() => screen.getByTestId("company-preview"));
}

beforeEach(() => {
  state.brand = { data: null, isPending: false };
  state.calls = [];
});

describe("CompanyTag - brak firmy", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["pusty napis", ""],
    ["same spacje", "   "],
  ])("nazwa %s -> komponent NIE renderuje nic", (_opis, name) => {
    // Regresja, którą to łapie: render pustego tagu. Wywołujący skleja firmę
    // z nazwiskiem separatorem, więc pusty element daje „Anna Nowak ·".
    const { container } = render(<CompanyTag name={name} labels={LABELS} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("brak nazwy nie odpala zapytania o markę", () => {
    render(<CompanyTag name={null} labels={LABELS} />);

    expect(state.calls.every((call) => call.enabled === false)).toBe(true);
  });
});

describe("CompanyTag - wyzwalacz", () => {
  it("niesie nazwę w atrybucie danych i pokazuje ją w linii", () => {
    render(<CompanyTag name="ACME" labels={LABELS} />);
    const trigger = triggerFor("ACME");

    expect(trigger.tagName).toBe("BUTTON");
    // Wyzwalacz MUSI być fokusowalny - inaczej dymek nie istnieje dla klawiatury.
    expect(trigger).toHaveAttribute("type", "button");
    expect(trigger.textContent).toBe("ACME");
  });

  it("`className` DOKŁADA klasę wywołującego, nie podmienia własnych", () => {
    render(<CompanyTag name="ACME" labels={LABELS} className="text-[11px]" />);
    const trigger = triggerFor("ACME");

    expect(trigger.classList.contains("text-[11px]")).toBe(true);
    expect(trigger.classList.contains("truncate")).toBe(true);
  });

  it("ikona przy nazwie jest dekoracją - nie dubluje nazwy czytnikowi", () => {
    render(<CompanyTag name="ACME" labels={LABELS} />);

    expect(triggerFor("ACME").querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("CompanyTag - leniwość dymka", () => {
  it("NIE pyta o markę przed otwarciem dymka", () => {
    render(
      <>
        <CompanyTag name="ACME" labels={LABELS} />
        <CompanyTag name="Orlen" labels={LABELS} />
      </>,
    );

    expect(state.calls).toHaveLength(2);
    expect(state.calls.every((call) => call.enabled === false)).toBe(true);
    expect(state.calls.map((call) => call.name)).toEqual(["ACME", "Orlen"]);
  });

  it("pyta DOPIERO po otwarciu i tylko o swoją firmę", async () => {
    render(
      <>
        <CompanyTag name="ACME" labels={LABELS} />
        <CompanyTag name="Orlen" labels={LABELS} />
      </>,
    );
    await openCard(triggerFor("ACME"));

    const enabled = state.calls.filter((call) => call.enabled);
    expect(enabled.length).toBeGreaterThan(0);
    expect(enabled.every((call) => call.name === "ACME")).toBe(true);
  });
});

describe("CompanyTag - stany dymka", () => {
  it("w trakcie ładowania pokazuje szkielety", async () => {
    state.brand = { data: null, isPending: true };
    render(<CompanyTag name="ACME" labels={LABELS} />);
    const card = await openCard(triggerFor("ACME"));

    expect(card.querySelectorAll(".animate-pulse")).toHaveLength(3);
  });

  it("brak trafienia w kartotece pokazuje SAMĄ nazwę - bez logo i bez www", async () => {
    // Firma wpisana ręcznie (albo po zmianie nazwy w CRM) nie znajdzie się
    // w kartotece; to nie awaria, więc dymek nie może być pusty ani krzyczeć.
    state.brand = { data: null, isPending: false };
    render(<CompanyTag name="ACME" labels={LABELS} />);
    const card = await openCard(triggerFor("ACME"));

    expect(within(card).getByText("ACME")).toBeInTheDocument();
    expect(card.querySelector("img")).toBeNull();
    expect(within(card).queryByText(LABELS.website)).toBeNull();
  });

  it("z marką pokazuje logo, branżę i odnośnik do strony", async () => {
    state.brand = {
      data: brand({
        logoUrl: "https://cdn.example.com/acme.png",
        website: "https://acme.example",
        branch: "Energetyka",
      }),
      isPending: false,
    };
    render(<CompanyTag name="ACME" labels={LABELS} />);
    const card = await openCard(triggerFor("ACME"));

    // Nazwa z kartoteki WYGRYWA ze snapshotem z profilu.
    expect(within(card).getByText("ACME S.A.")).toBeInTheDocument();
    expect(within(card).getByText("Energetyka")).toBeInTheDocument();
    expect(card.querySelector("img")).toHaveAttribute("src", "https://cdn.example.com/acme.png");

    const link = within(card).getByRole("link", { name: LABELS.website });
    expect(link).toHaveAttribute("href", "https://acme.example");
    expect(link).toHaveAttribute("target", "_blank");
    // Bez `noopener` otwarta strona dostaje dostęp do `window.opener`.
    const rel = (link.getAttribute("rel") ?? "").split(/\s+/);
    expect(rel).toEqual(expect.arrayContaining(["noopener", "noreferrer"]));
  });

  it("marka bez logo daje ikonę zastępczą, nie pustą ramkę", async () => {
    state.brand = { data: brand({ logoUrl: null }), isPending: false };
    render(<CompanyTag name="ACME" labels={LABELS} />);
    const card = await openCard(triggerFor("ACME"));

    expect(card.querySelector("img")).toBeNull();
    expect(card.querySelector("svg")).not.toBeNull();
  });

  it("marka bez branży nie zostawia pustego wiersza", async () => {
    state.brand = { data: brand({ branch: null }), isPending: false };
    render(<CompanyTag name="ACME" labels={LABELS} />);
    const card = await openCard(triggerFor("ACME"));

    expect(card.querySelectorAll("p")).toHaveLength(1);
  });

  it("`testId` zmienia identyfikator dymka", async () => {
    render(<CompanyTag name="ACME" labels={LABELS} testId="club-company-preview" />);
    fireEvent.focusIn(triggerFor("ACME"));

    await waitFor(() => expect(screen.getByTestId("club-company-preview")).toBeInTheDocument());
    expect(screen.queryByTestId("company-preview")).toBeNull();
  });
});
