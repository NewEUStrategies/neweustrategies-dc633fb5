// /club/$clubSlug/t/$threadSlug - widok wątku.
//
// Nowe odpowiedzi NIE WSKAKUJĄ same do widoku. Gdy przyjdą, pojawia się pasek
// "N nowych odpowiedzi - pokaż". Wstawianie treści pod kursorem czytającego to
// najczęstszy błąd UX w tej klasie produktów: czat może sobie na to pozwolić,
// długa deliberacja nie (V1 §5.4). Mechanikę trzyma `useDeferredReplies` -
// wcześniej ten komentarz opisywał zachowanie, którego kod nie miał, a globalna
// inwalidacja z szyny zdarzeń robiła dokładnie to, przed czym on ostrzega.
//
// Kompozytor reużywa `MentionTextarea` (V1 §4.1): parser wzmianek po stronie
// bazy (`process_mentions` dla `club_reply`) jest wpięty od A12, więc bez
// podpowiedzi w polu jedyną drogą do wzmianki było wpisanie sluga z pamięci.
//
// Wejście "Zgłoś" stoi przy KAŻDYM wpisie - wątku i odpowiedzi (V1 §7).
import { lazy, Suspense, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  Link2,
  Lock,
  MessageSquare,
  Pencil,
  Pin,
  ShieldQuestion,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MentionTextarea } from "@/components/mentions/MentionTextarea";
import {
  useClubBySlug,
  useClubReactions,
  useClubReplies,
  useClubStanceSummary,
  useClubThread,
  useEditClubReply,
  useEditClubThread,
  useMyThreadSubscription,
  useReplyToThread,
  useResolveClubThread,
  useSetClubStance,
  useSetThreadSubscription,
  useToggleClubReaction,
} from "@/lib/clubs/useClubs";
import { useDeferredReplies } from "@/lib/clubs/useDeferredReplies";
import { ClubReactionBar } from "@/components/clubs/molecules/ClubReactionBar";
import { ClubFollowButton } from "@/components/clubs/molecules/ClubFollowButton";
import { ClubInlineEditor } from "@/components/clubs/molecules/ClubInlineEditor";
import { ClubStanceBar } from "@/components/clubs/molecules/ClubStanceBar";

import { ClubNewRepliesBar } from "@/components/clubs/molecules/ClubNewRepliesBar";
import { ClubReportButton } from "@/components/clubs/molecules/ClubReportButton";
import { ClubErrorNotice } from "@/components/clubs/molecules/ClubErrorNotice";
import { buildClubHead, toClubHeadSource } from "@/lib/clubs/clubHead";
import { fetchClubBySlug } from "@/lib/clubs/api";
import { clubKeys } from "@/lib/clubs/queryKeys";
import { formatDateTime } from "@/lib/i18n/format";
import {
  buildClubReplyTree,
  isClubReplyLive,
  toAuthorLabel,
  CLUB_REPLY_SORTS,
  type ClubReactionKind,
  type ClubReactionTally,
  type ClubReplyNode,
  type ClubReplySort,
} from "@/lib/clubs/types";
import { ensureClubI18n } from "@/lib/i18n-club";

const BODY_MAX = 10000;

/**
 * Sondaż i dialog zgłoszenia są ŁADOWANE LENIWIE - ta sama konwencja, co
 * `lazyBlockViews` dla bloków interaktywnych, i z tego samego powodu:
 *
 *   * sondaż ciągnie za sobą całą warstwę `polls` (zapytania publiczne,
 *     głosowanie, słupki), a dotyczy JEDNEGO z sześciu rodzajów wątku;
 *   * dialog zgłoszenia ciągnie radix Dialog, a otwiera się raz na wiele
 *     tysięcy odsłon.
 *
 * Statyczny import obu wciągał je do wspólnego grafu każdej odsłony wątku,
 * czyli płaciliśmy za nie zawsze, żeby użyć ich prawie nigdy.
 */
