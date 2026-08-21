// Organizm: zakładka "Tematy" - koordynacja treści z panelu.
//
// Trzy rzeczy, których nie było: lista tematów z akcjami, dodawanie tematu
// i odpowiedzi (także w imieniu członka), oraz usuwanie z przywracaniem.
//
// RESPONSYWNOŚĆ: poniżej lg tabela zamienia się w karty. To nie jest kosmetyka -
// w tabeli z ośmioma kolumnami na telefonie kolumna "Akcje" wypada poza ekran
// dokładnie wtedy, gdy jest potrzebna. Karta trzyma akcje przy treści.
//
// ORGANIZM JEST KOMPOZYCJĄ. Reguły tej zakładki - przecięcie zaznaczenia
// z widocznymi wierszami, kierunek każdej akcji moderatorskiej, walidacja
// i ładunek nowego tematu, ładunek odpowiedzi, lista działów docelowych
// przeniesienia i zdanie o ucięciu strony odpowiedzi - mieszkają w
// `lib/clubs/adminThreadsBoard.ts` i mają tam własną tabelę przypadków.
// Powtarzalne fragmenty widoku (linia autora, cztery akcje wiersza, pasek
// operacji wsadowych) są molekułami. Tutaj zostaje SKLEJENIE: co jedzie do
// mutacji, co się dzieje po błędzie i co widać w każdym z trzech stanów
// zapytania.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { toast } from "sonner";
import {
  ChevronDown,
  FolderInput,
  Lock,
  MessageSquarePlus,
  Pin,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
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
import { ClubTopicSelect } from "@/components/clubs/molecules/ClubTopicSelect";
import { ClubEnumSelect } from "@/components/clubs/molecules/ClubEnumSelect";
import {
  ClubModerationBulkBar,
  type ClubModerationBulkAction,
} from "@/components/admin/clubs/molecules/ClubModerationBulkBar";
import { ClubModerationThreadActions } from "@/components/admin/clubs/molecules/ClubModerationThreadActions";
import { ClubModerationThreadAuthor } from "@/components/admin/clubs/molecules/ClubModerationThreadAuthor";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  useAdminClubGroups,
  useAdminClubReplies,
  useAdminClubThreads,
  useAdminCreateReply,
  useAdminCreateThread,
  useBulkModerateClub,
  useModerateClubTarget,
  useMoveClubThread,
} from "@/lib/clubs/useClubs";
import {
  CLUB_THREAD_KINDS,
  CLUB_THREAD_STATUSES,
  adminAttributionNote,
  type AdminClubThreadRow,
  type ClubThreadKind,
} from "@/lib/clubs/types";
import {
  THREAD_FILTER_ANY,
  adminReplyVars,
  adminThreadCreateVars,
  allThreadIds,
  areAllThreadsSelected,
  canPostAdminReply,
  composerGroupId,
  isRemovedStatus,
  isRepliesPageTruncated,
  onBehalfLabel,
  replyIndentPx,
  threadFilterSelectValue,
  threadFilterValue,
  threadMoveTargets,
  toggleThreadSelection,
  visibleThreadIds,
  visibleThreadSelection,
  type ThreadBoardAction,
  type ThreadBulkAction,
} from "@/lib/clubs/adminThreadsBoard";
import { formatDateTime, uiLang } from "@/lib/i18n/format";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

