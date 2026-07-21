import "@/lib/i18n-admin-media";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MediaBreadcrumbs } from "../MediaBreadcrumbs";

const noopDrop = () => () => {};

describe("MediaBreadcrumbs", () => {
  it("renders a crumb per path segment plus the root", () => {
    render(
      <MediaBreadcrumbs
        currentPath="/press/2026/"
        onNavigate={vi.fn()}
        onFolderDrop={noopDrop}
        selectedCount={0}
        itemCount={3}
      />,
    );
    expect(screen.getByRole("button", { name: "press" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2026" })).toBeInTheDocument();
  });

  it("navigates to a crumb path on click", () => {
    const onNavigate = vi.fn();
    render(
      <MediaBreadcrumbs
        currentPath="/press/2026/"
        onNavigate={onNavigate}
        onFolderDrop={noopDrop}
        selectedCount={0}
        itemCount={0}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "press" }));
    expect(onNavigate).toHaveBeenCalledWith("/press/");
  });

  it("shows the item count when nothing is selected", () => {
    render(
      <MediaBreadcrumbs
        currentPath="/"
        onNavigate={vi.fn()}
        onFolderDrop={noopDrop}
        selectedCount={0}
        itemCount={7}
      />,
    );
    expect(screen.getByText(/7\s+(elementów|items)/)).toBeInTheDocument();
  });

  it("shows the selection count when items are selected", () => {
    render(
      <MediaBreadcrumbs
        currentPath="/"
        onNavigate={vi.fn()}
        onFolderDrop={noopDrop}
        selectedCount={2}
        itemCount={7}
      />,
    );
    expect(screen.getByText(/(Zaznaczono|Selected)\D*2/)).toBeInTheDocument();
  });
});
