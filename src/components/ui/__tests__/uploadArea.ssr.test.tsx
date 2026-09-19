// OBSZAR WGRYWANIA W RENDERZE SERWEROWYM I PRZY HYDRATACJI.
//
// PO CO OSOBNY PLIK. Wspólny obszar wgrywania stoi na powierzchniach, które
// platforma renderuje SERWEROWO (kariera, profil, sekcje uczestnika), więc
// pierwszy render powstaje w Workerze - bez `window`, bez `document`, bez
// zegara przeglądarki. `render()` z testing-library tego nie zobaczy: tam
// komponent od razu jest w przeglądarce. Jedyny sposób zobaczenia PIERWSZEGO
// przejścia to render do napisu, a potem hydratacja tego samego napisu.
//
// CZEGO PILNUJE TEN PLIK:
//   1. render serwerowy nie wysadza się i wypisuje pełny obszar (tytuł, opis,
//      CTA, ukryte pole pliku) - żaden odczyt DOM-u nie wyciekł do ciała
//      renderu;
//   2. identyfikatory `useId` wiążące `aria-labelledby` / `aria-describedby`
//      SĄ W HTML-u i wskazują istniejące węzły - inaczej czytnik ekranu
//      dostaje obszar bez nazwy dokładnie na tych stronach, które są
//      indeksowane;
//   3. hydratacja tego HTML-a przebiega BEZ ROZJAZDU. React 19 po rozjeździe
//      porzuca serwerowe poddrzewo i renderuje je od zera - czyli traci
//      dokładnie ten HTML, po który jest SSR. Dowodem jest cisza w
//      `console.error`, bo React nie rzuca wyjątku, tylko loguje;
//   4. pierwszy render jest DETERMINISTYCZNY: dwa renderowania tego samego
//      drzewa dają bajt w bajt ten sam napis (brak losowości i zegara).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { FileAudio, FileText, FileVideo } from "lucide-react";

import { UploadArea } from "../upload-area";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function tree() {
  return (
    <UploadArea
      title="Wgraj materiał"
      description={"PDF, wideo lub audio.\nDo 200 MB."}
      ctaLabel="Wybierz plik"
      icons={[FileText, FileVideo, FileAudio]}
      accept="application/pdf,video/mp4"
      hint="Rekomendowane: 1600 x 900 px"
      footer={<input type="url" aria-label="Adres" readOnly value="" />}
      onFiles={() => undefined}
    />
  );
}

describe("UploadArea - render serwerowy", () => {
  it("renderuje się do napisu z pełną treścią obszaru", () => {
    const html = renderToString(tree());

    expect(html).toContain('data-slot="upload-area"');
    expect(html).toContain("Wgraj materiał");
    expect(html).toContain("Wybierz plik");
    expect(html).toContain('type="file"');
    expect(html).toContain('accept="application/pdf,video/mp4"');
    // Stan interakcji nie ma prawa wyciec do pierwszego renderu.
    expect(html).not.toContain("data-drag-over");
    expect(html).not.toContain("data-busy");
  });

  it("wiązania ARIA wskazują węzły OBECNE w serwerowym HTML-u", () => {
    const html = renderToString(tree());

    const labelledBy = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
    const describedBy = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(labelledBy).toBeTruthy();
    expect(describedBy).toBeTruthy();
    expect(html).toContain(`id="${labelledBy}"`);
    expect(html).toContain(`id="${describedBy}"`);
  });

  it("pierwszy render jest deterministyczny - dwa przebiegi dają ten sam napis", () => {
    // `useId` liczy identyfikator z pozycji w drzewie, a nie z licznika modułu
    // ani z losowości - inaczej każdy render serwera dawałby inny HTML i każda
    // hydratacja byłaby rozjazdem.
    expect(renderToString(tree())).toBe(renderToString(tree()));
  });
});

describe("UploadArea - hydratacja", () => {
  it("hydratuje serwerowy HTML BEZ rozjazdu (cisza w console.error)", async () => {
    const errors: unknown[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args[0]);
    });

    const container = document.createElement("div");
    container.innerHTML = renderToString(tree());
    document.body.appendChild(container);
    const serwerowy = container.innerHTML;

    await act(async () => {
      hydrateRoot(container, tree());
    });

    expect(errors, `console.error: ${errors.map(String).join(" | ")}`).toEqual([]);
    // Hydratacja nie przepisuje poddrzewa: HTML po niej jest tym samym HTML-em.
    expect(container.innerHTML).toBe(serwerowy);
  });

  it("po hydratacji obszar działa - kliknięcie w tło otwiera wybór pliku", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(tree());
    document.body.appendChild(container);

    await act(async () => {
      hydrateRoot(container, tree());
    });

    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (input === null) throw new Error("test: brak pola pliku po hydratacji");
    const click = vi.spyOn(input, "click").mockImplementation(() => {});

    const area = container.querySelector<HTMLElement>('[data-slot="upload-area"]');
    await act(async () => {
      area?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(click).toHaveBeenCalledTimes(1);
  });
});
