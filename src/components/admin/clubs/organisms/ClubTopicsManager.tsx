// Organizm: zarządzanie katalogiem obszarów tematycznych klubów.
//
// Trzy operacje, które musi umieć redakcja: dodać obszar (PL + EN), zmienić
// nazwę i kolejność, oraz wyłączyć obszar w organizacji. Wyłączenie jest
// osobne od usunięcia z premedytacją: obszar używany przez istniejące kluby
// i wątki NIE może zniknąć, bo etykieta w archiwum przestałaby się rozwiązywać.
// Dlatego kasowanie działa tylko dla obszarów o zerowym użyciu, a wszystko
// inne wyłącza się przełącznikiem.
//
// ORGANIZM JEST KOMPOZYCJĄ. Reguły (wersja robocza, walidacja, payload zapisu,
// odcięcie kosza, mapowanie odmowy bazy) mieszkają w `lib/clubs/adminTaxonomyCatalog`
// - wspólnie z katalogiem specjalizacji, bo obie powierzchnie obiecują to samo.
// Powtarzalne fragmenty widoku (nagłówek z licznikiem, trzy stany listy, wiersz
// wpisu) to molekuły `ClubCatalog*`. Tutaj zostaje SKLEJENIE: co idzie do mutacji,
// co się dzieje z odpowiedzią i co widzi administrator po odmowie.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { uiLang } from "@/lib/i18n/format";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import {
  catalogActiveCount,
  catalogDeleteBlocked,
  catalogSortOrderValue,
  clubTopicDeleteFailure,
  clubTopicDraftFromRow,
  clubTopicDraftIssue,
  clubTopicDraftWithLabelPl,
  clubTopicSaveFailure,
  clubTopicUpsertPayload,
  clubTopicUsage,
  newClubTopicDraft,
  type CatalogFailure,
  type ClubTopicDraft,
} from "@/lib/clubs/adminTaxonomyCatalog";
import { ClubCatalogListState } from "@/components/admin/clubs/molecules/ClubCatalogListState";
import { ClubCatalogRow } from "@/components/admin/clubs/molecules/ClubCatalogRow";
import { ClubCatalogToolbar } from "@/components/admin/clubs/molecules/ClubCatalogToolbar";
import { ClubTopicChip } from "@/components/clubs/atoms/ClubTopicChip";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

export function ClubTopicsManager() {
  ensureAdminClubsI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const listQ = useAdminClubTopics();
  const upsert = useUpsertClubTopic();
  const setActive = useSetClubTopicActive();
  const remove = useDeleteClubTopic();

  const [draft, setDraft] = useState<ClubTopicDraft | null>(null);
  const [keyTouched, setKeyTouched] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ClubTopicAdminRow | null>(null);

  const rows = useMemo(() => listQ.data ?? [], [listQ.data]);

  /** Odmowa jedzie ze słownika tylko wtedy, gdy ją rozpoznaliśmy. */
  const failureText = (fail: CatalogFailure): string =>
    fail.key === null ? fail.text : t(fail.key);

  const openCreate = () => {
    setKeyTouched(false);
    setDraft(newClubTopicDraft(rows));
  };

  const openEdit = (row: ClubTopicAdminRow) => {
    setKeyTouched(true);
    setDraft(clubTopicDraftFromRow(row));
  };

  const toggleActive = (id: string, isActive: boolean) => {
    setActive.mutate({ id, isActive }, { onError: (error) => toast.error(error.message) });
  };

  const save = (current: ClubTopicDraft) => {
    const issue = clubTopicDraftIssue(current);
    if (issue !== null) {
      toast.error(t(issue));
      return;
    }
    upsert.mutate(clubTopicUpsertPayload(current), {
      onSuccess: () => {
        toast.success(t("adminClubs.topics.saved"));
        setDraft(null);
      },
      onError: (error) => toast.error(failureText(clubTopicSaveFailure(error))),
    });
  };

  const confirmDelete = (row: ClubTopicAdminRow) => {
    remove.mutate(row.id, {
      onSuccess: () => {
        toast.success(t("adminClubs.topics.deleted"));
        setPendingDelete(null);
      },
      onError: (error) => toast.error(failureText(clubTopicDeleteFailure(error))),
    });
  };

  return (
    <div className="space-y-4">
      <ClubCatalogToolbar
        title={t("adminClubs.topics.title")}
        subtitle={t("adminClubs.topics.subtitle")}
        addLabel={t("adminClubs.topics.add")}
        onAdd={openCreate}
        summary={t("adminClubs.topics.activeSummary", {
          active: catalogActiveCount(rows),
          total: rows.length,
        })}
      />

      <ClubCatalogListState
        isLoading={listQ.isLoading}
        loadingLabel={t("adminClubs.topics.loading")}
        errorMessage={listQ.isError ? listQ.error.message : null}
        isEmpty={rows.length === 0}
        emptyLabel={t("adminClubs.topics.empty")}
      >
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id}>
              <ClubCatalogRow
                isActive={row.is_active}
                isSystem={row.is_system}
                systemLabel={t("adminClubs.topics.system")}
                disabledLabel={t("adminClubs.topics.disabled")}
                title={
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
                }
                meta={
                  <>
                    <span className="font-mono">{row.key}</span> · PL: {row.label_pl} · EN:{" "}
                    {row.label_en} ·{" "}
                    {t("adminClubs.topics.usage", {
                      clubs: row.clubs_count,
                      threads: row.threads_count,
                    })}
                  </>
                }
                toggleLabel={t("adminClubs.topics.toggleAria", { name: row.label_pl })}
                toggleDisabled={setActive.isPending}
                onToggle={(checked) => toggleActive(row.id, checked)}
                editLabel={t("adminClubs.topics.edit")}
                onEdit={() => openEdit(row)}
                deleteLabel={t("adminClubs.topics.delete")}
                deleteDisabled={catalogDeleteBlocked(row, clubTopicUsage(row))}
                onDelete={() => setPendingDelete(row)}
              />
            </li>
          ))}
        </ul>
      </ClubCatalogListState>

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

          {draft === null ? null : (
            <>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="topic-label-pl">{t("adminClubs.topics.labelPl")}</Label>
                  <Input
                    id="topic-label-pl"
                    value={draft.labelPl}
                    onChange={(e) =>
                      setDraft(clubTopicDraftWithLabelPl(draft, e.target.value, keyTouched))
                    }
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
                      onChange={(e) =>
                        setDraft({ ...draft, sortOrder: catalogSortOrderValue(e.target.value) })
                      }
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

              <DialogFooter>
                <Button variant="outline" onClick={() => setDraft(null)}>
                  {t("adminClubs.topics.cancel")}
                </Button>
                <Button onClick={() => save(draft)} disabled={upsert.isPending}>
                  {upsert.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                  {t("adminClubs.topics.save")}
                </Button>
              </DialogFooter>
            </>
          )}
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
            {pendingDelete === null ? null : (
              <AlertDialogAction
                onClick={() => confirmDelete(pendingDelete)}
                disabled={remove.isPending}
              >
                {t("adminClubs.topics.delete")}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
