// Organizm: szkielet SZYBKIEJ NAPRAWY diagnozy (SPEC §6.4) - jeden dialog
// dla piętnastu napraw; treść z rejestru `lib/admin/revenue/quickFixes.ts`.
//
// PRZEPŁYW: wybór rozwiązania → podgląd „Przed → Po" (+ `SourceHeader`: ta
// sama zmiana pojawi się w module) → zapis WSPÓŁDZIELONYM mutatorem modułu →
// `refetchQueries(revenueKeys.facts(t))` → ponowna ocena TEJ reguły na
// świeżych faktach → komunikat w regionie `aria-live`: „✓ problem zniknął"
// albo „! zapisano, ale problem nadal występuje: <dowody>". Zmiana
// odwracalna dostaje „Cofnij" na 60 sekund. Rola bez prawa zapisu w module →
// „Zastosuj" wyłączone z powodem (`DisabledReason` = `Tooltip`).
//
// KONFLIKT (`40001` - wiersz zapisany w innej karcie, mutator dostał 0
// wierszy) pokazuje porównanie „Twoja zmiana / stan teraz" na ŚWIEŻYCH
// faktach i przycisk „Wczytaj aktualne". Nie `RevisionDiffDialog`: ten
// porównuje rewizje wpisów i stron (`getRevisionSnapshots`), a naprawy
// zmieniają wiersze planów, warstw i ustawień, które rewizji nie mają
// (odchylenie w raporcie S7, jak konflikt w Danych wejściowych S7.2).
//
// HAK APLIKATORA W PODKOMPONENCIE. `spec.apply.useApplier()` woła hooki
// mutatorów modułu; renderujemy go dopiero w treści OTWARTEGO dialogu
// (`FixPanel`), a klucz po identyfikatorze dialogu gwarantuje stałą kolejność
// hooków. Zamknięty dialog nie trzyma subskrypcji modułów.
import { Suspense, useEffect, useId, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { DisabledReason } from "@/components/admin/pricing/atoms/DisabledReason";
import { SourceHeader } from "@/components/admin/revenue/molecules/SourceHeader";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  canApplyQuickFix,
  quickFixFor,
  type FieldDiff,
  type QuickFixApplied,
  type QuickFixOption,
  type QuickFixRole,
  type QuickFixSpec,
  type QuickFixValue,
} from "@/lib/admin/revenue/quickFixes";
import { isStaleWriteError } from "@/lib/billing/planQueries";
import { ensureI18n } from "@/lib/i18n-admin-revenue-diagnostics";
import type { RevenueFactsRead } from "@/lib/revenue/diagnostics/diagnostics.functions";
import type { RevenueFacts } from "@/lib/revenue/diagnostics/facts";
import { revenueFactsQueryOptions } from "@/lib/revenue/diagnostics/queries";
import {
  revenueCheck,
  runCheck,
  type RevenueFinding,
  type RevenueFixDialogId,
} from "@/lib/revenue/diagnostics/registry";
import { revenueKeys } from "@/lib/revenue/keys";
import { cn } from "@/lib/utils";
import { checkTitle, evidenceSentence } from "./findingText";

/** Okno „Cofnij" po zapisie odwracalnym (SPEC §6.4). */
export const UNDO_WINDOW_MS = 60_000;

/** Powód wyłączonego „Zastosuj" per rola zapisu modułu. */
const ROLE_REASON_KEY: Readonly<Record<QuickFixRole, string>> = {
  admin: "adminRevenue.fix.roleAdmin",
  editor: "adminRevenue.fix.roleEditor",
  platform_admin: "adminRevenue.fix.rolePlatform",
};

type Outcome = "resolved" | "open" | "unknown";

type Phase =
  | { kind: "idle" }
  | { kind: "applying" }
  | { kind: "checking" }
  | { kind: "done"; outcome: Outcome; evidence: string }
  | { kind: "undone" }
  | { kind: "undoFailed" }
  | {
      kind: "conflict";
      option: QuickFixOption<unknown>;
      value: unknown;
      attempted: FieldDiff[];
      stillOpen: boolean;
    }
  | { kind: "failed" };

export interface QuickFixDialogProps {
  finding: RevenueFinding;
  facts: RevenueFacts;
  tenantId: string | null;
  roles: readonly string[];
  open: boolean;
  onOpenChange(open: boolean): void;
}

export function QuickFixDialog(props: QuickFixDialogProps) {
  ensureI18n();
  const { t } = useTranslation();
  const { finding, open, onOpenChange } = props;
  const dialogId = finding.fix?.kind === "dialog" ? finding.fix.dialog : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="quick-fix-dialog">
        {dialogId ? (
          <FixPanel key={dialogId} {...props} dialogId={dialogId} />
        ) : (
          <DialogHeader>
            <DialogTitle>{checkTitle(t, finding.checkId)}</DialogTitle>
            <DialogDescription>{t("adminRevenue.diagnostics.fixNoDialog")}</DialogDescription>
          </DialogHeader>
        )}
      </DialogContent>
    </Dialog>
  );
}

