// Dialog listing site_settings revisions with preview + restore.
// Wired to `site_settings_revisions` (populated by the snapshot trigger).
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock, RotateCcw, Eye, User as UserIcon } from "@/lib/lucide-shim";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  useSiteSettingsRevisions,
  type SiteSettingsRevision,
} from "@/lib/admin/useSiteSettingsRevisions";

function formatDate(iso: string, locale: string) {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settingsKey: string;
  currentValue: unknown;
  onRestore: (value: unknown) => Promise<void> | void;
  title?: string;
};

export function SiteSettingsHistoryDialog({
  open,
  onOpenChange,
  settingsKey,
  currentValue,
  onRestore,
  title,
}: Props) {
  const { t, i18n } = useTranslation();
  const revisions = useSiteSettingsRevisions(settingsKey);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const selected = useMemo<SiteSettingsRevision | null>(() => {
    if (!selectedId) return null;
    return revisions.data?.find((r) => r.id === selectedId) ?? null;
  }, [selectedId, revisions.data]);

  const previewText = useMemo(
    () => (selected ? JSON.stringify(selected.value, null, 2) : ""),
    [selected],
  );
  const currentText = useMemo(() => JSON.stringify(currentValue, null, 2), [currentValue]);

  async function handleRestore() {
    if (!selected) return;
    setRestoring(true);
    try {
      await onRestore(selected.value);
      onOpenChange(false);
    } finally {
      setRestoring(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="w-4 h-4" />
            {title ?? t("themeOptions.history.title", "Historia zmian")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "themeOptions.history.description",
              "Podgląd poprzednich wersji przed nadpisaniem. Przywrócenie utworzy nowy wpis w historii.",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[280px_1fr]" style={{ minHeight: 420 }}>
          <div className="border rounded-md overflow-hidden">
            <ScrollArea className="h-[440px]">
              {revisions.isLoading ? (
                <div className="p-3 text-xs text-muted-foreground">
                  {t("common.loading", "Ładowanie...")}
                </div>
              ) : (revisions.data?.length ?? 0) === 0 ? (
                <div className="p-3 text-xs text-muted-foreground">
                  {t("themeOptions.history.empty", "Brak historii - jeszcze nic nie zapisano.")}
                </div>
              ) : (
                <ul className="divide-y">
                  {revisions.data!.map((r) => {
                    const active = r.id === selectedId;
                    return (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(r.id)}
                          className={
                            "w-full text-left px-3 py-2 text-xs transition " +
                            (active ? "bg-muted" : "hover:bg-muted/60")
                          }
                        >
                          <div className="flex items-center gap-2">
                            {r.author_avatar ? (
                              <img
                                src={r.author_avatar}
                                alt=""
                                className="w-5 h-5 rounded-[6px] object-cover"
                              />
                            ) : (
                              <div className="w-5 h-5 rounded-[6px] bg-muted flex items-center justify-center">
                                <UserIcon className="w-3 h-3 text-muted-foreground" />
                              </div>
                            )}
                            <span className="font-medium truncate">
                              {r.author_name ??
                                t("themeOptions.history.unknownAuthor", "Nieznany autor")}
                            </span>
                          </div>
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {formatDate(r.changed_at, i18n.language)}
                          </div>
                          <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                            {r.operation}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </ScrollArea>
          </div>

          <div className="border rounded-md flex flex-col">
            <div className="flex items-center gap-2 px-3 py-2 border-b text-xs text-muted-foreground">
              <Eye className="w-3.5 h-3.5" />
              {selected
                ? t("themeOptions.history.previewSelected", "Podgląd wybranej wersji")
                : t("themeOptions.history.selectRevision", "Wybierz wersję z listy")}
            </div>
            <div className="grid grid-cols-2 gap-0 flex-1 min-h-0">
              <div className="border-r p-2 flex flex-col min-h-0">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  {t("themeOptions.history.currentVersion", "Aktualna wersja")}
                </div>
                <Textarea
                  readOnly
                  value={currentText}
                  className="flex-1 font-mono text-[11px] resize-none"
                />
              </div>
              <div className="p-2 flex flex-col min-h-0">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  {t("themeOptions.history.previousVersion", "Wybrana wersja")}
                </div>
                <Textarea
                  readOnly
                  value={previewText}
                  placeholder={t(
                    "themeOptions.history.selectRevision",
                    "Wybierz wersję z listy",
                  )}
                  className="flex-1 font-mono text-[11px] resize-none"
                />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t("common.cancel", "Anuluj")}
          </Button>
          <Button
            size="sm"
            onClick={handleRestore}
            disabled={!selected || restoring}
            className="gap-2"
          >
            <RotateCcw className="w-4 h-4" />
            {restoring
              ? t("themeOptions.history.restoring", "Przywracam...")
              : t("themeOptions.history.restore", "Przywróć tę wersję")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
