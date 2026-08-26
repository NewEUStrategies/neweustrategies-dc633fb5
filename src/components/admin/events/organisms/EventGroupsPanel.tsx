// Organizm: GRUPY UCZESTNIKOW jednego wydarzenia.
//
// LICZNIKI STOJA W WIERSZU, bo bez nich organizator nie wie, czy usuniecie ma
// szanse sie udac (`group_in_use`) ani ilu ludzi dotknie zmiana uprawnien.
//
// GRUPA SYSTEMOWA NIE MA PRZYCISKU USUNIECIA - baza jej nie usunie
// (`group_system`), wiec przycisk obiecywalby operacje, ktora zawsze konczy sie
// odmowa.
import { useMemo, useState } from "react";
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
import { EventGroupDialog } from "@/components/admin/events/molecules/EventGroupDialog";
import { adminTermsErrorMessage } from "@/lib/events/adminTermsErrors";
import { uiLang } from "@/lib/i18n/format";
import {
  useDeleteEventGroup,
  useEventGroups,
  useSaveEventGroup,
} from "@/lib/events/useEventTermsGroups";
import type { EventGroupRow, GroupInput } from "@/lib/events/termsGroupsApi";

/** Jedna metryka grupy: etykieta nad liczba, zeby rzedy dalo sie skanowac. */
function GroupMetric({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex flex-col leading-tight">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </span>
  );
}

export function EventGroupsPanel({ eventId }: { eventId: string }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const listQ = useEventGroups(eventId);
  const saveM = useSaveEventGroup(eventId);
  const deleteM = useDeleteEventGroup(eventId);

  const [editing, setEditing] = useState<EventGroupRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<EventGroupRow | null>(null);

  const rows = useMemo(() => listQ.data ?? [], [listQ.data]);
  const nextSortOrder = useMemo(
    () => rows.reduce((max, row) => Math.max(max, Number(row.sort_order ?? 0)), 0) + 10,
    [rows],
  );

  const nameOf = (row: EventGroupRow): string =>
    lang === "en" ? row.name_en || row.name_pl : row.name_pl || row.name_en;

  const submit = (input: GroupInput) => {
    saveM.mutate(input, {
      onSuccess: () => {
        toast.success(t("adminEventTerms.toasts.groupSaved"));
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
        toast.success(t("adminEventTerms.toasts.groupDeleted"));
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
      {/* SAM PRZYCISK, BEZ TYTULU. Naglowek „Grupy uczestnikow” stoi juz w
          lewej kolumnie sekcji studia - powtorzony obok listy dawal dwa te same
          zdania kilkadziesiat pikseli od siebie i to one najmocniej zlewaly
          ekran. Zostaje akcja, bo ona nie ma odpowiednika po lewej. */}
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          {t("adminEventTerms.groups.createAction")}
        </Button>
      </div>

      <AdminCatalogListState
        isLoading={listQ.isLoading}
        loadingLabel={t("adminEventTerms.groups.loading")}
        errorMessage={listQ.error === null ? null : adminTermsErrorMessage(listQ.error)}
        isEmpty={rows.length === 0}
        emptyLabel={t("adminEventTerms.groups.empty")}
      >
        <ul className="space-y-3">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-3 rounded-[6px] border border-border bg-background p-4 transition-colors hover:border-brand/40"
            >
              {/* PIONOWA BELKA ZAMIAST KROPKI: kolor grupy jest jedynym
                  znacznikiem, po ktorym rzedy roznia sie na pierwszy rzut oka,
                  a kropka o boku 12 px ginela miedzy plakietkami. */}
              <span
                aria-hidden="true"
                className="h-10 w-1 shrink-0 rounded-[6px] bg-border"
                style={row.color === null ? undefined : { backgroundColor: row.color }}
              />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[15px] font-semibold">{nameOf(row)}</span>
                  <span className="rounded-[6px] border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    {row.key}
                  </span>
                  {row.is_default ? (
                    <Badge variant="secondary">{t("adminEventTerms.labels.default")}</Badge>
                  ) : null}
                  {row.is_system ? (
                    <Badge variant="outline">{t("adminEventTerms.labels.system")}</Badge>
                  ) : null}
                </div>
                {/* LICZNIKI JAKO KOLUMNY, nie jako zdanie z kropkami. Ciag
                    „Zapisani: 0 · Dodatkowi: 0 · Bilety: 0” czytalo sie jak
                    jeden szary akapit; etykieta nad liczba daje trzy punkty
                    zaczepienia i pozwala porownywac rzedy w pionie. */}
                <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
                  <GroupMetric
                    label={t("adminEventTerms.labels.members")}
                    value={row.primary_members_count}
                  />
                  <GroupMetric
                    label={t("adminEventTerms.labels.extraMembers")}
                    value={row.extra_members_count}
                  />
                  <GroupMetric
                    label={t("adminEventTerms.labels.tickets")}
                    value={row.tickets_count}
                  />
                  <span className="text-xs text-muted-foreground">
                    {t(`adminEventTerms.visibilities.${row.attendee_visibility}`)}
                  </span>
                </div>
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
                  {t("adminEventTerms.groups.editAction")}
                </Button>
                {row.is_system ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPendingDelete(row)}
                    aria-label={t("adminEventTerms.groups.deleteAction")}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </AdminCatalogListState>

      <EventGroupDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        eventId={eventId}
        group={editing}
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
            <AlertDialogTitle>{t("adminEventTerms.groups.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("adminEventTerms.groups.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("adminEventTerms.groups.dialog.cancelAction")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleteM.isPending}>
              {t("adminEventTerms.groups.deleteAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
