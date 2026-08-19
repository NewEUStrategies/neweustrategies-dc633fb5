// `/club/$clubSlug/t/$threadSlug` - strona wątku ZAMONTOWANA.
//
// CO TEN PLIK DOWODZI. To najdłuższa trasa modułu i jednocześnie jedyne miejsce,
// w którym czytelnik PISZE: post otwierający, drzewo odpowiedzi, kompozytor,
// reakcje, sondaż, stanowiska, przestrzeń robocza. Reguły produktu mają własne
// tabele przypadków w `threadPageView.test.ts` i `threadComposer.test.ts`;
// tutaj przedmiotem dowodu jest SKLEJENIE, którego czysta funkcja nie dosięga:
//
//   1. KONTRAKT ADRESU. `?reply=1` przychodzi z paska zaangażowania w strumieniu
//      huba i z maila - to jedyny parametr tej trasy, a wygląda niewinnie.
//      Walidator ma przepuścić trzy postacie prawdy (`1`, `"true"`, `true`)
//      i ODRZUCIĆ wszystko inne, w tym `"0"`, bo adres z fałszem nie może
//      przestawiać kursora w polu tekstowym.
//   2. LOADER dogrzewa cache pod DOKŁADNIE tym kluczem, z którego czyta komponent
//      (`clubKeys.bySlug`), i NIE WYWALA trasy przy awarii RPC - `head()` liczy
//      indeksowalność z widoczności klubu, więc wątek w klubie zamkniętym nie
//      ma prawa wejść do indeksu (wyciek usuwa się z indeksu tygodniami).
//   3. CZTERY ETAPY WCZYTYWANIA są rozłączne, a kolejność warunków jest regułą:
//      wejście na nieistniejący slug wątku kończy się 404, NIE wiecznym
//      szkieletem (zapytanie o wątek jest wyłączone bez id klubu, a wyłączone
//      `useQuery` zostaje w `isPending` na zawsze), a awaria RPC to nie 404.
//   4. CO TRASA WYSYŁA DO ZAPYTAŃ. Reakcje i twarze jadą DWOMA zapytaniami
//      wsadowymi (wątek + cała partia odpowiedzi), nigdy jednym na wpis;
//      stanowiska pyta się WYŁĄCZNIE w wątku `position`, bo poza nim baza
//      odrzuca zapytanie z 22023.
//   5. ODROCZONA PROJEKCJA ODPOWIEDZI. Cudzy wpis czeka w pasku „N nowych”,
//      a WŁASNY pokazuje się natychmiast - i to nie przez `reveal()`, bo ten
//      wpuściłby przy okazji każdą cudzą treść pod kursor czytelnika w chwili,
//      gdy on sam coś wysyła.
//   6. CO ROBI FORMULARZ. Wysyłka, kolejka premoderacji, skróty klawiszowe,
//      anonimowość, adresat odpowiedzi i komunikat o braku prawa do odpowiedzi -
//      każde z nich woła RPC z innym zestawem argumentów albo z żadnym.
//
// JAK, ŻEBY TO NIE BYŁA FARMA POKRYCIA. Asercje nagłówka idą PRZECIW
// `buildClubHead` wywołanemu wprost na tych samych danych, nie przeciw
// wymyślonym napisom. Wszystkie napisy to KLUCZE i18n (atrapa `react-i18next`
// zwraca klucz), więc zmiana copy nie rusza testu, a rozjazd klucza owszem.
// Molekuły i organizmy są ATRAPAMI, które zapisują propsy i WOŁAJĄ przekazane
// uchwyty - bo właśnie to, co trasa przez nie przepuszcza, jest tu treścią.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - REGUŁ WIDOKU: `threadPageView.test.ts` (etapy, uprawnienia, licznik strony,
//   rozstrzygnięcie) i `threadComposer.test.ts` (wysyłka, klawiatura, licznik
//   znaków, komunikat blokady).
// - ODROCZONEJ PROJEKCJI jako mechaniki: `useDeferredReplies.test.ts`. Tutaj hook
//   jest PRAWDZIWY, bo dowodzimy jego WPIĘCIA, nie jego reguł.
// - DRZEWA ODPOWIEDZI (`buildClubReplyTree`), etykiety autora (`toAuthorLabel`),
//   katalogu ikon (`normalizeClubThreadIcon`), grupowania reakcji: własne zakresy
//   w `src/lib/clubs/__tests__/`.
// - NAGŁÓWKA SEO jako reguły: `clubHead.ts` ma własny zakres.
// - KOLEJNOŚCI HOOKÓW: `threadRouteHookOrder.test.ts` pilnuje, że hooki
//   kompozytora stoją PRZED wczesnymi `return`-ami.
// - MOLEKUŁ I ORGANIZMÓW (`ClubReactionBar`, `ClubStanceBar`, `ClubInlineEditor`,
//   `ClubThreadWorkspace`, `ClubThreadPoll`, `ClubThreadExpertsPanel`,
//   `MentionTextarea`): mają własne etapy testowe.
// - AUTORYTETU DOSTĘPU: `can_reply`, `can_moderate`, skrywanie `author_id` pod
//   regułą Chatham House - to SECURITY DEFINER RPC z pgTAP. Trasa je CZYTA.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ChangeEvent, ReactNode } from "react";
import type {
  ClubReactionActor,
  ClubReactionKind,
  ClubReactionTally,
  ClubReplyRow,
  ClubStance,
  ClubSubscriptionState,
  ClubThreadViewRow,
} from "@/lib/clubs/types";

/** Uchwyty, które atrapy mutacji wołają po zakończeniu żądania. */
interface MutationHandlers<TData> {
  onSuccess?: (data: TData) => void;
  onError?: (error: unknown) => void;
}

/**
 * Kolumny, które RPC oddaje jako NULL, a generator typów Supabase deklaruje
 * jako `string`. Trasa porównuje je z `null` (i słusznie - tak przychodzą
 * z bazy), więc fixture musi umieć w nich `null` postawić. Bez tego mapowania
 * „wątek niepodpięty” dałoby się zapisać tylko jako pusty napis, czyli
 * DOKŁADNIE ODWROTNIE, niż warunek w trasie to czyta.
 */
type WithNulls<T, K extends keyof T> = Omit<T, K> & { [P in K]: T[P] | null };

type ThreadRow = WithNulls<
  ClubThreadViewRow,
  | "anchor_type"
  | "anchor_id"
  | "author_id"
  | "author_name"
  | "author_avatar"
  | "author_alias"
  | "posted_by_admin_name"
  | "edited_at"
  | "locked_at"
  | "pinned_at"
  | "poll_id"
  | "resolved_reply_id"
>;

interface RepliesPage {
  rows: ClubReplyRow[];
  total: number;
}

const h = vi.hoisted(() => ({
  /** Język interfejsu widziany przez `useTranslation`. */
  lang: "pl",
  /** Sesja - `null` znaczy gość. */
  user: null as { id: string } | null,

  // --- loader ---
  loaded: null as unknown,
  loaderFails: false,
  fetchCalls: 0,

  // --- karta klubu ---
  club: null as unknown,
  clubPending: false,
  clubError: false,
  clubRefetch: vi.fn(),
  clubSlugSeen: null as string | undefined | null,

  // --- wątek ---
  thread: null as unknown,
  threadPending: false,
  threadError: false,
  threadRefetch: vi.fn(),
  threadArgs: null as { clubId?: string; slug?: string } | null,

  // --- odpowiedzi ---
  replies: undefined as unknown,
  repliesPending: false,
  repliesArgs: null as { threadId?: string; sort?: string } | null,

  // --- reakcje ---
  tallyArgs: {} as Record<string, string[]>,
  actorArgs: {} as Record<string, string[]>,
  threadTallies: undefined as unknown,
  replyTallies: undefined as unknown,
  threadActors: undefined as unknown,
  replyActors: undefined as unknown,
  togglePending: false,
  toggleCalls: [] as { targetType: string; targetId: string; kind: string; active: boolean }[],

  // --- stanowiska ---
  stanceThreadId: null as string | undefined | null,
  stanceRows: undefined as unknown,
  stancePending: false,
  stanceFails: false,
  stanceCalls: [] as { threadId: string; stance: string }[],

  // --- subskrypcja ---
  subscriptionThreadId: null as string | undefined | null,
  subscription: null as ClubSubscriptionState | null,
  subscriptionQueryPending: false,
  subscriptionPending: false,
  subscriptionFails: false,
  subscriptionCalls: [] as { threadId: string; state: string }[],

  // --- odpowiadanie ---
  replyHookArgs: null as { clubId: string; threadSlug: string } | null,
  replyPending: false,
  replyVariables: undefined as unknown,
  replyOutcome: { id: "reply-new", queued: false },
  replyFails: false,
  replyCalls: [] as Record<string, unknown>[],

  // --- rozstrzyganie ---
  resolveHookArgs: null as { clubId: string; threadSlug: string } | null,
  resolveFails: false,
  resolveCalls: [] as { threadId: string; replyId: string | null }[],

  // --- redakcja ---
  editThreadPending: false,
  editThreadFails: false,
  editThreadCalls: [] as Record<string, unknown>[],
  editReplyThreadId: null as string | null,
  editReplyPending: false,
  editReplyFails: false,
  editReplyCalls: [] as Record<string, unknown>[],

  // --- przestrzeń robocza i katalog tematów ---
  workspaceThreadId: null as string | undefined | null,
  workspaceSummary: undefined as unknown,
  topics: [] as { key: string; label_pl: string; label_en: string; sort_order: number }[],

  // --- toasty ---
  toastSuccess: vi.fn(),
  toastError: vi.fn(),

  /** Propsy zapisane przez atrapy, per nazwa komponentu. */
  props: {} as Record<string, Record<string, unknown>>,
  /** Kształt pola kompozytora - patrz „efekt wejścia z Komentuj”. */
  fieldTag: "textarea" as "textarea" | "input" | "unidentified",
  /** Przewinięcia okna zliczone przez atrapę `window.scrollTo`. */
  scrollTo: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: h.user === null ? null : { user: h.user }, user: h.user, isStaff: false }),
}));
vi.mock("@/lib/clubs/publicClub", () => ({
  fetchClubBySlug: () => {
    h.fetchCalls += 1;
    if (h.loaderFails) return Promise.reject(new Error("club_view padło"));
    return Promise.resolve(h.loaded);
  },
}));
vi.mock("@/lib/clubs/useClubTopics", () => ({ useClubTopics: () => ({ topics: h.topics }) }));
vi.mock("@/lib/clubs/useClubWorkspace", () => ({
  useClubThreadWorkspace: (threadId?: string) => {
    h.workspaceThreadId = threadId ?? null;
    return { data: h.workspaceSummary };
  },
}));

