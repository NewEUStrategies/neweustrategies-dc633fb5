// Zamówienia biletowe na płatne wydarzenia: cena, status u operatora, liczba
// biletów i oś czasu zmian (własne znaczniki + zdarzenia webhooka).
// Odczyt wyłącznie przez server fn z RLS admina - patrz ticketOrders.server.ts.
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Loader2, Ticket } from "lucide-react";

import { getTicketOrderHistory, listTicketOrders } from "@/lib/billing/ticketOrders.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { uiLocale } from "@/lib/i18n/format";

const STATUS_TONE: Record<string, string> = {
  paid: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  processed: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  pending: "bg-amber-500/14 text-amber-700 dark:text-amber-300",
  processing: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  received: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  refunded: "bg-muted text-muted-foreground",
  canceled: "bg-muted text-muted-foreground",
  skipped: "bg-muted text-muted-foreground",
  failed: "bg-destructive/10 text-destructive",
};

function StatusBadge({ value }: { value: string }) {
  return (
    <Badge
      variant="outline"
      className={`border-0 text-[0.75rem] ${STATUS_TONE[value] ?? "bg-muted text-muted-foreground"}`}
    >
      {value}
    </Badge>
  );
}

function OrderHistory({ orderId, lang }: { orderId: string; lang: "pl" | "en" }) {
  const load = useServerFn(getTicketOrderHistory);
  const q = useQuery({
    queryKey: ["admin", "ticket-orders", "history", orderId],
    queryFn: () => load({ data: { orderId } }),
    staleTime: 30_000,
  });
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const labelFor = (kind: string, label: string) =>
    kind === "order_created"
      ? L("Zamówienie utworzone", "Order created")
      : kind === "order_paid"
        ? L("Płatność zaksięgowana", "Payment settled")
        : label;

  if (q.isLoading) {
    return (
      <p className="flex items-center gap-2 px-4 py-3 text-[0.8125rem] text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        {L("Wczytuję historię...", "Loading history...")}
      </p>
    );
  }
  if (q.isError) {
    return (
      <p className="px-4 py-3 text-[0.8125rem] text-destructive">
        {L("Nie udało się wczytać historii.", "Could not load the history.")}
      </p>
    );
  }
  const entries = q.data ?? [];
  if (entries.length === 0) {
    return (
      <p className="px-4 py-3 text-[0.8125rem] text-muted-foreground">
        {L("Brak zapisanych zmian.", "No recorded changes.")}
      </p>
    );
  }

  return (
    <ol className="space-y-2 px-4 py-3">
      {entries.map((entry) => (
        <li key={entry.id} className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
          <span className="tabular-nums text-muted-foreground">
            {new Date(entry.at).toLocaleString(uiLocale(lang))}
          </span>
          <span className="font-medium">{labelFor(entry.kind, entry.label)}</span>
          {entry.status && <StatusBadge value={entry.status} />}
          {entry.environment === "sandbox" && (
            <Badge
              variant="outline"
              className="border-0 bg-muted text-[0.7rem] text-muted-foreground"
            >
              test
            </Badge>
          )}
          {entry.error && <span className="text-destructive">{entry.error}</span>}
        </li>
      ))}
    </ol>
  );
}

