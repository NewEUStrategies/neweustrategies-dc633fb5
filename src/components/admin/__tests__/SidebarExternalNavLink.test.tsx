import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HandHeart } from "lucide-react";
import { SidebarExternalNavLink } from "@/components/admin/AdminShell";

// Panel /admin/donations został wycięty (zbiórka żyje na zrzutka.pl - AUP
// Paddle wyklucza darowizny u operatora płatności), więc pozycja nawigacji
// MUSI być twardo oznaczonym linkiem zewnętrznym: nowa karta, pełne atrybuty
// bezpieczeństwa i czytelny sygnał dostępności.
const HREF = "https://zrzutka.pl/sfrxme";
const LABEL = "Darowizny (zrzutka.pl)";
const HINT = "Otwiera się w nowej karcie";

function renderLink(props: Partial<Parameters<typeof SidebarExternalNavLink>[0]> = {}) {
  return render(
    <SidebarExternalNavLink href={HREF} icon={HandHeart} label={LABEL} hint={HINT} {...props} />,
  );
}

describe("SidebarExternalNavLink", () => {
  it("renders a hardened new-tab anchor with the external glyph", () => {
    renderLink();
    const link = screen.getByRole("link", { name: new RegExp(HINT) });
    expect(link.getAttribute("href")).toBe(HREF);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("data-external-link")).toBe("true");
    expect(link.getAttribute("data-sidebar")).toBe("menu-button");
    // Dwa glify: ikona pozycji + znacznik "external"; oba dekoracyjne.
    expect(link.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThanOrEqual(1);
  });

  it("joins label and hint in the title with a plain hyphen", () => {
    renderLink();
    expect(screen.getByRole("link").getAttribute("title")).toBe(`${LABEL} - ${HINT}`);
  });

  it("keeps the new-tab hint accessible to screen readers only", () => {
    renderLink();
    expect(screen.getByText(HINT).className).toContain("sr-only");
  });

  it("hides the label in compact mode but keeps the accessible name", () => {
    renderLink({ compact: true });
    const link = screen.getByRole("link", { name: new RegExp(HINT) });
    expect(screen.getByText(LABEL).className).toContain("hidden");
    // Tooltip przejmuje etykietę w trybie compact - natywny title znika.
    expect(link.getAttribute("title")).toBeNull();
    expect(link.className).toContain("justify-center");
  });

  it("merges injected props and className (Radix Slot / tooltip compatibility)", () => {
    const onClick = vi.fn((event: React.MouseEvent<HTMLAnchorElement>) => event.preventDefault());
    renderLink({ className: "extra-class", onClick });
    const link = screen.getByRole("link");
    expect(link.className).toContain("extra-class");
    fireEvent.click(link);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
