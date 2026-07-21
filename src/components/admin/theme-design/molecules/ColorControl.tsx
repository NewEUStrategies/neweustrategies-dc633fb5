// Molecule: a single Theme Design color field.
//
// Wraps AdminColorPicker with the per-mode inheritance model:
//  - light mode edits the section value directly; empty = inherit global token
//  - dark mode edits `darkOverrides[section][field]`; empty = inherit the light
//    value (which itself may reference a token that already flips in dark mode)
// plus a "↩ Inherit" reset that clears back to the default token / override.
import { useTranslation } from "react-i18next";
import { AdminColorPicker } from "@/components/admin/blocks/AdminColorPicker";
import { THEME_DESIGN_COLOR_INHERITANCE, type ThemeDesign } from "@/lib/theme/themeDesign";
import "@/lib/i18n-admin-theme-design";
import type { PreviewMode, ThemeColorSetter } from "../types";

/** Default inheritance token + hint per (section, field). */
const INHERIT_DEFAULTS: Record<string, Record<string, { token: string; hint: string }>> =
  THEME_DESIGN_COLOR_INHERITANCE;

function readColor(draft: ThemeDesign, section: string, field: string): string {
  const sectionRecord = (draft as Record<string, unknown>)[section] as
    | Record<string, unknown>
    | undefined;
  const value = sectionRecord?.[field];
  return typeof value === "string" ? value : "";
}

export function ColorControl({
  section,
  field,
  mode,
  draft,
  setColor,
}: {
  section: string;
  field: string;
  mode: PreviewMode;
  draft: ThemeDesign;
  setColor: ThemeColorSetter;
}) {
  const { t } = useTranslation();

  const lightVal = readColor(draft, section, field);
  const darkVal = draft.darkOverrides?.[section]?.[field] ?? "";
  const value = mode === "light" ? lightVal : darkVal;

  const inherit = INHERIT_DEFAULTS[section]?.[field];
  const inheritedValue = mode === "dark" ? lightVal || inherit?.token : inherit?.token;
  const placeholder =
    mode === "dark" ? lightVal || inherit?.token || "auto" : inherit?.token || "auto";

  const reset = () => {
    if (mode === "dark") setColor(section, field, null);
    else setColor(section, field, inherit?.token ?? "");
  };

  const showReset = mode === "light" ? !!lightVal && lightVal !== inherit?.token : !!darkVal;

  return (
    <div className="space-y-1">
      <AdminColorPicker
        value={value}
        onChange={(next) =>
          setColor(section, field, next ?? (mode === "light" ? (inherit?.token ?? null) : null))
        }
        allowTransparent
        inheritedValue={inheritedValue}
        placeholder={placeholder}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground truncate">
          {mode === "dark" && !darkVal
            ? t("adminThemeDesign.inherit.fromLight", { val: lightVal || inherit?.hint || "auto" })
            : inherit
              ? t("adminThemeDesign.inherit.defaultHint", { hint: inherit.hint })
              : ""}
        </span>
        {showReset && (
          <button
            type="button"
            onClick={reset}
            className="text-[10px] text-muted-foreground hover:text-foreground underline decoration-dotted underline-offset-2"
          >
            {t("adminThemeDesign.inherit.button")}
          </button>
        )}
      </div>
    </div>
  );
}
