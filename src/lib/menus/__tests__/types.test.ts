// Parsowanie konfiguracji mega panelu. `mega_config` to kolumna JSONB, czyli
// jedyne miejsce w menu, gdzie do kodu trafia struktura BEZ gwarancji kształtu:
// mogła ją zapisać starsza wersja panelu, migracja albo ręczny UPDATE w bazie.
//
// Kontrakt jest twardy: parsowanie NIGDY nie rzuca. Wyjątek tutaj wywraca SSR
// nagłówka, czyli całą stronę - nie jeden panel.
import { describe, expect, it } from "vitest";
import { DEFAULT_MEGA_CONFIG, parseMegaConfig, megaConfigSchema } from "../types";

describe("parseMegaConfig", () => {
  it("przepuszcza poprawną konfigurację i uzupełnia domyślne pola", () => {
    const parsed = parseMegaConfig({
      columns_per_row: 3,
      width: "full",
      columns: [{ title_pl: "Analizy", links: [{ label_pl: "Raport", href: "/r" }] }],
      featured_post_id: null,
    });
    expect(parsed.columns_per_row).toBe(3);
    expect(parsed.width).toBe("full");
    expect(parsed.columns[0]).toMatchObject({ title_pl: "Analizy", title_en: "", href: "" });
    expect(parsed.columns[0].links[0]).toMatchObject({ label_pl: "Raport", icon: "" });
  });

  it("uszkodzony rekord schodzi na domyślną konfigurację, a nie na wyjątek", () => {
    expect(parseMegaConfig({ columns_per_row: "dużo" })).toEqual(DEFAULT_MEGA_CONFIG);
    expect(parseMegaConfig(null)).toEqual(DEFAULT_MEGA_CONFIG);
    expect(parseMegaConfig("[]")).toEqual(DEFAULT_MEGA_CONFIG);
    expect(parseMegaConfig(undefined)).toEqual(DEFAULT_MEGA_CONFIG);
  });

  it("wartości spoza zakresu też są odrzucane w całości", () => {
    // Schemat trzyma 1..6 kolumn w rzędzie - dwanaście rozjechałoby siatkę
    // panelu na każdej stronie, więc lepszy jest domyślny układ.
    expect(parseMegaConfig({ columns_per_row: 12 })).toEqual(DEFAULT_MEGA_CONFIG);
    expect(parseMegaConfig({ width: "gigantyczna" })).toEqual(DEFAULT_MEGA_CONFIG);
    expect(parseMegaConfig({ featured_post_id: "nie-uuid" })).toEqual(DEFAULT_MEGA_CONFIG);
  });

  it("pusty obiekt daje komplet wartości domyślnych", () => {
    expect(parseMegaConfig({})).toEqual(DEFAULT_MEGA_CONFIG);
  });

  it("schemat pilnuje sufitów, których UI nie egzekwuje", () => {
    // Limit kolumn i linków chroni renderer nagłówka przed konfiguracją,
    // która zamieniłaby panel w nieskończoną listę.
    const tooManyColumns = megaConfigSchema.safeParse({
      columns: Array.from({ length: 13 }, () => ({})),
    });
    expect(tooManyColumns.success).toBe(false);

    const tooManyLinks = megaConfigSchema.safeParse({
      columns: [{ links: Array.from({ length: 31 }, () => ({})) }],
    });
    expect(tooManyLinks.success).toBe(false);
  });
});
