import { describe, it, expect } from "vitest";
import { collapseContext, diffLines, diffRevisionSnapshots, docToLines } from "../revisionDiff";

describe("diffLines (LCS)", () => {
  it("oznacza dodane i usunięte linie, zachowując wspólne", () => {
    const out = diffLines(["a", "b", "c"], ["a", "x", "c"]);
    expect(out).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "x" },
      { kind: "same", text: "c" },
    ]);
  });

  it("czyste dodanie na końcu", () => {
    const out = diffLines(["a"], ["a", "b"]);
    expect(out).toEqual([
      { kind: "same", text: "a" },
      { kind: "added", text: "b" },
    ]);
  });

  it("identyczne wejścia nie generują zmian", () => {
    expect(diffLines(["a", "b"], ["a", "b"]).every((l) => l.kind === "same")).toBe(true);
  });
});

describe("collapseContext", () => {
  it("zwija długie ciągi niezmienionych linii do przerwy", () => {
    const lines = [
      ...Array.from({ length: 10 }, (_, i) => ({ kind: "same", text: `s${i}` }) as const),
      { kind: "added", text: "new" } as const,
    ];
    const out = collapseContext(lines, 2);
    const gap = out.find((l) => "gap" in l) as { gap: number };
    expect(gap.gap).toBe(8);
    expect(out.filter((l) => !("gap" in l))).toHaveLength(3);
  });
});

describe("docToLines", () => {
  it("zbiera teksty z dokumentu bloków, pomijając szum (id/type/url)", () => {
    const doc = {
      version: 1,
      blocks: [
        { id: "b1", type: "heading", text_pl: "Tytuł sekcji", anchor: "x" },
        {
          id: "b2",
          type: "paragraph",
          html_pl: "<p>Pierwszy akapit.</p><p>Drugi akapit.</p>",
          settings: { url: "https://example.com" },
        },
      ],
    };
    expect(docToLines(doc)).toEqual(["Tytuł sekcji", "Pierwszy akapit.", "Drugi akapit."]);
  });
});

describe("diffRevisionSnapshots", () => {
  it("wykrywa zmiany skalarne jako przed/po", () => {
    const out = diffRevisionSnapshots(
      { title_pl: "Stary", status: "draft" },
      { title_pl: "Nowy", status: "draft" },
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      field: "title_pl",
      kind: "scalar",
      before: "Stary",
      after: "Nowy",
    });
  });

  it("diffuje treść bloków per język i pomija pola bez zmian", () => {
    const mk = (text: string) => ({
      pl: { version: 1, blocks: [{ id: "b", type: "paragraph", text_pl: text }] },
      en: { version: 1, blocks: [] },
    });
    const out = diffRevisionSnapshots(
      { title_pl: "T", blocks_data: mk("Ala ma kota") },
      { title_pl: "T", blocks_data: mk("Ala ma psa") },
    );
    expect(out).toHaveLength(1);
    expect(out[0].field).toBe("content:pl");
    expect(out[0].lines).toEqual([
      { kind: "removed", text: "Ala ma kota" },
      { kind: "added", text: "Ala ma psa" },
    ]);
  });

  it("brak różnic daje pustą listę", () => {
    const snap = { title_pl: "X", takeaways_pl: ["a"] };
    expect(diffRevisionSnapshots(snap, { ...snap })).toEqual([]);
  });
});

describe("diffLines - ogony i limit wejścia", () => {
  it("czyste usunięcie na końcu", () => {
    expect(diffLines(["a", "b", "c"], ["a"])).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "removed", text: "c" },
    ]);
  });
});

