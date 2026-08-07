// Zapisane wyszukiwania (dla zalogowanych). Zapisuje bieżący stan URL jako
// nazwany snapshot; klik na pozycji przywraca parametry. Wzorzec useBookmarks.
// Dzwonek per pozycja włącza alert o nowych wynikach (producent w DB skanuje
// co 20 minut i wysyła powiadomienie / digest przez enqueue_notification).
//
// Panel jest ENCJO-AGNOSTYCZNY (20260807142000): ta sama powierzchnia obsługuje
// wyszukiwarkę treści (`posts`) i katalog osób (`people`). Lista jest zawężona
// do encji, bo przywrócenie parametrów katalogu osób w URL-u wyszukiwarki
// treści dałoby zapytanie, którego ta strona nie rozumie. Typ parametrów jest
// dlatego mapą stringów, nie modelem jednej powierzchni.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Bell, BellOff } from "lucide-react";
import { Bookmark, Save, Trash2, X } from "@/lib/lucide-shim";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import {
  useSavedSearches,
  useSaveSearch,
  useDeleteSavedSearch,
  useToggleSavedSearchAlert,
  type SavedSearch,
  type SavedSearchEntity,
} from "@/hooks/useSavedSearches";
import { cn } from "@/lib/utils";

/** Snapshot stanu URL - wspólny mianownik obu powierzchni. */
export type SavedSearchParams = Record<string, unknown>;

interface Props {
  current: SavedSearchParams;
  /** Czy jest co zapisać (fraza lub jakikolwiek filtr). */
  canSave: boolean;
  onApply: (params: SavedSearchParams) => void;
  /** Obserwowana encja. Domyślnie wyszukiwarka treści (zachowanie sprzed 08.2026). */
  entity?: SavedSearchEntity;
}

export function SavedSearchesPanel({ current, canSave, onApply, entity = "posts" }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: saved } = useSavedSearches(entity);
  const save = useSaveSearch();
  const del = useDeleteSavedSearch();
  const toggleAlert = useToggleSavedSearchAlert();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  if (!user) {
    return <p className="text-xs text-muted-foreground">{t("search.saved.login_hint")}</p>;
  }

  const doSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await save.mutateAsync({ name: trimmed, params: current, entity });
      toast.success(t("search.saved.saved_toast"));
      setName("");
      setNaming(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const doDelete = async (id: string) => {
    try {
      await del.mutateAsync(id);
      toast.success(t("search.saved.deleted_toast"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const doToggleAlert = async (s: SavedSearch) => {
    try {
      await toggleAlert.mutateAsync({ search: s, enabled: !s.alert_enabled });
      toast.success(
        s.alert_enabled ? t("search.saved.alert_off_toast") : t("search.saved.alert_on_toast"),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-2">
      <h3 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        <Bookmark className="w-3.5 h-3.5" />
        {t("search.saved.title")}
      </h3>

      {naming ? (
        <div className="flex gap-1.5">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("search.saved.name_placeholder")}
            className="h-8 text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void doSave();
              } else if (e.key === "Escape") {
                setNaming(false);
                setName("");
              }
            }}
          />
          <Button
            size="sm"
            className="h-8"
            disabled={!name.trim() || save.isPending}
            onClick={doSave}
          >
            <Save className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0"
            onClick={() => {
              setNaming(false);
              setName("");
            }}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="w-full h-8 text-xs"
          disabled={!canSave}
          onClick={() => setNaming(true)}
        >
          <Save className="w-3.5 h-3.5 mr-1.5" />
          {t("search.saved.save")}
        </Button>
      )}

      {saved && saved.length > 0 ? (
        <ul className="space-y-1">
          {saved.map((s) => (
            <li key={s.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onApply(s.params ?? {})}
                className="flex-1 text-left truncate rounded px-2 py-1 text-sm hover:bg-muted"
                title={s.name}
              >
                {s.name}
              </button>
              <button
                type="button"
                aria-label={
                  s.alert_enabled ? t("search.saved.alert_off") : t("search.saved.alert_on")
                }
                aria-pressed={s.alert_enabled}
                title={s.alert_enabled ? t("search.saved.alert_off") : t("search.saved.alert_on")}
                onClick={() => doToggleAlert(s)}
                disabled={toggleAlert.isPending}
                className={cn(
                  "shrink-0 rounded p-1 transition-colors hover:bg-muted",
                  s.alert_enabled
                    ? "text-brand hover:text-brand"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s.alert_enabled ? (
                  <Bell className="w-3.5 h-3.5" />
                ) : (
                  <BellOff className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                type="button"
                aria-label={t("search.saved.delete")}
                onClick={() => doDelete(s.id)}
                className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive hover:bg-muted"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{t("search.saved.empty")}</p>
      )}
    </div>
  );
}
