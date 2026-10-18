// BUDŻET RENDERÓW PŁYWAJĄCYCH PASKÓW (`HeadingWidgetToolbar`, `MediaWidgetToolbar`).
//
// PO CO. Pasek nagłówka renderuje się przy KAŻDYM naciśnięciu klawisza
// w nagłówku (edytor oddaje nowy `data.text`, `HeadingBlock` dostaje nowy
// `block`), a pasek mediów - przy każdej zmianie ustawień obrazu/wideo. Oba
// paski miały efekt `useEffect(() => force(n + 1), [block.data])`, który po
// każdej takiej zmianie dokładał DRUGI, identyczny render: nowe propsy i tak
// renderują pasek, więc efekt nie wnosił nic poza podwojeniem pracy na
// najgorętszej ścieżce kanwy.
//
// CO MA TU DOWÓD
//   * zmiana danych bloku = DOKŁADNIE jeden commit poddrzewa paska (React
//     `Profiler` liczy commity, nie wywołania funkcji, więc pomiar nie zależy
//     od StrictMode ani od szczegółów implementacji),
//   * po zmianie pasek pokazuje NOWY stan danych (`aria-pressed`) - brak
//     drugiego renderu nie zostawia go na starym stanie.
//
// Granic nie ma czego atrapować: paski nie czytają kontekstu poza i18n
// (prawdziwe, `@/test/i18nReal`), a sam pomiar to publiczne API Reacta.
import { Profiler, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { HeadingWidgetToolbar } from "../HeadingWidgetToolbar";
import { MediaWidgetToolbar } from "../MediaWidgetToolbar";
import type { Block, Json } from "@/lib/blocks/types";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-blocks";

const t = realT("pl");
const NIC = () => undefined;

/** Montuje drzewo pod `Profiler`em i oddaje licznik commitów od ostatniego zerowania. */
function zLicznikiem(drzewo: ReactNode) {
  const licznik = { commity: 0 };
  const owin = (dziecko: ReactNode) => (
    <Profiler id="pasek" onRender={() => (licznik.commity += 1)}>
      {dziecko}
    </Profiler>
  );
  const view = render(owin(drzewo));
  licznik.commity = 0;
  return { licznik, przerysuj: (nowe: ReactNode) => view.rerender(owin(nowe)) };
}

function blok(type: string, data: Record<string, Json>): Block {
  return { id: "b1", type, data } as Block;
}

describe("budżet renderów pasków bloku", () => {
  it("pasek nagłówka: zmiana danych bloku to jeden commit, a pasek pokazuje nowy stan", () => {
    const start = blok("heading", { level: 2, text: "Traktat" });
    const { licznik, przerysuj } = zLicznikiem(
      <HeadingWidgetToolbar block={start} onChange={NIC} />,
    );
    przerysuj(
      <HeadingWidgetToolbar
        block={blok("heading", { level: 3, text: "Traktat lizboński" })}
        onChange={NIC}
      />,
    );
    expect(licznik.commity).toBe(1);
    expect(screen.getByRole("button", { name: "H3" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "H2" })).not.toHaveAttribute("aria-pressed");
  });

  it("pasek mediów: zmiana danych bloku to jeden commit, a pasek pokazuje nowy stan", () => {
    const start = blok("image", { url: "https://cdn.example.com/a.jpg", align: "left" });
    const { licznik, przerysuj } = zLicznikiem(
      <MediaWidgetToolbar kind="image" block={start} onChange={NIC} />,
    );
    przerysuj(
      <MediaWidgetToolbar
        kind="image"
        block={blok("image", { url: "https://cdn.example.com/a.jpg", align: "right" })}
        onChange={NIC}
      />,
    );
    expect(licznik.commity).toBe(1);
    expect(screen.getByRole("button", { name: t("blocks.toolbar.alignRight") })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("ponowny render z TYM SAMYM blokiem też jest jednym commitem", () => {
    // Rodzic kanwy re-renderuje się z wielu powodów (zaznaczenie, zapis w tle);
    // pasek nie może dokładać własnego renderu do żadnego z nich.
    const staly = blok("video", { url: "https://cdn.example.com/v.mp4", aspect: "4:3" });
    const { licznik, przerysuj } = zLicznikiem(
      <MediaWidgetToolbar kind="video" block={staly} onChange={NIC} />,
    );
    przerysuj(<MediaWidgetToolbar kind="video" block={staly} onChange={NIC} />);
    expect(licznik.commity).toBe(1);
  });
});
