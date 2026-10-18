// TabsBlock (widget „tabs") - wzorzec WAI-ARIA „Tabs": struktura ról,
// powiązanie zakładka <-> panel, klawiatura i odporność na uszkodzone wpisy.
//
// Co udowadniamy i dlaczego (stan przed 2026-10-18):
//   * `role="tablist"` siedział na opakowaniu, które zawierało TAKŻE panel -
//     tablist może posiadać wyłącznie zakładki, więc czytnik ogłaszał treść
//     panelu jako część listy zakładek. Teraz tablist to sam wiersz przycisków.
//   * Zakładki nie miały `aria-controls`, panel nie miał `aria-labelledby` -
//     czytnik nie wiedział, której zakładki dotyczy panel.
//   * Wszystkie zakładki były w kolejności Tab, a strzałki nic nie robiły.
//     Wzorzec wymaga „roving tabindex" (tylko aktywna ma tabIndex=0) i nawigacji
//     strzałkami (poziomo Lewo/Prawo, pionowo Góra/Dół) z Home/End.
//   * Wpis `null` w tablicy zakładek (import, ręczna edycja JSON) wywracał
//     render (`tab.icon` z null) - teraz jest pomijany.
//
// Granice: komponent renderowany bezpośrednio (bez rejestru leniwego), HTML
// panelu przechodzi przez prawdziwy sanitizeHtml; asercje na rolach i ARIA.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { TabsBlock } from "../TabsBlock";

const TABS: Array<Record<string, string>> = [
  { label_pl: "Pierwsza", label_en: "First", html_pl: "<p>Treść 1</p>" },
  { label_pl: "Druga", html_pl: "<p>Treść 2</p><script>alert(1)</script>" },
  { label_pl: "Trzecia", html_pl: "<p>Treść 3</p>" },
];

afterEach(cleanup);

describe("TabsBlock - struktura ról i powiązania", () => {
  it("tablist zawiera wyłącznie zakładki, a panel jest jego rodzeństwem", () => {
    render(<TabsBlock tabs={TABS} lang="pl" nodeId="w1" />);
    const tablist = screen.getByRole("tablist", { name: "Zakładki" });
    const panel = screen.getByRole("tabpanel");
    expect(tablist.contains(panel)).toBe(false);
    expect([...tablist.querySelectorAll("button")].every((b) => b.role === "tab")).toBe(true);
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("aktywna zakładka wskazuje panel, a panel nazywa się jej etykietą", () => {
    render(<TabsBlock tabs={TABS} lang="pl" nodeId="w2" />);
    const first = screen.getByRole("tab", { name: "Pierwsza" });
    const panel = screen.getByRole("tabpanel", { name: "Pierwsza" });
    expect(first.getAttribute("aria-controls")).toBe(panel.id);
    expect(first.getAttribute("aria-selected")).toBe("true");

    fireEvent.click(screen.getByRole("tab", { name: "Druga" }));
    expect(screen.getByRole("tabpanel", { name: "Druga" }).textContent).toBe("Treść 2");
    // HTML panelu jest sanityzowany.
    expect(document.querySelector("script")).toBeNull();
  });

  it("ID zakładek i paneli są stabilne między SSR a klientem (useId)", () => {
    const html = renderToString(<TabsBlock tabs={TABS} lang="pl" nodeId="w3" />);
    const host = document.createElement("div");
    host.innerHTML = html;
    const ssrTab = host.querySelector('[role="tab"]') as HTMLElement;
    const ssrPanel = host.querySelector('[role="tabpanel"]') as HTMLElement;
    expect(ssrTab.getAttribute("aria-controls")).toBe(ssrPanel.id);
    expect(ssrPanel.getAttribute("aria-labelledby")).toBe(ssrTab.id);
  });

  it("wersja EN bierze etykietę EN, a bez niej spada na PL", () => {
    render(<TabsBlock tabs={TABS} lang="en" nodeId="w4" />);
    expect(screen.getByRole("tablist", { name: "Tabs" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "First" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Druga" })).toBeTruthy();
  });
});

describe("TabsBlock - klawiatura (roving tabindex)", () => {
  it("tylko aktywna zakładka jest w kolejności Tab", () => {
    render(<TabsBlock tabs={TABS} lang="pl" nodeId="k1" />);
    expect(screen.getAllByRole("tab").map((t) => t.getAttribute("tabindex"))).toEqual([
      "0",
      "-1",
      "-1",
    ]);
  });

  it("poziomo: strzałka w prawo/lewo przenosi fokus i wybór, z zawijaniem; Home/End", () => {
    render(<TabsBlock tabs={TABS} lang="pl" nodeId="k2" />);
    const [first, second, third] = screen.getAllByRole("tab");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement).toBe(second);
    expect(second.getAttribute("aria-selected")).toBe("true");
    expect(second.getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("tabpanel").textContent).toBe("Treść 2");

    fireEvent.keyDown(second, { key: "End" });
    expect(document.activeElement).toBe(third);
    fireEvent.keyDown(third, { key: "ArrowRight" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(third);
    fireEvent.keyDown(third, { key: "Home" });
    expect(document.activeElement).toBe(first);
    expect(screen.getByRole("tabpanel").textContent).toBe("Treść 1");

    // Strzałki pionowe nie działają w układzie poziomym.
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(first);
  });

  it("pionowo: tablist ma aria-orientation, a nawigują strzałki góra/dół", () => {
    render(<TabsBlock tabs={TABS} lang="pl" nodeId="k3" orientation="vertical" />);
    expect(screen.getByRole("tablist").getAttribute("aria-orientation")).toBe("vertical");
    const [first, second] = screen.getAllByRole("tab");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: "ArrowUp" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement).toBe(first);
  });
});

describe("TabsBlock - uszkodzone wpisy", () => {
  it("wpis null jest pomijany, pozostałe zakładki działają", () => {
    render(
      <TabsBlock
        tabs={[null, TABS[0]] as unknown as Array<Record<string, string>>}
        lang="pl"
        nodeId="b1"
      />,
    );
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    expect(screen.getByRole("tabpanel").textContent).toBe("Treść 1");
  });

  it("same uszkodzone wpisy dają komunikat pustego stanu", () => {
    render(
      <TabsBlock tabs={[null] as unknown as Array<Record<string, string>>} lang="en" nodeId="b2" />,
    );
    expect(screen.getByText("No tabs")).toBeTruthy();
  });
});
