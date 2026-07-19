// Compact per-post override editor for the related-posts block.
// Stores a partial RelatedPostsConfig in posts.related_override (jsonb).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import "@/lib/i18n-admin-panes-misc";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  RelatedLayout,
  RelatedPosition,
  RelatedPostsOverride,
  RelatedSource,
} from "@/lib/relatedPosts";

interface Props {
  value: Record<string, unknown> | null;
  onChange: (next: Record<string, unknown> | null) => void;
}

export function RelatedOverrideEditor({ value, onChange }: Props) {
  const { t } = useTranslation();
  const override = (value ?? {}) as RelatedPostsOverride;
  const [enabledOverride, setEnabledOverride] = useState<boolean>(value !== null);

  const setKey = <K extends keyof RelatedPostsOverride>(
    k: K,
    v: RelatedPostsOverride[K] | undefined,
  ) => {
    const next: RelatedPostsOverride = { ...override };
    if (v === undefined) {
      delete next[k];
    } else {
      next[k] = v;
    }
    onChange(Object.keys(next).length === 0 ? null : (next as Record<string, unknown>));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {t("adminPanesMisc.related.overridesGlobal")}
        </span>
        <label className="flex items-center gap-2 text-xs">
          <span>{t("adminPanesMisc.related.overrideActive")}</span>
          <Switch
            checked={enabledOverride}
            onCheckedChange={(v) => {
              setEnabledOverride(v);
              if (!v) onChange(null);
            }}
          />
        </label>
      </div>

      {enabledOverride && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">{t("adminPanesMisc.related.showSection")}</Label>
            <Select
              value={override.enabled === undefined ? "_" : override.enabled ? "yes" : "no"}
              onValueChange={(v) => setKey("enabled", v === "_" ? undefined : v === "yes")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_">{t("adminPanesMisc.related.global")}</SelectItem>
                <SelectItem value="yes">{t("adminPanesMisc.related.yes")}</SelectItem>
                <SelectItem value="no">{t("adminPanesMisc.related.no")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("adminPanesMisc.related.position")}</Label>
            <Select
              value={(override.position ?? "_") as string}
              onValueChange={(v) =>
                setKey("position", v === "_" ? undefined : (v as RelatedPosition))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_">{t("adminPanesMisc.related.global")}</SelectItem>
                <SelectItem value="end">{t("adminPanesMisc.related.posEnd")}</SelectItem>
                <SelectItem value="sidebar">Sidebar</SelectItem>
                <SelectItem value="after_paragraph">
                  {t("adminPanesMisc.related.posAfterParagraph")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("adminPanesMisc.related.layout")}</Label>
            <Select
              value={(override.layout ?? "_") as string}
              onValueChange={(v) => setKey("layout", v === "_" ? undefined : (v as RelatedLayout))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_">{t("adminPanesMisc.related.global")}</SelectItem>
                <SelectItem value="grid">Grid</SelectItem>
                <SelectItem value="list">{t("adminPanesMisc.related.layoutList")}</SelectItem>
                <SelectItem value="slider">Slider</SelectItem>
                <SelectItem value="cards">{t("adminPanesMisc.related.layoutCards")}</SelectItem>
                <SelectItem value="magazine">
                  {t("adminPanesMisc.related.layoutMagazine")}
                </SelectItem>
                <SelectItem value="timeline">
                  {t("adminPanesMisc.related.layoutTimeline")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("adminPanesMisc.related.strategy")}</Label>
            <Select
              value={(override.source_strategy ?? "_") as string}
              onValueChange={(v) =>
                setKey("source_strategy", v === "_" ? undefined : (v as RelatedSource))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_">{t("adminPanesMisc.related.global")}</SelectItem>
                <SelectItem value="both">{t("adminPanesMisc.related.srcBoth")}</SelectItem>
                <SelectItem value="categories">
                  {t("adminPanesMisc.related.srcCategories")}
                </SelectItem>
                <SelectItem value="tags">{t("adminPanesMisc.related.srcTags")}</SelectItem>
                <SelectItem value="author">{t("adminPanesMisc.related.srcAuthor")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("adminPanesMisc.related.itemsCount")}</Label>
            <Input
              type="number"
              min={1}
              max={24}
              value={override.items_limit ?? ""}
              placeholder={t("adminPanesMisc.related.global")}
              onChange={(e) => {
                const n = Number(e.target.value);
                setKey("items_limit", Number.isFinite(n) && n > 0 ? n : undefined);
              }}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("adminPanesMisc.related.afterParagraph")}</Label>
            <Input
              type="number"
              min={1}
              value={override.after_paragraph ?? ""}
              placeholder={t("adminPanesMisc.related.global")}
              onChange={(e) => {
                const n = Number(e.target.value);
                setKey("after_paragraph", Number.isFinite(n) && n > 0 ? n : undefined);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
