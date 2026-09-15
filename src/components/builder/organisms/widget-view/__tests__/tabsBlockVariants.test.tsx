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
      // Równe rozciągnięcie na desktopie (na mobile flex-1 mają wszystkie).
      expect(btn.className).toContain("sm:flex-1");
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
    // Bez justify zakładki na desktopie wracają do szerokości treści.
    for (const btn of screen.getAllByRole("tab")) {
      expect(btn.className).toContain("sm:flex-none");
      expect(btn.className).not.toContain("sm:flex-1");
    }
  });
});

describe("TabsBlock - mobile bez przycinania", () => {
  it("uses a stable two-column grid instead of clipping tabs on narrow screens", () => {
    const { container } = render(<TabsBlock tabs={tabs} lang="pl" nodeId="m1" />);
    const row = container.querySelector('[role="tablist"] > div');
    expect(row).not.toBeNull();
    expect(row?.className).toContain("grid-cols-2");
    expect(row?.className).toContain("sm:flex");
    for (const btn of screen.getAllByRole("tab")) {
      expect(btn.className).toContain("w-full");
      expect(btn.className).toContain("min-w-0");
    }
  });

  it("lets long and wide panel content stay inside the screen", () => {
    render(
      <TabsBlock
        tabs={[{
          label_pl: "Bardzo długa nazwa benefitu, która musi się zawinąć",
          html_pl: "<table><tbody><tr><td>Dane</td></tr></tbody></table>",
        }]}
        lang="pl"
        nodeId="m-wide"
      />,
    );
    const panel = screen.getByRole("tabpanel");
    expect(panel.className).toContain("w-full");
    expect(panel.className).toContain("min-w-0");
    expect(panel.className).toContain("max-w-full");
    expect(panel.className).toContain("overflow-x-auto");
    expect(panel.className).toContain("[overflow-wrap:anywhere]");
    expect(panel.className).toContain("[&_*]:max-w-full");
  });

  it("centers the icon over the full tab width on mobile", () => {
    const { container } = render(
      <TabsBlock
        tabs={[{ label_pl: "Z ikoną", html_pl: "<p>Ikonowa</p>", icon: "star" }]}
        lang="pl"
        nodeId="m3"
      />,
    );
    const labelWrap = container.querySelector("button > span");
    expect(labelWrap).not.toBeNull();
    expect(labelWrap?.className).toContain("w-full");
    expect(labelWrap?.className).toContain("flex-col");
    expect(labelWrap?.className).toContain("items-center");
    expect(labelWrap?.className).toContain("sm:flex-row");
    const iconWrap = labelWrap?.querySelector("span[aria-hidden='true']");
    expect(iconWrap).not.toBeNull();
    expect(iconWrap?.className).toContain("justify-center");
  });

  it("uses the same two-column mobile grid for the vertical variant", () => {
    const { container } = render(
      <TabsBlock tabs={tabs} lang="pl" nodeId="m-vertical" orientation="vertical" />,
    );
    const row = container.querySelector('[role="tablist"] > div');
    expect(row).not.toBeNull();
    expect(row?.className).toContain("grid-cols-2");
    expect(row?.className).toContain("md:flex");
    for (const btn of screen.getAllByRole("tab")) {
      expect(btn.className).toContain("w-full");
      expect(btn.className).toContain("min-w-0");
    }
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