export function ClubThreadsTab({ clubId }: { clubId: string }) {
  ensureAdminClubsI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [search, setSearch] = useState("");
  const [groupId, setGroupId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openThread, setOpenThread] = useState<AdminClubThreadRow | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const debounced = useDebouncedValue(search, 250);
  const filters = useMemo(
    () => ({ groupId, status, kind, search: debounced }),
    [groupId, status, kind, debounced],
  );

  const threadsQ = useAdminClubThreads(clubId, filters);
  const groupsQ = useAdminClubGroups(clubId);
  const moderateM = useModerateClubTarget(clubId);
  const bulkM = useBulkModerateClub(clubId);
  const moveM = useMoveClubThread(clubId);

  // `useMemo` na pustej liście, a nie `?? []` w locie: bez tego każdy render
  // daje nową referencję, a memoizacja niżej przestaje cokolwiek memoizować.
  const rows = useMemo(() => threadsQ.data?.rows ?? [], [threadsQ.data]);
  const groups = groupsQ.data ?? [];

  // Zaznaczenie jest DERYWOWANE względem tego, co realnie widać - reguła
  // i uzasadnienie w `adminThreadsBoard.ts`. Surowy zbiór trzymany bez
  // przecięcia znaczył, że "usuń 12" kasuje wpisy, których administrator nie
  // ma już na ekranie.
  const visibleIds = useMemo(() => visibleThreadIds(rows), [rows]);
  const selectedVisible = useMemo(
    () => visibleThreadSelection(selected, visibleIds),
    [selected, visibleIds],
  );

  const toggle = (id: string) => setSelected((prev) => toggleThreadSelection(prev, id));

  const act = (targetId: string, action: ThreadBoardAction) =>
    moderateM.mutate(
      { targetType: "thread", targetId, action },
      {
        onSuccess: () => toast.success(t("adminClubs.saved")),
        onError: () => toast.error(t("adminClubs.saveFailed")),
      },
    );

  const bulkAct = (action: ThreadBulkAction) => {
    if (selectedVisible.length === 0) return;
    const ids = selectedVisible;
    bulkM.mutate(
      { targetType: "thread", targetIds: ids, action },
      {
        onSuccess: (done) => {
          // "zmieniono 47 z 50" zamiast "gotowe": partia może częściowo nie przejść.
          toast.success(t("adminClubs.threads.bulkDone", { done, total: ids.length }));
          setSelected(new Set());
        },
        onError: () => toast.error(t("adminClubs.saveFailed")),
      },
    );
  };

  const bulkActions: ClubModerationBulkAction[] = [
    {
      id: "pin",
      label: t("adminClubs.threads.pin"),
      icon: <Pin className="mr-1.5 h-3.5 w-3.5" />,
      disabled: bulkM.isPending,
      onSelect: () => bulkAct("pin"),
    },
    {
      id: "lock",
      label: t("adminClubs.threads.lock"),
      icon: <Lock className="mr-1.5 h-3.5 w-3.5" />,
      disabled: bulkM.isPending,
      onSelect: () => bulkAct("lock"),
    },
    {
      id: "restore",
      label: t("adminClubs.threads.restore"),
      icon: <RotateCcw className="mr-1.5 h-3.5 w-3.5" />,
      disabled: bulkM.isPending,
      onSelect: () => bulkAct("restore"),
    },
    {
      id: "delete",
      label: t("adminClubs.threads.delete"),
      icon: <Trash2 className="mr-1.5 h-3.5 w-3.5" />,
      destructive: true,
      disabled: bulkM.isPending,
      onSelect: () =>
        setConfirm({
          title: t("adminClubs.threads.bulkDeleteTitle", { count: selectedVisible.length }),
          description: t("adminClubs.threads.deleteBody"),
          destructive: true,
          onConfirm: () => bulkAct("delete"),
        }),
    },
  ];

  return (
    <div className="space-y-5">
      {/* --- pasek filtrów --- */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_repeat(3,minmax(0,180px))_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("adminClubs.threads.searchPlaceholder")}
            className="pl-9"
            aria-label={t("adminClubs.threads.searchPlaceholder")}
          />
        </div>
        <Select
          value={threadFilterSelectValue(groupId)}
          onValueChange={(v) => setGroupId(threadFilterValue(v))}
        >
          <SelectTrigger aria-label={t("club.group")}>
            <SelectValue placeholder={t("club.group")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={THREAD_FILTER_ANY}>{t("club.allGroups")}</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {pickLocalized(g, "name", lang)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={threadFilterSelectValue(status)}
          onValueChange={(v) => setStatus(threadFilterValue(v))}
        >
          <SelectTrigger aria-label={t("adminClubs.columns.status")}>
            <SelectValue placeholder={t("adminClubs.columns.status")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={THREAD_FILTER_ANY}>{t("adminClubs.filterAny")}</SelectItem>
            {CLUB_THREAD_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`club.threadStatus.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={threadFilterSelectValue(kind)}
          onValueChange={(v) => setKind(threadFilterValue(v))}
        >
          <SelectTrigger aria-label={t("club.kind.label")}>
            <SelectValue placeholder={t("club.kind.label")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={THREAD_FILTER_ANY}>{t("club.allKinds")}</SelectItem>
            {CLUB_THREAD_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {t(`club.kind.${k}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={() => setComposerOpen(true)} className="whitespace-nowrap">
          <Plus className="mr-2 h-4 w-4" />
          {t("adminClubs.threads.newThread")}
        </Button>
      </div>

      {/* --- pasek akcji wsadowych: pojawia się tylko przy zaznaczeniu --- */}
      {selectedVisible.length > 0 ? (
        <ClubModerationBulkBar
          label={t("adminClubs.threads.selected", { count: selectedVisible.length })}
          actions={bulkActions}
          clearLabel={t("adminClubs.threads.clearSelection")}
          onClear={() => setSelected(new Set())}
        />
      ) : null}

      {threadsQ.isPending ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-muted/50" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            {t("adminClubs.threads.empty")}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Tabela od lg w górę */}
          <div className="hidden overflow-hidden rounded-lg border border-border/60 lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      aria-label={t("adminClubs.threads.selectAll")}
                      checked={areAllThreadsSelected(rows, selectedVisible.length)}
                      onCheckedChange={(v) =>
                        setSelected(v === true ? allThreadIds(rows) : new Set())
                      }
                    />
                  </TableHead>
                  <TableHead>{t("adminClubs.threads.title")}</TableHead>
                  <TableHead>{t("club.group")}</TableHead>
                  <TableHead>{t("club.kind.label")}</TableHead>
                  <TableHead>{t("adminClubs.columns.status")}</TableHead>
                  <TableHead className="text-right">{t("club.members")}</TableHead>
                  <TableHead className="text-right">{t("adminClubs.threads.replies")}</TableHead>
                  <TableHead className="w-32 sr-only">{t("adminClubs.columns.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} className="hover:bg-muted/40">
                    <TableCell>
                      <Checkbox
                        aria-label={row.title}
                        checked={selected.has(row.id)}
                        onCheckedChange={() => toggle(row.id)}
                      />
                    </TableCell>
                    <TableCell className="max-w-[280px]">
                      <button
                        type="button"
                        className="truncate text-left font-medium hover:text-primary"
                        onClick={() => setOpenThread(row)}
                      >
                        {row.title}
                      </button>
                      <ClubModerationThreadAuthor row={row} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {pickLocalized(row, "group_name", lang)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[11px]">
                        {t(`club.kind.${row.kind}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[11px]">
                        {t(`club.threadStatus.${row.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.participant_count}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.reply_count}</TableCell>
                    <TableCell>
                      <ClubModerationThreadActions
                        row={row}
                        onAct={(action) => act(row.id, action)}
                        onOpen={() => setOpenThread(row)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Karty poniżej lg - te same akcje, układ pionowy */}
          <ul className="grid gap-2 lg:hidden">
            {rows.map((row) => (
              <li key={row.id} className="rounded-lg border border-border/60 bg-card p-3">
                <div className="flex items-start gap-3">
                  <Checkbox
                    aria-label={row.title}
                    checked={selected.has(row.id)}
                    onCheckedChange={() => toggle(row.id)}
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      className="w-full truncate text-left font-medium"
                      onClick={() => setOpenThread(row)}
                    >
                      {row.title}
                    </button>
                    <ClubModerationThreadAuthor row={row} />
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="text-[11px]">
                        {t(`club.kind.${row.kind}`)}
                      </Badge>
                      <Badge variant="outline" className="text-[11px]">
                        {t(`club.threadStatus.${row.status}`)}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {pickLocalized(row, "group_name", lang)}
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {row.reply_count} / {row.participant_count}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1 border-t border-border/60 pt-2">
                  <ClubModerationThreadActions
                    row={row}
                    onAct={(action) => act(row.id, action)}
                    onOpen={() => setOpenThread(row)}
                    compact
                  />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <ThreadComposerDialog clubId={clubId} open={composerOpen} onOpenChange={setComposerOpen} />

      <ThreadDetailDialog
        clubId={clubId}
        thread={openThread}
        onOpenChange={(open) => !open && setOpenThread(null)}
        onMove={(groupId2) => {
          if (!openThread) return;
          moveM.mutate(
            { threadId: openThread.id, groupId: groupId2 },
            {
              onSuccess: () => toast.success(t("adminClubs.threads.moved")),
              onError: () => toast.error(t("adminClubs.saveFailed")),
            },
          );
        }}
      />

      <ConfirmDialog state={confirm} onOpenChange={(open) => !open && setConfirm(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kompozytor: nowy temat, opcjonalnie w imieniu członka
// ---------------------------------------------------------------------------
function ThreadComposerDialog({
  clubId,
  open,
  onOpenChange,
}: {
  clubId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const groupsQ = useAdminClubGroups(clubId);
  const createM = useAdminCreateThread(clubId);

  const [groupId, setGroupId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<ClubThreadKind>("discussion");
  const [authorId, setAuthorId] = useState("");
  const [topic, setTopic] = useState<string | null>(null);

  const groups = groupsQ.data ?? [];
  const effectiveGroup = composerGroupId(groupId, groups);

  const submit = () => {
    const vars = adminThreadCreateVars(
      { groupId, title, body, kind, authorId, topic },
      effectiveGroup,
    );
    if (vars === null) {
      toast.error(t("adminClubs.threads.validation"));
      return;
    }
    createM.mutate(vars, {
      onSuccess: () => {
        toast.success(t("adminClubs.threads.created"));
        setTitle("");
        setBody("");
        setAuthorId("");
        onOpenChange(false);
      },
      onError: () => toast.error(t("adminClubs.saveFailed")),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("adminClubs.threads.newThread")}</DialogTitle>
          <DialogDescription>{t("adminClubs.threads.newThreadHint")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="admin-thread-group">{t("club.group")}</Label>
              <Select value={effectiveGroup} onValueChange={setGroupId}>
                <SelectTrigger id="admin-thread-group">
                  <SelectValue placeholder={t("club.group")} />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {pickLocalized(g, "name", lang)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ClubEnumSelect
              id="admin-thread-kind"
              label={t("club.kind.label")}
              value={kind}
              options={CLUB_THREAD_KINDS}
              i18nPrefix="club.kind"
              hintPrefix="club.kindHint"
              onChange={setKind}
              disabled={createM.isPending}
            />
          </div>

          <ClubTopicSelect
            id="admin-thread-topic"
            label={t("club.topic.label")}
            hint={t("club.topic.hint")}
            value={topic}
            onChange={setTopic}
            disabled={createM.isPending}
          />

          <div className="space-y-1.5">
            <Label htmlFor="admin-thread-title">{t("club.threadTitle")}</Label>
            <Input
              id="admin-thread-title"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="admin-thread-body">{t("club.threadBody")}</Label>
            <Textarea
              id="admin-thread-body"
              rows={8}
              maxLength={20000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>

          {/* Publikacja w imieniu: pole opcjonalne, z ostrzeżeniem widocznym
              ZANIM administrator kliknie zapisz, nie po. */}
          <div className="space-y-1.5 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
            <Label>{t("adminClubs.threads.onBehalfLabel")}</Label>
            <MemberPicker
              value={authorId}
              onChange={setAuthorId}
              disabled={createM.isPending}
              labels={{
                placeholder: t("adminClubs.threads.onBehalfPlaceholder"),
                search: t("adminClubs.searchPlaceholder"),
                hint: t("adminClubs.members.addHint"),
                loading: t("club.retry"),
                empty: t("adminClubs.members.empty"),
                clear: t("adminClubs.filterAny"),
              }}
            />
            <p className="text-xs text-amber-800 dark:text-amber-200">
              {t(`adminClubs.threads.${onBehalfLabel(authorId)}`)}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={createM.isPending}>
            {t("club.publishThread")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Podgląd wątku: odpowiedzi z akcjami, dodawanie odpowiedzi, przeniesienie
// ---------------------------------------------------------------------------
function ThreadDetailDialog({
  clubId,
  thread,
  onOpenChange,
  onMove,
}: {
  clubId: string;
  thread: AdminClubThreadRow | null;
  onOpenChange: (open: boolean) => void;
  onMove: (groupId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const repliesQ = useAdminClubReplies(thread?.id);
  const groupsQ = useAdminClubGroups(clubId);
  const moderateM = useModerateClubTarget(clubId);
  const replyM = useAdminCreateReply(clubId);

  const [body, setBody] = useState("");
  const [authorId, setAuthorId] = useState("");
  const [showMove, setShowMove] = useState(false);

  const replies = repliesQ.data?.rows ?? [];
  // Suma z RPC, nie dlugosc strony: moderator ma wiedziec, ze widzi wycinek.
  const repliesTotal = repliesQ.data?.total ?? 0;
  const groups = threadMoveTargets(groupsQ.data ?? [], thread?.group_id);

  const submitReply = () => {
    const vars = adminReplyVars(thread?.id ?? null, body, authorId);
    if (vars === null) return;
    replyM.mutate(vars, {
      onSuccess: () => {
        setBody("");
        setAuthorId("");
        toast.success(t("club.replyPosted"));
      },
      onError: () => toast.error(t("adminClubs.saveFailed")),
    });
  };

  return (
    <Dialog open={thread !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-6 text-left">{thread?.title}</DialogTitle>
          <DialogDescription className="text-left">
            {thread !== null
              ? `${pickLocalized(thread, "group_name", lang)} · ${t(`club.kind.${thread.kind}`)}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        {/* Przeniesienie do innej grupy */}
        <div className="rounded-lg border border-border/60 p-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={() => setShowMove((v) => !v)}
          >
            <FolderInput className="h-3.5 w-3.5" />
            {t("adminClubs.threads.move")}
            <ChevronDown
              className={`h-3 w-3 transition-transform ${showMove ? "rotate-180" : ""}`}
            />
          </Button>
          {showMove ? (
            <div className="mt-2">
              {groups.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("adminClubs.threads.noOtherGroup")}
                </p>
              ) : (
                <Select onValueChange={onMove}>
                  <SelectTrigger className="max-w-xs">
                    <SelectValue placeholder={t("adminClubs.threads.moveTarget")} />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {pickLocalized(g, "name", lang)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          ) : null}
        </div>

        {/* Odpowiedzi */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">
            {t("club.repliesCount", { count: repliesTotal })}
          </h3>
          {isRepliesPageTruncated(repliesTotal, replies.length) ? (
            <p className="text-xs text-muted-foreground">
              {t("club.repliesTruncated", { shown: replies.length, total: repliesTotal })}
            </p>
          ) : null}
          {repliesQ.isPending ? (
            <div className="h-20 animate-pulse rounded-lg bg-muted/50" aria-busy="true" />
          ) : replies.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t("club.noReplies")}</p>
          ) : (
            <ul className="space-y-2">
              {replies.map((r) => {
                const note = adminAttributionNote(r.posted_by_admin_name, t("club.postedOnBehalf"));
                const removed = isRemovedStatus(r.status);
                return (
                  <li
                    key={r.id}
                    className={`rounded-lg border p-3 ${
                      removed
                        ? "border-destructive/30 bg-destructive/5 opacity-70"
                        : "border-border/60"
                    }`}
                    style={{ marginLeft: `${replyIndentPx(r.depth)}px` }}
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {r.is_anonymous ? t("adminClubs.threads.protectedIdentity") : r.author_name}
                      </span>
                      <span>{formatDateTime(r.created_at, i18n.language)}</span>
                      {note !== null ? <span className="italic">{note}</span> : null}
                      {removed ? (
                        <Badge variant="outline" className="text-[11px] text-destructive">
                          {t(`club.threadStatus.${r.status}`)}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm">{r.body}</p>
                    <div className="mt-2 flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        disabled={moderateM.isPending}
                        onClick={() =>
                          moderateM.mutate(
                            {
                              targetType: "reply",
                              targetId: r.id,
                              action: removed ? "restore" : "delete",
                            },
                            {
                              onSuccess: () => toast.success(t("adminClubs.saved")),
                              onError: () => toast.error(t("adminClubs.saveFailed")),
                            },
                          )
                        }
                      >
                        {removed ? (
                          <>
                            <RotateCcw className="mr-1.5 h-3 w-3" />
                            {t("adminClubs.threads.restore")}
                          </>
                        ) : (
                          <>
                            <Trash2 className="mr-1.5 h-3 w-3" />
                            {t("adminClubs.threads.delete")}
                          </>
                        )}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Dodanie odpowiedzi z panelu */}
        <div className="space-y-2 rounded-lg border border-border/60 p-3">
          <Label htmlFor="admin-reply-body" className="flex items-center gap-1.5 text-sm">
            <MessageSquarePlus className="h-3.5 w-3.5" />
            {t("adminClubs.threads.addReply")}
          </Label>
          <Textarea
            id="admin-reply-body"
            rows={3}
            maxLength={10000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("club.replyPlaceholder")}
          />
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <MemberPicker
              value={authorId}
              onChange={setAuthorId}
              disabled={replyM.isPending}
              labels={{
                placeholder: t("adminClubs.threads.onBehalfPlaceholder"),
                search: t("adminClubs.searchPlaceholder"),
                hint: t("adminClubs.members.addHint"),
                loading: t("club.retry"),
                empty: t("adminClubs.members.empty"),
                clear: t("adminClubs.filterAny"),
              }}
            />
            <Button onClick={submitReply} disabled={replyM.isPending || !canPostAdminReply(body)}>
              {t("club.postReply")}
            </Button>
          </div>
          {authorId !== "" ? (
            <p className="text-xs text-amber-800 dark:text-amber-200">
              {t("adminClubs.threads.onBehalfWarning")}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
