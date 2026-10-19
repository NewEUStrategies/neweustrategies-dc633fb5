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
//
// 2026-10-18: dawny `it.fails` tego pliku wymagal, by po przepisaniu adresu
// `blocks_data` zachowalo TOZSAMOSC obiektu - tego nie da sie spelnic bez
// mutacji danych w miejscu (gorszy defekt). Zastapil go `it.fails` na tym, co
// redaktor faktycznie traci: `canUndo` haka historii po autosave. Granice:
// brak atrap - prawdziwy `replaceFormImageUrls` i prawdziwy hak historii.
import { describe, expect, it } from "vitest";
import { useState } from "react";
import { act, renderHook } from "@testing-library/react";

import { useLocalizedBlocksHistory } from "../hooks/useLocalizedBlocksHistory";
import { replaceFormImageUrls } from "@/components/admin/post-editor/lib/savePayload";
import type { PostForm } from "@/components/admin/post-editor/types";
import { postForm } from "@/test/post-editor/fixtures";

const BASE_FORM = postForm();

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
});

// ── SKUTEK NA HISTORII: hak historii + rodzic w ksztalcie formularza wpisu ──
// Asercje ida na to, co widzi redaktor (`canUndo`, dokument po cofnieciu),
// a nie na tozsamosc obiektow: przepisanie adresu MUSI dac nowy dokument
// (dane sa niemutowalne), wiec tozsamosc nie moze byc kryterium naprawy.
const DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
const CDN_URL = "https://cdn.example.com/posts/wklejony.png";

/** Rodzic jak `usePostEditorForm`: formularz w stanie, autosave przez `replaceFormImageUrls`. */
function useFormularzZHistoria() {
  const [form, setForm] = useState<PostForm>(formWithDataUrlImage);
  const localized = useLocalizedBlocksHistory(form.blocks_data, (next) =>
    setForm((f) => ({ ...f, blocks_data: next })),
  );
  const autosave = (replacements: Map<string, string>) =>
    setForm((f) => replaceFormImageUrls(f, replacements) ?? f);
  return { form, history: localized.history, autosave };
}

function zEdycja() {
  const hook = renderHook(() => useFormularzZHistoria());
  const przed = hook.result.current.history.doc;
  act(() =>
    hook.result.current.history.setDoc(
      { ...przed, blocks: [...przed.blocks, { id: "b2", type: "paragraph", data: { html: "x" } }] },
      true,
    ),
  );
  expect(hook.result.current.history.canUndo).toBe(true);
  return hook;
}

describe("cofniecie po zapisie w tle - historia redaktora", () => {
  it("KONTROLA DODATNIA: autosave bez trafien nie rusza historii undo", () => {
    const { result } = zEdycja();
    act(() => result.current.autosave(new Map()));
    expect(result.current.history.canUndo).toBe(true);
  });

  // DEFEKT ZAREJESTROWANY (zostaje `it.fails` 2026-10-18 - poza zakresem pakietu).
  // WEJSCIE: redaktor edytuje dokument z wklejonym obrazem `data:`, a autosave
  //   utrwala obraz i przepisuje jego adres na URL storage (`replaceFormImageUrls`).
  // CO PSUJE: nowy obiekt `blocks_data` to dla `useLocalizedBlocksHistory`
  //   "zewnetrzna podmiana" - stosy undo/redo leca do zera.
  // WYMAGANA POPRAWKA: poszerzyc kontrakt `lastSyncRef` w
  //   `hooks/useLocalizedBlocksHistory.ts` o podmiane POCHODZACA Z EDYTORA
  //   (mapa `data:` -> URL z `usePostEditorForm.persistPastedImages`) i
  //   przepisac ta sama mapa takze stosy past/future - inaczej cofniecie
  //   przywrociloby adres `data:` (ponowny upload i oryginal z powrotem
  //   w dokumencie). To zmiana kontraktu miedzy `post-editor` (poza modulem)
  //   a hakiem historii, nie lokalna poprawka `savePayload`.
  it.fails(
    "POWINNA przetrwac historia undo, gdy autosave przepisal WYLACZNIE adres obrazu (dzis znika)",
    () => {
      const { result } = zEdycja();
      act(() => result.current.autosave(new Map([[DATA_URL, CDN_URL]])));
      expect(JSON.stringify(result.current.form.blocks_data)).toContain(CDN_URL);
      expect(result.current.history.canUndo).toBe(true);
    },
  );
});