const ClubThreadPoll = lazy(() =>
  import("@/components/clubs/organisms/ClubThreadPoll").then((m) => ({
    default: m.ClubThreadPoll,
  })),
);

export const Route = createFileRoute("/club/$clubSlug/t/$threadSlug")({
  // Naglowek potrzebuje widocznosci klubu, zeby rozstrzygnac indeksowalnosc,
  // a head() jest synchroniczne. Loader dowozi kartę klubu do cache (widok i tak
  // ją zaraz przeczyta, więc to nie jest dodatkowy round-trip) i zwraca z niej
  // MINIMUM. Awaria backendu kończy się `null`, czyli `noindex` - trasa nadal
  // się renderuje (doktryna odporności publicznych tras).
  loader: async ({ context, params }) => {
    const club = await context.queryClient
      .ensureQueryData({
        queryKey: clubKeys.bySlug(params.clubSlug),
        queryFn: () => fetchClubBySlug(params.clubSlug),
      })
      .catch(() => null);
    return { club: toClubHeadSource(club) };
  },
  head: ({ loaderData, params }) =>
    buildClubHead({
      fallbackPath: `/club/${params.clubSlug}/t/${params.threadSlug}`,
      club: loaderData?.club ?? null,
    }),
  component: ClubThreadView,
});

