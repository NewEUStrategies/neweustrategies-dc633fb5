// Organizm: zakładka "Moderacja" - kolejka, blokady i dziennik.
//
// Trzy powierzchnie, które do tej pory istniały tylko jako RPC:
//   1. kolejka premoderacji  - admin_club_moderation_queue + club_moderate,
//   2. blokady członków      - club_ban_member (blokada i zdjęcie blokady),
//   3. dziennik moderacji    - admin_club_moderation_log.
//
// Do tego ujawnienie autora wpisu anonimowego. To jedyna akcja w całym module,
// która przełamuje regułę Chatham House, więc UI traktuje ją inaczej niż
// resztę: przycisk potwierdzenia jest wyłączony, dopóki powód nie ma treści,
// a po ujawnieniu ekran mówi wprost, że fakt zajrzenia został zapisany
// w dwóch logach. RPC odrzuca pusty powód błędem 22023 - blokada w UI jest
// po to, żeby moderator dowiedział się o tym PRZED kliknięciem, nie po.
//
// RESPONSYWNOŚĆ: kolejka i blokady to listy kart na każdej szerokości, bo
// pozycja kolejki to cytat treści - tabela ucięłaby to, po czym decyzja
// zapadałaby na podstawie pierwszych pięciu słów. Dziennik ma tabelę od lg
// w górę i karty poniżej.
//
// ORGANIZM JEST KOMPOZYCJĄ. Reguły mieszkają w DWÓCH czystych modułach:
// `lib/clubs/moderationRules.ts` (rozbicie wsadu na typy celu, próg powodu
// ujawnienia, przełączanie zaznaczenia) oraz `lib/clubs/adminModerationDesk.ts`
// (okno czasu dziennika, liczniki, filtr, ładunki blokady, redakcji
// i ujawnienia). Karta pozycji kolejki, pasek operacji wsadowych i plakietka
// dziennika są molekułami. Tutaj zostaje SKLEJENIE: co jedzie do RPC, ile razy
// i co widać po awarii.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Check,
  History,
  Loader2,
  RotateCcw,
  ShieldAlert,
  ShieldOff,
  Trash2,
  UserX,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MemberPicker } from "@/components/admin/community/MemberPicker";
import { ConfirmDialog, type ConfirmState } from "@/components/admin/ConfirmDialog";
import { ClubModerationLogBadge } from "@/components/admin/clubs/molecules/ClubModerationLogBadge";
import { ClubModerationQueueItem } from "@/components/admin/clubs/molecules/ClubModerationQueueItem";
import {
  ClubModerationBulkBar,
  type ClubModerationBulkAction,
} from "@/components/admin/clubs/molecules/ClubModerationBulkBar";
import {
  useBanClubMember,
  useBulkModerateClub,
  useClubMembers,
  useClubModerationLog,
  useClubModerationQueue,
  useModerateClubTarget,
  useModeratorEditReply,
  useModeratorEditThread,
  useRevealClubAuthor,
} from "@/lib/clubs/useClubs";
import { formatDateShort, formatDateTime } from "@/lib/i18n/format";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";
import {
  CLUB_LOG_ACTIONS,
  CLUB_LOG_TARGETS,
  type AdminClubModerationItem,
} from "@/lib/clubs/types";
import {
  MIN_REVEAL_REASON,
  isAllSelected,
  isKnownModerationTarget,
  revealReasonAccepted,
  splitModerationBatch,
  toggleSelection,
} from "@/lib/clubs/moderationRules";
import {
  MODERATION_LOG_FILTERS_CLEARED,
  MODERATION_LOG_PERIODS,
  MODERATION_LOG_PERIOD_ALL,
  banMemberVars,
  bannedMemberSubtitle,
  filterModerationLog,
  isModeratorEditBlocked,
  isModerationLogFiltered,
  moderationLogCountView,
  moderationLogCounts,
  moderationLogInWindow,
  moderationLogOptions,
  moderationLogReason,
  moderationTargetType,
  moderatorEditInitial,
  moderatorEditVars,
  revealAuthorVars,
  revealProfileHref,
  unbanMemberVars,
  type RevealAuthorTarget,
} from "@/lib/clubs/adminModerationDesk";

const ANY = "__any__";

