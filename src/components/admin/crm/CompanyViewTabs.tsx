// Paski zakładek zapisanych widoków w stylu HubSpot dla listy firm.
// Łączy widoki wbudowane (BUILTIN_COMPANY_VIEWS) z widokami użytkownika
// z tabeli `saved_views`. "+" tworzy nowy widok z bieżącej konfiguracji;
// context menu (⋮) pozwala zmienić nazwę, udostępnić, usunąć.
import { useState } from "react";
import { Plus, MoreHorizontal, Bookmark, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { BUILTIN_COMPANY_VIEWS } from "@/lib/crm/companyViews";
import type { CompanyViewConfig } from "@/lib/crm/companyViews";

export interface SavedViewRow {
  id: string;
  name: string;
  config: unknown;
  is_shared: boolean;
  user_id: string;
}

interface Props {
  lang: "pl" | "en";
  activeId: string;
  onSelect: (id: string, config: CompanyViewConfig) => void;
  saved: SavedViewRow[];
  currentConfig: CompanyViewConfig;
  onCreate: (name: string, isShared: boolean) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onToggleShared: (id: string, next: boolean) => Promise<void>;
}

export function CompanyViewTabs({
  lang,
  activeId,
  onSelect,
  saved,
  currentConfig,
  onCreate,
  onRename,
  onDelete,
  onToggleShared,
}: Props) {
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newShared, setNewShared] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const t = (pl: string, en: string) => (lang === "pl" ? pl : en);

  return (
    <div className="flex items-center gap-1 border-b overflow-x-auto scrollbar-thin">
      {BUILTIN_COMPANY_VIEWS.map((v) => {
        const active = activeId === v.id;
        return (
          <button
            key={v.id}
            type="button"
            onClick={() => onSelect(v.id, v.config)}
            className={`relative px-3 py-2 text-[12px] font-medium whitespace-nowrap transition-colors ${
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {lang === "pl" ? v.labelPl : v.labelEn}
            {active && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
            )}
          </button>
        );
      })}
      {saved.length > 0 && <div className="mx-1 h-4 w-px bg-border" aria-hidden />}
      {saved.map((v) => {
        const active = activeId === v.id;
        return (
          <div key={v.id} className="group relative flex items-center">
            <button
              type="button"
              onClick={() => {
                const cfg = v.config as CompanyViewConfig;
                onSelect(v.id, cfg);
              }}
              className={`flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium whitespace-nowrap transition-colors ${
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Bookmark className="h-3 w-3" aria-hidden />
              {v.name}
              {v.is_shared && <Users className="h-3 w-3 opacity-60" aria-hidden />}
              {active && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
              )}
            </button>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={t("Opcje widoku", "View options")}
                  className="mr-1 grid h-5 w-5 place-items-center rounded opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100 focus:opacity-100"
                >
                  <MoreHorizontal className="h-3 w-3" aria-hidden />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-52 p-1 text-[12px]">
                <button
                  type="button"
                  className="flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-muted"
                  onClick={() => {
                    setRenameId(v.id);
                    setRenameValue(v.name);
                  }}
                >
                  {t("Zmień nazwę", "Rename")}
                </button>
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-muted"
                  onClick={() => onToggleShared(v.id, !v.is_shared)}
                >
                  {t("Udostępnij zespołowi", "Share with team")}
                  <Switch checked={v.is_shared} onCheckedChange={() => undefined} />
                </button>
                <div className="my-1 h-px bg-border" />
                <button
                  type="button"
                  className="flex w-full items-center rounded px-2 py-1.5 text-left text-destructive hover:bg-destructive/10"
                  onClick={() => onDelete(v.id)}
                >
                  <Trash2 className="mr-2 h-3 w-3" aria-hidden />
                  {t("Usuń widok", "Delete view")}
                </button>
              </PopoverContent>
            </Popover>
          </div>
        );
      })}

      <Popover open={newOpen} onOpenChange={setNewOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="ml-1 h-7 gap-1 px-2 text-[12px]">
            <Plus className="h-3 w-3" aria-hidden />
            {t("Zapisz widok", "Save view")}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 space-y-3 p-3">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
              {t("Nazwa widoku", "View name")}
            </label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("np. Firmy z UE", "e.g. EU companies")}
              className="h-8 text-[12px]"
              autoFocus
            />
          </div>
          <label className="flex items-center gap-2 text-[12px]">
            <Switch checked={newShared} onCheckedChange={setNewShared} />
            {t("Udostępnij zespołowi", "Share with team")}
          </label>
          <p className="text-[11px] text-muted-foreground">
            {t(
              `Zapisze bieżące kolumny, filtry i sortowanie (${currentConfig.columns.length} kol.).`,
              `Saves current columns, filters and sort (${currentConfig.columns.length} cols).`,
            )}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setNewOpen(false)}>
              {t("Anuluj", "Cancel")}
            </Button>
            <Button
              size="sm"
              disabled={!newName.trim()}
              onClick={async () => {
                await onCreate(newName.trim(), newShared);
                setNewName("");
                setNewShared(false);
                setNewOpen(false);
              }}
            >
              {t("Zapisz", "Save")}
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {renameId && (
        <Popover open onOpenChange={(v) => !v && setRenameId(null)}>
          <PopoverTrigger asChild>
            <span className="sr-only">rename anchor</span>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 space-y-2 p-3">
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="h-8 text-[12px]"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setRenameId(null)}>
                {t("Anuluj", "Cancel")}
              </Button>
              <Button
                size="sm"
                disabled={!renameValue.trim()}
                onClick={async () => {
                  await onRename(renameId, renameValue.trim());
                  setRenameId(null);
                }}
              >
                {t("Zapisz", "Save")}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
