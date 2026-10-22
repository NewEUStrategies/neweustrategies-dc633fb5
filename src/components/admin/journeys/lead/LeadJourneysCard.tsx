// Karta „Ścieżki” kontaktu w CRM (S8, SPEC §2.7; montuje ją integrator
// w `admin.crm.$id.tsx` obok „Historii etapów”) - ścieżki komunikacji, na
// których jest kontakt: status zapisu, bieżący krok, wejście i koniec, powód
// wyjścia, wersja, oznaczenie testu oraz odnośnik do edytora na tym kroku.
//
// AKCJE WG RÓL (lustro bramek serwera, `journeyCapabilities` z dokładnych
// ról, nie `isAdmin`): „Wyjmij ze ścieżki” - admin i redaktor (zapis w toku);
// „Pomiń czekanie” - tylko admin, redaktor widzi przycisk wyłączony
// (`aria-disabled`, fokus zostaje) z wyjaśnieniem. Obie przez
// `ConfirmDialog`; wynik `ok:false` tłumaczymy kodem i powodem RPC.
//
// STANY KARTY, NIE TOASTY: przed hydratacją - wczytywanie (serwer nie zna
// sesji), brak roli -> `RoleGateNotice`, brak `aal2` -> `MfaRequiredNotice`,
// funkcje niewdrożone, błąd z ponowieniem, pusta lista z następnym krokiem
// (galeria szablonów).
//
// JĘZYK. Karty CRM dostają `lang` z karty kontaktu; słownik jest i18next, więc
// przypinamy `t` do tego języka (`useTranslation(…, { lng })`) - karta mówi
// tym samym językiem co sąsiednie karty, nawet gdy i18next ma inny.
//
// Kontakt ma zwykle kilka zapisów, więc karta nie czyta szczegółu każdej
// ścieżki (graf i treści maili) tylko po to, by ponumerować krok - pokazuje
// identyfikator kroku, a odnośnik otwiera edytor dokładnie na nim
// (`?node=<id>&tab=contacts`).
import { useId, useState } from "react";
import { Link, useHydrated } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GitBranch, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { toast } from "sonner";

import { ConfirmDialog, type ConfirmState } from "@/components/admin/ConfirmDialog";
import { RevenueTabPending } from "@/components/admin/revenue/atoms/RevenueTabPending";
import { MfaRequiredNotice } from "@/components/admin/revenue/molecules/MfaRequiredNotice";
import { RoleGateNotice } from "@/components/admin/revenue/molecules/RoleGateNotice";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import {
  isMfaRequiredError,
  journeyAccessDenial,
  journeyCapabilities,
  type JourneyCapabilities,
} from "@/lib/admin/journeys/access";
import {
  mutationErrorText,
  useExitJourneyEnrollment,
  useSkipJourneyWait,
} from "@/lib/admin/journeys/journeyMutations";
import { chartLangFrom, type ChartLang } from "@/lib/charts/format";
import { formatDateTime } from "@/lib/i18n/format";
import { ensureI18n as ensureJourneysI18n } from "@/lib/i18n-admin-journeys";
import { ensureI18n as ensureListI18n } from "@/lib/i18n-admin-journeys-list";
import { ensureI18n } from "@/lib/i18n-admin-journeys-results";
import type { JourneyLeadEnrollment } from "@/lib/journeys/dto";
import { journeyKeys } from "@/lib/journeys/keys";
import { journeyLabelKey } from "@/lib/journeys/labels";
import { leadJourneysQueryOptions } from "@/lib/journeys/queries";

export interface LeadJourneysCardProps {
  leadId: string;
  /** Język karty kontaktu; domyślnie język interfejsu. */
  lang?: "pl" | "en";
}

export function LeadJourneysCard({ leadId, lang }: LeadJourneysCardProps) {
  ensureJourneysI18n();
  ensureListI18n();
  ensureI18n();
  const { t, i18n } = useTranslation(undefined, lang ? { lng: lang } : undefined);
  const cardLang = lang ?? chartLangFrom(i18n.language);
  const hydrated = useHydrated();
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      data-testid="lead-journeys"
      className="rounded-[6px] border border-border bg-card p-3"
    >
      <div className="mb-1 flex items-center gap-2">
        <GitBranch className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <h3 id={headingId} className="m-0 text-[12px] font-medium">
          {t("adminJourneys.lead.title")}
        </h3>
      </div>
      <p className="mb-2 mt-0 text-[11px] text-muted-foreground">
        {t("adminJourneys.lead.description")}
      </p>
      {hydrated ? (
        <LeadJourneysContent leadId={leadId} t={t} lang={cardLang} />
      ) : (
        <RevenueTabPending />
      )}
    </section>
  );
}

