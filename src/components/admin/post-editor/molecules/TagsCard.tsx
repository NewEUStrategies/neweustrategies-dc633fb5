// Molekuła "Tagi": wybór tagów (chip toggles) + inline tworzenie nowego tagu.
import { useTranslation } from "react-i18next";
import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TagOpt } from "../types";
import "@/lib/i18n-admin-post-panes";

export function TagsCard({
  allTags,
  selectedTags,
  onSelectedTagsChange,
  newTagName,
  onNewTagNameChange,
  taxonomyBusy,
  onAddTag,
}: {
  allTags: TagOpt[] | undefined;
  selectedTags: string[];
  onSelectedTagsChange: Dispatch<SetStateAction<string[]>>;
  newTagName: string;
  onNewTagNameChange: (v: string) => void;
  taxonomyBusy: "cat" | "tag" | null;
  onAddTag: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <Label className="block">{t("admin.nav.tags")}</Label>
      <div className="flex flex-wrap gap-1.5 max-h-48 overflow-auto">
        {allTags?.map((tg) => {
          const active = selectedTags.includes(tg.id);
          return (
            <button
              key={tg.id}
              type="button"
              onClick={() =>
                onSelectedTagsChange((s) => (active ? s.filter((x) => x !== tg.id) : [...s, tg.id]))
              }
              className={`px-2 py-1 text-xs rounded border transition ${active ? "bg-brand text-brand-foreground border-brand" : "bg-muted/30 border-border"}`}
            >
              {tg.name}
            </button>
          );
        })}
        {!allTags?.length && (
          <p className="text-xs text-muted-foreground">{t("admin.posts.noTags")}</p>
        )}
      </div>
      <div className="pt-3 border-t border-border space-y-2">
        <p className="text-xs font-medium text-muted-foreground">
          {t("adminPostPanes.taxonomy.addTagHeading")}
        </p>
        <div className="flex gap-2">
          <Input
            value={newTagName}
            onChange={(e) => onNewTagNameChange(e.target.value)}
            placeholder={t("adminPostPanes.taxonomy.tagNamePlaceholder")}
            className="h-8 text-sm flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onAddTag();
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8"
            onClick={() => onAddTag()}
            disabled={taxonomyBusy === "tag" || !newTagName.trim()}
          >
            {taxonomyBusy === "tag"
              ? t("adminPostPanes.taxonomy.addingShort")
              : t("adminPostPanes.taxonomy.addTagShort")}
          </Button>
        </div>
      </div>
    </div>
  );
}
