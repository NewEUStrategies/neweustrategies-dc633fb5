// KARTA FUNDAMENTÓW TECHNICZNYCH na kokpicie SEO.
//
// Odpowiada na pytanie, które przynosi każdy zewnętrzny audyt: „czy mapa strony
// naprawdę istnieje" i „czy dokument deklaruje język". Zamiast wierzyć raportowi
// skanera (bywa nieświeży o wiele godzin), karta POBIERA cztery powierzchnie
// z PUBLICZNEGO originu bieżącego tenanta (`useTenantPublicOrigin`) i ocenia
// je regułami z `@/lib/seo/technicalFoundation`. Origin jest per-tenant: admin
// tenanta z własną domeną ma widzieć stan SWOICH plików, nie plików marki.
//
// PLIKI MAPY STRONY (2026-10-10). Karta czytała wyłącznie indeks i liczyła
// w nim `<sitemap>` - „OK, 6 plików sekcji" - podczas gdy Search Console
// raportował błędy w dwóch z tych plików. Teraz pobiera indeks ORAZ każdy plik,
// na który indeks wskazuje, waliduje każdy tymi samymi regułami co Search
// Console (`@/lib/seo/sitemapValidation`) i pokazuje je w tabeli „Pliki mapy
// strony": stan, liczba wpisów, ostatnia zmiana, wynik walidacji z numerem
// wiersza, link „Otwórz" i „Pobierz plik". Wiersz mapy strony w tabeli
// fundamentów jest zielony tylko wtedy, gdy przechodzi KAŻDY plik.
//
// GRANICA WIARYGODNOŚCI. Pliki generowane nie wysyłają nagłówków CORS, więc
// odczyt originu publicznego z panelu otwartego na INNYM hoście zawsze pada.
// Spadek na same-origin jest uczciwy tylko wtedy, gdy host panelu należy do
// tego samego serwisu (`panelHostServesOrigin`) - inaczej względne
// `/sitemap.xml` to plik hosta panelu (marki albo tenanta domyślnego), a karta
// raportowałaby zielony stan CUDZEGO serwisu. W takim układzie wiersze mają
// stan „brak danych" z odesłaniem do linku „Otwórz", a „Pobierz" znika.
//
// Ekran kokpitu jest tylko do czytania (bramka `adminRouteAuthority.gate.test.ts`),
// więc tu nie ma żadnej mutacji - wyłącznie odczyty GET tego samego serwisu.
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Download, ExternalLink } from "@/lib/lucide-shim";
import { useTenantPublicOriginState } from "@/lib/seo/useTenantPublicOrigin";
import { panelHostServesOrigin } from "@/lib/seo/tenantPublicOrigin";
import { displayHost } from "@/lib/seo/socialNetworks";
// Karta woła wyłącznie klucze `adminSeoHub.*`. Bez tego importu nakładka
// wchodziła do chunka tylko wtedy, gdy wciągnął ją inny moduł kokpitu -
// renderowana samodzielnie pokazywała surowe klucze zamiast napisów.
import "@/lib/i18n-admin-seo-hub";
import {
  FOUNDATION_BODY_LIMIT,
  checkHtmlLang,
  checkLlms,
  checkRobots,
  checkSitemapFiles,
  worstFoundationState,
  type FoundationCheck,
  type FoundationProbe,
  type FoundationState,
} from "@/lib/seo/technicalFoundation";
import {
  sitemapChildPath,
  validateSitemapDocument,
  type SitemapFileReport,
  type SitemapIssue,
} from "@/lib/seo/sitemapValidation";

/**
 * Cztery powierzchnie: trzy pliki generowane i strona główna (atrybut lang).
 * Sondy celują w PUBLICZNY ORIGIN TENANTA - panel otwarty na hoście podglądu
 * ma raportować stan adresu publicznego, nie adresu tymczasowego (dla marki to
 * domena kanoniczna, dla tenanta z własną domeną - ta domena). Gdy przeglądarka
 * odmówi odczytu cross-origin (brak nagłówków CORS na domenie), wracamy do
 * same-origin TYLKO wtedy, gdy host panelu jest tym samym serwisem - wtedy
 * treść plików generowanych jest na obu hostach identyczna.
 */
const SITEMAP_PATH = "/sitemap.xml";
const PROBE_PATHS = [SITEMAP_PATH, "/robots.txt", "/llms.txt", "/"] as const;

