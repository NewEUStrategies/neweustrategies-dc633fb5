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
//
// Od A28 widok jest PRZESTRZENIĄ ROBOCZĄ, nie samą dyskusją: pod postem
// otwierającym stoi belka zakładek, a dyskusja jest jedną z nich - pierwszą
// i domyślną. Reszta (uczestnicy, źródła, harmonogram, pytania, głosowania,
// powiązania, dane, szukanie) mieszka w `ClubThreadWorkspace` i ładuje się
// leniwie, panel po panelu. Trasa celowo NIE oddaje dyskusji do powłoki:
// post, odpowiedzi i kompozytor mają się renderować bez czekania na cokolwiek
// z A28, więc jadą jako `children`.
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  Link2,
  Loader2,
  Lock,
  MessageSquare,
  Send,
  Pencil,
  Pin,
  ShieldQuestion,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { normalizeClubThreadIcon } from "@/lib/clubs/threadIcons";
import {
  ClubDossierKind,
  ClubDossierRow,
  clubThreadTone,
} from "@/components/clubs/atoms/ClubDossierRow";

import { ClubThreadKindIcon } from "@/components/clubs/atoms/ClubThreadKindIcon";
import { ClubTopicChip } from "@/components/clubs/atoms/ClubTopicChip";
import { useClubTopics } from "@/lib/clubs/useClubTopics";
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
  useClubReactionActors,
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
import {
  ClubHoverActionBody,
  clubHoverActionClass,
} from "@/components/clubs/atoms/ClubHoverAction";
import { ClubReactionBar } from "@/components/clubs/molecules/ClubReactionBar";
import { ClubReactionAvatars } from "@/components/clubs/molecules/ClubReactionAvatars";
import { ClubFollowButton } from "@/components/clubs/molecules/ClubFollowButton";
import { ClubInlineEditor } from "@/components/clubs/molecules/ClubInlineEditor";
import { ClubStanceBar } from "@/components/clubs/molecules/ClubStanceBar";

import { ClubNewRepliesBar } from "@/components/clubs/molecules/ClubNewRepliesBar";
import { ClubReportButton } from "@/components/clubs/molecules/ClubReportButton";
import { ClubErrorNotice } from "@/components/clubs/molecules/ClubErrorNotice";
import { ClubAuthorAvatar } from "@/components/clubs/atoms/ClubAuthorAvatar";
import { ClubProse } from "@/components/clubs/atoms/ClubProse";

import { ClubThreadListSkeleton, Shimmer } from "@/components/clubs/atoms/ClubSkeletons";
import { ClubThreadWorkspace } from "@/components/clubs/organisms/ClubThreadWorkspace";
import { useClubThreadWorkspace } from "@/lib/clubs/useClubWorkspace";
import { EMPTY_WORKSPACE_SUMMARY } from "@/lib/clubs/workspaceTypes";
import { buildClubHead, toClubHeadSource } from "@/lib/clubs/clubHead";
import { fetchClubBySlug } from "@/lib/clubs/publicClub";
import { clubKeys } from "@/lib/clubs/queryKeys";
import { formatDateTime } from "@/lib/i18n/format";
import {
  buildClubReplyTree,
  toAuthorLabel,
  type ClubReactionKind,
  type ClubReactionActor,
  type ClubReactionTally,
  type ClubReplyNode,
  type ClubReplySort,
} from "@/lib/clubs/types";
// Reguły tej trasy (etapy wczytywania, uprawnienia wpisu, licznik strony,
// rozstrzygnięcie) mieszkają w warstwie `lib` i mają własne tabele przypadków -
// patrz nagłówek `threadPageView.ts`. Trasa je WOŁA, nie liczy.
import {
  clubReactionTotal,
  clubReplyCapabilities,
  clubRepliesMeter,
  clubResolveToastKey,
  clubThreadCapabilities,
  clubThreadHasResolution,
  resolveClubThreadStage,
  CLUB_RESOLVE_LABEL_KEYS,
  type ClubResolveAction,
} from "@/lib/clubs/threadPageView";
import {
  canSubmitClubReply,
  clubBlockedReplyKey,
  clubComposerHeadingKey,
  clubComposerKeyIntent,
  clubReplyBodyLength,
  showsClubReplyCounter,
  CLUB_REPLY_BODY_MAX,
} from "@/lib/clubs/threadComposer";
import { ensureClubI18n } from "@/lib/i18n-club";

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

