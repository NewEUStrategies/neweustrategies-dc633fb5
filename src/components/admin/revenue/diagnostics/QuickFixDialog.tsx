// Organizm: szkielet SZYBKIEJ NAPRAWY diagnozy (SPEC §6.4) - jeden dialog
// dla piętnastu napraw; treść z rejestru `lib/admin/revenue/quickFixes.ts`.
//
// PRZEPŁYW: wybór rozwiązania → podgląd „Przed → Po" (+ `SourceHeader`: ta
// sama zmiana pojawi się w module) → zapis WSPÓŁDZIELONYM mutatorem modułu →
// `refetchQueries(revenueKeys.facts(t))` → ponowna ocena TEJ reguły na
// świeżych faktach → komunikat w regionie `aria-live`: „✓ problem zniknął"
// albo „! zapisano, ale problem nadal występuje: <dowody>". Zmiana
// odwracalna dostaje „Cofnij" na 60 sekund. Konflikt (`40001` - wiersz
// zapisany w innej karcie) zamienia podgląd w porównanie „Twoja zmiana / stan
// teraz" z przyciskiem „Wczytaj aktualne". Rola bez prawa zapisu w module →
// „Zastosuj" wyłączone z powodem (`DisabledReason`).
//
// HAK APLIKATORA W PODKOMPONENCIE. `spec.apply.useApplier()` woła hooki
// mutatorów modułu; renderujemy go dopiero w treści OTWARTEGO dialogu
// (`FixPanel`), a klucz po identyfikatorze dialogu gwarantuje stałą kolejność
// hooków. Zamknięty dialog nie trzyma subskrypcji modułów.
import { Suspense, useEffect, useId, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, Info } from "lucide-react";
import { useTranslation } from "react-i18next";

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
  type QuickFixSpec,
  type QuickFixValue,
} from "@/lib/admin/revenue/quickFixes";
import { isStaleWriteError } from "@/lib/billing/planQueries";
import { ensureI18n } from "@/lib/i18n-admin-revenue-diagnostics";
import type { RevenueFactsRead } from "@/lib/revenue/diagnostics/diagnostics.functions";
import type { RevenueFacts } from "@/lib/revenue/diagnostics/facts";
import {
  revenueCheck,
  runCheck,
  type RevenueFinding,
  type RevenueFixDialogId,
} from "@/lib/revenue/diagnostics/registry";
import { revenueKeys } from "@/lib/revenue/keys";
import { checkTitle, evidenceSentence } from "./findingText";

/** Okno „Cofnij" po zapisie odwracalnym (SPEC §6.4). */
export const UNDO_WINDOW_MS = 60_000;

type Phase =
  | { kind: "idle" }
  | { kind: "applying" }
  | { kind: "checking" }
  | { kind: "done"; outcome: "resolved" | "open" | "unknown"; evidence: string }
  | { kind: "undone" }
  | { kind: "conflict" }
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

