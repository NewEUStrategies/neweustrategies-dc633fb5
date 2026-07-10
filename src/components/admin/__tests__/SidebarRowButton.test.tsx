import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Home } from "lucide-react";
import { SidebarRowButton } from "@/components/admin/AdminShell";

describe("SidebarRowButton", () => {
  it("renders the icon and label and fires onClick", () => {
    const onClick = vi.fn();
    render(<SidebarRowButton icon={Home} label="Dashboard" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("hides the label but keeps it in the DOM when compact", () => {
    render(<SidebarRowButton icon={Home} label="Dashboard" compact onClick={vi.fn()} />);
    const label = screen.getByText("Dashboard");
    expect(label.className).toContain("hidden");
  });

  it("applies destructive styling for the destructive tone", () => {
    render(<SidebarRowButton label="Sign out" tone="destructive" onClick={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Sign out" }).className).toContain(
      "text-destructive",
    );
  });

  it("marks the accent tone active state with the brand accent classes", () => {
    render(<SidebarRowButton label="CRM" tone="accent" active onClick={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "CRM" });
    expect(btn.className).toContain("border-brand");
    expect(btn.className).toContain("bg-brand/10");
  });

  it("does not apply the accent active classes when inactive", () => {
    render(<SidebarRowButton label="CRM" tone="accent" active={false} onClick={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "CRM" });
    expect(btn.className).not.toContain("border-brand");
  });
});