function LeadJourneysContent({
  leadId,
  t,
  lang,
}: {
  leadId: string;
  t: TFunction;
  lang: ChartLang;
}) {
  const { roles, tenantId } = useAuth();
  const tenant = tenantId ?? null;
  const caps = journeyCapabilities(roles);
  const skipHintId = useId();
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);
  const query = useQuery({
    ...leadJourneysQueryOptions(leadId),
    enabled: caps.canEdit && tenant !== null,
  });

  if (!caps.canEdit) return <RoleGateNotice requiredRole="admin_or_editor" />;
  const denial = journeyAccessDenial(query.error);
  if (mfaRequired || denial === "mfa_required") return <MfaRequiredNotice />;
  if (denial === "role" || query.data?.state === "forbidden") {
    return <RoleGateNotice requiredRole="admin_or_editor" />;
  }
  if (query.data?.state === "unavailable") {
    return (
      <p role="status" className="m-0 text-[11px] text-muted-foreground">
        {t("adminJourneys.lead.unavailable")}
      </p>
    );
  }
  if (query.isError) {
    return (
      <div role="alert" className="space-y-2">
        <p className="m-0 text-[11px] text-destructive">{t("adminJourneys.lead.loadError")}</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-[11px]"
          onClick={() => void query.refetch()}
        >
          {t("adminJourneys.common.retry")}
        </Button>
      </div>
    );
  }
  if (query.data?.state !== "ready") {
    return (
      <p role="status" className="m-0 text-[11px] text-muted-foreground">
        {t("adminJourneys.lead.loading")}
      </p>
    );
  }

  const rows = query.data.data;
  if (rows.length === 0) {
    return (
      <div role="status" className="space-y-1 text-[11px] text-muted-foreground">
        <p className="m-0">{t("adminJourneys.lead.empty")}</p>
        <p className="m-0">{t("adminJourneys.lead.emptyNext")}</p>
        <Link
          to="/admin/revenue/$tab"
          params={{ tab: "journeys" }}
          search={{ new: "1" }}
          className="font-medium text-foreground underline-offset-2 hover:underline focus-visible:underline"
        >
          {t("adminJourneys.lead.gallery")}
        </Link>
      </div>
    );
  }

  const anyLocked = !caps.canSkipWait && rows.some((row) => row.status === "waiting");

  return (
    <div className="space-y-2">
      {anyLocked ? (
        <p
          id={skipHintId}
          className="m-0 flex items-center gap-1 text-[11px] text-muted-foreground"
        >
          <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t("adminJourneys.enrollments.skipAdminOnly")}
        </p>
      ) : null}
      <ul aria-label={t("adminJourneys.lead.list")} className="m-0 list-none space-y-2 p-0">
        {rows.map((row) => (
          <LeadJourneyItem
            key={row.enrollmentId}
            row={row}
            leadId={leadId}
            tenantId={tenant}
            caps={caps}
            skipHintId={skipHintId}
            t={t}
            lang={lang}
            onConfirm={setConfirm}
            onMfaRequired={() => setMfaRequired(true)}
          />
        ))}
      </ul>
      <ConfirmDialog
        state={confirm}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      />
    </div>
  );
}