/** Reguły plików tekstowych w kolejności `PROBE_PATHS` (bez mapy strony). */
const TEXT_RULES = [
  ["robots", checkRobots],
  ["llms", checkLlms],
  ["htmlLang", checkHtmlLang],
] as const;

/** Klucz fundamentu -> ścieżka pliku, który link „Otwórz" pokazuje. */
const OPEN_PATH: Record<string, string> = {
  sitemap: SITEMAP_PATH,
  robots: "/robots.txt",
  llms: "/llms.txt",
  htmlLang: "/",
};

/** Ile problemów jednego pliku pokazać wprost, zanim reszta zwinie się w licznik. */
const ISSUES_SHOWN = 5;

/**
 * Ile czekamy na JEDEN plik (nagłówki i całe ciało), zanim uznamy go za „brak
 * odpowiedzi". Bez terminu plik, który przyjmie połączenie i nigdy nie
 * skończy odpowiedzi, wstrzymywał całą kartę - także wyniki plików, które
 * odpowiedziały - czyli kokpit nie umiał pokazać dokładnie tej awarii, dla
 * której powstała tabela plików (przegląd PR #491).
 */
const PROBE_TIMEOUT_MS = 15_000;
const PROBE_TIMED_OUT = Symbol("probe-timed-out");

interface ProbeResponse {
  status: number;
  text: string;
  contentType: string | null;
}

/** Jedno pobranie pod terminem; po terminie żądanie jest przerywane. */
async function fetchWithin(
  target: string,
  ms: number,
): Promise<ProbeResponse | typeof PROBE_TIMED_OUT> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof PROBE_TIMED_OUT>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve(PROBE_TIMED_OUT);
    }, ms);
  });
  const work = (async (): Promise<ProbeResponse> => {
    const res = await fetch(target, { headers: { Accept: "*/*" }, signal: controller?.signal });
    return {
      status: res.status,
      text: await res.text(),
      contentType: res.headers?.get?.("content-type") ?? null,
    };
  })();
  // Odrzucenie po terminie (przerwane żądanie) nie może zostać nieobsłużone.
  work.catch(() => undefined);
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `null` = pliku nie da się odczytać Z TEGO HOSTA (cross-origin odrzucony,
 * a same-origin należy do innego serwisu) - to nie jest awaria pliku.
 * `limit` przycina ciało: plikom tekstowym wystarcza kilka kilobajtów, plik
 * mapy strony musi przyjść CAŁY, bo walidacja liczy każdy wpis.
 */
async function probe(
  origin: string,
  path: string,
  sameSiteFallback: boolean,
  limit = FOUNDATION_BODY_LIMIT,
): Promise<FoundationProbe | null> {
  const targets = sameSiteFallback ? [`${origin}${path}`, path] : [`${origin}${path}`];
  for (const target of targets) {
    try {
      const res = await fetchWithin(target, PROBE_TIMEOUT_MS);
      // Plik, który nie odpowiedział w terminie, nie odpowie też pod drugim
      // adresem tego samego serwisu - to nie odmowa CORS, tylko awaria.
      if (res === PROBE_TIMED_OUT) break;
      return {
        status: res.status,
        body: Number.isFinite(limit) ? res.text.slice(0, limit) : res.text,
        contentType: res.contentType,
      };
    } catch {
      // Błąd sieci na originie publicznym - próbujemy same-origin (o ile to ten
      // sam serwis); 0 czyta się jako „brak odpowiedzi" i nie wywraca kokpitu.
    }
  }
  return sameSiteFallback ? { status: 0, body: "" } : null;
}

/** Plik mapy strony w tabeli: ścieżka (do linków) + raport walidacji. */
interface SitemapFileRow {
  path: string;
  report: SitemapFileReport;
}

/**
 * Indeks i KAŻDY plik, na który wskazuje. `null` = indeksu nie da się odczytać
 * z tego hosta (patrz „granica wiarygodności"). Pliki sekcji pobieramy pod
 * ŚCIEŻKĄ z indeksu, ale na sondowanym originie - indeks podaje adresy na
 * originie kanonicznym także wtedy, gdy panel działa na hoście podglądu.
 */
