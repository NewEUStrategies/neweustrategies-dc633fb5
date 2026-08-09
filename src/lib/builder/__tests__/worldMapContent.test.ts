// Treść widgetu „Mapa świata" -> łuki, kolory, identyfikatory profili.
//
// Punkt ciężkości: POŁĄCZENIE Z PLATFORMĄ. Etykieta i odsyłacz końca łuku
// podpiętego pod publiczny profil muszą pochodzić z ŻYWEGO profilu, a wpisany
// ręcznie tekst zostaje wyłącznie zapasem - inaczej mapa pokazywałaby kopię
// nazwiska, która rozjeżdża się z profilem przy pierwszej zmianie.
import { describe, it, expect } from "vitest";
import type { WidgetContent } from "../types";
import {
  worldMapArcs,
  worldMapConnections,
  worldMapProfileIds,
  worldMapSource,
  worldMapView,
} from "../worldMapContent";

const connection = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  startLabel_pl: "Bruksela",
  startLabel_en: "Brussels",
  startLat: 50.85,
  startLng: 4.35,
  startUserId: "",
  endLabel_pl: "Warszawa",
  endLabel_en: "Warsaw",
  endLat: 52.23,
  endLng: 21.01,
  endUserId: "",
  href: "",
  ...over,
});

const content = (over: Record<string, unknown> = {}): WidgetContent =>
  ({ source: "manual", connections: [connection()], ...over }) as unknown as WidgetContent;

describe("worldMapSource", () => {
  it("domyśla się trybu ręcznego dla treści bez pola i dla nieznanej wartości", () => {
    expect(worldMapSource({} as WidgetContent)).toBe("manual");
    expect(worldMapSource({ source: "cokolwiek" } as unknown as WidgetContent)).toBe("manual");
    expect(worldMapSource({ source: "experts" } as unknown as WidgetContent)).toBe("experts");
  });
});

describe("worldMapConnections", () => {
  it("odrzuca wpisy, które nie są obiektami", () => {
    const c = { connections: [connection(), "x", 42, null, []] } as unknown as WidgetContent;
    expect(worldMapConnections(c)).toHaveLength(1);
  });

  it("nadaje zastępcze id wpisom bez identyfikatora", () => {
    const c = { connections: [{ startLat: 1 }] } as unknown as WidgetContent;
    expect(worldMapConnections(c)[0].id).toBe("wm-0");
  });
});

describe("worldMapProfileIds", () => {
  it("w trybie ręcznym nie pyta platformy o nic", () => {
    const c = content({ connections: [connection({ endUserId: "u-1" })] });
    expect(worldMapProfileIds(c)).toEqual([]);
  });

  it("zbiera unikalne id obu końców i sortuje je (stabilny klucz cache)", () => {
    const c = content({
      source: "experts",
      connections: [
        connection({ id: "a", startUserId: "u-2", endUserId: "u-1" }),
        connection({ id: "b", startUserId: "u-2", endUserId: "u-3" }),
      ],
    });
    expect(worldMapProfileIds(c)).toEqual(["u-1", "u-2", "u-3"]);
  });
});

describe("worldMapArcs", () => {
  it("pomija połączenia ze współrzędnymi poza zakresem", () => {
    const c = content({
      connections: [connection(), connection({ id: "c2", endLat: 999 })],
    });
    expect(worldMapArcs(c, "pl")).toHaveLength(1);
  });

  it("wybiera etykietę w języku strony, z fallbackiem na drugi język", () => {
    const c = content({ connections: [connection({ endLabel_pl: "" })] });
    expect(worldMapArcs(c, "pl")[0].end.label).toBe("Warsaw");
    expect(worldMapArcs(c, "en")[0].end.label).toBe("Warsaw");
    expect(worldMapArcs(content(), "pl")[0].end.label).toBe("Warszawa");
  });

  it("żywy profil platformy nadpisuje etykietę i prowadzi do publicznego huba", () => {
    const c = content({
      source: "experts",
      connections: [connection({ endUserId: "u-1", href: "/kontakt" })],
    });
    const [arc] = worldMapArcs(c, "pl", [
      { userId: "u-1", displayName: "Anna Nowak", slug: "anna-nowak", avatarUrl: "", role: "" },
    ]);
    expect(arc.end.label).toBe("Anna Nowak");
    expect(arc.end.href).toBe("/author/anna-nowak");
    // Koniec bez podpiętego profilu zostaje przy własnym linku.
    expect(arc.start.href).toBe("/kontakt");
    expect(arc.start.label).toBe("Bruksela");
  });

  it("profil bez sluga nie kasuje własnego linku punktu", () => {
    const c = content({
      source: "experts",
      connections: [connection({ endUserId: "u-1", href: "/eksperci" })],
    });
    const [arc] = worldMapArcs(c, "pl", [
      { userId: "u-1", displayName: "Jan Test", slug: "", avatarUrl: "", role: "" },
    ]);
    expect(arc.end.label).toBe("Jan Test");
    expect(arc.end.href).toBe("/eksperci");
  });
});

describe("worldMapView", () => {
  it("puste kolory znaczą „dziedzicz z motywu", () => {
    const v = worldMapView(content(), "pl");
    expect(v.lineColor).toBe("");
    expect(v.dotColor).toBe("");
    expect(v.bgColor).toBe("");
  });

  it("odrzuca zapisy koloru, których nie wolno wstawić do atrybutu style", () => {
    const v = worldMapView(
      content({ lineColor: "url(javascript:alert(1))", pointColor: "#0ea5e9" }),
      "pl",
    );
    expect(v.lineColor).toBe("");
    expect(v.pointColor).toBe("#0ea5e9");
  });

  it("przepuszcza tokeny motywu (var / oklch), bo to nasza kolorystyka", () => {
    const v = worldMapView(content({ lineColor: "var(--brand)" }), "pl");
    expect(v.lineColor).toBe("var(--brand)");
  });

  it("przycina czas animacji do bezpiecznego zakresu", () => {
    expect(worldMapView(content({ animationDuration: 0 }), "pl").animationDuration).toBe(0.4);
    expect(worldMapView(content({ animationDuration: 99 }), "pl").animationDuration).toBe(10);
  });

  it("kadr domyślnie dopasowuje się do połączeń, a nieznana wartość nie psuje widoku", () => {
    expect(worldMapView(content(), "pl").fit).toBe("auto");
    expect(worldMapView(content({ fit: "europe" }), "pl").fit).toBe("europe");
    expect(worldMapView(content({ fit: "world" }), "pl").fit).toBe("world");
    expect(worldMapView(content({ fit: "księżyc" }), "pl").fit).toBe("auto");
  });

  it("przełączniki domyślnie włączone, wyłącza je dopiero jawne `false`", () => {
    const on = worldMapView(content(), "pl");
    expect(on.showLabels).toBe(true);
    expect(on.animate).toBe(true);
    expect(on.loop).toBe(true);
    const off = worldMapView(content({ showLabels: false, animate: false, loop: false }), "pl");
    expect(off.showLabels).toBe(false);
    expect(off.animate).toBe(false);
    expect(off.loop).toBe(false);
  });

  it("czyta tytuł i podtytuł z fallbackiem językowym", () => {
    const c = content({ title_en: "Our network", subtitle_pl: "Opis" });
    const v = worldMapView(c, "pl");
    expect(v.title).toBe("Our network");
    expect(v.subtitle).toBe("Opis");
  });
});
