// EDYTORY `pricing-table` I `timeline` - REPEATERY PLANÓW I ETAPÓW.
//
// PO CO TEN PLIK. Oba edytory przy KAŻDEJ zmianie przepisują całą listę
// (`plans` / `items`) z pozycji znormalizowanych w renderze. To jedno miejsce
// decyduje, czy zmiana ceny planu „Pro" nie przestawi wyróżnienia planu
// „Basic", i czy dziura z importu nie wejdzie do treści jako słowo „null".
//
// CO MA TU DOWÓD
//  * każde pole planu i etapu zapisuje się pod WŁASNYM kluczem, wyłącznie
//    w TEJ pozycji listy; dopisanie i usunięcie trafia w TĘ pozycję,
//  * wyróżnienie planu to PRAWDZIWA wartość logiczna - napis „true" z importu
//    nie jest wyróżnieniem, bo renderer (`PricingTableView`) też wymaga `true`,
//  * lista funkcji planu: jedna funkcja na linię, puste linie i spacje na
//    końcu NIE trafiają do dokumentu,
//  * funkcja `null`/obiekt z importu NIE pojawia się w polu jako „null"
//    albo „[object Object]" - inaczej pierwsza edycja planu zapisałaby ten
//    napis jako prawdziwą funkcję, widoczną na stronie.
//
// GRANICE. Fabryki `vi.mock` niesie moduł wspólny tabeli edytorów (import
// PIERWSZY). i18n PRAWDZIWE (`realT`).
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { renderEditor } from "./blockEditMatrix.shared";
import type { Block, BlockType, Json } from "@/lib/blocks/types";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-blocks";
import { PricingTableBlock, TimelineBlock } from "../PresentationBlocks";

const t = realT("pl");
const pb = (key: string) => t(`blocks.editors.presentationBlocks.${key}`) as string;
const pole = (key: string) => t(`blocks.fields.${key}`) as string;

function blok(type: BlockType, data: Record<string, Json>): Block {
  return { id: `blk-${type}`, type, data };
}

function ostatniZapis(changes: Block[]): Block {
  expect(changes.length, "edytor nie zapisał niczego").toBeGreaterThan(0);
  return changes[changes.length - 1];
}

const BASIC = {
  name: "Basic",
  price: "0",
  period: "/mies.",
  description: "Na start",
  features: ["Raporty"],
  ctaLabel: "Zacznij",
  ctaHref: "/start",
  featured: false,
};
const PRO = {
  ...BASIC,
  name: "Pro",
  price: "49",
  features: ["Raporty", "Wsparcie"],
  featured: true,
};

describe("tabela cenowa - pola planu", () => {
  it.each([
    [pb("planName"), "name", "Enterprise"],
    [pb("price"), "price", "199 PLN"],
    [pb("period"), "period", "/rok"],
    [pb("shortDesc"), "description", "Dla zespołów"],
    [pb("ctaLabel"), "ctaLabel", "Kup"],
    [pb("ctaUrl"), "ctaHref", "/kup"],
  ])("pole „%s” drugiego planu zapisuje `%s` TYLKO w nim", (placeholder, klucz, wartosc) => {
    const start = blok("pricing-table", { plans: [BASIC, PRO] });
    const { changes } = renderEditor(PricingTableBlock, start);
    fireEvent.change(screen.getAllByPlaceholderText(placeholder)[1], {
      target: { value: wartosc },
    });
    const zapis = ostatniZapis(changes);
    expect(zapis).toMatchObject({ id: start.id, type: "pricing-table" });
    expect(zapis.data.plans).toEqual([BASIC, { ...PRO, [klucz]: wartosc }]);
  });

  it("wyróżnienie zaznacza się dla TEGO planu i zapisuje prawdziwą wartość logiczną", () => {
    const { changes } = renderEditor(
      PricingTableBlock,
      blok("pricing-table", { plans: [BASIC, PRO] }),
    );
    const wyroznione = screen.getAllByRole("checkbox", { name: pb("featured") });
    expect(wyroznione.map((c) => (c as HTMLInputElement).checked)).toEqual([false, true]);
    fireEvent.click(wyroznione[0]);
    expect(ostatniZapis(changes).data.plans).toEqual([{ ...BASIC, featured: true }, PRO]);
  });

  it("napis „true” z importu NIE jest wyróżnieniem - jak w rendererze", () => {
    renderEditor(
      PricingTableBlock,
      blok("pricing-table", { plans: [{ ...BASIC, featured: "true" }] as Json }),
    );
    expect(screen.getByRole("checkbox", { name: pb("featured") })).not.toBeChecked();
  });
});

