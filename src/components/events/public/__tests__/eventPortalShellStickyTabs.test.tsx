// Pasek zakładek wydarzenia jest przyklejony pod nagłówkiem serwisu - właściciel
// chce, żeby zakładki były widoczne CAŁY CZAS.
//
// DLACZEGO TEN TEST ISTNIEJE. `--sticky-header-h` nagłówek publikuje leniwie
// (pierwszy gest, potem po ustaniu zwijania), a na komputerze arkusz nie ma dla
// niej wartości domyślnej - pasek oparty tylko na niej stawał POD nagłówkiem
// (z-40) i był niewidoczny. Powłoka pisze więc pozycję paska z pomiaru
// nagłówka. Pomyłka nie rzuca wyjątku: pasek po prostu znika pod nagłówkiem.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { EventPortalShell } from "@/components/events/public/organisms/EventPortalShell";

function mountHeader(position: "sticky" | "relative", height: number): HTMLElement {
  const header = document.createElement("header");
  header.setAttribute("data-site-header", "");
  header.style.position = position;
  header.getBoundingClientRect = () => ({ height }) as DOMRect;
  document.body.prepend(header);
  return header;
}

function renderShell(stickyTabs: boolean) {
  return render(
    <EventPortalShell
      branding={null}
      backSlot={null}
      titleSlot={null}
      stickyTabs={stickyTabs}
      tabsSlot={<nav aria-label="zakladki" />}
    />,
  );
}

function bar(): HTMLElement {
  return document.querySelector("nav[aria-label='zakladki']")?.parentElement as HTMLElement;
}

afterEach(() => {
  cleanup();
  document.querySelector("header[data-site-header]")?.remove();
});

describe("EventPortalShell - przyklejony pasek zakładek", () => {
  it("staje tuż pod przyklejonym nagłówkiem, z jego zmierzonej wysokości", () => {
    mountHeader("sticky", 118);
    renderShell(true);
    expect(bar().classList.contains("event-tabs-sticky")).toBe(true);
    expect(bar().style.top).toBe("118px");
    // Fokus klawiatury odsuwa się od paska przez `scroll-padding-top` korzenia.
    expect(document.documentElement.hasAttribute("data-event-tabs-active")).toBe(true);
    expect(screenShell().getAttribute("data-event-tabs")).toBe("sticky");
  });

  it("nagłówek, który odjeżdża ze stroną, daje pasek przy samej krawędzi okna", () => {
    mountHeader("relative", 260);
    renderShell(true);
    expect(bar().style.top).toBe("0px");
  });

  it("odmontowanie zdejmuje flagę korzenia i pozycję paska", () => {
    mountHeader("sticky", 90);
    const view = renderShell(true);
    const node = bar();
    view.unmount();
    expect(document.documentElement.hasAttribute("data-event-tabs-active")).toBe(false);
    expect(node.style.top).toBe("");
  });

  it("podgląd studia (bez `stickyTabs`) nie przykleja paska i nie dotyka korzenia", () => {
    mountHeader("sticky", 118);
    renderShell(false);
    expect(bar().classList.contains("event-tabs-sticky")).toBe(false);
    expect(bar().style.top).toBe("");
    expect(document.documentElement.hasAttribute("data-event-tabs-active")).toBe(false);
    expect(screenShell().hasAttribute("data-event-tabs")).toBe(false);
  });
});

function screenShell(): HTMLElement {
  return document.querySelector("[data-testid='event-portal-shell']") as HTMLElement;
}
