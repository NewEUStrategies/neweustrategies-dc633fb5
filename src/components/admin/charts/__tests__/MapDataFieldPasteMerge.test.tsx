// POLE DANYCH MAPY W BUILDERZE - wklejenie arkusza NIE kasuje pola.
//
// Do poprawki tabela ze schowka zastępowała całe pole: jeden wiersz
// skopiowany z arkusza („IT<TAB>59") zostawiał w polu tylko Włochy, a tabela,
// której kształtu textarea nie rozpoznała („Lp. | Kraj | Wartość"), czyściła
// pole do zera. Teraz:
//   * pole puste albo zaznaczone w całości - tabela je zastępuje;
//   * w każdym innym razie kraje DOCHODZĄ do wierszy pola (kraj, który pole
//     ma, dostaje nową wartość), a reszta zostaje co do znaku;
//   * gdy nie wyszedł żaden kraj - pole zostaje, a pod nim stoją problemy;
//   * kształt tabeli rozpoznaje to samo, co podgląd siatki.
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import "@/lib/i18n-map-editor";
import { geoAssetQueryOptions } from "@/lib/charts/geoQuery";
import type { GeoAsset } from "@/lib/charts/types";
import { MapDataField } from "@/components/admin/builder/ui/molecules/MapDataField";
import { installWidgetGateFetch } from "@/test/widgetGateEnvironment";

installWidgetGateFetch();

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});

const EUROPA = JSON.parse(readFileSync("public/geo/europe-50m.v2.json", "utf8")) as GeoAsset;

function zamontuj(poczatek: string) {
  const onChange = vi.fn<(v: string) => void>();
  let biezace = poczatek;
  function Host() {
    const [data, setData] = useState(poczatek);
    return (
      <MapDataField
        value={data}
        onChange={(v) => {
          biezace = v;
          onChange(v);
          setData(v);
        }}
        region="europe"
        content={{ region: "europe", data }}
        lang="pl"
      />
    );
  }
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(geoAssetQueryOptions("europe").queryKey, EUROPA);
  const view = render(
    <QueryClientProvider client={qc}>
      <Host />
    </QueryClientProvider>,
  );
  const pole = view.container.querySelector("textarea");
  if (pole === null) throw new Error("brak pola");
  return { onChange, pole, stan: () => biezace };
}

function wklej(cel: HTMLTextAreaElement, text: string) {
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", {
    value: { getData: (typ: string) => (typ === "text/html" ? "" : text) },
  });
  act(() => {
    cel.dispatchEvent(ev);
  });
  return ev;
}

const POLE = "PL; 38\nDE; 84\nFR; 68";

describe("wklejenie arkusza do niepustego pola", () => {
  it("jeden wiersz z arkusza dopisuje kraj - pozostałe zostają", () => {
    const { pole, stan } = zamontuj(POLE);
    pole.setSelectionRange(POLE.length, POLE.length);
    const ev = wklej(pole, "IT\t59");
    expect(ev.defaultPrevented).toBe(true);
    expect(stan()).toBe("PL; 38\nDE; 84\nFR; 68\nIT; 59");
  });

  it("„Lp. | Kraj | Wartość” - rozpoznana kolumna krajów, kraje dochodzą", () => {
    const { pole, stan } = zamontuj(POLE);
    pole.setSelectionRange(0, 0);
    wklej(pole, "Lp\tKraj\tWartość\n1\tWłochy\t59\n2\tHiszpania\t48");
    expect(stan()).toBe("PL; 38\nDE; 84\nFR; 68\nIT; 59\nES; 48");
  });

  it("„kod | nazwa | wartość” bez nagłówka - pierwszy kraj nie znika, istniejący dostaje wartość", () => {
    const { pole, stan } = zamontuj(POLE);
    pole.setSelectionRange(0, 0);
    wklej(pole, "PL\tPolska\t40\nCZ\tCzechy\t7");
    expect(stan()).toBe("PL; 40\nDE; 84\nFR; 68\nCZ; 7");
  });

  it("nic nierozpoznane: pole zostaje, a pod nim stoją problemy", () => {
    const { pole, onChange, stan } = zamontuj(POLE);
    const ev = wklej(pole, "Narnia\t5\nMordor\t7");
    expect(ev.defaultPrevented).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    expect(stan()).toBe(POLE);
    expect(screen.getByText("Nierozpoznane kraje: Narnia, Mordor.")).toBeInTheDocument();
  });
});

describe("kiedy tabela zastępuje pole", () => {
  it("pole puste", () => {
    const { pole, stan } = zamontuj("");
    wklej(pole, "Polska\t12,5\nCzechy\t7");
    expect(stan()).toBe("PL; 12.5\nCZ; 7");
  });

  it("pole zaznaczone w całości", () => {
    const { pole, stan } = zamontuj(POLE);
    pole.setSelectionRange(0, POLE.length);
    wklej(pole, "IT\t59\nES\t48");
    expect(stan()).toBe("IT; 59\nES; 48");
  });
});