describe("collapseContext - kontekst domyślny i przerwa na końcu", () => {
  it("bez drugiego argumentu zostawia dwie linie kontekstu wokół zmiany", () => {
    const lines = [
      ...Array.from({ length: 10 }, (_, i) => ({ kind: "same", text: `s${i}` }) as const),
      { kind: "added", text: "nowa" } as const,
    ];

    // Ten sam wynik co jawne collapseContext(lines, 2) - przypina wartość
    // domyślną parametru, z której korzysta RevisionDiffDialog.
    expect(collapseContext(lines)).toEqual(collapseContext(lines, 2));
    const gap = collapseContext(lines).find((l) => "gap" in l) as { gap: number };
    expect(gap.gap).toBe(8);
  });

  it("niezmieniony ogon po ostatniej zmianie zwija się w przerwę na końcu wyniku", () => {
    const lines = [
      { kind: "added", text: "nowa" } as const,
      ...Array.from({ length: 10 }, (_, i) => ({ kind: "same", text: `s${i}` }) as const),
    ];

    const out = collapseContext(lines, 2);
    // Zmiana + dwie linie kontekstu, reszta (osiem linii) jako przerwa NA KOŃCU.
    expect(out.filter((l) => !("gap" in l))).toHaveLength(3);
    expect(out[out.length - 1]).toEqual({ gap: 8 });
  });
});

describe("docToLines - wejście patologiczne", () => {
  it("obcina dokument do twardego limitu 800 linii", () => {
    const doc = { blocks: Array.from({ length: 900 }, (_, i) => ({ text: `Linia ${i}` })) };

    const lines = docToLines(doc);

    expect(lines).toHaveLength(800);
    expect(lines[0]).toBe("Linia 0");
    expect(lines[799]).toBe("Linia 799");
  });

  it("dokument z cyklem referencji nie zapętla skanera", () => {
    const cykliczny: Record<string, unknown> = { title: "Raz" };
    cykliczny.self = cykliczny;

    expect(docToLines(cykliczny)).toEqual(["Raz"]);
  });

  it("pomija węzły, które są gołymi napisami w tablicy pod kluczem tekstowym", () => {
    // Stan faktyczny (przypięty, żeby zmiana zachowania była widoczna w diffie
    // testów): tablica napisów pod `items` nie wnosi ANI JEDNEJ linii.
    expect(docToLines({ blocks: [{ type: "list", items: ["Pierwszy", "Drugi"] }] })).toEqual([]);
  });

  // DEFEKT: POZYCJE LISTY BLOKOWEJ NIE TRAFIAJĄ DO DIFFA REWIZJI.
  //
  // WEJSCIE: dokument bloków z listą punktowaną zapisaną kanonicznie jako
  //   tablica napisów - {blocks:[{type:"list", items:["Pierwszy","Drugi"]}]}.
  // CO PSUJE: klucz `items` PRZECHODZI TEXTY_KEY (revisionDiff.ts:112,
  //   alternatywa `items?`), ale jego wartością jest tablica, a nie napis,
  //   więc warunek `typeof value === "string"` (:125) jest fałszywy i
  //   sterowanie idzie do gałęzi else (:133) -> collectDocLines(tablica)
  //   (:117-119) -> dla KAŻDEGO elementu wchodzi strażnik
  //   `if (typeof node === "string") return;` (:116) i element wypada.
  //   Strażnik istnieje po to, żeby nie zbierać napisów spod kluczy
  //   nietekstowych (url, kolor), ale kasuje też tablice pozycji listy.
  // KONSEKWENCJA: redaktor porównujący rewizje NIE WIDZI, że zmienił,
  //   dodał albo usunął punkty listy - diff pokazuje "brak różnic" dla
  //   zmiany, która realnie poszła na produkcję. To odmowa fałszywie
  //   negatywna: panel rewizji milczy zamiast ostrzec.
  // WYMAGANA POPRAWKA: collectDocLines musi przyjąć kontekst klucza - gdy
  //   wchodzi w tablicę spod klucza pasującego do TEXTY_KEY, elementy
  //   będące napisami mają być zbierane (przez tę samą normalizację co
  //   wartości napisowe w :126-131), a nie odrzucane w :116.
  it.fails("DEFEKT: pozycje listy blokowej MUSZĄ trafiać do linii diffa", () => {
    expect(docToLines({ blocks: [{ type: "list", items: ["Pierwszy", "Drugi"] }] })).toEqual([
      "Pierwszy",
      "Drugi",
    ]);
  });
});

