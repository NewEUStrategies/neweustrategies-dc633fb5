/**
 * Shared type contracts for the media manager (iOS Files-style /admin/media).
 *
 * Kept framework-agnostic so the pure lib helpers, logic hooks and the
 * atomic UI layer (atoms / molecules / organisms) all speak the same shapes.
 * Every media/folder read is tenant-scoped - see hooks/useMediaData.ts - so a
 * MediaRow can only ever describe an asset owned by the active workspace.
 */
import type { ReactNode } from "react";

/** A single asset row as stored in `media` (tenant-scoped). */
export interface MediaRow {
  id: string;
  /** Owning workspace. Carried so the client can defensively drop any row
   *  that ever escaped the tenant filter (RLS is the real guard). */
  tenant_id: string;
  storage_path: string;
  public_url: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploader_id: string | null;
  created_at: string;
  folder_path: string;
  alt_text: string | null;
}

/** A virtual folder row from `media_folders` (tenant-scoped). */
export interface FolderRow {
  id: string;
  path: string;
  created_at: string;
}

/** Grid or list presentation of the current folder. */
export type ViewMode = "grid" | "list";

/** Right-click menu anchor + subject. */
export interface ContextMenuState {
  x: number;
  y: number;
  target: "file" | "folder" | "empty";
  targetId?: string;
}

/** Pending copy/cut of a set of files. */
export interface ClipboardState {
  op: "copy" | "cut";
  ids: string[];
}

/** A reversible operation recorded on the undo/redo stack. */
export type HistoryOp =
  | { kind: "move"; ids: string[]; from: Map<string, string>; to: string }
  | { kind: "rename"; id: string; from: string; to: string };

/** Marquee (rubber-band) selection rectangle in canvas coordinates. */
export interface MarqueeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A single entry rendered by the context menu molecule. */
export interface ContextMenuItem {
  label?: string;
  icon?: ReactNode;
  shortcut?: string;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
}

/** Natural-size of a previewed image, once measured. */
export interface ImageSize {
  w: number;
  h: number;
}

/** Pending destructive action awaiting confirmation. */
export type ConfirmDeleteState =
  | { kind: "files"; ids: string[] }
  | { kind: "folder"; folder: string };
