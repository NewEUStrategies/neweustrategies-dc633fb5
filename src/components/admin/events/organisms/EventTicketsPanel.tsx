// Organizm: bilety jednego wydarzenia.
//
// WYŁĄCZENIE PRZED USUNIĘCIEM. Baza odmawia skasowania biletu, którego używa
// choćby jedno zgłoszenie (`ticket_in_use`), bo historia zapisu straciłaby to,
// co uczestnik kupił. Dlatego przełącznik „aktywny" stoi w wierszu, a kasowanie
// jest za potwierdzeniem, które mówi, że zadziała tylko dla nieużywanego biletu.
//
// LICZBY POKAZUJEMY OBOK PULI, bo pula bez liczby zajętych miejsc nie mówi nic o
// tym, czy można ją bezpiecznie obniżyć - a RPC odmawia zejścia poniżej zajętych.
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Copy, CopyPlus, Link2, MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import {
  DEFAULT_TICKET_PRESENTATION,
  duplicateTicketDraft,
  matchesTicketSearch,
  saveTicketPresentation,
  ticketRegistrationUrl,
  ticketStatus,
  useSaveTicketPresentation,
  useTicketPresentation,
  type TicketPresentation,
} from "@/lib/events/ticketPresentation";
import { ensureI18n as ensureRegistrationI18n } from "@/lib/i18n-admin-event-registration";

/** Cena w najmniejszej jednostce -> zapis walutowy w języku interfejsu. */
function formatPrice(cents: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}