describe("diffRevisionSnapshots - normalizacja wartości pól", () => {
  it("pole liczbowe porównuje jako napis przed/po", () => {
    const out = diffRevisionSnapshots({ read_minutes: 5 }, { read_minutes: 7 });

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      field: "read_minutes",
      labelKey: "readMinutes",
      kind: "scalar",
      before: "5",
      after: "7",
    });
  });

  it("pole JSON z różnicą daje diff liniowy, nie skalarny", () => {
    const out = diffRevisionSnapshots({ takeaways_pl: ["a"] }, { takeaways_pl: ["b"] });

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ field: "takeaways_pl", labelKey: "takeawaysPl", kind: "text" });
    // JSON.stringify(..., null, 1) - wcięcie jednospacjowe, diff idzie po liniach.
    expect(out[0].lines).toEqual([
      { kind: "same", text: "[" },
      { kind: "removed", text: ' "a"' },
      { kind: "added", text: ' "b"' },
      { kind: "same", text: "]" },
    ]);
  });

  it("wartość nieserializowalna do JSON-a daje pusty napis zamiast wyjątku", () => {
    // toJSON zwracający undefined to realny kształt po rehydratacji klasy -
    // JSON.stringify oddaje wtedy undefined, a `?? ""` ratuje porównanie.
    const bezSerializacji = { toJSON: () => undefined };

    const out = diffRevisionSnapshots(
      { custom_meta: bezSerializacji },
      { custom_meta: { klucz: "wartość" } },
    );

    expect(out).toHaveLength(1);
    expect(out[0].field).toBe("custom_meta");
    expect(out[0].lines?.[0]).toEqual({ kind: "removed", text: "" });
  });

  it("struktura cykliczna nie wywraca porównania pól JSON", () => {
    const cykliczny: Record<string, unknown> = { klucz: "wartość" };
    cykliczny.self = cykliczny;

    const out = diffRevisionSnapshots({ layout_overrides: cykliczny }, { layout_overrides: null });

    expect(out).toHaveLength(1);
    expect(out[0].field).toBe("layout_overrides");
    // Awaryjne String(v) - bez rzutu, panel rewizji nadal się renderuje.
    expect(out[0].lines).toEqual([
      { kind: "removed", text: "[object Object]" },
      { kind: "added", text: "" },
    ]);
  });
});

describe("diffRevisionSnapshots - treść zależna od silnika", () => {
  it("blocks_data bez dokumentu dla języka nie generuje diffa tego języka", () => {
    // Rewizja sprzed dodania wersji EN: klucz `en` w ogóle nie istnieje.
    const out = diffRevisionSnapshots(
      { blocks_data: { pl: { version: 1, blocks: [{ id: "b", text_pl: "Stara treść" }] } } },
      { blocks_data: { pl: { version: 1, blocks: [{ id: "b", text_pl: "Nowa treść" }] } } },
    );

    expect(out.map((d) => d.field)).toEqual(["content:pl"]);
  });

  it("diffuje dokument buildera (tylko po stronie PL)", () => {
    const out = diffRevisionSnapshots(
      { builder_data: { sections: [{ title: "Stara sekcja" }] } },
      { builder_data: { sections: [{ title: "Nowa sekcja" }] } },
    );

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ field: "content:pl", labelKey: "contentPl", kind: "text" });
    expect(out[0].lines).toEqual([
      { kind: "removed", text: "Stara sekcja" },
      { kind: "added", text: "Nowa sekcja" },
    ]);
  });

  it("diffuje starą treść HTML (silnik richtext) po stronie PL", () => {
    const out = diffRevisionSnapshots(
      { content_pl: "<p>Stary akapit</p><p>Wspólny akapit</p>" },
      { content_pl: "<p>Nowy akapit</p><p>Wspólny akapit</p>" },
    );

    expect(out).toHaveLength(1);
    expect(out[0].field).toBe("content:pl");
    expect(out[0].lines).toEqual([
      { kind: "removed", text: "Stary akapit" },
      { kind: "added", text: "Nowy akapit" },
      { kind: "same", text: "Wspólny akapit" },
    ]);
  });

  it("zmiana wyłącznie w wersji EN daje diff pod etykietą contentEn", () => {
    const out = diffRevisionSnapshots(
      { content_pl: "<p>Bez zmian</p>", content_en: "<p>Old body</p>" },
      { content_pl: "<p>Bez zmian</p>", content_en: "<p>New body</p>" },
    );

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ field: "content:en", labelKey: "contentEn", kind: "text" });
  });
});
