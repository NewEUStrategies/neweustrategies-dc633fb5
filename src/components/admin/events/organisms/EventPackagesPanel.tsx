// Organizm: PAKIETY GRUPOWE i ich zamówienia w jednym ekranie.
//
// DWA POZIOMY NA JEDNYM EKRANIE, BO DECYZJA JEST JEDNA. Organizator, który
// patrzy na pakiet „Delegacja 10 miejsc", pyta o to samo tchnieniem: ile ich
// sprzedano i komu. Rozbicie oferty i zamówień na dwie podstrony kazałoby mu
// trzymać w głowie, który pakiet ogląda.
//
// USUNIĘCIE DZIAŁA TYLKO BEZ ZAMÓWIEŃ (baza odmawia inaczej), więc podstawowym
// narzędziem wycofania oferty jest przełącznik „aktywny" - tak samo jak przy
// biletach.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { FormSelect } from "@/components/atoms/FormSelect";
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
import { EventPackageDialog } from "@/components/admin/events/molecules/EventPackageDialog";
import { EventPackageOrderDialog } from "@/components/admin/events/molecules/EventPackageOrderDialog";
import { EventPackageSeatsDialog } from "@/components/admin/events/molecules/EventPackageSeatsDialog";
import { adminRegistrationErrorMessage } from "@/lib/events/adminRegistrationErrors";
import { packageDraftFromRow, packageDraftToInput } from "@/lib/events/packageDraft";
import {
  PACKAGE_ORDER_STATUSES,
  type EventPackageInput,
  type EventPackageRow,
  type PackageOrderInput,
  type PackageOrderStatus,
} from "@/lib/events/packagesApi";
import {
  useCreatePackageOrder,
  useDeleteEventPackage,
  useEventPackages,
  usePackageOrders,
  useSaveEventPackage,
  useSetPackageOrderStatus,
} from "@/lib/events/useEventPackages";
import { useEventTickets } from "@/lib/events/useEventRegistrations";

function formatPrice(cents: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}

// Straznik czyta LISTE stanow, a nie wylicza ich po raz drugi - recznie
// wypisane `paid`/`cancelled` gubily `refunded`, przez co zamowienie zwrocone
// pokazywalo sie w tabeli jako „oczekuje na platnosc".
function orderStatus(value: string): PackageOrderStatus {
  return (PACKAGE_ORDER_STATUSES as readonly string[]).includes(value)
    ? (value as PackageOrderStatus)
    : "pending";
}

