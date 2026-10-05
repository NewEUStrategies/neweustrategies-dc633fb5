// CO-JEŚLI C3 (boot po LCP), wariant B werdyktu boot-js:C3 („corrected": wyzwalacz z wpisu
// `largest-contentful-paint`). Odtworzone 2026-10-04 dla bramki fali 1 z opisu w
// docs/performance/2026-10-03-pagespeed-85-95/faza1/raporty/werdykty/boot-js--C3.md (oryginał żył
// w scratchpadzie sesji fazy 1 i nie przetrwał). Użycie w A/B, zwykle po obu stronach:
//   node scripts/performance/lighthouse-local.mjs --compare <A> <B> \
//     --html-transform scripts/performance/whatif/c3-lcpobs.mjs --html-transform-b scripts/performance/whatif/c3-lcpobs.mjs
//
// Transformacja robi to samo co wariant B z werdyktu:
//   - zdejmuje KAŻDY `modulepreload` z dokumentu i z nagłówka `Link` (URL-e zbiera w kolejności),
//   - zamienia `<script type="module" src=entry>` na skrypt inline, który w JEDNEJ serii wstrzykuje
//     wszystkie zebrane URL-e jako `modulepreload` i dopisuje skrypt wejścia,
//   - wyzwalacz: pierwszy wpis `largest-contentful-paint` + `setTimeout(0)`; zapasy: `load` +
//     `setTimeout(0)`, pierwsza interakcja (`pointerdown`/`keydown`/`touchstart`, capture) i 3 s po
//     `DOMContentLoaded`.
// To HIPOTEZA dla P2.1 (przepisanie manifestu w buildzie), nie dowód. Dokument bez skryptu wejścia
// zostaje bez zmian (z ostrzeżeniem), żeby seria nie mierzyła po cichu innej strony.

const ENTRY_SCRIPT = /<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"[^>]*>\s*<\/script>/i;
const MODULEPRELOAD_TAG = /<link\b[^>]*\brel="?modulepreload"?[^>]*>/gi;

function bootstrap(urls, entry) {
  // JSON.stringify URL-i z manifestu (bez danych z żądania); `<` i tak nie występuje w ścieżkach assets.
  const data = JSON.stringify({ u: urls, e: entry }).replace(/</g, "\\u003c");
  return (
    "<script>(function(){var c=" +
    data +
    ",d=document,done=false;" +
    "function boot(){if(done)return;done=true;" +
    'for(var i=0;i<c.u.length;i++){var l=d.createElement("link");l.rel="modulepreload";l.href=c.u[i];d.head.appendChild(l);}' +
    'var s=d.createElement("script");s.type="module";s.src=c.e;d.head.appendChild(s);}' +
    "function later(){setTimeout(boot,0);}" +
    'try{new PerformanceObserver(function(l){if(l.getEntries().length)later();}).observe({type:"largest-contentful-paint",buffered:true});}catch(e){later();}' +
    'addEventListener("load",later,{once:true});' +
    '["pointerdown","keydown","touchstart"].forEach(function(t){addEventListener(t,boot,{capture:true,once:true,passive:true});});' +
    'd.addEventListener("DOMContentLoaded",function(){setTimeout(boot,3000);},{once:true});' +
    "})();</script>"
  );
}

export default function transform(html, headers) {
  const entryMatch = ENTRY_SCRIPT.exec(html);
  if (!entryMatch) {
    console.error("c3-lcpobs: brak <script type=module src=...> - dokument bez zmian");
    return html;
  }
  const entry = entryMatch[1];
  const urls = [];
  const seen = new Set([entry]);
  const add = (url) => {
    if (url && !seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  };

  let out = html.replace(MODULEPRELOAD_TAG, (tag) => {
    add(/\bhref="([^"]+)"/i.exec(tag)?.[1]);
    return "";
  });
  if (typeof headers.link === "string") {
    headers.link = headers.link
      .split(/,(?=\s*<)/)
      .filter((part) => {
        if (!/rel="?modulepreload"?/i.test(part)) return true;
        add(/<([^>]+)>/.exec(part)?.[1]);
        return false;
      })
      .join(",");
  }
  // Wejście na początku serii, jak w werdykcie (entry, zamknięcie bootu, słownik, chunki trasy i widgetów).
  urls.unshift(entry);
  return out.replace(ENTRY_SCRIPT, () => bootstrap(urls, entry));
}
