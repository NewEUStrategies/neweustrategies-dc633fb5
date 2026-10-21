// Test na sobie (S8, SPEC §6.3 „Test na sobie”) - zapis WŁASNEGO kontaktu
// zalogowanej osoby na opublikowaną wersję ścieżki, z postępem i sterowaniem.
//
// TYLKO WŁASNY KONTAKT. `admin_journey_enroll_test` bierze leada z
// `user_id = auth.uid()` - panel nie ma i nie może mieć wyboru kontaktu, więc
// test nie wyśle maila nikomu poza osobą, która go uruchomiła. Brak takiego
// leada to `own_lead_missing` (stan karty z wyjaśnieniem), trwające zwykłe
// przejście tego kontaktu - `duplicate`.
//
// WERSJA, NIE SZKIC. Zapis testowy idzie na opublikowaną wersję (jak każdy
// kontakt), dlatego panel nazywa numer wersji i opisuje kroki według niej
// (`journeyVersionQueryOptions` - wersja jest niezmienna).
//
// UCZCIWIE O SILNIKU (Z-S5-03 -> I9). Runner ścieżek nie jest jeszcze podpięty
// do `jobs-tick`, a prefiks „[TEST] ” w temacie maila testowego dopisze runner
// po zmianie integratora - panel mówi więc, że kroki wykonuje harmonogram,
// i pokazuje bieżący komunikat zdrowia silnika (`engineHealthNotice`), w tym
// „silnik nie wykonał jeszcze żadnego kroku”.
//
// „POMIŃ OCZEKIWANIE” tylko admin (`skipJourneyWait` = `requireAdmin`):
// redaktor widzi przycisk wyłączony z WIDOCZNYM wyjaśnieniem - wyłączony
// przycisk nie dostaje fokusu, więc sam dymek byłby nieosiągalny.
//
// KTÓRY ZAPIS JEST MÓJ. Identyfikator zapisu zwraca `enrollJourneyTest`;
// zapamiętujemy go w `sessionStorage` karty (wygoda widza, w try/catch - tryb
// prywatny i zablokowane dane strony po prostu go gubią), żeby po zamknięciu
// panelu dało się wrócić do postępu, nie zaczynając testu od nowa.
import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { Info, LogOut, Timer, UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { MfaRequiredNotice } from "@/components/admin/revenue/molecules/MfaRequiredNotice";
import { RoleGateNotice } from "@/components/admin/revenue/molecules/RoleGateNotice";
import { Button } from "@/components/ui/button";
import { isMfaRequiredError, type JourneyCapabilities } from "@/lib/admin/journeys/access";
import type {
  JourneyDefinitionDto,
  JourneyVersionSummary,
} from "@/lib/admin/journeys/journeyEditor.functions";
import {
  mutationErrorText,
  useEnrollJourneyTest,
  useExitJourneyEnrollment,
  useSkipJourneyWait,
  type JourneyMutationFailure,
} from "@/lib/admin/journeys/journeyMutations";
import { journeyVersionQueryOptions } from "@/lib/admin/journeys/journeyQueries";
import {
  JOURNEY_ENGINE_NOTICE_KEY,
  describeNode,
  engineHealthNotice,
  translateSummary,
} from "@/lib/admin/journeys/summaries";
import { buildJourneyView } from "@/lib/admin/journeys/viewModel";
import { chartLangFrom } from "@/lib/charts/format";
import { ensureI18n as ensureJourneysI18n } from "@/lib/i18n-admin-journeys";
import { ensureI18n as ensureListI18n } from "@/lib/i18n-admin-journeys-list";
import { ensureI18n } from "@/lib/i18n-admin-journeys-publish";
import type { JourneyEngineHealthDto, JourneyEnrollmentRow } from "@/lib/journeys/dto";
import { journeyLabelKey } from "@/lib/journeys/labels";
import {
  journeyEngineHealthQueryOptions,
  journeyEnrollmentsQueryOptions,
} from "@/lib/journeys/queries";

export interface JourneyTestPanelProps {
  tenantId: string | null;
  journeyId: string;
  /** Definicja ze szczegółu - test wymaga opublikowanej, niezarchiwizowanej ścieżki. */
  definition: Pick<JourneyDefinitionDto, "status" | "publishedVersionId">;
  /** Wersje ze szczegółu - numer wersji, na której ruszy test. */
  versions: readonly JourneyVersionSummary[];
  capabilities: Pick<JourneyCapabilities, "canTest" | "canSkipWait">;
  headingLevel?: 2 | 3;
}

const LOCALE = { pl: "pl-PL", en: "en-GB" } as const;

/**
 * Odświeżanie postępu, gdy test trwa: runner robi przebieg co minutę, więc
 * pół minuty to najwyżej jeden przebieg opóźnienia, bez odpytywania co chwilę.
 */
const TEST_PROGRESS_REFETCH_MS = 30_000;

const STORAGE_PREFIX = "nes.journeyTest.";

interface StoredTest {
  enrollmentId: string;
  leadId: string;
}

function readStoredTest(journeyId: string): StoredTest | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + journeyId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredTest>;
    return typeof parsed.enrollmentId === "string" && typeof parsed.leadId === "string"
      ? { enrollmentId: parsed.enrollmentId, leadId: parsed.leadId }
      : null;
  } catch {
    return null;
  }
}

