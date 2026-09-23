// Nagłówek zakładek Program/Prelegenci: nazwa WYDARZENIA, nie stały napis.
//
// Regresja, której pilnujemy: zakładka deklarowała własne `title`, `og:*`
// i `twitter:card: summary` ze stałym polskim tekstem. Głębsze dopasowanie
// wygrywa w <head>, więc każde wydarzenie miało na tej zakładce ten sam tytuł
// karty i ten sam opis w podglądzie linku - także pod /en - a podgląd tracił
// okładkę wydarzenia.
import { describe, expect, it } from "vitest";

import { buildEventTabHead, type EventTabHeadEvent } from "@/lib/events/eventTabHead";

const EVENT: EventTabHeadEvent = {
  titlePl: "Gdańskie Gry Morskie 2021",
  titleEn: "Gdańsk Maritime Games 2021",
  cover: "https://cdn.example.org/ggm/cover.png",
};

function metaOf(meta: Array<Record<string, string>>, key: string): string | undefined {
  if (key === "title") return meta.find((m) => "title" in m)?.title;
  return meta.find((m) => m.name === key || m.property === key)?.content;
}

describe("buildEventTabHead", () => {
  it("tytuł i opis programu niosą nazwę wydarzenia w języku adresu", () => {
    const { meta } = buildEventTabHead({
      tab: "agenda",
      url: "https://neweuropeanstrategies.com/events/ggm-2021/agenda",
      lang: "pl",
      event: EVENT,
    });
    expect(metaOf(meta, "og:title")).toBe("Program - Gdańskie Gry Morskie 2021");
    expect(metaOf(meta, "title")).toBe(
      "Program - Gdańskie Gry Morskie 2021 - New European Strategies",
    );
    expect(metaOf(meta, "description")).toContain("Gdańskie Gry Morskie 2021");
  });

  it("wersja angielska bierze angielską nazwę i angielski słownik", () => {
    const { meta } = buildEventTabHead({
      tab: "speakers",
      url: "https://neweuropeanstrategies.com/en/events/ggm-2021/speakers",
      lang: "en",
      event: EVENT,
    });
    expect(metaOf(meta, "og:title")).toBe("Speakers and moderators - Gdańsk Maritime Games 2021");
    expect(metaOf(meta, "og:locale")).toBe("en_US");
  });

  it("brak nazwy w jednym języku sięga po drugi, a nie zostawia pustki", () => {
    const { meta } = buildEventTabHead({
      tab: "agenda",
      url: "https://neweuropeanstrategies.com/en/events/ggm-2021/agenda",
      lang: "en",
      event: { ...EVENT, titleEn: "" },
    });
    expect(metaOf(meta, "og:title")).toBe("Programme - Gdańskie Gry Morskie 2021");
  });

  // Stała zakładka nadpisywała `twitter:card` powłoki na `summary`, więc
  // podgląd linku do programu tracił okładkę wydarzenia.
  it("okładka wydarzenia zostaje obrazem podglądu", () => {
    const { meta } = buildEventTabHead({
      tab: "speakers",
      url: "https://neweuropeanstrategies.com/events/ggm-2021/speakers",
      lang: "pl",
      event: EVENT,
    });
    expect(metaOf(meta, "og:image")).toBe(EVENT.cover);
    expect(metaOf(meta, "twitter:card")).toBe("summary_large_image");
  });

  it("zdegradowana powłoka (brak danych) daje uczciwy tytuł zastępczy", () => {
    const { meta } = buildEventTabHead({
      tab: "agenda",
      url: "https://neweuropeanstrategies.com/events/nieznane/agenda",
      lang: "pl",
      event: null,
    });
    expect(metaOf(meta, "og:title")).toBe("Program - Wydarzenie");
    expect(metaOf(meta, "og:url")).toBe("https://neweuropeanstrategies.com/events/nieznane/agenda");
  });
});
