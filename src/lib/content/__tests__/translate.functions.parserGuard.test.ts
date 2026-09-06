// STRAŻNIK DOKUMENTU BLOKÓW w `translatePostDraft`
// (`src/lib/content/translate.functions.ts:36-38`) - jedyna gałąź tego pliku,
// której nie da się wykonać z poziomu wejścia handlera.
//
// DLACZEGO OSOBNY PLIK, A NIE DOPISEK DO `translate.functions.test.ts`.
// Warunek `if (!parsed) throw new Error("Invalid blocks document")` zależy od
// KONTRAKTU współpracownika, a nie od danych wejściowych: `safeParseBlocks`
// (`src/lib/blocks/schema.ts:149-167`) ma typ zwrotny `BlocksDoc` i w najgorszym
// razie oddaje `{ version: 1, blocks: [] }` - nigdy wartości fałszywej. Żadne
// `blocks_doc_pl` nie zmusi więc handlera do wejścia w tę gałąź. Aby ją wykonać,
// trzeba podmienić SAM MODUŁ parsera, a podmiana obowiązuje cały plik testowy -
// gdyby stała w `translate.functions.test.ts`, tamte testy przestałyby
// przechodzić przez PRAWDZIWY parser i straciłyby swoją wartość (to one dowodzą,
// że blok spoza schematu jest po cichu wyrzucany). Stąd rozdział.
//
// CZEGO TEN PLIK DOWODZI - i dlaczego to nie jest „dobijanie gałęzi":
//   1. Strażnik DZIAŁA. Gdy parser odda wartość pustą, handler PRZERYWA błędem
//      „Invalid blocks document" i NIE woła płatnej bramki AI. To realny
//      kontrakt: bez niego `blocks = parsed.blocks` rzuciłoby `TypeError`
//      z komunikatem o niczym, a redakcja zobaczyłaby w edytorze awarię
//      zamiast informacji, że dokument bloków jest do niczego.
//   2. Strażnik jest STRAŻNIKIEM, a nie blokadą - przy poprawnej odpowiedzi
//      parsera ta sama ścieżka idzie dalej i segmentuje bloki.
//   3. Sprzężenie jest NAZWANE. Gałąź żyje wyłącznie dzięki założeniu, że
//      `safeParseBlocks` MOŻE oddać wartość pustą. Dzisiaj nie może - i właśnie
//      dlatego uszkodzony dokument przechodzi jako pusty (defekt opisany w
//      `translate.functions.test.ts`, blok `it.fails` „DEFEKT: uszkodzony
//      dokument bloków NIE jest odrzucany błędem"). Ten plik przypina drugą
//      stronę tej samej sprawy: jeśli kiedyś parser dostanie typ zwrotny
//      `BlocksDoc | null`, handler jest już na to gotowy i nie trzeba zgadywać,
//      co miał robić.
//
// Zero danych osobowych, zero sieci: bramka AI i limiter są zaatrapowane.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlocksDoc } from "@/lib/blocks/types";

const h = vi.hoisted(() => ({
  rateLimit: vi.fn(),
  translateSegmentsPlToEn: vi.fn(),
  safeParseBlocks: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireStaff: { __mw: "requireStaff" },
  requireAdminEditor: { __mw: "requireAdminEditor" },
}));
vi.mock("@/lib/server/rate-limit.server", () => ({ rateLimit: h.rateLimit }));
vi.mock("@/lib/server/aiTranslate.server", () => ({
  translateSegmentsPlToEn: h.translateSegmentsPlToEn,
}));
// JEDYNA podmiana merytoryczna tego pliku: parser dokumentu bloków.
vi.mock("@/lib/blocks/schema", () => ({ safeParseBlocks: h.safeParseBlocks }));

import { resetServerFnContext, setServerFnContext } from "@/test/serverFn";
import { translatePostDraft } from "@/lib/content/translate.functions";

const USER = "11111111-1111-4111-8111-111111111111";

/** Dokument w kształcie, w jakim przychodzi z edytora - treść bez znaczenia. */
const DOC_Z_EDYTORA = {
  version: 1,
  blocks: [{ id: "b1", type: "paragraph", data: { html: "<p>Akapit PL</p>" } }],
};

beforeEach(() => {
  h.rateLimit.mockReset().mockResolvedValue(true);
  h.translateSegmentsPlToEn
    .mockReset()
    .mockImplementation(async (texts: readonly string[]) => texts.map((t) => `EN(${t})`));
  h.safeParseBlocks.mockReset();
  setServerFnContext({ supabase: { __client: "user-scoped" }, userId: USER });
});

afterEach(() => {
  resetServerFnContext();
});

describe("translatePostDraft - strażnik odpowiedzi parsera bloków", () => {
  it("parser oddający wartość pustą PRZERYWA tłumaczenie, zanim ruszy bramka AI", async () => {
    // `as unknown as BlocksDoc` - wymuszamy wejście, którego typ zwrotny parsera
    // dziś nie dopuszcza; to jedyny sposób na wykonanie tej gałęzi bez zmiany
    // produkcji (i konwencja repozytorium: nigdy `any`).
    h.safeParseBlocks.mockReturnValue(null as unknown as BlocksDoc);

    await expect(
      translatePostDraft({ data: { title_pl: "Tytuł analizy", blocks_doc_pl: DOC_Z_EDYTORA } }),
    ).rejects.toThrow("Invalid blocks document");

    // Kluczowa asercja kosztowa: odmowa następuje PRZED wywołaniem modelu.
    expect(h.translateSegmentsPlToEn).not.toHaveBeenCalled();
    expect(h.safeParseBlocks).toHaveBeenCalledWith(DOC_Z_EDYTORA);
  });

  it("parser oddający `undefined` traktowany jest tak samo jak `null`", async () => {
    h.safeParseBlocks.mockReturnValue(undefined as unknown as BlocksDoc);

    await expect(
      translatePostDraft({ data: { title_pl: "Tytuł analizy", blocks_doc_pl: DOC_Z_EDYTORA } }),
    ).rejects.toThrow("Invalid blocks document");
    expect(h.translateSegmentsPlToEn).not.toHaveBeenCalled();
  });

  it("strażnik NIE blokuje poprawnej odpowiedzi parsera - segmenty bloków lecą dalej", async () => {
    h.safeParseBlocks.mockReturnValue({
      version: 1,
      blocks: [{ id: "b1", type: "paragraph", data: { html: "<p>Akapit PL</p>" } }],
    } as unknown as BlocksDoc);

    const out = await translatePostDraft({
      data: { title_pl: "Tytuł analizy", blocks_doc_pl: DOC_Z_EDYTORA },
    });

    expect(h.translateSegmentsPlToEn).toHaveBeenCalledTimes(1);
    expect(h.translateSegmentsPlToEn.mock.calls[0]?.[0]).toEqual([
      "Tytuł analizy",
      "<p>Akapit PL</p>",
    ]);
    expect(out.title_en).toBe("EN(Tytuł analizy)");
  });

  it("bez `blocks_doc_pl` parser NIE jest w ogóle wołany, więc strażnik nie ma czego pilnować", async () => {
    // Gałąź `if (data.blocks_doc_pl)` od strony fałszywej: pole `null` z edytora
    // (wpis richtext) nie może kosztować wywołania parsera ani odmowy.
    const out = await translatePostDraft({
      data: { title_pl: "Tytuł analizy", blocks_doc_pl: null },
    });

    expect(h.safeParseBlocks).not.toHaveBeenCalled();
    expect(out.blocks_en).toBeNull();
  });
});
