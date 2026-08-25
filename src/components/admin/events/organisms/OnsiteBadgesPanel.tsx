// Organizm: IDENTYFIKATORY - szablony i rejestr wydruków.
//
// WYDRUK ZE STAREJ WERSJI JEST ODZNACZONY. Baza zapisuje wersję szablonu w chwili
// druku, więc `template_version < template_current_version` znaczy „ten
// identyfikator wygląda inaczej niż aktualny szablon". Bez tej odznaki
// organizator szuka błędu drukarki, gdy w rzeczywistości ktoś zmienił szablon w
// trakcie wydarzenia.
//
// LICZNIK WYDRUKÓW OBOK SZABLONU. Szablon z wydrukami to odmowa `template_in_use`
// - liczba w wierszu zamienia tę odmowę w decyzję podjętą przed kliknięciem.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
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
import { AdminPagination } from "@/components/admin/molecules/AdminPagination";
import { BadgeTemplateDialog } from "@/components/admin/events/molecules/BadgeTemplateDialog";
import { adminOnsiteErrorMessage } from "@/lib/events/adminOnsiteErrors";
import {
  useBadgePrints,
  useBadgeTemplates,
  useDeleteBadgeTemplate,
  useSaveBadgeTemplate,
} from "@/lib/events/useEventOnsite";
import type { BadgeTemplateInput, BadgeTemplateRow } from "@/lib/events/onsiteApi";

export function OnsiteBadgesPanel({ eventId }: { eventId: string }) {
  const { t, i18n } = useTranslation();
  const templatesQ = useBadgeTemplates(eventId);
  const save = useSaveBadgeTemplate(eventId);
  const remove = useDeleteBadgeTemplate(eventId);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const printsQ = useBadgePrints({ eventId, limit: pageSize, offset: (page - 1) * pageSize });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [edited, setEdited] = useState<BadgeTemplateRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BadgeTemplateRow | null>(null);

  const templates = templatesQ.data ?? [];
  const prints = printsQ.data ?? [];
  const printsTotal = prints.length === 0 ? 0 : prints[0].total_count;
  const fail = (error: unknown) => toast.error(adminOnsiteErrorMessage(error));

  const submit = (input: BadgeTemplateInput) => {
    save.mutate(input, {
      onSuccess: () => {
        toast.success(t("adminEventOnsite.badges.toasts.saved"));
        setDialogOpen(false);
        setEdited(null);
      },
      onError: fail,
    });
  };

  const confirmDelete = () => {
    if (pendingDelete === null) return;
    remove.mutate(pendingDelete.id, {
      onSuccess: () => {
        toast.success(t("adminEventOnsite.badges.toasts.deleted"));
        setPendingDelete(null);
      },
      onError: (error) => {
        fail(error);
        setPendingDelete(null);
      },
    });
  };

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-display text-lg">{t("adminEventOnsite.badges.title")}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("adminEventOnsite.badges.subtitle")}
          </p>
        </div>
        <Button
          onClick={() => {
            setEdited(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          {t("adminEventOnsite.actions.addTemplate")}
        </Button>
      </header>

      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("adminEventOnsite.badges.templatesTitle")}
        </h3>
        <AdminCatalogListState
          isLoading={templatesQ.isLoading}
          loadingLabel={t("adminEventOnsite.badges.loading")}
          errorMessage={
            templatesQ.error === null || templatesQ.error === undefined
              ? null
              : adminOnsiteErrorMessage(templatesQ.error)
          }
          isEmpty={templates.length === 0}
          emptyLabel={t("adminEventOnsite.badges.empty")}
        >
          <ul className="space-y-2">
            {templates.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-3 rounded-md border border-border/70 p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{row.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {`${t(`adminEventOnsite.paperFormats.${row.paper_format}`, {
                      defaultValue: row.paper_format,
                    })} · ${t(`adminEventOnsite.orientations.${row.orientation}`, {
                      defaultValue: row.orientation,
                    })} · v${row.version}`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {row.is_default ? (
                    <Badge>{t("adminEventOnsite.badges.isDefault")}</Badge>
                  ) : null}
                  <Badge variant="outline">{`${t("adminEventOnsite.stats.badgesPrinted")}: ${row.prints_count}`}</Badge>
                  {row.stale_prints_count > 0 ? (
                    <Badge variant="secondary">{t("adminEventOnsite.badges.staleVersion")}</Badge>
                  ) : null}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("adminEventOnsite.badges.dialog.editTitle")}
                    onClick={() => {
                      setEdited(row);
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("adminEventOnsite.badges.deleteConfirm")}
                    onClick={() => setPendingDelete(row)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </AdminCatalogListState>
      </div>

      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("adminEventOnsite.badges.printsTitle")}
        </h3>
        <AdminCatalogListState
          isLoading={printsQ.isLoading}
          loadingLabel={t("adminEventOnsite.badges.printsLoading")}
          errorMessage={
            printsQ.error === null || printsQ.error === undefined
              ? null
              : adminOnsiteErrorMessage(printsQ.error)
          }
          isEmpty={prints.length === 0}
          emptyLabel={t("adminEventOnsite.badges.printsEmpty")}
        >
          <div className="overflow-hidden rounded-md border border-border/70">
            <ul className="divide-y divide-border/70">
              {prints.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {`${row.first_name ?? ""} ${row.last_name ?? ""}`.trim()}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[row.template_name, row.device_label, row.printed_by_name]
                        .filter((part) => part !== null && part !== "")
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {row.template_version < row.template_current_version ? (
                      <Badge variant="secondary">
                        {t("adminEventOnsite.badges.staleVersion")}
                      </Badge>
                    ) : null}
                    <Badge variant="outline">{`×${row.copies}`}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(row.printed_at).toLocaleString(i18n.language)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <AdminPagination
              page={page}
              pageSize={pageSize}
              total={printsTotal}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </div>
        </AdminCatalogListState>
      </div>

      <BadgeTemplateDialog
        open={dialogOpen}
        onOpenChange={(next) => {
          setDialogOpen(next);
          if (!next) setEdited(null);
        }}
        eventId={eventId}
        template={edited}
        isSaving={save.isPending}
        onSubmit={submit}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => (next ? undefined : setPendingDelete(null))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("adminEventOnsite.badges.templatesTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("adminEventOnsite.badges.deleteConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("adminEventOnsite.actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              {t("adminEventOnsite.actions.save")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