function writeStoredTest(journeyId: string, test: StoredTest): void {
  try {
    window.sessionStorage.setItem(STORAGE_PREFIX + journeyId, JSON.stringify(test));
  } catch {
    // Brak pamięci karty to tylko brak wygody - postęp wróci po nowym teście.
  }
}

/** Zapis testu w toku (czeka albo idzie) - tylko taki da się pominąć lub zakończyć. */
function isRunning(row: Pick<JourneyEnrollmentRow, "status">): boolean {
  return row.status === "active" || row.status === "waiting";
}

export function JourneyTestPanel({
  tenantId,
  journeyId,
  definition,
  versions,
  capabilities,
  headingLevel = 2,
}: JourneyTestPanelProps) {
  ensureJourneysI18n();
  ensureListI18n();
  ensureI18n();
  const { t } = useTranslation();
  const headingId = useId();
  const Heading = headingLevel === 3 ? "h3" : "h2";

  return (
    <section
      aria-labelledby={headingId}
      data-testid="journey-test-panel"
      className="space-y-3 rounded-[6px] border border-border bg-card p-4"
    >
      <Heading id={headingId} className="m-0 flex items-center gap-2 text-base font-semibold">
        <UserPlus className="h-4 w-4 shrink-0" aria-hidden="true" />
        {t("adminJourneys.testPanel.title")}
      </Heading>
      {capabilities.canTest ? (
        <TestBody
          tenantId={tenantId}
          journeyId={journeyId}
          definition={definition}
          versions={versions}
          canSkipWait={capabilities.canSkipWait}
          subheading={headingLevel === 3 ? "h4" : "h3"}
        />
      ) : (
        <RoleGateNotice requiredRole="admin_or_editor" />
      )}
    </section>
  );
}

