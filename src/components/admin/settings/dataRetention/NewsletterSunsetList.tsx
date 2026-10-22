// Molekuła: lista „Nieaktywni subskrybenci - do wygaszenia" w karcie
// „Retencja danych" (I9d-Y1, Z-I9c-08; wzór: `CrmDueList`).
//
// CO POKAZUJE. Liczby etapów (prośba w najbliższym przebiegu, czeka na
// wysyłkę, wysłana, do usunięcia, wykluczeni), stan kategorii (wyłączona,
// karencja z datą), listę z ostatnim zaangażowaniem, stanem prośby i terminem
// usunięcia oraz listę wykluczonych z powodem. Wykluczenie i jego cofnięcie
// idą wspólnym oknem `ReasonDialog` (powód 3-500 znaków, `audit_log`
// i zdarzenie `data_retention.changed.v1` po stronie SQL).
//
// ADRES MASKOWANY (`maskEmail`, ten sam skrót co rejestr wpłat). Lista służy
// decyzji „wykluczyć czy nie", a nie przeglądaniu bazy adresowej - domena
// i dwa pierwsze znaki wystarczą do rozpoznania partnera albo prenumeraty
// instytucjonalnej (RODO: minimalizacja). Imienia i nazwiska lista nie
// pokazuje wcale, choć RPC je zwraca.
//
// DYMKI. Zaangażowanie (Gmail tak, Apple MPP nie - decyzja wykonawcza I9d)
// zawsze; przy wyłączonym pomiarze otwarć dodatkowo znacznik „zaangażowanie
// liczone bez otwarć" z wyjaśnieniem (baza wtedy ignoruje otwarcia).
import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { HintTooltip } from "@/components/admin/pricing/atoms/HintTooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { maskEmail } from "@/lib/admin/monetization/model";
import { formatDate, formatDateTime } from "@/lib/i18n/format";
import { DATA_RETENTION_PERIODS, DATA_RETENTION_RULES } from "@/lib/privacy/dataRetention";
import type {
  DataRetentionNewsletterDueDto,
  DataRetentionNewsletterDueItem,
  DataRetentionNewsletterExcludedItem,
  NewsletterExclusionResultDto,
} from "@/lib/privacy/dataRetentionParse";
import type { DataRetentionMutation } from "@/lib/privacy/rpcResult";
import {
  dataRetentionNewsletterDueQueryOptions,
  useExcludeNewsletterSubscriber,
  useIncludeNewsletterSubscriber,
} from "@/lib/privacy/newsletterSunsetQueries";
import { ReasonDialog } from "./ReasonDialog";
import { NEWSLETTER_SUNSET_COPY_ANCHOR } from "./sunsetCopyRules";

const COUNT_KEYS = ["candidates", "requested", "mailed", "due", "excluded"] as const;

type Target =
  | { kind: "exclude"; subscriberId: string; email: string }
  | { kind: "include"; subscriberId: string; email: string };

export interface NewsletterSunsetListProps {
  tenantId: string;
  /** Termin karencji kategorii `newsletter_inactive` (z odczytu karty). */
  enforceAfter: string | null;
}

