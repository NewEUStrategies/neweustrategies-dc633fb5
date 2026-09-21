// @vitest-environment node
//
// MAPA-CHOROPLETA NA ŚCIEŻCE SERWEROWEJ.
//
// PO CO OSOBNY PLIK ZE ŚRODOWISKIEM `node`. `ChoroplethMap` liczy awaryjny
// hex rampy przez `seqHexPair()`, a ta funkcja zaczyna się od strażnika
// `typeof document === "undefined"`. W happy-dom ta gałąź jest NIEOSIĄGALNA -
// dokument istnieje zawsze - więc w pliku obok stała jako jedyna niepokryta
// i wyglądała na dług, którym nie jest.
//
// CO SIĘ STANIE BEZ NIEJ. Wywołanie `seqHexPair()` NIE siedzi w gałęzi
// klienckiej: leci w ciele renderu, zaraz za wczesnym wyjściem dla pustego
// zestawu, czyli TAKŻE na serwerze. Sięgnięcie po `document.documentElement`
// bez okna to ReferenceError w RENDERZE - a mapa jest blokiem treści
// redakcyjnej, więc padłby cały artykuł: HTTP 500 zamiast strony, i to na
// ścieżce, którą odwiedza crawler. Nie „mapa bez koloru".
//
// Jasna para hexów jest na serwerze jedyną poprawną odpowiedzią: motyw
// mieszka w klasie na <html>, którą ustawia skrypt przedhydracyjny, więc
// serwer nie ma go z czego odczytać. I tak nie ma to skutku w markupie -
// SVG dogrywa się dopiero po hydracji - a to jest właśnie kontrakt SSR
// pilnowany niżej: crawler dostaje LICZBY, nie obrazek.
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Json } from "@/lib/content-model/json";
import { parseDataMapConfig } from "@/lib/charts/parse";
import { ChoroplethMap } from "../ChoroplethMap";

function ssr(data: Record<string, Json>): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToString(
    <QueryClientProvider client={client}>
      <ChoroplethMap config={parseDataMapConfig(data)} lang="pl" />
    </QueryClientProvider>,
  );
}

const EUROPA: Record<string, Json> = {
  region: "europe",
  title: "Poparcie w krajach UE",
  unit: " %",
  values: [
    { id: "PL", value: 10 },
    { id: "DE", value: 90 },
  ],
};

describe("ChoroplethMap - render serwerowy", () => {
  it("kanarek środowiska: brak `document`", () => {
    // Bez tego cały plik przeszedłby w happy-dom, nie dowodząc niczego.
    expect(typeof document).toBe("undefined");
  });

  it("render serwerowy NIE RZUCA - brak dokumentu nie może wywrócić artykułu z mapą", () => {
    expect(() => ssr(EUROPA)).not.toThrow();
  });

  it("crawler dostaje LICZBY: tytuł i tabela danych są w markupie z serwera", () => {
    const html = ssr(EUROPA);

    expect(html).toContain("Poparcie w krajach UE");
    // Nazwy krajów mieszkają w zasobie geometrii, którego serwer nie dociąga,
    // więc zostaje kod ISO - degradacja czytelna, nie pusta komórka.
    expect(html).toContain("PL");
    expect(html).toContain("10 %");
    expect(html).toContain("90 %");
  });

  it("geometria NIE PODRÓŻUJE z serwera - w miejscu SVG stoi migotka o stałej wysokości", () => {
    const html = ssr(EUROPA);

    // Zasób ma setki kilobajtów ścieżek; wysłanie go w HTML-u byłoby
    // zaprzeczeniem powodu, dla którego leży w public/geo/*.
    expect(html).not.toContain("neh-map-countries");
    expect(html).toContain("skeleton-shimmer");
    // 720 * 825/960 = 618,75 -> 619. Stała wysokość = brak CLS przy hydracji.
    expect(html).toContain("height:619px");
  });

  it("legenda z granicami domeny jedzie już z serwera - skala nie czeka na JS", () => {
    const html = ssr(EUROPA);

    expect(html).toContain("10 %");
    expect(html).toContain("90 %");
    expect(html).toContain("linear-gradient");
  });

  it("pusty zestaw na serwerze daje NOTĘ, a nie pustą kartę", () => {
    // Wczesne wyjście stoi PRZED `seqHexPair()`, więc ta ścieżka nie dotyka
    // motywu w ogóle - i też musi przeżyć render bez dokumentu.
    const html = ssr({ region: "europe", title: "Pusta", values: [] });

    expect(html).toContain("Brak danych mapy.");
    expect(html).not.toContain("skeleton-shimmer");
  });
});
