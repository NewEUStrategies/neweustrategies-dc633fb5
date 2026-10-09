// @vitest-environment node
//
// Metryki stanu dokumentu (P3.7b): `streamedStateBytes` (porcje strumienia
// zapytań poza barierą `$tsr`) i `dehydratedQueryHashCount` (`queryHash:`
// w barierze i strumieniu - po kompaktowej kopercie T1 zero). Krótki HTML
// w kształcie dokumentu TanStack Start: bariera, dwie porcje strumienia
// (`.next(...)` i `.return(...)`), skrypt aplikacji bez `$R["tsr"]`, JSON-LD
// z napisem `queryHash:` w treści (dane, nie stan - nie liczy się) i `<style>`
// z komentarzem (metryka P3.7a obok, bez zmian).
import { describe, expect, it } from "vitest";

import { GATED_METRICS, analyzeDocument } from "../../../../scripts/performance/documentWeight";

const BARRIER = `(self.$R=self.$R||{})["tsr"]=[];self.$_TSR={};$R["tsr"][0]={dehydratedData:{dehydratedQueryClient:{queries:[{queryKey:["a"],queryHash:"[\\"a\\"]",state:{data:1}}]}}}`;
const CHUNK = `($R=>$R[2].next($R[3]={queries:[{queryKey:["b"],queryHash:"[\\"b\\"]",state:{data:2}},{queryKey:["c"],state:{data:3}}]}))($R["tsr"])`;
const RETURN = `($R=>$R[2].return(void 0))($R["tsr"]);$_TSR.e();document.currentScript.remove()`;
const APP = `window.__SUPABASE_CONFIG__={"url":"x"}`;
const LD = `{"@type":"Thing","description":"queryHash: w treści"}`;

function doc(): string {
  return [
    "<!doctype html><html><head>",
    "<style>/* komentarz */.a{color:red}</style>",
    `<script type="application/ld+json">${LD}</script>`,
    "</head><body>",
    `<script class="$tsr" id="$tsr-stream-barrier">${BARRIER}</script>`,
    `<script>${APP}</script>`,
    `<script>${CHUNK}</script>`,
    `<script>${RETURN}</script>`,
    "</body></html>",
  ].join("");
}

const bytes = (s: string) => Buffer.byteLength(s, "utf8");

describe("metryki stanu dokumentu (P3.7b)", () => {
  it('streamedStateBytes = porcje strumienia z `$R["tsr"]`, bez bariery i skryptów aplikacji', () => {
    const w = analyzeDocument({ html: doc() });
    expect(w.streamedStateBytes).toBe(bytes(CHUNK) + bytes(RETURN));
    expect(w.dehydratedStateBytes).toBe(bytes(BARRIER));
  });

  it("dehydratedQueryHashCount liczy `queryHash:` w barierze i strumieniu (nie w JSON-LD)", () => {
    expect(analyzeDocument({ html: doc() }).dehydratedQueryHashCount).toBe(2);
    const compact = doc().replace(/queryHash:"\[\\"[a-z]\\"\]",/g, "");
    const w = analyzeDocument({ html: compact });
    expect(w.dehydratedQueryHashCount).toBe(0);
    expect(w.streamedStateBytes).toBeLessThan(bytes(CHUNK) + bytes(RETURN));
  });

  it("dokument bez stanu: obie metryki 0; komentarze CSS liczone jak dotąd", () => {
    const w = analyzeDocument({
      html: "<html><head><style>/*x*/a{}</style></head><body></body></html>",
    });
    expect(w.streamedStateBytes).toBe(0);
    expect(w.dehydratedQueryHashCount).toBe(0);
    expect(w.inlineCssCommentBytes).toBe(5);
  });

  it("obie metryki są bramkowane", () => {
    expect(GATED_METRICS).toContain("streamedStateBytes");
    expect(GATED_METRICS).toContain("dehydratedQueryHashCount");
  });
});