describe("tabela cenowa - lista funkcji", () => {
  it("funkcje planu pokazują się po jednej w linii", () => {
    renderEditor(PricingTableBlock, blok("pricing-table", { plans: [PRO] }));
    expect(screen.getByPlaceholderText<HTMLTextAreaElement>(pb("features")).value).toBe(
      "Raporty\nWsparcie",
    );
  });

  it("zapis dzieli tekst na linie, ucina spacje na końcu i pomija puste linie", () => {
    const { changes } = renderEditor(PricingTableBlock, blok("pricing-table", { plans: [BASIC] }));
    fireEvent.change(screen.getByPlaceholderText(pb("features")), {
      target: { value: "Raporty  \n\n  Wsparcie 24/7\n" },
    });
    expect((ostatniZapis(changes).data.plans as { features: Json }[])[0].features).toEqual([
      "Raporty",
      "  Wsparcie 24/7",
    ]);
  });

  // NOWY DEFEKT (znaleziony 2026-10-18, NAPRAWIONY w tym samym kroku): pole
  // funkcji czytało wartość z OCZYSZCZONEGO zapisu (`features.join("\n")`),
  // a zapis ucina spacje na końcu i puste linie. Edytor jest sterowany przez
  // dokument, więc po każdym znaku pole dostawało tekst bez spacji i bez
  // nowej linii: „Raporty " -> „Raporty", „Raporty⏎" -> „Raporty". Redaktor
  // nie mógł wpisać funkcji ze spacją ani dodać drugiej funkcji Enterem na
  // końcu - dało się to tylko wklejając gotowy tekst. Harness trzyma blok
  // w stanie, dokładnie jak kanwa edytora wpisu.
  it("pisanie w polu funkcji NIE zjada spacji ani Entera na końcu linii", () => {
    function Kanwa({ poczatek }: { poczatek: Block }) {
      const [b, setB] = useState(poczatek);
      return <PricingTableBlock block={b} onChange={setB} />;
    }
    render(<Kanwa poczatek={blok("pricing-table", { plans: [{ ...BASIC, features: [] }] })} />);
    const funkcje = screen.getByPlaceholderText<HTMLTextAreaElement>(pb("features"));
    for (const krok of ["R", "Raporty", "Raporty ", "Raporty k", "Raporty kwartalne"]) {
      fireEvent.change(funkcje, { target: { value: krok } });
      expect(funkcje.value).toBe(krok);
    }
    fireEvent.change(funkcje, { target: { value: "Raporty kwartalne\n" } });
    expect(funkcje.value).toBe("Raporty kwartalne\n");
    fireEvent.change(funkcje, { target: { value: "Raporty kwartalne\nWsparcie" } });
    expect(funkcje.value).toBe("Raporty kwartalne\nWsparcie");
    // Po wyjściu z pola widać dokładnie to, co trafiło do dokumentu.
    fireEvent.change(funkcje, { target: { value: "Raporty kwartalne\nWsparcie \n\n" } });
    fireEvent.blur(funkcje);
    expect(funkcje.value).toBe("Raporty kwartalne\nWsparcie");
  });

  it("zmiana funkcji z ZEWNĄTRZ (np. cofnięcie) wygrywa ze szkicem pola", () => {
    // Szkic pola żyje tylko, dopóki zgadza się z dokumentem - inaczej cofnięcie
    // zmiany w trakcie pisania zostawiłoby w polu tekst, którego nie ma w treści.
    const v1 = blok("pricing-table", { plans: [{ ...BASIC, features: ["A"] }] });
    const { rerender } = render(<PricingTableBlock block={v1} onChange={() => {}} />);
    const funkcje = screen.getByPlaceholderText<HTMLTextAreaElement>(pb("features"));
    fireEvent.change(funkcje, { target: { value: "A " } });
    const v2 = blok("pricing-table", { plans: [{ ...BASIC, features: ["Cofnięte"] }] });
    rerender(<PricingTableBlock block={v2} onChange={() => {}} />);
    expect(funkcje.value).toBe("Cofnięte");
  });

  it("funkcja `null` albo obiekt z importu NIE pojawia się jako „null” / „[object Object]”", () => {
    // Renderer pokazuje dziś `String(f)`, ale edytor nie może utrwalać tego
    // napisu: pierwsza edycja planu zapisałaby „null" jako prawdziwą funkcję.
    const { changes } = renderEditor(
      PricingTableBlock,
      blok("pricing-table", {
        plans: [{ ...BASIC, features: ["Raporty", null, { x: 1 }, 10] }] as unknown as Json,
      }),
    );
    const funkcje = screen.getByPlaceholderText<HTMLTextAreaElement>(pb("features"));
    expect(funkcje.value).toBe("Raporty\n10");
    // Edycja INNEGO pola planu zapisuje listę już oczyszczoną.
    fireEvent.change(screen.getByPlaceholderText(pb("price")), { target: { value: "5" } });
    expect((ostatniZapis(changes).data.plans as { features: Json }[])[0].features).toEqual([
      "Raporty",
      "10",
    ]);
  });
});