// Eksperci wątku (A32) - leniwie, tą samą konwencją co sondaż i panele A28.
// Panel milczy w klubie ukrywającym skład i w wątku bez obszaru tematycznego,
// więc dla sporej części wątków jego kod nie ma prawa być pobrany w ogóle.
const ClubThreadExpertsPanel = lazy(() =>
  import("@/components/clubs/organisms/ClubThreadExpertsPanel").then((m) => ({
    default: m.ClubThreadExpertsPanel,
  })),
);

export const Route = createFileRoute("/club/$clubSlug/t/$threadSlug")({
  // `?reply=1` przychodzi z paska zaangażowania w strumieniu huba. Reakcja
  // zostaje na karcie, ale KOMENTARZ prowadzi tutaj - i musi wylądować w
  // kompozytorze, a nie na górze strony pod postem otwierającym. Bez tego
  // parametru "Komentuj" byłoby zwykłym linkiem do wątku, a użytkownik i tak
  // musiałby sam przewinąć do dołu i znaleźć pole.
  validateSearch: (search: Record<string, unknown>): { reply?: true } => {
    const raw = search["reply"];
    return raw === true || raw === "true" || raw === "1" ? { reply: true } : {};
  },
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
  const { clubSlug, threadSlug } = Route.useParams();
  const { reply: replyIntent } = Route.useSearch();
  const { user } = useAuth();
  const { topics: topicCatalog } = useClubTopics();

  const clubQ = useClubBySlug(clubSlug);
  const club = clubQ.data ?? null;
  const threadQ = useClubThread({ clubId: club?.id, slug: threadSlug });
  const thread = threadQ.data ?? null;
  // Nazwa spoza katalogu degraduje do braku ikony - patrz `threadIcons.ts`.
  const threadIcon = normalizeClubThreadIcon(thread?.icon ?? null);
  // Ton grzbietu = rodzaj wątku - ten sam, co w wierszu strumienia.
  const threadTone = clubThreadTone(thread?.kind ?? null);

  const [replySort, setReplySort] = useState<ClubReplySort>("chronological");
  const repliesQ = useClubReplies({ threadId: thread?.id, sort: replySort });

  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  /** Ostatnia odpowiedź poszła do kolejki moderacji - patrz `submitReply`. */
  const [queued, setQueued] = useState(false);
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

  // Liczniki paneli - JEDNO wywołanie na całą belkę zakładek. Osiem zapytań
  // liczących po jednym liczniku to osiem round-tripów, zanim czytelnik
  // zobaczy, że w wątku nie ma ŻADNEGO dokumentu; a właśnie ta informacja
  // decyduje, czy w ogóle kliknie.
  const workspaceQ = useClubThreadWorkspace(threadQ.data?.id);

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
  // Twarze: jedno zapytanie wsadowe na partię, tak samo jak liczniki.
  const threadActorsQ = useClubReactionActors({ targetType: "thread", targetIds: threadIds });
  const replyActorsQ = useClubReactionActors({ targetType: "reply", targetIds: replyIds });

  // Hooki kompozytora muszą być wywołane PRZED stanami loading/error/404.
  // Pierwszy render kończy się zwykle na szkielecie, a następny pokazuje wątek;
  // trzymanie tych hooków pod wczesnymi returnami zmieniało wtedy kolejność
  // hooków i React przerywał nawigację błędem "Rendered more hooks".
  const composerRef = useRef<HTMLElement | null>(null);
  const focusedRef = useRef(false);
  useEffect(() => {
    if (replyIntent !== true || thread === null || focusedRef.current) return;
    const node = composerRef.current;
    if (node === null) return;
    focusedRef.current = true;
    // Wejście z "Komentuj" NIE przewija już do kompozytora na dole. Czytelnik
    // ma zacząć od góry wątku (kontekst dyskusji), a dopiero potem zejść do
    // odpowiedzi - dlatego ustawiamy widok na początek strony, a pole tekstowe
    // dostaje fokus bez przewijania (`preventScroll`).
    window.scrollTo({ top: 0, behavior: "auto" });
    const field = document.getElementById("club-reply-body");
    if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement)
      field.focus({ preventScroll: true });
  }, [replyIntent, thread]);

  // Zapytanie o wątek jest WYŁĄCZONE, dopóki nie znamy id klubu, a wyłączone
  // `useQuery` zostaje w stanie `isPending` na zawsze. Warunek musi więc pytać
  // o wątek tylko wtedy, gdy klub faktycznie jest - inaczej wejście na
  // nieistniejący slug kończy się wiecznym szkieletem zamiast 404.
  // Etap wczytywania jako JEDNA decyzja - kolejność warunków jest regułą,
  // nie kosmetyką (patrz `resolveClubThreadStage`).
  const stage = resolveClubThreadStage({
    clubPending: clubQ.isPending,
    clubMissing: club === null,
    threadPending: threadQ.isPending,
    threadMissing: thread === null,
    failed: clubQ.isError || threadQ.isError,
  });

  if (stage === "loading") {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-8 py-8" aria-busy="true">
        <Shimmer className="mb-4 h-8 w-48" />
        <div className="rounded-xl border border-border/60 bg-card p-5">
          <Shimmer className="h-4 w-24" />
          <Shimmer className="mt-3 h-7 w-3/4" />
          <Shimmer className="mt-3 h-4 w-1/3" />
          <div className="mt-5 space-y-2">
            <Shimmer className="h-4 w-full" />
            <Shimmer className="h-4 w-11/12" />
            <Shimmer className="h-4 w-4/5" />
          </div>
        </div>
        <Shimmer className="mt-4 h-28 w-full rounded-xl" />
        <div className="mt-6">
          <ClubThreadListSkeleton count={3} />
        </div>
      </div>
    );
  }

  // Awaria zapytania to NIE jest "nie ma takiego wątku". Pusta odpowiedź znaczy
  // 404 (klub `secret` nie ma prawa zdradzić, że istnieje), a błąd sieci albo
  // bazy ma powiedzieć, że to problem po naszej stronie i da się spróbować
  // ponownie - inaczej użytkownik kasuje poprawny link jako martwy.
  if (stage === "error") {
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
                {pickLocalized(club, "name", lang, t("club.title"))}
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const author = toAuthorLabel(thread, t("club.anonymousAuthor"), t("club.deletedAuthor"));
  const tree = buildClubReplyTree(deferred.rows);
  // Licznik strony odpowiedzi: `undefined` znaczy ZAPYTANIE W LOCIE, nie zero.
  const replies = clubRepliesMeter(repliesQ.data);
  // Uprawnienia postu otwierającego - jedno wejście, jeden wynik. Trasa nie
  // liczy dostępu, tylko czyta to, co oddało SECURITY DEFINER RPC.
  const caps = clubThreadCapabilities({
    kind: thread.kind,
    authorId: thread.author_id,
    canModerate: thread.can_moderate,
    lockedAt: thread.locked_at,
    attributionMode: thread.attribution_mode,
    viewerId: user?.id ?? null,
    signedIn: user !== null && user !== undefined,
  });
  const canGoAnonymous = caps.canGoAnonymous;
  // Czy ktoras z ZALADOWANYCH odpowiedzi nosi juz flage rozstrzygniecia -
  // decyduje o tym, czy akcja to "oznacz", czy "przenies".
  const hasResolution = clubThreadHasResolution(deferred.rows);

  const submitReply = () => {
    if (!canSubmitClubReply(body, replyM.isPending)) return;
    const trimmed = body.trim();
    setQueued(false);
    replyM.mutate(
      { threadId: thread.id, body: trimmed, parentId: replyTo, anonymous },
      {
        onSuccess: (outcome) => {
          setBody("");
          setReplyTo(null);
          // Własna odpowiedź nie czeka w kolejce "pokaż nowe" - ale przyjmujemy
          // WYŁĄCZNIE ją. `reveal()` wpuściłby przy okazji każdy cudzy wpis,
          // który dojechał w międzyczasie, czyli wstawił cudzą treść pod
          // kursorem dokładnie w chwili, gdy autor sam coś wysyła.
          //
          // Dotyczy to TAKŻE wpisu w kolejce: `club_replies_list` oddaje autorowi
          // jego własną odpowiedź o statusie `pending`, więc ona się na liście
          // pojawi - i bez przyjęcia jej tutaj wpadłaby do licznika "N nowych
          // odpowiedzi" jako cudza treść.
          deferred.accept([outcome.id]);
          if (outcome.queued) {
            // Wpis jest widoczny dla autora, ale dla nikogo więcej - dopóki
            // prowadzenie go nie zatwierdzi. Obiecywanie publikacji byłoby więc
            // nieprawdą. Komunikat zostaje na ekranie, bo toast znika, a ta
            // informacja musi przeżyć dłużej niż cztery sekundy.
            setQueued(true);
            toast.success(t("club.replyQueued"));
            return;
          }
          toast.success(t("club.replyPosted"));
        },
        onError: () => toast.error(t("adminClubs.saveFailed")),
      },
    );
  };

  // Wejście z "Komentuj" w strumieniu: kursor ląduje w kompozytorze. Efekt
  // czeka na `thread`, bo kompozytor renderuje się dopiero po odpowiedzi RPC -
  // fokus ustawiany od razu po montażu trafiałby w pustkę. `scrollIntoView`
  // z `block: "center"` zamiast `focus()` bez przewinięcia: samo ustawienie
  // fokusu w polu poza ekranem daje wrażenie, że link nic nie zrobił.
  // Wysyłka z klawiatury. Enter zostaje znakiem nowej linii - to jest pole
  // deliberacji, nie okno czatu, a wysłanie akapitu w połowie zdania jest tu
  // kosztowniejsze niż jedno kliknięcie więcej.
  const onComposerKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const intent = clubComposerKeyIntent(event, replyTo !== null);
    if (intent === "ignore") return;
    event.preventDefault();
    if (intent === "submit") submitReply();
    else setReplyTo(null);
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-8 py-8">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3 h-8 px-2">
        <Link to="/club/$clubSlug" params={{ clubSlug }}>
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          {pickLocalized(club, "name", lang)}
        </Link>
      </Button>

      {/* --- przestrzeń robocza ---
          Belka zakładek + panele A28. Dyskusja jedzie jako `children`, więc
          renderuje się natychmiast, niezależnie od tego, czy liczniki paneli
          zdążyły dojść. */}
      <ClubThreadWorkspace
        threadId={thread.id}
        lang={lang}
        userId={user?.id ?? null}
        summary={workspaceQ.data ?? EMPTY_WORKSPACE_SUMMARY}
        canGoAnonymous={canGoAnonymous}
      >
        {/* --- post otwierający --- */}
        {/* Post otwierający mówi tym samym językiem, co wiersz dossier w
            strumieniu: grzbiet rodzaju po lewej, ikona rodzaju w kwadracie,
            meta wersalikami nad tytułem. Inaczej ten sam wątek wyglądałby
            inaczej na hubie i na własnej stronie. */}
        <ClubDossierRow
          testId="club-thread-lead"
          tone={threadTone}
          pinned={thread.pinned_at !== null}
          titleStyle="headline"
          icon={<ClubThreadKindIcon kind={thread.kind} icon={threadIcon} />}
          meta={
            <>
              <ClubDossierKind className="text-[10px]">
                {t(`club.kind.${thread.kind}`)}
              </ClubDossierKind>
              {thread.status === "resolved" ? (
                <Badge className="rounded-lg bg-emerald-600 px-1.5 py-0 text-[10px] hover:bg-emerald-600">
                  {t("club.threadStatus.resolved")}
                </Badge>
              ) : null}
              {thread.locked_at !== null ? (
                <Badge variant="outline" className="gap-1 text-[10px]">
                  <Lock className="h-3 w-3" aria-hidden="true" />
                  {t("club.threadStatus.locked")}
                </Badge>
              ) : null}
              {thread.attribution_mode === "chatham" ? (
                <Badge variant="outline" className="gap-1 text-[10px]">
                  <ShieldQuestion className="h-3 w-3" aria-hidden="true" />
                  {t("club.attribution.chatham")}
                </Badge>
              ) : null}
              {/* Obszar tematyczny wątku - ten sam chip co na hubie i w klubie. */}
              <ClubTopicChip topic={thread.topic} lang={lang} catalog={topicCatalog} size="sm" />
              {thread.anchor_type !== null ? (
                <Badge variant="secondary" className="gap-1 text-[10px]">
                  <Link2 className="h-3 w-3" aria-hidden="true" />
                  {t(`club.anchorType.${thread.anchor_type}`)}
                </Badge>
              ) : null}
              <span aria-hidden="true">·</span>
              <ClubAuthorAvatar
                name={author.name}
                avatarUrl={author.avatarUrl}
                size="sm"
                muted={author.kind !== "named"}
              />
              <span className="truncate font-medium text-foreground">{author.name}</span>
              <span aria-hidden="true">·</span>
              <time dateTime={thread.created_at}>{formatDateTime(thread.created_at, lang)}</time>
              {thread.edited_at !== null ? <span>{t("club.edited")}</span> : null}
              {thread.pinned_at !== null ? (
                <span className="inline-flex items-center gap-1 text-primary">
                  <Pin className="h-3 w-3" aria-hidden="true" />
                  {t("club.hub.feed.pinned")}
                </span>
              ) : null}
            </>
          }
          title={<h1 className="text-base sm:text-xl [overflow-wrap:anywhere]">{thread.title}</h1>}
          footer={
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border/60 pt-2.5">
              <ClubReactionBar
                tallies={threadReactionsQ.data?.get(thread.id) ?? []}
                disabled={!thread.can_reply || toggleThreadReaction.isPending}
                variant="full"
                labels="hover"
                onToggle={(kind, active) =>
                  toggleThreadReaction.mutate({ targetId: thread.id, kind, active })
                }
              />
              <ClubReactionAvatars
                actors={threadActorsQ.data?.get(thread.id) ?? []}
                total={clubReactionTotal(threadReactionsQ.data?.get(thread.id) ?? [])}
                size="sm"
              />
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                {caps.canEdit && editing !== "thread" ? (
                  <button
                    type="button"
                    onClick={() => setEditing("thread")}
                    aria-label={t("club.editor.edit")}
                    className={clubHoverActionClass()}
                  >
                    <ClubHoverActionBody icon={Pencil} label={t("club.editor.edit")} />
                  </button>
                ) : null}
                {caps.canReport ? (
                  <ClubReportButton targetType="thread" targetId={thread.id} />
                ) : null}
                <ClubFollowButton
                  compact
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
          }
        >
          {editing === "thread" ? (
            <ClubInlineEditor
              idPrefix="club-thread-edit"
              initialTitle={thread.title}
              initialBody={thread.body}
              showReason={!caps.isMine}
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
          ) : (
            <ClubProse className="max-w-none" body={thread.body} clubSlug={clubSlug} />
          )}
        </ClubDossierRow>

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

        {/* --- eksperci tego wątku ---
          Stoi MIĘDZY postem otwierającym a dyskusją, bo dokładnie w tym
          miejscu czytelnik zadaje pytanie, na które ten panel odpowiada:
          "kto właściwie mógłby to rozstrzygnąć". Nad postem byłby przedwczesny
          (nie wiadomo jeszcze, o co chodzi), pod odpowiedziami - spóźniony
          (decyzja o zaproszeniu kogoś zapada przed przeczytaniem trzydziestu
          wypowiedzi, nie po).

          Bez `Suspense` z widocznym szkieletem: panel ma prawo nie istnieć,
          więc placeholder w jego miejscu obiecywałby treść, której często nie
          będzie, i rozpychałby dyskusję przy każdym wejściu w wątek. */}
        <Suspense fallback={null}>
          <ClubThreadExpertsPanel threadId={thread.id} canAsk={thread.can_reply} className="mt-4" />
        </Suspense>

        {/* --- odpowiedzi --- */}
        <section className="mt-6">
          {/* Pasek przykleja się POD belką zakładek, nie do tej samej krawędzi:
              `position: sticky` nie układa się w stos sam z siebie, więc dwa
              paski z `top-16` po prostu na siebie nachodzą. Offset przychodzi
              z `--club-ws-stack` ustawianego przez powłokę przestrzeni - jedna
              liczba na oba paski. */}
          <div className="sticky top-[var(--club-ws-stack,4rem)] z-10 mb-3 -mx-1 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-background/85 px-1 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/70">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <MessageSquare className="h-4 w-4 text-primary" aria-hidden="true" />
              {t("club.repliesCount", { count: thread.reply_count })}
            </h2>
            {replies.sortPickerVisible ? (
              <Select value={replySort} onValueChange={(v) => setReplySort(v as ClubReplySort)}>
                <SelectTrigger
                  className="h-8 w-auto min-w-40"
                  aria-label={t("club.replySort.label")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {caps.replySorts.map((sort) => (
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
            <ClubThreadListSkeleton count={3} />
          ) : tree.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border/60 bg-muted/20 px-6 py-8 text-center">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-muted text-muted-foreground">
                <MessageSquare className="h-4 w-4" aria-hidden="true" />
              </span>
              <p className="text-sm text-muted-foreground">{t("club.noReplies")}</p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {tree.map((node) => (
                <ReplyBranch
                  key={node.reply.id}
                  node={node}
                  lang={lang}
                  clubSlug={clubSlug}
                  canResolve={caps.canResolve}
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
                  reactionActors={replyActorsQ.data ?? new Map()}
                  onToggleReaction={(targetId, kind, active) =>
                    toggleReplyReaction.mutate({ targetId, kind, active })
                  }
                  onReply={setReplyTo}
                  hasResolution={hasResolution}
                  onResolve={(replyId) =>
                    resolveM.mutate(
                      { threadId: thread.id, replyId },
                      {
                        onSuccess: () =>
                          toast.success(t(clubResolveToastKey(replyId, hasResolution))),
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
          {replies.truncated ? (
            <p className="mt-3 rounded-lg border border-dashed border-border/60 p-3 text-center text-xs text-muted-foreground">
              {t("club.repliesTruncated", { shown: replies.shown, total: replies.total })}
            </p>
          ) : null}
        </section>

        {/* Wpis w drodze. Widać go od razu, zanim baza odpowie - bez tego
            jedynym sygnałem jest wyszarzony przycisk, a przy wolnym łączu
            wygląda to jak kliknięcie, które nic nie zrobiło. */}
        {replyM.isPending && replyM.variables !== undefined ? (
          <div
            aria-live="polite"
            className="mt-6 flex items-start gap-3 rounded-xl border border-dashed border-primary/40 bg-primary/5 p-4"
          >
            <Loader2
              className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-primary">{t("club.replySending")}</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                {replyM.variables.body}
              </p>
            </div>
          </div>
        ) : null}

        {/* Kolejka moderacji - komunikat, który nie znika razem z toastem. */}
        {queued ? (
          <div className="mt-6 flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
            <ShieldQuestion
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
              aria-hidden="true"
            />
            <p className="text-sm text-amber-900 dark:text-amber-200">
              {t("club.replyQueuedHint")}
            </p>
          </div>
        ) : null}

        {/* --- kompozytor ---
            Skrót Ctrl/Cmd + Enter DALEJ działa (patrz `onComposerKeyDown`), ale
            znika z ekranu: plakietka klawiszy stała w miejscu, w którym oko
            szuka przycisku wysyłki, i konkurowała z nim o uwagę. Licznik
            znaków też przestał być stałym elementem - pokazuje się dopiero,
            gdy limit robi się realny (od 70% długości). */}
        {thread.can_reply ? (
          <section
            ref={composerRef}
            id="club-reply-composer"
            className="mt-6 overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm focus-within:border-primary/40"
            onKeyDown={onComposerKeyDown}
          >
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/25 px-4 py-2">
              <span className="inline-flex items-center gap-2 text-xs font-semibold text-foreground">
                <MessageSquare className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                {t(clubComposerHeadingKey(replyTo))}
              </span>
              {replyTo !== null ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={() => setReplyTo(null)}
                >
                  {t("club.cancelReplyTo")}
                </Button>
              ) : null}
            </header>

            <div className="p-4">
              {/* Wzmianki: ten sam komponent i ten sam parser, co w komentarzach.
                Backend obsługuje `club_reply` w `process_mentions` od A12, więc
                bez podpowiedzi w polu jedyną drogą było wpisanie sluga z pamięci. */}
              <MentionTextarea
                id="club-reply-body"
                label={t("club.replyPlaceholder")}
                value={body}
                onChange={(next) => {
                  setBody(next);
                  // Pisanie nowej odpowiedzi zdejmuje komunikat o poprzedniej:
                  // "czeka na zatwierdzenie" nad świeżym tekstem sugerowałoby,
                  // że to TEN wpis czeka.
                  if (queued) setQueued(false);
                }}
                lang={lang}
                rows={4}
                maxLength={CLUB_REPLY_BODY_MAX}
              />

              <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  {canGoAnonymous ? (
                    <div className="flex items-center gap-2">
                      <Switch
                        id="club-reply-anon"
                        checked={anonymous}
                        disabled={replyM.isPending}
                        onCheckedChange={setAnonymous}
                      />
                      <Label htmlFor="club-reply-anon" className="text-xs">
                        {t("club.postAnonymously")}
                      </Label>
                    </div>
                  ) : null}
                  {showsClubReplyCounter(body) ? (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {clubReplyBodyLength(body)} / {CLUB_REPLY_BODY_MAX}
                    </span>
                  ) : null}
                </div>
                <Button
                  size="sm"
                  onClick={submitReply}
                  disabled={!canSubmitClubReply(body, replyM.isPending)}
                >
                  {replyM.isPending ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  )}
                  {t("club.postReply")}
                </Button>
              </div>
            </div>
          </section>
        ) : (
          <p className="mt-6 rounded-lg border border-border/60 bg-muted/30 p-4 text-center text-sm text-muted-foreground">
            {t(clubBlockedReplyKey(thread.reason))}
          </p>
        )}
      </ClubThreadWorkspace>
    </div>
  );
}

/**
 * Strażnik zawężający akcję rozstrzygnięcia do tej, która MA etykietę.
 * `none` (brak prawa) i `unmark` (potwierdzenie w osobnym dialogu) nie stoją
 * w tym przycisku, a `CLUB_RESOLVE_LABEL_KEYS[resolveAction]` musi dostać klucz
 * istniejący w mapie - stąd zawężenie w runtime zamiast rzutowania.
 */
function isClubMarkAction(action: ClubResolveAction): action is "mark" | "move" {
  return action === "mark" || action === "move";
}

interface ReplyBranchProps {
  node: ClubReplyNode;
  lang: "pl" | "en";
  /** Kontekst klubu - #tagi w odpowiedzi prowadzą do filtra tego klubu. */
  clubSlug: string;
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
  reactionActors: Map<string, ClubReactionActor[]>;
  onToggleReaction: (targetId: string, kind: ClubReactionKind, active: boolean) => void;
  onReply: (replyId: string) => void;
  onResolve: (replyId: string | null) => void;
  /** Czy w watku JUZ jest odpowiedz rozstrzygajaca - zmienia etykiete akcji. */
  hasResolution: boolean;
}

function ReplyBranch(props: ReplyBranchProps) {
  const {
    node,
    lang,
    clubSlug,
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
    reactionActors,
    onToggleReaction,
    onReply,
    onResolve,
    hasResolution,
  } = props;
  const { t } = useTranslation();
  const [unmarkOpen, setUnmarkOpen] = useState(false);
  const { reply, children } = node;
  const author = toAuthorLabel(reply, t("club.anonymousAuthor"), t("club.deletedAuthor"));
  // W klubie pod regułą Chatham House `author_id` nie wychodzi z RPC, więc
  // porównanie jest tam zawsze fałszywe - i tak ma być. Baza sprawdzi
  // autorstwo przy zapisie, a interfejs nie może zdradzić, czyj to wpis.
  // Uprawnienia wpisu liczy `clubReplyCapabilities` - razem z regułą, że
  // redakcja pyta o STATUS (wpis zdjęty przez moderację jej nie ma) i że
  // przycisk „Odpowiedz” gaśnie na drugim poziomie przyciętego drzewa.
  const { isMine, canEdit, canReport, canReplyTo, resolveAction } = clubReplyCapabilities({
    authorId: reply.author_id,
    status: reply.status,
    depth: reply.depth,
    isResolution: reply.is_resolution,
    viewerId: myUserId,
    canModerate,
    threadLocked,
    canResolve,
    hasResolution,
  });

  return (
    <li>
      <div
        className={
          "group/reply rounded-lg border p-3 transition-colors sm:p-4 " +
          (reply.is_resolution
            ? "border-emerald-500/40 bg-emerald-500/5"
            : "border-border/60 bg-card hover:border-primary/30")
        }
      >
        {/* Nagłówek odpowiedzi: awatar w osi tekstu, autor i czas w DWÓCH
            wierszach. Wcześniej wszystko leciało jednym `flex-wrap` i przy
            wąskim ekranie data lądowała pod awatarem, oddzielona od nazwiska,
            do którego się odnosi. */}
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2.5 gap-y-1">
          <ClubAuthorAvatar
            name={author.name}
            avatarUrl={author.avatarUrl}
            muted={author.kind !== "named"}
          />
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate text-sm font-semibold leading-tight">{author.name}</span>
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
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {formatDateTime(reply.created_at, lang)}
              {reply.edited_at !== null ? ` \u00b7 ${t("club.edited")}` : ""}
            </p>
          </div>
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
          <ClubProse className="mt-2 max-w-none" size="sm" body={reply.body} clubSlug={clubSlug} />
        )}

        {/* Pasek zwinięty: przy trzydziestu odpowiedziach sześć pustych
            przycisków pod każdą byłoby ścianą szumu. */}
        <div className="mt-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <ClubReactionBar
              tallies={reactions.get(reply.id) ?? []}
              disabled={!canReact}
              variant="compact"
              onToggle={(kind, active) => onToggleReaction(reply.id, kind, active)}
            />
            <ClubReactionAvatars
              actors={reactionActors.get(reply.id) ?? []}
              total={clubReactionTotal(reactions.get(reply.id) ?? [])}
              maxVisible={4}
            />
          </div>
        </div>

        {/* Akcje wyciszone do momentu najechania/fokusu: przy trzydziestu
            odpowiedziach cztery przyciski pod każdą to ściana szumu, ale
            ukrywanie ich zupełnie łamie klawiaturę - stąd opacity, nie hidden. */}
        <div className="mt-1.5 flex flex-wrap gap-1 opacity-70 transition-opacity focus-within:opacity-100 group-hover/reply:opacity-100">
          {/* Poziom 2 nie dostaje przycisku "Odpowiedz": drzewo jest przycięte,
              a przycisk, który po cichu przypina odpowiedź gdzie indziej,
              wprowadza w błąd. */}
          {canReplyTo ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => onReply(reply.id)}
            >
              {t("club.reply")}
            </Button>
          ) : null}
          {/* Cofnięcie oznaczenia idzie przez potwierdzenie, bo jest to
              jedyna akcja w tym pasku, która KASUJE decyzję wątku, a stoi
              piksele od "Odpowiedz". Nadanie i przeniesienie potwierdzenia nie
              wymagają - one zostawiają rozstrzygnięcie na miejscu i cofa się
              je jednym kliknięciem. */}
          {resolveAction === "unmark" ? (
            <AlertDialog open={unmarkOpen} onOpenChange={setUnmarkOpen}>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs">
                  {t(CLUB_RESOLVE_LABEL_KEYS.unmark)}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("club.unmarkResolutionConfirm.title")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("club.unmarkResolutionConfirm.body")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("club.unmarkResolutionConfirm.cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onResolve(null)}>
                    {t("club.unmarkResolutionConfirm.confirm")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}

          {isClubMarkAction(resolveAction) ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => onResolve(reply.id)}
            >
              {t(CLUB_RESOLVE_LABEL_KEYS[resolveAction])}
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
        <ul className="mt-2 space-y-2 border-l border-border/50 pl-3 sm:pl-5">
          {children.map((child) => (
            <ReplyBranch {...props} key={child.reply.id} node={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
