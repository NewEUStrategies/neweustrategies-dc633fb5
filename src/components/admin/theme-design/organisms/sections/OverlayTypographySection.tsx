// Organism: editor for post overlay + classic-header typography sizes.
// Owns the post_layout_settings draft slice.
import { useTranslation } from "react-i18next";
import type { PostLayoutSettings } from "@/lib/postLayouts";
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

      <div className="space-y-4">
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

      <div className="space-y-4 pt-3 border-t border-border">
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
