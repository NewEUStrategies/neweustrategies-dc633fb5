// POLE DANYCH MAPY W PANELU BUILDERA (`MapDataField`) I ARKUSZ MAPY
// (`MapDataDialog`) - kontrakt PR2:
//   * textarea przekłada wklejony ARKUSZ na format „ISO2; wartość" (kropka
//     dziesiętna, nazwy krajów rozwiązane), a zwykły tekst wkleja się po
//     staremu;
//   * „Edytuj w arkuszu" otwiera siatkę mapy z podglądem; każda zmiana to
//     JEDNA łatka (`setContentPatch`), a zamknięcie okna - także Escape'em -
//     najpierw zatwierdza szkic komórki z fokusem;
//   * zmiana treści Z ZEWNĄTRZ (cofnięcie w historii buildera) przebudowuje
//     siatkę, a echo własnego zapisu - nie.
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import "@/lib/i18n-map-editor";
import type { ContentPatch } from "@/lib/builder/schemas";
import { geoAssetQueryOptions } from "@/lib/charts/geoQuery";
import type { GeoAsset } from "@/lib/charts/types";
import { MapDataField } from "@/components/admin/builder/ui/molecules/MapDataField";
import { installWidgetGateFetch } from "@/test/widgetGateEnvironment";
import { CHART_GRID_ATTR, flushChartGridAt } from "../gridKeyboard";

installWidgetGateFetch();

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});

interface Opcje {
  value?: string;
}

/** Zasób Europy w pamięci podręcznej od startu - skorowidz krajów jest od razu. */
const EUROPA = JSON.parse(readFileSync("public/geo/europe-50m.v2.json", "utf8")) as GeoAsset;
function klient(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(geoAssetQueryOptions("europe").queryKey, EUROPA);
  return qc;
}

/** Panel z prawdziwym stanem treści widgetu - zapis wraca jako nowa treść. */
function zamontuj(opts: Opcje = {}) {
  const onChange = vi.fn<(v: string) => void>();
  const setContentPatch = vi.fn<(p: ContentPatch) => void>();
  let ustaw: (v: string) => void = () => undefined;
  function Host() {
    const [data, setData] = useState(opts.value ?? "PL; 12\nDE; 30");
    ustaw = setData;
    const content = { region: "europe", data, scheme: "blue", classes: "5", unit: "%" };
    return (
      <MapDataField
        value={data}
        onChange={(v) => {
          onChange(v);
          setData(v);
        }}
        region="europe"
        content={content}
        lang="pl"
        setContent={() => undefined}
        setContentPatch={(p) => {
          setContentPatch(p);
          const v = p.data;
          if (typeof v === "string") setData(v);
        }}
      />
    );
  }
  const view = render(
    <QueryClientProvider client={klient()}>
      <Host />
    </QueryClientProvider>,
  );
  return { onChange, setContentPatch, zewnetrzna: (v: string) => act(() => ustaw(v)), ...view };
}

function wklej(cel: Element, s: { text?: string; html?: string }) {
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", {
    value: {
      getData: (typ: string) => (typ === "text/html" ? (s.html ?? "") : (s.text ?? "")),
    },
  });
  act(() => {
    cel.dispatchEvent(ev);
  });
  return ev;
}

const otworz = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Edytuj w arkuszu" }));
  return screen.findByRole("dialog", { name: "Arkusz danych mapy" });
};

