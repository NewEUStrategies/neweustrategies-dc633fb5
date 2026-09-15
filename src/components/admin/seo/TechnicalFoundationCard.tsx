// KARTA FUNDAMENTÓW TECHNICZNYCH na kokpicie SEO.
//
// Odpowiada na pytanie, które przynosi każdy zewnętrzny audyt: „czy mapa strony
// naprawdę istnieje" i „czy dokument deklaruje język". Zamiast wierzyć raportowi
// skanera (bywa nieświeży o wiele godzin), karta POBIERA cztery powierzchnie
// z bieżącego origin i ocenia je regułami z `@/lib/seo/technicalFoundation`.
//
// Ekran kokpitu jest tylko do czytania (bramka `adminRouteAuthority.gate.test.ts`),
// więc tu nie ma żadnej mutacji - wyłącznie odczyty GET tego samego serwisu.
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "@/lib/lucide-shim";
import {
  FOUNDATION_BODY_LIMIT,
  checkHtmlLang,
  checkLlms,
  checkRobots,
  checkSitemap,
  worstFoundationState,
  type FoundationCheck,
  type FoundationProbe,
  type FoundationState,
} from "@/lib/seo/technicalFoundation";

/** Cztery powierzchnie: trzy pliki generowane i strona główna (atrybut lang). */
const PROBE_PATHS = ["/sitemap.xml", "/robots.txt", "/llms.txt", "/"] as const;

async function probe(path: string): Promise<FoundationProbe> {
  try {
    const res = await fetch(path, { headers: { Accept: "*/*" } });
    const text = await res.text();
    return { status: res.status, body: text.slice(0, FOUNDATION_BODY_LIMIT) };
  } catch {
    // Błąd sieci nie może wywrócić kokpitu - 0 czyta się jako „brak odpowiedzi".
    return { status: 0, body: "" };
  }
}

const TONE: Record<FoundationState, string> = {
  ok: "text-emerald-500",
  warn: "text-amber-500",
  fail: "text-destructive",
  unknown: "text-muted-foreground",
};

const OPEN_HREF: Record<string, string> = {
  sitemap: "/sitemap.xml",
  robots: "/robots.txt",
  llms: "/llms.txt",
  htmlLang: "/",
};

export function TechnicalFoundationCard() {
  const { t } = useTranslation();
  const { data, isPending } = useQuery({
    queryKey: ["admin-seo-foundation"],
    // Same-origin GET-y, więc odświeżanie przy każdym wejściu na zakładkę jest
    // tanie; minuta świeżości wystarcza po publikacji.
    staleTime: 60_000,
    queryFn: async (): Promise<FoundationCheck[]> => {
      const [sitemap, robots, llms, home] = await Promise.all(PROBE_PATHS.map(probe));
      return [checkSitemap(sitemap!), checkRobots(robots!), checkLlms(llms!), checkHtmlLang(home!)];
    },
  });

  const checks = data ?? [];
  const worst = worstFoundationState(checks);

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">{t("adminSeoHub.sectionFoundation")}</h2>
      <p className="text-xs text-muted-foreground">{t("adminSeoHub.foundationIntro")}</p>

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
                    {t(`adminSeoHub.${check.detailKey}`, { value: check.detailValue ?? "" })}
                  </td>
                  <td className="w-24 px-3 py-2 text-right align-top">
                    {/* Pliki generowane nie są trasami routera - zwykłe <a>. */}
                    <a
                      href={OPEN_HREF[check.id] ?? "/"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-brand hover:underline"
                    >
                      {t("adminSeoHub.open")}
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
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
    </section>
  );
}