vi.mock("@/lib/clubs/useClubs", () => ({
  useClubBySlug: (slug?: string) => {
    h.clubSlugSeen = slug;
    return {
      data: h.club,
      isPending: h.clubPending,
      isError: h.clubError,
      refetch: h.clubRefetch,
    };
  },
  useClubThread: (args: { clubId?: string; slug?: string }) => {
    h.threadArgs = args;
    return {
      data: h.thread,
      isPending: h.threadPending,
      isError: h.threadError,
      refetch: h.threadRefetch,
    };
  },
  useClubReplies: (args: { threadId?: string; sort?: string }) => {
    h.repliesArgs = args;
    return { data: h.replies, isPending: h.repliesPending };
  },
  useClubReactions: (args: { targetType: string; targetIds: string[] }) => {
    h.tallyArgs[args.targetType] = args.targetIds;
    return { data: args.targetType === "thread" ? h.threadTallies : h.replyTallies };
  },
  useClubReactionActors: (args: { targetType: string; targetIds: string[] }) => {
    h.actorArgs[args.targetType] = args.targetIds;
    return { data: args.targetType === "thread" ? h.threadActors : h.replyActors };
  },
  useToggleClubReaction: (args: { targetType: string }) => ({
    mutate: (vars: { targetId: string; kind: string; active: boolean }) => {
      h.toggleCalls.push({ targetType: args.targetType, ...vars });
    },
    isPending: h.togglePending,
  }),
  useClubStanceSummary: (threadId?: string) => {
    h.stanceThreadId = threadId ?? null;
    return { data: h.stanceRows };
  },
  useSetClubStance: (threadId: string) => ({
    mutate: (vars: { stance: string }, handlers?: MutationHandlers<boolean>) => {
      h.stanceCalls.push({ threadId, stance: vars.stance });
      if (h.stanceFails) handlers?.onError?.(new Error("stance padło"));
      else handlers?.onSuccess?.(true);
    },
    isPending: h.stancePending,
  }),
  useMyThreadSubscription: (threadId?: string) => {
    h.subscriptionThreadId = threadId ?? null;
    return { data: h.subscription, isPending: h.subscriptionQueryPending };
  },
  useSetThreadSubscription: (threadId: string) => ({
    mutate: (state: string, handlers?: MutationHandlers<boolean>) => {
      h.subscriptionCalls.push({ threadId, state });
      if (h.subscriptionFails) handlers?.onError?.(new Error("subskrypcja padła"));
      else handlers?.onSuccess?.(true);
    },
    isPending: h.subscriptionPending,
  }),
  useReplyToThread: (clubId: string, threadSlug: string) => {
    h.replyHookArgs = { clubId, threadSlug };
    return {
      mutate: (
        vars: Record<string, unknown>,
        handlers?: MutationHandlers<{ id: string; queued: boolean }>,
      ) => {
        h.replyCalls.push(vars);
        if (h.replyFails) handlers?.onError?.(new Error("club_reply padło"));
        else handlers?.onSuccess?.(h.replyOutcome);
      },
      isPending: h.replyPending,
      variables: h.replyVariables,
    };
  },
  useResolveClubThread: (clubId: string, threadSlug: string) => {
    h.resolveHookArgs = { clubId, threadSlug };
    return {
      mutate: (
        vars: { threadId: string; replyId: string | null },
        handlers?: MutationHandlers<boolean>,
      ) => {
        h.resolveCalls.push(vars);
        if (h.resolveFails) handlers?.onError?.(new Error("resolve padło"));
        else handlers?.onSuccess?.(true);
      },
      isPending: false,
    };
  },
  useEditClubThread: () => ({
    mutate: (vars: Record<string, unknown>, handlers?: MutationHandlers<boolean>) => {
      h.editThreadCalls.push(vars);
      if (h.editThreadFails) handlers?.onError?.(new Error("edit padło"));
      else handlers?.onSuccess?.(true);
    },
    isPending: h.editThreadPending,
  }),
  useEditClubReply: (threadId: string) => {
    h.editReplyThreadId = threadId;
    return {
      mutate: (vars: Record<string, unknown>, handlers?: MutationHandlers<boolean>) => {
        h.editReplyCalls.push(vars);
        if (h.editReplyFails) handlers?.onError?.(new Error("edit padło"));
        else handlers?.onSuccess?.(true);
      },
      isPending: h.editReplyPending,
    };
  },
}));

// --- atrapy komponentów -----------------------------------------------------
// Deklaracje funkcji (nie `const`), bo fabryki `vi.mock` są wyhoistowane nad
// ciało pliku - `const` byłby w nich jeszcze niezainicjowany.

/** Marker w DOM-ie + zapis propsów pod nazwą komponentu. */
function markerStub(name: string) {
  return (props: Record<string, unknown>) => {
    h.props[name] = props;
    return <div data-testid={name} />;
  };
}

vi.mock("@/components/clubs/organisms/ClubThreadWorkspace", () => ({
  ClubThreadWorkspace: ({ children, ...rest }: { children: ReactNode }) => {
    h.props.workspace = rest;
    return <div data-testid="workspace">{children}</div>;
  },
}));
vi.mock("@/components/clubs/organisms/ClubThreadPoll", () => ({
  ClubThreadPoll: markerStub("poll"),
}));
vi.mock("@/components/clubs/organisms/ClubThreadExpertsPanel", () => ({
  ClubThreadExpertsPanel: markerStub("experts"),
}));
vi.mock("@/components/clubs/molecules/ClubErrorNotice", () => ({
  ClubErrorNotice: ({ onRetry }: { onRetry?: () => void }) => (
    <button type="button" data-testid="error-notice" onClick={() => onRetry?.()} />
  ),
}));
vi.mock("@/components/clubs/atoms/ClubSkeletons", () => ({
  Shimmer: () => <span data-testid="shimmer" />,
  ClubThreadListSkeleton: ({ count }: { count?: number }) => (
    <div data-testid="list-skeleton" data-count={String(count ?? "")} />
  ),
}));
vi.mock("@/components/clubs/atoms/ClubProse", () => ({
  ClubProse: ({ body, size, clubSlug }: { body: string; size?: string; clubSlug?: string | null }) => (
    <div data-testid="prose" data-body={body} data-size={size ?? "base"} data-club={clubSlug ?? ""} />
  ),
}));
vi.mock("@/components/clubs/atoms/ClubAuthorAvatar", () => ({
  ClubAuthorAvatar: ({ name, muted }: { name: string; muted?: boolean }) => (
    <span data-testid="author-avatar" data-name={name} data-muted={String(muted === true)} />
  ),
}));
vi.mock("@/components/clubs/atoms/ClubTopicChip", () => ({
  ClubTopicChip: ({ topic, catalog }: { topic: string | null; catalog: readonly unknown[] }) => (
    <span data-testid="topic-chip" data-topic={topic ?? ""} data-catalog={catalog.length} />
  ),
}));
vi.mock("@/components/clubs/atoms/ClubThreadKindIcon", () => ({
  ClubThreadKindIcon: ({ kind, icon }: { kind: string | null; icon?: string | null }) => (
    <span data-testid="kind-icon" data-kind={kind ?? ""} data-icon={icon ?? "brak"} />
  ),
}));
vi.mock("@/components/clubs/molecules/ClubReactionBar", () => ({
  ClubReactionBar: ({
    tallies,
    disabled,
    variant,
    labels,
    onToggle,
  }: {
    tallies: readonly ClubReactionTally[];
    disabled?: boolean;
    variant?: string;
    labels?: string;
    onToggle: (kind: ClubReactionKind, active: boolean) => void;
  }) => (
    <button
      type="button"
      data-testid="reaction-bar"
      data-variant={variant ?? ""}
      data-labels={labels ?? ""}
      data-tallies={tallies.length}
      disabled={disabled === true}
      onClick={() => onToggle("insightful", false)}
    />
  ),
}));
vi.mock("@/components/clubs/molecules/ClubReactionAvatars", () => ({
  ClubReactionAvatars: ({
    actors,
    total,
  }: {
    actors: readonly ClubReactionActor[];
    total?: number;
  }) => (
    <span data-testid="reaction-avatars" data-total={String(total ?? "")} data-actors={actors.length} />
  ),
}));
vi.mock("@/components/clubs/molecules/ClubFollowButton", () => ({
  ClubFollowButton: ({
    state,
    pending,
    disabled,
    onChange,
  }: {
    state: ClubSubscriptionState | null;
    pending: boolean;
    disabled: boolean;
    onChange: (next: ClubSubscriptionState) => void;
  }) => (
    <button
      type="button"
      data-testid="follow"
      data-state={state ?? "brak"}
      data-pending={String(pending)}
      disabled={disabled}
      onClick={() => onChange("subscribed")}
    />
  ),
}));
vi.mock("@/components/clubs/molecules/ClubStanceBar", () => ({
  ClubStanceBar: ({
    rows,
    disabled,
    pending,
    onSet,
  }: {
    rows: readonly unknown[];
    disabled: boolean;
    pending: boolean;
    onSet: (stance: ClubStance) => void;
  }) => (
    <button
      type="button"
      data-testid="stance-bar"
      data-rows={rows.length}
      data-pending={String(pending)}
      disabled={disabled}
      onClick={() => onSet("support")}
    />
  ),
}));
vi.mock("@/components/clubs/molecules/ClubNewRepliesBar", () => ({
  ClubNewRepliesBar: ({ count, onReveal }: { count: number; onReveal: () => void }) => (
    <button type="button" data-testid="new-replies" data-count={count} onClick={onReveal} />
  ),
}));
vi.mock("@/components/clubs/molecules/ClubReportButton", () => ({
  ClubReportButton: ({ targetType, targetId }: { targetType: string; targetId: string }) => (
    <span data-testid="report" data-target-type={targetType} data-target-id={targetId} />
  ),
}));
vi.mock("@/components/clubs/molecules/ClubInlineEditor", () => ({
  ClubInlineEditor: ({
    idPrefix,
    initialTitle,
    initialBody,
    showReason,
    pending,
    onCancel,
    onSave,
  }: {
    idPrefix: string;
    initialTitle?: string;
    initialBody: string;
    showReason: boolean;
    pending: boolean;
    onCancel: () => void;
    onSave: (patch: { title?: string; body: string; reason: string | null }) => void;
  }) => (
    <div
      data-testid="inline-editor"
      data-prefix={idPrefix}
      data-title={initialTitle ?? "brak"}
      data-body={initialBody}
      data-reason={String(showReason)}
      data-pending={String(pending)}
    >
      <button
        type="button"
        data-testid="editor-save"
        onClick={() => onSave({ title: "Tytuł po redakcji", body: "Treść po redakcji", reason: "literówka" })}
      />
      <button type="button" data-testid="editor-cancel" onClick={onCancel} />
    </div>
  ),
}));
vi.mock("@/components/mentions/MentionTextarea", () => ({
  MentionTextarea: ({
    id,
    label,
    value,
    onChange,
    maxLength,
  }: {
    id?: string;
    label: string;
    value: string;
    onChange: (next: string) => void;
    maxLength?: number;
  }) => {
    const shared = {
      "aria-label": label,
      value,
      "data-testid": "composer-field",
      "data-max": String(maxLength ?? ""),
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        onChange(event.target.value),
    };
    // `unidentified` odwzorowuje pole, które zgubiło `id` - efekt wejścia
    // z „Komentuj” szuka go przez `getElementById`.
    if (h.fieldTag === "unidentified") return <textarea {...shared} />;
    if (h.fieldTag === "input") return <input {...shared} id={id} />;
    return <textarea {...shared} id={id} />;
  },
}));
vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);
vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);
// Radixowy AlertDialog nie otwiera się w happy-dom (potrzebuje realnego
// wskaźnika), a przedmiotem dowodu jest tu POTWIERDZENIE: treść dialogu ma
// istnieć dopiero po otwarciu, bo cofnięcie rozstrzygnięcia jest jedyną akcją
// w tym pasku, która KASUJE decyzję wątku.
vi.mock("@/components/ui/alert-dialog", async () => {
  const React = await import("react");
  const Ctx = React.createContext<{ open: boolean; set: (next: boolean) => void }>({
    open: false,
    set: () => undefined,
  });
  return {
    AlertDialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open?: boolean;
      onOpenChange?: (next: boolean) => void;
      children?: ReactNode;
    }) => (
      <Ctx.Provider value={{ open: open === true, set: (next) => onOpenChange?.(next) }}>
        <div data-testid="unmark-dialog" data-open={String(open === true)}>
          {children}
        </div>
      </Ctx.Provider>
    ),
    AlertDialogTrigger: ({ children }: { children?: ReactNode }) => {
      const ctx = React.useContext(Ctx);
      return (
        <span data-testid="unmark-trigger" onClick={() => ctx.set(true)}>
          {children}
        </span>
      );
    },
    AlertDialogContent: ({ children }: { children?: ReactNode }) => {
      const ctx = React.useContext(Ctx);
      return ctx.open ? <div data-testid="unmark-content">{children}</div> : null;
    },
    AlertDialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    AlertDialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    AlertDialogTitle: ({ children }: { children?: ReactNode }) => <h3>{children}</h3>,
    AlertDialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
    AlertDialogCancel: ({ children }: { children?: ReactNode }) => (
      <button type="button" data-testid="unmark-cancel">
        {children}
      </button>
    ),
    AlertDialogAction: ({
      children,
      onClick,
    }: {
      children?: ReactNode;
      onClick?: () => void;
    }) => (
      <button type="button" data-testid="unmark-confirm" onClick={onClick}>
        {children}
      </button>
    ),
  };
});

