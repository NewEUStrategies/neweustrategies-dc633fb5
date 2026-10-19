// Karta panelu rozliczeń: przeniesienie TRWAJĄCYCH subskrypcji Członka,
// Członka Pro i Zespołu na niższą cenę v6.2 od najbliższego odnowienia
// (`subscriptionRepricing.functions.ts`).
//
// Logika jest w całości serwerowa i stoi za `requireAdmin` (z MFA); karta
// przechodzi przebieg partiami (kursor z poprzedniej odpowiedzi) i skleja
// wynik. Kolejność jest wymuszona interfejsem, nie dobrą wolą admina:
//   1. „Przelicz podgląd" - niczego nie zapisuje,
//   2. „Wykonaj" odblokowuje się dopiero po PEŁNYM podglądzie (ostatnia
//      partia), bez rozjazdów cennika i z co najmniej jedną subskrypcją do
//      przeniesienia,
//   3. wykonanie wymaga przepisania frazy `REPRICING_CONFIRM` - tę samą
//      sprawdza serwer, więc pole nie jest dekoracją.
// Wynik odświeża się po KAŻDEJ partii: przerwany przebieg (sieć, odmowa)
// zostawia widoczny stan i kursor do kontynuacji, a ponowne „Wykonaj" jest
// bezpieczne (idempotencja po stronie serwera).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { BadgePercent } from "lucide-react";

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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { billingKeys } from "@/lib/billing/keys";
import {
  mergeRepricingPages,
  REPRICING_CONFIRM,
  type RepricingMode,
  type RepricingRow,
  type RepricingRun,
} from "@/lib/billing/subscriptionRepricing";
import {
  listSubscriptionRepricingLog,
  runSubscriptionRepricing,
} from "@/lib/billing/subscriptionRepricing.functions";
import { formatMoney } from "@/lib/billing/types";
import { formatDateShort } from "@/lib/i18n/format";
import { ensureAdminRepricingI18n } from "@/lib/i18n-admin-repricing";

/** Partie przechodzone jednym kliknięciem (podgląd po 50, wykonanie po 20). */
export const REPRICING_PAGES_PER_RUN = 40;
/** Tyle pozycji pokazuje tabela - sumy obejmują wszystkie. */
const MAX_VISIBLE_ROWS = 200;

interface RunInput {
  mode: RepricingMode;
  cursor: string | null;
  previous: RepricingRun | null;
}

/** Odmowa serwera zwrócona wartością (nie wyjątkiem) - kod do tłumaczenia. */
class RepricingRefusal extends Error {
  constructor(
    readonly code: string,
    readonly problems: string[] = [],
  ) {
    super(code);
  }
}

