// Organizm: bilety jednego wydarzenia.
//
// WYŁĄCZENIE PRZED USUNIĘCIEM. Baza odmawia skasowania biletu, którego używa
// choćby jedno zgłoszenie (`ticket_in_use`), bo historia zapisu straciłaby to,
// co uczestnik kupił. Dlatego przełącznik „aktywny" stoi w wierszu, a kasowanie
// jest za potwierdzeniem, które mówi, że zadziała tylko dla nieużywanego biletu.
//
// LICZBY POKAZUJEMY OBOK PULI, bo pula bez liczby zajętych miejsc nie mówi nic o
// tym, czy można ją bezpiecznie obniżyć - a RPC odmawia zejścia poniżej zajętych.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
import { EventTicketDialog } from "@/components/admin/events/molecules/EventTicketDialog";
import { adminRegistrationErrorMessage } from "@/lib/events/adminRegistrationErrors";
import { formatDateTime } from "@/lib/i18n/format";
import { ticketDraftFromRow, ticketDraftToInput } from "@/lib/events/ticketDraft";
import type { EventTicketInput, EventTicketRow } from "@/lib/events/registrationsApi";
import {
  useDeleteEventTicket,
  useEventTickets,
  useSaveEventTicket,
} from "@/lib/events/useEventRegistrations";

/** Cena w najmniejszej jednostce -> zapis walutowy w języku interfejsu. */
function formatPrice(cents: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}

export function EventTicketsPanel({ eventId }: { eventId: string }) {
  const { t, i18n } = useTranslation();
  const listQ = useEventTickets(eventId);
  const save = useSaveEventTicket(eventId);
  const remove = useDeleteEventTicket(eventId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [edited, setEdited] = useState<EventTicketRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<EventTicketRow | null>(null);

  const rows = listQ.data ?? [];
  const nextSortOrder = rows.reduce((max, row) => Math.max(max, row.sort_order ?? 0), 0) + 10;

  const fail = (error: unknown) => toast.error(adminRegistrationErrorMessage(error));

  const submit = (input: EventTicketInput) => {
    save.mutate(input, {
      onSuccess: () => {
        toast.success(t("adminEventRegistration.tickets.toasts.saved"));
        setDialogOpen(false);
        setEdited(null);
      },
      onError: fail,
    });
  };

  /** Przełącznik w wierszu wysyła CAŁY wiersz - RPC zapisu jest upsertem. */
  const toggleActive = (row: EventTicketRow, next: boolean) => {
    save.mutate(
      { ...ticketDraftToInput(ticketDraftFromRow(row), eventId), isActive: next },
      {
        onError: fail,
      },
    );
  };

  const confirmDelete = () => {
    if (pendingDelete === null) return;
    remove.mutate(pendingDelete.id, {
      onSuccess: () => {
        toast.success(t("adminEventRegistration.tickets.toasts.deleted"));
        setPendingDelete(null);
      },
      onError: (error) => {
        fail(error);
        setPendingDelete(null);
      },
    });
  };

  const windowLabel = (row: EventTicketRow): string => {
    const from = row.sales_from ?? null;
    const to = row.sales_to ?? null;
    if (from === null && to === null) return t("adminEventRegistration.tickets.noWindow");
    const parts: string[] = [];
    if (from !== null) {
      parts.push(
        t("adminEventRegistration.tickets.windowFrom", {
          date: formatDateTime(from, i18n.language),
        }),
      );
    }
    if (to !== null) {
      parts.push(
        t("adminEventRegistration.tickets.windowTo", { date: formatDateTime(to, i18n.language) }),
      );
    }
    return parts.join(" ");
  };

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("adminEventRegistration.tickets.title")}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("adminEventRegistration.tickets.subtitle")}
          </p>
        </div>
        <Button
          onClick={() => {
            setEdited(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          {t("adminEventRegistration.tickets.addAction")}
        </Button>
      </header>

      <AdminCatalogListState
        isLoading={listQ.isLoading}
        loadingLabel={t("adminEventRegistration.tickets.loading")}
        errorMessage={listQ.error === null ? null : adminRegistrationErrorMessage(listQ.error)}
        isEmpty={rows.length === 0}
        emptyLabel={t("adminEventRegistration.tickets.empty")}
      >
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-[14rem] flex-1">
                <p className="font-medium">
                  {i18n.language.startsWith("pl") ? row.name_pl : row.name_en}
                </p>
                <p className="font-medium tracking-tight text-xs text-muted-foreground">{row.key}</p>
              </div>

              <div className="min-w-[8rem] text-sm">
                {row.price_cents === 0
                  ? t("adminEventRegistration.tickets.free")
                  : formatPrice(row.price_cents, row.currency, i18n.language)}
              </div>

              <div className="min-w-[10rem] text-sm text-muted-foreground">
                <span className="text-foreground">
                  {row.quota === null || row.quota === undefined
                    ? t("adminEventRegistration.tickets.unlimitedQuota")
                    : row.quota}
                </span>
                {" · "}
                {t("adminEventRegistration.tickets.columns.sold")}: {row.sold_count ?? 0}
              </div>

              <div className="min-w-[12rem] text-xs text-muted-foreground">{windowLabel(row)}</div>

              {row.requires_approval ? (
                <Badge variant="outline">
                  {t("adminEventRegistration.tickets.columns.approval")}
                </Badge>
              ) : null}

              <Switch
                checked={row.is_active}
                onCheckedChange={(next) => toggleActive(row, next)}
                aria-label={t("adminEventRegistration.tickets.editor.active")}
              />

              <Button
                variant="ghost"
                size="icon"
                aria-label={t("adminEventRegistration.tickets.editor.editTitle")}
                onClick={() => {
                  setEdited(row);
                  setDialogOpen(true);
                }}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("adminEventRegistration.tickets.editor.deleteAction")}
                onClick={() => setPendingDelete(row)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      </AdminCatalogListState>

      <EventTicketDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        eventId={eventId}
        ticket={edited}
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
              {t("adminEventRegistration.tickets.editor.deleteAction")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("adminEventRegistration.tickets.editor.deleteConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("adminEventRegistration.tickets.editor.cancelAction")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={remove.isPending}>
              {t("adminEventRegistration.tickets.editor.deleteAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
