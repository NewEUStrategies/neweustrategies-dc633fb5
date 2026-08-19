// Reguły panelu rekomendacji wyprowadzone z pliku trasy.
//
// Ten panel miał już pełny słownik, więc problemem nie był brak tłumaczeń, a
// ROZPISANIE list opcji i siedmiu wag wprost w JSX: nazwa pola, klucz etykiety
// i klucz podpowiedzi były sklejane osobno przy każdym suwaku, więc rozjazd
// („podpowiedź opisuje inny sygnał niż suwak") nie miał jak być zauważony.
import { describe, it, expect } from "vitest";
import {
  RELATED_POSTS_COLUMN_CHOICES,
  SAVE_FAILURE_REASONS,
  SLIDER_INTERVAL_STEP,
  afterParagraphEnabled,
  layoutOptions,
  positionOptions,
  saveFailureKey,
  sliderIntervalEnabled,
  sourceStrategyOptions,
  weightSignals,
} from "@/lib/relatedPosts/panelRules";
import { RELATED_POSTS_DEFAULTS } from "@/lib/relatedPosts";
import { RELATED_POSTS_LIMITS, buildRelatedPostsConfigRow } from "@/lib/relatedPosts/settings";

describe("positionOptions", () => {
  it("trzy pozycje, w kolejności od najczęstszej", () => {
    expect(positionOptions().map((o) => o.value)).toEqual(["end", "sidebar", "after_paragraph"]);
    expect(positionOptions()).toHaveLength(3);
  });

  it("każda pozycja ma WŁASNY klucz etykiety", () => {
    const keys = positionOptions().map((o) => o.labelKey);
    expect(new Set(keys).size).toBe(3);
    expect(keys.every((k) => k.startsWith("adminRelatedPosts.position."))).toBe(true);
  });

  it("domyślna pozycja z warstwy zapisu jest na liście", () => {
    const values = positionOptions().map((o) => o.value);
    expect(values).toContain(RELATED_POSTS_DEFAULTS.position);
    expect(values).not.toContain("wymyslona" as never);
  });
});

describe("layoutOptions", () => {
  it("SZEŚĆ układów - tyle, ile renderuje komponent publiczny", () => {
    expect(layoutOptions()).toHaveLength(6);
    expect(layoutOptions().map((o) => o.value)).toEqual([
      "grid",
      "list",
      "slider",
      "cards",
      "magazine",
      "timeline",
    ]);
  });

  it("klucz etykiety jest zbudowany z wartości, nie z pozycji na liście", () => {
    for (const option of layoutOptions()) {
      expect(option.labelKey).toBe(`adminRelatedPosts.layout.${option.value}`);
    }
    expect(new Set(layoutOptions().map((o) => o.labelKey)).size).toBe(6);
  });

  it("KAŻDY układ przechodzi normalizację zapisu (lista UI nie wyprzedza bazy)", () => {
    // Reguła UI i warstwa zapisu muszą znać ten sam zestaw: opcja widoczna
    // w panelu, której `buildRelatedPostsConfigRow` nie rozpoznaje, zapisałaby
    // się jako wartość domyślna i użytkownik zobaczyłby inny układ niż wybrał.
    for (const option of layoutOptions()) {
      const row = buildRelatedPostsConfigRow(
        { ...RELATED_POSTS_DEFAULTS, layout: option.value },
        "t1",
      );
      expect(row.layout).toBe(option.value);
    }
    const bogus = buildRelatedPostsConfigRow(
      { ...RELATED_POSTS_DEFAULTS, layout: "wymyslony" as never },
      "t1",
    );
    expect(bogus.layout).toBe(RELATED_POSTS_DEFAULTS.layout);
  });
});

describe("sourceStrategyOptions i liczba kolumn", () => {
  it("cztery źródła doboru, każde z własnym kluczem", () => {
    expect(sourceStrategyOptions().map((o) => o.value)).toEqual([
      "both",
      "categories",
      "tags",
      "author",
    ]);
    expect(new Set(sourceStrategyOptions().map((o) => o.labelKey)).size).toBe(4);
  });

  it("każde źródło przechodzi normalizację zapisu", () => {
    for (const option of sourceStrategyOptions()) {
      const row = buildRelatedPostsConfigRow(
        { ...RELATED_POSTS_DEFAULTS, source_strategy: option.value },
        "t1",
      );
      expect(row.source_strategy).toBe(option.value);
    }
    const bogus = buildRelatedPostsConfigRow(
      { ...RELATED_POSTS_DEFAULTS, source_strategy: "obie" as never },
      "t1",
    );
    expect(bogus.source_strategy).toBe(RELATED_POSTS_DEFAULTS.source_strategy);
  });

  it("dozwolone liczby kolumn to 2, 3 i 4 - i wszystkie przechodzą zapis", () => {
    expect(RELATED_POSTS_COLUMN_CHOICES).toEqual([2, 3, 4]);
    for (const n of RELATED_POSTS_COLUMN_CHOICES) {
      const row = buildRelatedPostsConfigRow({ ...RELATED_POSTS_DEFAULTS, columns: n }, "t1");
      expect(row.columns).toBe(n);
    }
  });
});