export function NewsletterSunsetList({ tenantId, enforceAfter }: NewsletterSunsetListProps) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const lang = i18n.language;
  const dueQ = useQuery(dataRetentionNewsletterDueQueryOptions(tenantId));
  const excludeM = useExcludeNewsletterSubscriber(tenantId);
  const includeM = useIncludeNewsletterSubscriber(tenantId);
  const [target, setTarget] = useState<Target | null>(null);
  const data = dueQ.data?.state === "ready" ? dueQ.data.data : null;
  const days = data?.responseDays ?? DATA_RETENTION_RULES.newsletterResponseDays;
  const engagementTitle = t("adminDataRetention.categories.newsletter_inactive.name");

  const report = (result: DataRetentionMutation<NewsletterExclusionResultDto>): boolean => {
    if (result.ok) {
      toast.success(
        !result.data.excluded
          ? t("adminDataRetention.newsletter.included")
          : result.data.cycleCancelled
            ? t("adminDataRetention.newsletter.excludedCancelled")
            : t("adminDataRetention.newsletter.excluded"),
      );
      return true;
    }
    toast.error(
      result.error === "not_found"
        ? t("adminDataRetention.newsletter.notFound")
        : t("adminDataRetention.newsletter.saveError"),
    );
    return false;
  };

  const submit = async (reason: string): Promise<boolean> => {
    if (!target) return false;
    const input = { subscriberId: target.subscriberId, reason };
    const result =
      target.kind === "exclude"
        ? await excludeM.mutateAsync(input)
        : await includeM.mutateAsync(input);
    return report(result);
  };

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        <h3 id={`${id}-title`} className="text-sm font-semibold">
          {t("adminDataRetention.newsletter.title")}
        </h3>
        <HintTooltip
          id={`${id}-engagement`}
          text={t("adminDataRetention.newsletter.engagementBody")}
          label={t("adminDataRetention.newsletter.engagementHint", { name: engagementTitle })}
        />
        {data !== null && !data.openTrackingEnabled ? (
          <span className="inline-flex items-center gap-1">
            <Badge variant="outline" className="font-normal">
              {t("adminDataRetention.newsletter.noOpens")}
            </Badge>
            <HintTooltip
              id={`${id}-no-opens`}
              text={t("adminDataRetention.newsletter.noOpensBody")}
              label={t("adminDataRetention.newsletter.noOpensHint", { name: engagementTitle })}
            />
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("adminDataRetention.newsletter.subtitle", {
          months: data?.periodMonths ?? DATA_RETENTION_PERIODS.newsletter_inactive.defaultMonths,
          days,
          cap: data?.dailyCap ?? DATA_RETENTION_RULES.newsletterDailyCap,
        })}{" "}
        <Link
          to="/admin/newsletter/email-content"
          hash={NEWSLETTER_SUNSET_COPY_ANCHOR}
          className="underline underline-offset-2 hover:text-foreground"
        >
          {t("adminDataRetention.newsletter.copyLink")}
        </Link>
      </p>

      {dueQ.isLoading ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t("adminDataRetention.newsletter.loading")}
        </p>
      ) : dueQ.isError || data === null ? (
        <p role="alert" className="text-xs">
          {t("adminDataRetention.newsletter.error")}
        </p>
      ) : (
        <SunsetBody
          data={data}
          lang={lang}
          days={days}
          enforceAfter={enforceAfter}
          onExclude={(item) =>
            setTarget({ kind: "exclude", subscriberId: item.subscriberId, email: masked(item) })
          }
          onInclude={(item) =>
            setTarget({ kind: "include", subscriberId: item.subscriberId, email: masked(item) })
          }
        />
      )}

      <ReasonDialog
        open={target !== null}
        title={
          target?.kind === "include"
            ? t("adminDataRetention.newsletter.includeTitle")
            : t("adminDataRetention.newsletter.excludeTitle")
        }
        description={
          target?.kind === "include"
            ? t("adminDataRetention.newsletter.includeBody", { email: target.email })
            : t("adminDataRetention.newsletter.excludeBody", { email: target?.email ?? "" })
        }
        reasonLabel={
          target?.kind === "include"
            ? t("adminDataRetention.newsletter.includeReason")
            : t("adminDataRetention.newsletter.excludeReason")
        }
        confirmLabel={
          target?.kind === "include"
            ? t("adminDataRetention.newsletter.include")
            : t("adminDataRetention.newsletter.excludeSave")
        }
        destructive={target?.kind === "exclude"}
        pending={excludeM.isPending || includeM.isPending}
        onClose={() => setTarget(null)}
        onConfirm={submit}
      />
    </section>
  );
}

/** Adres w skrócie; zły napis z bazy nie może wywrócić listy. */
function masked(item: { email: string }): string {
  return maskEmail(item.email) ?? "***";
}

