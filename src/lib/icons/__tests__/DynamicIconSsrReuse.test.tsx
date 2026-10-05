// Ikona spoza zestawu przy HYDRATACJI: SVG z DOM-u serwera zamiast porcji
// danych `icons-N` (P2.4, hydration:H10 e).
//
// CO TEN PLIK DOWODZI:
//  1. Gdy w dokumencie jest SVG wyrenderowany przez serwer (znacznik
//     `data-dyn-icon`), klient hydratuje ikonę bez pobierania porcji danych i bez
//     błędu hydratacji - DOM zostaje bajt w bajt taki, jak wysłał serwer.
//  2. Bez SVG w dokumencie (render czysto kliencki) zostaje dotychczasowa droga
//     przez porcję danych.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { render, screen } from "@testing-library/react";
import { createLucideIcon, type IconNode } from "lucide-react";

const NODE: IconNode = [
  ["circle", { cx: "12", cy: "13", r: "8", key: "a" }],
  ["path", { d: "M5 3 2 6", key: "b" }],
  ["path", { d: "m9 13 2 2 4-4", key: "c" }],
];

const lazyCalls: string[] = [];
vi.mock("../lazyNamedIcon", async () => {
  const { lazy } = await import("react");
  return {
    lazyNamedIcon: (iconKey: string) => {
      lazyCalls.push(iconKey);
      return lazy(async () => ({
        default: () => <span data-testid="porcja">{iconKey}</span>,
      }));
    },
  };
});

beforeEach(() => {
  lazyCalls.length = 0;
  vi.resetModules();
});
afterEach(() => {
  document.body.innerHTML = "";
});

/** Dokładnie to, co serwer renderuje z porcji danych (`createLucideIcon`). */
function serverSvg(key: string): string {
  const Icon = createLucideIcon("alarm-clock-check", NODE);
  return renderToStaticMarkup(<Icon size={14} data-dyn-icon={key} />);
}

describe("DynamicIcon - SVG z DOM-u SSR", () => {
  it("hydratuje ikonę spoza zestawu bez porcji danych i bez błędu hydratacji", async () => {
    const { DynamicIcon } = await import("../DynamicIcon");
    const markup = `<!--$-->${serverSvg("AlarmClockCheck")}<!--/$-->`;
    const container = document.createElement("div");
    container.innerHTML = markup;
    document.body.appendChild(container);
    const errors: unknown[] = [];
    await act(async () => {
      hydrateRoot(container, <DynamicIcon name="alarm-clock-check" size={14} />, {
        onRecoverableError: (error) => errors.push(error),
      });
    });
    expect(errors).toEqual([]);
    expect(lazyCalls).toEqual([]);
    expect(container.innerHTML).toBe(markup);
  });

  it("bez SVG w dokumencie dociąga porcję danych jak dotąd", async () => {
    const { DynamicIcon } = await import("../DynamicIcon");
    render(<DynamicIcon name="alarm-clock-check" />);
    expect(await screen.findByTestId("porcja")).toHaveTextContent("AlarmClockCheck");
    expect(lazyCalls).toEqual(["AlarmClockCheck"]);
  });
});
