// Biblioteka materiałów członkowskich (/library). Metadane są publiczne
// (teaser z kłódką), ale sam plik pobiera się przez server fn
// downloadMemberResource: baza egzekwuje bramkę rangi warstwy i loguje pobranie
// (historia uczestnictwa), a URL powstaje dopiero po autoryzacji.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Download,
  Lock,
  FileText,
  FileBarChart,
  Presentation,
  FileType,
  Database,
} from "lucide-react";
import { fetchLibraryResources, type PublicResource } from "@/lib/community/publicQueries";
import { downloadMemberResource } from "@/lib/billing/resources.functions";
import { useCurrentTier } from "@/lib/billing/tiers";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import "@/lib/i18n-library";

export const Route = createFileRoute("/library")({
  component: LibraryPage,
  head: () => {
    const lang = activeLang(getRequestUrl() || "/library");
    return {
      meta: [
        { title: lang === "en" ? "Members' library" : "Biblioteka materiałów" },
        {
          name: "description",
          content:
            lang === "en"
              ? "Reports, briefings and data for New European Strategies members."
              : "Raporty, briefingi i dane dla członków New European Strategies.",
        },
      ],
    };
  },
});

const CATEGORY_ICON: Record<string, typeof FileText> = {
  report: FileBarChart,
  brief: FileText,
  transcript: FileType,
  slides: Presentation,
  data: Database,
  other: FileText,
};

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function LibraryPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const { user } = useAuth();
  const resourcesQ = useQuery({ queryKey: ["library-resources"], queryFn: fetchLibraryResources });
  const currentTier = useCurrentTier();
  const myRank = currentTier.data?.rank ?? 0;

  return (
    <div className="container mx-auto max-w-5xl px-4 py-12 md:py-16">
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-bold tracking-tight md:text-5xl">{t("library.title")}</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
          {t("library.subtitle")}
        </p>
        {!user && <p className="mt-3 text-sm text-muted-foreground">{t("library.signInHint")}</p>}
      </header>

      {resourcesQ.isLoading ? (
        <p className="text-center text-muted-foreground">{t("library.loading")}</p>
      ) : resourcesQ.isError ? (
        <p className="text-center text-muted-foreground">{t("library.loadError")}</p>
      ) : (resourcesQ.data?.length ?? 0) === 0 ? (
        <p className="text-center text-muted-foreground">{t("library.empty")}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {resourcesQ.data!.map((r) => (
            <ResourceCard key={r.id} resource={r} lang={lang} myRank={myRank} signedIn={!!user} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ResourceCard({
  resource,
  lang,
  myRank,
  signedIn,
}: {
  resource: PublicResource;
  lang: "pl" | "en";
  myRank: number;
  signedIn: boolean;
}) {
  const { t } = useTranslation();
  const download = useServerFn(downloadMemberResource);
  const [busy, setBusy] = useState(false);

  const title =
    lang === "en" ? resource.title_en || resource.title_pl : resource.title_pl || resource.title_en;
  const desc = lang === "en" ? resource.description_en : resource.description_pl;
  const Icon = CATEGORY_ICON[resource.category] ?? FileText;
  const locked = myRank < resource.min_tier_rank;

  const onDownload = async () => {
    setBusy(true);
    try {
      const res = await download({ data: { resourceId: resource.id } });
      if (res.ok) {
        window.open(res.url, "_blank", "noopener");
      } else if (res.error === "tier_required") {
        toast.error(t("library.tierErrorToast"));
      } else {
        toast.error(t("library.downloadErrorToast"));
      }
    } catch {
      toast.error(t("library.downloadErrorToast"));
    } finally {
      setBusy(false);
    }
  };

  const size = formatBytes(resource.file_size);

  return (
    <li className="flex flex-col rounded-lg border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 rounded bg-muted px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          {t(`library.categories.${resource.category}`, { defaultValue: resource.category })}
        </span>
        {locked && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        )}
      </div>

      <h2 className="mt-3 text-base font-semibold leading-snug">{title}</h2>
      {desc && <p className="mt-1.5 line-clamp-3 text-sm text-muted-foreground">{desc}</p>}

      <div className="mt-2 text-xs text-muted-foreground">
        {size && <span>{size}</span>}
        {resource.download_count > 0 && (
          <>
            {size && <span aria-hidden="true"> · </span>}
            <span>{t("library.downloads", { count: resource.download_count })}</span>
          </>
        )}
      </div>

      <div className="mt-auto pt-4">
        {locked ? (
          <Button asChild variant="outline" size="sm" className="w-full">
            <Link to="/pricing">
              <Lock className="mr-2 h-4 w-4" aria-hidden="true" />
              {t("library.upgradeCta")}
            </Link>
          </Button>
        ) : !signedIn ? (
          <Button asChild variant="outline" size="sm" className="w-full">
            <Link to="/login">{t("library.signInHint")}</Link>
          </Button>
        ) : (
          <Button size="sm" className="w-full" disabled={busy} onClick={onDownload}>
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            {busy ? t("library.preparing") : t("library.download")}
          </Button>
        )}
      </div>
    </li>
  );
}