function TestBody({
  tenantId,
  journeyId,
  definition,
  versions,
  canSkipWait,
  subheading: Subheading,
}: Omit<JourneyTestPanelProps, "capabilities" | "headingLevel"> & {
  canSkipWait: boolean;
  subheading: "h3" | "h4";
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const hydrated = useHydrated();
  const [test, setTest] = useState<StoredTest | null>(() => readStoredTest(journeyId));
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);
  const enroll = useEnrollJourneyTest(tenantId, journeyId);
  const skip = useSkipJourneyWait(tenantId, journeyId);
  const exit = useExitJourneyEnrollment(tenantId, journeyId);

  const versionId = definition.publishedVersionId;
  const published = versionId !== null && definition.status !== "archived";
  const version = versions.find((entry) => entry.id === versionId)?.version ?? null;

  const health = useQuery({ ...journeyEngineHealthQueryOptions(tenantId), enabled: hydrated });
  const versionQuery = useQuery({
    ...journeyVersionQueryOptions(journeyId, versionId ?? ""),
    enabled: hydrated && versionId !== null,
  });
  const enrollments = useQuery({
    ...journeyEnrollmentsQueryOptions(journeyId),
    enabled: hydrated && test !== null,
    refetchInterval: (query) => {
      const data = query.state.data;
      const row =
        data?.state === "ready"
          ? data.data.rows.find((entry) => entry.id === test?.enrollmentId)
          : undefined;
      return row && isRunning(row) ? TEST_PROGRESS_REFETCH_MS : false;
    },
  });

  if (
    mfaRequired ||
    isMfaRequiredError(enrollments.error) ||
    isMfaRequiredError(health.error) ||
    isMfaRequiredError(versionQuery.error)
  ) {
    return <MfaRequiredNotice />;
  }

  const row =
    test !== null && enrollments.data?.state === "ready"
      ? (enrollments.data.data.rows.find(
          (entry) => entry.id === test.enrollmentId && entry.isTest,
        ) ?? null)
      : null;
  const running = row !== null && isRunning(row);
  const locale = LOCALE[chartLangFrom(i18n.language)];
  const formatTime = (iso: string | null) =>
    iso === null
      ? t("adminJourneys.testPanel.none")
      : new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(
          new Date(iso),
        );

  const versionData = versionQuery.data?.state === "ready" ? versionQuery.data.data : null;
  const stepText = (nodeId: string | null) => {
    if (nodeId === null) return t("adminJourneys.testPanel.none");
    const graph = versionData?.graph ?? null;
    const node = graph?.nodes.find((entry) => entry.id === nodeId);
    if (!graph || !node) return nodeId;
    const number = buildJourneyView(graph).numbering.get(nodeId) ?? "";
    const description = translateSummary(
      t,
      describeNode(node, { settings: versionData?.settings ?? null }),
    );
    return number ? t("adminJourneys.testPanel.stepValue", { number, description }) : description;
  };

  const failureText = (result: JourneyMutationFailure) =>
    result.error === "duplicate"
      ? t("adminJourneys.testPanel.duplicate")
      : mutationErrorText(t, result);

  const run = async (action: () => Promise<void>) => {
    setFailure(null);
    setNotice(null);
    try {
      await action();
    } catch (error) {
      if (isMfaRequiredError(error)) setMfaRequired(true);
      else setFailure(t("adminJourneys.testPanel.error"));
    }
  };

  const start = () =>
    run(async () => {
      const result = await enroll.mutateAsync();
      if (!result.ok) return setFailure(failureText(result));
      const next = { enrollmentId: result.data.enrollmentId, leadId: result.data.leadId };
      writeStoredTest(journeyId, next);
      setTest(next);
      setNotice(t("adminJourneys.testPanel.started"));
    });

  const skipWait = () =>
    run(async () => {
      if (row === null) return;
      const result = await skip.mutateAsync({ enrollmentId: row.id });
      if (!result.ok) return setFailure(failureText(result));
      setNotice(t("adminJourneys.testPanel.skipped"));
    });

  const finish = () =>
    run(async () => {
      if (row === null) return;
      const result = await exit.mutateAsync({ enrollmentId: row.id, leadId: test?.leadId });
      if (!result.ok) return setFailure(failureText(result));
      setNotice(t("adminJourneys.testPanel.exited"));
    });

  const pending = enroll.isPending || skip.isPending || exit.isPending;
  const skipBlocker = !canSkipWait
    ? t("adminJourneys.testPanel.skipAdminOnly")
    : row?.status !== "waiting"
      ? t("adminJourneys.testPanel.skipNotWaiting")
      : null;

  return (
    <div className="space-y-3">
      <p className="m-0 text-sm text-muted-foreground">
        {t("adminJourneys.testPanel.description")}
      </p>
      <ul className="m-0 list-none space-y-1 p-0 text-sm">
        <li className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {published && version !== null
            ? t("adminJourneys.testPanel.version", { version })
            : t("adminJourneys.testPanel.notPublished")}
        </li>
        <li className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {t("adminJourneys.testPanel.prefix")}
        </li>
        <li className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {t("adminJourneys.testPanel.scheduler")}
        </li>
      </ul>
      <EngineNotice health={health.data?.state === "ready" ? health.data.data : null} />

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={!published || pending}
          onClick={() => void start()}
        >
          <UserPlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {test === null
            ? t("adminJourneys.testPanel.start")
            : t("adminJourneys.testPanel.restart")}
        </Button>
      </div>
      {test !== null ? (
        <p className="m-0 text-xs text-muted-foreground">
          {t("adminJourneys.testPanel.restartHint")}
        </p>
      ) : null}

      {test !== null ? (
        <div className="space-y-2" data-testid="journey-test-progress">
          <Subheading className="m-0 text-sm font-semibold">
            {t("adminJourneys.testPanel.progress")}
          </Subheading>
          {row === null ? (
            <p role="status" className="m-0 text-sm text-muted-foreground">
              {enrollments.isPending
                ? t("adminJourneys.testPanel.progressLoading")
                : t("adminJourneys.testPanel.notInList")}
            </p>
          ) : (
            <dl className="m-0 grid gap-x-3 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
              <dt className="text-muted-foreground">{t("adminJourneys.testPanel.status")}</dt>
              <dd className="m-0">{t(journeyLabelKey("enrollmentStatus", row.status))}</dd>
              <dt className="text-muted-foreground">{t("adminJourneys.testPanel.currentStep")}</dt>
              <dd className="m-0">{stepText(row.currentNodeId)}</dd>
              <dt className="text-muted-foreground">{t("adminJourneys.testPanel.enteredAt")}</dt>
              <dd className="m-0">{formatTime(row.enteredAt)}</dd>
              {running ? (
                <>
                  <dt className="text-muted-foreground">
                    {t("adminJourneys.testPanel.nextRunAt")}
                  </dt>
                  <dd className="m-0">{formatTime(row.nextRunAt)}</dd>
                </>
              ) : null}
              {row.exitReason ? (
                <>
                  <dt className="text-muted-foreground">
                    {t("adminJourneys.testPanel.exitReason")}
                  </dt>
                  <dd className="m-0">{t(journeyLabelKey("exitReason", row.exitReason))}</dd>
                </>
              ) : null}
            </dl>
          )}
          {running ? (
            <div className="space-y-1">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={skipBlocker !== null || pending}
                  aria-describedby={skipBlocker !== null ? `${id}-skip` : undefined}
                  onClick={() => void skipWait()}
                >
                  <Timer className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {t("adminJourneys.testPanel.skip")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => void finish()}
                >
                  <LogOut className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {t("adminJourneys.testPanel.exit")}
                </Button>
              </div>
              {skipBlocker !== null ? (
                <p id={`${id}-skip`} className="m-0 text-xs text-muted-foreground">
                  {skipBlocker}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {notice !== null ? (
        <p role="status" className="m-0 text-sm">
          {notice}
        </p>
      ) : null}
      {failure !== null ? (
        <p role="alert" className="m-0 text-sm text-destructive">
          {failure}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Komunikat zdrowia silnika dla testu. Poza komunikatami paska listy mówi
 * też „silnik nie wykonał jeszcze żadnego kroku”, gdy kolejka jest pusta -
 * pasek tego nie zgłasza (nic nie czeka), a dla testu to właśnie ta wiadomość.
 */
function EngineNotice({ health }: { health: JourneyEngineHealthDto | null }) {
  const { t } = useTranslation();
  if (health === null) return null;
  const notice = engineHealthNotice(health, Date.now());
  const text =
    notice !== null && notice !== "errors"
      ? t(JOURNEY_ENGINE_NOTICE_KEY[notice])
      : health.lastStepAt === null
        ? t("adminJourneys.testPanel.runnerIdle")
        : null;
  if (text === null) return null;
  return (
    <p
      role="status"
      data-testid="journey-test-engine"
      className="m-0 rounded-[6px] border border-border bg-muted/30 p-2 text-sm"
    >
      {text}
    </p>
  );
}
