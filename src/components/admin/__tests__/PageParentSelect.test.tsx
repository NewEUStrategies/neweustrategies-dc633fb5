// Wybór strony nadrzędnej - `PageParentSelect`.
//
// CO TEN PLIK PRZYPINA I DLACZEGO. Ta lista buduje DRZEWO stron z płaskiej
// tabeli i musi z niego wyciąć poddrzewo strony edytowanej. Błąd tutaj nie
// jest kosmetyczny: ustawienie strony jako rodzica samej siebie (albo swojego
// potomka) tworzy CYKL w drzewie, a cykl zapętla wyliczanie ścieżki
// (`page_full_path`) i menu okruszków. Dlatego przypinam:
//   1. WYKLUCZENIE OBEJMUJE CAŁE PODDRZEWO, nie tylko sam wiersz. `walk`
//      przerywa zejście na wykluczonym węźle (`continue`), więc znikają też
//      dzieci i wnuki - to jest jedyna bariera przed cyklem w tym widoku.
//   2. WCIĘCIE POKAZUJE GŁĘBOKOŚĆ. Etykieta dostaje prefiks `"- "` powtórzony
//      tyle razy, ile wynosi poziom; bez tego płaska lista dwudziestu stron
//      nie mówi redaktorowi nic o strukturze.
//   3. TYTUŁ SPADA NA JĘZYK ZAPASOWY, A POTEM NA SLUG. Strona bez tytułu PL
//      pokazuje tytuł EN, a bez obu - slug. Pusta pozycja na liście byłaby
//      nie do wybrania.
//   4. "BRAK RODZICA" TO WARTOŚĆ SPECJALNA `__none__`, KTÓRA WRACA JAKO
//      `null`. Zapisany napis `"__none__"` w kolumnie `parent_id` (uuid)
//      wywróciłby zapis wpisu.
//   5. ZAPYTANIE JEST ZAWĘŻONE DO TENANTA I POMIJA KOSZ (`deleted_at is null`)
//      - inaczej redaktor podpinałby stronę pod usunięty albo cudzy rekord.
//
// Radix Select nie otwiera listy pod happy-dom (potrzebuje pointer API i
// pomiarów układu), więc jest podmieniony na natywny `<select>`; asercje
// dotyczą PEŁNEJ listy opcji, a nie warstwy rozwijanej.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { fail, ok, supabaseFromStub } from "@/test/supabase";
import { radixSelectStub } from "@/test/reactStubs";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const baza = supabaseFromStub();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => baza.from(table) },
}));
vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/components/ui/select", async () => radixSelectStub(await import("react")));

const { PageParentSelect } = await import("@/components/admin/PageParentSelect");

interface WierszStrony {
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  parent_id: string | null;
}

function strona(over: Partial<WierszStrony> & Pick<WierszStrony, "id">): WierszStrony {
  return {
    slug: `slug-${over.id}`,
    title_pl: `Strona ${over.id}`,
    title_en: `Page ${over.id}`,
    parent_id: null,
    ...over,
  };
}

/**
 * Drzewo używane w większości przypadków:
 *   o-nas
 *     zespol
 *       redakcja
 *   kontakt
 */
const DRZEWO: WierszStrony[] = [
  strona({ id: "o-nas", title_pl: "O nas" }),
  strona({ id: "zespol", title_pl: "Zespół", parent_id: "o-nas" }),
  strona({ id: "redakcja", title_pl: "Redakcja", parent_id: "zespol" }),
  strona({ id: "kontakt", title_pl: "Kontakt" }),
];

function renderuj(opcje: {
  rows?: WierszStrony[];
  value?: string | null;
  excludeId?: string;
  label?: string;
  noneLabel?: string;
}) {
  baza.reset();
  baza.setResponse("pages", ok(opcje.rows ?? DRZEWO));
  const onChange = vi.fn<(v: string | null) => void>();
  const utils = renderWithQueryClient(
    <PageParentSelect
      tenantId="tenant-1"
      value={opcje.value ?? null}
      onChange={onChange}
      excludeId={opcje.excludeId}
      label={opcje.label}
      noneLabel={opcje.noneLabel}
    />,
  );
  return { ...utils, onChange };
}

/**
 * Widoczne etykiety opcji, w kolejności renderu. Lista renderuje się od razu
 * (z samą pozycją "brak rodzica"), a strony dochodzą po rozwiązaniu zapytania -
 * dlatego czekamy na SPODZIEWANĄ liczbę pozycji, zanim czytamy etykiety.
 */
async function opcje(oczekiwane: number): Promise<string[]> {
  const lista = await screen.findByRole("combobox");
  await waitFor(() => expect(within(lista).getAllByRole("option")).toHaveLength(oczekiwane));
  return within(lista)
    .getAllByRole("option")
    .map((o) => o.textContent ?? "");
}

