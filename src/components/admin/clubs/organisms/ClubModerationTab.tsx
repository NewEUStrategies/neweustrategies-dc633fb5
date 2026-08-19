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
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Check,
  EyeOff,
  History,
  Loader2,
  PencilLine,
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

interface RevealTarget {
  targetType: "thread" | "reply";
  targetId: string;
  title: string;
}

export function ClubModerationTab({ clubId }: { clubId: string }) {
  ensureAdminClubsI18n();
  const { t, i18n } = useTranslation();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [reveal, setReveal] = useState<RevealTarget | null>(null);
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
    const targetType = item.target_type === "reply" ? "reply" : "thread";
    moderateM.mutate(
      { targetType, targetId: item.target_id, action },
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
            <div className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3 backdrop-blur">
              <span className="text-sm font-medium">
                {t("adminClubs.moderation.selected", { count: selected.size })}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={bulkM.isPending}
                onClick={() => void bulkAct("approve")}
              >
                <Check className="mr-1.5 h-3.5 w-3.5" />
                {t("adminClubs.moderation.approve")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-destructive"
                disabled={bulkM.isPending}
                onClick={() =>
                  setConfirm({
                    title: t("adminClubs.moderation.bulkDeleteTitle", { count: selected.size }),
                    description: t("adminClubs.moderation.deleteBody"),
                    destructive: true,
                    onConfirm: () => void bulkAct("delete"),
                  })
                }
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                {t("adminClubs.moderation.delete")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() => setSelected(new Set())}
              >
                {t("adminClubs.moderation.clearSelection")}
              </Button>
            </div>
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
                <li
                  key={`${item.target_type}:${item.target_id}`}
                  className="rounded-lg border border-border/60 bg-card p-3"
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      className="mt-1"
                      aria-label={item.title}
                      checked={selected.has(item.target_id)}
                      onCheckedChange={() => toggle(item.target_id)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-[11px]">
                          {t(`adminClubs.moderation.target.${item.target_type}`)}
                        </Badge>
                        {item.is_anonymous ? (
                          <Badge
                            variant="outline"
                            className="border-amber-500/40 text-[11px] text-amber-700 dark:text-amber-300"
                          >
                            {t("adminClubs.moderation.anonymous")}
                          </Badge>
                        ) : (
                          <span className="font-medium text-foreground">{item.author_name}</span>
                        )}
                        <span>{formatDateTime(item.created_at, i18n.language)}</span>
                      </div>
                      <p className="mt-1 truncate text-sm font-medium">{item.title}</p>
                      {/* line-clamp, nie truncate: moderator musi zobaczyć,
                          o co chodzi, a nie pierwsze pięć słów. */}
                      <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-sm text-muted-foreground">
                        {item.body}
                      </p>
                    </div>
                  </div>

                  <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-border/60 pt-2.5">
                    <Button
                      size="sm"
                      className="h-8"
                      disabled={moderateM.isPending}
                      onClick={() => act(item, "approve")}
                    >
                      <Check className="mr-1.5 h-3.5 w-3.5" />
                      {t("adminClubs.moderation.approve")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      disabled={moderateM.isPending}
                      onClick={() => act(item, "hide")}
                    >
                      <EyeOff className="mr-1.5 h-3.5 w-3.5" />
                      {t("adminClubs.moderation.hide")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-destructive"
                      disabled={moderateM.isPending}
                      onClick={() =>
                        setConfirm({
                          title: t("adminClubs.moderation.deleteTitle"),
                          description: t("adminClubs.moderation.deleteBody"),
                          destructive: true,
                          onConfirm: () => act(item, "delete"),
                        })
                      }
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      {t("adminClubs.moderation.delete")}
                    </Button>
                    {/* Redakcja PRZED zatwierdzeniem: wpis z jednym zdaniem
                        do zaczernienia nie musi wracać do autora. */}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={() => setEditing(item)}
                    >
                      <PencilLine className="mr-1.5 h-3.5 w-3.5" />
                      {t("adminClubs.moderation.edit")}
                    </Button>
                    {item.is_anonymous ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto h-8 text-amber-700 dark:text-amber-300"
                        onClick={() =>
                          setReveal({
                            targetType: item.target_type === "reply" ? "reply" : "thread",
                            targetId: item.target_id,
                            title: item.title,
                          })
                        }
                      >
                        <ShieldOff className="mr-1.5 h-3.5 w-3.5" />
                        {t("adminClubs.moderation.reveal")}
                      </Button>
                    ) : null}
                  </div>
                </li>
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
    if (userId === "") return;
    banM.mutate(
      { userId, banned: true, reason: reason.trim() !== "" ? reason.trim() : null },
      {
        onSuccess: () => {
          toast.success(t("adminClubs.moderation.banned"));
          setUserId("");
          setReason("");
        },
        onError: () => toast.error(t("adminClubs.moderation.banFailed")),
      },
    );
  };

  const unban = (id: string) =>
    banM.mutate(
      { userId: id, banned: false },
      {
        onSuccess: () => toast.success(t("adminClubs.moderation.unbanned")),
        onError: () => toast.error(t("adminClubs.saveFailed")),
      },
    );

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
            {banned.map((m) => (
              <li
                key={m.user_id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.display_name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {m.job_title !== null && m.job_title !== ""
                      ? m.job_title
                      : t(`club.role.${m.role}`)}
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
            ))}
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
/** Okna czasu dziennika. `null` = bez ograniczenia (cała historia). */
const LOG_PERIODS: readonly { key: string; days: number | null }[] = [
  { key: "7", days: 7 },
  { key: "30", days: 30 },
  { key: "90", days: 90 },
  { key: "all", days: null },
];

function ModerationLogCard({ clubId }: { clubId: string }) {
  const { t, i18n } = useTranslation();
  const logQ = useClubModerationLog(clubId);
  const [action, setAction] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [period, setPeriod] = useState<string>("all");
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
  const inWindow = useMemo(() => {
    const days = LOG_PERIODS.find((p) => p.key === period)?.days ?? null;
    if (days === null) return all;
    const from = Date.now() - days * 86_400_000;
    return all.filter((r) => new Date(r.created_at).getTime() >= from);
  }, [all, period]);

  /** Liczniki per akcja i per cel w bieżącym oknie czasu. */
  const counts = useMemo(() => {
    const byAction = new Map<string, number>();
    const byTarget = new Map<string, number>();
    for (const r of inWindow) {
      byAction.set(r.action, (byAction.get(r.action) ?? 0) + 1);
      byTarget.set(r.target_type, (byTarget.get(r.target_type) ?? 0) + 1);
    }
    return { byAction, byTarget };
  }, [inWindow]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inWindow.filter((r) => {
      if (action !== null && r.action !== action) return false;
      if (target !== null && r.target_type !== target) return false;
      if (q === "") return true;
      const haystack = [
        r.moderator_name,
        r.reason ?? "",
        label(r.action),
        targetLabel(r.target_type, t),
        r.target_id ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inWindow, action, target, query, t]);

  const isFiltered = action !== null || target !== null || query.trim() !== "" || period !== "all";
  const clearFilters = () => {
    setAction(null);
    setTarget(null);
    setQuery("");
    setPeriod("all");
  };

  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" />
            {t("adminClubs.moderation.logTitle")}
            <Badge variant="secondary" className="tabular-nums">
              {rows.length === all.length
                ? all.length
                : t("adminClubs.moderation.logCount", { shown: rows.length, total: all.length })}
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
              {LOG_ACTIONS.filter((a) => (counts.byAction.get(a) ?? 0) > 0).map((a) => (
                <SelectItem key={a} value={a}>
                  {t(`adminClubs.moderation.action.${a}`)} ({counts.byAction.get(a) ?? 0})
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
              {LOG_TARGETS.filter((x) => (counts.byTarget.get(x) ?? 0) > 0).map((x) => (
                <SelectItem key={x} value={x}>
                  {targetLabel(x, t)} ({counts.byTarget.get(x) ?? 0})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="h-9" aria-label={t("adminClubs.moderation.filterPeriod")}>
              <SelectValue placeholder={t("adminClubs.moderation.filterPeriod")} />
            </SelectTrigger>
            <SelectContent>
              {LOG_PERIODS.map((p) => (
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
                        <Badge
                          variant="outline"
                          className={
                            r.action === "reveal_author"
                              ? "border-amber-500/40 text-[11px] text-amber-700 dark:text-amber-300"
                              : "text-[11px]"
                          }
                        >
                          {label(r.action)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {targetLabel(r.target_type, t)}
                      </TableCell>
                      <TableCell className="max-w-[320px] text-xs text-muted-foreground">
                        {r.reason !== null && r.reason !== "" ? r.reason : "-"}
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
                    <Badge
                      variant="outline"
                      className={
                        r.action === "reveal_author"
                          ? "border-amber-500/40 text-[11px] text-amber-700 dark:text-amber-300"
                          : "text-[11px]"
                      }
                    >
                      {label(r.action)}
                    </Badge>
                    <span className="text-sm font-medium">{r.moderator_name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {formatDateTime(r.created_at, i18n.language)}
                    </span>
                  </div>
                  {r.reason !== null && r.reason !== "" ? (
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
  target: RevealTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const revealM = useRevealClubAuthor();
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<{ displayName: string; profileSlug: string | null } | null>(
    null,
  );

  const tooShort = !revealReasonAccepted(reason);

  const close = (open: boolean) => {
    if (!open) {
      setReason("");
      setResult(null);
    }
    onOpenChange(open);
  };

  const submit = () => {
    if (target === null || tooShort) return;
    revealM.mutate(
      { targetType: target.targetType, targetId: target.targetId, reason: reason.trim() },
      {
        onSuccess: (data) => {
          if (data === null) {
            toast.error(t("adminClubs.moderation.revealEmpty"));
            return;
          }
          setResult({ displayName: data.displayName, profileSlug: data.profileSlug });
        },
        onError: () => toast.error(t("adminClubs.moderation.revealFailed")),
      },
    );
  };

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
            {result.profileSlug !== null && result.profileSlug !== "" ? (
              <a
                href={`/profile/${result.profileSlug}`}
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
              disabled={tooShort || revealM.isPending}
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
    setTitle(item?.title ?? "");
    setBody(item?.body ?? "");
    setReason("");
  }, [item, targetId]);

  const submit = () => {
    if (!item || reason.trim().length < 3 || body.trim() === "") return;
    const done = {
      onSuccess: () => {
        toast.success(t("adminClubs.moderation.edited"));
        onOpenChange(false);
      },
      onError: () => toast.error(t("adminClubs.saveFailed")),
    };
    if (isThread) {
      threadM.mutate(
        { threadId: item.target_id, title: title.trim(), body: body.trim(), reason: reason.trim() },
        done,
      );
    } else {
      replyM.mutate({ replyId: item.target_id, body: body.trim(), reason: reason.trim() }, done);
    }
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
          <Button
            disabled={pending || reason.trim().length < 3 || body.trim() === ""}
            onClick={submit}
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
