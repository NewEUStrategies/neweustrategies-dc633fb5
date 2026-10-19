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
//   * etykiety sterowania odtwarzaniem idą ze słownika (naprawiony defekt niżej).
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
  // NAPRAWIONE 2026-10-18 (był `it.fails`): trzy przyciski odtwarzania miały
  // napisy wpisane w kod - `title="Autoplay"`, `title="Loop"` i
  // `title={d.muted ? "Unmute" : "Mute"}` - więc czytnik ekranu i podpowiedź
  // czytały polskiemu redaktorowi jedyne angielskie nazwy na pasku.
  // KONTRAKT: nazwy idą ze słownika (`blocks.toolbar.autoplay|loop|mute|unmute`,
  // PL i EN), tak jak każda inna etykieta tego paska.
  it.each(["video", "audio"] as const)(
    "%s: w polskim panelu przyciski odtwarzania mają POLSKIE nazwy",
    (kind) => {
      zamontuj(kind);
      for (const klucz of ["autoplay", "loop", "mute"]) {
        expect(
          screen.getByRole("button", { name: t(`blocks.toolbar.${klucz}`) }),
        ).toBeInTheDocument();
      }
      for (const angielska of ["Autoplay", "Loop", "Mute", "Unmute"]) {
        expect(screen.queryByRole("button", { name: angielska })).toBeNull();
      }
    },
  );

  it("wyciszone medium zaprasza do włączenia dźwięku nazwą ze słownika", () => {
    const onChange = vi.fn<(next: Block) => void>();
    const block = {
      id: "m1",
      type: "audio",
      data: { url: "https://cdn.example.com/a", muted: true },
    } as Block;
    render(<MediaWidgetToolbar kind="audio" block={block} onChange={onChange} />);
    const przycisk = screen.getByRole("button", { name: t("blocks.toolbar.unmute") });
    expect(przycisk).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(przycisk);
    expect(onChange.mock.calls[0][0]).toEqual({ ...block, data: { ...block.data, muted: false } });
  });
});