function SunsetBody({
  data,
  lang,
  days,
  enforceAfter,
  onExclude,
  onInclude,
}: {
  data: DataRetentionNewsletterDueDto;
  lang: string;
  days: number;
  enforceAfter: string | null;
  onExclude: (item: DataRetentionNewsletterDueItem) => void;
  onInclude: (item: DataRetentionNewsletterExcludedItem) => void;
}) {
  const { t } = useTranslation();
  const { counts } = data;
  const total = counts.candidates + counts.requested + counts.mailed;

  return (
    <div className="space-y-3">
      {!data.enabled ? (
        <p className="text-xs text-muted-foreground">{t("adminDataRetention.newsletter.off")}</p>
      ) : !data.enforced ? (
        <p className="text-xs text-muted-foreground">
          {t("adminDataRetention.newsletter.grace", {
            date: enforceAfter ? formatDateTime(enforceAfter, lang) : "-",
          })}
        </p>
      ) : null}

      <dl
        aria-label={t("adminDataRetention.newsletter.countsLabel")}
        className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-5"
      >
        {COUNT_KEYS.map((key) => (
          <div key={key} className="rounded-md border border-border/60 p-2">
            <dt className="text-muted-foreground">
              {t(`adminDataRetention.newsletter.counts.${key}`)}
            </dt>
            <dd className="text-sm font-semibold">{counts[key]}</dd>
          </div>
        ))}
      </dl>

      {data.items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("adminDataRetention.newsletter.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th scope="col" className="py-1 pr-3 font-medium">
                  {t("adminDataRetention.newsletter.subscriber")}
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  {t("adminDataRetention.newsletter.lastEngaged")}
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  {t("adminDataRetention.newsletter.status")}
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  {t("adminDataRetention.newsletter.deletion")}
                </th>
                <th scope="col" className="py-1 font-medium">
                  <span className="sr-only">{t("adminDataRetention.newsletter.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.subscriberId} className="border-t border-border/60">
                  <td className="py-2 pr-3">
                    <span className="break-all">{masked(item)}</span>{" "}
                    <Badge variant="outline" className="font-normal">
                      {item.language.toUpperCase()}
                    </Badge>
                  </td>
                  <td className="py-2 pr-3">
                    {item.lastEngagedAt
                      ? formatDate(item.lastEngagedAt, lang)
                      : t("adminDataRetention.newsletter.never")}
                  </td>
                  <td className="py-2 pr-3">{stateLabel(item, lang, t)}</td>
                  <td className="py-2 pr-3">
                    {item.deleteAfter
                      ? t("adminDataRetention.newsletter.deleteOn", {
                          date: formatDate(item.deleteAfter, lang),
                        })
                      : t("adminDataRetention.newsletter.deleteLater", { days })}
                  </td>
                  <td className="py-2 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={t("adminDataRetention.newsletter.excludeAria", {
                        email: masked(item),
                      })}
                      onClick={() => onExclude(item)}
                    >
                      {t("adminDataRetention.newsletter.exclude")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > data.items.length ? (
            <p className="pt-1 text-xs text-muted-foreground">
              {t("adminDataRetention.newsletter.shown", { shown: data.items.length, total })}
            </p>
          ) : null}
        </div>
      )}

      <ExcludedList items={data.excluded} lang={lang} onInclude={onInclude} />
    </div>
  );
}

type T = ReturnType<typeof useTranslation>["t"];

/** Etap prośby słowami panelu; `suppressed` = adres na liście wyłączeń. */
function stateLabel(item: DataRetentionNewsletterDueItem, lang: string, t: T): string {
  if (item.state === "candidate") return t("adminDataRetention.newsletter.state.candidate");
  if (item.state === "requested") {
    return t("adminDataRetention.newsletter.state.requested", {
      date: item.requestedAt ? formatDate(item.requestedAt, lang) : "-",
    });
  }
  const date = item.mailedAt ? formatDate(item.mailedAt, lang) : "-";
  return item.mailOutcome === "suppressed"
    ? t("adminDataRetention.newsletter.state.suppressed", { date })
    : t("adminDataRetention.newsletter.state.mailed", { date });
}

function ExcludedList({
  items,
  lang,
  onInclude,
}: {
  items: DataRetentionNewsletterExcludedItem[];
  lang: string;
  onInclude: (item: DataRetentionNewsletterExcludedItem) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div role="region" aria-labelledby={`${id}-excluded`} className="space-y-1">
      <h4 id={`${id}-excluded`} className="text-xs font-semibold">
        {t("adminDataRetention.newsletter.excludedTitle")}
      </h4>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("adminDataRetention.newsletter.excludedEmpty")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th scope="col" className="py-1 pr-3 font-medium">
                  {t("adminDataRetention.newsletter.address")}
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  {t("adminDataRetention.newsletter.reasonColumn")}
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  {t("adminDataRetention.newsletter.since")}
                </th>
                <th scope="col" className="py-1 font-medium">
                  <span className="sr-only">{t("adminDataRetention.newsletter.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.subscriberId} className="border-t border-border/60">
                  <td className="py-2 pr-3">
                    <span className="break-all">{masked(item)}</span>
                  </td>
                  <td className="py-2 pr-3">
                    <span className="break-words">{item.reason}</span>
                  </td>
                  <td className="py-2 pr-3">{formatDate(item.createdAt, lang)}</td>
                  <td className="py-2 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={t("adminDataRetention.newsletter.includeAria", {
                        email: masked(item),
                      })}
                      onClick={() => onInclude(item)}
                    >
                      {t("adminDataRetention.newsletter.include")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
