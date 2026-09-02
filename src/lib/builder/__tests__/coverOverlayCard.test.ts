// Model widgetu „Karta z okładką": formatowanie daty i parytet
// domyślnych wartości między rejestrem, schematem i modelem.
//
// Data jest tu jedyną logiką, która potrafi po cichu skłamać (strefa czasowa,
// język, śmieciowe wejście), więc dostaje osobne przypadki zamiast jednego
// „happy path".
import { describe, expect, it } from "vitest";
import {
  COVER_OVERLAY_CARD_DEFAULTS,
  coverCardDateAttr,
  formatCoverCardDate,
} from "../coverOverlayCard";
import { WIDGETS } from "../registry";
import { WIDGET_SCHEMAS } from "../schemas";

describe("coverCardDateAttr", () => {
  it("przepuszcza poprawną datę ISO", () => {
    expect(coverCardDateAttr(" 2022-10-10 ")).toBe("2022-10-10");
  });

  it("odrzuca zapis, którego przeglądarka nie zrozumie", () => {
    expect(coverCardDateAttr("10 października 2022")).toBe("");
    expect(coverCardDateAttr("")).toBe("");
    expect(coverCardDateAttr("2022-13-40")).toBe("");
  });
});

describe("formatCoverCardDate", () => {
  it("mówi po polsku pełną nazwą miesiąca", () => {
    expect(formatCoverCardDate("2022-10-10", "pl")).toContain("2022");
    expect(formatCoverCardDate("2022-10-10", "pl").toLowerCase()).toContain("paździer");
  });

  it("mówi po angielsku skrótem miesiąca", () => {
    expect(formatCoverCardDate("2022-10-10", "en")).toBe("10 Oct 2022");
  });

  it("nie przeskakuje o dobę - data dzienna jest liczona w UTC", () => {
    expect(formatCoverCardDate("2022-01-01", "en")).toBe("1 Jan 2022");
    expect(formatCoverCardDate("2022-12-31", "en")).toBe("31 Dec 2022");
  });

  it("zwraca wpisany tekst, gdy nie jest to data ISO", () => {
    expect(formatCoverCardDate("  wkrótce  ", "pl")).toBe("wkrótce");
  });
});

describe("parytet wartości domyślnych", () => {
  const registryDefaults = () => {
    const entry = WIDGETS.find((w) => w.type === "cover-overlay-card");
    if (!entry) throw new Error("brak widgetu cover-overlay-card w rejestrze");
    return entry.defaults();
  };

  it("rejestr wstawia kartę bez zmyślonej treści", () => {
    const d = registryDefaults();
    expect(d.title_pl).toBe("");
    expect(d.title_en).toBe("");
    expect(d.excerpt_pl).toBe("");
    expect(d.image).toBe("");
    expect(d.href).toBe("");
  });

  it("rejestr, schemat i model mówią o tych samych liczbach", () => {
    const d = registryDefaults();
    const schema = WIDGET_SCHEMAS["cover-overlay-card"] ?? [];
    const schemaDefault = (key: string): unknown =>
      schema.find((f) => f.key === key && "default" in f)?.default;

    for (const [key, value] of Object.entries(COVER_OVERLAY_CARD_DEFAULTS)) {
      expect(d[key], `rejestr: ${key}`).toBe(value);
      expect(schemaDefault(key), `schemat: ${key}`).toBe(value);
    }
    expect(d.radius, "platformowe zaokrąglenie 6 px").toBe(6);
  });

  it("każdy klucz treści ma swoją kontrolkę w panelu", () => {
    const schemaKeys = new Set((WIDGET_SCHEMAS["cover-overlay-card"] ?? []).map((f) => f.key));
    for (const key of Object.keys(registryDefaults())) {
      const base = key.replace(/_(pl|en)$/, "");
      expect(schemaKeys.has(base), `brak kontrolki dla ${base}`).toBe(true);
    }
  });
});
