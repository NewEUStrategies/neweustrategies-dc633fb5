// Biblioteka klubu - wspólny zestaw źródeł jednej dyskusji.
//
// PO CO ONA ISTNIEJE. Rozmowa o zapasach amunicji w regionie bez wspólnego
// zestawu źródeł to rozmowa, w której każdy cytuje co innego. Wątek rodzaju
// `resource` pozwalał wkleić link W TREŚCI - czyli pochować go pod
// czterdziestoma odpowiedziami. Biblioteka odwraca to: dokument jest bytem
// pierwszej klasy, ma rodzaj, wersję, źródło i miejsce w dyskusji.
//
// FILTR RODZAJU JEST PASKIEM CHIPÓW, nie droplistą: rodzajów jest osiem,
// wybór jest jednym kliknięciem, a na liście filtrów widać od razu, co
// w klubie w ogóle jest. Droplista chowa tę informację za kliknięciem.
//
// WYSZUKIWANIE ZASTĘPUJE listę, tak jak na stronie klubu - dwie listy naraz na
// telefonie znaczą, że użytkownik nie wie, którą czyta.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  Award,
  BookOpen,
  Download,
  ExternalLink,
  FileQuestion,
  Library,
  Link2,
  Lock,
  Pin,
  Search,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useClubDocuments, type ClubDocumentScope } from "@/lib/clubs/useClubWorkspace";
import { registerClubDocumentDownload } from "@/lib/clubs/workspaceApi";
import {
  CLUB_DOCUMENT_KINDS,
  CLUB_PRODUCT_KINDS,
  CLUB_SOURCE_KINDS,
  documentHref,
  toDocumentKind,
  toDocumentStatus,
  toDocumentVisibility,
  type ClubDocumentRow,
} from "@/lib/clubs/workspaceTypes";
import { ClubSegmented } from "@/components/clubs/atoms/ClubHubPrimitives";
import {
  ClubDocumentKindChip,
  ClubDocumentKindIcon,
} from "@/components/clubs/atoms/ClubWorkspaceBadges";
import { ClubDocumentsSkeleton } from "@/components/clubs/atoms/ClubWorkspaceSkeletons";
import { ClubErrorNotice } from "@/components/clubs/molecules/ClubErrorNotice";
import { formatDateShort, uiLang, uiLocale } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";

const PAGE = 30;

/** Trzy zakresy biblioteki - patrz `ClubDocumentScope`. */
const SCOPES: readonly ClubDocumentScope[] = ["all", "products", "sources"];
const SCOPE_ICONS = {
  all: Library,
  products: Award,
  sources: BookOpen,
} as const satisfies Record<ClubDocumentScope, typeof Library>;

