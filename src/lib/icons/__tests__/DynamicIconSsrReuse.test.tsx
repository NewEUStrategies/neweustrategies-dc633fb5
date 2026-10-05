// Ikona spoza zestawu przy HYDRATACJI: SVG z DOM-u serwera zamiast porcji
// danych `icons-N` (P2.4, hydration:H10 e).
//
// CO TEN PLIK DOWODZI:
//  1. Prawdziwa droga serwerowa (`DynamicIcon` -> `DynamicIconChunk` ->
//     `lazyNamedIcon` -> porcja danych) znakuje `<svg>` atrybutem
//     `data-dyn-icon`, a klient hydratuje DOKŁADNIE ten HTML bez pobierania
//     porcji danych i bez błędu hydratacji - DOM zostaje bajt w bajt taki, jak
//     wysłał serwer. Gdyby droga serwerowa zgubiła znacznik, `icons-N` po cichu
//     wróciłoby na `/` - ten test to oblewa (recenzja P2.4 m4).
//  2. Bez SVG w dokumencie (render czysto kliencki) zostaje dotychczasowa droga
//     przez porcję danych - kontrapunkt, który dowodzi też, że licznik widzi
//     sięgnięcie do porcji.
// Mockujemy wyłącznie porcje JSON (prawdziwe dane, licznik odczytów wpisu ikony).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { hydrateRoot } from "react-dom/client";
import { render, waitFor } from "@testing-library/react";

// Licznik ODCZYTÓW wpisu ikony z porcji danych (prawdziwe dane porcji). Wynik
// fabryki mocka vitest pamięta mimo `resetModules`, więc liczymy odczyt
// wpisu, nie import modułu.
const h = vi.hoisted(() => ({
  loads: [] as string[],
  track: (registry: Record<string, unknown>) =>
    new Proxy(registry, {
      get(target, property, receiver) {
        if (property === "alarm-clock-check") h.loads.push(property);
        return Reflect.get(target, property, receiver);
      },
    }),
}));
vi.mock("../chunks/icons-0.json", async (importOriginal) => ({
  default: h.track((await importOriginal<{ default: Record<string, unknown> }>()).default),
}));
vi.mock("../chunks/icons-1.json", async (importOriginal) => ({
  default: h.track((await importOriginal<{ default: Record<string, unknown> }>()).default),
}));
vi.mock("../chunks/icons-2.json", async (importOriginal) => ({
  default: h.track((await importOriginal<{ default: Record<string, unknown> }>()).default),
}));
vi.mock("../chunks/icons-3.json", async (importOriginal) => ({
  default: h.track((await importOriginal<{ default: Record<string, unknown> }>()).default),
}));

/** Nazwa spoza zestawu kuratorowanego. */
const NAME = "alarm-clock-check";
const KEY = "AlarmClockCheck";

beforeEach(() => {
  h.loads.length = 0;
  vi.resetModules();
});
afterEach(() => {
  document.body.innerHTML = "";
});

/** Render serwerowy, który czeka na granice Suspense (porcja danych). */
async function serverHtml(element: ReactNode): Promise<string> {
  const { renderToReadableStream } = await import("react-dom/server");
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
  }
  return html + decoder.decode();
}

describe("DynamicIcon - SVG z DOM-u SSR", () => {
  it("serwer znakuje SVG z porcji danych, a klient hydratuje go bez porcji i bez błędu", async () => {
    const server = await import("../DynamicIcon");
    const html = await serverHtml(<server.DynamicIcon name={NAME} size={14} />);
    // Serwer naprawdę sięgnął do porcji i oznaczył SVG.
    expect(h.loads.length).toBeGreaterThan(0);
    const probe = document.createElement("div");
    probe.innerHTML = html;
    const svg = probe.querySelector("svg");
    expect(svg?.getAttribute("data-dyn-icon")).toBe(KEY);
    expect(svg?.querySelectorAll("path, circle").length).toBeGreaterThan(1);

    // Świeży moduł klienta (pusta pamięć ikon i porcji).
    h.loads.length = 0;
    vi.resetModules();
    const { DynamicIcon } = await import("../DynamicIcon");
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const before = container.innerHTML;
    const errors: unknown[] = [];
    await act(async () => {
      hydrateRoot(container, <DynamicIcon name={NAME} size={14} />, {
        onRecoverableError: (error) => errors.push(error),
      });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(errors).toEqual([]);
    expect(h.loads).toEqual([]);
    expect(container.innerHTML).toBe(before);
  });

  it("bez SVG w dokumencie dociąga porcję danych jak dotąd", async () => {
    const { DynamicIcon } = await import("../DynamicIcon");
    const { container } = render(<DynamicIcon name={NAME} size={14} />);
    await waitFor(() =>
      expect(container.querySelector("svg")?.getAttribute("data-dyn-icon")).toBe(KEY),
    );
    expect(h.loads).toHaveLength(1);
  });
});
