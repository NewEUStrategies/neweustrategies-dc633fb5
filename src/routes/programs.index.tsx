import { createFileRoute, Link, type ErrorComponentProps } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import { ArchiveSkeleton } from "@/components/archive/ArchiveSkeleton";
import { ProgramIcon } from "@/components/programs/ProgramIcon";
import { DegradedDataNotice } from "@/components/molecules/DegradedDataNotice";
import {
  latestProgramsQueryOptions,
  PROGRAMS_INDEX_LIMIT,
  type Program,
} from "@/lib/queries/programs";
import { loadResilient, resilientCacheControl } from "@/lib/ssr/resilientLoad";
import { setCacheControlHeader } from "@/lib/http/responseHeaders";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { safeAccent, accentRgba } from "@/lib/programs/visual";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead } from "@/lib/seo/meta";
import { breadcrumbListJsonLd, safeJsonLd } from "@/lib/seo/jsonld";
import { ensureI18n as ensureProgramsI18n } from "@/lib/i18n-programs";

/** Pusta lista jako fallback zdegradowanego renderu (lib/ssr/resilientLoad). */
const NO_PROGRAMS: Program[] = [];

export const Route = createFileRoute("/programs/")({
  // Odporne SSR: blip backendu daje HTTP 200 z uczciwym komunikatem zamiast
  // 500 (patrz lib/ssr/resilientLoad); zdegradowany render omija cache wspólny.
  loader: async ({ context }) => {
    const { degraded } = await loadResilient(
      context.queryClient,
      latestProgramsQueryOptions(PROGRAMS_INDEX_LIMIT),
      NO_PROGRAMS,
    );
    setCacheControlHeader(resilientCacheControl(degraded));
    return { degraded };
  },
  head: () => {
    const url = getRequestUrl() || "/programs";
    const lang = activeLang(url);
    let origin = "";
    try {
      origin = new URL(url).origin;
    } catch {
      /* relative URL in tests */
    }
    const title =
      lang === "en"
        ? "Research programs - New European Strategies"
        : "Programy badawcze - New European Strategies";
    const description =
      lang === "en"
        ? "Our research programs on Europe's security, economy and foreign policy - each with its own team, projects, publications and events."
        : "Nasze programy badawcze o bezpieczeństwie, gospodarce i polityce zagranicznej Europy - każdy z własnym zespołem, projektami, publikacjami i wydarzeniami.";
    const head = buildContentHead({ url, lang, type: "website", title, description });
    const breadcrumbs = breadcrumbListJsonLd(
      [{ label: lang === "en" ? "Research programs" : "Programy badawcze", href: "/programs" }],
      origin,
      lang,
    );
    return {
      ...head,
      scripts: [{ type: "application/ld+json", children: safeJsonLd(breadcrumbs) }],
    };
  },
  component: ProgramsIndex,
  pendingComponent: () => <ArchiveSkeleton />,
  // Nagłówek błędu idzie ze SŁOWNIKA: `errorComponent` renderuje się jak każdy
  // inny komponent, więc `t()` jest tu dostępne. Wersja z `activeLang()` była
  // drugim, równoległym zestawem literałów - bramka parytetu PL/EN nie miała
  // czego porównać, a angielska gałąź mówiła coś innego niż słownik.
  errorComponent: (props) => <ProgramsIndexError {...props} />,
});

function ProgramsIndexError(props: ErrorComponentProps) {
  ensureProgramsI18n();
  const { t } = useTranslation();
  return <RouteErrorFallback {...props} title={t("programs.loadFailedList")} />;
}

function ProgramCard({ program, lang }: { program: Program; lang: "pl" | "en" }) {
  // `lang` zostaje WYŁĄCZNIE do wyboru bliźniaczej kolumny treści
  // (`name_pl`/`name_en`); etykieta interfejsu idzie przez `t()`.
  const { t } = useTranslation();
  const accent = safeAccent(program.accent_color);
  const name = pickLocalized(program, "name", lang);
  const tagline = pickLocalized(program, "tagline", lang);
  return (
    <Link
      to="/programs/$slug"
      params={{ slug: program.slug }}
      className="group flex flex-col gap-4 p-6 rounded-xl border border-border bg-card hover:border-transparent transition-colors relative overflow-hidden"
      style={{ ["--accent" as string]: accent }}
    >
      <span
        className="absolute inset-x-0 top-0 h-1"
        style={{ backgroundColor: accent }}
        aria-hidden="true"
      />
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
        style={{ backgroundColor: accentRgba(accent, 0.12), color: accent }}
      >
        <ProgramIcon name={program.icon} className="w-6 h-6" />
      </div>
      <div className="space-y-1.5 flex-1">
        <h2 className="font-display text-xl leading-snug">{name}</h2>
        {tagline && <p className="text-sm text-muted-foreground line-clamp-3">{tagline}</p>}
      </div>
      <span
        className="inline-flex items-center gap-1 text-sm font-medium"
        style={{ color: accent }}
      >
        {t("programs.explore")}
        <ArrowRight
          className="w-4 h-4 transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </span>
    </Link>
  );
}

function ProgramsIndex() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureProgramsI18n();
  const { data: programs } = useSuspenseQuery(latestProgramsQueryOptions(PROGRAMS_INDEX_LIMIT));
  const { degraded } = Route.useLoaderData();
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";

  return (
    <div className="container mx-auto px-4 py-10 max-w-5xl space-y-8">
      <header className="space-y-3 max-w-2xl">
        <h1 className="font-display text-3xl lg:text-4xl">{t("programs.indexTitle")}</h1>
        <p className="text-base text-muted-foreground">{t("programs.indexIntro")}</p>
      </header>

      {degraded ? (
        // „Brak programów" i „nie udało się pobrać" to dwie różne prawdy.
        <DegradedDataNotice title={t("programs.loadFailedList")} />
      ) : programs.length === 0 ? (
        <p className="text-sm text-muted-foreground py-16 text-center">{t("programs.empty")}</p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {programs.map((p) => (
            <ProgramCard key={p.id} program={p} lang={lang} />
          ))}
        </div>
      )}
    </div>
  );
}
