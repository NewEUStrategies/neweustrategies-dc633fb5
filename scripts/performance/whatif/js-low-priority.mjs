// WYNIK 2026-10-03 (A/B 3+3, fixture, h2): BEZ EFEKTU - Chrome 141 ignoruje fetchpriority na
// <link rel=modulepreload>, wszystkie chunki zostają High (FCP/LCP delta 0,00 s). Zostawione jako
// kontrola: to jest de facto przebieg A/A harnessu.
//
// Co-jeśli: cały JS startowy (modulepreload w <head> i w nagłówku Link + <script type=module>)
// z fetchpriority=low. Hipoteza: Lantern liczy skrypty High jako render-blocking
// (NetworkNode.hasRenderBlockingPriority), więc gdy moduł wykona się przed obserwowanym
// pierwszym malowaniem, cały JS bootu wchodzi do grafu FCP/LCP. Low = poza grafem.
export default function transform(html, headers) {
  let out = html.replace(/<link\b([^>]*\brel="modulepreload"[^>]*?)\/?>/g, (m, attrs) =>
    /fetchpriority=/i.test(attrs) ? m : `<link${attrs} fetchpriority="low"/>`,
  );
  out = out.replace(/<script\b([^>]*\btype="module"[^>]*)>/g, (m, attrs) =>
    /fetchpriority=/i.test(attrs) ? m : `<script${attrs} fetchpriority="low">`,
  );
  if (typeof headers.link === "string") {
    headers.link = headers.link.replace(
      /(<[^>]+>;\s*rel="?modulepreload"?)/g,
      '$1; fetchpriority="low"',
    );
  }
  return out;
}