function valueText(t: TFunction, value: QuickFixValue): string {
  return "text" in value ? value.text : t(value.key, value.params);
}

/** Wartość pola z drugiej strony różnicy (np. „stan teraz" dla konfliktu). */
function beforeOf(diffs: readonly FieldDiff[], field: string): QuickFixValue | null {
  return diffs.find((d) => d.field === field)?.before ?? null;
}

function FixPanel({
  finding,
  facts,
  tenantId,
  roles,
  onOpenChange,
  dialogId,
}: QuickFixDialogProps & { dialogId: RevenueFixDialogId }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const spec: QuickFixSpec<unknown> = useMemo(() => quickFixFor(dialogId), [dialogId]);
  const applier = spec.apply.useApplier();
  const [currentFacts, setCurrentFacts] = useState(facts);
  const options = useMemo(() => spec.options(currentFacts, finding), [spec, currentFacts, finding]);
  const [optionId, setOptionId] = useState<string | null>(options[0]?.id ?? null);
  const option: QuickFixOption<unknown> | undefined = options.find((o) => o.id === optionId);
  const [value, setValue] = useState<unknown>(option?.payload);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [undo, setUndo] = useState<{ revert: () => Promise<void>; deadline: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const optionsName = useId();
  const optionsHeadingId = useId();

  // Odliczanie „Cofnij" - po minucie przycisk znika (zmiana zostaje).
  useEffect(() => {
    if (!undo) return;
    const timer = window.setInterval(() => {
      const tick = Date.now();
      setNow(tick);
      if (tick >= undo.deadline) setUndo(null);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [undo]);

  const canApply = canApplyQuickFix(spec.requiredRole, roles);
  const busy = phase.kind === "applying" || phase.kind === "checking";
  const done =
    phase.kind === "done" ||
    phase.kind === "undone" ||
    phase.kind === "undoFailed" ||
    (phase.kind === "conflict" && !phase.stillOpen);
  const complete = option !== undefined && (spec.valid ? spec.valid(value) : true);
  const roleReason = canApply ? null : t(ROLE_REASON_KEY[spec.requiredRole]);
  const diffs: FieldDiff[] = option ? spec.diff(option, currentFacts, value) : [];
  const Body = spec.body;

  /**
   * Świeże fakty z serwera: `refetchQueries` odświeża wpis, który czyta
   * tablica (jeden wpis cache dla listy, licznika paska i chipów). Gdy nikt
   * go nie obserwuje albo odświeżenie się nie udało (licznik aktualizacji
   * bez zmiany), pobieramy go raz wprost - ocena na starych faktach
   * powiedziałaby „problem nadal występuje" o problemie, który zniknął.
   */
  const freshFacts = async (): Promise<RevenueFacts | null> => {
    if (!tenantId) return null;
    const key = revenueKeys.facts(tenantId);
    const before = qc.getQueryState(key)?.dataUpdateCount ?? 0;
    await qc.refetchQueries({ queryKey: key, exact: true });
    if ((qc.getQueryState(key)?.dataUpdateCount ?? 0) === before) {
      try {
        await qc.fetchQuery({ ...revenueFactsQueryOptions(tenantId), staleTime: 0 });
      } catch {
        return null;
      }
    }
    const read = qc.getQueryData<RevenueFactsRead>(key);
    if (read?.state !== "ready") return null;
    setCurrentFacts(read.facts);
    return read.facts;
  };

  /** Ponowna ocena reguły, którą naprawiamy, na świeżych faktach. */
  const recheck = async (): Promise<{ outcome: Outcome; evidence: string }> => {
    const fresh = await freshFacts();
    const check = revenueCheck(finding.checkId);
    if (!fresh || !check) return { outcome: "unknown", evidence: "" };
    const result = runCheck(check, fresh);
    if (result.state === "ok") return { outcome: "resolved", evidence: "" };
    if (result.state === "unknown") return { outcome: "unknown", evidence: "" };
    return { outcome: "open", evidence: evidenceSentence(t, { evidence: result.evidence ?? [] }) };
  };

  const apply = async () => {
    if (!option || !complete || !canApply || busy) return;
    const attempted = diffs;
    setPhase({ kind: "applying" });
    let applied: QuickFixApplied;
    try {
      applied = await applier.apply(value);
    } catch (error) {
      if (!isStaleWriteError(error)) {
        setPhase({ kind: "failed" });
        return;
      }
      // Ktoś zapisał ten wiersz przed nami: świeże fakty pokażą „stan teraz",
      // a ocena reguły - czy problem w ogóle jeszcze jest.
      setPhase({ kind: "checking" });
      const { outcome } = await recheck();
      setPhase({ kind: "conflict", option, value, attempted, stillOpen: outcome !== "resolved" });
      return;
    }
    if (spec.reversible && applied.revert) {
      setUndo({ revert: applied.revert, deadline: Date.now() + UNDO_WINDOW_MS });
      setNow(Date.now());
    }
    setPhase({ kind: "checking" });
    setPhase({ kind: "done", ...(await recheck()) });
  };

  const revert = async () => {
    if (!undo) return;
    const { revert: run } = undo;
    setUndo(null);
    setPhase({ kind: "applying" });
    try {
      await run();
    } catch {
      setPhase({ kind: "undoFailed" });
      return;
    }
    await recheck();
    setPhase({ kind: "undone" });
  };

  /** „Wczytaj aktualne": podgląd od nowa na faktach pobranych przy konflikcie. */
  const reload = () => {
    const first = options[0];
    setOptionId(first?.id ?? null);
    setValue(first?.payload);
    setPhase({ kind: "idle" });
  };

  const message = (() => {
    switch (phase.kind) {
      case "applying":
        return t("adminRevenue.fix.applying");
      case "checking":
        return t("adminRevenue.fix.checking");
      case "done":
        if (phase.outcome === "resolved") return t("adminRevenue.fix.resolved");
        if (phase.outcome === "unknown") return t("adminRevenue.fix.stillUnknown");
        return t("adminRevenue.fix.stillOpen", { evidence: phase.evidence || "-" });
      case "undone":
        return t("adminRevenue.fix.undone");
      case "undoFailed":
        return t("adminRevenue.fix.undoFailed");
      case "failed":
        return t("adminRevenue.fix.failed");
      default:
        return "";
    }
  })();
  const outcome = phase.kind === "done" ? phase.outcome : null;

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t("adminRevenue.fix.dialogTitle", { title: checkTitle(t, finding.checkId) })}
        </DialogTitle>
        <DialogDescription>{t(`adminRevenue.fix.${spec.id}.description`)}</DialogDescription>
      </DialogHeader>

      <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
        <section aria-labelledby={optionsHeadingId} className="space-y-2">
          <h3 id={optionsHeadingId} className="m-0 text-sm font-semibold">
            {t(`adminRevenue.fix.${spec.id}.title`)}
          </h3>
          {options.length === 0 ? (
            <p className="m-0 text-sm text-muted-foreground">{t("adminRevenue.fix.noOptions")}</p>
          ) : (
            <fieldset className="space-y-2" disabled={busy || done}>
              <legend className="sr-only">{t("adminRevenue.fix.optionsLabel")}</legend>
              {options.map((candidate) => (
                <label
                  key={candidate.id}
                  className={cn(
                    "flex min-h-6 cursor-pointer items-start gap-2 rounded-[6px] border p-2 text-sm",
                    candidate.id === optionId ? "border-primary" : "border-border",
                  )}
                >
                  <input
                    type="radio"
                    name={optionsName}
                    value={candidate.id}
                    className="mt-0.5 h-4 w-4"
                    checked={candidate.id === optionId}
                    onChange={() => {
                      setOptionId(candidate.id);
                      setValue(candidate.payload);
                    }}
                  />
                  <span>{t(candidate.labelKey, candidate.labelParams)}</span>
                </label>
              ))}
            </fieldset>
          )}

          {Body && option ? (
            <Suspense
              fallback={
                <p className="m-0 text-sm text-muted-foreground">
                  {t("adminRevenue.fix.bodyLoading")}
                </p>
              }
            >
              <Body
                facts={currentFacts}
                finding={finding}
                option={option}
                value={value}
                onChange={setValue}
                disabled={busy || done || !canApply}
              />
            </Suspense>
          ) : null}
        </section>

        {phase.kind === "conflict" ? (
          <ConflictView
            t={t}
            stillOpen={phase.stillOpen}
            attempted={phase.attempted}
            now={spec.diff(phase.option, currentFacts, phase.value)}
            onReload={reload}
          />
        ) : null}

        {diffs.length > 0 && phase.kind !== "conflict" ? (
          <div className="space-y-2">
            <h3 className="m-0 text-sm font-semibold">{t("adminRevenue.fix.previewTitle")}</h3>
            <DiffTable
              t={t}
              caption={t("adminRevenue.fix.previewCaption")}
              heads={[t("adminRevenue.fix.field.before"), t("adminRevenue.fix.field.after")]}
              rows={diffs.map((row) => ({
                field: row.field,
                labelKey: row.labelKey,
                left: row.before,
                right: row.after,
              }))}
            />
            <SourceHeader entity={spec.apply.entity} columns={spec.apply.columns} />
            <p className="m-0 text-xs text-muted-foreground">{t("adminRevenue.fix.sourceNote")}</p>
          </div>
        ) : null}

        <div
          role="status"
          aria-live="polite"
          data-testid="quick-fix-status"
          data-phase={phase.kind}
          data-outcome={outcome ?? undefined}
          className="min-h-5 text-sm"
        >
          {message ? (
            <p className="m-0 flex items-start gap-2">
              {outcome === "resolved" ? (
                <CheckCircle2
                  className="mt-0.5 h-4 w-4 shrink-0 text-brand-ink dark:text-brand"
                  aria-hidden="true"
                />
              ) : outcome === "open" || phase.kind === "failed" || phase.kind === "undoFailed" ? (
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
                  aria-hidden="true"
                />
              ) : (
                <Info
                  className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
              <span>{message}</span>
            </p>
          ) : null}
        </div>
      </div>

      <DialogFooter className="flex-wrap gap-2">
        {undo ? (
          <Button type="button" variant="outline" className="h-8" onClick={() => void revert()}>
            {t("adminRevenue.fix.undo", {
              seconds: Math.max(0, Math.ceil((undo.deadline - now) / 1000)),
            })}
          </Button>
        ) : null}
        <Button type="button" variant="ghost" className="h-8" onClick={() => onOpenChange(false)}>
          {t(done ? "adminRevenue.fix.close" : "adminRevenue.fix.cancel")}
        </Button>
        {done ? null : (
          <DisabledReason
            reason={
              roleReason ??
              (complete || options.length === 0 ? null : t("adminRevenue.fix.incomplete"))
            }
          >
            <Button
              type="button"
              className="h-8"
              disabled={!canApply || !complete || busy || phase.kind === "conflict"}
              onClick={() => void apply()}
            >
              {busy ? t("adminRevenue.fix.applying") : t("adminRevenue.fix.apply")}
            </Button>
          </DisabledReason>
        )}
      </DialogFooter>
    </>
  );
}

interface DiffRow {
  field: string;
  labelKey: string;
  left: QuickFixValue | null;
  right: QuickFixValue | null;
}

/** Tabela różnicy: pole (nagłówek wiersza) i dwie strony porównania. */
function DiffTable({
  t,
  caption,
  heads,
  rows,
}: {
  t: TFunction;
  caption: string;
  heads: readonly [string, string];
  rows: readonly DiffRow[];
}) {
  return (
    <div role="region" aria-label={caption} tabIndex={0} className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th scope="col" className="py-1 pr-3 font-medium">
              {t("adminRevenue.fix.field.heading")}
            </th>
            <th scope="col" className="py-1 pr-3 font-medium">
              {heads[0]}
            </th>
            <th scope="col" className="py-1 font-medium">
              {heads[1]}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.field} className="border-b border-border last:border-0">
              <th scope="row" className="py-1 pr-3 text-left font-normal">
                {t(row.labelKey)}
              </th>
              <td className="py-1 pr-3 text-muted-foreground">
                {row.left ? valueText(t, row.left) : "-"}
              </td>
              <td className="py-1 font-medium">{row.right ? valueText(t, row.right) : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Konflikt zapisu: „Twoja zmiana" obok „stanu teraz" ze świeżych faktów. */
function ConflictView({
  t,
  stillOpen,
  attempted,
  now,
  onReload,
}: {
  t: TFunction;
  stillOpen: boolean;
  attempted: readonly FieldDiff[];
  now: readonly FieldDiff[];
  onReload(): void;
}) {
  return (
    <section
      role="alert"
      data-testid="quick-fix-conflict"
      className="space-y-2 rounded-[6px] border border-destructive/40 bg-destructive/5 p-3 text-sm"
    >
      <h3 className="m-0 flex items-center gap-2 text-sm font-semibold">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        {t("adminRevenue.fix.conflictTitle")}
      </h3>
      <p className="m-0">
        {stillOpen ? t("adminRevenue.fix.conflictBody") : t("adminRevenue.fix.conflictGone")}
      </p>
      {attempted.length > 0 ? (
        <DiffTable
          t={t}
          caption={t("adminRevenue.fix.conflictCaption")}
          heads={[t("adminRevenue.fix.conflictYours"), t("adminRevenue.fix.conflictNow")]}
          rows={attempted.map((row) => ({
            field: row.field,
            labelKey: row.labelKey,
            left: row.after,
            right: beforeOf(now, row.field),
          }))}
        />
      ) : null}
      {stillOpen ? (
        <Button type="button" size="sm" variant="outline" className="h-7" onClick={onReload}>
          {t("adminRevenue.fix.conflictReload")}
        </Button>
      ) : null}
    </section>
  );
}
