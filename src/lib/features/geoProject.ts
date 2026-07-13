// Rzutowanie lon/lat na canvas zasobu geo (public/geo/*.v1.json) przy użyciu
// metadanych `proj` osadzonych przez generator. Dzięki temu mapa korytarzy
// rysuje linie i markery DOKŁADNIE na tym samym układzie współrzędnych co
// choropleta krajów - bez duplikowania kodu projekcji (i ryzyka dryfu).
//
// Zero zależności runtime, w pełni testowalne. Gdy zasób nie niesie `proj`
// (starsza zcache'owana kopia), zwracamy projektor null i widok chowa warstwę
// korytarzy zamiast rysować ją w złym miejscu.
import type { GeoProjectionMeta } from "@/lib/charts/types";

const RAD = Math.PI / 180;

/** Natural Earth I - wielomian z d3-geo (ISC), spójny z generatorem. */
function naturalEarth1(lonDeg: number, latDeg: number): [number, number] {
  const lambda = lonDeg * RAD;
  const phi = latDeg * RAD;
  const phi2 = phi * phi;
  const phi4 = phi2 * phi2;
  return [
    lambda *
      (0.8707 - 0.131979 * phi2 + phi4 * (-0.013791 + phi4 * (0.003971 * phi2 - 0.001529 * phi4))),
    phi * (1.007226 + phi2 * (0.015085 + phi4 * (-0.044475 + 0.028874 * phi2 - 0.005916 * phi4))),
  ];
}

/** Lambert azimuthal equal-area wokół (lat0, lon0) - jak w generatorze. */
function laea(lat0Deg: number, lon0Deg: number) {
  const phi1 = lat0Deg * RAD;
  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  return (lonDeg: number, latDeg: number): [number, number] => {
    const phi = latDeg * RAD;
    const dLambda = (lonDeg - lon0Deg) * RAD;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const denom = 1 + sinPhi1 * sinPhi + cosPhi1 * cosPhi * Math.cos(dLambda);
    const k = Math.sqrt(2 / Math.max(denom, 1e-9));
    return [
      k * cosPhi * Math.sin(dLambda),
      k * (cosPhi1 * sinPhi - sinPhi1 * cosPhi * Math.cos(dLambda)),
    ];
  };
}

export interface Point2D {
  x: number;
  y: number;
}

export type GeoProjector = (lon: number, lat: number) => Point2D;

/**
 * Buduje funkcję lon/lat -> px (w układzie viewBoxu zasobu) z metadanych
 * projekcji. Zwraca null, gdy metadanych brak lub typ jest nieznany.
 */
export function makeGeoProjector(proj: GeoProjectionMeta | undefined): GeoProjector | null {
  if (!proj) return null;
  const raw =
    proj.type === "laea"
      ? laea(proj.lat0 ?? 52, proj.lon0 ?? 10)
      : proj.type === "naturalEarth1"
        ? naturalEarth1
        : null;
  if (!raw) return null;
  return (lon: number, lat: number): Point2D => {
    const [px, pyUp] = raw(lon, lat);
    return {
      x: (px - proj.minX) * proj.scale + proj.padding,
      // Generator odwraca y (SVG rośnie w dół) PRZED dopasowaniem bboxu.
      y: (-pyUp - proj.minY) * proj.scale + proj.padding,
    };
  };
}

/**
 * Ścieżka kwadratowej krzywej Béziera przez ciąg punktów (gładkie korytarze):
 * węzły łączy krzywa z punktem kontrolnym w połowie, lekko odsuniętym w bok,
 * co daje charakterystyczny "łuk trasy" zamiast łamanej. Deterministyczne
 * (offset liczony z geometrii), więc SSR i klient dają identyczny `d`.
 */
export function corridorPath(points: Point2D[], bend = 0.12): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  let d = `M${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    // Normalna do odcinka, przesuwa punkt kontrolny o `bend` długości odcinka.
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const cx = mx - dy * bend;
    const cy = my + dx * bend;
    d += `Q${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }
  return d;
}
