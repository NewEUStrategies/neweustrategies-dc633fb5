import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MediaGridView } from "../MediaGridView";
import type { MediaRow } from "../../types";

function makeRow(id: string, filename: string): MediaRow {
  return {
    id,
    tenant_id: "tenant-1",
    storage_path: `tenant-1/u/${id}`,
    public_url: `https://cdn.example/${id}`,
    filename,
    mime_type: "image/png",
    size_bytes: 2048,
    uploader_id: "u",
    created_at: "2026-01-01T00:00:00.000Z",
    folder_path: "/",
    alt_text: null,
  };
}

const baseProps = {
  folders: ["/press/"],
  files: [makeRow("a", "alpha.png")],
  selectedIds: new Set<string>(),
  renamingId: null,
  renameDraft: "",
  onRenameDraft: vi.fn(),
  onRenameCommit: vi.fn(),
  onRenameCancel: vi.fn(),
  onOpenFolder: vi.fn(),
  onSelect: vi.fn(),
  onContextFile: vi.fn(),
  onContextFolder: vi.fn(),
  onDragStart: () => () => {},
  onDropFolder: () => () => {},
  onPreviewFile: vi.fn(),
};

describe("MediaGridView", () => {
  it("renders folder tiles and file names", () => {
    render(<MediaGridView {...baseProps} />);
    expect(screen.getByText("press")).toBeInTheDocument();
    expect(screen.getByText("alpha.png")).toBeInTheDocument();
  });

  it("opens a folder on click", () => {
    const onOpenFolder = vi.fn();
    render(<MediaGridView {...baseProps} onOpenFolder={onOpenFolder} />);
    fireEvent.click(screen.getByText("press"));
    expect(onOpenFolder).toHaveBeenCalledWith("/press/");
  });

  it("selects a file on click and previews on double click", () => {
    const onSelect = vi.fn();
    const onPreviewFile = vi.fn();
    render(<MediaGridView {...baseProps} onSelect={onSelect} onPreviewFile={onPreviewFile} />);
    const tile = document.querySelector('[data-media-item="a"]') as HTMLElement;
    fireEvent.click(tile);
    expect(onSelect).toHaveBeenCalledWith("a", expect.anything());
    fireEvent.doubleClick(tile);
    expect(onPreviewFile).toHaveBeenCalledWith(baseProps.files[0]);
  });

  it("shows a rename input for the file being renamed", () => {
    render(<MediaGridView {...baseProps} renamingId="a" renameDraft="alpha.png" />);
    const input = screen.getByDisplayValue("alpha.png");
    expect(input.tagName).toBe("INPUT");
  });
});