async function probeSitemapFiles(
  origin: string,
  sameSite: boolean,
  expectedHost: string,
): Promise<SitemapFileRow[] | null> {
  const index = await probe(origin, SITEMAP_PATH, sameSite, Number.POSITIVE_INFINITY);
  if (!index) return null;
  const indexReport = validateSitemapDocument({
    url: `${origin}${SITEMAP_PATH}`,
    ...index,
    expectedHost,
  });
  const rows: SitemapFileRow[] = [{ path: SITEMAP_PATH, report: indexReport }];
  if (indexReport.kind !== "index") return rows;
  const children = await Promise.all(
    indexReport.children.map(async (loc): Promise<SitemapFileRow> => {
      const path = sitemapChildPath(loc) ?? loc;
      const file = await probe(origin, path, sameSite, Number.POSITIVE_INFINITY);
      return {
        path,
        report: validateSitemapDocument({
          url: loc,
          status: file?.status ?? 0,
          body: file?.body ?? "",
          contentType: file?.contentType ?? null,
          expectedHost,
        }),
      };
    }),
  );
  return [...rows, ...children];
}

interface FoundationResult {
  checks: FoundationCheck[];
  /** `null` = indeks nieczytelny z tego hosta - tabeli plików nie ma. */
  sitemapFiles: SitemapFileRow[] | null;
}

const TONE: Record<FoundationState, string> = {
  ok: "text-emerald-500",
  warn: "text-brand",
  fail: "text-destructive",
  unknown: "text-muted-foreground",
};

const ISSUE_TONE: Record<SitemapIssue["severity"], string> = {
  error: "text-destructive",
  warning: "text-brand",
  info: "text-muted-foreground",
};

// Pliki do pobrania - same-origin, żeby atrybut `download` zadziałał
// (przeglądarka ignoruje go dla adresów z innej domeny). Celowo NIE origin
// publiczny tenanta - ale wyłącznie wtedy, gdy host panelu jest tym samym
// serwisem; inaczej plik same-origin należy do kogoś innego i link znika.
const DOWNLOAD: Record<string, { href: string; file: string }> = {
  sitemap: { href: SITEMAP_PATH, file: "sitemap.xml" },
  robots: { href: "/robots.txt", file: "robots.txt" },
  llms: { href: "/llms.txt", file: "llms.txt" },
};

/** Nazwa pobieranego pliku sekcji: ostatni segment ścieżki (`core.xml`). */
function fileNameOf(path: string): string {
  const segment = path.split("?")[0]?.split("/").filter(Boolean).pop();
  return segment || "sitemap.xml";
}

/** Data `lastmod` do tabeli - sama data, bez godziny (godzina bywa w UTC). */
function shortDate(value: string | null): string {
  return value ? value.slice(0, 10) : "-";
}

