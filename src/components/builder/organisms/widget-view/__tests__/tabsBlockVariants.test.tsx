// TabsBlock: warianty układu zakładek. Domykamy pionową orientację
// (lista przycisków z lewej + panel, przełączanie aktywnej zakładki),
// wyrównanie poziomego rzędu (justify -> flex-1, nieznana wartość -> lewa)
// oraz ikonę Lucide w etykiecie zakładki.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TabsBlock, type TabAlign } from "../TabsBlock";

afterEach(cleanup);

const tabs = [
  { label_pl: "Pierwsza", html_pl: "<p>Treść pierwsza</p>" },
  { label_pl: "Druga", html_pl: "<p>Treść druga</p>" },
];

describe("TabsBlock - orientacja pionowa", () => {
  it("renders a vertical tablist and switches panels on click", () => {
    const { container } = render(
      <TabsBlock tabs={tabs} lang="pl" nodeId="v1" orientation="vertical" />,
    );

    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist).toHaveAttribute("aria-orientation", "vertical");

    const buttons = screen.getAllByRole("tab");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAttribute("aria-selected", "true");
    expect(buttons[1]).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tabpanel").innerHTML).toContain("Treść pierwsza");

    // Kliknięcie drugiej zakładki przełącza panel i aria-selected.
    fireEvent.click(buttons[1]);
    expect(buttons[1]).toHaveAttribute("aria-selected", "true");
    expect(buttons[0]).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tabpanel").innerHTML).toContain("Treść druga");
  });

  it("renders the localized empty state for vertical usage too", () => {
    render(<TabsBlock tabs={[]} lang="en" nodeId="v2" orientation="vertical" />);
    expect(screen.getByText("No tabs")).toBeInTheDocument();
  });
});

describe("TabsBlock - wyrównanie poziomego rzędu", () => {
  it("stretches tabs with the justify alignment", () => {
    const { container } = render(
      <TabsBlock tabs={tabs} lang="pl" nodeId="h1" tabAlign="justify" />,
    );
    const row = container.querySelector(".justify-between");
    expect(row).not.toBeNull();
    for (const btn of screen.getAllByRole("tab")) {
      expect(btn.className).toContain("flex-1");
    }
  });

  it("centers and right-aligns the row, falling back to left on junk values", () => {
    for (const [align, cls] of [
      ["center", "justify-center"],
      ["right", "justify-end"],
    ] as const) {
      const { container, unmount } = render(
        <TabsBlock tabs={tabs} lang="pl" nodeId={`h-${align}`} tabAlign={align} />,
      );
      expect(container.querySelector(`.${cls}`)).not.toBeNull();
      unmount();
    }
    // Nieznana wartość spoza unii -> ALIGN_JUSTIFY[x] undefined -> lewa.
    const { container } = render(
      <TabsBlock tabs={tabs} lang="pl" nodeId="h-bogus" tabAlign={"bogus" as TabAlign} />,
    );
    expect(container.querySelector(".justify-start")).not.toBeNull();
    expect(container.querySelector(".flex-1")).toBeNull();
  });
});

describe("TabsBlock - ikona w etykiecie", () => {
  it("renders a Lucide icon next to the label when tab.icon is set", () => {
    const { container } = render(
      <TabsBlock
        tabs={[{ label_pl: "Z ikoną", html_pl: "<p>Ikonowa</p>", icon: " star " }]}
        lang="pl"
        nodeId="i1"
      />,
    );
    // DynamicIcon renderuje svg synchronicznie dla nazw z zestawu bazowego.
    expect(container.querySelector("button svg")).not.toBeNull();
    expect(screen.getByText("Z ikoną")).toBeInTheDocument();
  });
});
