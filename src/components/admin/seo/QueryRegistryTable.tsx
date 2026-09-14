// Tabela rejestru fraz w dwóch ujęciach: po artykule i po frazie.
//
// PO CO OSOBNY KOMPONENT, A NIE JSX W TRASIE. Z tego samego powodu co przy
// `BrandFindingList`: progi pokrycia dla `src/routes/admin.seo*.tsx` liczą
// GAŁĘZIE, a każda gałąź tego wiersza - werdykt CTR, brak dopasowania do
// CMS-a, lista brakujących słów - wymagałaby w trasie podstawienia całego
// Google i całej bazy naraz. Tutaj są zwykłym wejściem funkcji, więc dowodzi
// się je wprost i po kolei.
//
// Komponent NICZEGO NIE LICZY. Werdykty i sortowanie przychodzą policzone
// z `@/lib/seo/queryRegistry`; jedyne, co tu powstaje, to lista brakujących
// słów - i ona też jest wywołaniem funkcji z tamtego modułu, nie regułą
// napisaną na miejscu.
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
// Klucze `adminSeoHub.*` rejestruje nakładka - efektem ubocznym importu. Trasy
// wołają `ensureI18n()`, bo ich shelle są eager; ten komponent jest liściem
// leniwej zakładki, więc zwykły import ląduje w jej chunku, i tam ma zostać.
import "@/lib/i18n-admin-seo-hub";
import {
  missedClicks,
  missingQueryTerms,
  type CtrVerdict,
  type RegistryPage,
  type RegistryQuery,
} from "@/lib/seo/queryRegistry";

/** Tekst artykułu, z którym porównujemy frazy. Trasa dostarcza go z CMS-a. */
export interface QueryRegistryContent {
  readonly kind: "post" | "page";
  readonly title: string;
  readonly description: string;
}

export interface QueryRegistryTableProps {
  readonly view: "pages" | "queries";
  readonly pages: readonly RegistryPage[];
  readonly queries: readonly (RegistryQuery & { readonly path: string })[];
  readonly contentBySlug: ReadonlyMap<string, QueryRegistryContent>;
  readonly minImpressions: number;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatPosition(value: number): string {
  return value.toFixed(1);
}

export function VerdictBadge({ verdict }: { verdict: CtrVerdict }) {
  const { t } = useTranslation();
  if (verdict === "tooFew") {
    return (
      <span className="text-[11px] text-muted-foreground">
        {t("adminSeoHub.queriesVerdictTooFew")}
      </span>
    );
  }
  const below = verdict === "below";
  return (
    <span
      data-testid="verdict"
      data-verdict={verdict}
      className={`text-[11px] font-medium ${below ? "text-destructive" : "text-emerald-600"}`}
    >
      {below ? t("adminSeoHub.queriesVerdictBelow") : t("adminSeoHub.queriesVerdictOk")}
    </span>
  );
}

/** Link do edycji artykułu albo - gdy slug nie pasuje do niczego - sama ścieżka. */
export function ContentLink({
  path,
  slug,
  content,
}: {
  path: string;
  slug: string;
  content: QueryRegistryContent | undefined;
}) {
  const { t } = useTranslation();
  if (!content) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="font-mono text-[11px]">{path}</span>
        <span className="text-[10px] text-muted-foreground">
          ({t("adminSeoHub.queriesUnmatched")})
        </span>
      </span>
    );
  }
  return (
    <Link
      to={content.kind === "post" ? "/admin/posts/$slug" : "/admin/pages/$slug"}
      params={{ slug }}
      className="text-brand hover:underline"
    >
      {content.title || path}
    </Link>
  );
}

