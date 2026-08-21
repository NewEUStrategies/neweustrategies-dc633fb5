// Organizm: zarządzanie katalogiem specjalizacji klubów dyskusyjnych.
//
// Specjalizacja to najwyższy poziom taksonomii: to ona ma własną stronę
// publiczną (/club/specialization/<slug>) i to po niej zarówno anonim, jak
// i członek wchodzi do katalogu klubów. Dlatego formularz pyta o komplet
// tekstów PL/EN (nazwa, zajawka na kafel, opis na stronę), a nie tylko
// o etykietę - niedokończony wpis wygląda na stronie jak brak treści.
//
// Wyłączenie jest osobne od usunięcia z premedytacją: specjalizacja
// przypisana do klubów nie może zniknąć, bo osierociłaby te kluby (nie
// pokazałaby ich żadna strona). Kasowanie działa tylko przy zerowym użyciu.
//
// ORGANIZM JEST KOMPOZYCJĄ. Reguły (wersja robocza z NULL-owalnych kolumn,
// walidacja, payload zapisu, odcięcie kosza, mapowanie odmowy bazy) mieszkają
// w `lib/clubs/adminTaxonomyCatalog` - wspólnie z katalogiem obszarów, bo obie
// powierzchnie obiecują to samo. Powtarzalne fragmenty widoku to molekuły
// `ClubCatalog*`. Tutaj zostaje SKLEJENIE: co idzie do mutacji, co się dzieje
// z odpowiedzią i co widzi administrator po odmowie.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  useAdminClubSpecializations,
  useDeleteClubSpecialization,
  useSetClubSpecializationActive,
  useUpsertClubSpecialization,
} from "@/lib/clubs/useClubSpecializations";
import type { ClubSpecializationAdminRow } from "@/lib/clubs/specializationsApi";
import {
  CLUB_SPECIALIZATION_ICON_NAMES,
  resolveSpecializationIcon,
} from "@/lib/clubs/specializations";
import { clubSlugFromName } from "@/lib/clubs/types";
import {
  catalogActiveCount,
  catalogDeleteBlocked,
  catalogSortOrderValue,
  clubSpecializationDeleteFailure,
  clubSpecializationDraftFromRow,
  clubSpecializationDraftIssue,
  clubSpecializationDraftWithLabelPl,
  clubSpecializationSaveFailure,
  clubSpecializationUpsertPayload,
  clubSpecializationUsage,
  newClubSpecializationDraft,
  type CatalogFailure,
  type ClubSpecializationDraft,
} from "@/lib/clubs/adminTaxonomyCatalog";
import { ClubCatalogListState } from "@/components/admin/clubs/molecules/ClubCatalogListState";
import { ClubCatalogRow } from "@/components/admin/clubs/molecules/ClubCatalogRow";
import { ClubCatalogToolbar } from "@/components/admin/clubs/molecules/ClubCatalogToolbar";