export function TechnicalFoundationCard() {
  const { t } = useTranslation();
  // Linki „Otwórz" prowadzą na TEN SAM origin, który sondujemy - audytor ma
  // zobaczyć publiczny plik swojego serwisu, nie jego kopię na hoście podglądu
  // ani plik innego tenanta.
  const { origin, host, status, retry } = useTenantPublicOriginState();
  const sameSite = panelHostServesOrigin(host, origin);
  const publicHost = origin ? displayHost(origin) : "";
  const { data, isPending, isFetching, refetch } = useQuery({
    // Origin i „ten sam serwis" w kluczu: wynik sond należy do konkretnego
    // serwisu oglądanego z konkretnego hosta. Sondy ruszają WYŁĄCZNIE po
    // udanym odczycie domeny - ani w locie, ani po błędzie (origin tymczasowy
    // to wtedy host karty, a jego pliki mogą być plikami marki).
    queryKey: ["admin-seo-foundation", origin, sameSite],
    enabled: status === "resolved" && origin !== null,
    // Same-origin GET-y, więc odświeżanie przy każdym wejściu na zakładkę jest
    // tanie; minuta świeżości wystarcza po publikacji.
    staleTime: 60_000,
    queryFn: async (): Promise<FoundationResult> => {
      const base = origin ?? "";
      let expectedHost = publicHost;
      try {
        expectedHost = new URL(base).host;
      } catch {
        /* origin bez schematu - zostaje host do wyświetlenia */
      }
      const [sitemapFiles, ...textProbes] = await Promise.all([
        probeSitemapFiles(base, sameSite, expectedHost),
        ...PROBE_PATHS.slice(1).map((path) => probe(base, path, sameSite)),
      ]);
      const crossHost = (id: string): FoundationCheck => ({
        id,
        state: "unknown",
        detailKey: "foundationCrossHost",
        detailValue: publicHost,
      });
      const sitemapCheck = sitemapFiles
        ? checkSitemapFiles(sitemapFiles.map((row) => row.report))
        : crossHost("sitemap");
      const textChecks = TEXT_RULES.map(([id, rule], index): FoundationCheck => {
        const result = textProbes[index];
        return result ? rule(result) : crossHost(id);
      });
      return { checks: [sitemapCheck, ...textChecks], sitemapFiles };
    },
  });

  const checks = data?.checks ?? [];
  const sitemapFiles = data?.sitemapFiles ?? null;
  const worst = worstFoundationState(checks);

  // Odczyt domeny padł: nie sondujemy originu tymczasowego, tylko mówimy to
  // wprost i dajemy ponowienie.
  if (status === "failed") {
    return (
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{t("adminSeoHub.sectionFoundation")}</h2>
        <p className="text-xs text-muted-foreground" data-seo-foundation-origin="failed">
          {t("adminSeoHub.foundationOriginFailed")}
        </p>
        <button
          type="button"
          onClick={retry}
          className="text-xs font-medium text-brand hover:underline"
        >
          {t("adminSeoHub.foundationOriginRetry")}
        </button>
      </section>
    );
  }

  // Tenant bez publicznej domeny: nie ma czego sondować, a spadek na host
  // karty pokazałby pliki marki.
  if (status === "resolved" && origin === null) {
    return (
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{t("adminSeoHub.sectionFoundation")}</h2>
        <p className="text-xs text-muted-foreground" data-seo-foundation-origin="none">
          {t("adminSeoHub.noPublicDomain")}
        </p>
      </section>
    );
  }

  const issueText = (issue: SitemapIssue): string => {
    const code = issue.code === "http" && issue.value === "0" ? "network" : issue.code;
    const parts = [
      t(`adminSeoHub.sitemapIssue_${code}`, {
        tag: issue.tag ?? "",
        parent: issue.parent ?? "",
        value: issue.value ?? "",
      }),
    ];
    if (issue.line !== undefined) parts.push(t("adminSeoHub.sitemapIssueLine", { n: issue.line }));
    if (issue.count > 1) parts.push(t("adminSeoHub.sitemapIssueCount", { n: issue.count }));
    return parts.join(" · ");
  };

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">{t("adminSeoHub.sectionFoundation")}</h2>
      <p className="text-xs text-muted-foreground">{t("adminSeoHub.foundationIntro")}</p>
      {!isPending && !sameSite ? (
        <p className="text-xs text-brand" data-seo-foundation-cross-host>
          {t("adminSeoHub.foundationCrossHostNote", { value: publicHost })}
        </p>
      ) : null}

      {isPending ? (
        <p className="text-xs text-muted-foreground">{t("admin.loading")}</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border" data-seo-foundation>
          <table className="w-full text-sm">
            <tbody>
              {checks.map((check) => (
                <tr key={check.id} className="border-b border-border last:border-0">
                  <td className="w-1/3 px-3 py-2 align-top font-medium">
                    {t(`adminSeoHub.foundation_${check.id}`)}
                  </td>
                  <td
                    className={`w-24 px-3 py-2 align-top text-xs font-medium ${TONE[check.state]}`}
                  >
                    {t(`adminSeoHub.foundationState_${check.state}`)}
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                    {t(`adminSeoHub.${check.detailKey}`, {
                      value: check.detailValue ?? "",
                      ...check.detailParams,
                    })}
                  </td>
                  <td className="w-40 px-3 py-2 text-right align-top">
                    <span className="inline-flex flex-wrap justify-end gap-3">
                      {/* Pliki generowane nie są trasami routera - zwykłe <a>. */}
                      <a
                        href={`${origin ?? ""}${OPEN_PATH[check.id] ?? "/"}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-brand hover:underline"
                      >
                        {t("adminSeoHub.open")}
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                      {sameSite && DOWNLOAD[check.id] ? (
                        <a
                          href={DOWNLOAD[check.id]?.href}
                          download={DOWNLOAD[check.id]?.file}
                          data-seo-download={check.id}
                          className="inline-flex items-center gap-1 text-brand hover:underline"
                        >
                          {t("adminSeoHub.download")}
                          <Download className="h-3 w-3 shrink-0" />
                        </a>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isPending && worst === "ok" ? (
        <p className="text-xs text-emerald-500">{t("adminSeoHub.foundationAllGood")}</p>
      ) : null}

      {!isPending && sitemapFiles && sitemapFiles.length > 0 ? (
        <div className="space-y-2 pt-2" data-seo-sitemap-files>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">{t("adminSeoHub.sitemapFilesTitle")}</h3>
            <button
              type="button"
              onClick={() => void refetch()}
              disabled={isFetching}
              data-seo-sitemap-recheck
              className="text-xs font-medium text-brand hover:underline disabled:opacity-60"
            >
              {isFetching ? t("adminSeoHub.sitemapChecking") : t("adminSeoHub.sitemapRecheck")}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("adminSeoHub.sitemapFilesIntro")}{" "}
            {/* Stan tych samych plików w Google i ponowne przesłanie mieszkają
                w zakładce Search Console - kokpit jest tylko do czytania. */}
            <a
              href="/admin/seo/search-console"
              data-seo-sitemap-google
              className="font-medium text-brand hover:underline"
            >
              {t("adminSeoHub.sitemapGoogleLink")} &rarr;
            </a>
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
                  <th className="px-3 py-2 font-medium">{t("adminSeoHub.sitemapColFile")}</th>
                  <th className="w-20 px-3 py-2 font-medium">{t("adminSeoHub.sitemapColState")}</th>
                  <th className="w-32 px-3 py-2 font-medium">
                    {t("adminSeoHub.sitemapColEntries")}
                  </th>
                  <th className="px-3 py-2 font-medium">{t("adminSeoHub.sitemapColIssues")}</th>
                  <th className="w-40 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {sitemapFiles.map(({ path, report }) => {
                  const shown = report.issues.slice(0, ISSUES_SHOWN);
                  const hidden = report.issues.length - shown.length;
                  return (
                    <tr
                      key={path}
                      data-seo-sitemap-file={path}
                      data-state={report.state}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-3 py-2 align-top">
                        <div className="break-all font-mono text-xs">{path}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {t(`adminSeoHub.sitemapKind_${report.kind}`)}
                        </div>
                      </td>
                      <td
                        className={`px-3 py-2 align-top text-xs font-medium ${TONE[report.state]}`}
                      >
                        {t(`adminSeoHub.foundationState_${report.state}`)}
                      </td>
                      <td className="px-3 py-2 align-top text-xs tabular-nums text-muted-foreground">
                        {report.status === 200 && report.kind !== "unknown" ? (
                          <>
                            <div>
                              {t(`adminSeoHub.sitemapEntries_${report.kind}`, {
                                n: report.kind === "news" ? report.newsEntries : report.entries,
                              })}
                            </div>
                            <div>
                              {t("adminSeoHub.sitemapLastmod", {
                                value: shortDate(report.newestLastmod),
                              })}
                            </div>
                          </>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="px-3 py-2 align-top text-xs">
                        {shown.length === 0 ? (
                          <span className="text-emerald-500">
                            {t("adminSeoHub.sitemapNoIssues")}
                          </span>
                        ) : (
                          <ul className="space-y-1">
                            {shown.map((issue) => (
                              <li
                                key={`${issue.code}|${issue.tag ?? ""}|${issue.parent ?? ""}`}
                                data-seo-sitemap-issue={issue.code}
                                className={ISSUE_TONE[issue.severity]}
                              >
                                {issueText(issue)}
                              </li>
                            ))}
                            {hidden > 0 ? (
                              <li className="text-muted-foreground">
                                {t("adminSeoHub.sitemapIssuesMore", { n: hidden })}
                              </li>
                            ) : null}
                          </ul>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right align-top text-xs">
                        <span className="inline-flex flex-wrap justify-end gap-3">
                          <a
                            href={`${origin ?? ""}${path}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-brand hover:underline"
                          >
                            {t("adminSeoHub.open")}
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                          {sameSite ? (
                            <a
                              href={path}
                              download={fileNameOf(path)}
                              data-seo-sitemap-download={path}
                              className="inline-flex items-center gap-1 text-brand hover:underline"
                            >
                              {t("adminSeoHub.download")}
                              <Download className="h-3 w-3 shrink-0" />
                            </a>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
