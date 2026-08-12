// Organizm: zarządzanie katalogiem obszarów tematycznych klubów.
//
// Trzy operacje, które musi umieć redakcja: dodać obszar (PL + EN), zmienić
// nazwę i kolejność, oraz wyłączyć obszar w organizacji. Wyłączenie jest
// osobne od usunięcia z premedytacją: obszar używany przez istniejące kluby
// i wątki NIE może zniknąć, bo etykieta w archiwum przestałaby się rozwiązywać.
// Dlatego kasowanie działa tylko dla obszarów o zerowym użyciu, a wszystko
// inne wyłącza się przełącznikiem.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useAdminClubTopics,
  useDeleteClubTopic,
  useSetClubTopicActive,
  useUpsertClubTopic,
} from "@/lib/clubs/useClubTopics";
import type { ClubTopicAdminRow } from "@/lib/clubs/topicCatalog";
import { isValidTopicKey, slugifyTopicKey } from "@/lib/clubs/topicCatalog";
import { ClubTopicChip } from "@/components/clubs/atoms/ClubTopicChip";

interface DraftState {
  id: string | null;
  key: string;
  labelPl: string;
  labelEn: string;
  sortOrder: number;
  isActive: boolean;
  isSystem: boolean;
}

const EMPTY_DRAFT: DraftState = {
  id: null,
  key: "",
  labelPl: "",
  labelEn: "",
  sortOrder: 100,
  isActive: true,
  isSystem: false,
};

function toDraft(row: ClubTopicAdminRow): DraftState {
  return {
    id: row.id,
    key: row.key,
    labelPl: row.label_pl,
    labelEn: row.label_en,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    isSystem: row.is_system,
  };
}

