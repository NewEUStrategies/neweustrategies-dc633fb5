// Organizm: lista wykluczeń z filtrami, dodawaniem, zdejmowaniem blokady
// i eksportem CSV.
//
// Layout zgodny z SubscribersPanel (ta sama siatka filtrów, ta sama tabela),
// bo operator przechodzi między tymi ekranami w kółko - różny układ dla tej
// samej czynności kosztowałby go za każdym razem sekundę zastanowienia.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Download, Plus, RotateCcw, Search, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { SuppressionReasonBadge } from "@/components/atoms/SuppressionReasonBadge";
import {
  addSuppression,
  listSuppressions,
  releaseSuppression,
  type SuppressionRow,
} from "@/lib/newsletter-deliverability.functions";
import type { SuppressionReason } from "@/lib/email/suppressionPolicy";
import {
  canAddSuppression,
  filterSuppressions,
  isSuppressionListCapped,
  normalizeSuppressionEmail,
  suppressionCsvFileName,
  suppressionsToCsv,
  SUPPRESSION_LIST_LIMIT,
} from "./suppressionTable";
import "@/lib/i18n-newsletter-deliverability";

const REASONS: readonly SuppressionReason[] = [
  "hard_bounce",
  "soft_bounce",
  "complaint",
  "manual",
  "unsubscribe",
  "invalid",
  "blocked",
];

/** Ręcznie da się dodać tylko blokadę, której nie da się wywnioskować z webhooka. */
const MANUAL_REASONS = ["manual", "blocked", "complaint", "hard_bounce", "invalid"] as const;
type ManualReason = (typeof MANUAL_REASONS)[number];

type StateFilter = "active" | "released" | "all";

interface SuppressionTableProps {
  locale: string;
}