export function EventTicketsPanel({ eventId, eventSlug }: { eventId: string; eventSlug?: string }) {
  ensureRegistrationI18n();
  const { t, i18n } = useTranslation();
  const presentationQ = useTicketPresentation(eventId);
  const savePresentation = useSaveTicketPresentation(eventId);
  const [query, setQuery] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const lookOf = (id: string): TicketPresentation =>
    presentationQ.data?.get(id) ?? DEFAULT_TICKET_PRESENTATION;
  const isPl = i18n.language.startsWith("pl");
  const listQ = useEventTickets(eventId);
  const save = useSaveEventTicket(eventId);
  const remove = useDeleteEventTicket(eventId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [edited, setEdited] = useState<EventTicketRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<EventTicketRow | null>(null);

  const rows = listQ.data ?? [];
  const nextSortOrder = rows.reduce((max, row) => Math.max(max, row.sort_order ?? 0), 0) + 10;

  const fail = (error: unknown) => toast.error(adminRegistrationErrorMessage(error));

  const submit = (input: EventTicketInput, look: TicketPresentation) => {
    save.mutate(input, {
      onSuccess: (ticketId) => {
        savePresentation.mutate({ ticketId, value: look }, { onError: fail });
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

  const copyText = (value: string) => {
    void navigator.clipboard
      .writeText(value)
      .then(() => toast.success(t("adminEventRegistration.tickets.studio.copied")))
      .catch(() => toast.error(t("adminEventRegistration.tickets.studio.copyFailed")));
  };

  /** Kopia zapisuje się od razu jako nieaktywna - organizator włącza ją świadomie. */
  const duplicate = (row: EventTicketRow) => {
    const copy = duplicateTicketDraft(
      ticketDraftFromRow(row),
      new Set(rows.map((entry) => entry.key)),
      {
        pl: t("adminEventRegistration.tickets.studio.duplicateSuffixPl"),
        en: t("adminEventRegistration.tickets.studio.duplicateSuffixEn"),
      },
      nextSortOrder,
    );
    const look = lookOf(row.id);
    save.mutate(
      { ...ticketDraftToInput(copy, eventId), isActive: false },
      {
        onSuccess: (ticketId) => {
          void saveTicketPresentation(ticketId, look)
            .then(() => presentationQ.refetch())
            .catch(fail);
          toast.success(t("adminEventRegistration.tickets.studio.duplicated"));
          setDialogOpen(false);
          setEdited(null);
        },
        onError: fail,
      },
    );
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

  const shown = rows.filter((row) => matchesTicketSearch(row, query));
  const dateCell = (value: string | null | undefined) =>
    value === null || value === undefined
      ? t("adminEventRegistration.tickets.studio.noDate")
      : formatDateTime(value, i18n.language);

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
        <div className="relative mb-3 max-w-sm">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t("adminEventRegistration.tickets.studio.search")}
            placeholder={t("adminEventRegistration.tickets.studio.search")}
            className="pl-9"
          />
        </div>
        {shown.length === 0 ? (
          <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
            {t("adminEventRegistration.tickets.studio.noResults")}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  {(
                    [
                      "name",
                      "status",
                      "price",
                      "uses",
                      "validFrom",
                      "validUntil",
                      "group",
                      "visibility",
                    ] as const
                  ).map((column) => (
                    <th key={column} scope="col" className="px-3 py-2 font-medium">
                      {t(`adminEventRegistration.tickets.studio.columns.${column}`)}
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    <span className="sr-only">
                      {t("adminEventRegistration.tickets.studio.columns.actions")}
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((row) => {
                  const status = ticketStatus(row);
                  const look = lookOf(row.id);
                  const url =
                    eventSlug === undefined ? null : ticketRegistrationUrl(eventSlug, row.key);
                  const groupName = isPl ? row.group_name_pl : row.group_name_en;
                  return (
                    <tr key={row.id} className="align-middle">
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          className="text-left font-medium text-foreground hover:underline"
                          onClick={() => {
                            setEdited(row);
                            setDialogOpen(true);
                          }}
                        >
                          {(isPl ? row.name_pl : row.name_en) || row.key}
                        </button>
                        <p className="text-xs text-muted-foreground">{row.key}</p>
                        <p className="text-xs text-muted-foreground">{windowLabel(row)}</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {row.early_bird_until !== null && row.early_bird_until !== undefined ? (
                            <Badge variant="secondary">
                              {t("adminEventRegistration.tickets.earlyBirdBadge", {
                                date: formatDateTime(row.early_bird_until, i18n.language),
                              })}
                            </Badge>
                          ) : null}
                          {row.waitlist_enabled === false ? (
                            <Badge variant="outline">
                              {t("adminEventRegistration.tickets.noWaitlistBadge")}
                            </Badge>
                          ) : null}
                          {row.requires_approval ? (
                            <Badge variant="outline">
                              {t("adminEventRegistration.tickets.columns.approval")}
                            </Badge>
                          ) : null}
                          {look.groupRegistrationEnabled ? (
                            <Badge variant="outline">
                              {t("adminEventRegistration.tickets.studio.groupRegistration")}
                            </Badge>
                          ) : null}
                          {row.has_access_code === true ? (
                            <Badge variant="outline">
                              {t("adminEventRegistration.tickets.accessCodeBadge")}
                            </Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={row.is_active}
                            onCheckedChange={(next) => toggleActive(row, next)}
                            aria-label={t("adminEventRegistration.tickets.editor.active")}
                          />
                          <Badge variant={status === "on_sale" ? "default" : "secondary"}>
                            {t(`adminEventRegistration.tickets.studio.status.${status}`)}
                          </Badge>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {row.price_cents === 0
                          ? t("adminEventRegistration.tickets.free")
                          : formatPrice(row.price_cents, row.currency, i18n.language)}
                        {typeof row.effective_price_cents === "number" &&
                        row.effective_price_cents !== row.price_cents ? (
                          <p className="text-xs text-muted-foreground">
                            {t("adminEventRegistration.tickets.effectivePrice", {
                              price: formatPrice(
                                row.effective_price_cents,
                                row.currency,
                                i18n.language,
                              ),
                            })}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="text-foreground">
                          {row.quota === null || row.quota === undefined
                            ? t("adminEventRegistration.tickets.unlimitedQuota")
                            : row.quota}
                        </span>
                        {" · "}
                        {t("adminEventRegistration.tickets.columns.sold")}: {row.sold_count ?? 0}
                      </td>
                      <td className="px-3 py-3 text-xs">{dateCell(row.sales_from)}</td>
                      <td className="px-3 py-3 text-xs">{dateCell(row.sales_to)}</td>
                      <td className="px-3 py-3 text-xs">
                        {groupName !== null && groupName !== undefined && groupName !== ""
                          ? groupName
                          : t("adminEventRegistration.tickets.studio.noDate")}
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant="outline">
                          {t(
                            look.isHidden
                              ? "adminEventRegistration.tickets.studio.hidden"
                              : "adminEventRegistration.tickets.studio.visible",
                          )}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
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
                        <Popover
                          open={menuFor === row.id}
                          onOpenChange={(open) => setMenuFor(open ? row.id : null)}
                        >
                          <PopoverTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t("adminEventRegistration.tickets.studio.moreActions")}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent align="end" className="w-56 p-1">
                            <div role="menu" className="flex flex-col">
                              <MenuAction
                                icon={<CopyPlus className="h-4 w-4" />}
                                label={t("adminEventRegistration.tickets.studio.duplicate")}
                                onSelect={() => {
                                  setMenuFor(null);
                                  duplicate(row);
                                }}
                              />
                              {url !== null ? (
                                <MenuAction
                                  icon={<Link2 className="h-4 w-4" />}
                                  label={t("adminEventRegistration.tickets.studio.copyUrl")}
                                  onSelect={() => {
                                    setMenuFor(null);
                                    copyText(url);
                                  }}
                                />
                              ) : null}
                              <MenuAction
                                icon={<Copy className="h-4 w-4" />}
                                label={t("adminEventRegistration.tickets.studio.ticketId")}
                                onSelect={() => {
                                  setMenuFor(null);
                                  copyText(row.id);
                                }}
                              />
                            </div>
                          </PopoverContent>
                        </Popover>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </AdminCatalogListState>

      <EventTicketDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        eventId={eventId}
        ticket={edited}
        nextSortOrder={nextSortOrder}
        isSaving={save.isPending}
        onSubmit={submit}
        eventSlug={eventSlug}
        presentation={edited === null ? undefined : lookOf(edited.id)}
        onDuplicate={edited === null ? undefined : () => duplicate(edited)}
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

function MenuAction({
  icon,
  label,
  onSelect,
  destructive = false,
}: {
  icon: ReactNode;
  label: string;
  onSelect: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={[
        "flex items-center gap-2 rounded-[4px] px-2 py-1.5 text-left text-sm hover:bg-muted",
        destructive ? "text-destructive" : "text-foreground",
      ].join(" ")}
    >
      {icon}
      {label}
    </button>
  );
}