// Słowniki dziennika mieszkają w types.ts razem z resztą kontraktu bazy:
// dopisanie akcji w migracji ma mieć DOKŁADNIE JEDNO miejsce do poprawienia
// po stronie klienta. Lokalna kopia rozjechała się już raz - filtr nie znał
// akcji 'post_on_behalf', 'move' ani 'edit', mimo że baza je zapisywała.
const LOG_ACTIONS = CLUB_LOG_ACTIONS;
const LOG_TARGETS: readonly string[] = CLUB_LOG_TARGETS;

/**
 * Nazwa typu celu bez `defaultValue` - moduł nie opiera żadnego napisu na
 * fallbacku i18n, bo wtedy brak klucza przechodzi przez bramkę parytetu.
 * Wartość spoza słownika (wpis historyczny) pokazujemy taką, jaka jest.
 */
function targetLabel(value: string, t: (key: string) => string): string {
  // Prefiks klucza budujemy TUTAJ, a nie w module reguł: sekcja
  // `adminClubs.moderation.*` żyje w słowniku panelu, który ten plik
  // dociąga przez `ensureAdminClubsI18n()`.
  return isKnownModerationTarget(value) ? t(`adminClubs.moderation.target.${value}`) : value;
}

export function ClubModerationTab({ clubId }: { clubId: string }) {
  ensureAdminClubsI18n();
  const { t, i18n } = useTranslation();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [reveal, setReveal] = useState<RevealAuthorTarget | null>(null);
  const [editing, setEditing] = useState<AdminClubModerationItem | null>(null);

  const queueQ = useClubModerationQueue(clubId);
  const moderateM = useModerateClubTarget(clubId);
  const bulkM = useBulkModerateClub(clubId);

  const queue = useMemo(() => queueQ.data?.rows ?? [], [queueQ.data]);
  // Kolejka jest stronicowana po stronie RPC, wiec licznik przy tytule musi
  // pochodzic z total_count, a nie z dlugosci strony - inaczej moderator
  // widzialby "50" przy kolejce liczacej trzysta pozycji.
  const queueTotal = queueQ.data?.total ?? 0;

  const toggle = (id: string) => setSelected((prev) => new Set(toggleSelection(prev, id)));

  const act = (item: AdminClubModerationItem, action: "approve" | "hide" | "delete") => {
    moderateM.mutate(
      { targetType: moderationTargetType(item.target_type), targetId: item.target_id, action },
      {
        onSuccess: () => {
          toast.success(t(`adminClubs.moderation.done.${action}`));
          setSelected((prev) => {
            const next = new Set(prev);
            next.delete(item.target_id);
            return next;
          });
        },
        onError: () => toast.error(t("adminClubs.saveFailed")),
      },
    );
  };

  /**
   * Wsad. `admin_club_bulk_moderate` przyjmuje JEDEN typ celu, a kolejka miesza
   * wątki z odpowiedziami - dlatego rozbijamy zaznaczenie na dwie partie
   * i sumujemy to, co faktycznie przeszło. Komunikat mówi "47 z 50", bo część
   * pozycji mogła w międzyczasie zmienić stan.
   */
  const bulkAct = async (action: "approve" | "delete") => {
    if (selected.size === 0) return;
    const { threadIds, replyIds, total } = splitModerationBatch(queue, selected);
    if (total === 0) return;

    try {
      let done = 0;
      if (threadIds.length > 0) {
        done += await bulkM.mutateAsync({ targetType: "thread", targetIds: threadIds, action });
      }
      if (replyIds.length > 0) {
        done += await bulkM.mutateAsync({ targetType: "reply", targetIds: replyIds, action });
      }
      toast.success(t("adminClubs.moderation.bulkDone", { done, total }));
      setSelected(new Set());
    } catch {
      toast.error(t("adminClubs.saveFailed"));
    }
  };

  const bulkActions: ClubModerationBulkAction[] = [
    {
      id: "approve",
      label: t("adminClubs.moderation.approve"),
      icon: <Check className="mr-1.5 h-3.5 w-3.5" />,
      disabled: bulkM.isPending,
      onSelect: () => void bulkAct("approve"),
    },
    {
      id: "delete",
      label: t("adminClubs.moderation.delete"),
      icon: <Trash2 className="mr-1.5 h-3.5 w-3.5" />,
      destructive: true,
      disabled: bulkM.isPending,
      onSelect: () =>
        setConfirm({
          title: t("adminClubs.moderation.bulkDeleteTitle", { count: selected.size }),
          description: t("adminClubs.moderation.deleteBody"),
          destructive: true,
          onConfirm: () => void bulkAct("delete"),
        }),
    },
  ];

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------------- */}
      {/* Kolejka premoderacji                                              */}
      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader className="gap-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              {t("adminClubs.moderation.queueTitle")}
              {queueTotal > 0 ? (
                <Badge variant="secondary" className="tabular-nums">
                  {queueTotal}
                </Badge>
              ) : null}
            </CardTitle>
            {queue.length > 0 ? (
              <Checkbox
                aria-label={t("adminClubs.moderation.selectAll")}
                checked={isAllSelected(queue, selected)}
                onCheckedChange={(v) =>
                  setSelected(v === true ? new Set(queue.map((i) => i.target_id)) : new Set())
                }
              />
            ) : null}
          </div>
          <CardDescription>{t("adminClubs.moderation.queueHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {selected.size > 0 ? (
            <ClubModerationBulkBar
              label={t("adminClubs.moderation.selected", { count: selected.size })}
              actions={bulkActions}
              clearLabel={t("adminClubs.moderation.clearSelection")}
              onClear={() => setSelected(new Set())}
            />
          ) : null}

          {queueQ.isPending ? (
            <div className="space-y-2" aria-busy="true">
              {[0, 1].map((i) => (
                <div key={i} className="h-24 animate-pulse rounded-lg bg-muted/50" />
              ))}
            </div>
          ) : queueQ.isError ? (
            <p className="py-6 text-center text-sm text-destructive">{t("adminClubs.loadError")}</p>
          ) : queue.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("adminClubs.moderation.queueEmpty")}
            </p>
          ) : (
            <ul className="space-y-2">
              {queue.map((item) => (
                <ClubModerationQueueItem
                  key={`${item.target_type}:${item.target_id}`}
                  item={item}
                  selected={selected.has(item.target_id)}
                  pending={moderateM.isPending}
                  language={i18n.language}
                  onToggle={() => toggle(item.target_id)}
                  onApprove={() => act(item, "approve")}
                  onHide={() => act(item, "hide")}
                  onDelete={() =>
                    setConfirm({
                      title: t("adminClubs.moderation.deleteTitle"),
                      description: t("adminClubs.moderation.deleteBody"),
                      destructive: true,
                      onConfirm: () => act(item, "delete"),
                    })
                  }
                  onEdit={() => setEditing(item)}
                  onReveal={() =>
                    setReveal({
                      targetType: moderationTargetType(item.target_type),
                      targetId: item.target_id,
                      title: item.title,
                    })
                  }
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <BannedMembersCard clubId={clubId} />
      <ModerationLogCard clubId={clubId} />

      <ModeratorEditDialog
        clubId={clubId}
        item={editing}
        onOpenChange={(open) => !open && setEditing(null)}
      />
      <RevealAuthorDialog target={reveal} onOpenChange={(open) => !open && setReveal(null)} />
      <ConfirmDialog state={confirm} onOpenChange={(open) => !open && setConfirm(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Blokady członków
// ---------------------------------------------------------------------------
function BannedMembersCard({ clubId }: { clubId: string }) {
  const { t, i18n } = useTranslation();
  const bannedQ = useClubMembers({ clubId, status: "banned", limit: 100 });
  const banM = useBanClubMember(clubId);

  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const banned = bannedQ.data?.rows ?? [];

  const submitBan = () => {
    const vars = banMemberVars(userId, reason);
    if (vars === null) return;
    banM.mutate(vars, {
      onSuccess: () => {
        toast.success(t("adminClubs.moderation.banned"));
        setUserId("");
        setReason("");
      },
      onError: () => toast.error(t("adminClubs.moderation.banFailed")),
    });
  };

  const unban = (id: string) =>
    banM.mutate(unbanMemberVars(id), {
      onSuccess: () => toast.success(t("adminClubs.moderation.unbanned")),
      onError: () => toast.error(t("adminClubs.saveFailed")),
    });

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="flex items-center gap-2 text-base">
          <UserX className="h-4 w-4" />
          {t("adminClubs.moderation.bansTitle")}
          {banned.length > 0 ? (
            <Badge variant="secondary" className="tabular-nums">
              {banned.length}
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>{t("adminClubs.moderation.bansHint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 rounded-lg border border-border/60 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label>{t("adminClubs.moderation.banWho")}</Label>
            <MemberPicker
              value={userId}
              onChange={setUserId}
              disabled={banM.isPending}
              labels={{
                placeholder: t("adminClubs.moderation.banWhoPlaceholder"),
                search: t("adminClubs.searchPlaceholder"),
                hint: t("adminClubs.moderation.banWhoHint"),
                loading: t("club.retry"),
                empty: t("adminClubs.members.empty"),
                clear: t("adminClubs.filterAny"),
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="club-ban-reason">{t("adminClubs.moderation.reason")}</Label>
            <Textarea
              id="club-ban-reason"
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("adminClubs.moderation.banReasonPlaceholder")}
            />
          </div>
          <Button
            variant="outline"
            className="text-destructive"
            disabled={userId === "" || banM.isPending}
            onClick={() =>
              setConfirm({
                title: t("adminClubs.moderation.banConfirmTitle"),
                description: t("adminClubs.moderation.banConfirmBody"),
                destructive: true,
                onConfirm: submitBan,
              })
            }
          >
            <UserX className="mr-1.5 h-4 w-4" />
            {t("adminClubs.moderation.ban")}
          </Button>
        </div>

        {bannedQ.isPending ? (
          <div className="h-12 animate-pulse rounded-lg bg-muted/50" aria-busy="true" />
        ) : banned.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {t("adminClubs.moderation.noBans")}
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {banned.map((m) => {
              const subtitle = bannedMemberSubtitle(m);
              return (
                <li
                  key={m.user_id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{m.display_name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {subtitle.kind === "jobTitle" ? subtitle.text : t(subtitle.key)}
                      {" · "}
                      {formatDateShort(m.joined_at, i18n.language)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8"
                    disabled={banM.isPending}
                    onClick={() => unban(m.user_id)}
                  >
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                    {t("adminClubs.moderation.unban")}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      <ConfirmDialog state={confirm} onOpenChange={(open) => !open && setConfirm(null)} />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Dziennik moderacji
// ---------------------------------------------------------------------------
function ModerationLogCard({ clubId }: { clubId: string }) {
  const { t, i18n } = useTranslation();
  const logQ = useClubModerationLog(clubId);
  const [action, setAction] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [period, setPeriod] = useState<string>(MODERATION_LOG_PERIOD_ALL);
  const [query, setQuery] = useState("");

  const label = (value: string) => {
    // Dziennik jest zapisem historycznym: wpis sprzed zmiany słownika ma nie
    // znikać ani wyświetlać surowego klucza, tylko własną nazwę akcji.
    const known = (LOG_ACTIONS as readonly string[]).includes(value);
    return known ? t(`adminClubs.moderation.action.${value}`) : value;
  };

  const all = useMemo(() => logQ.data ?? [], [logQ.data]);

  // Okno czasu stosujemy PRZED resztą filtrów, bo liczniki przy akcjach mają
  // mówić o tym, co widać w wybranym oknie - inaczej "30 dni" pokazywałoby
  // liczby z całej historii i moderator zaufałby złej liczbie.
  const inWindow = useMemo(() => moderationLogInWindow(all, period, Date.now()), [all, period]);

  /** Liczniki per akcja i per cel w bieżącym oknie czasu. */
  const counts = useMemo(() => moderationLogCounts(inWindow), [inWindow]);

  const rows = useMemo(
    () =>
      filterModerationLog(
        inWindow,
        { action, target, query, period },
        { action: label, target: (value: string) => targetLabel(value, t) },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inWindow, action, target, query, period, t],
  );

  const isFiltered = isModerationLogFiltered({ action, target, query, period });
  const clearFilters = () => {
    setAction(MODERATION_LOG_FILTERS_CLEARED.action);
    setTarget(MODERATION_LOG_FILTERS_CLEARED.target);
    setQuery(MODERATION_LOG_FILTERS_CLEARED.query);
    setPeriod(MODERATION_LOG_FILTERS_CLEARED.period);
  };

  const countView = moderationLogCountView(rows.length, all.length);
  const actionOptions = moderationLogOptions(LOG_ACTIONS, counts.byAction);
  const targetOptions = moderationLogOptions(LOG_TARGETS, counts.byTarget);

  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" />
            {t("adminClubs.moderation.logTitle")}
            <Badge variant="secondary" className="tabular-nums">
              {countView.kind === "all"
                ? countView.total
                : t("adminClubs.moderation.logCount", {
                    shown: countView.shown,
                    total: countView.total,
                  })}
            </Badge>
          </CardTitle>
          {isFiltered ? (
            <Button size="sm" variant="ghost" className="h-8" onClick={clearFilters}>
              {t("adminClubs.moderation.clearFilters")}
            </Button>
          ) : null}
        </div>
        <CardDescription>{t("adminClubs.moderation.logHint")}</CardDescription>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("adminClubs.moderation.logSearchPlaceholder")}
            aria-label={t("adminClubs.moderation.logSearchPlaceholder")}
            className="h-9"
          />
          <Select value={action ?? ANY} onValueChange={(v) => setAction(v === ANY ? null : v)}>
            <SelectTrigger className="h-9" aria-label={t("adminClubs.moderation.filterAction")}>
              <SelectValue placeholder={t("adminClubs.moderation.filterAction")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>
                {t("adminClubs.filterAny")} ({inWindow.length})
              </SelectItem>
              {actionOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {t(`adminClubs.moderation.action.${option.value}`)} ({option.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={target ?? ANY} onValueChange={(v) => setTarget(v === ANY ? null : v)}>
            <SelectTrigger className="h-9" aria-label={t("adminClubs.moderation.filterTarget")}>
              <SelectValue placeholder={t("adminClubs.moderation.filterTarget")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t("adminClubs.filterAny")}</SelectItem>
              {targetOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {targetLabel(option.value, t)} ({option.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="h-9" aria-label={t("adminClubs.moderation.filterPeriod")}>
              <SelectValue placeholder={t("adminClubs.moderation.filterPeriod")} />
            </SelectTrigger>
            <SelectContent>
              {MODERATION_LOG_PERIODS.map((p) => (
                <SelectItem key={p.key} value={p.key}>
                  {t(`adminClubs.moderation.period.${p.key}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {logQ.isPending ? (
          <div className="h-24 animate-pulse rounded-lg bg-muted/50" aria-busy="true" />
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {!isFiltered
              ? t("adminClubs.moderation.logEmpty")
              : t("adminClubs.moderation.logEmptyFiltered")}
          </p>
        ) : (
          <>
            <div className="hidden overflow-hidden rounded-lg border border-border/60 lg:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("adminClubs.moderation.when")}</TableHead>
                    <TableHead>{t("adminClubs.moderation.who")}</TableHead>
                    <TableHead>{t("adminClubs.moderation.what")}</TableHead>
                    <TableHead>{t("adminClubs.moderation.targetLabel")}</TableHead>
                    <TableHead>{t("adminClubs.moderation.reason")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDateTime(r.created_at, i18n.language)}
                      </TableCell>
                      <TableCell className="text-sm">{r.moderator_name}</TableCell>
                      <TableCell>
                        <ClubModerationLogBadge action={r.action} label={label(r.action)} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {targetLabel(r.target_type, t)}
                      </TableCell>
                      <TableCell className="max-w-[320px] text-xs text-muted-foreground">
                        {moderationLogReason(r.reason) ?? "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul className="grid gap-2 lg:hidden">
              {rows.map((r) => (
                <li key={r.id} className="rounded-lg border border-border/60 p-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <ClubModerationLogBadge action={r.action} label={label(r.action)} />
                    <span className="text-sm font-medium">{r.moderator_name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {formatDateTime(r.created_at, i18n.language)}
                    </span>
                  </div>
                  {moderationLogReason(r.reason) !== null ? (
                    <p className="mt-1 text-xs text-muted-foreground">{r.reason}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Ujawnienie autora - jedyne przejście przez regułę Chatham House
// ---------------------------------------------------------------------------
function RevealAuthorDialog({
  target,
  onOpenChange,
}: {
  target: RevealAuthorTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const revealM = useRevealClubAuthor();
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<{ displayName: string; profileSlug: string | null } | null>(
    null,
  );

  const accepted = revealReasonAccepted(reason);

  const close = (open: boolean) => {
    if (!open) {
      setReason("");
      setResult(null);
    }
    onOpenChange(open);
  };

  const submit = () => {
    const vars = revealAuthorVars(target, reason, accepted);
    if (vars === null) return;
    revealM.mutate(vars, {
      onSuccess: (data) => {
        if (data === null) {
          toast.error(t("adminClubs.moderation.revealEmpty"));
          return;
        }
        setResult({ displayName: data.displayName, profileSlug: data.profileSlug });
      },
      onError: () => toast.error(t("adminClubs.moderation.revealFailed")),
    });
  };

  const profileHref = result === null ? null : revealProfileHref(result.profileSlug);

  return (
    <Dialog open={target !== null} onOpenChange={close}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-left">
            <ShieldOff className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            {t("adminClubs.moderation.revealTitle")}
          </DialogTitle>
          <DialogDescription className="text-left">
            {t("adminClubs.moderation.revealBody")}
          </DialogDescription>
        </DialogHeader>

        {/* Który wpis - żeby po otwarciu dwóch kolejek nie ujawnić nie tego. */}
        {target !== null ? (
          <p className="truncate rounded-md bg-muted/50 px-3 py-2 text-sm font-medium">
            {target.title}
          </p>
        ) : null}

        {result === null ? (
          <div className="space-y-3">
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-200">
              {t("adminClubs.moderation.revealWarning")}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="club-reveal-reason">{t("adminClubs.moderation.revealReason")}</Label>
              <Textarea
                id="club-reveal-reason"
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("adminClubs.moderation.revealReasonPlaceholder")}
                aria-describedby="club-reveal-reason-hint"
              />
              <p id="club-reveal-reason-hint" className="text-xs text-muted-foreground">
                {t("adminClubs.moderation.revealReasonHint", { min: MIN_REVEAL_REASON })}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2 rounded-lg border border-border/60 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("adminClubs.moderation.revealResult")}
            </p>
            <p className="text-lg font-semibold">{result.displayName}</p>
            {profileHref !== null ? (
              <a
                href={profileHref}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-primary underline underline-offset-2"
              >
                {t("adminClubs.moderation.revealOpenProfile")}
              </a>
            ) : null}
            <p className="text-xs text-amber-800 dark:text-amber-200">
              {t("adminClubs.moderation.revealLogged")}
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)}>
            {result === null ? t("common.cancel") : t("common.close")}
          </Button>
          {result === null ? (
            <Button
              variant="outline"
              className="text-amber-700 dark:text-amber-300"
              disabled={!accepted || revealM.isPending}
              onClick={submit}
            >
              {revealM.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <ShieldOff className="mr-1.5 h-4 w-4" />
              )}
              {t("adminClubs.moderation.revealConfirm")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Redakcja cudzego wpisu - zawsze z powodem, zawsze do dziennika
// ---------------------------------------------------------------------------
function ModeratorEditDialog({
  clubId,
  item,
  onOpenChange,
}: {
  clubId: string;
  item: AdminClubModerationItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const threadM = useModeratorEditThread(clubId);
  const replyM = useModeratorEditReply(clubId);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [reason, setReason] = useState("");

  const isThread = item?.target_type === "thread";
  const pending = threadM.isPending || replyM.isPending;

  // Formularz startuje TRESCIA WPISU, nie pustka: moderator zaczernia fragment,
  // a nie pisze wypowiedzi od nowa. Zależność po id, żeby refetch kolejki
  // nie kasował poprawki w trakcie pisania.
  const targetId = item?.target_id;
  useEffect(() => {
    const initial = moderatorEditInitial(item);
    setTitle(initial.title);
    setBody(initial.body);
    setReason(initial.reason);
  }, [item, targetId]);

  const blocked = isModeratorEditBlocked({ title, body, reason });

  const submit = () => {
    const payload = moderatorEditVars(item, { title, body, reason });
    if (payload === null) return;
    const done = {
      onSuccess: () => {
        toast.success(t("adminClubs.moderation.edited"));
        onOpenChange(false);
      },
      onError: () => toast.error(t("adminClubs.saveFailed")),
    };
    if (payload.kind === "thread") threadM.mutate(payload.vars, done);
    else replyM.mutate(payload.vars, done);
  };

  return (
    <Dialog open={item !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-left">{t("adminClubs.moderation.editTitle")}</DialogTitle>
          <DialogDescription className="text-left">
            {t("adminClubs.moderation.editHint")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {isThread ? (
            <div className="space-y-1.5">
              <Label htmlFor="club-mod-edit-title">{t("club.threadTitle")}</Label>
              <Input
                id="club-mod-edit-title"
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="club-mod-edit-body">{t("club.threadBody")}</Label>
            <Textarea
              id="club-mod-edit-body"
              rows={8}
              maxLength={20000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
            <Label htmlFor="club-mod-edit-reason">{t("adminClubs.moderation.editReason")}</Label>
            <Input
              id="club-mod-edit-reason"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("adminClubs.moderation.editReasonPlaceholder")}
            />
            <p className="text-xs text-amber-800 dark:text-amber-200">
              {t("adminClubs.moderation.editWarning")}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button disabled={pending || blocked} onClick={submit}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
