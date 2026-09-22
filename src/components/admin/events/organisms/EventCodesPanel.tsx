// Organizm: kody rejestracyjne wydarzenia (Swapcard „Registration codes").
// Lista + okno tworzenia/edycji. Rabat liczy baza i kasa Stripe - panel
// zapisuje tylko definicję kodu.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { normalizeCouponCode } from "@/lib/billing/coupons";
import { browserPublicOrigin } from "@/lib/http/host";
import { fetchEventTickets } from "@/lib/events/registrationsApi";
import {
  emptyEventCodeDraft,
  eventCodeDraftIssue,
  eventCodeRegistrationUrl,
  eventCodeRowToDraft,
  eventCodeStatus,
  useDeleteEventCode,
  useEventCodes,
  useSaveEventCode,
  useToggleEventCode,
  type EventCodeDraft,
  type EventCodeRow,
} from "@/lib/events/eventCodesApi";
import "@/lib/i18n-admin-event-codes";

interface Props {
  eventId: string;
  eventSlug: string;
}

function fmtDate(iso: string | null, lang: string): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString(lang === "en" ? "en-GB" : "pl-PL", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(done);
  } catch {
    toast.error(text);
  }
}

export function EventCodesPanel({ eventId, eventSlug }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("en") ? "en" : "pl";
  const codesQ = useEventCodes(eventId);
  const ticketsQ = useQuery({
    queryKey: ["admin", "event-tickets-for-codes", eventId],
    queryFn: () => fetchEventTickets(eventId),
  });
  const toggle = useToggleEventCode(eventId);
  const del = useDeleteEventCode(eventId);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{ row: EventCodeRow | null } | null>(null);

  const rows = useMemo(() => {
    const q = search.trim().toUpperCase();
    return (codesQ.data ?? []).filter(
      (r) => q === "" || r.code.includes(q) || (r.name ?? "").toUpperCase().includes(q),
    );
  }, [codesQ.data, search]);

  const effect = (r: EventCodeRow): string => {
    const parts: string[] = [];
    if (r.appliesDiscount) {
      parts.push(
        r.discountKind === "percent"
          ? `-${r.discountPercent ?? 0}%`
          : `-${((r.discountCents ?? 0) / 100).toFixed(2)} ${r.currency ?? ""}`.trim(),
      );
    }
    if (r.revealsHidden) parts.push(t("eventCodes.effect.reveal"));
    parts.push(
      r.ticketTypeIds.length > 0
        ? t("eventCodes.effect.specific", { count: r.ticketTypeIds.length })
        : t("eventCodes.effect.all"),
    );
    return parts.join(" · ");
  };

  return (
    <section className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">{t("eventCodes.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("eventCodes.lead")}</p>
        </div>
        <Button type="button" onClick={() => setEditing({ row: null })}>
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          {t("eventCodes.create")}
        </Button>
      </header>
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("eventCodes.search")}
        aria-label={t("eventCodes.search")}
        className="max-w-xs"
      />
      {rows.length === 0 ? (
        <p className="rounded-[6px] border border-border bg-muted/30 p-6 text-sm text-muted-foreground">
          {t("eventCodes.empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[6px] border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                {(
                  [
                    "code",
                    "status",
                    "effect",
                    "uses",
                    "validFrom",
                    "validUntil",
                    "actions",
                  ] as const
                ).map((c) => (
                  <th key={c} className="px-3 py-2 font-semibold">
                    {t(`eventCodes.cols.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const url = eventCodeRegistrationUrl(browserPublicOrigin(), eventSlug, r.code);
                return (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <span className="font-mono font-semibold">{r.code}</span>
                      {r.name && (
                        <span className="block text-xs text-muted-foreground">{r.name}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline">
                        {t(`eventCodes.status.${eventCodeStatus(r)}`)}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">{effect(r)}</td>
                    <td className="px-3 py-2">
                      {r.redemptionsCount}/{r.maxRedemptions ?? "∞"}
                    </td>
                    <td className="px-3 py-2">{fmtDate(r.validFrom, lang)}</td>
                    <td className="px-3 py-2">{fmtDate(r.validUntil, lang)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <Switch
                          checked={r.active}
                          aria-label={
                            r.active
                              ? t("eventCodes.actions.deactivate")
                              : t("eventCodes.actions.activate")
                          }
                          onCheckedChange={(active) => toggle.mutate({ id: r.id, active })}
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t("eventCodes.edit")}
                          onClick={() => setEditing({ row: r })}
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t("eventCodes.actions.copyUrl")}
                          onClick={() => void copy(url, t("eventCodes.toasts.copied"))}
                        >
                          <Copy className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t("eventCodes.actions.delete")}
                          onClick={() =>
                            del.mutate(r.id, {
                              onSuccess: () => toast.success(t("eventCodes.toasts.deleted")),
                              onError: () => toast.error(t("eventCodes.toasts.error")),
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing !== null && (
        <EventCodeDialog
          eventId={eventId}
          eventSlug={eventSlug}
          row={editing.row}
          tickets={(ticketsQ.data ?? []).map((tk) => ({
            id: tk.id,
            name: lang === "en" ? tk.name_en || tk.name_pl : tk.name_pl || tk.name_en,
            currency: tk.currency,
          }))}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

interface DialogProps {
  eventId: string;
  eventSlug: string;
  row: EventCodeRow | null;
  tickets: { id: string; name: string; currency: string }[];
  onClose: () => void;
}

function EventCodeDialog({ eventId, eventSlug, row, tickets, onClose }: DialogProps) {
  const { t } = useTranslation();
  const save = useSaveEventCode(eventId);
  const [d, setD] = useState<EventCodeDraft>(() =>
    row ? eventCodeRowToDraft(row) : emptyEventCodeDraft(tickets[0]?.currency ?? "PLN"),
  );
  const [issue, setIssue] = useState<string | null>(null);
  const set = <K extends keyof EventCodeDraft>(k: K, v: EventCodeDraft[K]) =>
    setD((prev) => ({ ...prev, [k]: v }));

  const submit = () => {
    const problem = eventCodeDraftIssue(d);
    if (problem !== null) {
      setIssue(t(`eventCodes.issues.${problem}`));
      return;
    }
    setIssue(null);
    save.mutate(
      { id: row?.id ?? null, draft: d },
      {
        onSuccess: () => {
          toast.success(t("eventCodes.toasts.saved"));
          onClose();
        },
        onError: () => toast.error(t("eventCodes.toasts.error")),
      },
    );
  };

  const url = eventCodeRegistrationUrl(
    browserPublicOrigin(),
    eventSlug,
    normalizeCouponCode(d.code),
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{row ? t("eventCodes.edit") : t("eventCodes.create")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ec-code">{t("eventCodes.form.code")}</Label>
              <Input
                id="ec-code"
                value={d.code}
                maxLength={64}
                onChange={(e) => set("code", normalizeCouponCode(e.target.value))}
                className="font-mono uppercase"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ec-name">{t("eventCodes.form.name")}</Label>
              <Input id="ec-name" value={d.name} onChange={(e) => set("name", e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ec-desc">{t("eventCodes.form.description")}</Label>
            <Textarea
              id="ec-desc"
              rows={2}
              value={d.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="ec-from">{t("eventCodes.form.validFrom")}</Label>
              <Input
                id="ec-from"
                type="datetime-local"
                value={d.validFrom}
                onChange={(e) => set("validFrom", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ec-until">{t("eventCodes.form.validUntil")}</Label>
              <Input
                id="ec-until"
                type="datetime-local"
                value={d.validUntil}
                onChange={(e) => set("validUntil", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ec-qty">{t("eventCodes.form.quantity")}</Label>
              <Input
                id="ec-qty"
                inputMode="numeric"
                value={d.quantity}
                onChange={(e) => set("quantity", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("eventCodes.form.quantityHint")}</p>
            </div>
          </div>

          <div className="space-y-3 rounded-[6px] border border-border p-3">
            <label className="flex items-center justify-between gap-3 text-sm font-medium">
              {t("eventCodes.form.applyDiscount")}
              <Switch
                checked={d.appliesDiscount}
                onCheckedChange={(v) => set("appliesDiscount", v)}
              />
            </label>
            {d.appliesDiscount && (
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex gap-1 sm:col-span-3">
                  {(["percent", "fixed"] as const).map((k) => (
                    <Button
                      key={k}
                      type="button"
                      size="sm"
                      variant={d.discountKind === k ? "default" : "outline"}
                      onClick={() => set("discountKind", k)}
                    >
                      {k === "percent"
                        ? t("eventCodes.form.percentOff")
                        : t("eventCodes.form.amountOff")}
                    </Button>
                  ))}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ec-amount">{t("eventCodes.form.amount")}</Label>
                  <Input
                    id="ec-amount"
                    inputMode="decimal"
                    value={d.amount}
                    onChange={(e) => set("amount", e.target.value)}
                  />
                </div>
                {d.discountKind === "fixed" && (
                  <div className="space-y-1">
                    <Label htmlFor="ec-cur">{t("eventCodes.form.currency")}</Label>
                    <Input
                      id="ec-cur"
                      maxLength={3}
                      value={d.currency}
                      onChange={(e) => set("currency", e.target.value.toUpperCase())}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-1 rounded-[6px] border border-border p-3">
            <label className="flex items-center justify-between gap-3 text-sm font-medium">
              {t("eventCodes.form.revealHidden")}
              <Switch checked={d.revealsHidden} onCheckedChange={(v) => set("revealsHidden", v)} />
            </label>
            <p className="text-xs text-muted-foreground">{t("eventCodes.form.revealHint")}</p>
          </div>

          <div className="space-y-2 rounded-[6px] border border-border p-3">
            <p className="text-sm font-medium">{t("eventCodes.form.tickets")}</p>
            <div className="flex gap-1">
              {(["all", "specific"] as const).map((s) => (
                <Button
                  key={s}
                  type="button"
                  size="sm"
                  variant={d.ticketScope === s ? "default" : "outline"}
                  onClick={() => set("ticketScope", s)}
                >
                  {s === "all"
                    ? t("eventCodes.form.allTickets")
                    : t("eventCodes.form.specificTickets")}
                </Button>
              ))}
            </div>
            {d.ticketScope === "specific" && (
              <ul className="space-y-1">
                {tickets.map((tk) => (
                  <li key={tk.id}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={d.ticketTypeIds.includes(tk.id)}
                        onChange={(e) =>
                          set(
                            "ticketTypeIds",
                            e.target.checked
                              ? [...d.ticketTypeIds, tk.id]
                              : d.ticketTypeIds.filter((x) => x !== tk.id),
                          )
                        }
                      />
                      {tk.name}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {d.code && (
            <div className="space-y-1">
              <Label>{t("eventCodes.form.registrationUrl")}</Label>
              <div className="flex gap-2">
                <Input readOnly value={url} className="font-mono text-xs" />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void copy(url, t("eventCodes.toasts.copied"))}
                >
                  {t("eventCodes.form.copy")}
                </Button>
              </div>
            </div>
          )}
          {issue && (
            <p role="alert" className="text-sm text-destructive">
              {issue}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("eventCodes.form.cancel")}
          </Button>
          <Button type="button" disabled={save.isPending} onClick={submit}>
            {t("eventCodes.form.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