export function SuppressionTable({ locale }: SuppressionTableProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const list = useServerFn(listSuppressions);
  const add = useServerFn(addSuppression);
  const release = useServerFn(releaseSuppression);

  const [search, setSearch] = useState("");
  const [reason, setReason] = useState<"all" | SuppressionReason>("all");
  const [state, setState] = useState<StateFilter>("active");
  const [newEmail, setNewEmail] = useState("");
  const [newReason, setNewReason] = useState<ManualReason>("manual");
  const [pendingRelease, setPendingRelease] = useState<SuppressionRow | null>(null);
  const [resubscribe, setResubscribe] = useState(false);

  const query = useQuery({
    queryKey: ["email-suppressions", reason, state],
    queryFn: () => list({ data: { search: "", reason, state, limit: SUPPRESSION_LIST_LIMIT } }),
  });

  // Filtr tekstowy działa lokalnie na pobranej paczce - reakcja jest
  // natychmiastowa, a serwer nie dostaje zapytania na każde naciśnięcie klawisza.
  const rows = useMemo(() => filterSuppressions(query.data ?? [], search), [query.data, search]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["email-suppressions"] });
    qc.invalidateQueries({ queryKey: ["deliverability-metrics"] });
  };

  const addMutation = useMutation({
    mutationFn: (input: { email: string; reason: ManualReason }) =>
      add({ data: { email: input.email, reason: input.reason } }),
    onSuccess: () => {
      toast.success(t("adminDeliverability.list.added"));
      setNewEmail("");
      invalidate();
    },
    onError: () => toast.error(t("adminDeliverability.list.addError")),
  });

  const releaseMutation = useMutation({
    mutationFn: (input: { id: string; resubscribe: boolean }) => release({ data: input }),
    onSuccess: () => {
      toast.success(t("adminDeliverability.list.released"));
      setPendingRelease(null);
      setResubscribe(false);
      invalidate();
    },
    onError: () => toast.error(t("adminDeliverability.list.releaseError")),
  });

  const exportCsv = () => {
    const blob = new Blob([suppressionsToCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = suppressionCsvFileName(new Date().toISOString());
    a.click();
    URL.revokeObjectURL(url);
  };

  const submitAdd = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canAddSuppression(newEmail)) return;
    addMutation.mutate({ email: normalizeSuppressionEmail(newEmail), reason: newReason });
  };

  return (
    <section className="space-y-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-display text-lg">
            {t("adminDeliverability.list.title", { count: rows.length })}
          </h3>
          <p className="text-sm text-muted-foreground max-w-2xl">
            {t("adminDeliverability.list.subtitle")}
          </p>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={!rows.length}>
          <Download className="w-4 h-4 mr-2" />
          {t("adminDeliverability.list.exportCsv")}
        </Button>
      </header>

      <form
        onSubmit={submitAdd}
        className="grid grid-cols-1 sm:grid-cols-[1fr_180px_auto] gap-2 rounded-xl border border-border bg-card p-3"
      >
        <Input
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          placeholder={t("adminDeliverability.list.addPlaceholder")}
          aria-label={t("adminDeliverability.list.addTitle")}
        />
        <Select value={newReason} onValueChange={(v) => setNewReason(v as ManualReason)}>
          <SelectTrigger aria-label={t("adminDeliverability.list.addTitle")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MANUAL_REASONS.map((r) => (
              <SelectItem key={r} value={r}>
                {t(`adminDeliverability.reason.${r}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" disabled={addMutation.isPending || !newEmail.trim()}>
          <Plus className="w-4 h-4 mr-2" />
          {t("adminDeliverability.list.addAction")}
        </Button>
      </form>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_180px_180px] gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("adminDeliverability.list.searchPlaceholder")}
            className="icon-input"
          />
        </div>
        <Select value={reason} onValueChange={(v) => setReason(v as typeof reason)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("adminDeliverability.list.allReasons")}</SelectItem>
            {REASONS.map((r) => (
              <SelectItem key={r} value={r}>
                {t(`adminDeliverability.reason.${r}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={state} onValueChange={(v) => setState(v as StateFilter)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">{t("adminDeliverability.list.stateActive")}</SelectItem>
            <SelectItem value="released">{t("adminDeliverability.list.stateReleased")}</SelectItem>
            <SelectItem value="all">{t("adminDeliverability.list.stateAll")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isSuppressionListCapped(query.data?.length ?? 0) && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          {t("adminDeliverability.list.capWarning", {
            count: SUPPRESSION_LIST_LIMIT.toLocaleString(locale),
          })}
        </div>
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b border-border bg-muted/40">
              <tr>
                <th className="text-left p-3">{t("adminDeliverability.list.colEmail")}</th>
                <th className="text-left p-3">{t("adminDeliverability.list.colReason")}</th>
                <th className="text-left p-3 hidden md:table-cell">
                  {t("adminDeliverability.list.colSource")}
                </th>
                <th className="text-right p-3 hidden sm:table-cell">
                  {t("adminDeliverability.list.colOccurrences")}
                </th>
                <th className="text-left p-3 hidden lg:table-cell">
                  {t("adminDeliverability.list.colLastSeen")}
                </th>
                <th className="text-left p-3 hidden lg:table-cell">
                  {t("adminDeliverability.list.colExpires")}
                </th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {query.isLoading && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-muted-foreground">
                    {t("adminDeliverability.list.loading")}
                  </td>
                </tr>
              )}
              {!query.isLoading && !rows.length && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    {t("adminDeliverability.list.empty")}
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-border/60 hover:bg-muted/30 last:border-0"
                >
                  <td className="p-3 font-mono text-xs break-all">
                    {row.email}
                    {row.diagnostic && (
                      <div className="text-[11px] text-muted-foreground font-sans line-clamp-1">
                        {row.diagnostic}
                      </div>
                    )}
                  </td>
                  <td className="p-3">
                    <SuppressionReasonBadge reason={row.reason} scope={row.scope} />
                  </td>
                  <td className="p-3 text-xs text-muted-foreground hidden md:table-cell">
                    {row.source}
                  </td>
                  <td className="p-3 text-xs text-right tabular-nums hidden sm:table-cell">
                    {row.occurrences}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground whitespace-nowrap hidden lg:table-cell">
                    {row.lastSeenAt ? new Date(row.lastSeenAt).toLocaleDateString(locale) : "-"}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground whitespace-nowrap hidden lg:table-cell">
                    {row.expiresAt
                      ? new Date(row.expiresAt).toLocaleDateString(locale)
                      : t("adminDeliverability.list.never")}
                  </td>
                  <td className="p-3 text-right">
                    {row.releasedAt ? (
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                        {new Date(row.releasedAt).toLocaleDateString(locale)}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setPendingRelease(row);
                          setResubscribe(false);
                        }}
                        className="text-muted-foreground hover:bg-muted p-1.5 rounded"
                        aria-label={t("adminDeliverability.list.releaseAction")}
                        title={t("adminDeliverability.list.releaseAction")}
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <AlertDialog
        open={pendingRelease !== null}
        onOpenChange={(open) => !open && setPendingRelease(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldOff className="w-4 h-4" />
              {t("adminDeliverability.list.releaseTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("adminDeliverability.list.releaseBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingRelease && (
            <div className="space-y-3">
              <code className="block rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs break-all">
                {pendingRelease.email}
              </code>
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={resubscribe}
                  onCheckedChange={(v) => setResubscribe(v === true)}
                  className="mt-0.5"
                />
                <span>{t("adminDeliverability.list.releaseResubscribe")}</span>
              </label>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>{t("adminDeliverability.list.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingRelease) {
                  releaseMutation.mutate({ id: pendingRelease.id, resubscribe });
                }
              }}
              disabled={releaseMutation.isPending}
            >
              {t("adminDeliverability.list.releaseConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
