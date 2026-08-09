// Treść widgetu „Mapa świata" -> propsy komponentu `WorldMap`.
//
// Warstwa jest CZYSTA (bez Reacta, DOM-u i zapytań), bo czytają ją trzy strony:
// renderer publiczny, kanwa buildera i rejestr prefetchu SSR. Jedno miejsce
// parsowania oznacza, że nie da się rozjechać nazwą klucza między panelem
// a renderem (bramka wierności ustawień porównuje DOKŁADNE klucze magazynowe).
import type { WidgetContent } from "./types";
import { safeWidgetColor } from "./cssColor";
import { coerceLat, coerceLng, type MapArc, type MapFit } from "@/lib/maps/worldMapGeo";

export type WorldMapLang = "pl" | "en";

/** Skąd biorą się etykiety i odsyłacze końców łuków. */
export type WorldMapSource = "manual" | "experts";

/** Pojedyncze połączenie w treści widgetu (para punktów, jak `dots` w pierwowzorze). */
export interface WorldMapConnection {
  id: string;
  startLabel_pl: string;
  startLabel_en: string;
  startLat: number;
  startLng: number;
  startUserId: string;
  endLabel_pl: string;
  endLabel_en: string;
  endLat: number;
  endLng: number;
  endUserId: string;
  href: string;
}

/** Publiczny profil rozwiązany z platformy (podzbiór `PublicSpeakerRow`). */
export interface WorldMapProfile {
  userId: string;
  displayName: string;
  slug: string;
  /** Zdjęcie profilowe - etykieta punktu staje się wtedy kartą osoby. */
  avatarUrl: string;
  /** Rola: nagłówek prelegenta albo stanowisko z profilu autorskiego. */
  role: string;
}

const strOf = (v: unknown): string => (typeof v === "string" ? v : "");
const numOf = (v: unknown, fallback: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Rekordy tablicy `connections` bez zgadywania kształtu (treść z JSONB). */
function rowsOf(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (x): x is Record<string, unknown> =>
          typeof x === "object" && x !== null && !Array.isArray(x),
      )
    : [];
}

/** Znormalizowana lista połączeń - jedyne źródło współrzędnych widgetu. */
export function worldMapConnections(c: WidgetContent): WorldMapConnection[] {
  return rowsOf(c.connections).map((row, i) => ({
    id: strOf(row.id) || `wm-${i}`,
    startLabel_pl: strOf(row.startLabel_pl),
    startLabel_en: strOf(row.startLabel_en),
    startLat: numOf(row.startLat, 0),
    startLng: numOf(row.startLng, 0),
    startUserId: strOf(row.startUserId),
    endLabel_pl: strOf(row.endLabel_pl),
    endLabel_en: strOf(row.endLabel_en),
    endLat: numOf(row.endLat, 0),
    endLng: numOf(row.endLng, 0),
    endUserId: strOf(row.endUserId),
    href: strOf(row.href),
  }));
}

/** Źródło danych widgetu (treść bez pola = tryb ręczny, zgodnie z historią). */
export function worldMapSource(c: WidgetContent): WorldMapSource {
  return strOf(c.source) === "experts" ? "experts" : "manual";
}

/**
 * Identyfikatory profili przypiętych do końców łuków - wejście zapytania
 * `speakersByIdsQueryOptions`. Zwraca posortowaną listę bez duplikatów, żeby
 * kolejność wpisów w panelu nie unieważniała cache.
 */
export function worldMapProfileIds(c: WidgetContent): string[] {
  if (worldMapSource(c) !== "experts") return [];
  const ids = new Set<string>();
  for (const conn of worldMapConnections(c)) {
    if (conn.startUserId) ids.add(conn.startUserId);
    if (conn.endUserId) ids.add(conn.endUserId);
  }
  return Array.from(ids).sort();
}