function LeadJourneyItem({
  row,
  leadId,
  tenantId,
  caps,
  skipHintId,
  t,
  lang,
  onConfirm,
  onMfaRequired,
}: {
  row: JourneyLeadEnrollment;
  leadId: string;
  tenantId: string | null;
  caps: JourneyCapabilities;
  skipHintId: string;
  t: TFunction;
  lang: ChartLang;
  onConfirm: (state: ConfirmState) => void;
  onMfaRequired: () => void;
}) {
  const queryClient = useQueryClient();
  // Hook per zapis: inwalidacja zna ŚCIEŻKĘ tego zapisu (kontakty i liczby
  // jej edytora), a karta dokłada listę ścieżek kontaktu.
  const exit = useExitJourneyEnrollment(tenantId, row.journeyId);
  const skip = useSkipJourneyWait(tenantId, row.journeyId);
  const inProgress = row.status === "active" || row.status === "waiting";

  const runExit = async () => {
    try {
      const result = await exit.mutateAsync({ enrollmentId: row.enrollmentId, leadId });
      if (result.ok) toast.success(t("adminJourneys.enrollments.exitDone"));
      else toast.error(mutationErrorText(t, result));
    } catch (error) {
      if (isMfaRequiredError(error)) onMfaRequired();
      else toast.error(t("adminJourneys.enrollments.exitError"));
    }
  };

  const runSkip = async () => {
    try {
      const result = await skip.mutateAsync({ enrollmentId: row.enrollmentId });
      if (result.ok) {
        toast.success(t("adminJourneys.enrollments.skipDone"));
        await queryClient.invalidateQueries({ queryKey: journeyKeys.forLead(leadId) });
      } else toast.error(mutationErrorText(t, result));
    } catch (error) {
      if (isMfaRequiredError(error)) onMfaRequired();
      else toast.error(t("adminJourneys.enrollments.skipError"));
    }
  };

  return (
    <li
      data-enrollment-id={row.enrollmentId}
      data-status={row.status}
      className="space-y-1 rounded-[6px] border border-border p-2 text-[11px]"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Link
          to="/admin/revenue/journeys/$journeyId"
          params={{ journeyId: row.journeyId }}
          search={row.currentNodeId ? { node: row.currentNodeId, tab: "contacts" } : {}}
          aria-label={t("adminJourneys.lead.open", { name: row.journeyName })}
          className="text-[12px] font-medium text-foreground underline-offset-2 hover:underline focus-visible:underline"
        >
          {row.journeyName}
        </Link>
        <span className="rounded-full border border-border px-1.5 font-medium">
          {t(journeyLabelKey("enrollmentStatus", row.status))}
        </span>
        {row.isTest ? (
          <span className="rounded-full border border-dashed border-border px-1.5 font-medium">
            {t("adminJourneys.lead.test")}
          </span>
        ) : null}
        <span className="text-muted-foreground">
          {t("adminJourneys.lead.version", { version: row.version })}
        </span>
      </div>
      <ul className="m-0 list-none space-y-0.5 p-0 text-muted-foreground">
        {row.currentNodeId ? (
          <li>{t("adminJourneys.lead.step", { node: row.currentNodeId })}</li>
        ) : null}
        <li>{t("adminJourneys.lead.entered", { date: formatDateTime(row.enteredAt, lang) })}</li>
        {row.finishedAt ? (
          <li>
            {t("adminJourneys.lead.finished", { date: formatDateTime(row.finishedAt, lang) })}
          </li>
        ) : null}
        {row.exitReason ? (
          <li>
            {t("adminJourneys.lead.reason", {
              reason: t(journeyLabelKey("exitReason", row.exitReason)),
            })}
          </li>
        ) : null}
      </ul>
      {inProgress ? (
        <div className="flex flex-wrap gap-1 pt-1">
          {row.status === "waiting" ? (
            caps.canSkipWait ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-[11px]"
                disabled={skip.isPending}
                aria-label={t("adminJourneys.lead.skipFor", { name: row.journeyName })}
                onClick={() =>
                  onConfirm({
                    title: t("adminJourneys.enrollments.skipConfirmTitle"),
                    description: t("adminJourneys.lead.skipConfirmBody", {
                      name: row.journeyName,
                    }),
                    confirmLabel: t("adminJourneys.enrollments.skipConfirm"),
                    cancelLabel: t("adminJourneys.common.cancel"),
                    onConfirm: runSkip,
                  })
                }
              >
                {t("adminJourneys.enrollments.skip")}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-[11px] opacity-60"
                aria-disabled="true"
                aria-describedby={skipHintId}
                aria-label={t("adminJourneys.lead.skipFor", { name: row.journeyName })}
                data-locked="admin"
              >
                {t("adminJourneys.enrollments.skip")}
              </Button>
            )
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            disabled={exit.isPending}
            aria-label={t("adminJourneys.lead.exitFor", { name: row.journeyName })}
            onClick={() =>
              onConfirm({
                title: t("adminJourneys.enrollments.exitConfirmTitle"),
                description: t("adminJourneys.lead.exitConfirmBody", {
                  name: row.journeyName,
                  reason: t(journeyLabelKey("exitReason", "manual")),
                }),
                confirmLabel: t("adminJourneys.enrollments.exitConfirm"),
                cancelLabel: t("adminJourneys.common.cancel"),
                destructive: true,
                onConfirm: runExit,
              })
            }
          >
            {t("adminJourneys.enrollments.exit")}
          </Button>
        </div>
      ) : null}
    </li>
  );
}
