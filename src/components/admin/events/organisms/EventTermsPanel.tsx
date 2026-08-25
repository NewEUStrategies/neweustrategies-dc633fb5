// Organizm: ZGODY I REGULAMINY jednego wydarzenia.
//
// DWA LICZNIKI AKCEPTACJI STOJA OBOK SIEBIE, bo roznica miedzy nimi jest jedyna
// liczba, ktora mowi organizatorowi, ilu ludzi trzeba poprosic ponownie po
// podniesieniu wersji.
//
// USUNIECIE POKAZUJEMY TYLKO BEZ AKCEPTACJI - baza odmawia (`term_in_use`), bo
// akceptacja jest dowodem. Poprawna operacja to wylaczenie zgody.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { EventTermDialog } from "@/components/admin/events/molecules/EventTermDialog";
import { adminTermsErrorMessage } from "@/lib/events/adminTermsErrors";
import { staleAcceptances } from "@/lib/events/termsGroupsDraft";
import { uiLang } from "@/lib/i18n/format";
import {
  useDeleteEventTerm,
  useEventTerms,
  useSaveEventTerm,
} from "@/lib/events/useEventTermsGroups";
import type { EventTermRow, TermInput } from "@/lib/events/termsGroupsApi";

export function EventTermsPanel({ eventId }: { eventId: string }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const listQ = useEventTerms(eventId);
  const saveM = useSaveEventTerm(eventId);
  const deleteM = useDeleteEventTerm(eventId);

  const [editing, setEditing] = useState<EventTermRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<EventTermRow | null>(null);

  const rows = useMemo(() => listQ.data ?? [], [listQ.data]);
  const nextSortOrder = useMemo(
    () => rows.reduce((max, row) => Math.max(max, Number(row.sort_order ?? 0)), 0) + 10,
    [rows],
  );

  const labelOf = (row: EventTermRow): string =>
    lang === "en" ? row.label_en || row.label_pl : row.label_pl || row.label_en;

  const submit = (input: TermInput) => {
    saveM.mutate(input, {
      onSuccess: () => {
        toast.success(t("adminEventTerms.toasts.termSaved"));
        setDialogOpen(false);
      },
      onError: (error) => toast.error(adminTermsErrorMessage(error)),
    });
  };

  const confirmDelete = () => {
    const target = pendingDelete;
    if (target === null) return;
    deleteM.mutate(target.id, {
      onSuccess: () => {
        toast.success(t("adminEventTerms.toasts.termDeleted"));
        setPendingDelete(null);
      },
      onError: (error) => {
        toast.error(adminTermsErrorMessage(error));
        setPendingDelete(null);
      },
    });
  };

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg">{t("adminEventTerms.terms.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("adminEventTerms.terms.subtitle")}</p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          {t("adminEventTerms.terms.createAction")}
        </Button>
      </header>

      <AdminCatalogListState
        isLoading={listQ.isLoading}
        loadingLabel={t("adminEventTerms.terms.loading")}
        errorMessage={listQ.error === null ? null : adminTermsErrorMessage(listQ.error)}
        isEmpty={rows.length === 0}
        emptyLabel={t("adminEventTerms.terms.empty")}
      >
        <ul className="space-y-2">
          {rows.map((row) => {
            const stale = staleAcceptances(row);
            return (
              <li
                key={row.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border/70 p-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{labelOf(row)}</span>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{row.key}</code>
                    <Badge variant={row.is_required ? "default" : "outline"}>
                      {t(
                        row.is_required
                          ? "adminEventTerms.labels.required"
                          : "adminEventTerms.labels.optional",
                      )}
                    </Badge>
                    <Badge variant="secondary">
                      {`${t("adminEventTerms.labels.version")} ${String(row.version)}`}
                    </Badge>
                    {row.is_active ? null : (
                      <Badge variant="outline">{t("adminEventTerms.labels.inactive")}</Badge>
                    )}
                    {row.external_url === null ? null : (
                      <a
                        href={row.external_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        {t("adminEventTerms.labels.externalUrl")}
                      </a>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {`${t("adminEventTerms.labels.acceptancesCurrent")}: ${String(row.acceptances_current)}`}
                    {` · ${t("adminEventTerms.labels.acceptancesTotal")}: ${String(row.acceptances_total)}`}
                    {` · ${t("adminEventTerms.labels.withdrawn")}: ${String(row.withdrawn_count)}`}
                    {` · ${t(`adminEventTerms.displays.${row.display}`)}`}
                  </p>
                  {stale === 0 ? null : (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      {t("adminEventTerms.labels.staleAcceptances", { count: stale })}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditing(row);
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    {t("adminEventTerms.terms.editAction")}
                  </Button>
                  {row.acceptances_total > 0 ? null : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPendingDelete(row)}
                      aria-label={t("adminEventTerms.terms.deleteAction")}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </AdminCatalogListState>

      <EventTermDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        eventId={eventId}
        term={editing}
        nextSortOrder={nextSortOrder}
        isSaving={saveM.isPending}
        onSubmit={submit}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("adminEventTerms.terms.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("adminEventTerms.terms.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("adminEventTerms.terms.dialog.cancelAction")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleteM.isPending}>
              {t("adminEventTerms.terms.deleteAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
