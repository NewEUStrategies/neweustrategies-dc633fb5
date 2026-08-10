// Organism: editor for post overlay + classic-header typography sizes.
// Owns the post_layout_settings draft slice.
import { useTranslation } from "react-i18next";
import { inheritsThemeTitleSizes, type PostLayoutSettings } from "@/lib/postLayouts";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { OverlaySizeRow } from "../../molecules";
import "@/lib/i18n-admin-theme-design";

export function OverlayTypographySection({
  draft,
  onChange,
}: {
  draft: PostLayoutSettings;
  onChange: (next: PostLayoutSettings) => void;
}) {
  const { t } = useTranslation();
  const patch = (p: Partial<PostLayoutSettings>) => onChange({ ...draft, ...p });
  const inheritsTheme = inheritsThemeTitleSizes(draft);

  return (
    <section className="space-y-5 rounded-lg border border-border bg-card p-5">
      <div>
        <h2 className="text-base font-semibold">{t("adminThemeDesign.overlay.title")}</h2>
        <p className="text-xs text-muted-foreground mt-1">
          {t("adminThemeDesign.overlay.descPre")}
          <code className="mx-1">/admin/post-layouts</code>
          {t("adminThemeDesign.overlay.descPost")}
        </p>
      </div>

      <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-muted/30 p-4">
        <div className="space-y-1">
          <Label htmlFor="title-size-source" className="text-sm font-semibold">
            {t("adminThemeDesign.overlay.inheritTitle")}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t("adminThemeDesign.overlay.inheritDesc")}
          </p>
        </div>
        <Switch
          id="title-size-source"
          checked={inheritsTheme}
          onCheckedChange={(v) => patch({ title_size_source: v ? "theme" : "layout" })}
        />
      </div>

      <div
        className={
          inheritsTheme ? "space-y-4 opacity-50 pointer-events-none select-none" : "space-y-4"
        }
        aria-disabled={inheritsTheme}
      >
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          {t("adminThemeDesign.overlay.onCover")}
        </h3>
        <OverlaySizeRow
          label={t("adminThemeDesign.overlay.rowTitle")}
          field="overlay_title_size"
          draft={draft}
          onPatch={patch}
        />
        <OverlaySizeRow
          label={t("adminThemeDesign.overlay.rowSubtitle")}
          field="overlay_excerpt_size"
          draft={draft}
          onPatch={patch}
        />
      </div>

      <div
        className={
          inheritsTheme
            ? "space-y-4 pt-3 border-t border-border opacity-50 pointer-events-none select-none"
            : "space-y-4 pt-3 border-t border-border"
        }
        aria-disabled={inheritsTheme}
      >
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          {t("adminThemeDesign.overlay.classicHeader")}
        </h3>
        <OverlaySizeRow
          label={t("adminThemeDesign.overlay.rowTitle")}
          field="header_title_size"
          draft={draft}
          onPatch={patch}
        />
        <OverlaySizeRow
          label={t("adminThemeDesign.overlay.rowSubtitle")}
          field="header_excerpt_size"
          draft={draft}
          onPatch={patch}
        />
      </div>

      <p className="text-[11px] text-muted-foreground">{t("adminThemeDesign.overlay.metaNote")}</p>
    </section>
  );
}
