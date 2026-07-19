import "@/lib/i18n-chat";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UnreadBadge } from "../UnreadBadge";

describe("UnreadBadge", () => {
  it("renders nothing when count is zero", () => {
    const { container } = render(<UnreadBadge count={0} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders exact count for small values", () => {
    render(<UnreadBadge count={3} />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("caps display at 99+", () => {
    render(<UnreadBadge count={150} />);
    expect(screen.getByText("99+")).toBeInTheDocument();
  });

  it("uses chat unread plural label", () => {
    render(<UnreadBadge count={5} labelKey="chat.unread" />);
    const badge = screen.getByLabelText(/nieprzeczytanych/i);
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("5");
  });

  it("uses notifications unread plural label", () => {
    render(<UnreadBadge count={2} labelKey="notifications.unread" />);
    const badge = screen.getByLabelText(/nieprzeczytane/i);
    expect(badge).toBeInTheDocument();
  });
});
