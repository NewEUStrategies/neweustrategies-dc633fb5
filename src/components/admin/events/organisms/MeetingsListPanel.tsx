// Organizm: lista zaproszeń i spotkań giełdy 1-1 w panelu organizatora.
//
// TRZY RZECZY, KTÓRE ORGANIZATOR ROBI NA TYM EKRANIE, i nic poza nimi:
// znajduje spotkanie (filtry), odnotowuje frekwencję („odbyło się" /
// „nieobecność") i odwołuje spotkanie z powodem. Umawianie ma własny dialog, bo
// wymaga wyszukania dwóch osób i wolnego terminu.
//
// „WYGASŁE" NIE JEST STANEM W KOLUMNIE. Baza liczy je z terminu ważności
// zaproszenia, więc zakładka „Wygasłe" to filtr serwera, a nie porównywanie dat
// w przeglądarce - dwie różne implementacje tej samej reguły rozjechałyby się
// przy pierwszej zmianie strefy czasowej.
//
// STRONICOWANIE IDZIE PO `total_count` Z WIERSZA. RPC zwraca sumę razem
// z danymi (window function), więc licznik „21-40 z 137" nie kosztuje drugiego
// zapytania i nie potrafi się rozjechać z listą, którą opisuje.
//
// FREKWENCJA JEST ODWRACALNA, ODWOŁANIE NIE. Dlatego „odbyło się" idzie jednym
// kliknięciem, a odwołanie przechodzi przez potwierdzenie z polem powodu -
// powód zobaczą obie strony.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CalendarPlus, CheckCircle2, UserX, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { ArrangeMeetingDialog } from "@/components/admin/events/organisms/ArrangeMeetingDialog";
import { adminMeetingFailure } from "@/lib/events/adminMeetingErrors";
import { formatDateTime } from "@/lib/i18n/format";
import type { AdminMeetingRow, MeetingStatusFilter } from "@/lib/events/meetingsApi";
import { useAdminMeetings, useMeetingTables, useSetMeetingStatus } from "@/lib/events/useMeetings";

const TABS: MeetingStatusFilter[] = [
  "all",
  "pending",
  "accepted",
  "held",
  "no_show",
  "declined",
  "cancelled",
  "expired",
];

const PAGE_SIZE = 25;

/** Wygasłe zaproszenie ma w bazie stan `invited` - etykieta musi mówić prawdę. */
function statusKey(row: AdminMeetingRow): string {
  if (row.status === "invited" && row.is_expired) return "expired";
  return row.status;
}

function personLabel(first: string | null, last: string | null, company: string | null): string {
  const name = [first, last].filter((part) => part !== null && part.length > 0).join(" ");
  if (company === null || company.length === 0) return name;
  return `${name} · ${company}`;
}

