// Molekuła "Kategorie": lista wyboru + inline tworzenie nowej kategorii (PL/EN).
import { useTranslation } from "react-i18next";
import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CategoryOpt } from "../types";
import "@/lib/i18n-admin-post-panes";

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
  allCats: CategoryOpt[] | undefined;
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
        <p className="text-xs font-medium text-muted-foreground">
          {t("adminPostPanes.taxonomy.addCategoryHeading")}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Input
            value={newCatPl}
            onChange={(e) => onNewCatPlChange(e.target.value)}
            placeholder={t("adminPostPanes.taxonomy.namePlPlaceholder")}
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
            placeholder={t("adminPostPanes.taxonomy.nameEnPlaceholder")}
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
          {taxonomyBusy === "cat"
            ? t("adminPostPanes.taxonomy.adding")
            : t("adminPostPanes.taxonomy.addCategory")}
        </Button>
      </div>
    </div>
  );
}
