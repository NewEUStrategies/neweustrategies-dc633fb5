// Molecule: single toolbar-button swatch used in the toolbar editor's live
// preview. Reads the draft's toolbarButton geometry + the scoped `--td-tb-*`
// color variables set on an ancestor.
import type { CSSProperties } from "react";
import type { ThemeDesign } from "@/lib/theme/themeDesign";

export function ToolbarButtonPreview({
  design,
  icon,
  active = false,
}: {
  design: ThemeDesign;
  icon: string;
  active?: boolean;
}) {
  const style: CSSProperties = {
    background: active ? "var(--td-tb-active-bg, currentColor)" : "var(--td-tb-bg, transparent)",
    color: active ? "var(--td-tb-active-color, #fff)" : "var(--td-tb-color, currentColor)",
    borderRadius: design.toolbarButton.radius,
    padding: `${design.toolbarButton.paddingY} ${design.toolbarButton.paddingX}`,
    fontSize: design.toolbarButton.size,
    lineHeight: 1,
    minWidth: `calc(${design.toolbarButton.size} + ${design.toolbarButton.paddingX} * 2)`,
  };
  return (
    <span
      className="inline-flex items-center justify-center font-semibold transition-colors"
      style={style}
    >
      {icon}
    </span>
  );
}