describe("textarea - wklejony arkusz zamienia się na „ISO2; wartość”", () => {
  it("tabela z nazwami krajów i przecinkiem dziesiętnym", () => {
    const { onChange, container } = zamontuj();
    const pole = container.querySelector("textarea");
    if (pole === null) throw new Error("brak pola");
    const ev = wklej(pole, { text: "Kraj\tWartość\nPolska\t12,5\nCzechy\t7\nNarnia\t3" });
    expect(ev.defaultPrevented).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith("PL; 12.5\nCZ; 7");
    expect(screen.getByText("Nierozpoznane kraje: Narnia.")).toBeInTheDocument();
  });

  it("zwykły tekst (gotowy format średnikowy) wkleja się po staremu", () => {
    const { onChange, container } = zamontuj();
    const pole = container.querySelector("textarea");
    if (pole === null) throw new Error("brak pola");
    const ev = wklej(pole, { text: "FR; 3" });
    expect(ev.defaultPrevented).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("„Edytuj w arkuszu” - siatka mapy z podglądem", () => {
  it("siatka czyta pole danych; nazwy krajów z zasobu regionu", async () => {
    zamontuj();
    const okno = await otworz();
    expect(
      (
        within(okno).getByRole("textbox", {
          name: "Kod albo nazwa kraju, wiersz 1",
        }) as HTMLInputElement
      ).value,
    ).toBe("PL");
    const siatka = within(okno).getByRole("table", { name: "Dane mapy - kraj i wartość" });
    expect(within(siatka).getByText("Polska")).toBeInTheDocument();
    expect(within(okno).getByText("Podgląd mapy")).toBeInTheDocument();
    expect(okno.querySelector(`[${CHART_GRID_ATTR}]`)).not.toBeNull();
  });

  it("zmiana komórki to JEDNA łatka z kluczem danych", async () => {
    const { setContentPatch } = zamontuj();
    const okno = await otworz();
    const kod = within(okno).getByRole("textbox", {
      name: "Kod albo nazwa kraju, wiersz 2",
    }) as HTMLInputElement;
    fireEvent.focus(kod);
    fireEvent.change(kod, { target: { value: "Czechy" } });
    fireEvent.blur(kod);
    expect(setContentPatch).toHaveBeenCalledTimes(1);
    expect(setContentPatch).toHaveBeenCalledWith({ data: "PL; 12\nCZ; 30" });
  });

  it("Escape zamyka okno, ale NAJPIERW zatwierdza wpisaną liczbę", async () => {
    const { setContentPatch } = zamontuj();
    const okno = await otworz();
    const wartosc = (await within(okno).findByRole("textbox", {
      name: "Polska - wartość",
    })) as HTMLInputElement;
    wartosc.focus();
    fireEvent.change(wartosc, { target: { value: "99,5" } });
    fireEvent.keyDown(wartosc, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(setContentPatch).toHaveBeenCalledTimes(1);
    expect(setContentPatch).toHaveBeenCalledWith({ data: "PL; 99.5\nDE; 30" });
  });

  it("„Zamknij” też zatwierdza szkic komórki", async () => {
    const { setContentPatch } = zamontuj();
    const okno = await otworz();
    const wartosc = (await within(okno).findByRole("textbox", {
      name: "Polska - wartość",
    })) as HTMLInputElement;
    wartosc.focus();
    fireEvent.change(wartosc, { target: { value: "5" } });
    fireEvent.click(within(okno).getByRole("button", { name: "Zamknij" }));
    expect(setContentPatch).toHaveBeenCalledWith({ data: "PL; 5\nDE; 30" });
  });

  it("Ctrl+Z w siatce: nic nie czeka na zapis, więc historia buildera cofa od razu", async () => {
    zamontuj();
    const okno = await otworz();
    const kod = within(okno).getByRole("textbox", { name: "Kod albo nazwa kraju, wiersz 1" });
    expect(flushChartGridAt(kod)).toBe(false);
  });

  it("zmiana treści z zewnątrz (cofnięcie) przebudowuje siatkę", async () => {
    const { zewnetrzna } = zamontuj();
    const okno = await otworz();
    zewnetrzna("FR; 1");
    await waitFor(() =>
      expect(
        (
          within(okno).getByRole("textbox", {
            name: "Kod albo nazwa kraju, wiersz 1",
          }) as HTMLInputElement
        ).value,
      ).toBe("FR"),
    );
    expect(
      within(okno).queryByRole("textbox", { name: "Kod albo nazwa kraju, wiersz 2" }),
    ).toBeNull();
  });

  it("wiersz bez wartości przeżywa zamknięcie i ponowne otwarcie okna", async () => {
    const { setContentPatch } = zamontuj();
    let okno = await otworz();
    fireEvent.click(within(okno).getByRole("button", { name: "Dodaj kraj" }));
    const nowy = within(okno).getByRole("textbox", { name: "Kod albo nazwa kraju, wiersz 3" });
    fireEvent.focus(nowy);
    fireEvent.change(nowy, { target: { value: "Francja" } });
    fireEvent.blur(nowy);
    expect(setContentPatch).toHaveBeenLastCalledWith({ data: "PL; 12\nDE; 30\nFR;" });
    fireEvent.click(within(okno).getByRole("button", { name: "Zamknij" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    okno = await otworz();
    expect(
      (
        within(okno).getByRole("textbox", {
          name: "Kod albo nazwa kraju, wiersz 3",
        }) as HTMLInputElement
      ).value,
    ).toBe("FR");
  });
});