export function ClubSpecializationsManager() {
  const { t } = useTranslation();
  const listQ = useAdminClubSpecializations();
  const upsert = useUpsertClubSpecialization();
  const setActive = useSetClubSpecializationActive();
  const remove = useDeleteClubSpecialization();

  const [draft, setDraft] = useState<ClubSpecializationDraft | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ClubSpecializationAdminRow | null>(null);

  const rows = useMemo(() => listQ.data ?? [], [listQ.data]);

  /** Odmowa jedzie ze słownika tylko wtedy, gdy ją rozpoznaliśmy. */
  const failureText = (fail: CatalogFailure): string =>
    fail.key === null ? fail.text : t(fail.key);

  const openCreate = () => {
    setSlugTouched(false);
    setDraft(newClubSpecializationDraft(rows));
  };

  const openEdit = (row: ClubSpecializationAdminRow) => {
    setSlugTouched(true);
    setDraft(clubSpecializationDraftFromRow(row));
  };

  const toggleActive = (id: string, isActive: boolean) => {
    setActive.mutate({ id, isActive }, { onError: (error) => toast.error(error.message) });
  };

  const save = (current: ClubSpecializationDraft) => {
    const issue = clubSpecializationDraftIssue(current);
    if (issue !== null) {
      toast.error(t(issue));
      return;
    }
    upsert.mutate(clubSpecializationUpsertPayload(current), {
      onSuccess: () => {
        toast.success(t("adminClubs.specializations.saved"));
        setDraft(null);
      },
      onError: (error) => toast.error(failureText(clubSpecializationSaveFailure(error))),
    });
  };

  const confirmDelete = (row: ClubSpecializationAdminRow) => {
    remove.mutate(row.id, {
      onSuccess: () => {
        toast.success(t("adminClubs.specializations.deleted"));
        setPendingDelete(null);
      },
      onError: (error) => toast.error(failureText(clubSpecializationDeleteFailure(error))),
    });
  };

  return (
    <div className="space-y-4">
      <ClubCatalogToolbar
        title={t("adminClubs.specializations.title")}
        subtitle={t("adminClubs.specializations.subtitle")}
        addLabel={t("adminClubs.specializations.add")}
        onAdd={openCreate}
        summary={t("adminClubs.specializations.activeSummary", {
          active: catalogActiveCount(rows),
          total: rows.length,
        })}
      />

      <ClubCatalogListState
        isLoading={listQ.isLoading}
        loadingLabel={t("adminClubs.specializations.loading")}
        errorMessage={listQ.isError ? listQ.error.message : null}
        isEmpty={rows.length === 0}
        emptyLabel={t("adminClubs.specializations.empty")}
      >
        <ul className="space-y-2">
          {rows.map((row) => {
            const Icon = resolveSpecializationIcon(row.icon);
            return (
              <li key={row.id}>
                <ClubCatalogRow
                  isActive={row.is_active}
                  isSystem={row.is_system}
                  systemLabel={t("adminClubs.specializations.system")}
                  disabledLabel={t("adminClubs.specializations.disabled")}
                  leading={
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/60">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                  }
                  title={
                    <>
                      <span className="font-medium">{row.label_pl}</span>
                      <span className="text-xs text-muted-foreground">/ {row.label_en}</span>
                    </>
                  }
                  meta={
                    <>
                      <span className="font-mono">{row.slug}</span> ·{" "}
                      {t("adminClubs.specializations.usage", { clubs: row.clubs_count })} ·{" "}
                      {t("adminClubs.specializations.order")}: {row.sort_order}
                    </>
                  }
                  extraActions={
                    <Button
                      asChild
                      variant="ghost"
                      size="icon"
                      aria-label={t("adminClubs.specializations.preview")}
                    >
                      <Link
                        to="/club/specialization/$slug"
                        params={{ slug: row.slug }}
                        target="_blank"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    </Button>
                  }
                  toggleLabel={t("adminClubs.specializations.toggleAria", { name: row.label_pl })}
                  toggleDisabled={setActive.isPending}
                  onToggle={(checked) => toggleActive(row.id, checked)}
                  editLabel={t("adminClubs.specializations.edit")}
                  onEdit={() => openEdit(row)}
                  deleteLabel={t("adminClubs.specializations.delete")}
                  deleteDisabled={catalogDeleteBlocked(row, clubSpecializationUsage(row))}
                  onDelete={() => setPendingDelete(row)}
                />
              </li>
            );
          })}
        </ul>
      </ClubCatalogListState>

      <Dialog open={draft !== null} onOpenChange={(open) => (open ? null : setDraft(null))}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {draft?.id === null
                ? t("adminClubs.specializations.dialogCreate")
                : t("adminClubs.specializations.dialogEdit")}
            </DialogTitle>
            <DialogDescription>{t("adminClubs.specializations.dialogHint")}</DialogDescription>
          </DialogHeader>

          {draft === null ? null : (
            <>
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="spec-label-pl">{t("adminClubs.specializations.labelPl")}</Label>
                    <Input
                      id="spec-label-pl"
                      value={draft.labelPl}
                      onChange={(e) =>
                        setDraft(
                          clubSpecializationDraftWithLabelPl(draft, e.target.value, slugTouched),
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="spec-label-en">{t("adminClubs.specializations.labelEn")}</Label>
                    <Input
                      id="spec-label-en"
                      value={draft.labelEn}
                      onChange={(e) => setDraft({ ...draft, labelEn: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="spec-lead-pl">{t("adminClubs.specializations.leadPl")}</Label>
                    <Textarea
                      id="spec-lead-pl"
                      rows={2}
                      value={draft.leadPl}
                      onChange={(e) => setDraft({ ...draft, leadPl: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="spec-lead-en">{t("adminClubs.specializations.leadEn")}</Label>
                    <Textarea
                      id="spec-lead-en"
                      rows={2}
                      value={draft.leadEn}
                      onChange={(e) => setDraft({ ...draft, leadEn: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="spec-desc-pl">{t("adminClubs.specializations.descPl")}</Label>
                    <Textarea
                      id="spec-desc-pl"
                      rows={3}
                      value={draft.descPl}
                      onChange={(e) => setDraft({ ...draft, descPl: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="spec-desc-en">{t("adminClubs.specializations.descEn")}</Label>
                    <Textarea
                      id="spec-desc-en"
                      rows={3}
                      value={draft.descEn}
                      onChange={(e) => setDraft({ ...draft, descEn: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="spec-slug">{t("adminClubs.specializations.slug")}</Label>
                    <Input
                      id="spec-slug"
                      value={draft.slug}
                      onChange={(e) => {
                        setSlugTouched(true);
                        setDraft({ ...draft, slug: clubSlugFromName(e.target.value) });
                      }}
                      className="font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="spec-icon">{t("adminClubs.specializations.icon")}</Label>
                    <Select
                      value={draft.icon}
                      onValueChange={(icon) => setDraft({ ...draft, icon })}
                    >
                      <SelectTrigger id="spec-icon">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CLUB_SPECIALIZATION_ICON_NAMES.map((name) => {
                          const Icon = resolveSpecializationIcon(name);
                          return (
                            <SelectItem key={name} value={name}>
                              <span className="flex items-center gap-2">
                                <Icon className="h-4 w-4" aria-hidden="true" />
                                {name}
                              </span>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="spec-order">{t("adminClubs.specializations.order")}</Label>
                    <Input
                      id="spec-order"
                      type="number"
                      value={String(draft.sortOrder)}
                      onChange={(e) =>
                        setDraft({ ...draft, sortOrder: catalogSortOrderValue(e.target.value) })
                      }
                    />
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  {t("adminClubs.specializations.slugHint")}
                </p>

                <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
                  <Label htmlFor="spec-active" className="text-sm">
                    {t("adminClubs.specializations.activeLabel")}
                  </Label>
                  <Switch
                    id="spec-active"
                    checked={draft.isActive}
                    onCheckedChange={(checked) => setDraft({ ...draft, isActive: checked })}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setDraft(null)}>
                  {t("adminClubs.specializations.cancel")}
                </Button>
                <Button onClick={() => save(draft)} disabled={upsert.isPending}>
                  {upsert.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                  {t("adminClubs.specializations.save")}
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
            <AlertDialogTitle>{t("adminClubs.specializations.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("adminClubs.specializations.deleteBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("adminClubs.specializations.cancel")}</AlertDialogCancel>
            {pendingDelete === null ? null : (
              <AlertDialogAction
                onClick={() => confirmDelete(pendingDelete)}
                disabled={remove.isPending}
              >
                {t("adminClubs.specializations.delete")}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