import { renderRoute, routeSearchValidator, type RouteMetaEntry } from "@/test/routeHarness";
import { buildClubHead, toClubHeadSource } from "@/lib/clubs/clubHead";
import { EMPTY_WORKSPACE_SUMMARY } from "@/lib/clubs/workspaceTypes";
import { clubKeys } from "@/lib/clubs/queryKeys";
import { CLUB_BASE_ISO, CLUB_IDS, clubIsoOffset, clubViewRow } from "@/test/clubs/fixtures";
import { Route as ThreadRoute } from "@/routes/club.$clubSlug.t.$threadSlug";

const SLUG = "klub-energetyczny";
const THREAD = "temat-pierwszy";
const PATH = "/club/$clubSlug/t/$threadSlug";
const ENTRY = `/club/${SLUG}/t/${THREAD}`;

/**
 * Wiersz `club_thread_view`. Mieszka tu, a nie w `src/test/clubs/fixtures.ts`,
 * bo wymaga jawnego dopuszczenia NULL-i w kolumnach, które generator typów
 * deklaruje jako `string` - patrz `WithNulls`.
 */
function threadRow(overrides: Partial<ThreadRow> = {}): ThreadRow {
  return {
    id: CLUB_IDS.thread,
    club_id: CLUB_IDS.club,
    group_id: CLUB_IDS.group,
    slug: THREAD,
    title: "Ceny energii w pakiecie zimowym",
    body: "Treść postu otwierającego.",
    kind: "discussion",
    status: "published",
    topic: "energy",
    icon: null,
    anchor_type: null,
    anchor_id: null,
    attribution_mode: "named",
    author_id: CLUB_IDS.member,
    author_name: "Anna Nowak",
    author_avatar: null,
    author_slug: "anna-nowak",
    author_alias: null,
    posted_by_admin_name: null,
    is_anonymous: false,
    can_moderate: false,
    can_reply: true,
    created_at: CLUB_BASE_ISO,
    edited_at: null,
    locked_at: null,
    pinned_at: null,
    poll_id: null,
    resolved_reply_id: null,
    participant_count: 3,
    reaction_count: 2,
    reply_count: 4,
    reason: "",
    ...overrides,
  };
}

/** Wiersz `club_replies_list`. */
function replyRow(overrides: Partial<ClubReplyRow> = {}): ClubReplyRow {
  return {
    id: CLUB_IDS.reply,
    parent_id: null,
    depth: 0,
    body: "Pierwsza odpowiedź.",
    status: "visible",
    author_id: CLUB_IDS.member,
    author_name: "Anna Nowak",
    author_avatar: null,
    author_slug: "anna-nowak",
    author_alias: null,
    author_stance: null,
    posted_by_admin_name: null,
    is_anonymous: false,
    is_resolution: false,
    reaction_count: 0,
    created_at: CLUB_BASE_ISO,
    edited_at: null,
    total_count: 1,
    ...overrides,
  };
}

function page(rows: ClubReplyRow[], total: number = rows.length): RepliesPage {
  return { rows, total };
}

function tallies(...entries: [ClubReactionKind, number][]): ClubReactionTally[] {
  return entries.map(([kind, total]) => ({ kind, total, mine: false }));
}

function actor(overrides: Partial<ClubReactionActor> = {}): ClubReactionActor {
  return {
    userId: CLUB_IDS.member,
    name: "Anna Nowak",
    headline: null,
    avatarUrl: null,
    slug: "anna-nowak",
    isMe: false,
    kinds: ["insightful"],
    ...overrides,
  };
}

async function mount(entry: string = ENTRY) {
  return renderRoute({ route: ThreadRoute, path: PATH, initialEntry: entry });
}

function robotsOf(meta: readonly RouteMetaEntry[]): string | null {
  const entry = meta.find((item) => item.name === "robots");
  return typeof entry?.content === "string" ? entry.content : null;
}

/** Pasek reakcji wybranego wariantu - `full` to post otwierający, `compact` odpowiedzi. */
function reactionBars(variant: "full" | "compact"): HTMLElement[] {
  return screen
    .getAllByTestId("reaction-bar")
    .filter((node) => node.getAttribute("data-variant") === variant);
}

function composerField(): HTMLElement {
  return screen.getByTestId("composer-field");
}

/**
 * Treść w kompozytorze. React trzyma ją we WŁAŚCIWOŚCI `value`, nie w atrybucie
 * - odczyt atrybutem dawał `null` niezależnie od tego, co w polu stoi, czyli
 * test „nie wyczyściło pola” przechodziłby także wtedy, gdy pole wyczyszczono.
 * Zawężenie w runtime, nie rzutowanie.
 */
function composerValue(): string {
  const field = composerField();
  if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) {
    return field.value;
  }
  throw new Error("test: kompozytor nie renderuje pola tekstowego");
}

/** Wpisanie treści w kompozytor - jednocześnie WYMUSZA przerysowanie widoku. */
function typeReply(text: string): void {
  fireEvent.change(composerField(), { target: { value: text } });
}