function ClubThreadView() {
  ensureClubI18n();
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = (i18n.language ?? "pl").startsWith("pl") ? "pl" : "en";
  const isPl = lang === "pl";
  const { clubSlug, threadSlug } = Route.useParams();
  const { user } = useAuth();

  const clubQ = useClubBySlug(clubSlug);
  const club = clubQ.data ?? null;
  const threadQ = useClubThread({ clubId: club?.id, slug: threadSlug });
  const thread = threadQ.data ?? null;

  const [replySort, setReplySort] = useState<ClubReplySort>("chronological");
  const repliesQ = useClubReplies({ threadId: thread?.id, sort: replySort });

  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  // Redakcja: `"thread"` albo id odpowiedzi. Jeden stan, bo w danej chwili
  // otwarty jest najwyżej jeden edytor - dwa naraz to dwie wersje tej samej
  // dyskusji na ekranie.
  const [editing, setEditing] = useState<string | null>(null);

  const replyM = useReplyToThread(club?.id ?? "", threadSlug);
  const resolveM = useResolveClubThread(club?.id ?? "", threadSlug);
  const editThreadM = useEditClubThread(club?.id ?? "", threadSlug);
  const editReplyM = useEditClubReply(threadQ.data?.id ?? "");

  // Stanowiska tylko dla wątku typu "stanowisko" - baza odrzuca resztę
  // z 22023, więc pytanie o nie gdzie indziej byłoby pytaniem o błąd.
  const isPosition = threadQ.data?.kind === "position";
  const stanceQ = useClubStanceSummary(isPosition ? threadQ.data?.id : undefined);
  const setStanceM = useSetClubStance(threadQ.data?.id ?? "");
  const subscriptionQ = useMyThreadSubscription(threadQ.data?.id);
  const setSubscriptionM = useSetThreadSubscription(threadQ.data?.id ?? "");

  // Projekcja odroczona: dane są świeże (licznik w pasku musi być prawdziwy),
  // renderujemy tylko to, co czytelnik przyjął.
  const deferred = useDeferredReplies(repliesQ.data?.rows, thread?.id);

  // Dwie partie, dwa zapytania wsadowe - nigdy jedno na wpis.
  const threadIds = thread ? [thread.id] : [];
  const replyIds = deferred.rows.map((r) => r.id);
  const threadReactionsQ = useClubReactions({ targetType: "thread", targetIds: threadIds });
  const replyReactionsQ = useClubReactions({ targetType: "reply", targetIds: replyIds });
  const toggleThreadReaction = useToggleClubReaction({
    targetType: "thread",
    targetIds: threadIds,
  });
  const toggleReplyReaction = useToggleClubReaction({ targetType: "reply", targetIds: replyIds });

  // Zapytanie o wątek jest WYŁĄCZONE, dopóki nie znamy id klubu, a wyłączone
  // `useQuery` zostaje w stanie `isPending` na zawsze. Warunek musi więc pytać
  // o wątek tylko wtedy, gdy klub faktycznie jest - inaczej wejście na
  // nieistniejący slug kończy się wiecznym szkieletem zamiast 404.
  if (clubQ.isPending || (club !== null && threadQ.isPending)) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-8 py-8">
        <div className="h-64 animate-pulse rounded-lg bg-muted/50" aria-busy="true" />
      </div>
    );
  }

  // Awaria zapytania to NIE jest "nie ma takiego wątku". Pusta odpowiedź znaczy
  // 404 (klub `secret` nie ma prawa zdradzić, że istnieje), a błąd sieci albo
  // bazy ma powiedzieć, że to problem po naszej stronie i da się spróbować
  // ponownie - inaczej użytkownik kasuje poprawny link jako martwy.
  if (clubQ.isError || threadQ.isError) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-8 py-12">
        <ClubErrorNotice
          onRetry={() => {
            void clubQ.refetch();
            void threadQ.refetch();
          }}
        />
      </div>
    );
  }

  if (!club || !thread) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-8 py-12">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <p className="text-sm text-muted-foreground">{t("club.reason.not_found")}</p>
            <Button asChild variant="outline" size="sm">
              <Link to="/club/$clubSlug" params={{ clubSlug }}>
                {isPl ? (club?.name_pl ?? t("club.title")) : (club?.name_en ?? t("club.title"))}
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const author = toAuthorLabel(thread, t("club.anonymousAuthor"), t("club.deletedAuthor"));
  const tree = buildClubReplyTree(deferred.rows);
  const repliesTotal = repliesQ.data?.total ?? 0;
  const repliesShown = repliesQ.data?.rows.length ?? 0;
  // Autor pytania i moderacja mogą wskazać odpowiedź rozstrzygającą.
  const canResolve =
    thread.kind === "question" && (thread.can_moderate || thread.author_id === user?.id);
  // Anonimowość wolno włączyć wyłącznie tam, gdzie tryb klubu na to pozwala.
  const canGoAnonymous = thread.attribution_mode === "anonymous_allowed";
  // Autor poprawia SWÓJ wpis; moderacja - każdy. W klubie pod regułą Chatham
  // House `author_id` nie wychodzi z RPC, więc porównanie jest tam zawsze
  // fałszywe - i tak ma być: baza i tak sprawdzi autorstwo przy zapisie, a
  // interfejs nie ma prawa zdradzić, że to wpis czytającego.
  const isMyThread = thread.author_id !== null && thread.author_id === user?.id;
  const canEditThread = (isMyThread || thread.can_moderate) && thread.locked_at === null;
  // Zgłaszać wolno cudzy wpis i tylko zalogowanemu - własnego RPC i tak nie
  // przyjmie (22023), więc przycisk, który zawsze kończy się błędem, nie ma po
  // co stać na ekranie.
  const canReportThread = Boolean(user) && !isMyThread;
  // Sort "mapa sporu" ma sens wyłącznie tam, gdzie stanowiska w ogóle istnieją.
  const replySorts = CLUB_REPLY_SORTS.filter((sort) => sort !== "stance" || isPosition);

  const submitReply = () => {
    const trimmed = body.trim();
    if (trimmed.length === 0) return;
    replyM.mutate(
      { threadId: thread.id, body: trimmed, parentId: replyTo, anonymous },
      {
        onSuccess: () => {
          setBody("");
          setReplyTo(null);
          // Własna odpowiedź nie czeka w kolejce "pokaż nowe": kazanie autorowi
          // kliknąć, żeby zobaczyć to, co przed chwilą wysłał, byłoby absurdem.
          deferred.reveal();
          toast.success(t("club.replyPosted"));
        },
        onError: () => toast.error(t("adminClubs.saveFailed")),
      },
    );
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-8 py-8">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3 h-8 px-2">
        <Link to="/club/$clubSlug" params={{ clubSlug }}>
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          {isPl ? club.name_pl : club.name_en}
        </Link>
      </Button>

      {/* --- post otwierający --- */}
      <article className="rounded-lg border border-border/60 bg-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          {thread.pinned_at !== null ? <Pin className="h-4 w-4 text-primary" /> : null}
          <Badge variant="outline">{t(`club.kind.${thread.kind}`)}</Badge>
          {thread.status === "resolved" ? (
            <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300">
              {t("club.threadStatus.resolved")}
            </Badge>
          ) : null}
          {thread.locked_at !== null ? (
            <Badge variant="outline" className="gap-1">
              <Lock className="h-3 w-3" />
              {t("club.threadStatus.locked")}
            </Badge>
          ) : null}
          {thread.attribution_mode === "chatham" ? (
            <Badge variant="outline" className="gap-1">
              <ShieldQuestion className="h-3 w-3" />
              {t("club.attribution.chatham")}
            </Badge>
          ) : null}
          {/* Kotwica jest KRAWĘDZIĄ w grafie treści, więc pokazujemy ją tam,
              gdzie czytelnik decyduje, czy wątek go dotyczy - w nagłówku, nie
              na dole. */}
          {thread.anchor_type !== null ? (
            <Badge variant="secondary" className="gap-1">
              <Link2 className="h-3 w-3" aria-hidden="true" />
              {t(`club.anchorType.${thread.anchor_type}`)}
            </Badge>
          ) : null}
        </div>

        <h1 className="mt-2 text-2xl font-semibold leading-snug">{thread.title}</h1>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>{author.name}</span>
          <span>{formatDateTime(thread.created_at, lang)}</span>
          {thread.edited_at !== null ? <span>({t("club.edited")})</span> : null}
        </div>

        {editing === "thread" ? (
          <div className="mt-4">
            <ClubInlineEditor
              idPrefix="club-thread-edit"
              initialTitle={thread.title}
              initialBody={thread.body}
              showReason={!isMyThread}
              pending={editThreadM.isPending}
              onCancel={() => setEditing(null)}
              onSave={(patch) =>
                editThreadM.mutate(
                  { threadId: thread.id, ...patch },
                  {
                    onSuccess: () => {
                      setEditing(null);
                      toast.success(t("club.editor.saved"));
                    },
                    onError: () => toast.error(t("adminClubs.saveFailed")),
                  },
                )
              }
            />
          </div>
        ) : (
          <div className="mt-4 whitespace-pre-wrap text-[15px] leading-relaxed">{thread.body}</div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
          <ClubReactionBar
            tallies={threadReactionsQ.data?.get(thread.id) ?? []}
            disabled={!thread.can_reply || toggleThreadReaction.isPending}
            variant="full"
            onToggle={(kind, active) =>
              toggleThreadReaction.mutate({ targetId: thread.id, kind, active })
            }
          />
          <div className="flex flex-wrap gap-2">
            {canEditThread && editing !== "thread" ? (
              <Button size="sm" variant="ghost" onClick={() => setEditing("thread")}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                {t("club.editor.edit")}
              </Button>
            ) : null}
            {canReportThread ? <ClubReportButton targetType="thread" targetId={thread.id} /> : null}
            <ClubFollowButton
              state={subscriptionQ.data ?? null}
              pending={setSubscriptionM.isPending}
              disabled={subscriptionQ.isPending}
              onChange={(next) =>
                setSubscriptionM.mutate(next, {
                  onError: () => toast.error(t("adminClubs.saveFailed")),
                })
              }
            />
          </div>
        </div>
      </article>

      {/* --- sondaż (wyłącznie wątek typu "sondaż") ---
          Rodzaj `poll` był do A20 samą etykietą: model dopuszczał go od A3,
          specyfikacja obiecywała reużycie `polls`, a krawędzi między wątkiem
          a ankietą nie było. Teraz jest kolumna `poll_id` i to samo
          głosowanie, co na /polls - z anti-anchoringiem włącznie. */}
      {thread.kind === "poll" && thread.poll_id !== null ? (
        <div className="mt-4">
          <Suspense
            fallback={
              <div className="h-40 animate-pulse rounded-lg bg-muted/50" aria-busy="true" />
            }
          >
            <ClubThreadPoll pollId={thread.poll_id} lang={lang} userId={user?.id ?? null} />
          </Suspense>
        </div>
      ) : null}

      {/* --- stanowiska (wyłącznie wątek typu "stanowisko") --- */}
      {isPosition ? (
        <div className="mt-4">
          <ClubStanceBar
            rows={stanceQ.data ?? []}
            disabled={!thread.can_reply}
            pending={setStanceM.isPending}
            onSet={(stance) =>
              setStanceM.mutate(
                { stance },
                {
                  onSuccess: () => toast.success(t("club.stance.saved")),
                  onError: () => toast.error(t("adminClubs.saveFailed")),
                },
              )
            }
          />
        </div>
      ) : null}

      {/* --- odpowiedzi --- */}
      <section className="mt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <MessageSquare className="h-4 w-4" />
            {t("club.repliesCount", { count: thread.reply_count })}
          </h2>
          {repliesTotal > 1 ? (
            <Select value={replySort} onValueChange={(v) => setReplySort(v as ClubReplySort)}>
              <SelectTrigger className="h-8 w-auto min-w-40" aria-label={t("club.replySort.label")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {replySorts.map((sort) => (
                  <SelectItem key={sort} value={sort}>
                    {t(`club.replySort.${sort}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>

        <ClubNewRepliesBar count={deferred.pendingCount} onReveal={deferred.reveal} />

        {repliesQ.isPending ? (
          <div className="h-24 animate-pulse rounded-lg bg-muted/50" aria-busy="true" />
        ) : tree.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
            {t("club.noReplies")}
          </p>
        ) : (
          <ul className="space-y-3">
            {tree.map((node) => (
              <ReplyBranch
                key={node.reply.id}
                node={node}
                lang={lang}
                canResolve={canResolve}
                canReact={thread.can_reply}
                canModerate={thread.can_moderate}
                threadLocked={thread.locked_at !== null}
                myUserId={user?.id ?? null}
                editing={editing}
                editPending={editReplyM.isPending}
                onEdit={setEditing}
                onSaveEdit={(replyId, patch) =>
                  editReplyM.mutate(
                    { replyId, body: patch.body, reason: patch.reason },
                    {
                      onSuccess: () => {
                        setEditing(null);
                        toast.success(t("club.editor.saved"));
                      },
                      onError: () => toast.error(t("adminClubs.saveFailed")),
                    },
                  )
                }
                reactions={replyReactionsQ.data ?? new Map()}
                onToggleReaction={(targetId, kind, active) =>
                  toggleReplyReaction.mutate({ targetId, kind, active })
                }
                onReply={setReplyTo}
                onResolve={(replyId) =>
                  resolveM.mutate(
                    { threadId: thread.id, replyId },
                    {
                      onSuccess: () => toast.success(t("club.resolvedToast")),
                      onError: () => toast.error(t("adminClubs.saveFailed")),
                    },
                  )
                }
              />
            ))}
          </ul>
        )}

        {/* Ucięcie strony mówi się WPROST. Nagłówek pokazuje pełny licznik
            z denormalizacji, więc milcząca różnica wyglądałaby jak utrata
            treści, a nie jak paginacja. */}
        {repliesTotal > repliesShown ? (
          <p className="mt-3 rounded-lg border border-dashed border-border/60 p-3 text-center text-xs text-muted-foreground">
            {t("club.repliesTruncated", { shown: repliesShown, total: repliesTotal })}
          </p>
        ) : null}
      </section>

      {/* --- kompozytor --- */}
      {thread.can_reply ? (
        <section className="mt-6 rounded-lg border border-border/60 bg-card p-4">
          {replyTo !== null ? (
            <div className="mb-2 flex items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-1.5 text-xs">
              <span className="text-muted-foreground">{t("club.replyingTo")}</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2"
                onClick={() => setReplyTo(null)}
              >
                {t("club.cancelReplyTo")}
              </Button>
            </div>
          ) : null}

          {/* Wzmianki: ten sam komponent i ten sam parser, co w komentarzach.
              Backend obsługuje `club_reply` w `process_mentions` od A12, więc
              bez podpowiedzi w polu jedyną drogą było wpisanie sluga z pamięci. */}
          <MentionTextarea
            id="club-reply-body"
            label={t("club.replyPlaceholder")}
            value={body}
            onChange={setBody}
            lang={lang}
            rows={4}
            maxLength={BODY_MAX}
          />

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              {canGoAnonymous ? (
                <div className="flex items-center gap-2">
                  <Switch
                    id="club-reply-anon"
                    checked={anonymous}
                    disabled={replyM.isPending}
                    onCheckedChange={setAnonymous}
                  />
                  <Label htmlFor="club-reply-anon" className="text-sm">
                    {t("club.postAnonymously")}
                  </Label>
                </div>
              ) : null}
              <span className="text-xs text-muted-foreground">
                {body.trim().length} / {BODY_MAX}
              </span>
            </div>
            <Button onClick={submitReply} disabled={replyM.isPending || body.trim().length === 0}>
              {t("club.postReply")}
            </Button>
          </div>
        </section>
      ) : (
        <p className="mt-6 rounded-lg border border-border/60 bg-muted/30 p-4 text-center text-sm text-muted-foreground">
          {thread.reason ? t(`club.reason.${thread.reason}`) : t("club.cannotReply")}
        </p>
      )}
    </div>
  );
}

interface ReplyBranchProps {
  node: ClubReplyNode;
  lang: "pl" | "en";
  canResolve: boolean;
  canReact: boolean;
  canModerate: boolean;
  threadLocked: boolean;
  myUserId: string | null;
  /** `"thread"` albo id odpowiedzi w edycji; `null` gdy nic nie jest otwarte. */
  editing: string | null;
  editPending: boolean;
  onEdit: (target: string | null) => void;
  onSaveEdit: (replyId: string, patch: { body: string; reason: string | null }) => void;
  reactions: Map<string, ClubReactionTally[]>;
  onToggleReaction: (targetId: string, kind: ClubReactionKind, active: boolean) => void;
  onReply: (replyId: string) => void;
  onResolve: (replyId: string) => void;
}

function ReplyBranch(props: ReplyBranchProps) {
  const {
    node,
    lang,
    canResolve,
    canReact,
    canModerate,
    threadLocked,
    myUserId,
    editing,
    editPending,
    onEdit,
    onSaveEdit,
    reactions,
    onToggleReaction,
    onReply,
    onResolve,
  } = props;
  const { t } = useTranslation();
  const { reply, children } = node;
  const author = toAuthorLabel(reply, t("club.anonymousAuthor"), t("club.deletedAuthor"));
  // W klubie pod regułą Chatham House `author_id` nie wychodzi z RPC, więc
  // porównanie jest tam zawsze fałszywe - i tak ma być. Baza sprawdzi
  // autorstwo przy zapisie, a interfejs nie może zdradzić, czyj to wpis.
  const isMine = reply.author_id !== null && reply.author_id === myUserId;
  // `isClubReplyLive` zamiast porównania ze stringiem: poprzednia wersja
  // sprawdzała `status !== "removed"`, a takiego statusu nie ma w słowniku
  // (`pending | visible | hidden | deleted`), więc warunek był zawsze prawdziwy
  // i wpis usunięty przez moderację zachowywał przycisk redakcji.
  const canEdit = (isMine || canModerate) && !threadLocked && isClubReplyLive(reply.status);
  const canReport = myUserId !== null && !isMine;

  return (
    <li>
      <div
        className={
          "rounded-lg border p-4 " +
          (reply.is_resolution
            ? "border-emerald-500/40 bg-emerald-500/5"
            : "border-border/60 bg-card")
        }
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="font-medium">{author.name}</span>
          <span className="text-xs text-muted-foreground">
            {formatDateTime(reply.created_at, lang)}
          </span>
          {reply.edited_at !== null ? (
            <span className="text-xs text-muted-foreground">({t("club.edited")})</span>
          ) : null}
          {/* Stanowisko autora - jedyny sygnał, który zamienia listę odpowiedzi
              w mapę sporu. Baza zwraca je wyłącznie w wątku `position` i
              wyłącznie przy autorstwie jawnym. */}
          {reply.author_stance !== null ? (
            <Badge variant="outline" className="text-[11px]">
              {t(`club.stance.${reply.author_stance}`)}
            </Badge>
          ) : null}
          {reply.is_resolution ? (
            <Badge className="gap-1 bg-emerald-500/15 text-[11px] text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300">
              <CheckCircle2 className="h-3 w-3" />
              {t("club.resolution")}
            </Badge>
          ) : null}
          {reply.status === "pending" ? (
            <Badge variant="outline" className="text-[11px] text-amber-700 dark:text-amber-300">
              {t("club.threadStatus.pending")}
            </Badge>
          ) : null}
        </div>

        {editing === reply.id ? (
          <div className="mt-3">
            <ClubInlineEditor
              idPrefix={`club-reply-edit-${reply.id}`}
              initialBody={reply.body}
              showReason={!isMine}
              pending={editPending}
              onCancel={() => onEdit(null)}
              onSave={(patch) => onSaveEdit(reply.id, { body: patch.body, reason: patch.reason })}
            />
          </div>
        ) : (
          <div className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed">{reply.body}</div>
        )}

        {/* Pasek zwinięty: przy trzydziestu odpowiedziach sześć pustych
            przycisków pod każdą byłoby ścianą szumu. */}
        <div className="mt-2">
          <ClubReactionBar
            tallies={reactions.get(reply.id) ?? []}
            disabled={!canReact}
            variant="compact"
            onToggle={(kind, active) => onToggleReaction(reply.id, kind, active)}
          />
        </div>

        <div className="mt-2 flex flex-wrap gap-1">
          {/* Poziom 2 nie dostaje przycisku "Odpowiedz": drzewo jest przycięte,
              a przycisk, który po cichu przypina odpowiedź gdzie indziej,
              wprowadza w błąd. */}
          {reply.depth < 2 ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => onReply(reply.id)}
            >
              {t("club.reply")}
            </Button>
          ) : null}
          {canResolve && !reply.is_resolution ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => onResolve(reply.id)}
            >
              {t("club.markResolution")}
            </Button>
          ) : null}
          {canEdit && editing !== reply.id ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => onEdit(reply.id)}
            >
              <Pencil className="mr-1 h-3 w-3" />
              {t("club.editor.edit")}
            </Button>
          ) : null}
          {canReport ? <ClubReportButton targetType="reply" targetId={reply.id} /> : null}
        </div>
      </div>

      {children.length > 0 ? (
        <ul className="mt-2 space-y-2 border-l-2 border-border/40 pl-3 sm:pl-5">
          {children.map((child) => (
            <ReplyBranch {...props} key={child.reply.id} node={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