export function ClubTopicsManager() {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language ?? "pl").startsWith("pl") ? "pl" : "en";
  const listQ = useAdminClubTopics();
  const upsert = useUpsertClubTopic();
  const setActive = useSetClubTopicActive();
  const remove = useDeleteClubTopic();

  const [draft, setDraft] = useState<DraftState | null>(null);
  const [keyTouched, setKeyTouched] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ClubTopicAdminRow | null>(null);

  const rows = useMemo(() => listQ.data ?? [], [listQ.data]);
  const activeCount = rows.filter((r) => r.is_active).length;

  const openCreate = () => {
    setKeyTouched(false);
    setDraft({ ...EMPTY_DRAFT, sortOrder: (rows.at(-1)?.sort_order ?? 90) + 10 });
  };

  const save = () => {
    if (draft === null) return;
    const key = draft.id === null ? slugifyTopicKey(draft.key) : draft.key;
    if (draft.labelPl.trim().length < 2 || draft.labelEn.trim().length < 2) {
      toast.error(t("adminClubs.topics.errors.labels"));
      return;
    }
    if (draft.id === null && !isValidTopicKey(key)) {
      toast.error(t("adminClubs.topics.errors.key"));
      return;
    }
    upsert.mutate(
      {
        id: draft.id,
        key,
        labelPl: draft.labelPl.trim(),
        labelEn: draft.labelEn.trim(),
        sortOrder: draft.sortOrder,
        isActive: draft.isActive,
      },
      {
        onSuccess: () => {
          toast.success(t("adminClubs.topics.saved"));
          setDraft(null);
        },
        onError: (error) => {
          const message = error.message.includes("duplicate key")
            ? t("adminClubs.topics.errors.duplicate")
            : error.message;
          toast.error(message);
        },
      },
    );
  };

  const confirmDelete = () => {
    if (pendingDelete === null) return;
    remove.mutate(pendingDelete.id, {
      onSuccess: () => {
        toast.success(t("adminClubs.topics.deleted"));
        setPendingDelete(null);
      },
      onError: (error) => {
        const message = error.message.includes("topic_in_use")
          ? t("adminClubs.topics.errors.inUse")
          : error.message;
        toast.error(message);
      },
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("adminClubs.topics.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("adminClubs.topics.subtitle")}</p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1.5 h-4 w-4" />
          {t("adminClubs.topics.add")}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {t("adminClubs.topics.activeSummary", { active: activeCount, total: rows.length })}
      </p>

      {listQ.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t("adminClubs.topics.loading")}
        </div>
      ) : listQ.isError ? (
        <p className="text-sm text-destructive">{listQ.error.message}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("adminClubs.topics.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id}>
              <Card className={row.is_active ? "" : "opacity-70"}>
                <CardContent className="flex flex-wrap items-center gap-3 p-3 sm:p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <ClubTopicChip
                        topic={row.key}
                        lang={lang}
                        catalog={[
                          {
                            key: row.key,
                            label_pl: row.label_pl,
                            label_en: row.label_en,
                            sort_order: row.sort_order,
                          },
                        ]}
                      />
                      {row.is_system ? (
                        <Badge variant="outline" className="text-[10px]">
                          {t("adminClubs.topics.system")}
                        </Badge>
                      ) : null}
                      {!row.is_active ? (
                        <Badge variant="secondary" className="text-[10px]">
                          {t("adminClubs.topics.disabled")}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      <span className="font-mono">{row.key}</span> · PL: {row.label_pl} · EN:{" "}
                      {row.label_en} ·{" "}
                      {t("adminClubs.topics.usage", {
                        clubs: row.clubs_count,
                        threads: row.threads_count,
                      })}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Switch
                      checked={row.is_active}
                      disabled={setActive.isPending}
                      aria-label={t("adminClubs.topics.toggleAria", { name: row.label_pl })}
                      onCheckedChange={(checked) =>
                        setActive.mutate(
                          { id: row.id, isActive: checked },
                          {
                            onError: (error) => toast.error(error.message),
                          },
                        )
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("adminClubs.topics.edit")}
                      onClick={() => {
                        setKeyTouched(true);
                        setDraft(toDraft(row));
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("adminClubs.topics.delete")}
                      disabled={row.is_system || row.clubs_count + row.threads_count > 0}
                      onClick={() => setPendingDelete(row)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={draft !== null} onOpenChange={(open) => (open ? null : setDraft(null))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {draft?.id === null
                ? t("adminClubs.topics.dialogCreate")
                : t("adminClubs.topics.dialogEdit")}
            </DialogTitle>
            <DialogDescription>{t("adminClubs.topics.dialogHint")}</DialogDescription>
          </DialogHeader>

          {draft !== null ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="topic-label-pl">{t("adminClubs.topics.labelPl")}</Label>
                <Input
                  id="topic-label-pl"
                  value={draft.labelPl}
                  onChange={(e) => {
                    const labelPl = e.target.value;
                    setDraft({
                      ...draft,
                      labelPl,
                      key: keyTouched ? draft.key : slugifyTopicKey(labelPl),
                    });
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="topic-label-en">{t("adminClubs.topics.labelEn")}</Label>
                <Input
                  id="topic-label-en"
                  value={draft.labelEn}
                  onChange={(e) => setDraft({ ...draft, labelEn: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="topic-key">{t("adminClubs.topics.key")}</Label>
                  <Input
                    id="topic-key"
                    value={draft.key}
                    disabled={draft.id !== null}
                    onChange={(e) => {
                      setKeyTouched(true);
                      setDraft({ ...draft, key: e.target.value });
                    }}
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="topic-order">{t("adminClubs.topics.order")}</Label>
                  <Input
                    id="topic-order"
                    type="number"
                    value={String(draft.sortOrder)}
                    onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) || 0 })}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
                <Label htmlFor="topic-active" className="text-sm">
                  {t("adminClubs.topics.activeLabel")}
                </Label>
                <Switch
                  id="topic-active"
                  checked={draft.isActive}
                  onCheckedChange={(checked) => setDraft({ ...draft, isActive: checked })}
                />
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              {t("adminClubs.topics.cancel")}
            </Button>
            <Button onClick={save} disabled={upsert.isPending}>
              {upsert.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {t("adminClubs.topics.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => (open ? null : setPendingDelete(null))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("adminClubs.topics.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("adminClubs.topics.deleteBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("adminClubs.topics.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={remove.isPending}>
              {t("adminClubs.topics.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
