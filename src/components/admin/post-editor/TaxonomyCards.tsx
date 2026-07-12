import { useTranslation } from "react-i18next";
import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface CategoryOption {
  id: string;
  name_pl: string;
  name_en: string;
}

interface TagOption {
  id: string;
  name: string;
}

export function CategoriesCard({
  allCats,
  selectedCats,
  onSelectedCatsChange,
  newCatPl,
  onNewCatPlChange,
  newCatEn,
  onNewCatEnChange,
  taxonomyBusy,
  onAddCategory,
}: {
  allCats: CategoryOption[] | undefined;
  selectedCats: string[];
  onSelectedCatsChange: Dispatch<SetStateAction<string[]>>;
  newCatPl: string;
  onNewCatPlChange: (v: string) => void;
  newCatEn: string;
  onNewCatEnChange: (v: string) => void;
  taxonomyBusy: "cat" | "tag" | null;
  onAddCategory: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <Label className="block">{t("admin.nav.categories")}</Label>
      <div className="space-y-1 max-h-48 overflow-auto">
        {allCats?.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selectedCats.includes(c.id)}
              onChange={(e) =>
                onSelectedCatsChange((s) =>
                  e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id),
                )
              }
            />
            {c.name_pl} / {c.name_en}
          </label>
        ))}
        {!allCats?.length && (
          <p className="text-xs text-muted-foreground">{t("admin.posts.noCats")}</p>
        )}
      </div>
      <div className="pt-3 border-t border-border space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Dodaj nową kategorię</p>
        <div className="grid grid-cols-2 gap-2">
          <Input
            value={newCatPl}
            onChange={(e) => onNewCatPlChange(e.target.value)}
            placeholder="Nazwa (PL)"
            className="h-8 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onAddCategory();
              }
            }}
          />
          <Input
            value={newCatEn}
            onChange={(e) => onNewCatEnChange(e.target.value)}
            placeholder="Name (EN)"
            className="h-8 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onAddCategory();
              }
            }}
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-full h-8"
          onClick={() => onAddCategory()}
          disabled={taxonomyBusy === "cat" || !newCatPl.trim()}
        >
          {taxonomyBusy === "cat" ? "Dodawanie..." : "+ Dodaj kategorię"}
        </Button>
      </div>
    </div>
  );
}

export function TagsCard({
  allTags,
  selectedTags,
  onSelectedTagsChange,
  newTagName,
  onNewTagNameChange,
  taxonomyBusy,
  onAddTag,
}: {
  allTags: TagOption[] | undefined;
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
        <p className="text-xs font-medium text-muted-foreground">Dodaj nowy tag</p>
        <div className="flex gap-2">
          <Input
            value={newTagName}
            onChange={(e) => onNewTagNameChange(e.target.value)}
            placeholder="Nazwa tagu"
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
            {taxonomyBusy === "tag" ? "..." : "+ Dodaj"}
          </Button>
        </div>
      </div>
    </div>
  );
}