describe("tabela cenowa - dopisanie i usunięcie planu", () => {
  it("dopisanie dokłada pusty, niewyróżniony plan na końcu", () => {
    const { changes } = renderEditor(PricingTableBlock, blok("pricing-table", { plans: [PRO] }));
    fireEvent.click(screen.getByRole("button", { name: pb("addPlan") }));
    expect(ostatniZapis(changes).data.plans).toEqual([
      PRO,
      {
        name: "",
        price: "",
        period: "",
        description: "",
        features: [],
        ctaLabel: "",
        ctaHref: "",
        featured: false,
      },
    ]);
  });

  it("usunięcie zabiera TEN plan, a wyróżnienie zostaje przy swoim planie", () => {
    const { changes } = renderEditor(
      PricingTableBlock,
      blok("pricing-table", { plans: [BASIC, PRO] }),
    );
    fireEvent.click(screen.getAllByRole("button", { name: pb("removePlan") })[0]);
    expect(ostatniZapis(changes).data.plans).toEqual([PRO]);
  });

  it("`plans` jako napis i plan `null` nie wywracają edytora i nie pokazują „null”", () => {
    const { container, unmount } = renderEditor(
      PricingTableBlock,
      blok("pricing-table", { plans: "trzy plany" }),
    );
    expect(screen.queryAllByPlaceholderText(pb("planName"))).toHaveLength(0);
    expect(screen.getByRole("button", { name: pb("addPlan") })).toBeInTheDocument();
    unmount();

    const drugi = renderEditor(
      PricingTableBlock,
      blok("pricing-table", { plans: [null] as unknown as Json }),
    );
    expect(screen.getByPlaceholderText<HTMLInputElement>(pb("planName")).value).toBe("");
    expect(drugi.container.textContent).not.toContain("null");
    expect(container.textContent).not.toContain("null");
  });
});

describe("oś czasu", () => {
  const etapy: Json = [
    { date: "2024", title: "Założenie", description: "" },
    { date: "2026", title: "Ekspansja", description: "Biura w trzech krajach." },
  ];

  it.each([
    [pb("date"), "date", "2025"],
    [pole("title"), "title", "Pierwszy klient"],
    [pb("descOptional"), "description", "Umowa ramowa."],
  ])("pole „%s” pierwszego etapu zapisuje `%s` TYLKO w nim", (placeholder, klucz, wartosc) => {
    const { changes } = renderEditor(TimelineBlock, blok("timeline", { items: etapy }));
    fireEvent.change(screen.getAllByPlaceholderText(placeholder)[0], {
      target: { value: wartosc },
    });
    const items = ostatniZapis(changes).data.items as Json[];
    expect(items[0]).toEqual({ ...((etapy as Json[])[0] as object), [klucz]: wartosc });
    expect(items[1]).toEqual((etapy as Json[])[1]);
  });

  it("dopisanie dokłada pusty etap na końcu, usunięcie zabiera TEN etap", () => {
    const { changes } = renderEditor(TimelineBlock, blok("timeline", { items: etapy }));
    fireEvent.click(screen.getByRole("button", { name: pb("addStage") }));
    expect(ostatniZapis(changes).data.items).toEqual([
      ...(etapy as Json[]),
      { date: "", title: "", description: "" },
    ]);
    fireEvent.click(screen.getAllByRole("button", { name: pb("removeStage") })[0]);
    expect(ostatniZapis(changes).data.items).toEqual([(etapy as Json[])[1]]);
  });

  it("rok zapisany LICZBĄ pokazuje się w polu daty, a etap `null` daje puste pola", () => {
    // Renderer (`TimelineView`) czyta datę przez `String(…)`, więc 2024 jako
    // liczba to „2024" na stronie - edytor musi pokazać to samo.
    const { container, changes } = renderEditor(
      TimelineBlock,
      blok("timeline", { items: [{ date: 2024, title: "Start" }, null] as unknown as Json }),
    );
    expect(
      screen.getAllByPlaceholderText<HTMLInputElement>(pb("date")).map((i) => i.value),
    ).toEqual(["2024", ""]);
    expect(container.textContent).not.toContain("null");
    expect(changes).toEqual([]);
  });

  it("`items` jako napis daje pustą oś z przyciskiem dopisania, bez awarii", () => {
    const { changes } = renderEditor(TimelineBlock, blok("timeline", { items: "2024-2026" }));
    expect(screen.queryAllByPlaceholderText(pb("date"))).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: pb("addStage") }));
    expect(ostatniZapis(changes).data.items).toEqual([{ date: "", title: "", description: "" }]);
  });
});