export function SubscriptionRepricingCard() {
  ensureAdminRepricingI18n();
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const run = useServerFn(runSubscriptionRepricing);
  const loadLog = useServerFn(listSubscriptionRepricingLog);
  const qc = useQueryClient();
  const [result, setResult] = useState<RepricingRun | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [logOpen, setLogOpen] = useState(false);

  const runM = useMutation({
    mutationFn: async ({ mode, cursor, previous }: RunInput) => {
      let acc = previous;
      let next = cursor;
      for (let page = 0; page < REPRICING_PAGES_PER_RUN; page += 1) {
        const response = await run({
          data:
            mode === "execute"
              ? { mode, cursor: next, confirm: REPRICING_CONFIRM }
              : { mode, cursor: next },
        });
        if (!response.ok) {
          throw new RepricingRefusal(
            response.error,
            "problems" in response ? response.problems : [],
          );
        }
        acc = mergeRepricingPages(acc, response);
        setResult(acc);
        if (response.done || !response.nextCursor) break;
        next = response.nextCursor;
      }
      return acc;
    },
    // Dziennik ma `staleTime` 30 s, a przebieg (także przerwany albo
    // odrzucony w połowie) zapisuje w nim wpisy - bez unieważnienia rozwinięty
    // dziennik dalej mówił „pusty" po wykonaniu, które weszło u operatora.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: billingKeys.admin.subscriptionRepricingLog() });
    },
  });

  const logQ = useQuery({
    queryKey: billingKeys.admin.subscriptionRepricingLog(),
    queryFn: () => loadLog({ data: {} }),
    enabled: logOpen,
    staleTime: 30_000,
  });

  const start = (mode: RepricingMode) => {
    setResult(null);
    runM.mutate({ mode, cursor: null, previous: null });
  };

  const error = runM.error;
  const refusal = error instanceof RepricingRefusal ? error : null;
  const message = error instanceof Error ? error.message : null;
  const errorText = !error
    ? null
    : refusal?.code === "confirmation_required"
      ? t("adminRepricing.confirmationRequired")
      : refusal?.code === "environment_not_allowed"
        ? t("adminRepricing.environmentNotAllowed")
        : refusal?.code === "preconditions_failed"
          ? null
          : message?.includes("mfa_required")
            ? t("adminBilling.mfaStepUpRequired")
            : t("adminRepricing.failed", { message: message ?? "" });
  const problems = refusal?.problems.length ? refusal.problems : (result?.problems ?? []);

  const previewComplete =
    result !== null && result.mode === "preview" && result.done && result.nextCursor === null;
  // „Do przeniesienia" to wyłącznie ruchy do zrobienia: przeniesione we
  // wcześniejszym przebiegu liczą się osobno (`already_applied`). Wykonanie
  // odblokowuje też mail do ponowienia przy już przeniesionej subskrypcji -
  // jedyna droga ponowienia po awarii kolejki (`finishApplied`).
  const toApply = result?.summary.count.apply ?? 0;
  const alreadyApplied = result?.summary.count.already_applied ?? 0;
  const emailRetry = result?.summary.emailRetry ?? 0;
  const canExecute =
    previewComplete && problems.length === 0 && (toApply > 0 || emailRetry > 0) && !runM.isPending;
  const unfinished = result !== null && !result.done && result.nextCursor !== null;
  const visible = result?.rows.slice(0, MAX_VISIBLE_ROWS) ?? [];

  const money = (cents: number | null, currency: string | null) =>
    cents === null || !currency ? "-" : formatMoney(cents, currency, lang);
  const pln = (cents: number) => formatMoney(cents, "PLN", lang);
  // Wspólny atom daty (strefa serwisu, Europe/Warsaw): ta sama data co
  // w mailu do klienta, niezależnie od strefy przeglądarki admina.
  const date = (iso: string | null) => (iso ? formatDateShort(iso, lang) || "-" : "-");

  /** Kod problemu z serwera (`target_price_mismatch:plus_monthly`) -> zdanie. */
  const problemText = (problem: string) => {
    const [code, key] = problem.split(":");
    return t(`adminRepricing.problems.${code}`, { key: key ?? "" });
  };

  /**
   * Kod powodu albo błędu z serwera (`already_current`, `provider_error`,
   * `in_progress`...) -> zdanie ze słownika. Kod spoza słownika nie wychodzi
   * na ekran jako surowy klucz: dostaje ogólne zdanie z kodem w nawiasie.
   */
  const codeText = (code: string) =>
    t(`adminRepricing.reasons.${code}`, {
      defaultValue: t("adminRepricing.reasons.unknown", { code }),
    });

  const decisionLabel = (row: RepricingRow) =>
    row.action === "apply" || !row.reason
      ? t(`adminRepricing.outcomes.${row.outcome}`)
      : `${t(`adminRepricing.outcomes.${row.outcome}`)} · ${codeText(row.reason)}`;

  return (
    <Card className="rounded-[6px]">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-[0.9375rem]">
          <BadgePercent className="h-4 w-4" aria-hidden="true" />
          {t("adminRepricing.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0 text-[0.8125rem]">
        <p className="text-muted-foreground">{t("adminRepricing.lead")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="rounded-[6px]"
            disabled={runM.isPending}
            onClick={() => start("preview")}
          >
            {t("adminRepricing.preview")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-[6px]"
            disabled={!canExecute}
            onClick={() => {
              setPhrase("");
              setConfirmOpen(true);
            }}
          >
            {t("adminRepricing.execute")}
          </Button>
          {unfinished && result ? (
            <Button
              variant="ghost"
              size="sm"
              className="rounded-[6px]"
              disabled={runM.isPending}
              onClick={() =>
                runM.mutate({ mode: result.mode, cursor: result.nextCursor, previous: result })
              }
            >
              {t("adminRepricing.resume")}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="rounded-[6px]"
            onClick={() => setLogOpen((open) => !open)}
          >
            {logOpen ? t("adminRepricing.hideLog") : t("adminRepricing.showLog")}
          </Button>
          {runM.isPending ? (
            <span className="text-muted-foreground" role="status">
              {t("adminRepricing.running")}
            </span>
          ) : null}
        </div>
        {!canExecute && !runM.isPending ? (
          <p className="text-muted-foreground">{t("adminRepricing.executeHint")}</p>
        ) : null}

        {errorText ? <p className="text-destructive">{errorText}</p> : null}

        {problems.length > 0 ? (
          <div className="space-y-1 rounded-[6px] border border-destructive/40 p-3" role="alert">
            <p className="font-medium text-destructive">{t("adminRepricing.problemsTitle")}</p>
            <ul className="list-disc pl-5 text-muted-foreground">
              {problems.map((problem) => (
                <li key={problem}>{problemText(problem)}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {result ? (
          <div className="space-y-2">
            <p className="font-medium">{t("adminRepricing.summaryTitle")}</p>
            <p>
              {t("adminRepricing.summary", {
                total: result.summary.total,
                apply: toApply,
                before: pln(result.summary.mrrBefore),
                after: pln(result.summary.mrrAfter),
                delta: pln(result.summary.mrrDelta),
              })}
            </p>
            {alreadyApplied > 0 ? (
              <p>
                {t("adminRepricing.summaryAlreadyApplied", {
                  count: alreadyApplied,
                  retry: emailRetry,
                })}
              </p>
            ) : null}
            <p className="text-muted-foreground">{t("adminRepricing.mrrNote")}</p>
            {result.mode === "preview" ? (
              <p className="text-muted-foreground">{t("adminRepricing.simulated")}</p>
            ) : null}
            {unfinished ? (
              <p className="text-muted-foreground">{t("adminRepricing.unfinished")}</p>
            ) : null}
            {result.rows.length === 0 ? (
              <p className="text-muted-foreground">{t("adminRepricing.empty")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[0.8125rem]">
                  <thead className="border-b bg-muted/40 text-left text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">
                        {t("adminRepricing.columns.subscription")}
                      </th>
                      <th className="px-3 py-2 font-medium">{t("adminRepricing.columns.plan")}</th>
                      <th className="px-3 py-2 font-medium">{t("adminRepricing.columns.seats")}</th>
                      <th className="px-3 py-2 font-medium">
                        {t("adminRepricing.columns.current")}
                      </th>
                      <th className="px-3 py-2 font-medium">{t("adminRepricing.columns.next")}</th>
                      <th className="px-3 py-2 font-medium">
                        {t("adminRepricing.columns.mrrDelta")}
                      </th>
                      <th className="px-3 py-2 font-medium">
                        {t("adminRepricing.columns.effectiveAt")}
                      </th>
                      <th className="px-3 py-2 font-medium">
                        {t("adminRepricing.columns.decision")}
                      </th>
                      <th className="px-3 py-2 font-medium">{t("adminRepricing.columns.email")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row) => (
                      <tr key={row.subscriptionId} className="border-b last:border-0">
                        <td className="px-3 py-2 font-mono text-[0.75rem] text-muted-foreground">
                          {row.providerSubscriptionId}
                        </td>
                        <td className="px-3 py-2">{row.lookupKey ?? "-"}</td>
                        <td className="px-3 py-2">{row.quantity}</td>
                        <td className="px-3 py-2">{money(row.currentAmount, row.currency)}</td>
                        <td className="px-3 py-2">{money(row.newAmount, row.currency)}</td>
                        <td className="px-3 py-2">
                          {row.action === "apply" && row.currency
                            ? money(Math.round(row.newMrr - row.currentMrr), row.currency)
                            : "-"}
                        </td>
                        <td className="px-3 py-2">{date(row.effectiveAt)}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge
                              variant={row.outcome === "failed" ? "destructive" : "secondary"}
                              className="rounded-[6px]"
                            >
                              {decisionLabel(row)}
                            </Badge>
                            {row.error ? (
                              <span className="text-destructive">{codeText(row.error)}</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {row.emailStatus
                            ? t(`adminRepricing.emailStatuses.${row.emailStatus}`)
                            : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.rows.length > visible.length ? (
                  <p className="pt-2 text-muted-foreground">
                    {t("adminRepricing.rowsTruncated", {
                      shown: visible.length,
                      total: result.rows.length,
                    })}
                  </p>
                ) : null}
              </div>
            )}
          </div>
        ) : null}

        {logOpen ? (
          <div className="space-y-2">
            <p className="font-medium">{t("adminRepricing.logTitle")}</p>
            {logQ.isLoading ? (
              <div className="h-8 w-full animate-pulse rounded-[6px] bg-muted" />
            ) : (logQ.data ?? []).length === 0 ? (
              <p className="text-muted-foreground">{t("adminRepricing.logEmpty")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[0.8125rem]">
                  <thead className="border-b bg-muted/40 text-left text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">
                        {t("adminRepricing.logColumns.when")}
                      </th>
                      <th className="px-3 py-2 font-medium">
                        {t("adminRepricing.logColumns.subscription")}
                      </th>
                      <th className="px-3 py-2 font-medium">
                        {t("adminRepricing.logColumns.plan")}
                      </th>
                      <th className="px-3 py-2 font-medium">
                        {t("adminRepricing.logColumns.amounts")}
                      </th>
                      <th className="px-3 py-2 font-medium">
                        {t("adminRepricing.logColumns.status")}
                      </th>
                      <th className="px-3 py-2 font-medium">
                        {t("adminRepricing.logColumns.email")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(logQ.data ?? []).map((log) => (
                      <tr key={log.id} className="border-b last:border-0">
                        <td className="px-3 py-2">{date(log.updated_at)}</td>
                        <td className="px-3 py-2 font-mono text-[0.75rem] text-muted-foreground">
                          {log.provider_subscription_id}
                        </td>
                        <td className="px-3 py-2">
                          {log.lookup_key}
                          {log.quantity > 1 ? ` × ${log.quantity}` : ""}
                        </td>
                        <td className="px-3 py-2">
                          {money(log.from_amount_cents, log.currency)} →{" "}
                          {money(log.to_amount_cents, log.currency)}
                        </td>
                        <td className="px-3 py-2">
                          {t(`adminRepricing.logStatuses.${log.status}`)}
                          {log.reason ? (
                            <span className="text-muted-foreground"> · {codeText(log.reason)}</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {t(`adminRepricing.emailStatuses.${log.email_status}`)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("adminRepricing.confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("adminRepricing.confirmDescription", { phrase: REPRICING_CONFIRM })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="space-y-1 text-[0.8125rem]">
            <span className="text-muted-foreground">{t("adminRepricing.confirmLabel")}</span>
            <Input
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("adminRepricing.confirmCancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={phrase.trim() !== REPRICING_CONFIRM}
              onClick={() => {
                setConfirmOpen(false);
                start("execute");
              }}
            >
              {t("adminRepricing.confirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
