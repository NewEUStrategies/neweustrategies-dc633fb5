// Molecule: single toolbar-button swatch used in the toolbar editor's live
// preview. Geometry (radius/padding/size) comes from the draft via inline
// style; colors come from the production `.cms-tb-btn` rules, which read the
// scoped `--td-tb-*` variables set on an ancestor. The ACTIVE state is carried
// by `data-active` - exactly as in the real CMS toolbar - so switching it swaps
// colors only and never moves geometry (otherwise the bar would jump).
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
    borderRadius: design.toolbarButton.radius,
    padding: `${design.toolbarButton.paddingY} ${design.toolbarButton.paddingX}`,
    fontSize: design.toolbarButton.size,
    lineHeight: 1,
    minWidth: `calc(${design.toolbarButton.size} + ${design.toolbarButton.paddingX} * 2)`,
  };
  return (
    <span
      className="cms-tb-btn inline-flex items-center justify-center font-semibold transition-colors"
      data-active={active ? "true" : undefined}
      style={style}
    >
      {icon}
    </span>
  );
}
