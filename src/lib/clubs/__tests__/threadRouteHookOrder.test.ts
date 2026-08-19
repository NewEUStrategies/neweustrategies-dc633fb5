import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("club thread route hook order", () => {
  it("mounts composer hooks before the loading early return", () => {
    const source = readFileSync("src/routes/club.$clubSlug.t.$threadSlug.tsx", "utf8");
    const composerHook = source.indexOf("const composerRef = useRef<HTMLElement | null>(null)");
    // Kotwicą jest PIERWSZY wczesny `return` widoku. Warunek etapu wczytywania
    // przeniósł się do czystej funkcji (`resolveClubThreadStage` - tabela
    // przypadków w `threadPageView.test.ts`), więc w trasie stoi już tylko
    // rozstrzygnięcie po nazwie etapu. Sam inwariant się nie zmienia: hooki
    // kompozytora muszą być zamontowane PRZED każdym wyjściem z renderu,
    // inaczej React przerywa nawigację błędem „Rendered more hooks”.
    const loadingReturn = source.indexOf('if (stage === "loading")');

    expect(composerHook).toBeGreaterThan(-1);
    expect(loadingReturn).toBeGreaterThan(-1);
    expect(composerHook).toBeLessThan(loadingReturn);
  });
});
