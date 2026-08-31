// COFNIECIE PO ZAPISIE W TLE - czwarta z operacji groznych dla tresci
// redaktora, wymieniona w zadaniu wprost.
//
// ── MECHANIZM, ZWERYFIKOWANY W KODZIE ────────────────────────────────────────
// `useLocalizedBlocksHistory` zeruje stosy undo/redo, gdy dokument przychodzacy
// z gory ma INNA TOZSAMOSC OBIEKTU niz ostatni, ktory sam wypchnal:
//
//   if (lastSyncRef.current?.lang !== lang || lastSyncRef.current.doc !== current) {
//     history.reset(current);
//   }
//
// (hooks/useLocalizedBlocksHistory.ts - efekt "Reset history ONLY on a language
// switch or an external value replacement"). Porownanie jest po REFERENCJI,
// nie po tresci.
//
// Autosave potrafi taka nowa tozsamosc wytworzyc: `persistPastedImages`
// wgrywa wklejone obrazy `data:` do storage i naklada mapowanie URL-i na
// BIEZACY stan formularza -
//   setSlug((f) => replaceFormImageUrls(f, result.replacements))
// (hooks/usePostEditorForm.ts:161). `replaceFormImageUrls` zwraca wtedy
// `{ ...form, blocks_data: nextBlocks, ... }`, czyli NOWY obiekt - a to dla
// efektu wyzej jest "zewnetrzna podmiana wartosci" i historia leci do zera.
//
// SKUTEK: redaktor wkleja obraz, autosave go utrwala i od tej chwili NIE MA
// JAK COFNAC niczego, co zrobil wczesniej. Tresc nie ginie z dokumentu, ale
// ginie mozliwosc jej odzyskania - a to jest ta sama klasa szkody.
//
// ── ZAWEZENIE WOBEC PIERWSZEJ DIAGNOZY - WAZNE, ZEBY NIE STRASZYC NA WYROST ──
// Rekonesans opisal to jako "kazdy autosave w tle". SPRAWDZONE: to NIEPRAWDA.
// `replaceFormImageUrls` ma zwarcie na braku trafien:
//
//   if (nextBlocks === blocksJson && nextBuilder === builderJson) return form;
//
// (lib/savePayload.ts:123 - zwraca TEN SAM obiekt), a `setSlug` jest wolane
// wylacznie pod `if (result.changed)` (usePostEditorForm.ts:158). Zwykly
// autosave bez wklejonych obrazow NIE rusza wiec historii - i jest na to
// asercja nizej, bo to jest kontrola dodatnia dla calej tej sekcji.
//
// Defekt jest zatem WARUNKOWY: zapala sie dokladnie wtedy, gdy autosave
// utrwalil wklejony obraz `data:`. To nadal realna sciezka redaktora
// (wklejenie zrzutu ekranu do wpisu jest codzienne), tylko nie kazda.
//
// ── CZEGO TEN PLIK NIE ROBI ─────────────────────────────────────────────────
// Nie naprawiam. Reset przy zewnetrznej podmianie jest ZAMIERZONY i ma wlasny
// test (hooks/__tests__/useLocalizedBlocksHistory.test.tsx - "reset przy
// zewnetrznej podmianie"), a cala mechanika `lastSyncRef` istnieje po to, zeby
// nie wrocila regresja "martwego undo". Naprawa musi wiec odroznic podmiane
// POCHODZACA Z EDYTORA (przepisane URL-e obrazow, tresc semantycznie ta sama)
// od podmiany z zewnatrz - czyli poszerzyc kontrakt lastSyncRef, a nie zdjac
// reset. Osobne zadanie, o innym profilu ryzyka.
import { describe, expect, it } from "vitest";

import { replaceFormImageUrls } from "@/components/admin/post-editor/lib/savePayload";
import type { PostForm } from "@/components/admin/post-editor/types";
import { BASE_FORM } from "@/test/post-editor/fixtures";

/** Formularz z jednym obrazem `data:` w dokumencie blokow. */
function formWithDataUrlImage(): PostForm {
  return {
    ...BASE_FORM,
    blocks_data: {
      pl: {
        version: 1,
        blocks: [
          {
            id: "b1",
            type: "image",
            // Jednopikselowy PNG - fikstura, nie prawdziwy plik.
            data: { url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==" },
          },
        ],
      },
      en: { version: 1, blocks: [] },
    },
  } as unknown as PostForm;
}

describe("cofniecie po zapisie w tle", () => {
  it("KONTROLA DODATNIA: brak trafien zachowuje TOZSAMOSC formularza", () => {
    // To jest powod, dla ktorego zwykly autosave nie rusza historii undo -
    // i asercja, ktora pilnuje, ze to zwarcie nie zniknie.
    const form = formWithDataUrlImage();
    const same = replaceFormImageUrls(form, new Map());
    expect(same).toBe(form);
  });

  it("zachowuje tozsamosc takze wtedy, gdy mapowanie nie pasuje do zadnego URL-a", () => {
    const form = formWithDataUrlImage();
    const same = replaceFormImageUrls(
      form,
      new Map([["data:image/png;base64,ZUPELNIE-INNY", "https://cdn.example.com/x.png"]]),
    );
    expect(same).toBe(form);
  });

  it("null przechodzi bez zmiany", () => {
    expect(replaceFormImageUrls(null, new Map([["a", "b"]]))).toBeNull();
  });

  it("TRAFIENIE tworzy NOWY obiekt formularza - to jest zaplon defektu", () => {
    // Nowa tozsamosc `blocks_data` jest dokladnie tym, co efekt resetu
    // w useLocalizedBlocksHistory czyta jako "zewnetrzna podmiana".
    const form = formWithDataUrlImage();
    const next = replaceFormImageUrls(
      form,
      new Map([
        [
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
          "https://cdn.example.com/posts/wklejony.png",
        ],
      ]),
    );
    expect(next).not.toBe(form);
    expect(next?.blocks_data).not.toBe(form.blocks_data);
    // Tresc jest semantycznie TA SAMA - podmieniony zostal wylacznie adres.
    expect(JSON.stringify(next?.blocks_data)).toContain("cdn.example.com/posts/wklejony.png");
    expect(JSON.stringify(next?.blocks_data)).not.toContain("data:image/png");
  });

  it("RODO: przepisany adres nie zostawia oryginalu w dokumencie", () => {
    const form = formWithDataUrlImage();
    const original = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
    const next = replaceFormImageUrls(
      form,
      new Map([[original, "https://cdn.example.com/posts/wklejony.png"]]),
    );
    expect(JSON.stringify(next?.blocks_data)).not.toContain(original);
  });

  it.fails(
    "POWINNA zachowac tozsamosc dokumentu, gdy zmienil sie WYLACZNIE adres obrazu (dzis ja gubi, a z nia historie undo)",
    () => {
      // Gdyby przepisanie URL-a bylo dla edytora podmiana "wlasna", a nie
      // zewnetrzna, `lastSyncRef` nie zobaczylby nowej tozsamosci i stosy
      // undo/redo przezylyby autosave. Dzis nie przezywaja.
      const form = formWithDataUrlImage();
      const next = replaceFormImageUrls(
        form,
        new Map([
          [
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
            "https://cdn.example.com/posts/wklejony.png",
          ],
        ]),
      );
      expect(next?.blocks_data).toBe(form.blocks_data);
    },
  );
});