export function MeetingsListPanel({ eventId }: { eventId: string }) {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<MeetingStatusFilter>("all");
  const [search, setSearch] = useState("");
  const [tableId, setTableId] = useState("all");
  const [arrangeOpen, setArrangeOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [cancelled, setCancelled] = useState<AdminMeetingRow | null>(null);
  const [reason, setReason] = useState("");

  const tablesQ = useMeetingTables(eventId);
  const query = useMemo(
    () => ({
      eventId,
      status,
      tableId: tableId === "all" ? null : tableId,
      search: search.trim().length === 0 ? null : search.trim(),
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [eventId, status, tableId, search, page],
  );
  const listQ = useAdminMeetings(query);
  const setStatusMutation = useSetMeetingStatus(eventId);

  const rows = listQ.data ?? [];
  const total = rows[0]?.total_count ?? 0;
  const filtered = status !== "all" || tableId !== "all" || search.trim().length > 0;

  const fail = (error: unknown) => {
    const failure = adminMeetingFailure(error);
    toast.error(t(failure.key, failure.params));
  };

  const mark = (row: AdminMeetingRow, next: "held" | "no_show") => {
    setStatusMutation.mutate(
      { meetingId: row.id, status: next },
      {
        onSuccess: () =>
          toast.success(
            t(
              next === "held"
                ? "adminEventMeetings.toasts.attendanceHeld"
                : "adminEventMeetings.toasts.attendanceNoShow",
            ),
          ),
        onError: fail,
      },
    );
  };

  const confirmCancel = () => {
    if (cancelled === null) return;
    setStatusMutation.mutate(
      { meetingId: cancelled.id, status: "cancelled", reason: reason.trim() || null },
      {
        onSuccess: () => {
          toast.success(t("adminEventMeetings.toasts.meetingCancelled"));
          setCancelled(null);
          setReason("");
        },
        onError: (error) => {
          fail(error);
          setCancelled(null);
        },
      },
    );
  };

  const resetFilters = () => {
    setStatus("all");
    setSearch("");
    setTableId("all");
    setPage(0);
  };

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg">{t("adminEventMeetings.list.title")}</h2>
          <p className="mt-1 max-w-2xl text-xs leading-snug text-muted-foreground">
            {t("adminEventMeetings.list.subtitle")}
          </p>
        </div>
        <Button size="sm" onClick={() => setArrangeOpen(true)}>
          <CalendarPlus className="mr-2 h-4 w-4" aria-hidden="true" />
          {t("adminEventMeetings.list.arrangeAction")}
        </Button>
      </header>

      <ArrangeMeetingDialog eventId={eventId} open={arrangeOpen} onOpenChange={setArrangeOpen} />

      <div className="tabs-scroller flex gap-1 overflow-x-auto pb-1">
        {TABS.map((tab) => (
          <Button
            key={tab}
            size="sm"
            variant={status === tab ? "secondary" : "ghost"}
            className="shrink-0"
            onClick={() => {
              setStatus(tab);
              setPage(0);
            }}
          >
            {t(`adminEventMeetings.list.tabs.${tab}`)}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          className="max-w-xs"
          placeholder={t("adminEventMeetings.list.searchPlaceholder")}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
        />
        <Select
          value={tableId}
          onValueChange={(value) => {
            setTableId(value);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-[14rem]">
            <SelectValue placeholder={t("adminEventMeetings.list.tableFilter")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("adminEventMeetings.list.tableFilterAll")}</SelectItem>
            {(tablesQ.data ?? []).map((table) => (
              <SelectItem key={table.id} value={table.id}>
                {table.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filtered ? (
          <Button size="sm" variant="ghost" onClick={resetFilters}>
            {t("adminEventMeetings.list.clearFilters")}
          </Button>
        ) : null}
      </div>

      <AdminCatalogListState
        isLoading={listQ.isLoading}
        loadingLabel={t("adminEventMeetings.list.loading")}
        errorMessage={listQ.error === null ? null : t(adminMeetingFailure(listQ.error).key)}
        isEmpty={rows.length === 0}
        emptyLabel={t(
          filtered ? "adminEventMeetings.list.emptyFiltered" : "adminEventMeetings.list.empty",
        )}
      >
        <ul className="divide-y divide-border rounded-lg border border-border/60">
          {rows.map((row) => (
            <li key={row.id} className="space-y-2 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {personLabel(
                      row.requester_first_name,
                      row.requester_last_name,
                      row.requester_company,
                    )}
                    {" → "}
                    {personLabel(
                      row.invitee_first_name,
                      row.invitee_last_name,
                      row.invitee_company,
                    )}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDateTime(row.starts_at, i18n.language)} ·{" "}
                    {row.table_label === null
                      ? t("adminEventMeetings.list.noTable")
                      : `${row.table_label} (${t("adminEventMeetings.list.seatLabel", {
                          seat: row.table_seat,
                        })})`}
                    {row.sponsor_name === null ? "" : ` · ${row.sponsor_name}`}
                  </p>
                  {row.topic === null ? null : (
                    <p className="mt-1 text-xs text-muted-foreground">{row.topic}</p>
                  )}
                </div>
                <Badge variant="outline" className="text-[11px]">
                  {t(`eventMeetings.statuses.${statusKey(row)}`)}
                </Badge>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => mark(row, "held")}>
                  <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {t("adminEventMeetings.list.markHeldAction")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => mark(row, "no_show")}>
                  <UserX className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {t("adminEventMeetings.list.markNoShowAction")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setCancelled(row);
                    setReason("");
                  }}
                >
                  <XCircle className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {t("adminEventMeetings.list.cancelAction")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </AdminCatalogListState>

      {total <= PAGE_SIZE ? null : (
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>
            {t("adminEventMeetings.list.showingRange", {
              from: page * PAGE_SIZE + 1,
              to: page * PAGE_SIZE + rows.length,
              total,
            })}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage((prev) => Math.max(prev - 1, 0))}
            >
              {"<"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={(page + 1) * PAGE_SIZE >= total}
              onClick={() => setPage((prev) => prev + 1)}
            >
              {">"}
            </Button>
          </div>
        </div>
      )}

      <AlertDialog
        open={cancelled !== null}
        onOpenChange={(next) => {
          if (!next) setCancelled(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("adminEventMeetings.list.cancelConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("adminEventMeetings.list.cancelConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="meeting-cancel-reason">
              {t("adminEventMeetings.list.cancelReasonLabel")}
            </Label>
            <Textarea
              id="meeting-cancel-reason"
              rows={3}
              value={reason}
              placeholder={t("adminEventMeetings.list.cancelReasonPlaceholder")}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("adminEventMeetings.tables.cancelAction")}</AlertDialogCancel>
            <Button variant="destructive" onClick={confirmCancel}>
              {t("adminEventMeetings.list.cancelAction")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
