// Molecule: one responsive font-size row (mobile / tablet / desktop) for the
// overlay-typography editor. Writes px sizes per breakpoint onto the
// post_layout_settings draft.
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import type { PostLayoutSettings } from "@/lib/postLayouts";
import { NumStepper } from "../atoms";
import "@/lib/i18n-admin-theme-design";

/** The four size groups this row can drive, each expanded to `_base/_md/_lg`. */
export type OverlaySizeField =
  | "overlay_title_size"
  | "overlay_excerpt_size"
  | "header_title_size"
  | "header_excerpt_size";

type Breakpoint = "base" | "md" | "lg";
const BREAKPOINTS: readonly Breakpoint[] = ["base", "md", "lg"];

export function OverlaySizeRow({
  label,
  field,
  draft,
  onPatch,
}: {
  label: string;
  field: OverlaySizeField;
  draft: PostLayoutSettings;
  onPatch: (patch: Partial<PostLayoutSettings>) => void;
}) {
  const { t } = useTranslation();

  const bpLabel = (bp: Breakpoint): string =>
    bp === "base"
      ? t("adminThemeDesign.overlay.bpMobile")
      : bp === "md"
        ? t("adminThemeDesign.overlay.bpTablet")
        : t("adminThemeDesign.overlay.bpDesktop");

  return (
    <div className="space-y-2">
      <Label className="text-xs font-semibold">{label}</Label>
      <div className="grid grid-cols-3 gap-3">
        {BREAKPOINTS.map((bp) => {
          const key = `${field}_${bp}` as const;
          return (
            <div key={bp} className="space-y-1">
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                {bpLabel(bp)}
              </Label>
              <NumStepper
                value={draft[key]}
                onChange={(value) => onPatch({ [key]: value } as Partial<PostLayoutSettings>)}
                step={1}
                min={8}
                max={200}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
