// Organizm: „Zgłoszenia" - lista wysłanych zgłoszeń naboru z ocenami, filtrami
// i szufladą decyzji, plus zakładka materiałów prelegentów.
//
// LICZNIKI NAD LISTĄ SĄ SKRÓTAMI FILTRA. Kafel stanu ustawia filtr stanu, więc
// organizator przechodzi od „ile czeka na ocenę" do tych zgłoszeń jednym
// kliknięciem. Liczniki NIE biorą filtrów listy - pokazują cały nabór.
//
// SZKICÓW NIE MA. Baza wyklucza je z listy (`admin_event_cfp_submissions_list`):
// szkic jest prywatną pracą prelegenta, a nie zgłoszeniem.
//
// STRONICOWANIE SERWEROWE. `total_count` przychodzi w każdym wierszu okna nad
// zapytaniem, więc licznik stron nie wymaga drugiego zapytania.
//
// „ZA MAŁO OCEN" LICZY BAZA WZGLĘDEM `min_reviews` Z USTAWIEŃ; lista tylko to
// pokazuje - zgłoszenie poniżej minimum wymaga uwagi przed decyzją.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { AdminFormEnumRow } from "@/components/admin/molecules/AdminFormEnumRow";
import { CfpMaterialsTable } from "@/components/admin/events/organisms/CfpMaterialsTable";
import { CfpSubmissionSheet } from "@/components/admin/events/organisms/CfpSubmissionSheet";
import { CfpStatusBadge } from "@/components/events/cfp/atoms/CfpStatusBadge";
import { adminCfpErrorMessage } from "@/lib/events/adminCfpErrors";
import type { CfpSubmissionSort, CfpSubmissionsQuery } from "@/lib/events/cfpApi";
import {
  asOneOf,
  CFP_SUBMISSION_STATUS_LABEL_KEYS,
  CFP_SUBMISSION_STATUSES,
  localizedPair,
  type CfpSubmissionStatus,
} from "@/lib/events/cfpEnums";
import { cfpPageCount, cfpPageRange, formatCfpScore } from "@/lib/events/cfpRows";
import type { CfpSettings } from "@/lib/events/cfpSurface";
import { formatEventDateTime } from "@/lib/events/timezone";
import { useCfpCounts, useCfpSettings, useCfpSubmissions } from "@/lib/events/useEventCfp";
import { uiLang } from "@/lib/i18n/format";
import { ensureAdminEventCfpI18n } from "@/lib/i18n-admin-event-cfp";

const PAGE_SIZE = 25;
const ALL = "all";

type ListStatus = Exclude<CfpSubmissionStatus, "draft">;
const LIST_STATUSES = CFP_SUBMISSION_STATUSES.filter(
  (status): status is ListStatus => status !== "draft",
);

const SORTS: readonly CfpSubmissionSort[] = ["recent", "score", "title"];
const SORT_LABEL_KEYS: Record<CfpSubmissionSort, string> = {
  recent: "adminEventCfp.submissions.sort.recent",
  score: "adminEventCfp.submissions.sort.score",
  title: "adminEventCfp.submissions.sort.title",
};

export function CfpSubmissionsPanel({ eventId }: { eventId: string }) {
  ensureAdminEventCfpI18n();
  const { t } = useTranslation();
  const settingsQ = useCfpSettings(eventId);
  const settings = settingsQ.data;

  if (settings === undefined) {
    return (
      <AdminCatalogListState
        isLoading={settingsQ.isLoading}
        loadingLabel={t("adminEventCfp.common.loading")}
        errorMessage={settingsQ.error ? adminCfpErrorMessage(settingsQ.error) : null}
        isEmpty={false}
        emptyLabel=""
      >
        {null}
      </AdminCatalogListState>
    );
  }

  return (
    <Tabs defaultValue="submissions" className="space-y-4">
      <TabsList>
        <TabsTrigger value="submissions">{t("adminEventCfp.submissions.tabs.submissions")}</TabsTrigger>
        <TabsTrigger value="materials">{t("adminEventCfp.submissions.tabs.materials")}</TabsTrigger>
      </TabsList>
      <TabsContent value="submissions">
        <CfpSubmissionsList eventId={eventId} settings={settings} />
      </TabsContent>
      <TabsContent value="materials">
        <CfpMaterialsTable eventId={eventId} timezone={settings.eventTimezone} />
      </TabsContent>
    </Tabs>
  );
}