describe("weightSignals - siedem wag silnika", () => {
  it("siedem sygnałów, każdy wskazujący ISTNIEJĄCE pole konfiguracji", () => {
    const signals = weightSignals();
    expect(signals).toHaveLength(7);
    for (const signal of signals) {
      expect(RELATED_POSTS_DEFAULTS).toHaveProperty(signal.field);
    }
  });

  it("wszystkie pola to wagi - żadne inne pole nie wchodzi na tę listę przez pomyłkę", () => {
    const fields = weightSignals().map((s) => String(s.field));
    expect(fields.every((f) => f.startsWith("weight_"))).toBe(true);
    const allWeights = Object.keys(RELATED_POSTS_DEFAULTS).filter((k) => k.startsWith("weight_"));
    expect([...fields].sort()).toEqual(allWeights.sort());
  });

  it("etykieta i podpowiedź KAŻDEGO sygnału pochodzą z tego samego rdzenia", () => {
    // To jest sedno scalenia: rozjazd „podpowiedź opisuje inny sygnał niż
    // suwak" był w siedmiu osobnych wywołaniach niewidoczny.
    for (const signal of weightSignals()) {
      expect(signal.hintKey).toBe(`${signal.labelKey}Hint`);
    }
    expect(new Set(weightSignals().map((s) => s.labelKey)).size).toBe(7);
  });

  it("wagi z warstwy zapisu mieszczą się w granicach suwaka", () => {
    for (const signal of weightSignals()) {
      const value = RELATED_POSTS_DEFAULTS[signal.field] as number;
      expect(value).toBeGreaterThanOrEqual(RELATED_POSTS_LIMITS.weight.min);
      expect(value).toBeLessThanOrEqual(RELATED_POSTS_LIMITS.weight.max);
    }
  });
});

describe("afterParagraphEnabled / sliderIntervalEnabled", () => {
  it("pole akapitu ma sens WYŁĄCZNIE przy pozycji `after_paragraph`", () => {
    expect(afterParagraphEnabled("after_paragraph")).toBe(true);
    expect(afterParagraphEnabled("end")).toBe(false);
    expect(afterParagraphEnabled("sidebar")).toBe(false);
  });

  it("interwał przewijania ma sens WYŁĄCZNIE przy włączonym autoplayu", () => {
    expect(sliderIntervalEnabled(true)).toBe(true);
    expect(sliderIntervalEnabled(false)).toBe(false);
  });

  it("krok interwału to pół sekundy i mieści się w zakresie pola", () => {
    expect(SLIDER_INTERVAL_STEP).toBe(500);
    const span =
      RELATED_POSTS_LIMITS.sliderIntervalMs.max - RELATED_POSTS_LIMITS.sliderIntervalMs.min;
    expect(span % SLIDER_INTERVAL_STEP).toBe(0);
  });
});

describe("saveFailureKey - przyczyna nieudanego zapisu jako KLUCZ", () => {
  it("każda rozpoznawana przyczyna ma osobny komunikat", () => {
    const keys = SAVE_FAILURE_REASONS.map(saveFailureKey);
    expect(new Set(keys).size).toBe(SAVE_FAILURE_REASONS.length);
    expect(keys.every((k) => k.startsWith("adminRelatedPosts.toast."))).toBe(true);
  });

  it("brak obszaru roboczego kontra zapis nieutrwalony to RÓŻNE komunikaty", () => {
    // Te dwie przyczyny wyglądają dla użytkownika tak samo („nie zapisało się"),
    // a wymagają zupełnie innej reakcji: pierwsza to brak provisioningu, druga
    // to cichy sukces UPDATE bez dopasowania.
    expect(saveFailureKey("no_tenant")).not.toBe(saveFailureKey("not_persisted"));
    expect(saveFailureKey("no_tenant")).toBe("adminRelatedPosts.toast.noTenant");
  });

  it("mapa pokrywa CZTERY przyczyny - nowa przyczyna bez klucza da `undefined`", () => {
    expect(SAVE_FAILURE_REASONS).toHaveLength(4);
    expect(SAVE_FAILURE_REASONS).toEqual(
      expect.arrayContaining([
        "no_tenant",
        "tenant_lookup_failed",
        "write_failed",
        "not_persisted",
      ]),
    );
  });
});
