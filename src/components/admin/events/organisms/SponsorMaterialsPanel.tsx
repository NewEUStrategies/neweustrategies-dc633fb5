// Organizm: MATERIALY jednego przypiecia sponsora.
//
// MATERIALY WISZA NA PRZYPIECIU, nie na firmie: ta sama firma na dwoch
// wydarzeniach ma dwie rozne paczki logotypow i dwie rozne prezentacje.
//
// LISTE CZYTAMY ZE SZCZEGOLU PRZYPIECIA (`admin_event_sponsor_detail` zwraca
// `materials` jako JSON) - osobne zapytanie na kazdy wiersz listy sponsorow
// zamienialoby jeden ekran w kilkadziesiat zapytan.
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
import { SponsorMaterialDialog } from "@/components/admin/events/molecules/SponsorMaterialDialog";
import { adminSponsorErrorMessage } from "@/lib/events/adminSponsorErrors";
import {
  useDeleteSponsorMaterial,
  useSaveSponsorMaterial,
  useSponsorDetail,
} from "@/lib/events/useEventSponsors";
import type { SponsorMaterialInput } from "@/lib/events/sponsorsApi";

/** Wiersze materialow przychodza jako `Json` - zwezamy je bez `any`. */
function materialRows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const item of value) {
    if (typeof item === "object" && item !== null) out.push(item as Record<string, unknown>);
  }
  return out;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function SponsorMaterialsPanel({
  eventId,
  sponsorId,
}: {
  eventId: string;
  sponsorId: string;
}) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language.startsWith("en");
  const detailQ = useSponsorDetail(sponsorId);
  const save = useSaveSponsorMaterial(eventId);
  const remove = useDeleteSponsorMaterial(eventId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [edited, setEdited] = useState<Record<string, unknown> | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Record<string, unknown> | null>(null);

  const rows = useMemo(
    () => materialRows((detailQ.data as { materials?: unknown } | null)?.materials),
    [detailQ.data],
  );
  const nextSortOrder =
    rows.reduce((max, row) => {
      const order = row.sort_order;
      return typeof order === "number" && order > max ? order : max;
    }, 0) + 10;

  const fail = (error: unknown) => toast.error(adminSponsorErrorMessage(error));

  const submit = (input: SponsorMaterialInput) => {
    save.mutate(input, {
      onSuccess: () => {
        toast.success(t("adminEventSponsors.sponsors.toasts.materialSaved"));
        setDialogOpen(false);
        setEdited(null);
      },
      onError: fail,
    });
  };

  const confirmDelete = () => {
    if (pendingDelete === null) return;
    remove.mutate(String(pendingDelete.id), {
      onSuccess: () => {
        toast.success(t("adminEventSponsors.sponsors.toasts.materialDeleted"));
        setPendingDelete(null);
      },
      onError: (error) => {
        fail(error);
        setPendingDelete(null);
      },
    });
  };

  return (
    <section className="space-y-3 rounded-md border border-border/70 bg-muted/20 p-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          {t("adminEventSponsors.sponsors.materials.title")}
        </h3>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setEdited(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          {t("adminEventSponsors.sponsors.materials.addAction")}
        </Button>
      </header>

      <AdminCatalogListState
        isLoading={detailQ.isLoading}
        loadingLabel={t("adminEventSponsors.sponsors.materials.loading")}
        errorMessage={
          detailQ.error === null || detailQ.error === undefined
            ? null
            : adminSponsorErrorMessage(detailQ.error)
        }
        isEmpty={rows.length === 0}
        emptyLabel={t("adminEventSponsors.sponsors.materials.empty")}
      >
        <ul className="space-y-2">
          {rows.map((row) => {
            const title = isEn
              ? text(row.title_en) || text(row.title_pl)
              : text(row.title_pl) || text(row.title_en);
            const kind = text(row.kind);
            return (
              <li
                key={String(row.id)}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border/70 bg-background p-2"
              >
                <Badge variant="secondary">
                  {kind === "" ? "-" : t(`adminEventSponsors.materialKinds.${kind}`)}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-sm">{title}</span>
                {row.is_published === true ? (
                  <Badge variant="outline">{t("adminEventSponsors.filters.published")}</Badge>
                ) : null}
                <a
                  href={text(row.url)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                  aria-label={t("adminEventSponsors.sponsors.materials.dialog.url")}
                >
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                </a>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("adminEventSponsors.sponsors.materials.dialog.editTitle")}
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
                  aria-label={t("adminEventSponsors.sponsors.materials.deleteConfirm")}
                  onClick={() => setPendingDelete(row)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
      </AdminCatalogListState>

      <SponsorMaterialDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        sponsorId={sponsorId}
        material={edited}
        nextSortOrder={nextSortOrder}
        isSaving={save.isPending}
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
            <AlertDialogTitle>
              {t("adminEventSponsors.sponsors.materials.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("adminEventSponsors.sponsors.materials.deleteConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("adminEventSponsors.sponsors.materials.dialog.cancelAction")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              {t("adminEventSponsors.sponsors.materials.dialog.saveAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
