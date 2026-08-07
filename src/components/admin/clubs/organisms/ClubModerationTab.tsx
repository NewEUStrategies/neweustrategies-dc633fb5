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
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Check,
  EyeOff,
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
  useRevealClubAuthor,
} from "@/lib/clubs/useClubs";
import type { AdminClubModerationItem } from "@/lib/clubs/types";

const ANY = "__any__";

/** Powód ujawnienia autora poniżej tej długości to nie powód, tylko klik. */
const MIN_REVEAL_REASON = 10;

/** Akcje, jakie potrafi wyprodukować `club_moderation_log`. Domknięty zbiór,
 *  bo filtr dziennika ma być listą wyboru, a nie polem tekstowym. */
const LOG_ACTIONS = [
  "approve",
  "hide",
  "delete",
  "restore",
  "lock",
  "unlock",
  "pin",
  "unpin",
  "ban",
  "unban",
  "role_change",
  "reveal_author",
] as const;

/** Typy celu, jakie trafiają do dziennika. `member` pojawia się przy blokadzie
 *  i zmianie roli, więc dziennik musi go umieć nazwać. */
const LOG_TARGETS: readonly string[] = ["thread", "reply", "member"];

/**
 * Nazwa typu celu bez `defaultValue` - moduł nie opiera żadnego napisu na
 * fallbacku i18n, bo wtedy brak klucza przechodzi przez bramkę parytetu.
 * Wartość spoza słownika (wpis historyczny) pokazujemy taką, jaka jest.
 */
function targetLabel(value: string, t: (key: string) => string): string {
  return LOG_TARGETS.includes(value) ? t(`adminClubs.moderation.target.${value}`) : value;
}

interface RevealTarget {
  targetType: "thread" | "reply";
  targetId: string;
  title: string;
}

export function ClubModerationTab({ clubId, isPl }: { clubId: string; isPl: boolean }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [reveal, setReveal] = useState<RevealTarget | null>(null);

  const queueQ = useClubModerationQueue(clubId);
  const moderateM = useModerateClubTarget(clubId);
  const bulkM = useBulkModerateClub(clubId);

  const queue = useMemo(() => queueQ.data ?? [], [queueQ.data]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
    const chosen = queue.filter((item) => selected.has(item.target_id));
    const threadIds = chosen.filter((i) => i.target_type === "thread").map((i) => i.target_id);
    const replyIds = chosen.filter((i) => i.target_type === "reply").map((i) => i.target_id);
    const total = threadIds.length + replyIds.length;
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
              {queue.length > 0 ? (
                <Badge variant="secondary" className="tabular-nums">
                  {queue.length}
                </Badge>
              ) : null}
            </CardTitle>
            {queue.length > 0 ? (
              <Checkbox
                aria-label={t("adminClubs.moderation.selectAll")}
                checked={selected.size === queue.length}
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
                        <span>
                          {new Date(item.created_at).toLocaleString(isPl ? "pl-PL" : "en-GB")}
                        </span>
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

      <BannedMembersCard clubId={clubId} isPl={isPl} />
      <ModerationLogCard clubId={clubId} isPl={isPl} />

      <RevealAuthorDialog target={reveal} onOpenChange={(open) => !open && setReveal(null)} />
      <ConfirmDialog state={confirm} onOpenChange={(open) => !open && setConfirm(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Blokady członków
// ---------------------------------------------------------------------------
function BannedMembersCard({ clubId, isPl }: { clubId: string; isPl: boolean }) {
  const { t } = useTranslation();
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
                    {new Date(m.joined_at).toLocaleDateString(isPl ? "pl-PL" : "en-GB")}
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
function ModerationLogCard({ clubId, isPl }: { clubId: string; isPl: boolean }) {
  const { t } = useTranslation();
  const logQ = useClubModerationLog(clubId);
  const [action, setAction] = useState<string | null>(null);

  const rows = useMemo(() => {
    const all = logQ.data ?? [];
    return action === null ? all : all.filter((r) => r.action === action);
  }, [logQ.data, action]);

  const label = (value: string) => {
    // Dziennik jest zapisem historycznym: wpis sprzed zmiany słownika ma nie
    // znikać ani wyświetlać surowego klucza, tylko własną nazwę akcji.
    const known = (LOG_ACTIONS as readonly string[]).includes(value);
    return known ? t(`adminClubs.moderation.action.${value}`) : value;
  };

  return (
    <Card>
      <CardHeader className="gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" />
            {t("adminClubs.moderation.logTitle")}
          </CardTitle>
          <Select value={action ?? ANY} onValueChange={(v) => setAction(v === ANY ? null : v)}>
            <SelectTrigger
              className="w-full sm:w-56"
              aria-label={t("adminClubs.moderation.filterAction")}
            >
              <SelectValue placeholder={t("adminClubs.moderation.filterAction")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t("adminClubs.filterAny")}</SelectItem>
              {LOG_ACTIONS.map((a) => (
                <SelectItem key={a} value={a}>
                  {t(`adminClubs.moderation.action.${a}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <CardDescription>{t("adminClubs.moderation.logHint")}</CardDescription>
      </CardHeader>
      <CardContent>
        {logQ.isPending ? (
          <div className="h-24 animate-pulse rounded-lg bg-muted/50" aria-busy="true" />
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {action === null
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
                        {new Date(r.created_at).toLocaleString(isPl ? "pl-PL" : "en-GB")}
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
                      {new Date(r.created_at).toLocaleString(isPl ? "pl-PL" : "en-GB")}
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

  const tooShort = reason.trim().length < MIN_REVEAL_REASON;

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
