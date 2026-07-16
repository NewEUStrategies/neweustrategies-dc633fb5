// Nowy widok /admin/appearance/menu - menedżer menu w stylu WordPress.
// Zastępuje builder-canvas (który był konfigurowany przez `settingsKey`).
// Struktura menu jest przechowywana w `public.menus` + `public.menu_items`
// i konsumowana przez publiczne query (auto-sync do widgetu MegaMenu).
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { menusListQueryOptions } from "@/lib/menus/queries";
import { MenuManager } from "@/components/admin/menu/MenuManager";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";

export const Route = createFileRoute("/admin/appearance/menu")({
  component: MenuPage,
});

function MenuPage() {
  const { t } = useTranslation();
  const { data: menus = [] } = useQuery(menusListQueryOptions);
  const [selected, setSelected] = useState<string>("main");

  const keys = menus.length > 0 ? menus : [{ id: "seed", key: "main", name: "Menu główne" }];
  const currentKey = keys.find((m) => m.key === selected) ? selected : keys[0].key;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">
            {t("admin.menu.title", { defaultValue: "Menu witryny" })}
          </h1>
          <p className="text-xs text-muted-foreground">
            {t("admin.menu.subtitle", {
              defaultValue:
                "Dodaj strony, wpisy, kategorie lub własne odnośniki i ułóż je metodą przeciągnij-i-upuść. Menu jest automatycznie synchronizowane z nagłówkiem (widget MegaMenu).",
            })}
          </p>
        </div>
        <Select value={currentKey} onValueChange={setSelected}>
          <SelectTrigger className="h-9 w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {keys.map((m) => (
              <SelectItem key={m.key} value={m.key}>
                {m.name} · {m.key}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>

      <MenuManager key={currentKey} menuKey={currentKey} />
    </div>
  );
}
