export type SelectionKind = "section" | "column" | "widget" | "inner-section" | null;
export interface Selection {
  kind: SelectionKind;
  id: string | null;
}