function CfpSubmissionsList({ eventId, settings }: { eventId: string; settings: CfpSettings }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [status, setStatus] = useState<ListStatus | typeof ALL>(ALL);
  const [trackId, setTrackId] = useState<string>(ALL);
  const [sort, setSort] = useState<CfpSubmissionSort>("recent");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  const query: CfpSubmissionsQuery = { eventId, status, trackId, q, sort, page, pageSize: PAGE_SIZE };
  const listQ = useCfpSubmissions(query);
  const countsQ = useCfpCounts(eventId);
  const counts = countsQ.data;

  const rows = listQ.data?.rows ?? [];
  const total = listQ.data?.total ?? 0;
  const pages = cfpPageCount(total, PAGE_SIZE);
  const range = cfpPageRange(page, PAGE_SIZE, total);
  const filtered = status !== ALL || trackId !== ALL || q.trim() !== "";

  const pickStatus = (next: ListStatus | typeof ALL) => {
    setStatus(next);
    setPage(0);
  };
  const submitSearch = () => {
    setQ(search);
    setPage(0);
  };

  const trackOptions = [ALL, ...settings.tracks.map((track) => track.id)];
  const formatName = (key: string | null) => {
    const format = settings.formats.find((entry) => entry.key === key);
    return format === undefined ? null : localizedPair(lang, format.labelPl, format.labelEn);
  };

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted-foreground">{t("adminEventCfp.submissions.lead")}</p>

      {counts === undefined ? null : (
        <div role="group" aria-label={t("adminEventCfp.submissions.counts.label")} className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={status === ALL ? "default" : "outline"}
            aria-pressed={status === ALL}
            onClick={() => pickStatus(ALL)}
          >
            {t("adminEventCfp.submissions.counts.total")}
            <span className="ml-1 tabular-nums">{counts.total}</span>
          </Button>
          {LIST_STATUSES.filter((entry) => counts.byStatus[entry] > 0).map((entry) => (
            <Button
              key={entry}
              type="button"
              size="sm"
              variant={status === entry ? "default" : "outline"}
              aria-pressed={status === entry}
              onClick={() => pickStatus(entry)}
            >
              {t(CFP_SUBMISSION_STATUS_LABEL_KEYS[entry])}
              <span className="ml-1 tabular-nums">{counts.byStatus[entry]}</span>
            </Button>
          ))}
          {counts.needsReviews > 0 ? (
            <p className="self-center text-xs text-amber-600 dark:text-amber-400">
              {t("adminEventCfp.submissions.counts.needsReviews", {
                count: counts.needsReviews,
                min: counts.minReviews,
              })}
            </p>
          ) : null}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        <AdminFormEnumRow<string>
          id="cfp-filter-status"
          label={t("adminEventCfp.submissions.filters.status")}
          value={status}
          options={[ALL, ...LIST_STATUSES]}
          labelFor={(option) =>
            option === ALL
              ? t("adminEventCfp.submissions.filters.allStatuses")
              : t(CFP_SUBMISSION_STATUS_LABEL_KEYS[asOneOf(LIST_STATUSES, option, "submitted")])
          }
          onValueChange={(value) =>
            pickStatus(value === ALL ? ALL : asOneOf(LIST_STATUSES, value, "submitted"))
          }
        />
        <AdminFormEnumRow<string>
          id="cfp-filter-track"
          label={t("adminEventCfp.submissions.filters.track")}
          value={trackId}
          options={trackOptions}
          labelFor={(option) => {
            const track = settings.tracks.find((entry) => entry.id === option);
            return track === undefined
              ? t("adminEventCfp.submissions.filters.allTracks")
              : localizedPair(lang, track.namePl, track.nameEn);
          }}
          onValueChange={(value) => {
            setTrackId(value);
            setPage(0);
          }}
        />
        <AdminFormEnumRow<CfpSubmissionSort>
          id="cfp-filter-sort"
          label={t("adminEventCfp.submissions.filters.sort")}
          value={sort}
          options={SORTS}
          labelFor={(option) => t(SORT_LABEL_KEYS[option])}
          onValueChange={(value) => {
            setSort(value);
            setPage(0);
          }}
        />
        <form
          className="space-y-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            submitSearch();
          }}
        >
          <Label htmlFor="cfp-filter-q">{t("adminEventCfp.submissions.filters.search")}</Label>
          <div className="flex gap-1">
            <Input
              id="cfp-filter-q"
              value={search}
              maxLength={200}
              placeholder={t("adminEventCfp.submissions.filters.searchPlaceholder")}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Button type="submit" variant="outline" size="icon" aria-label={t("adminEventCfp.submissions.filters.search")}>
              <Search className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </form>
      </div>

      <AdminCatalogListState
        isLoading={listQ.isLoading}
        loadingLabel={t("adminEventCfp.common.loading")}
        errorMessage={listQ.error ? adminCfpErrorMessage(listQ.error) : null}
        isEmpty={rows.length === 0}
        emptyLabel={t(filtered ? "adminEventCfp.submissions.emptyFiltered" : "adminEventCfp.submissions.empty")}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("adminEventCfp.submissions.columns.title")}</TableHead>
              <TableHead>{t("adminEventCfp.submissions.columns.speaker")}</TableHead>
              <TableHead>{t("adminEventCfp.submissions.columns.track")}</TableHead>
              <TableHead>{t("adminEventCfp.submissions.columns.status")}</TableHead>
              <TableHead>{t("adminEventCfp.submissions.columns.reviews")}</TableHead>
              <TableHead>{t("adminEventCfp.submissions.columns.score")}</TableHead>
              <TableHead>{t("adminEventCfp.submissions.columns.submitted")}</TableHead>
              <TableHead className="sr-only">{t("adminEventCfp.submissions.open")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const rowStatus = asOneOf(CFP_SUBMISSION_STATUSES, row.status, "submitted");
              const coSpeakers = Math.max(0, row.speakers_count - 1);
              const format = formatName(row.format_key);
              const track =
                row.track_id === null
                  ? t("adminEventCfp.submissions.noTrack")
                  : localizedPair(lang, row.track_name_pl ?? "", row.track_name_en ?? "");
              const score = formatCfpScore(row.weighted_avg ?? row.overall_avg, lang);
              // „Za mało ocen" ma znaczenie tylko przed decyzją.
              const belowMin =
                (rowStatus === "submitted" || rowStatus === "under_review") &&
                row.reviews_count < settings.minReviews;
              return (
                <TableRow key={row.id}>
                  <TableCell className="max-w-[18rem]">
                    <div className="font-medium">{localizedPair(lang, row.title_pl, row.title_en)}</div>
                  </TableCell>
                  <TableCell>
                    <div>{row.speaker_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.speaker_email}
                      {coSpeakers > 0
                        ? ` · ${t("adminEventCfp.submissions.coSpeakers", { count: coSpeakers })}`
                        : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div>{track}</div>
                    {format === null ? null : <div className="text-xs text-muted-foreground">{format}</div>}
                  </TableCell>
                  <TableCell>
                    <CfpStatusBadge status={rowStatus} />
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {t("adminEventCfp.submissions.reviewsOf", {
                      count: row.reviews_count,
                      min: settings.minReviews,
                    })}
                    {belowMin ? (
                      <Badge variant="outline" className="ml-1">
                        {t("adminEventCfp.submissions.belowMin")}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="tabular-nums">{score ?? "-"}</TableCell>
                  <TableCell className="text-xs">
                    {formatEventDateTime(row.submitted_at, settings.eventTimezone, lang)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button type="button" variant="outline" size="sm" onClick={() => setOpenId(row.id)}>
                      {t("adminEventCfp.submissions.open")}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <nav
          aria-label={t("adminEventCfp.submissions.pagination.label")}
          className="flex items-center justify-end gap-2 pt-2 text-xs text-muted-foreground"
        >
          <span className="tabular-nums">
            {t("adminEventCfp.submissions.pagination.range", { from: range.from, to: range.to, total })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={page === 0}
            aria-label={t("adminEventCfp.submissions.pagination.previous")}
            onClick={() => setPage((previous) => Math.max(0, previous - 1))}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={page >= pages - 1}
            aria-label={t("adminEventCfp.submissions.pagination.next")}
            onClick={() => setPage((previous) => Math.min(pages - 1, previous + 1))}
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </nav>
      </AdminCatalogListState>

      <CfpSubmissionSheet
        eventId={eventId}
        submissionId={openId}
        settings={settings}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}