export function AdminTicketOrdersPanel() {
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useServerFn(listTicketOrders);
  const ordersQ = useQuery({
    queryKey: ["admin", "ticket-orders", "list"],
    queryFn: () => load({ data: { limit: 200 } }),
    staleTime: 30_000,
  });

  const rows = useMemo(() => ordersQ.data ?? [], [ordersQ.data]);
  const stats = useMemo(() => {
    const paid = rows.filter((r) => r.status === "paid");
    return {
      paidCount: paid.length,
      tickets: paid.reduce((sum, r) => sum + r.tickets, 0),
      pending: rows.filter((r) => r.status === "pending").length,
    };
  }, [rows]);

  const money = (cents: number, currency: string) =>
    new Intl.NumberFormat(uiLocale(lang), {
      style: "currency",
      currency,
    }).format(cents / 100);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-[0.8125rem] font-medium text-muted-foreground">
          <Ticket className="h-4 w-4" aria-hidden="true" />
          {L("Zamówienia biletowe", "Ticket orders")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[0.8125rem] text-muted-foreground">
          {L(
            `Opłacone: ${stats.paidCount} · biletów: ${stats.tickets} · oczekujące: ${stats.pending}`,
            `Paid: ${stats.paidCount} · tickets: ${stats.tickets} · pending: ${stats.pending}`,
          )}
        </p>

        {ordersQ.isLoading && (
          <p className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            {L("Wczytuję zamówienia...", "Loading orders...")}
          </p>
        )}
        {ordersQ.isError && (
          <p className="text-[0.8125rem] text-destructive">
            {L("Nie udało się wczytać zamówień.", "Could not load the orders.")}
          </p>
        )}
        {!ordersQ.isLoading && rows.length === 0 && (
          <p className="text-[0.8125rem] text-muted-foreground">
            {L("Brak zamówień biletowych.", "No ticket orders yet.")}
          </p>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-border/60">
            <table className="w-full text-left text-[0.8125rem]">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="w-8 px-2 py-2" aria-label={L("Historia", "History")} />
                  <th className="px-3 py-2 font-medium">{L("Wydarzenie", "Event")}</th>
                  <th className="px-3 py-2 font-medium">{L("Kupujący", "Buyer")}</th>
                  <th className="px-3 py-2 font-medium">{L("Bilety", "Tickets")}</th>
                  <th className="px-3 py-2 font-medium">{L("Cena", "Price")}</th>
                  <th className="px-3 py-2 font-medium">{L("Status", "Status")}</th>
                  <th className="px-3 py-2 font-medium">{L("Data", "Date")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const open = openId === row.id;
                  const title =
                    (lang === "en"
                      ? row.eventTitleEn || row.eventTitlePl
                      : row.eventTitlePl || row.eventTitleEn) ?? row.eventId;
                  return (
                    <Fragment key={row.id}>
                      <tr className="border-t border-border/60 align-top">
                        <td className="px-2 py-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            aria-expanded={open}
                            aria-label={L("Pokaż historię zmian", "Show change history")}
                            onClick={() => setOpenId(open ? null : row.id)}
                          >
                            {open ? (
                              <ChevronDown className="h-4 w-4" aria-hidden="true" />
                            ) : (
                              <ChevronRight className="h-4 w-4" aria-hidden="true" />
                            )}
                          </Button>
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-medium">{title}</span>
                          {row.eventStartsAt && (
                            <span className="block text-xs text-muted-foreground">
                              {new Date(row.eventStartsAt).toLocaleString(uiLocale(lang))}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {row.buyerAnonymized ? (
                            // Konto usunięte (RODO): zamówienie zostało jako dowód
                            // księgowy, danych kupującego już nie ma i nie wróci.
                            <span className="italic text-muted-foreground">
                              {L("Konto usunięte", "Account deleted")}
                            </span>
                          ) : (
                            <>
                              <span>{row.buyerName ?? row.buyerEmail ?? row.buyerId}</span>
                              {row.buyerName && row.buyerEmail && (
                                <span className="block text-xs text-muted-foreground">
                                  {row.buyerEmail}
                                </span>
                              )}
                            </>
                          )}
                        </td>
                        <td className="px-3 py-2 tabular-nums">{row.tickets}</td>
                        <td className="px-3 py-2 tabular-nums">
                          {money(row.amountCents, row.currency)}
                          {row.couponCode && (
                            <span className="block text-xs text-muted-foreground">
                              {row.couponCode}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge value={row.status} />
                          {row.transactionId && (
                            <span className="mt-1 block truncate font-mono text-[0.7rem] text-muted-foreground">
                              {row.transactionId}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">
                          {new Date(row.paidAt ?? row.createdAt).toLocaleString(uiLocale(lang))}
                        </td>
                      </tr>
                      {open && (
                        <tr className="border-t border-border/40 bg-muted/20">
                          <td colSpan={7}>
                            <OrderHistory orderId={row.id} lang={lang} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