/** Rozmiar pliku w jednostce, którą człowiek czyta bez liczenia zer. */
function formatBytes(bytes: number | null, locale: string): string | null {
  if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) return null;
  const units = ["B", "kB", "MB", "GB"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded.toLocaleString(locale)} ${units[unit]}`;
}

function DocumentRow({
  row,
  clubSlug,
  locale,
}: {
  row: ClubDocumentRow;
  clubSlug: string;
  locale: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const kind = toDocumentKind(row.kind);
  const visibility = toDocumentVisibility(row.visibility);
  const status = toDocumentStatus(row.status);
  const href = documentHref(row);
  const title = pickLocalized(row, "title", lang);
  const summary = pickLocalized(row, "summary", lang);
  const size = formatBytes(row.file_size, locale);
  // Plik pobieramy, link otwieramy. To nie jest kosmetyka: `download` na
  // adresie z innej domeny i tak zostanie zignorowany przez przeglądarkę,
  // a `target="_blank"` na własnym pliku otwiera pustą kartę z PDF-em.
  const isFile = row.file_url !== null && row.file_url.trim() !== "";

  return (
    <article
      className={cn(
        "flex gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-primary/40",
        row.pinned_at !== null ? "border-primary/40" : "border-border/60",
      )}
      data-testid="club-document-row"
    >
      <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/40">
        <ClubDocumentKindIcon kind={kind} className="h-5 w-5 text-muted-foreground" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <ClubDocumentKindChip kind={kind} />
          {row.pinned_at !== null ? (
            <Badge variant="outline" className="gap-1 text-[11px]">
              <Pin className="h-3 w-3" aria-hidden="true" />
              {t("club.docs.pinned")}
            </Badge>
          ) : null}
          {/* Widoczność i szkic pokazujemy TYLKO wtedy, gdy odbiegają od
              normy - odznaka "opublikowany" przy każdym wierszu nie niesie
              żadnej informacji. */}
          {visibility === "moderators" ? (
            <Badge variant="outline" className="gap-1 text-[11px]">
              <Lock className="h-3 w-3" aria-hidden="true" />
              {t("club.docs.visibility.moderators")}
            </Badge>
          ) : null}
          {status !== "published" ? (
            <Badge variant="secondary" className="text-[11px]">
              {t(`club.docs.status.${status}`)}
            </Badge>
          ) : null}
        </div>

        <h3 className="mt-1.5 font-medium leading-tight">
          {href !== null ? (
            <a
              href={href}
              target={isFile ? undefined : "_blank"}
              rel={isFile ? undefined : "noreferrer"}
              download={isFile ? "" : undefined}
              onClick={() => void registerClubDocumentDownload(row.id)}
              className="hover:text-primary"
            >
              {title}
            </a>
          ) : (
            title
          )}
        </h3>

        {summary !== null && summary.trim() !== "" ? (
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{summary}</p>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{formatDateShort(row.published_at ?? row.created_at, lang)}</span>
          {row.version !== null && row.version.trim() !== "" ? (
            <span>{t("club.docs.version", { value: row.version })}</span>
          ) : null}
          {size !== null ? <span>{size}</span> : null}
          {row.source_label !== null && row.source_label.trim() !== "" ? (
            <span className="truncate">{t("club.docs.source", { value: row.source_label })}</span>
          ) : null}
          {row.uploader_name !== null ? <span>{row.uploader_name}</span> : null}
          {/* Krawędź do dyskusji: dokument, którego nie da się połączyć
              z wątkiem, jest załącznikiem, a nie materiałem deliberacji. */}
          {row.thread_slug !== null ? (
            <Link
              to="/club/$clubSlug/t/$threadSlug"
              params={{ clubSlug, threadSlug: row.thread_slug }}
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              <Link2 className="h-3 w-3" aria-hidden="true" />
              {t("club.docs.linkedThread")}
            </Link>
          ) : null}
        </div>
      </div>

      {href !== null ? (
        <Button asChild variant="outline" size="sm" className="mt-0.5 shrink-0 self-start">
          <a
            href={href}
            target={isFile ? undefined : "_blank"}
            rel={isFile ? undefined : "noreferrer"}
            download={isFile ? "" : undefined}
            onClick={() => void registerClubDocumentDownload(row.id)}
          >
            {isFile ? (
              <Download className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
            ) : (
              <ExternalLink className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
            )}
            <span className="sr-only sm:not-sr-only">
              {isFile ? t("club.docs.download") : t("club.docs.open")}
            </span>
          </a>
        </Button>
      ) : null}
    </article>
  );
}

export function ClubDocumentLibrary({ clubId, clubSlug }: { clubId: string; clubSlug: string }) {
  const { t, i18n } = useTranslation();
  const locale = uiLocale(i18n.language);

  const [scope, setScope] = useState<ClubDocumentScope>("all");
  const [kind, setKind] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const debounced = useDebouncedValue(query, 250);

  const documentsQ = useClubDocuments({
    clubId,
    kind,
    scope,
    search: debounced,
    offset: page * PAGE,
    limit: PAGE,
  });

  const rows = documentsQ.data?.rows ?? [];
  const total = documentsQ.data?.total ?? 0;
  const filtered = kind !== null || scope !== "all" || debounced.trim().length >= 2;

  // Chipy rodzaju idą za zakresem: rodzaj spoza zakresu zwróciłby pustkę,
  // więc pokazywanie go byłoby obietnicą bez pokrycia. Zmiana zakresu zeruje
  // rodzaj z tego samego powodu.
  const kindsInScope: readonly string[] =
    scope === "products"
      ? CLUB_PRODUCT_KINDS
      : scope === "sources"
        ? CLUB_SOURCE_KINDS
        : CLUB_DOCUMENT_KINDS;

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder={t("club.docs.searchPlaceholder")}
            aria-label={t("club.docs.searchPlaceholder")}
            className="pl-9 pr-9"
          />
          {query !== "" ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setPage(0);
              }}
              aria-label={t("club.searchClear")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <p className="self-center text-sm text-muted-foreground sm:text-right">
          {t("club.docs.count", { count: total })}
        </p>
      </div>

      {/* ZAKRES stoi NAD rodzajem, bo to jest inne pytanie: rodzaj zawęża
          jeden zbiór, a zakres wybiera, o który zbiór w ogóle chodzi -
          o to, co klub WYTWORZYŁ, czy o to, z czego PRACUJE. */}
      <div className="space-y-2">
        <ClubSegmented
          value={scope}
          options={SCOPES.map((value) => ({
            value,
            label: t(`club.docs.scope.${value}`),
            icon: SCOPE_ICONS[value],
          }))}
          onChange={(next) => {
            setScope(next);
            setKind(null);
            setPage(0);
          }}
          ariaLabel={t("club.docs.scope.all")}
        />
        {scope !== "all" ? (
          <p className="text-xs text-muted-foreground">
            {t(
              scope === "products" ? "club.docs.scope.productsHint" : "club.docs.scope.sourcesHint",
            )}
          </p>
        ) : null}
      </div>

      {/* Pasek rodzajów - patrz nagłówek pliku. */}
      <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
        <button
          type="button"
          onClick={() => {
            setKind(null);
            setPage(0);
          }}
          aria-pressed={kind === null}
          className={cn(
            "shrink-0 rounded-full border px-3 py-1 text-[11px] font-medium leading-none transition-colors sm:text-xs",
            kind === null
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border/60 bg-card text-muted-foreground hover:border-primary/40",
          )}
        >
          {t("club.docs.kindAll")}
        </button>
        {kindsInScope.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setKind(kind === value ? null : value);
              setPage(0);
            }}
            aria-pressed={kind === value}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1 text-[11px] font-medium leading-none transition-colors sm:text-xs",
              kind === value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border/60 bg-card text-muted-foreground hover:border-primary/40",
            )}
          >
            {t(`club.docs.kind.${value}`)}
          </button>
        ))}
      </div>

      {documentsQ.isError ? (
        <ClubErrorNotice onRetry={() => void documentsQ.refetch()} />
      ) : documentsQ.isPending ? (
        <ClubDocumentsSkeleton />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <FileQuestion className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              {/* Pusty ZAKRES to inna informacja niż pusty filtr: klub bez
                  produktów ma zobaczyć, że nic jeszcze nie wytworzył, a nie
                  że "żaden dokument nie pasuje do zawężenia". */}
              {scope !== "all" && kind === null && debounced.trim().length < 2
                ? t(
                    scope === "products"
                      ? "club.docs.scope.emptyProducts"
                      : "club.docs.scope.emptySources",
                  )
                : filtered
                  ? t("club.docs.emptyFiltered")
                  : t("club.docs.empty")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <DocumentRow key={row.id} row={row} clubSlug={clubSlug} locale={locale} />
          ))}
        </div>
      )}

      {/* Stronicowanie offsetowe, nie kursorowe: biblioteka jest sortowana po
          przypięciu i dacie, a nie po strumieniu zdarzeń - użytkownik chce tu
          wracać na "stronę 2", a nie przewijać w nieskończoność. */}
      {total > PAGE ? (
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            {t("club.docs.prevPage")}
          </Button>
          <span className="text-xs text-muted-foreground">
            {t("club.docs.pageOf", {
              page: page + 1,
              pages: Math.max(1, Math.ceil(total / PAGE)),
            })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={(page + 1) * PAGE >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("club.docs.nextPage")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
