// PASEK MEDIÓW W KANWIE (`MediaWidgetToolbar`) - granica z kanwą bloków.
//
// Plik `mediaWidgetToolbar.test.tsx` obok dowodzi PALETY i ZAPISÓW paska.
// Tu zostaje to, czego tamten nie dotyka: zachowanie paska jako elementu
// pływającego NAD aktywnym blokiem w kanwie.
//
// CO MA TU DOWÓD
//   * pasek nie kradnie zaznaczenia: `mousedown` jest anulowany i na przycisku,
//     i na tle paska. Bez tego przeglądarka przenosi fokus na przycisk ZANIM
//     dojdzie `click`, a podpis/alt edytowany obok traci karetkę,
//   * kliknięcie w pasek NIE dociera do kanwy pod spodem - inaczej każde
//     ustawienie z paska przy okazji przełączałoby aktywny blok,
//   * etykiety sterowania odtwarzaniem (defekt zarejestrowany niżej).
//
// Bez atrap: pasek nie czyta kontekstu poza i18n (prawdziwe).
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { MediaWidgetToolbar } from "../MediaWidgetToolbar";
import type { Block } from "@/lib/blocks/types";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-blocks";

const t = realT("pl");

function zamontuj(kind: "image" | "video" | "audio") {
  const onChange = vi.fn<(next: Block) => void>();
  const onKanwa = vi.fn();
  const block = { id: "m1", type: kind, data: { url: "https://cdn.example.com/a" } } as Block;
  const view = render(
    <div onClick={onKanwa} data-testid="kanwa">
      <MediaWidgetToolbar kind={kind} block={block} onChange={onChange} />
    </div>,
  );
  return { ...view, onChange, onKanwa };
}

function mousedown(el: Element): Event {
  const zdarzenie = new Event("mousedown", { bubbles: true, cancelable: true });
  fireEvent(el, zdarzenie);
  return zdarzenie;
}

describe("MediaWidgetToolbar - pasek nie kradnie zaznaczenia ani kliknięcia", () => {
  it.each(["image", "video", "audio"] as const)(
    "%s: wciśnięcie przycisku paska NIE gasi zaznaczenia",
    (kind) => {
      zamontuj(kind);
      const przycisk = screen.getByRole("button", { name: t("blocks.toolbar.replaceUrl") });
      expect(mousedown(przycisk).defaultPrevented).toBe(true);
    },
  );

  it("wciśnięcie TŁA paska (między przyciskami) też nie gasi zaznaczenia", () => {
    zamontuj("image");
    const przycisk = screen.getByRole("button", { name: t("blocks.toolbar.alignLeft") });
    const tlo = przycisk.parentElement!;
    expect(tlo).not.toBe(screen.getByTestId("kanwa"));
    expect(mousedown(tlo).defaultPrevented).toBe(true);
  });

  it("kliknięcie ustawienia zapisuje je, ale NIE dociera do kanwy pod spodem", () => {
    const { onChange, onKanwa } = zamontuj("image");
    fireEvent.click(screen.getByRole("button", { name: t("blocks.toolbar.sizeSmall") }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toMatchObject({
      id: "m1",
      type: "image",
      data: { url: "https://cdn.example.com/a", size: "small" },
    });
    expect(onKanwa).not.toHaveBeenCalled();
  });
});

describe("MediaWidgetToolbar - etykiety sterowania odtwarzaniem", () => {
  // DEFEKT: STEROWANIE ODTWARZANIEM MÓWI PO ANGIELSKU W POLSKIM PANELU.
  //
  // WEJŚCIE: aktywny blok wideo albo audio, panel w języku polskim.
  // CO PSUJE: MediaWidgetToolbar.tsx renderuje trzy przyciski z napisami
  //   wpisanymi w kod - `title="Autoplay"`, `title="Loop"` i
  //   `title={d.muted ? "Unmute" : "Mute"}` - zamiast kluczy słownika. Ten sam
  //   pasek wszystkie pozostałe etykiety bierze z `blocks.toolbar.*`, a słownik
  //   ma już polskie odpowiedniki w innym miejscu (`blocks.ui.autoplay`
  //   „Auto-odtwarzanie", `blocks.ui.loop` „Pętla").
  // KONSEKWENCJA: czytnik ekranu i podpowiedź `title` czytają polskiemu
  //   redaktorowi „Autoplay / Loop / Mute" - jedyne angielskie nazwy na pasku,
  //   niezgodne z resztą panelu.
  // WYMAGANA POPRAWKA: klucze `blocks.toolbar.autoplay|loop|mute|unmute` (PL
  //   i EN) i `i18n.t(...)` w trzech przyciskach.
  // DLACZEGO `it.fails`, a nie poprawka: na angielskich napisach stoi 9 asercji
  //   w `mediaWidgetToolbar.test.tsx`, a ten sam defekt ma rodzeństwo
  //   w `WordStyleToolbar` („Bold (⌘B)", „Italic (⌘I)", „Underline (⌘U)",
  //   „Strikethrough", „Subscript", „Superscript", „Code", „Link (⌘K)" -
  //   18 asercji w `wordStyleToolbar.test.tsx` i kolejne w testach encji
  //   inline). To jedna zmiana dla całej rodziny pasków, z decyzją o formie
  //   skrótów klawiszowych w etykiecie (⌘ vs Ctrl), a nie łatka jednego pliku.
  it.fails("DEFEKT: w polskim panelu przyciski odtwarzania mają POLSKIE nazwy", () => {
    zamontuj("video");
    for (const angielska of ["Autoplay", "Loop", "Mute"]) {
      expect(screen.queryByRole("button", { name: angielska })).toBeNull();
    }
  });
});