function valueText(t: (key: string, params?: Record<string, unknown>) => string, value: QuickFixValue) {
  return "text" in value ? value.text : t(value.key, value.params);
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
  const complete = option !== undefined && (spec.valid ? spec.valid(value) : true);
  const roleReason = canApply
    ? null
    : t(spec.requiredRole === "admin" ? "adminRevenue.fix.roleAdmin" : "adminRevenue.fix.roleEditor");
  const diffs: FieldDiff[] = option ? spec.diff(option, currentFacts, value) : [];
  const Body = spec.body;

  /** Świeże fakty z serwera i ponowna ocena reguły, którą naprawiamy. */
  const recheck = async (): Promise<Phase> => {
    if (!tenantId) return { kind: "done", outcome: "unknown", evidence: "" };
    await qc.refetchQueries({ queryKey: revenueKeys.facts(tenantId), exact: true });
    const read = qc.getQueryData<RevenueFactsRead>(revenueKeys.facts(tenantId));
    const check = revenueCheck(finding.checkId);
    if (read?.state !== "ready" || !check) return { kind: "done", outcome: "unknown", evidence: "" };
    setCurrentFacts(read.facts);
    const result = runCheck(check, read.facts);
    if (result.state === "ok") return { kind: "done", outcome: "resolved", evidence: "" };
    if (result.state === "unknown") return { kind: "done", outcome: "unknown", evidence: "" };
    return {
      kind: "done",
      outcome: "open",
      evidence: evidenceSentence(t, { evidence: result.evidence ?? [] }),
    };
  };

  const apply = async () => {
    if (!option || !complete || !canApply || busy) return;
    setPhase({ kind: "applying" });
    let applied: QuickFixApplied;
    try {
      applied = await applier.apply(value);
    } catch (error) {
      setPhase(isStaleWriteError(error) ? { kind: "conflict" } : { kind: "failed" });
      return;
    }
    if (spec.reversible && applied.revert) {
      setUndo({ revert: applied.revert, deadline: Date.now() + UNDO_WINDOW_MS });
      setNow(Date.now());
    }
    setPhase({ kind: "checking" });
    setPhase(await recheck());
  };

  const revert = async () => {
    if (!undo) return;
    const { revert: run } = undo;
    setUndo(null);
    setPhase({ kind: "applying" });
    try {
      await run();
      await recheck();
      setPhase({ kind: "undone" });
    } catch {
      setPhase({ kind: "failed" });
    }
  };

  const reload = async () => {
    setPhase({ kind: "checking" });
    await recheck();
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
        return t("adminRevenue.fix.stillOpen", { evidence: phase.evidence });
      case "undone":
        return t("adminRevenue.fix.undone");
      case "failed":
        return t("adminRevenue.fix.failed");
      default:
        return "";
    }
  })();
  const done = phase.kind === "done" || phase.kind === "undone";

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t("adminRevenue.fix.dialogTitle", { title: checkTitle(t, finding.checkId) })}
        </DialogTitle>
        <DialogDescription>{t(`adminRevenue.fix.${spec.id}.description`)}</DialogDescription>
      </DialogHeader>

      <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
        {options.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">{t("adminRevenue.fix.noOptions")}</p>
        ) : (
          <fieldset className="space-y-2" disabled={busy || done}>
            <legend className="mb-1 text-sm font-medium">{t("adminRevenue.fix.optionsLabel")}</legend>
            {options.map((candidate) => (
              <label
                key={candidate.id}
                className="flex min-h-6 cursor-pointer items-start gap-2 rounded-[6px] border border-border p-2 text-sm has-[:checked]:border-primary"
              >
                <input
                  type="radio"
                  name={optionsName}
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
          <Suspense fallback={null}>
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

        {phase.kind === "conflict" ? (
          <section
            role="alert"
            className="space-y-2 rounded-[6px] border border-destructive/40 bg-destructive/5 p-3 text-sm"
          >
            <h3 className="m-0 flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {t("adminRevenue.fix.conflictTitle")}
            </h3>
            <p className="m-0">{t("adminRevenue.fix.conflictBody")}</p>
            <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => void reload()}>
              {t("adminRevenue.fix.conflictReload")}
            </Button>
          </section>
        ) : null}

        {diffs.length > 0 ? (
          <div className="space-y-2">
            <h3 className="m-0 text-sm font-semibold">{t("adminRevenue.fix.previewTitle")}</h3>
            <div role="region" aria-label={t("adminRevenue.fix.previewCaption")} tabIndex={0} className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">{t("adminRevenue.fix.previewCaption")}</caption>
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th scope="col" className="py-1 pr-3 font-medium">
                      {t("adminRevenue.fix.field.heading")}
                    </th>
                    <th scope="col" className="py-1 pr-3 font-medium">
                      {t("adminRevenue.fix.field.before")}
                    </th>
                    <th scope="col" className="py-1 font-medium">
                      {t("adminRevenue.fix.field.after")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {diffs.map((row) => (
                    <tr key={row.field} className="border-b border-border last:border-0">
                      <th scope="row" className="py-1 pr-3 text-left font-normal">
                        {t(row.labelKey)}
                      </th>
                      <td className="py-1 pr-3 text-muted-foreground line-through decoration-muted-foreground/60">
                        {valueText(t, row.before)}
                      </td>
                      <td className="py-1 font-medium">{valueText(t, row.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <SourceHeader entity={spec.apply.entity} columns={spec.apply.columns} />
            <p className="m-0 text-xs text-muted-foreground">{t("adminRevenue.fix.sourceNote")}</p>
          </div>
        ) : null}

        <div
          role="status"
          aria-live="polite"
          data-testid="quick-fix-status"
          data-phase={phase.kind}
          data-outcome={phase.kind === "done" ? phase.outcome : undefined}
          className="min-h-5 text-sm"
        >
          {message ? (
            <p className="m-0 flex items-start gap-2">
              {phase.kind === "done" && phase.outcome === "resolved" ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-ink dark:text-brand" aria-hidden="true" />
              ) : phase.kind === "done" && phase.outcome === "open" ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
              ) : (
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
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
            reason={roleReason ?? (complete || options.length === 0 ? null : t("adminRevenue.fix.incomplete"))}
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