export function QueryRegistryTable({
  view,
  pages,
  queries,
  contentBySlug,
  minImpressions,
}: QueryRegistryTableProps) {
  const { t } = useTranslation();

  if (view === "queries") {
    return (
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">{t("adminSeoHub.queriesColQuery")}</th>
              <th className="px-3 py-2">{t("adminSeoHub.queriesColPage")}</th>
              <th className="px-3 py-2 text-right">{t("adminSeoHub.queriesColImpressions")}</th>
              <th className="px-3 py-2 text-right">{t("adminSeoHub.queriesColClicks")}</th>
              <th className="px-3 py-2 text-right">{t("adminSeoHub.queriesColCtr")}</th>
              <th className="px-3 py-2 text-right">{t("adminSeoHub.queriesColPosition")}</th>
              <th className="px-3 py-2">{t("adminSeoHub.queriesColVerdict")}</th>
            </tr>
          </thead>
          <tbody>
            {queries.map((query) => (
              <tr
                key={`${query.path}::${query.query}`}
                data-testid="query-row"
                className="border-t border-border"
              >
                <td className="px-3 py-2 font-medium">{query.query}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                  {query.path}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{query.impressions}</td>
                <td className="px-3 py-2 text-right tabular-nums">{query.clicks}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatPercent(query.ctr)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatPosition(query.position)}
                </td>
                <td className="px-3 py-2">
                  <VerdictBadge verdict={query.verdict} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {pages.map((page) => {
        const content = contentBySlug.get(page.slug);
        const recoverable = missedClicks(page);
        const missing = content
          ? [
              ...new Set(
                page.queries.flatMap((query) =>
                  missingQueryTerms(query.query, content.title, content.description),
                ),
              ),
            ]
          : [];
        return (
          <li
            key={page.path}
            data-testid="registry-page"
            data-verdict={page.verdict}
            className="rounded-lg border border-border bg-card p-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <ContentLink path={page.path} slug={page.slug} content={content} />
              <VerdictBadge verdict={page.verdict} />
            </div>

            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span>
                {t("adminSeoHub.queriesColImpressions")}:{" "}
                <strong className="tabular-nums text-foreground">{page.impressions}</strong>
              </span>
              <span>
                {t("adminSeoHub.queriesColClicks")}:{" "}
                <strong className="tabular-nums text-foreground">{page.clicks}</strong>
              </span>
              <span>
                {t("adminSeoHub.queriesColCtr")}:{" "}
                <strong className="tabular-nums text-foreground">{formatPercent(page.ctr)}</strong>
              </span>
              <span>
                {t("adminSeoHub.queriesColPosition")}:{" "}
                <strong className="tabular-nums text-foreground">
                  {formatPosition(page.position)}
                </strong>
              </span>
              {recoverable >= 1 && (
                <span data-testid="recoverable">
                  {t("adminSeoHub.queriesMissedClicks")}:{" "}
                  <strong className="tabular-nums text-destructive">
                    {Math.round(recoverable)}
                  </strong>
                </span>
              )}
            </div>

            {page.verdict === "tooFew" && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {t("adminSeoHub.queriesVerdictTooFewHint", { count: minImpressions })}
              </p>
            )}

            {page.verdict === "below" && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {t("adminSeoHub.queriesVerdictBelowHint")}
              </p>
            )}

            {missing.length > 0 && (
              <p className="mt-2 text-[11px]" data-testid="missing-terms">
                <span className="text-muted-foreground">
                  {t("adminSeoHub.queriesMissingTerms")}
                </span>{" "}
                {missing.map((term) => (
                  <span
                    key={term}
                    className="mr-1 inline-block rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-amber-700"
                  >
                    {term}
                  </span>
                ))}
              </p>
            )}

            <ul className="mt-2 space-y-1">
              {page.queries.slice(0, 5).map((query) => (
                <li
                  key={query.query}
                  data-testid="page-query"
                  className="flex items-baseline justify-between gap-3 text-[11px]"
                >
                  <span className="truncate">{query.query}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {query.impressions} / {query.clicks} · {formatPosition(query.position)}
                  </span>
                </li>
              ))}
            </ul>

            {content && (
              <Link
                to={content.kind === "post" ? "/admin/posts/$slug" : "/admin/pages/$slug"}
                params={{ slug: page.slug }}
                className="mt-2 inline-block text-[11px] font-medium text-brand hover:underline"
              >
                {t("adminSeoHub.queriesEditContent")} →
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