/** Etykieta punktu: żywy profil (tryb ekspercki) wygrywa z wpisaną ręcznie. */
function pointLabel(
  labelPl: string,
  labelEn: string,
  lang: WorldMapLang,
  profile: WorldMapProfile | undefined,
): string {
  if (profile?.displayName) return profile.displayName;
  const own = lang === "pl" ? labelPl : labelEn;
  return own || labelPl || labelEn;
}

/** Odsyłacz punktu: publiczny hub eksperta, a w jego braku link własny łuku. */
function pointHref(fallbackHref: string, profile: WorldMapProfile | undefined): string {
  if (profile?.slug) return `/author/${profile.slug}`;
  return fallbackHref;
}

/**
 * Łuki gotowe do narysowania. Połączenie bez POPRAWNYCH współrzędnych obu
 * końców jest pomijane - lepiej narysować mniej łuków niż jeden wskazujący
 * w środek oceanu przez literówkę w polu szerokości geograficznej.
 */
export function worldMapArcs(
  c: WidgetContent,
  lang: WorldMapLang,
  profiles: ReadonlyArray<WorldMapProfile> = [],
): MapArc[] {
  const byId = new Map(profiles.map((p) => [p.userId, p]));
  const out: MapArc[] = [];
  for (const conn of worldMapConnections(c)) {
    const startLat = coerceLat(conn.startLat);
    const startLng = coerceLng(conn.startLng);
    const endLat = coerceLat(conn.endLat);
    const endLng = coerceLng(conn.endLng);
    if (startLat === null || startLng === null || endLat === null || endLng === null) continue;
    const startProfile = byId.get(conn.startUserId);
    const endProfile = byId.get(conn.endUserId);
    out.push({
      start: {
        lat: startLat,
        lng: startLng,
        label: pointLabel(conn.startLabel_pl, conn.startLabel_en, lang, startProfile),
        href: pointHref(conn.href, startProfile),
        avatar: startProfile?.avatarUrl || undefined,
        role: startProfile?.role || undefined,
      },
      end: {
        lat: endLat,
        lng: endLng,
        label: pointLabel(conn.endLabel_pl, conn.endLabel_en, lang, endProfile),
        href: pointHref(conn.href, endProfile),
        avatar: endProfile?.avatarUrl || undefined,
        role: endProfile?.role || undefined,
      },
    });
  }
  return out;
}

/** Ustawienia wyglądu i animacji odczytane z treści (z domyślnymi). */
export interface WorldMapView {
  title: string;
  subtitle: string;
  fit: MapFit;
  lineColor: string;
  dotColor: string;
  pointColor: string;
  bgColor: string;
  showLabels: boolean;
  animate: boolean;
  animationDuration: number;
  loop: boolean;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Wartość i18n treści z fallbackiem na drugi język (jak w pozostałych widgetach). */
function i18nStr(c: WidgetContent, base: string, lang: WorldMapLang): string {
  return strOf(c[`${base}_${lang}`]) || strOf(c[`${base}_pl`]) || strOf(c[`${base}_en`]);
}

/** Kadr rysunku; treść bez pola = dopasowanie do punktów. */
export function worldMapFit(c: WidgetContent): MapFit {
  const raw = strOf(c.fit);
  return raw === "world" || raw === "europe" ? raw : "auto";
}

export function worldMapView(c: WidgetContent, lang: WorldMapLang): WorldMapView {
  return {
    title: i18nStr(c, "title", lang),
    subtitle: i18nStr(c, "subtitle", lang),
    fit: worldMapFit(c),
    // Puste = kolor marki / motywu; `safeWidgetColor` odrzuca zapisy, których
    // nie wolno wstawić do atrybutu `style`.
    lineColor: safeWidgetColor(c.lineColor),
    dotColor: safeWidgetColor(c.dotColor),
    pointColor: safeWidgetColor(c.pointColor),
    bgColor: safeWidgetColor(c.bgColor),
    showLabels: c.showLabels !== false,
    animate: c.animate !== false,
    animationDuration: clamp(numOf(c.animationDuration, 2), 0.4, 10),
    loop: c.loop !== false,
  };
}
