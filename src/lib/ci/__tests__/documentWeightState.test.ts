// @vitest-environment node
//
// Metryki stanu dokumentu (P3.7b): `dehydratedStateBytes` (stan początkowy routera),
// `streamedStateBytes` (porcje strumienia zapytań poza stanem początkowym) i
// `dehydratedQueryHashCount` (`queryHash:` w stanie początkowym i strumieniu - po kompaktowej
// kopercie T1 zero). Krótki HTML w kształcie dokumentu TanStack Start 1.169 (router-core
// 1.171.37, `ssr/hydrationScripts.js`): stan początkowy w DWÓCH skryptach
// `<script data-tsr-stream-part>` (porcje po 16 384 jednostki kodu - metryka sumuje), za nimi
// granica `/*$tsr-stream-boundary*\/` (bez stanu), dwie porcje strumienia (`.next([...])`
// z tablicą zapytań i `.return(...)`), skrypt aplikacji bez `$R["tsr"]`, JSON-LD z napisem
// `queryHash:` w treści (dane, nie stan - nie liczy się) i `<style>` z komentarzem (metryka
// P3.7a obok, bez zmian).
import { describe, expect, it } from "vitest";

import { GATED_METRICS, analyzeDocument } from "../../../../scripts/performance/documentWeight";

const INITIAL_HEADER = `(self.$R=self.$R||{})["tsr"]=[];self.$_TSR={}`;
const INITIAL_ROUTER = `$_TSR.router=($R=>$R[0]={dehydratedData:{query:{initial:[{queryKey:["a"],queryHash:"[\\"a\\"]",state:{data:1}}],stream:$R[2]={}}}})($R["tsr"]);{let s=document.currentScript,p;while((p=s.previousElementSibling)&&p.hasAttribute('data-tsr-stream-part'))p.remove();s.remove()}`;
const BOUNDARY = `document.currentScript.remove();/*$tsr-stream-boundary*/`;
const CHUNK = `($R=>$R[2].next([{queryKey:["b"],queryHash:"[\\"b\\"]",state:{data:2}},{queryKey:["c"],state:{data:3}}]))($R["tsr"]);document.currentScript.remove()`;
const RETURN = `($R=>$R[2].return(void 0))($R["tsr"]);$_TSR.e();document.currentScript.remove()`;
const APP = `window.__SUPABASE_CONFIG__={"url":"x"}`;
const LD = `{"@type":"Thing","description":"queryHash: w treści"}`;

function doc(): string {
  return [
    "<!doctype html><html><head>",
    "<style>/* komentarz */.a{color:red}</style>",
    `<script type="application/ld+json">${LD}</script>`,
    "</head><body>",
    `<script data-tsr-stream-part="">${INITIAL_HEADER}</script>`,
    `<script data-tsr-stream-part="">${INITIAL_ROUTER}</script>`,
    `<script>${APP}</script>`,
    `<script>${BOUNDARY}</script>`,
    `<script>${CHUNK}</script>`,
    `<script>${RETURN}</script>`,
    "</body></html>",
  ].join("");
}

const bytes = (s: string) => Buffer.byteLength(s, "utf8");

describe("metryki stanu dokumentu (P3.7b)", () => {
  it("dehydratedStateBytes = suma skryptów `data-tsr-stream-part`; granica się nie liczy", () => {
    const w = analyzeDocument({ html: doc() });
    expect(w.dehydratedStateBytes).toBe(bytes(INITIAL_HEADER) + bytes(INITIAL_ROUTER));
  });

  it('streamedStateBytes = porcje strumienia z `$R["tsr"]`, bez stanu początkowego i skryptów aplikacji', () => {
    const w = analyzeDocument({ html: doc() });
    expect(w.streamedStateBytes).toBe(bytes(CHUNK) + bytes(RETURN));
  });

  it("dehydratedQueryHashCount liczy `queryHash:` w stanie początkowym i strumieniu (nie w JSON-LD)", () => {
    expect(analyzeDocument({ html: doc() }).dehydratedQueryHashCount).toBe(2);
    const compact = doc().replace(/queryHash:"\[\\"[a-z]\\"\]",/g, "");
    const w = analyzeDocument({ html: compact });
    expect(w.dehydratedQueryHashCount).toBe(0);
    expect(w.streamedStateBytes).toBeLessThan(bytes(CHUNK) + bytes(RETURN));
    expect(w.dehydratedStateBytes).toBeLessThan(bytes(INITIAL_HEADER) + bytes(INITIAL_ROUTER));
  });

  it("dokument bez stanu: metryki stanu 0; komentarze CSS liczone jak dotąd", () => {
    const w = analyzeDocument({
      html: "<html><head><style>/*x*/a{}</style></head><body></body></html>",
    });
    expect(w.dehydratedStateBytes).toBe(0);
    expect(w.streamedStateBytes).toBe(0);
    expect(w.dehydratedQueryHashCount).toBe(0);
    expect(w.inlineCssCommentBytes).toBe(5);
  });

  it("metryki stanu są bramkowane", () => {
    expect(GATED_METRICS).toContain("dehydratedStateBytes");
    expect(GATED_METRICS).toContain("streamedStateBytes");
    expect(GATED_METRICS).toContain("dehydratedQueryHashCount");
  });
});