beforeEach(() => {
  cleanup();
  vi.stubGlobal("scrollTo", h.scrollTo);
  h.lang = "pl";
  h.user = { id: CLUB_IDS.me };
  h.loaded = clubViewRow();
  h.loaderFails = false;
  h.fetchCalls = 0;
  h.club = clubViewRow();
  h.clubPending = false;
  h.clubError = false;
  h.clubRefetch.mockReset();
  h.clubSlugSeen = null;
  h.thread = threadRow();
  h.threadPending = false;
  h.threadError = false;
  h.threadRefetch.mockReset();
  h.threadArgs = null;
  h.replies = page([]);
  h.repliesPending = false;
  h.repliesArgs = null;
  h.tallyArgs = {};
  h.actorArgs = {};
  h.threadTallies = undefined;
  h.replyTallies = undefined;
  h.threadActors = undefined;
  h.replyActors = undefined;
  h.togglePending = false;
  h.toggleCalls = [];
  h.stanceThreadId = null;
  h.stanceRows = undefined;
  h.stancePending = false;
  h.stanceFails = false;
  h.stanceCalls = [];
  h.subscriptionThreadId = null;
  h.subscription = null;
  h.subscriptionQueryPending = false;
  h.subscriptionPending = false;
  h.subscriptionFails = false;
  h.subscriptionCalls = [];
  h.replyHookArgs = null;
  h.replyPending = false;
  h.replyVariables = undefined;
  h.replyOutcome = { id: "reply-new", queued: false };
  h.replyFails = false;
  h.replyCalls = [];
  h.resolveHookArgs = null;
  h.resolveFails = false;
  h.resolveCalls = [];
  h.editThreadPending = false;
  h.editThreadFails = false;
  h.editThreadCalls = [];
  h.editReplyThreadId = null;
  h.editReplyPending = false;
  h.editReplyFails = false;
  h.editReplyCalls = [];
  h.workspaceThreadId = null;
  h.workspaceSummary = undefined;
  h.topics = [{ key: "energy", label_pl: "Energia", label_en: "Energy", sort_order: 1 }];
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.props = {};
  h.fieldTag = "textarea";
  h.scrollTo.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ===========================================================================
// 1. Kontrakt adresu
// ===========================================================================

describe("strona wątku - `?reply=1` jako kontrakt linku z maila", () => {
  const validate = routeSearchValidator(ThreadRoute);

  it.each([
    ["jedynka z adresu", { reply: "1" }],
    ["napis `true`", { reply: "true" }],
    ["prawdziwy boolean po hydracji", { reply: true }],
  ])("%s włącza intencję odpowiadania", (_label, raw) => {
    expect(validate(raw)).toEqual({ reply: true });
  });

  it.each([
    ["brak parametru", {}],
    ["zero", { reply: "0" }],
    ["napis `false`", { reply: "false" }],
    ["pusty napis", { reply: "" }],
    ["null", { reply: null }],
    ["liczba", { reply: 1 }],
    ["tablica", { reply: ["1"] }],
    ["obiekt", { reply: { on: true } }],
  ])("%s daje PUSTY obiekt - adres z fałszem nie przestawia kursora", (_label, raw) => {
    expect(validate(raw)).toEqual({});
  });

  it("parametry nadmiarowe są odcinane - kampanijne `utm_*` nie wchodzą do stanu", () => {
    expect(validate({ reply: "1", utm_source: "newsletter" })).toEqual({ reply: true });
  });

  it("router przepuszcza intencję do stanu trasy", async () => {
    // `?reply=true` to postać, którą wystawia `Link` z `search={{ reply: true }}`
    // (`ClubEngagementBar`, `ClubPostCard`) - i to ona MUSI dojechać do widoku.
    const rendered = await mount(`${ENTRY}?reply=true`);
    expect(rendered.search()).toEqual({ reply: true });
  });

  it.fails(
    "BŁĄD SKLEJENIA: `?reply=1` z ręcznie wklejonego adresu NIE dociera do widoku",
    async () => {
      // Walidator przepuszcza napis „1” (tabela wyżej to potwierdza), ale do
      // widoku jedzie SUROWY, sparsowany parametr: domyślny parser adresu robi
      // `JSON.parse("1")`, czyli LICZBĘ 1. Walidator zwraca wtedy pusty obiekt,
      // więc nie ma czym przesłonić surowej wartości - `replyIntent` w trasie
      // jest liczbą, warunek `replyIntent !== true` jest prawdziwy i kursor NIE
      // ląduje w kompozytorze. Link `?reply=1` opisany w nagłówku
      // `ClubEngagementBar` jest więc martwy dla adresów pisanych ręcznie
      // (w aplikacji klik serializuje `{ reply: true }`, dlatego defektu nie
      // widać z wnętrza serwisu). To samo dotyczy `?reply=0`, który zamiast
      // zostać odrzucony dojeżdża jako liczba 0.
      const rendered = await mount(`${ENTRY}?reply=1`);
      expect(rendered.search()).toEqual({ reply: true });
    },
  );
});

// ===========================================================================
// 2. Loader i nagłówek
// ===========================================================================

describe("strona wątku - loader i indeksowalność", () => {
  it("loader dogrzewa cache pod `clubKeys.bySlug` - tym samym kluczem, z którego czyta widok", async () => {
    const { queryClient } = await mount();
    expect(queryClient.getQueryData(clubKeys.bySlug(SLUG))).not.toBeUndefined();
    expect(h.fetchCalls).toBe(1);
  });

  it("nagłówek zgadza się z `buildClubHead` na danych z loadera", async () => {
    const row = clubViewRow({ visibility: "public" });
    h.loaded = row;
    const rendered = await mount();
    const expected = buildClubHead({
      fallbackPath: `/club/${SLUG}/t/${THREAD}`,
      club: toClubHeadSource(row),
    });
    expect(rendered.meta()).toEqual(expected.meta);
    expect(rendered.links()).toEqual(expected.links);
  });

  it("wątek w klubie `public` jest indeksowalny", async () => {
    h.loaded = clubViewRow({ visibility: "public" });
    const rendered = await mount();
    expect(robotsOf(rendered.meta())).toBe("index, follow");
  });

  it.each(["members", "private", "secret"])(
    "wątek w klubie `%s` nigdy nie wchodzi do indeksu",
    async (visibility) => {
      h.loaded = clubViewRow({ visibility });
      const rendered = await mount();
      expect(robotsOf(rendered.meta())).toBe("noindex, nofollow");
    },
  );

  it("awaria loadera schodzi na `noindex` i NIE wywala trasy", async () => {
    h.loaderFails = true;
    const rendered = await mount();
    expect(robotsOf(rendered.meta())).toBe("noindex, nofollow");
    expect(rendered.currentPath()).toBe(ENTRY);
    // Doktryna odporności tras publicznych: strona nadal się renderuje.
    expect(screen.getByTestId("workspace")).toBeTruthy();
  });
});

// ===========================================================================
// 3. Cztery etapy wczytywania
// ===========================================================================

describe("strona wątku - cztery etapy wczytywania są ROZŁĄCZNE", () => {
  it("oczekiwanie na kartę klubu rysuje szkielet o kształcie wątku", async () => {
    h.clubPending = true;
    h.club = null;
    await mount();
    expect(screen.getAllByTestId("shimmer").length).toBeGreaterThan(0);
    expect(screen.getByTestId("list-skeleton").getAttribute("data-count")).toBe("3");
    expect(screen.queryByTestId("workspace")).toBeNull();
  });

  it("oczekiwanie na wątek PRZY ISTNIEJĄCYM klubie rysuje szkielet", async () => {
    h.threadPending = true;
    h.thread = null;
    await mount();
    expect(screen.getByTestId("list-skeleton")).toBeTruthy();
  });

  it("oczekiwanie na wątek BEZ klubu daje 404, a nie wieczny szkielet", async () => {
    // Wyłączone `useQuery` zostaje w `isPending` na zawsze - sklejenie tych
    // stanów zamieniało nieistniejący slug w stronę wirującą bez końca.
    h.club = null;
    h.threadPending = true;
    h.thread = null;
    await mount();
    expect(screen.getByText("club.reason.not_found")).toBeTruthy();
    expect(screen.queryByTestId("list-skeleton")).toBeNull();
  });

  it.each([
    ["karty klubu", "club"],
    ["wątku", "thread"],
  ])("awaria zapytania %s to NIE 404", async (_label, which) => {
    if (which === "club") h.clubError = true;
    else h.threadError = true;
    h.thread = null;
    await mount();
    expect(screen.getByTestId("error-notice")).toBeTruthy();
    expect(screen.queryByText("club.reason.not_found")).toBeNull();
  });

  it("komunikat awarii ponawia OBA zapytania - inaczej jedno zostaje puste", async () => {
    h.threadError = true;
    h.thread = null;
    await mount();
    fireEvent.click(screen.getByTestId("error-notice"));
    expect(h.clubRefetch).toHaveBeenCalledTimes(1);
    expect(h.threadRefetch).toHaveBeenCalledTimes(1);
  });

  it("brak wiersza wątku daje 404 z powrotem do klubu, nie odmowę dostępu", async () => {
    h.thread = null;
    await mount();
    expect(screen.getByText("club.reason.not_found")).toBeTruthy();
    const back = screen.getByRole("link");
    expect(back.getAttribute("href")).toBe(`/club/${SLUG}`);
  });

  it("brak KLUBU i wątku daje 404 z etykietą zastępczą zamiast nazwy klubu", async () => {
    h.club = null;
    h.thread = null;
    await mount();
    expect(screen.getByRole("link").textContent).toBe("club.title");
  });

  it("komplet danych rysuje przestrzeń roboczą z dyskusją w środku", async () => {
    await mount();
    expect(screen.getByTestId("workspace")).toBeTruthy();
    expect(screen.getByTestId("club-thread-lead")).toBeTruthy();
  });
});

// ===========================================================================
// 4. Co trasa wysyła do zapytań
// ===========================================================================

describe("strona wątku - argumenty zapytań", () => {
  it("wątku pyta się o id klubu z karty i slug z adresu", async () => {
    await mount();
    expect(h.clubSlugSeen).toBe(SLUG);
    expect(h.threadArgs).toEqual({ clubId: CLUB_IDS.club, slug: THREAD });
  });

  it("odpowiedzi pyta się o id wątku w porządku chronologicznym", async () => {
    await mount();
    expect(h.repliesArgs).toEqual({ threadId: CLUB_IDS.thread, sort: "chronological" });
  });

  it("reakcje i twarze jadą DWOMA zapytaniami wsadowymi, nie jednym na wpis", async () => {
    h.replies = page([
      replyRow({ id: "reply-a" }),
      replyRow({ id: "reply-b" }),
      replyRow({ id: "reply-c" }),
    ]);
    await mount();
    expect(h.tallyArgs.thread).toEqual([CLUB_IDS.thread]);
    expect(h.tallyArgs.reply).toEqual(["reply-a", "reply-b", "reply-c"]);
    expect(h.actorArgs.thread).toEqual([CLUB_IDS.thread]);
    expect(h.actorArgs.reply).toEqual(["reply-a", "reply-b", "reply-c"]);
  });

  it("partia odpowiedzi jest PUSTA, dopóki zapytanie o odpowiedzi jest w locie", async () => {
    h.replies = undefined;
    h.repliesPending = true;
    await mount();
    expect(h.tallyArgs.reply).toEqual([]);
  });

  it("o stanowiska pyta się WYŁĄCZNIE w wątku `position` - poza nim baza odrzuca to z 22023", async () => {
    await mount();
    expect(h.stanceThreadId).toBeNull();
  });

  it("wątek `position` pyta o stanowiska z id wątku", async () => {
    h.thread = threadRow({ kind: "position" });
    await mount();
    expect(h.stanceThreadId).toBe(CLUB_IDS.thread);
  });

  it("liczniki paneli to JEDNO zapytanie na całą belkę zakładek", async () => {
    await mount();
    expect(h.workspaceThreadId).toBe(CLUB_IDS.thread);
  });

  it("subskrypcja i mutacje dostają id klubu oraz slug wątku - to klucze inwalidacji", async () => {
    await mount();
    expect(h.subscriptionThreadId).toBe(CLUB_IDS.thread);
    expect(h.replyHookArgs).toEqual({ clubId: CLUB_IDS.club, threadSlug: THREAD });
    expect(h.resolveHookArgs).toEqual({ clubId: CLUB_IDS.club, threadSlug: THREAD });
    expect(h.editReplyThreadId).toBe(CLUB_IDS.thread);
  });

  it("przestrzeń robocza dostaje puste podsumowanie, dopóki liczniki nie doszły", async () => {
    await mount();
    // Asercja idzie PRZECIW stałej, której używa trasa - nie przeciw
    // przepisanemu w teście kształtowi, który rozjechałby się przy nowym panelu.
    expect(h.props.workspace.summary).toEqual(EMPTY_WORKSPACE_SUMMARY);
  });
});

// ===========================================================================
// 5. Post otwierający
// ===========================================================================

describe("post otwierający - meta i autorstwo", () => {
  it("ikona rodzaju dostaje ikonę Z KATALOGU, a nazwa spoza katalogu degraduje do braku", async () => {
    h.thread = threadRow({ icon: "zap" });
    await mount();
    expect(screen.getByTestId("kind-icon").getAttribute("data-icon")).toBe("zap");

    cleanup();
    h.thread = threadRow({ icon: "ikona-ktorej-nie-ma" });
    await mount();
    expect(screen.getByTestId("kind-icon").getAttribute("data-icon")).toBe("brak");
  });

  it("czysty wątek nie nosi ŻADNEJ plakietki stanu", async () => {
    await mount();
    expect(screen.queryByText("club.threadStatus.resolved")).toBeNull();
    expect(screen.queryByText("club.threadStatus.locked")).toBeNull();
    expect(screen.queryByText("club.attribution.chatham")).toBeNull();
    expect(screen.queryByText("club.edited")).toBeNull();
    expect(screen.queryByText("club.hub.feed.pinned")).toBeNull();
  });

  it("stan wątku jedzie plakietkami: rozstrzygnięty, zamknięty, poufny, przypięty, podpięty, poprawiony", async () => {
    h.thread = threadRow({
      status: "resolved",
      locked_at: clubIsoOffset(-60),
      attribution_mode: "chatham",
      pinned_at: clubIsoOffset(-120),
      anchor_type: "eu_policy_item",
      edited_at: clubIsoOffset(-30),
    });
    await mount();
    expect(screen.getByText("club.threadStatus.resolved")).toBeTruthy();
    expect(screen.getByText("club.threadStatus.locked")).toBeTruthy();
    expect(screen.getByText("club.attribution.chatham")).toBeTruthy();
    expect(screen.getByText("club.anchorType.eu_policy_item")).toBeTruthy();
    expect(screen.getByText("club.hub.feed.pinned")).toBeTruthy();
    expect(screen.getByText("club.edited")).toBeTruthy();
  });

  it("obszar tematyczny dostaje katalog tematów, nie sam napis", async () => {
    await mount();
    const chip = screen.getByTestId("topic-chip");
    expect(chip.getAttribute("data-topic")).toBe("energy");
    expect(chip.getAttribute("data-catalog")).toBe("1");
  });

  it("autor jawny jedzie z nazwiskiem i pełnym awatarem", async () => {
    await mount();
    const avatar = screen.getAllByTestId("author-avatar")[0];
    expect(avatar.getAttribute("data-name")).toBe("Anna Nowak");
    expect(avatar.getAttribute("data-muted")).toBe("false");
  });

  it("wpis anonimowy jedzie ALIASEM i stonowanym awatarem - baza już rozstrzygnęła, co wolno pokazać", async () => {
    h.thread = threadRow({ author_id: null, author_name: null, author_alias: "A7" });
    await mount();
    const avatar = screen.getAllByTestId("author-avatar")[0];
    expect(avatar.getAttribute("data-name")).toBe("club.anonymousAuthor");
    expect(avatar.getAttribute("data-muted")).toBe("true");
  });

  it("usunięte konto zostawia treść, nie autorstwo", async () => {
    h.thread = threadRow({ author_id: null, author_name: null, author_alias: null });
    await mount();
    expect(screen.getAllByTestId("author-avatar")[0].getAttribute("data-name")).toBe(
      "club.deletedAuthor",
    );
  });

  it("treść postu idzie do prozy razem z kontekstem klubu - #tagi mają prowadzić do TEGO klubu", async () => {
    await mount();
    const prose = screen.getAllByTestId("prose")[0];
    expect(prose.getAttribute("data-body")).toBe("Treść postu otwierającego.");
    expect(prose.getAttribute("data-club")).toBe(SLUG);
    expect(prose.getAttribute("data-size")).toBe("base");
  });

  it("nagłówek sekcji liczy odpowiedzi z DENORMALIZACJI wątku, nie z pobranej strony", async () => {
    h.replies = page([replyRow()], 40);
    await mount();
    expect(screen.getByText("club.repliesCount(count=4)")).toBeTruthy();
  });
});

describe("post otwierający - reakcje, obserwowanie, redakcja, zgłoszenie", () => {
  it("pasek reakcji dostaje partię TEGO wątku i pełny wariant z etykietami po najechaniu", async () => {
    h.threadTallies = new Map([[CLUB_IDS.thread, tallies(["insightful", 2], ["thanks", 1])]]);
    await mount();
    const bar = reactionBars("full")[0];
    expect(bar.getAttribute("data-tallies")).toBe("2");
    expect(bar.getAttribute("data-labels")).toBe("hover");
  });

  it("brak partii reakcji (zapytanie w locie) daje pustą listę, nie awarię renderu", async () => {
    h.threadTallies = undefined;
    await mount();
    expect(reactionBars("full")[0].getAttribute("data-tallies")).toBe("0");
    expect(screen.getAllByTestId("reaction-avatars")[0].getAttribute("data-total")).toBe("0");
  });

  it("liczba nad twarzami to SUMA wszystkich rodzajów, nie liczba rodzajów", async () => {
    h.threadTallies = new Map([[CLUB_IDS.thread, tallies(["insightful", 3], ["agree", 4])]]);
    h.threadActors = new Map([[CLUB_IDS.thread, [actor()]]]);
    await mount();
    const avatars = screen.getAllByTestId("reaction-avatars")[0];
    expect(avatars.getAttribute("data-total")).toBe("7");
    expect(avatars.getAttribute("data-actors")).toBe("1");
  });

  it("kliknięcie reakcji woła mutację z id WĄTKU", async () => {
    await mount();
    fireEvent.click(reactionBars("full")[0]);
    expect(h.toggleCalls).toEqual([
      { targetType: "thread", targetId: CLUB_IDS.thread, kind: "insightful", active: false },
    ]);
  });

  it("brak prawa do odpowiedzi gasi reakcje - i wysyłka w toku też", async () => {
    h.thread = threadRow({ can_reply: false });
    await mount();
    expect(reactionBars("full")[0].hasAttribute("disabled")).toBe(true);

    cleanup();
    h.thread = threadRow();
    h.togglePending = true;
    await mount();
    expect(reactionBars("full")[0].hasAttribute("disabled")).toBe(true);
  });

  it("przycisk obserwowania pokazuje STAN Z ZAPYTANIA i milczy, dopóki go nie zna", async () => {
    h.subscription = "muted";
    await mount();
    expect(screen.getByTestId("follow").getAttribute("data-state")).toBe("muted");

    cleanup();
    h.subscription = null;
    h.subscriptionQueryPending = true;
    await mount();
    const follow = screen.getByTestId("follow");
    expect(follow.getAttribute("data-state")).toBe("brak");
    expect(follow.hasAttribute("disabled")).toBe(true);
  });

  it("zmiana obserwowania woła RPC z nowym stanem, a awaria kończy się toastem błędu", async () => {
    await mount();
    fireEvent.click(screen.getByTestId("follow"));
    expect(h.subscriptionCalls).toEqual([{ threadId: CLUB_IDS.thread, state: "subscribed" }]);
    expect(h.toastError).not.toHaveBeenCalled();

    h.subscriptionFails = true;
    fireEvent.click(screen.getByTestId("follow"));
    expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed");
  });

  it("redakcja postu stoi przy WŁASNYM wpisie i otwiera edytor bez pola powodu", async () => {
    h.thread = threadRow({ author_id: CLUB_IDS.me });
    await mount();
    fireEvent.click(screen.getByLabelText("club.editor.edit"));
    const editor = screen.getByTestId("inline-editor");
    expect(editor.getAttribute("data-prefix")).toBe("club-thread-edit");
    expect(editor.getAttribute("data-title")).toBe("Ceny energii w pakiecie zimowym");
    expect(editor.getAttribute("data-body")).toBe("Treść postu otwierającego.");
    // Autor poprawia swoją literówkę i nie ma się przed kim tłumaczyć.
    expect(editor.getAttribute("data-reason")).toBe("false");
    // Otwarty edytor zdejmuje z ekranu prozę i sam przycisk redakcji.
    expect(screen.queryByLabelText("club.editor.edit")).toBeNull();
  });

  it("moderacja redaguje CUDZY post, ale z polem powodu - jej powód idzie do dziennika", async () => {
    h.thread = threadRow({ can_moderate: true });
    await mount();
    fireEvent.click(screen.getByLabelText("club.editor.edit"));
    expect(screen.getByTestId("inline-editor").getAttribute("data-reason")).toBe("true");
  });

  it("zapis redakcji woła RPC z id wątku i łatką, zamyka edytor i potwierdza", async () => {
    h.thread = threadRow({ author_id: CLUB_IDS.me });
    await mount();
    fireEvent.click(screen.getByLabelText("club.editor.edit"));
    fireEvent.click(screen.getByTestId("editor-save"));
    expect(h.editThreadCalls).toEqual([
      {
        threadId: CLUB_IDS.thread,
        title: "Tytuł po redakcji",
        body: "Treść po redakcji",
        reason: "literówka",
      },
    ]);
    expect(h.toastSuccess).toHaveBeenCalledWith("club.editor.saved");
    expect(screen.queryByTestId("inline-editor")).toBeNull();
  });

  it("awaria zapisu ZOSTAWIA edytor otwarty - inaczej praca przepada bez śladu", async () => {
    h.thread = threadRow({ author_id: CLUB_IDS.me });
    h.editThreadFails = true;
    await mount();
    fireEvent.click(screen.getByLabelText("club.editor.edit"));
    fireEvent.click(screen.getByTestId("editor-save"));
    expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed");
    expect(screen.getByTestId("inline-editor")).toBeTruthy();
  });

  it("porzucenie redakcji wraca do treści", async () => {
    h.thread = threadRow({ author_id: CLUB_IDS.me });
    await mount();
    fireEvent.click(screen.getByLabelText("club.editor.edit"));
    fireEvent.click(screen.getByTestId("editor-cancel"));
    expect(screen.queryByTestId("inline-editor")).toBeNull();
    expect(screen.getAllByTestId("prose").length).toBeGreaterThan(0);
  });

  it("edytor w trakcie zapisu jest oznaczony jako zajęty", async () => {
    h.thread = threadRow({ author_id: CLUB_IDS.me });
    h.editThreadPending = true;
    await mount();
    fireEvent.click(screen.getByLabelText("club.editor.edit"));
    expect(screen.getByTestId("inline-editor").getAttribute("data-pending")).toBe("true");
  });

  it("ZAMKNIĘTY wątek nie ma redakcji nawet dla moderacji", async () => {
    h.thread = threadRow({ can_moderate: true, locked_at: clubIsoOffset(-10) });
    await mount();
    expect(screen.queryByLabelText("club.editor.edit")).toBeNull();
  });

  it("zgłoszenie stoi przy CUDZYM wpisie i tylko dla zalogowanego", async () => {
    await mount();
    const report = screen.getByTestId("report");
    expect(report.getAttribute("data-target-type")).toBe("thread");
    expect(report.getAttribute("data-target-id")).toBe(CLUB_IDS.thread);
  });

  it("własnego wpisu się nie zgłasza - RPC odrzuca to z 22023", async () => {
    h.thread = threadRow({ author_id: CLUB_IDS.me });
    await mount();
    expect(screen.queryByTestId("report")).toBeNull();
  });

  it("gość nie widzi ani redakcji, ani zgłoszenia", async () => {
    h.user = null;
    await mount();
    expect(screen.queryByTestId("report")).toBeNull();
    expect(screen.queryByLabelText("club.editor.edit")).toBeNull();
    expect(h.props.workspace.userId).toBeNull();
  });
});

// ===========================================================================
// 6. Sondaż, stanowiska, eksperci
// ===========================================================================

describe("strona wątku - sondaż tylko przy wątku `poll` Z ankietą", () => {
  it("wątek `poll` z `poll_id` dowozi sondaż leniwie", async () => {
    h.thread = threadRow({ kind: "poll", poll_id: "poll-1" });
    h.user = { id: CLUB_IDS.me };
    await mount();
    await waitFor(() => expect(screen.getByTestId("poll")).toBeTruthy());
    expect(h.props.poll).toMatchObject({ pollId: "poll-1", lang: "pl", userId: CLUB_IDS.me });
  });

  it("gość dostaje sondaż BEZ tożsamości - anti-anchoring nie ma wtedy kogo pamiętać", async () => {
    h.user = null;
    h.thread = threadRow({ kind: "poll", poll_id: "poll-1" });
    await mount();
    await waitFor(() => expect(screen.getByTestId("poll")).toBeTruthy());
    expect(h.props.poll.userId).toBeNull();
  });

  it("wątek `poll` BEZ ankiety nie rysuje sondażu - kolumna `poll_id` jest tu autorytetem", async () => {
    h.thread = threadRow({ kind: "poll", poll_id: null });
    await mount();
    expect(screen.queryByTestId("poll")).toBeNull();
  });

  it("ankieta podpięta pod wątek INNEGO rodzaju nie wchodzi na ekran", async () => {
    h.thread = threadRow({ kind: "discussion", poll_id: "poll-1" });
    await mount();
    expect(screen.queryByTestId("poll")).toBeNull();
  });
});

describe("strona wątku - stanowiska tylko przy wątku `position`", () => {
  it("wątek `position` rysuje pasek stanowisk z wierszami z RPC", async () => {
    h.thread = threadRow({ kind: "position" });
    h.stanceRows = [{ stance: "support", total: 2, mine: false }];
    await mount();
    expect(screen.getByTestId("stance-bar").getAttribute("data-rows")).toBe("1");
  });

  it("brak wierszy stanowisk daje pusty pasek, nie awarię", async () => {
    h.thread = threadRow({ kind: "position" });
    h.stanceRows = undefined;
    await mount();
    expect(screen.getByTestId("stance-bar").getAttribute("data-rows")).toBe("0");
  });

  it("wątek innego rodzaju nie ma paska stanowisk", async () => {
    await mount();
    expect(screen.queryByTestId("stance-bar")).toBeNull();
  });

  it("zajęcie stanowiska woła RPC z id wątku i potwierdza; awaria mówi o błędzie", async () => {
    h.thread = threadRow({ kind: "position" });
    await mount();
    fireEvent.click(screen.getByTestId("stance-bar"));
    expect(h.stanceCalls).toEqual([{ threadId: CLUB_IDS.thread, stance: "support" }]);
    expect(h.toastSuccess).toHaveBeenCalledWith("club.stance.saved");

    h.stanceFails = true;
    fireEvent.click(screen.getByTestId("stance-bar"));
    expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed");
  });

  it("brak prawa do odpowiedzi gasi zajęcie stanowiska, a zapis w toku oznacza pasek", async () => {
    h.thread = threadRow({ kind: "position", can_reply: false });
    h.stancePending = true;
    await mount();
    const bar = screen.getByTestId("stance-bar");
    expect(bar.hasAttribute("disabled")).toBe(true);
    expect(bar.getAttribute("data-pending")).toBe("true");
  });
});

describe("strona wątku - panel ekspertów", () => {
  it("dojeżdża leniwie z id wątku, a prawo do pytania idzie z prawa do odpowiedzi", async () => {
    await mount();
    await waitFor(() => expect(screen.getByTestId("experts")).toBeTruthy());
    expect(h.props.experts).toMatchObject({ threadId: CLUB_IDS.thread, canAsk: true });
  });

  it("wątek bez prawa odpowiedzi nie pozwala prosić o zdanie", async () => {
    h.thread = threadRow({ can_reply: false });
    await mount();
    await waitFor(() => expect(screen.getByTestId("experts")).toBeTruthy());
    expect(h.props.experts.canAsk).toBe(false);
  });
});

// ===========================================================================
// 7. Odpowiedzi
// ===========================================================================

describe("odpowiedzi - lista, porządek i ucięcie strony", () => {
  it("oczekiwanie na odpowiedzi rysuje szkielet listy", async () => {
    h.replies = undefined;
    h.repliesPending = true;
    await mount();
    expect(screen.getByTestId("list-skeleton")).toBeTruthy();
  });

  it("brak odpowiedzi mówi to WPROST, a nie pustym miejscem", async () => {
    await mount();
    expect(screen.getByText("club.noReplies")).toBeTruthy();
  });

  it("droplista porządków stoi dopiero od DWÓCH odpowiedzi", async () => {
    h.replies = page([replyRow()], 1);
    await mount();
    expect(screen.queryByLabelText("club.replySort.label")).toBeNull();

    cleanup();
    h.replies = page([replyRow({ id: "reply-a" }), replyRow({ id: "reply-b" })], 2);
    await mount();
    expect(screen.getByLabelText("club.replySort.label")).toBeTruthy();
  });

  it("sort „mapa sporu” pojawia się WYŁĄCZNIE w wątku `position`", async () => {
    h.replies = page([replyRow({ id: "a" }), replyRow({ id: "b" })], 2);
    await mount();
    const values = Array.from(
      screen.getByLabelText("club.replySort.label").querySelectorAll("option"),
    ).map((option) => option.getAttribute("value"));
    expect(values).toEqual(["chronological", "best"]);

    cleanup();
    h.thread = threadRow({ kind: "position" });
    await mount();
    const positionValues = Array.from(
      screen.getByLabelText("club.replySort.label").querySelectorAll("option"),
    ).map((option) => option.getAttribute("value"));
    expect(positionValues).toEqual(["chronological", "best", "stance"]);
  });

  it("zmiana porządku przepytuje odpowiedzi od nowa", async () => {
    h.replies = page([replyRow({ id: "a" }), replyRow({ id: "b" })], 2);
    await mount();
    fireEvent.change(screen.getByLabelText("club.replySort.label"), {
      target: { value: "best" },
    });
    expect(h.repliesArgs).toEqual({ threadId: CLUB_IDS.thread, sort: "best" });
  });

  it("UCIĘCIE strony mówi się wprost - milcząca różnica wygląda jak utrata treści", async () => {
    h.replies = page([replyRow()], 240);
    await mount();
    expect(screen.getByText("club.repliesTruncated(shown=1,total=240)")).toBeTruthy();
  });

  it("pełna strona nie mówi o ucięciu", async () => {
    h.replies = page([replyRow()], 1);
    await mount();
    expect(screen.queryByText(/repliesTruncated/)).toBeNull();
  });

  it("drzewo odpowiedzi zagnieżdża dziecko POD rodzicem, a nie obok", async () => {
    h.replies = page([
      replyRow({ id: "root", body: "Wpis nadrzędny." }),
      replyRow({ id: "child", parent_id: "root", depth: 1, body: "Wpis podrzędny." }),
    ]);
    await mount();
    const bodies = screen
      .getAllByTestId("prose")
      .map((node) => node.getAttribute("data-body"));
    expect(bodies).toContain("Wpis nadrzędny.");
    expect(bodies).toContain("Wpis podrzędny.");
    const nested = document.querySelectorAll("li li");
    expect(nested.length).toBe(1);
  });
});

describe("odpowiedzi - odroczona projekcja („N nowych odpowiedzi”)", () => {
  it("pierwsza partia wchodzi BEZ pytania - pasek nad pustą listą byłby bez sensu", async () => {
    h.replies = page([replyRow({ id: "a" }), replyRow({ id: "b" })]);
    await mount();
    expect(screen.getByTestId("new-replies").getAttribute("data-count")).toBe("0");
  });

  it("cudza odpowiedź CZEKA w pasku i wchodzi dopiero po kliknięciu", async () => {
    h.replies = page([replyRow({ id: "a", body: "Stary wpis." })]);
    await mount();
    // Nowy wiersz dojechał z zapytania; przerysowanie wywołuje pisanie w polu.
    h.replies = page([
      replyRow({ id: "a", body: "Stary wpis." }),
      replyRow({ id: "b", body: "Świeży cudzy wpis." }),
    ]);
    typeReply("cokolwiek");
    expect(screen.getByTestId("new-replies").getAttribute("data-count")).toBe("1");
    expect(
      screen.getAllByTestId("prose").map((node) => node.getAttribute("data-body")),
    ).not.toContain("Świeży cudzy wpis.");

    fireEvent.click(screen.getByTestId("new-replies"));
    expect(
      screen.getAllByTestId("prose").map((node) => node.getAttribute("data-body")),
    ).toContain("Świeży cudzy wpis.");
  });
});

describe("odpowiedzi - wpis pojedynczy", () => {
  it("plakietki wpisu: stanowisko autora, rozstrzygnięcie, kolejka moderacji", async () => {
    h.replies = page([
      replyRow({ author_stance: "oppose", is_resolution: true, status: "pending" }),
    ]);
    await mount();
    expect(screen.getByText("club.stance.oppose")).toBeTruthy();
    expect(screen.getByText("club.resolution")).toBeTruthy();
    expect(screen.getByText("club.threadStatus.pending")).toBeTruthy();
  });

  it("wpis bez tych stanów nie nosi żadnej z plakietek", async () => {
    h.replies = page([replyRow()]);
    await mount();
    expect(screen.queryByText("club.resolution")).toBeNull();
    expect(screen.queryByText("club.threadStatus.pending")).toBeNull();
    expect(screen.queryByText(/club\.stance\./)).toBeNull();
  });

  it("poprawiony wpis mówi o tym przy dacie", async () => {
    h.replies = page([replyRow({ edited_at: clubIsoOffset(30) })]);
    await mount();
    expect(screen.getByText(/club\.edited/)).toBeTruthy();
  });

  it("treść wpisu jedzie w gęstszym wariancie prozy niż post otwierający", async () => {
    h.replies = page([replyRow({ body: "Odpowiedź." })]);
    await mount();
    const dense = screen
      .getAllByTestId("prose")
      .find((node) => node.getAttribute("data-body") === "Odpowiedź.");
    expect(dense?.getAttribute("data-size")).toBe("sm");
  });

  it("reakcje wpisu jadą z partii ODPOWIEDZI, a kliknięcie woła mutację z id wpisu", async () => {
    h.replies = page([replyRow({ id: "reply-a" })]);
    h.replyTallies = new Map([["reply-a", tallies(["agree", 5])]]);
    h.replyActors = new Map([["reply-a", [actor(), actor({ userId: CLUB_IDS.lead })]]]);
    await mount();
    const bar = reactionBars("compact")[0];
    expect(bar.getAttribute("data-tallies")).toBe("1");
    fireEvent.click(bar);
    expect(h.toggleCalls).toEqual([
      { targetType: "reply", targetId: "reply-a", kind: "insightful", active: false },
    ]);
    const avatars = screen.getAllByTestId("reaction-avatars");
    expect(avatars[avatars.length - 1].getAttribute("data-total")).toBe("5");
  });

  it("brak map reakcji dla odpowiedzi daje puste paski, nie awarię", async () => {
    h.replies = page([replyRow({ id: "reply-a" })]);
    h.replyTallies = undefined;
    h.replyActors = undefined;
    await mount();
    expect(reactionBars("compact")[0].getAttribute("data-tallies")).toBe("0");
  });

  it("„Odpowiedz” stoi na poziomie 0 i 1, a gaśnie na poziomie 2 przyciętego drzewa", async () => {
    h.replies = page([
      replyRow({ id: "root", depth: 0 }),
      replyRow({ id: "mid", parent_id: "root", depth: 1 }),
      replyRow({ id: "leaf", parent_id: "mid", depth: 2 }),
    ]);
    await mount();
    expect(screen.getAllByText("club.reply").length).toBe(2);
  });

  it("kliknięcie „Odpowiedz” przestawia kompozytor na tryb gałęzi", async () => {
    h.replies = page([replyRow({ id: "reply-a" })]);
    await mount();
    fireEvent.click(screen.getByText("club.reply"));
    expect(screen.getByText("club.replyingTo")).toBeTruthy();
    expect(screen.getByText("club.cancelReplyTo")).toBeTruthy();
  });

  it("zgłoszenie wpisu dotyczy odpowiedzi, nie wątku", async () => {
    h.replies = page([replyRow({ id: "reply-a" })]);
    await mount();
    const targets = screen.getAllByTestId("report").map((node) => ({
      type: node.getAttribute("data-target-type"),
      id: node.getAttribute("data-target-id"),
    }));
    expect(targets).toContainEqual({ type: "reply", id: "reply-a" });
  });

  it("gość nie zgłasza odpowiedzi", async () => {
    h.user = null;
    h.replies = page([replyRow({ id: "reply-a" })]);
    await mount();
    expect(screen.queryByTestId("report")).toBeNull();
  });
});

describe("odpowiedzi - redakcja wpisu", () => {
  it("autor otwiera edytor wpisu bez pola powodu i BEZ tytułu", async () => {
    h.replies = page([replyRow({ id: "reply-a", author_id: CLUB_IDS.me })]);
    await mount();
    fireEvent.click(screen.getByText("club.editor.edit"));
    const editor = screen.getByTestId("inline-editor");
    expect(editor.getAttribute("data-prefix")).toBe("club-reply-edit-reply-a");
    expect(editor.getAttribute("data-title")).toBe("brak");
    expect(editor.getAttribute("data-reason")).toBe("false");
  });

  it("zapis redakcji wpisu woła RPC z id odpowiedzi i BEZ tytułu - odpowiedź go nie ma", async () => {
    h.replies = page([replyRow({ id: "reply-a", author_id: CLUB_IDS.me })]);
    await mount();
    fireEvent.click(screen.getByText("club.editor.edit"));
    fireEvent.click(screen.getByTestId("editor-save"));
    expect(h.editReplyCalls).toEqual([
      { replyId: "reply-a", body: "Treść po redakcji", reason: "literówka" },
    ]);
    expect(h.toastSuccess).toHaveBeenCalledWith("club.editor.saved");
    expect(screen.queryByTestId("inline-editor")).toBeNull();
  });

  it("awaria zapisu wpisu zostawia edytor i mówi o błędzie", async () => {
    h.replies = page([replyRow({ id: "reply-a", author_id: CLUB_IDS.me })]);
    h.editReplyFails = true;
    await mount();
    fireEvent.click(screen.getByText("club.editor.edit"));
    fireEvent.click(screen.getByTestId("editor-save"));
    expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed");
    expect(screen.getByTestId("inline-editor")).toBeTruthy();
  });

  it("porzucenie redakcji wpisu wraca do treści", async () => {
    h.replies = page([replyRow({ id: "reply-a", author_id: CLUB_IDS.me })]);
    await mount();
    fireEvent.click(screen.getByText("club.editor.edit"));
    fireEvent.click(screen.getByTestId("editor-cancel"));
    expect(screen.queryByTestId("inline-editor")).toBeNull();
  });

  it("moderacja redaguje cudzy wpis - z polem powodu", async () => {
    h.thread = threadRow({ can_moderate: true });
    h.replies = page([replyRow({ id: "reply-a" })]);
    await mount();
    // Moderacja widzi redakcję TAKŻE przy poście otwierającym, więc zapytanie
    // musi być zawężone do wiersza odpowiedzi.
    fireEvent.click(within(screen.getAllByRole("listitem")[0]).getByText("club.editor.edit"));
    expect(screen.getByTestId("inline-editor").getAttribute("data-reason")).toBe("true");
  });

  it("wpis ZDJĘTY przez moderację nie ma redakcji, choć jest mój", async () => {
    h.replies = page([replyRow({ id: "reply-a", author_id: CLUB_IDS.me, status: "deleted" })]);
    await mount();
    expect(screen.queryByText("club.editor.edit")).toBeNull();
  });

  it("zamknięty wątek gasi redakcję wpisu", async () => {
    h.thread = threadRow({ locked_at: clubIsoOffset(-5) });
    h.replies = page([replyRow({ id: "reply-a", author_id: CLUB_IDS.me })]);
    await mount();
    expect(screen.queryByText("club.editor.edit")).toBeNull();
  });

  it("edytor wpisu w trakcie zapisu jest oznaczony jako zajęty", async () => {
    h.replies = page([replyRow({ id: "reply-a", author_id: CLUB_IDS.me })]);
    h.editReplyPending = true;
    await mount();
    fireEvent.click(screen.getByText("club.editor.edit"));
    expect(screen.getByTestId("inline-editor").getAttribute("data-pending")).toBe("true");
  });

  it("w danej chwili otwarty jest NAJWYŻEJ jeden edytor - dwie wersje tekstu naraz to dwie prawdy", async () => {
    h.thread = threadRow({ author_id: CLUB_IDS.me });
    h.replies = page([replyRow({ id: "reply-a", author_id: CLUB_IDS.me })]);
    await mount();
    fireEvent.click(screen.getByLabelText("club.editor.edit"));
    expect(screen.getAllByTestId("inline-editor").length).toBe(1);
    fireEvent.click(screen.getByText("club.editor.edit"));
    expect(screen.getAllByTestId("inline-editor").length).toBe(1);
    expect(screen.getByTestId("inline-editor").getAttribute("data-prefix")).toBe(
      "club-reply-edit-reply-a",
    );
  });
});

describe("odpowiedzi - rozstrzyganie pytania", () => {
  function questionWithReplies(rows: ClubReplyRow[]) {
    h.thread = threadRow({ kind: "question", author_id: CLUB_IDS.me });
    h.replies = page(rows);
  }

  it("bez prawa nie ma ŻADNEJ akcji rozstrzygnięcia", async () => {
    h.thread = threadRow({ kind: "question" });
    h.replies = page([replyRow({ id: "reply-a" })]);
    await mount();
    expect(screen.queryByText("club.markResolution")).toBeNull();
    expect(screen.queryByText("club.unmarkResolution")).toBeNull();
  });

  it("pierwsze oznaczenie woła RPC z id odpowiedzi i mówi „rozstrzygnięto”", async () => {
    questionWithReplies([replyRow({ id: "reply-a" })]);
    await mount();
    fireEvent.click(screen.getByText("club.markResolution"));
    expect(h.resolveCalls).toEqual([{ threadId: CLUB_IDS.thread, replyId: "reply-a" }]);
    expect(h.toastSuccess).toHaveBeenCalledWith("club.resolvedToast");
  });

  it("gdy wątek JUŻ ma rozstrzygnięcie, akcja nazywa się PRZENIESIENIEM", async () => {
    questionWithReplies([
      replyRow({ id: "reply-a", is_resolution: true }),
      replyRow({ id: "reply-b" }),
    ]);
    await mount();
    fireEvent.click(screen.getByText("club.moveResolution"));
    expect(h.resolveCalls).toEqual([{ threadId: CLUB_IDS.thread, replyId: "reply-b" }]);
    expect(h.toastSuccess).toHaveBeenCalledWith("club.movedResolutionToast");
  });

  it("cofnięcie idzie przez POTWIERDZENIE - treść dialogu nie istnieje przed otwarciem", async () => {
    questionWithReplies([replyRow({ id: "reply-a", is_resolution: true })]);
    await mount();
    expect(screen.queryByTestId("unmark-content")).toBeNull();
    fireEvent.click(screen.getByText("club.unmarkResolution"));
    expect(screen.getByTestId("unmark-dialog").getAttribute("data-open")).toBe("true");
    expect(screen.getByText("club.unmarkResolutionConfirm.title")).toBeTruthy();
    expect(screen.getByText("club.unmarkResolutionConfirm.body")).toBeTruthy();
    expect(screen.getByTestId("unmark-cancel").textContent).toBe(
      "club.unmarkResolutionConfirm.cancel",
    );
  });

  it("potwierdzenie cofnięcia woła RPC z `null` i mówi „cofnięto”", async () => {
    questionWithReplies([replyRow({ id: "reply-a", is_resolution: true })]);
    await mount();
    fireEvent.click(screen.getByText("club.unmarkResolution"));
    fireEvent.click(screen.getByTestId("unmark-confirm"));
    expect(h.resolveCalls).toEqual([{ threadId: CLUB_IDS.thread, replyId: null }]);
    expect(h.toastSuccess).toHaveBeenCalledWith("club.unresolvedToast");
  });

  it("awaria rozstrzygnięcia mówi o błędzie", async () => {
    questionWithReplies([replyRow({ id: "reply-a" })]);
    h.resolveFails = true;
    await mount();
    fireEvent.click(screen.getByText("club.markResolution"));
    expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed");
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("moderacja rozstrzyga CUDZE pytanie", async () => {
    h.thread = threadRow({ kind: "question", can_moderate: true });
    h.replies = page([replyRow({ id: "reply-a" })]);
    await mount();
    expect(screen.getByText("club.markResolution")).toBeTruthy();
  });

  it("wątek innego rodzaju nie ma rozstrzygnięcia, choć jestem autorem", async () => {
    h.thread = threadRow({ kind: "discussion", author_id: CLUB_IDS.me });
    h.replies = page([replyRow({ id: "reply-a" })]);
    await mount();
    expect(screen.queryByText("club.markResolution")).toBeNull();
  });
});

// ===========================================================================
// 8. Kompozytor
// ===========================================================================

describe("kompozytor - brak prawa do odpowiedzi", () => {
  it("mówi POWÓD ze słownika, gdy RPC go podało", async () => {
    h.thread = threadRow({ can_reply: false, reason: "locked" });
    await mount();
    expect(screen.getByText("club.reason.locked")).toBeTruthy();
    expect(screen.queryByTestId("composer-field")).toBeNull();
  });

  it("bez powodu schodzi na zdanie ogólne, nie na identyfikator z bazy", async () => {
    h.thread = threadRow({ can_reply: false, reason: "" });
    await mount();
    expect(screen.getByText("club.cannotReply")).toBeTruthy();
  });
});

describe("kompozytor - wysyłka", () => {
  it("pusty i sam-spacjowy kompozytor ma wyłączony przycisk", async () => {
    await mount();
    const send = screen.getByRole("button", { name: "club.postReply" });
    expect(send.hasAttribute("disabled")).toBe(true);
    typeReply("   ");
    expect(send.hasAttribute("disabled")).toBe(true);
    fireEvent.click(send);
    expect(h.replyCalls).toEqual([]);
  });

  it("treść włącza wysyłkę i woła RPC z przyciętym tekstem", async () => {
    await mount();
    typeReply("  Zdanie do wysłania.  ");
    fireEvent.click(screen.getByRole("button", { name: "club.postReply" }));
    expect(h.replyCalls).toEqual([
      {
        threadId: CLUB_IDS.thread,
        body: "Zdanie do wysłania.",
        parentId: null,
        anonymous: false,
      },
    ]);
    expect(h.toastSuccess).toHaveBeenCalledWith("club.replyPosted");
  });

  it("udana wysyłka czyści pole i zdejmuje adresata", async () => {
    h.replies = page([replyRow({ id: "reply-a" })]);
    await mount();
    fireEvent.click(screen.getByText("club.reply"));
    typeReply("Odpowiedź w gałęzi.");
    fireEvent.click(screen.getByRole("button", { name: "club.postReply" }));
    expect(h.replyCalls[0].parentId).toBe("reply-a");
    expect(screen.queryByText("club.replyingTo")).toBeNull();
    expect(composerValue()).toBe("");
  });

  it("WŁASNA odpowiedź nie czeka w kolejce „pokaż nowe”, a cudza dalej czeka", async () => {
    // To jest sedno `accept` kontra `reveal`: przyjęcie własnego wpisu nie może
    // przy okazji wstawić cudzej treści pod kursor czytelnika.
    h.replies = page([replyRow({ id: "a", body: "Stary wpis." })]);
    await mount();
    h.replies = page([
      replyRow({ id: "a", body: "Stary wpis." }),
      replyRow({ id: "reply-new", body: "Mój świeży wpis." }),
      replyRow({ id: "obcy", body: "Cudzy świeży wpis." }),
    ]);
    typeReply("Mój świeży wpis.");
    expect(screen.getByTestId("new-replies").getAttribute("data-count")).toBe("2");

    fireEvent.click(screen.getByRole("button", { name: "club.postReply" }));
    const bodies = () =>
      screen.getAllByTestId("prose").map((node) => node.getAttribute("data-body"));
    expect(bodies()).toContain("Mój świeży wpis.");
    expect(bodies()).not.toContain("Cudzy świeży wpis.");
    expect(screen.getByTestId("new-replies").getAttribute("data-count")).toBe("1");
  });

  it("wpis w KOLEJCE moderacji zostawia komunikat, który nie znika z toastem", async () => {
    h.replyOutcome = { id: "reply-new", queued: true };
    await mount();
    typeReply("Zdanie do zatwierdzenia.");
    fireEvent.click(screen.getByRole("button", { name: "club.postReply" }));
    expect(h.toastSuccess).toHaveBeenCalledWith("club.replyQueued");
    expect(screen.getByText("club.replyQueuedHint")).toBeTruthy();
  });

  it("pisanie nowej odpowiedzi ZDEJMUJE komunikat o poprzedniej", async () => {
    h.replyOutcome = { id: "reply-new", queued: true };
    await mount();
    typeReply("Pierwsze zdanie.");
    fireEvent.click(screen.getByRole("button", { name: "club.postReply" }));
    expect(screen.getByText("club.replyQueuedHint")).toBeTruthy();
    typeReply("Drugie zdanie.");
    expect(screen.queryByText("club.replyQueuedHint")).toBeNull();
  });

  it("awaria wysyłki mówi o błędzie i ZOSTAWIA tekst w polu", async () => {
    h.replyFails = true;
    await mount();
    typeReply("Zdanie, które nie doszło.");
    fireEvent.click(screen.getByRole("button", { name: "club.postReply" }));
    expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed");
    expect(composerValue()).toBe("Zdanie, które nie doszło.");
  });

  it("wpis W DRODZE blokuje drugą wysyłkę i pokazuje treść, która leci", async () => {
    h.replyPending = true;
    h.replyVariables = { threadId: CLUB_IDS.thread, body: "Treść w drodze." };
    await mount();
    expect(screen.getByText("club.replySending")).toBeTruthy();
    expect(screen.getByText("Treść w drodze.")).toBeTruthy();
    typeReply("Cokolwiek");
    fireEvent.click(screen.getByRole("button", { name: "club.postReply" }));
    expect(h.replyCalls).toEqual([]);
  });

  it("bez zapamiętanych argumentów mutacji nie ma paska „w drodze” - nie ma czego pokazać", async () => {
    h.replyPending = true;
    h.replyVariables = undefined;
    await mount();
    expect(screen.queryByText("club.replySending")).toBeNull();
  });
});

describe("kompozytor - klawiatura", () => {
  it("Ctrl + Enter wysyła", async () => {
    await mount();
    typeReply("Zdanie z klawiatury.");
    fireEvent.keyDown(composerField(), { key: "Enter", ctrlKey: true });
    expect(h.replyCalls.length).toBe(1);
  });

  it("Cmd + Enter wysyła", async () => {
    await mount();
    typeReply("Zdanie z klawiatury.");
    fireEvent.keyDown(composerField(), { key: "Enter", metaKey: true });
    expect(h.replyCalls.length).toBe(1);
  });

  it("skrót klawiszowy NIE wysyła pustego wpisu - przycisk jest wyłączony, klawiatura nie", async () => {
    // Wyłączony przycisk nie chroni tej drogi: `onKeyDown` woła wysyłkę wprost,
    // więc warunek musi stać także w uchwycie.
    await mount();
    typeReply("   ");
    fireEvent.keyDown(composerField(), { key: "Enter", ctrlKey: true });
    expect(h.replyCalls).toEqual([]);
  });

  it("skrót klawiszowy nie wysyła drugi raz, gdy wpis jest w drodze", async () => {
    h.replyPending = true;
    h.replyVariables = { threadId: CLUB_IDS.thread, body: "Treść w drodze." };
    await mount();
    typeReply("Drugie zdanie.");
    fireEvent.keyDown(composerField(), { key: "Enter", ctrlKey: true });
    expect(h.replyCalls).toEqual([]);
  });

  it("goły Enter NIE wysyła - to pole deliberacji, nie okno czatu", async () => {
    await mount();
    typeReply("Zdanie w połowie");
    fireEvent.keyDown(composerField(), { key: "Enter" });
    expect(h.replyCalls).toEqual([]);
  });

  it("Escape zdejmuje adresata, ale NIE kasuje treści", async () => {
    h.replies = page([replyRow({ id: "reply-a" })]);
    await mount();
    fireEvent.click(screen.getByText("club.reply"));
    typeReply("Napisane zdanie.");
    fireEvent.keyDown(composerField(), { key: "Escape" });
    expect(screen.queryByText("club.replyingTo")).toBeNull();
    expect(composerValue()).toBe("Napisane zdanie.");
  });

  it("Escape bez adresata nie robi nic", async () => {
    await mount();
    typeReply("Napisane zdanie.");
    fireEvent.keyDown(composerField(), { key: "Escape" });
    expect(composerValue()).toBe("Napisane zdanie.");
    expect(h.replyCalls).toEqual([]);
  });

  it("kliknięcie „anuluj” też zdejmuje adresata", async () => {
    h.replies = page([replyRow({ id: "reply-a" })]);
    await mount();
    fireEvent.click(screen.getByText("club.reply"));
    fireEvent.click(screen.getByText("club.cancelReplyTo"));
    expect(screen.queryByText("club.replyingTo")).toBeNull();
  });
});

describe("kompozytor - anonimowość i licznik znaków", () => {
  it("przełącznik anonimowości stoi WYŁĄCZNIE w trybie `anonymous_allowed`", async () => {
    await mount();
    expect(screen.queryByLabelText("club.postAnonymously")).toBeNull();

    cleanup();
    h.thread = threadRow({ attribution_mode: "anonymous_allowed" });
    await mount();
    expect(screen.getByLabelText("club.postAnonymously")).toBeTruthy();
    expect(h.props.workspace.canGoAnonymous).toBe(true);
  });

  it("włączona anonimowość jedzie do RPC", async () => {
    h.thread = threadRow({ attribution_mode: "anonymous_allowed" });
    await mount();
    fireEvent.click(screen.getByLabelText("club.postAnonymously"));
    typeReply("Zdanie bez podpisu.");
    fireEvent.click(screen.getByRole("button", { name: "club.postReply" }));
    expect(h.replyCalls[0].anonymous).toBe(true);
  });

  it("wysyłka w toku gasi przełącznik anonimowości", async () => {
    h.thread = threadRow({ attribution_mode: "anonymous_allowed" });
    h.replyPending = true;
    await mount();
    expect(screen.getByLabelText("club.postAnonymously").hasAttribute("disabled")).toBe(true);
  });

  it("licznik znaków milczy przy krótkim tekście i odsłania się przy 70 % limitu", async () => {
    await mount();
    expect(screen.queryByText(/\/ 10000/)).toBeNull();
    expect(composerField().getAttribute("data-max")).toBe("10000");
    typeReply("a".repeat(7001));
    expect(screen.getByText("7001 / 10000")).toBeTruthy();
  });
});

// ===========================================================================
// 9. Wejście z „Komentuj” (`?reply=1`)
// ===========================================================================

describe("wejście z „Komentuj” - kursor ląduje w kompozytorze, widok zostaje na górze", () => {
  /**
   * Przewinięcie ZAMÓWIONE PRZEZ TRASĘ. Router ma własne przywracanie pozycji
   * i woła `scrollTo` z innym kształtem argumentu (`{ top, left }`), więc samo
   * „czy zawołano” nie odróżniłoby intencji trasy od pracy routera.
   */
  const TOP = { top: 0, behavior: "auto" };

  it("bez parametru nikt nie rusza ani widoku, ani fokusu", async () => {
    await mount();
    expect(h.scrollTo).not.toHaveBeenCalledWith(TOP);
    expect(document.activeElement).not.toBe(composerField());
  });

  it("intencja przewija na POCZĄTEK strony i daje fokus polu bez przewijania", async () => {
    // Czytelnik ma zacząć od kontekstu dyskusji, a nie od pola na dole - stąd
    // powrót na górę I fokus z `preventScroll`.
    await mount(`${ENTRY}?reply=true`);
    await waitFor(() => expect(document.activeElement).toBe(composerField()));
    expect(h.scrollTo).toHaveBeenCalledWith(TOP);
  });

  it("pole zbudowane jako `input` też dostaje fokus", async () => {
    h.fieldTag = "input";
    await mount(`${ENTRY}?reply=true`);
    await waitFor(() => expect(document.activeElement).toBe(composerField()));
  });

  it("pole BEZ identyfikatora nie wywala trasy - fokus po prostu nie ma gdzie wejść", async () => {
    h.fieldTag = "unidentified";
    await mount(`${ENTRY}?reply=true`);
    expect(document.activeElement).not.toBe(composerField());
    // Widok i tak wraca na górę - to część tej samej intencji.
    expect(h.scrollTo).toHaveBeenCalledWith(TOP);
  });

  it("bez kompozytora (brak prawa do odpowiedzi) nie ma czego ustawiać", async () => {
    h.thread = threadRow({ can_reply: false });
    await mount(`${ENTRY}?reply=true`);
    expect(h.scrollTo).not.toHaveBeenCalledWith(TOP);
  });

  it("brak wątku (404) nie próbuje ustawiać fokusu", async () => {
    h.thread = null;
    await mount(`${ENTRY}?reply=true`);
    expect(h.scrollTo).not.toHaveBeenCalledWith(TOP);
  });

  it("odświeżenie wątku NIE ustawia fokusu po raz drugi - kursor zostaje tam, gdzie czytelnik go zostawił", async () => {
    await mount(`${ENTRY}?reply=true`);
    await waitFor(() => expect(h.scrollTo).toHaveBeenCalledWith(TOP));
    h.scrollTo.mockClear();
    // Nowy obiekt wątku = odświeżone zapytanie po redakcji albo po reakcji.
    h.thread = threadRow({ reaction_count: 9 });
    typeReply("Piszę dalej.");
    expect(h.scrollTo).not.toHaveBeenCalledWith(TOP);
  });
});

// ===========================================================================
// 10. Język interfejsu
// ===========================================================================

describe("strona wątku - język interfejsu", () => {
  it("polski interfejs wybiera polską kolumnę nazwy klubu", async () => {
    await mount();
    expect(screen.getAllByRole("link")[0].textContent).toContain("Klub energetyczny");
    expect(h.props.workspace.lang).toBe("pl");
  });

  it("angielski interfejs wybiera angielską kolumnę i przekazuje język w dół", async () => {
    h.lang = "en";
    await mount();
    expect(screen.getAllByRole("link")[0].textContent).toContain("Energy club");
    expect(h.props.workspace.lang).toBe("en");
  });
});
