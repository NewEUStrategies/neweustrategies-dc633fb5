// WYNIK 2026-10-03 (A/B 3+3, fixture, h2, `lighthouse-local.mjs --compare . . --html-transform-b`):
// mobile FCP 4,07 -> 1,52 s, LCP 4,82 -> 3,32 s, SI 4,07 -> 2,16 s, perf 67 -> 75 (TBT +376 ms, w szumie A/A);
// desktop FCP 0,77 -> 0,37 s, LCP 0,95 -> 0,69 s. Bajty High przed końcem obrazu LCP 618 -> 112 KB.
// To HIPOTEZA dla zmiany w kodzie (preloady w src/lib/http/frameworkPreloads.server.ts i manifeście),
// do potwierdzenia A/B artefaktów - wodospad importów opóźnia hydratację.
//
// Co-jeśli v2: Chrome 141 IGNORUJE fetchpriority na <link rel=modulepreload> (zmierzone:
// po transformacji v1 wszystkie chunki nadal High). Tu usuwamy modulepreload z <head>
// i z nagłówka Link, a wejście dostaje <script type=module fetchpriority=low> - priorytet
// grafu modułu dziedziczą statyczne importy. Koszt: wodospad (entry -> importy) i późniejsza
// hydratacja. Pytanie: ile FCP/LCP daje wyjęcie JS z puli High przed pierwszym malowaniem.
export default function transform(html, headers) {
  let out = html.replace(/<link\b[^>]*\brel="modulepreload"[^>]*>/g, "");
  out = out.replace(/<script\b([^>]*\btype="module"[^>]*)>/g, (m, attrs) =>
    /fetchpriority=/i.test(attrs) ? m : `<script${attrs} fetchpriority="low">`,
  );
  if (typeof headers.link === "string") {
    headers.link = headers.link
      .split(/,(?=\s*<)/)
      .filter((entry) => !/rel="?modulepreload"?/.test(entry))
      .join(",");
  }
  return out;
}