export function EventPackagesPanel({ eventId }: { eventId: string }) {
  const { t, i18n } = useTranslation();
  const packagesQ = useEventPackages(eventId);
  const ticketsQ = useEventTickets(eventId);
  const save = useSaveEventPackage(eventId);
  const remove = useDeleteEventPackage(eventId);
  const createOrder = useCreatePackageOrder(eventId);
  const setStatus = useSetPackageOrderStatus(eventId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [edited, setEdited] = useState<EventPackageRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<EventPackageRow | null>(null);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [orderDialogPackage, setOrderDialogPackage] = useState<string | null>(null);
  const [seatsOrderId, setSeatsOrderId] = useState<string | null>(null);

  const rows = useMemo(() => packagesQ.data ?? [], [packagesQ.data]);

  // FILTR NIE PRZEZYWA SWOJEGO PAKIETU. Usuniecie dziala tylko dla pakietu bez
  // zamowien, wiec organizator moze skasowac wlasnie ten pakiet, po ktorym
  // zawezil liste. Identyfikator w stanie zostawalby wtedy w mocy: zapytanie
  // pytaloby o zamowienia oferty, ktorej juz nie ma, sekcja mowilaby „brak
  // zamowien dla wybranego pakietu" (czyli „nikt nic nie kupil" na calym
  // wydarzeniu), a sama kontrolka pokazywalaby juz co innego niz zawezenie,
  // bo jej wartosc nie ma odpowiednika w opcjach. Zawezenie liczymy wiec z
  // LISTY, a nie z samego stanu - znika pakiet, wraca „wszystkie pakiety".
  const filterPackageId = useMemo(
    () => (rows.some((row) => row.id === selectedPackageId) ? selectedPackageId : null),
    [rows, selectedPackageId],
  );

  const ordersQ = usePackageOrders(eventId, filterPackageId);
  const nextSortOrder = rows.reduce((max, row) => Math.max(max, row.sort_order ?? 0), 0) + 10;
  const isPl = i18n.language.startsWith("pl");

  const fail = (error: unknown) => toast.error(adminRegistrationErrorMessage(error));

  const submit = (input: EventPackageInput) => {
    save.mutate(input, {
      onSuccess: () => {
        toast.success(t("adminEventRegistration.packages.toasts.saved"));
        setDialogOpen(false);
        setEdited(null);
      },
      onError: fail,
    });
  };

  const toggleActive = (row: EventPackageRow, next: boolean) => {
    save.mutate(
      { ...packageDraftToInput(packageDraftFromRow(row), eventId), isActive: next },
      { onError: fail },
    );
  };

  const submitOrder = (input: PackageOrderInput) => {
    createOrder.mutate(input, {
      onSuccess: () => {
        toast.success(t("adminEventRegistration.packages.orders.toasts.created"));
        setOrderDialogPackage(null);
      },
      onError: fail,
    });
  };

  const confirmDelete = () => {
    if (pendingDelete === null) return;
    remove.mutate(pendingDelete.id, {
      onSuccess: () => {
        toast.success(t("adminEventRegistration.packages.toasts.deleted"));
        setPendingDelete(null);
      },
      onError: (error) => {
        fail(error);
        setPendingDelete(null);
      },
    });
  };

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">
              {t("adminEventRegistration.packages.title")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("adminEventRegistration.packages.subtitle")}
            </p>
          </div>
          <Button
            onClick={() => {
              setEdited(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            {t("adminEventRegistration.packages.addAction")}
          </Button>
        </header>

        {ticketsQ.error === null ? null : (
          // Bilety nie maja na tym ekranie wlasnej listy, ale sa polem WYMAGANYM
          // formularza pakietu - po odmowie okno otwieraloby sie z pusta
          // droplista i bez sladu, ze zapytanie padlo. Odmowa dochodzi zdaniem,
          // tak samo jak przy pakietach i zamowieniach.
          <p className="text-sm text-destructive">
            {adminRegistrationErrorMessage(ticketsQ.error)}
          </p>
        )}

        <AdminCatalogListState
          isLoading={packagesQ.isLoading}
          errorMessage={
            packagesQ.error === null ? null : adminRegistrationErrorMessage(packagesQ.error)
          }
          isEmpty={rows.length === 0}
          loadingLabel={t("adminEventRegistration.packages.loading")}
          emptyLabel={t("adminEventRegistration.packages.empty")}
        >
          <ul className="space-y-2">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-3 rounded-[6px] border border-border/70 p-3"
              >
                <div className="min-w-[14rem] flex-1">
                  <p className="text-sm font-medium">{isPl ? row.name_pl : row.name_en}</p>
                  <p className="text-xs text-muted-foreground">
                    {t(`adminEventRegistration.packages.audiences.${row.audience}`, {
                      defaultValue: row.audience,
                    })}{" "}
                    · {t("adminEventRegistration.packages.seatsLabel")}: {row.seats} ·{" "}
                    {t("adminEventRegistration.packages.ticketLabel")}:{" "}
                    {isPl ? row.ticket_name_pl : row.ticket_name_en}
                  </p>
                </div>

                <div className="min-w-[8rem] text-sm">
                  {formatPrice(row.price_cents, row.currency, i18n.language)}
                </div>

                <div className="min-w-[10rem] text-xs text-muted-foreground">
                  {t("adminEventRegistration.packages.soldLabel")}: {row.sold_count}
                  {row.quota === null || row.quota === undefined
                    ? ` / ${t("adminEventRegistration.packages.unlimitedQuota")}`
                    : ` / ${row.quota}`}
                  <br />
                  {t("adminEventRegistration.packages.assignedLabel")}: {row.seats_assigned}
                </div>

                {row.requires_verification ? (
                  <Badge variant="outline">
                    {t("adminEventRegistration.packages.verificationBadge")}
                  </Badge>
                ) : null}

                {row.is_active ? null : (
                  <Badge variant="outline">
                    {t("adminEventRegistration.packages.inactiveBadge")}
                  </Badge>
                )}

                <Switch
                  checked={row.is_active}
                  onCheckedChange={(next) => toggleActive(row, next)}
                  aria-label={t("adminEventRegistration.packages.activeToggle", {
                    name: isPl ? row.name_pl : row.name_en,
                  })}
                />

                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t("adminEventRegistration.packages.editAction")}
                    onClick={() => {
                      setEdited(row);
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t("adminEventRegistration.packages.orders.addAction")}
                    onClick={() => setOrderDialogPackage(row.id)}
                  >
                    <Users className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t("adminEventRegistration.packages.deleteAction")}
                    onClick={() => setPendingDelete(row)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </AdminCatalogListState>
      </section>

      <section className="space-y-3">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">
              {t("adminEventRegistration.packages.orders.title")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("adminEventRegistration.packages.orders.subtitle")}
            </p>
          </div>
          <div className="w-56 space-y-1.5">
            <Label htmlFor="event-package-filter">
              {t("adminEventRegistration.packages.orders.filterLabel")}
            </Label>
            <FormSelect
              id="event-package-filter"
              value={filterPackageId ?? "all"}
              options={[
                { value: "all", label: t("adminEventRegistration.packages.orders.allPackages") },
                ...rows.map((row) => ({
                  value: row.id,
                  label: isPl ? row.name_pl : row.name_en,
                })),
              ]}
              onValueChange={(value) => setSelectedPackageId(value === "all" ? null : value)}
            />
          </div>
        </header>

        <AdminCatalogListState
          isLoading={ordersQ.isLoading}
          errorMessage={
            ordersQ.error === null ? null : adminRegistrationErrorMessage(ordersQ.error)
          }
          isEmpty={(ordersQ.data ?? []).length === 0}
          loadingLabel={t("adminEventRegistration.packages.orders.loading")}
          emptyLabel={t("adminEventRegistration.packages.orders.empty")}
        >
          <ul className="space-y-2">
            {(ordersQ.data ?? []).map((order) => {
              // Platnik nazywa wiersz i - to wazniejsze - nazywa POLE STANU:
              // dwa zamowienia obok siebie z identycznie nazwanymi polami
              // koncza sie „oplacone" wpisanym w cudze zamowienie.
              const buyer =
                order.buyer_name !== null && order.buyer_name !== ""
                  ? order.buyer_name
                  : order.buyer_email;
              return (
                <li
                  key={order.id}
                  className="flex flex-wrap items-center gap-3 rounded-[6px] border border-border/70 p-3"
                >
                  <div className="min-w-[14rem] flex-1">
                    <p className="text-sm font-medium">{buyer}</p>
                    <p className="text-xs text-muted-foreground">
                      {isPl ? order.package_name_pl : order.package_name_en} ·{" "}
                      {t("adminEventRegistration.packages.orders.seatsSummary", {
                        assigned: order.seats_assigned,
                        invited: order.seats_invited,
                        total: order.seats_total,
                      })}
                    </p>
                  </div>

                  <div className="min-w-[7rem] text-sm">
                    {formatPrice(order.amount_cents, order.currency, i18n.language)}
                  </div>

                  <div className="w-44">
                    <FormSelect
                      value={orderStatus(order.status)}
                      options={PACKAGE_ORDER_STATUSES.map((status) => ({
                        value: status,
                        label: t(`adminEventRegistration.packages.orders.statuses.${status}`),
                      }))}
                      aria-label={t("adminEventRegistration.packages.orders.status", { buyer })}
                      onValueChange={(value) =>
                        setStatus.mutate(
                          { id: order.id, status: orderStatus(value) },
                          {
                            onSuccess: () =>
                              toast.success(
                                t("adminEventRegistration.packages.orders.toasts.statusChanged"),
                              ),
                            onError: fail,
                          },
                        )
                      }
                    />
                  </div>

                  <Button size="sm" variant="outline" onClick={() => setSeatsOrderId(order.id)}>
                    <Users className="mr-2 h-3.5 w-3.5" />
                    {t("adminEventRegistration.packages.orders.manageSeats")}
                  </Button>
                </li>
              );
            })}
          </ul>
        </AdminCatalogListState>
      </section>

      <EventPackageDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEdited(null);
        }}
        eventId={eventId}
        eventPackage={edited}
        tickets={ticketsQ.data ?? []}
        nextSortOrder={nextSortOrder}
        isSaving={save.isPending}
        onSubmit={submit}
      />

      <EventPackageOrderDialog
        open={orderDialogPackage !== null}
        onOpenChange={(open) => {
          if (!open) setOrderDialogPackage(null);
        }}
        packageId={orderDialogPackage ?? ""}
        isSaving={createOrder.isPending}
        onSubmit={submitOrder}
      />

      <EventPackageSeatsDialog
        open={seatsOrderId !== null}
        onOpenChange={(open) => {
          if (!open) setSeatsOrderId(null);
        }}
        eventId={eventId}
        orderId={seatsOrderId}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("adminEventRegistration.packages.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("adminEventRegistration.packages.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("adminEventRegistration.packages.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              {t("adminEventRegistration.packages.deleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