describe("PageParentSelect - odczyt drzewa stron", () => {
  it("pyta o strony ZAWĘŻONE do tenanta i z pominięciem kosza", async () => {
    renderuj({});

    await opcje(5);
    const lancuch = baza.lastChain("pages");
    expect(lancuch?.argsOf("eq")).toEqual(["tenant_id", "tenant-1"]);
    expect(lancuch?.argsOf("is")).toEqual(["deleted_at", null]);
    expect(lancuch?.argsOf("select")).toEqual(["id, slug, title_pl, title_en, parent_id"]);
  });

  it("przed odpowiedzią pokazuje samą pozycję 'brak rodzica'", () => {
    renderuj({});

    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("układa strony w drzewo i wcina potomków według głębokości", async () => {
    renderuj({});

    expect(await opcje(5)).toEqual([
      "adminPanesMisc.pageParent.none",
      "O nas",
      "- Zespół",
      "- - Redakcja",
      "Kontakt",
    ]);
  });

  it("pusta odpowiedź (brak stron) zostawia samą pozycję 'brak rodzica'", async () => {
    baza.reset();
    baza.setResponse("pages", ok(null));
    renderWithQueryClient(<PageParentSelect tenantId="tenant-1" value={null} onChange={vi.fn()} />);

    await waitFor(() => expect(baza.chainsFor("pages").length).toBeGreaterThan(0));
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("błąd odczytu NIE wymyśla listy stron - zostaje sama pozycja 'brak rodzica'", async () => {
    baza.reset();
    baza.setResponse("pages", fail("permission denied for table pages", "42501"));
    renderWithQueryClient(<PageParentSelect tenantId="tenant-1" value={null} onChange={vi.fn()} />);

    await waitFor(() => expect(baza.chainsFor("pages").length).toBeGreaterThan(0));
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("sierota (rodzic spoza listy) NIE trafia na listę - `walk` startuje od korzeni", async () => {
    renderuj({
      rows: [
        strona({ id: "korzen", title_pl: "Korzeń" }),
        strona({ id: "sierota", parent_id: "nie-ma" }),
      ],
    });

    expect(await opcje(2)).toEqual(["adminPanesMisc.pageParent.none", "Korzeń"]);
  });
});

describe("PageParentSelect - wykluczenie poddrzewa chroni przed cyklem", () => {
  it("wyklucza stronę edytowaną RAZEM z jej dziećmi i wnukami", async () => {
    renderuj({ excludeId: "o-nas" });

    expect(await opcje(2)).toEqual(["adminPanesMisc.pageParent.none", "Kontakt"]);
  });

  it("wykluczenie węzła środkowego zostawia jego rodzica, zabiera jego potomków", async () => {
    renderuj({ excludeId: "zespol" });

    expect(await opcje(3)).toEqual(["adminPanesMisc.pageParent.none", "O nas", "Kontakt"]);
  });

  it("bez `excludeId` na liście jest całe drzewo", async () => {
    renderuj({ excludeId: undefined });

    expect(await opcje(5)).toHaveLength(5);
  });
});

describe("PageParentSelect - etykiety pozycji", () => {
  it("brak tytułu PL spada na tytuł EN, brak obu - na slug", async () => {
    renderuj({
      rows: [
        strona({ id: "a", title_pl: "", title_en: "Only English" }),
        strona({ id: "b", title_pl: "", title_en: "", slug: "tylko-slug" }),
      ],
    });

    expect(await opcje(3)).toEqual([
      "adminPanesMisc.pageParent.none",
      "Only English",
      "tylko-slug",
    ]);
  });

  it("etykieta pola i podpis pozycji zerowej biorą się ze słownika", async () => {
    renderuj({});

    await opcje(5);
    expect(screen.getByText("adminPanesMisc.pageParent.label")).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "adminPanesMisc.pageParent.none" }),
    ).toBeInTheDocument();
  });

  it("własna etykieta i własny podpis 'brak rodzica' nadpisują domyślne", async () => {
    renderuj({ label: "Rodzic sekcji", noneLabel: "- najwyższy poziom -" });

    await opcje(5);
    expect(screen.getByText("Rodzic sekcji")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "- najwyższy poziom -" })).toBeInTheDocument();
    expect(screen.queryByText("adminPanesMisc.pageParent.label")).not.toBeInTheDocument();
  });

  it("pusta etykieta ukrywa cały wiersz podpisu", async () => {
    renderuj({ label: "" });

    await opcje(5);
    expect(screen.queryByText("adminPanesMisc.pageParent.label")).not.toBeInTheDocument();
  });
});

describe("PageParentSelect - wybór wraca do rodzica", () => {
  it("wybór strony oddaje jej identyfikator", async () => {
    const { onChange } = renderuj({});

    await opcje(5);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "zespol" } });

    expect(onChange).toHaveBeenCalledWith("zespol");
  });

  it("wybór 'brak rodzica' oddaje `null`, a nie napis `__none__`", async () => {
    const { onChange } = renderuj({ value: "zespol" });

    await opcje(5);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "__none__" } });

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("brak rodzica w propie ustawia listę na pozycję `__none__`", async () => {
    renderuj({ value: null });

    expect(await screen.findByRole("combobox")).toHaveValue("__none__");
  });

  it("ustawiony rodzic jest zaznaczony na liście", async () => {
    renderuj({ value: "kontakt" });

    await opcje(5);
    expect(screen.getByRole("combobox")).toHaveValue("kontakt");
  });
});
