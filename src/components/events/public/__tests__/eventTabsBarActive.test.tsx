// Pasek zakładek jest jednym rzędem; gdy się nie mieści (telefon, długie menu),
// bieżąca zakładka ma stanąć na środku, a nie za krawędzią ekranu.
//
// DLACZEGO TEN TEST ISTNIEJE. Pozycje paska dochodzą po pierwszym renderze
// („Nabór prelegentów" po zapytaniu o fazę, „Mój profil" po hydratacji sesji).
// Efekt odpalony raz, przy montażu, nie znajdował bieżącej pozycji albo
// zostawiał ją wypchniętą za krawędź - bez żadnego błędu, po prostu zakładka,
// w której czytelnik jest, nie była widoczna.
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import { EventTabsBar } from "@/components/events/public/molecules/EventTabsBar";

/** Geometria listy 300 px szerokości z treścią 800 px; pozycje co 100 px. */
function layOut(list: HTMLUListElement) {
  Object.defineProperty(list, "scrollWidth", { configurable: true, value: 800 });
  Object.defineProperty(list, "clientWidth", { configurable: true, value: 300 });
  list.getBoundingClientRect = () => ({ left: 0, right: 300, width: 300 }) as DOMRect;
  list.querySelectorAll("li > *").forEach((node, index) => {
    (node as HTMLElement).getBoundingClientRect = () =>
      ({
        left: index * 100 - list.scrollLeft,
        right: index * 100 + 80 - list.scrollLeft,
        width: 80,
      }) as DOMRect;
  });
}

function Tabs({ items, active }: { items: string[]; active: string }) {
  return (
    <EventTabsBar label="zakladki" activeKey={active}>
      {items.map((item) => (
        <li key={item}>
          <a href={`#${item}`} aria-current={item === active ? "page" : undefined}>
            {item}
          </a>
        </li>
      ))}
    </EventTabsBar>
  );
}

afterEach(cleanup);

describe("EventTabsBar - bieżąca zakładka w pasku przewijanym", () => {
  it("pozycja bieżąca dorysowana po montażu zostaje przewinięta na środek", async () => {
    const view = render(<Tabs items={["a", "b", "c", "d", "e"]} active="me" />);
    const list = view.container.querySelector("ul") as HTMLUListElement;
    layOut(list);
    expect(list.scrollLeft).toBe(0);

    // „Mój profil" dochodzi po hydratacji sesji, na szóstej pozycji (500 px).
    act(() => view.rerender(<Tabs items={["a", "b", "c", "d", "e", "me"]} active="me" />));
    layOut(list);
    // Obserwator mutacji odpowiada w mikrozadaniu - asynchroniczne `act` je opróżnia.
    await act(async () => {
      list.appendChild(document.createElement("span"));
    });
    // Środek pozycji (540 px) na środku listy (150 px): przewinięcie o 390 px.
    expect(list.scrollLeft).toBe(390);
  });

  it("pozycja widoczna nie rusza przewinięcia czytelnika", async () => {
    const view = render(<Tabs items={["a", "b", "c", "d", "e"]} active="b" />);
    const list = view.container.querySelector("ul") as HTMLUListElement;
    layOut(list);
    list.scrollLeft = 0;
    // Obserwator mutacji odpowiada w mikrozadaniu - asynchroniczne `act` je opróżnia.
    await act(async () => {
      list.appendChild(document.createElement("span"));
    });
    expect(list.scrollLeft).toBe(0);
  });
});
