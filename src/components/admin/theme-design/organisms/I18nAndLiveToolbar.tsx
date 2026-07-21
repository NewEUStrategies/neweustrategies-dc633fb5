// Organism: top toolbar controlling per-language style mode (shared vs. split),
// the currently-edited language, and the live-preview-in-CMS toggle.
import { useTranslation } from "react-i18next";
import { Languages, Eye, EyeOff } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { ThemeDesignLang, ThemeDesignLangMode } from "@/lib/theme/themeDesign";
import { SegmentedControl, type SegmentedOption } from "../atoms";
import "@/lib/i18n-admin-theme-design";

const LANG_OPTIONS: readonly SegmentedOption<ThemeDesignLang>[] = [
  { value: "pl", label: "🇵🇱 PL" },
  { value: "en", label: "🇬🇧 EN" },
];

export function I18nAndLiveToolbar({
  mode,
  onModeChange,
  editLang,
  onEditLangChange,
  liveSync,
  onLiveSyncChange,
  savingMode,
}: {
  mode: ThemeDesignLangMode;
  onModeChange: (mode: ThemeDesignLangMode) => void;
  editLang: ThemeDesignLang;
  onEditLangChange: (lang: ThemeDesignLang) => void;
  liveSync: boolean;
  onLiveSyncChange: (value: boolean) => void;
  savingMode: boolean;
}) {
  const { t } = useTranslation();

  const modeOptions: readonly SegmentedOption<ThemeDesignLangMode>[] = [
    { value: "shared", label: t("adminThemeDesign.langBar.sharedPlEn") },
    { value: "split", label: t("adminThemeDesign.langBar.splitPerLang") },
  ];

  return (
    <div className="rounded-lg border border-border bg-card p-3 flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Languages className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium">{t("adminThemeDesign.langBar.stylePerLang")}</span>
        </div>
        <SegmentedControl
          options={modeOptions}
          value={mode}
          onChange={onModeChange}
          variant="accent"
          disabled={savingMode}
          ariaLabel={t("adminThemeDesign.langBar.stylePerLang")}
        />
      </div>

      {mode === "split" && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t("adminThemeDesign.langBar.editing")}
          </span>
          <SegmentedControl
            options={LANG_OPTIONS}
            value={editLang}
            onChange={onEditLangChange}
            variant="invert"
            uppercase
            ariaLabel={t("adminThemeDesign.langBar.editing")}
          />
        </div>
      )}

      <label className="ml-auto flex items-center gap-2 cursor-pointer select-none">
        {liveSync ? (
          <Eye className="w-4 h-4 text-brand" />
        ) : (
          <EyeOff className="w-4 h-4 text-muted-foreground" />
        )}
        <div className="flex flex-col leading-tight">
          <span className="text-xs font-medium">
            {t("adminThemeDesign.langBar.livePreviewCms")}{" "}
            {liveSync
              ? t("adminThemeDesign.langBar.active")
              : t("adminThemeDesign.langBar.disabled")}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {t("adminThemeDesign.langBar.livePreviewDesc")}
          </span>
        </div>
        <Switch checked={liveSync} onCheckedChange={onLiveSyncChange} className="ml-1" />
      </label>
    </div>
  );
}
