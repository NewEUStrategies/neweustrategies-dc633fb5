// Organizm: POZIOMY sponsorskie jednego wydarzenia.
//
// LICZNIKI STOJA W WIERSZU, bo bez nich organizator nie wie, czy usuniecie ma
// szanse sie udac (`tier_in_use`) ani ile miejsc zostalo w limicie - i czyta
// odmowe bazy jako awarie.
//
// WYLACZENIE PRZED USUNIECIEM: przelacznik „aktywny" zdejmuje poziom ze strony
// publicznej bez ruszania przypiec.
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
import { AdminFormSwitchRow } from "@/components/admin/molecules/AdminFormSwitchRow";
import { EventSponsorTierDialog } from "@/components/admin/events/molecules/EventSponsorTierDialog";
import { adminSponsorErrorMessage } from "@/lib/events/adminSponsorErrors";
import { tierDraftFromRow, tierDraftToInput } from "@/lib/events/sponsorDraft";
import {
  useDeleteSponsorTier,
  useSaveSponsorTier,
  useSponsorTiers,
} from "@/lib/events/useEventSponsors";
import type { EventSponsorTierRow, SponsorTierInput } from "@/lib/events/sponsorsApi";

export function SponsorTiersPanel({ eventId }: { eventId: string }) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language.startsWith("en");
  const listQ = useSponsorTiers(eventId);
  const save = useSaveSponsorTier(eventId);
  const remove = useDeleteSponsorTier(eventId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [edited, setEdited] = useState<EventSponsorTierRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<EventSponsorTierRow | null>(null);

  const rows = listQ.data ?? [];
  const nextSortOrder = rows.reduce((max, row) => Math.max(max, row.sort_order), 0) + 10;
  const nextRank = rows.reduce((max, row) => Math.max(max, row.rank), 0) + 1;

  const fail = (error: unknown) => toast.error(adminSponsorErrorMessage(error));

  const submit = (input: SponsorTierInput) => {
    save.mutate(input, {
      onSuccess: () => {
        toast.success(t("adminEventSponsors.tiers.toasts.saved"));
        setDialogOpen(false);
        setEdited(null);
      },
      onError: fail,
    });
  };

  /** Przelacznik wysyla CALY wiersz - RPC zapisu jest upsertem. */
  const toggleActive = (row: EventSponsorTierRow, next: boolean) => {
    const draft = tierDraftFromRow(row as unknown as Record<string, unknown>);
    save.mutate({ ...tierDraftToInput(draft, eventId), isActive: next }, { onError: fail });
  };

  const confirmDelete = () => {
    if (pendingDelete === null) return;
    remove.mutate(pendingDelete.id, {
      onSuccess: () => {
        toast.success(t("adminEventSponsors.tiers.toasts.deleted"));
        setPendingDelete(null);
      },
      onError: (error) => {
        fail(error);
        setPendingDelete(null);
      },
    });
  };

  const nameOf = (row: EventSponsorTierRow): string =>
    isEn ? row.name_en || row.name_pl : row.name_pl || row.name_en;

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-display text-lg">{t("adminEventSponsors.tiers.title")}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("adminEventSponsors.tiers.subtitle")}
          </p>
        </div>
        <Button
          onClick={() => {
            setEdited(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          {t("adminEventSponsors.actions.addTier")}
        </Button>
      </header>

      <AdminCatalogListState
        isLoading={listQ.isLoading}
        loadingLabel={t("adminEventSponsors.tiers.loading")}
        errorMessage={
          listQ.error === null || listQ.error === undefined
            ? null
            : adminSponsorErrorMessage(listQ.error)
        }
        isEmpty={rows.length === 0}
        emptyLabel={t("adminEventSponsors.tiers.empty")}
      >
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-border/70 p-3"
            >
              <span
                aria-hidden="true"
                className="h-4 w-4 shrink-0 rounded-sm border border-border"
                style={{ backgroundColor: row.accent_color ?? "transparent" }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{nameOf(row)}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">{row.key}</p>
              </div>
              <Badge variant="secondary">
                {t("adminEventSponsors.tiers.sponsorsCount", { count: row.sponsors_count })}
              </Badge>
              <Badge variant="outline">
                {row.max_companies === null
                  ? t("adminEventSponsors.labels.noLimit")
                  : t("adminEventSponsors.tiers.slotsLeft", { count: row.slots_left })}
              </Badge>
              <AdminFormSwitchRow
                label={t("adminEventSponsors.tiers.dialog.isActive")}
                checked={row.is_active}
                onCheckedChange={(next) => toggleActive(row, next)}
              />
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("adminEventSponsors.tiers.dialog.editTitle")}
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
                  aria-label={t("adminEventSponsors.tiers.deleteConfirm")}
                  onClick={() => setPendingDelete(row)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </AdminCatalogListState>

      <EventSponsorTierDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        eventId={eventId}
        tier={edited}
        nextSortOrder={nextSortOrder}
        nextRank={nextRank}
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
            <AlertDialogTitle>{t("adminEventSponsors.tiers.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("adminEventSponsors.tiers.deleteConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("adminEventSponsors.tiers.dialog.cancelAction")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              {t("adminEventSponsors.tiers.dialog.saveAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
