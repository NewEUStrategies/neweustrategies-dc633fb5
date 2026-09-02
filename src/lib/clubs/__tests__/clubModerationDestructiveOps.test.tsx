// Kluby - OPERACJE NISZCZĄCE: ukrycie i usunięcie wpisu, masowa moderacja,
// blokada członka, przeniesienie wątku, ujawnienie autora, redakcja cudzej
// treści. Plik siostrzany do `clubHooks.test.tsx`.
//
// PO CO OSOBNY PLIK, SKORO HOOKI MAJĄ JUŻ TESTY. `clubHooks.test.tsx` pyta
// o cztery rzeczy naraz dla siedemdziesięciu hooków: klucz cache'u, bramkę
// `enabled`, argumenty i skutek. To dobre pytania dla ODCZYTU. Dla operacji,
// która kasuje cudzą wypowiedź albo wyprasza człowieka z klubu, pytania są
// inne i żadne z nich nie padało:
//
//   1. KTO JEJ BRONI PRZED PRZYPADKIEM (potwierdzenie),
//   2. KTO JEJ BRONI PRZED NIEUPRAWNIONYM (rola),
//   3. CZY NIE PRZECHODZI PRZEZ GRANICĘ NAJEMCY,
//   4. CZY DA SIĘ JĄ COFNĄĆ,
//   5. CO ZOSTAJE NA EKRANIE, GDY BAZA ODMÓWI,
//   6. CO SIĘ ODŚWIEŻA PO UDANEJ OPERACJI.
//
// GDZIE TE WARUNKI NAPRAWDĘ MIESZKAJĄ - USTALENIE, NIE ZAŁOŻENIE.
// Zanim powstał ten plik, prześledziłem całą ścieżkę od kliknięcia do wiersza
// w bazie. Wyszło tak i tylko tak:
//
//   * POTWIERDZENIE: w ORGANIZMACH panelu (`ClubModerationTab`,
//     `ClubMembersTab`, `ClubThreadsTab`, `ClubGroupEditorDialog`) - każdy
//     trzyma `useState<ConfirmState>` i renderuje `<ConfirmDialog>`. Hook nie
//     wie o nim nic: `mutate` wywołane z hooka idzie do RPC natychmiast. To
//     jest właściwy podział (hook nie ma prawa rysować dialogu), ale znaczy,
//     że dowód „odmowa w dialogu nie woła mutacji" NIE MOŻE powstać w tej
//     warstwie. Tutaj jest dowód komplementarny: że hook jest gołą mutacją
//     (więc potwierdzenie MUSI stać wyżej) i że stoi tam, gdzie trzeba
//     - mierzone odczytem plików organizmów, techniką bramki
//     `src/routes/__tests__/adminRouteAuthority.gate.test.ts`.
//   * ROLA: NIE MA JEJ ANI W HOOKU, ANI W `api.ts`. Warstwa danych woła
//     `supabase.rpc(...)` bez jednego `if`-a o uprawnieniach. Autorytetem jest
//     funkcja SECURITY DEFINER w bazie: `club_moderate` liczy
//     `club_capabilities(club, group, uid).can_moderate`, a `admin_club_*`
//     wymaga `is_club_admin(uid)`. Test na atrapie klienta nie może tego
//     zmierzyć, więc mierzy to, co da się zmierzyć: że bramki nie ma w tej
//     warstwie i że jest w migracji.
//   * NAJEMCA: operacje dzielą się na DWIE KLASY i mają dwa różne dowody.
//     Operacje CZŁONKOWSKIE (blokada, masowa rola, usunięcie, kampania
//     segmentowa) niosą `club_id` w ładunku - i wtedy jest co sprawdzać
//     w hooku: identyfikator MUSI pochodzić z kontekstu hooka. Operacje
//     CELOWANE (moderacja, przeniesienie, ujawnienie autora) niosą wyłącznie
//     identyfikator celu; klub rozwiązuje RPC z tego identyfikatora. Hook
//     dostaje `clubId` WYŁĄCZNIE po to, żeby wiedzieć, co unieważnić.
//   * COFNIĘCIE: jest i ma osobne RPC (`admin_club_restore`), bo musi wiedzieć,
//     do jakiego statusu wracać. Blokada cofa się tą samą mutacją
//     z `banned: false`.
//   * BŁĄD: żaden hook tego modułu nie ma optymistycznej podmiany. Nie ma więc
//     czego wycofywać - i to jest kontrakt, a nie brak: `onSuccess` jest
//     jedynym miejscem, w którym cokolwiek się unieważnia, więc po odmowie
//     ekran zostaje przy danych sprzed akcji. Toast błędu rysuje organizm.
//
// CO JEST ATRAPOWANE I DLACZEGO. Wyłącznie warstwa danych (`@/lib/clubs/api`)
// i bramka wektorowa. Kontrakt RPC ma własne ~300 testów w `api.test.ts`;
// powtarzanie ich tutaj dałoby drugi zestaw asercji o tej samej rzeczy
// i przywiązałoby test hooka do kształtu argumentów, który hooka nie dotyczy.
// Klient zapytań jest PRAWDZIWY - inwalidacja jest tu przedmiotem dowodu,
// więc atrapa `QueryClient` mierzyłaby atrapę.
//
// GRANICA DOWODU. Ten plik nie dowodzi, że baza odrzuci moderatora bez
// uprawnień (to pgTAP: `supabase/tests/discussion_clubs_a5_a6_test.sql`) ani
// że dialog potwierdzenia renderuje się poprawnie (to testy organizmów
// w `src/components/admin/clubs/__tests__`). Dowodzi, że warstwa hooków
// przekazuje dokładnie to, co ma przekazać, nikogo nie przepuszcza obok
// warstwy danych i nie zostawia ekranu w stanie „zrobione" po odmowie.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/clubs/api", () => clubApiMock);
vi.mock("@/lib/clubs/clubSemantic.functions", () => ({
  CLUB_SEMANTIC_MIN_CHARS: 4,
  embedClubQuery: (...args: unknown[]) => clubApiMock.embedClubQuery(...args),
}));

import { clubApiMock, resetClubApiMock } from "@/test/clubs/apiMock";
import { clubKeys } from "@/lib/clubs/queryKeys";
import {
  clubModerationKeys,
  clubOnlyKeys,
  clubSettingsKeys,
} from "@/lib/clubs/clubInvalidations";
import { CLUB_MODERATION_ACTIONS } from "@/lib/clubs/types";
import type { ClubSegmentRule } from "@/lib/clubs/types";
import {
  useAdminClubReplies,
  useAdminClubThreads,
  useAdminCreateReply,
  useAdminCreateThread,
  useBanClubMember,
  useBulkModerateClub,
  useBulkSetClubMemberRole,
  useClubAnchorSuggestions,
  useClubModerationLog,
  useClubModerationQueue,
  useClubPendingCounts,
  useClubSearch,
  useClubThreadsForAnchor,
  useModerateClubTarget,
  useMoveClubThread,
  useReportClubContent,
  useRevealClubAuthor,
} from "@/lib/clubs/useClubModeration";
import {
  useAdminClub,
  useAdminClubGroups,
  useAdminClubs,
  useAdminClubStats,
  useClubCapabilitiesPreview,
  useClubSegmentPreview,
  useInviteClubSegment,
  useModeratorEditReply,
  useModeratorEditThread,
} from "@/lib/clubs/useClubAdmin";

const CLUB = "club-1";
const OTHER_CLUB = "club-2";
const THREAD = "thread-1";
const REPLY = "reply-1";

const MODERATION_HOOKS_SRC = readFileSync("src/lib/clubs/useClubModeration.ts", "utf8");
const ADMIN_HOOKS_SRC = readFileSync("src/lib/clubs/useClubAdmin.ts", "utf8");
const API_SRC = readFileSync("src/lib/clubs/api.ts", "utf8");
const A5_SQL = readFileSync(
  "supabase/migrations/20260808095000_discussion_clubs_a5_moderation.sql",
  "utf8",
);
const A7_SQL = readFileSync(
  "supabase/migrations/20260808100000_discussion_clubs_a7_admin_coordination.sql",
  "utf8",
);

/**
 * Klient zapytań per test - ten sam kształt, co w `clubHooks.test.tsx`: bez
 * ponowień (test nie czeka na backoff) i ze szpiegiem na `invalidateQueries`,
 * bo dla mutacji tego modułu to JEDYNY obserwowalny skutek.
 */
function harness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidated: unknown[] = [];
  const original = queryClient.invalidateQueries.bind(queryClient);
  queryClient.invalidateQueries = (filters?: { queryKey?: unknown }) => {
    invalidated.push(filters?.queryKey);
    return original(filters as Parameters<typeof original>[0]);
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper, invalidated };
}

/** Czy szpieg zobaczył DOKŁADNIE ten zestaw kluczy (w dowolnej kolejności). */
function sawKeys(invalidated: unknown[], expected: readonly unknown[]): boolean {
  const seen = invalidated.map((k) => JSON.stringify(k)).sort();
  const want = expected.map((k) => JSON.stringify(k)).sort();
  return JSON.stringify(seen) === JSON.stringify(want);
}

/** Czy `key` jest potomkiem (albo równy) `prefix` - czyli czy inwalidacja
 *  prefiksu FAKTYCZNIE go dosięga. */
function isUnder(key: readonly unknown[], prefix: readonly unknown[]): boolean {
  return prefix.every((segment, i) => JSON.stringify(key[i]) === JSON.stringify(segment));
}

/**
 * Pierwszy argument n-tego wywołania atrapy, jako `unknown` - bez rzutowań.
 *
 * POTRZEBNY, BO REACT QUERY DOKŁADA DRUGI ARGUMENT. Hooki, których
 * `mutationFn` jest REFERENCJĄ do funkcji warstwy danych (`mutationFn:
 * moderateClubTarget`), dostają od biblioteki `(variables, context)` - więc
 * `toHaveBeenCalledWith(vars)` oblewa się na kontekście, który nie jest
 * przedmiotem dowodu. Hooki z domknięciem (`(vars) => banClubMember({clubId,
 * ...vars})`) dostają jeden argument i tam zwykłe `toHaveBeenCalledWith`
 * wystarcza. Ta różnica jest prawdziwa i celowo widoczna w teście.
 */
function callArg(spy: { mock: { calls: unknown[][] } }, index = 0): unknown {
  return spy.mock.calls[index][0];
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => resetClubApiMock());

// ---------------------------------------------------------------------------
// 1. Potwierdzenie
// ---------------------------------------------------------------------------

describe("potwierdzenie operacji niszczącej - warstwa, która je niesie", () => {
  it("hook jest GOŁĄ mutacją: pierwsze `mutate` idzie prosto do warstwy danych", async () => {
    const { wrapper } = harness();
    clubApiMock.moderateClubTarget.mockResolvedValue(true);

    const { result } = renderHook(() => useModerateClubTarget(CLUB), { wrapper });
    await result.current.mutateAsync({
      targetType: "thread",
      targetId: THREAD,
      action: "delete",
    });

    // Nie ma tu żadnego etapu pośredniego. To NIE jest zarzut wobec hooka -
    // to dowód, że potwierdzenie musi stać wyżej, i uzasadnienie asercji niżej.
    expect(clubApiMock.moderateClubTarget).toHaveBeenCalledTimes(1);
  });

  it("moduły hooków nie zawierają dialogu ani `window.confirm`", () => {
    for (const src of [MODERATION_HOOKS_SRC, ADMIN_HOOKS_SRC]) {
      expect(src).not.toMatch(/confirm/i);
      expect(src).not.toMatch(/AlertDialog|ConfirmDialog/);
    }
  });

  it("każda nieodwracalna akcja panelu jest owinięta `ConfirmDialog` w organizmie", () => {
    // Odczyt plików, nie render: organizmy mają własne testy
    // (`src/components/admin/clubs/__tests__`), a przedmiotem dowodu jest tu
    // SAM FAKT, że warstwa potwierdzenia istnieje i obejmuje te operacje.
    const moderationTab = readFileSync(
      "src/components/admin/clubs/organisms/ClubModerationTab.tsx",
      "utf8",
    );
    // Usunięcie pojedyncze i masowe - oba przez stan potwierdzenia.
    expect(moderationTab).toMatch(/onDelete=\{\(\) =>\s*setConfirm\(\{/);
    expect(moderationTab).toMatch(/onConfirm: \(\) => act\(item, "delete"\)/);
    expect(moderationTab).toMatch(/bulkDeleteTitle/);
    expect(moderationTab).toMatch(/<ConfirmDialog/);

    const membersTab = readFileSync(
      "src/components/admin/clubs/organisms/ClubMembersTab.tsx",
      "utf8",
    );
    expect(membersTab).toMatch(/const confirmRemove = /);
    expect(membersTab).toMatch(/<ConfirmDialog/);

    const threadsTab = readFileSync(
      "src/components/admin/clubs/organisms/ClubThreadsTab.tsx",
      "utf8",
    );
    expect(threadsTab).toMatch(/<ConfirmDialog/);

    const groupDialog = readFileSync(
      "src/components/admin/clubs/organisms/ClubGroupEditorDialog.tsx",
      "utf8",
    );
    expect(groupDialog).toMatch(/<ConfirmDialog/);
  });

  it("UKRYCIE świadomie NIE ma potwierdzenia - jest odwracalne, więc dialog byłby szumem", () => {
    const moderationTab = readFileSync(
      "src/components/admin/clubs/organisms/ClubModerationTab.tsx",
      "utf8",
    );
    // Kontrola dodatnia dla asercji wyżej: gdyby `setConfirm` obejmowało
    // wszystko, poprzedni test przechodziłby bez treści. Ukrycie idzie WPROST.
    expect(moderationTab).toMatch(/onHide=\{\(\) => act\(item, "hide"\)\}/);
    expect(moderationTab).toMatch(/onApprove=\{\(\) => act\(item, "approve"\)\}/);
  });
});

// ---------------------------------------------------------------------------
// 2. Rola
// ---------------------------------------------------------------------------

describe("autorytet: kto może wykonać operację niszczącą", () => {
  it("warunku roli NIE MA w hookach - nie ma tu czego testować renderem", () => {
    for (const src of [MODERATION_HOOKS_SRC, ADMIN_HOOKS_SRC]) {
      expect(src).not.toMatch(/isStaff|isSuperAdmin|useAuth|can_moderate|hasRole/);
    }
  });

  it("warstwa danych też go nie ma: moderacja to samo `supabase.rpc`", () => {
    // Świadome NEGATYWNE ustalenie. Gdyby `moderateClubTarget` była funkcją
    // serwerową (`createServerFn`), dowodem uprawnień byłoby `serverFnMeta`
    // z `@/test/serverFn`. Nie jest - jedyną barierą jest RPC i RLS.
    expect(API_SRC).toMatch(/supabase\.rpc\("club_moderate"/);
    expect(API_SRC).toMatch(/supabase\.rpc\("admin_club_bulk_moderate"/);
    expect(API_SRC).not.toMatch(/createServerFn/);
  });

  it("autorytet POJEDYNCZEJ akcji to `club_capabilities(...).can_moderate`", () => {
    expect(A5_SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.club_moderate\(/);
    expect(A5_SQL).toMatch(/SECURITY DEFINER/);
    expect(A5_SQL).toMatch(/FROM public\.club_capabilities\(v_club, v_group, v_uid\)/);
    expect(A5_SQL).toMatch(/IF NOT COALESCE\(v_caps\.can_moderate, false\) THEN/);
    expect(A5_SQL).toMatch(/clubs: forbidden/);
  });

  it("akcja MASOWA ma INNĄ, mocniejszą bramkę niż pojedyncza (`is_club_admin`)", () => {
    // To nie jest kosmetyka, tylko zapis realnej asymetrii: prowadzący klubu
    // z `can_moderate` ukryje pięćdziesiąt wpisów po jednym, a jedną akcją
    // masową dostanie `forbidden`. Asercja istnieje po to, żeby zmiana tej
    // reguły w bazie nie przeszła niezauważona w warstwie klienta, która
    // rysuje OBA przyciski tak samo.
    expect(A7_SQL).toMatch(
      /FUNCTION public\.admin_club_bulk_moderate\([\s\S]{0,900}?IF NOT public\.is_club_admin\(v_uid\) THEN/,
    );
    expect(A7_SQL).toMatch(
      /FUNCTION public\.admin_club_bulk_member_role\([\s\S]{0,900}?IF NOT public\.is_club_admin\(v_uid\) THEN/,
    );
  });

  it("panel, z którego te operacje wychodzą, stoi za bramką layoutu `/admin`", () => {
    const layout = readFileSync("src/routes/admin.tsx", "utf8");
    expect(layout).toMatch(/isStaff/);
    expect(layout).toMatch(/navigate\(\{\s*to:\s*"\/login"\s*\}\)/);
    expect(layout).toMatch(/if \(!session \|\| !isStaff\) return null;/);
  });
});

// ---------------------------------------------------------------------------
// 3. Granica najemcy
// ---------------------------------------------------------------------------

describe("granica najemcy - operacje CZŁONKOWSKIE niosą id klubu", () => {
  it("blokada członka niesie id klubu Z KONTEKSTU hooka, nie z wywołania", async () => {
    const { wrapper } = harness();
    clubApiMock.banClubMember.mockResolvedValue(true);

    const { result } = renderHook(() => useBanClubMember(CLUB), { wrapper });
    await result.current.mutateAsync({ userId: "u1", banned: true, reason: "spam" });

    expect(clubApiMock.banClubMember).toHaveBeenCalledWith({
      clubId: CLUB,
      userId: "u1",
      banned: true,
      reason: "spam",
    });
  });

  it("dwie instancje hooka dla dwóch klubów NIE mieszają najemców", async () => {
    const { wrapper } = harness();
    clubApiMock.banClubMember.mockResolvedValue(true);

    const a = renderHook(() => useBanClubMember(CLUB), { wrapper });
    const b = renderHook(() => useBanClubMember(OTHER_CLUB), { wrapper });
    await a.result.current.mutateAsync({ userId: "u1", banned: true });
    await b.result.current.mutateAsync({ userId: "u1", banned: true });

    // Ten sam człowiek, dwa kluby - i dwa RÓŻNE ładunki. Gdyby id klubu
    // pochodziło z wywołania, a nie z domknięcia, oba byłyby identyczne.
    expect(clubApiMock.banClubMember).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ clubId: CLUB }),
    );
    expect(clubApiMock.banClubMember).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ clubId: OTHER_CLUB }),
    );
  });

  it("masowa zmiana roli niesie id klubu i pełną listę osób", async () => {
    const { wrapper } = harness();
    clubApiMock.bulkSetClubMemberRole.mockResolvedValue(3);

    const { result } = renderHook(() => useBulkSetClubMemberRole(CLUB), { wrapper });
    await result.current.mutateAsync({ userIds: ["u1", "u2", "u3"], role: "observer" });

    expect(clubApiMock.bulkSetClubMemberRole).toHaveBeenCalledWith({
      clubId: CLUB,
      userIds: ["u1", "u2", "u3"],
      role: "observer",
    });
  });

  it("kampania segmentowa niesie id klubu (wysyłka do cudzego segmentu byłaby wyciekiem)", async () => {
    const { wrapper } = harness();
    clubApiMock.inviteClubSegment.mockResolvedValue(7);
    const rule: ClubSegmentRule = { kind: "badge", badge: "ekspert" };

    const { result } = renderHook(() => useInviteClubSegment(CLUB), { wrapper });
    await result.current.mutateAsync({ rule, role: "member", message: "Zapraszamy" });

    expect(clubApiMock.inviteClubSegment).toHaveBeenCalledWith({
      clubId: CLUB,
      rule,
      role: "member",
      message: "Zapraszamy",
    });
  });

  it("RPC członkowskie dokłada WŁASNY filtr najemcy - klient nie jest jedyną barierą", () => {
    expect(A7_SQL).toMatch(/c\.tenant_id = v_tenant/);
  });
});

describe("granica najemcy - operacje CELOWANE nie niosą id klubu", () => {
  it("moderacja pojedyncza wysyła WYŁĄCZNIE cel - id klubu zostaje po stronie cache'u", async () => {
    const { wrapper } = harness();
    clubApiMock.moderateClubTarget.mockResolvedValue(true);

    const { result } = renderHook(() => useModerateClubTarget(CLUB), { wrapper });
    await result.current.mutateAsync({ targetType: "reply", targetId: REPLY, action: "hide" });

    const payload = callArg(clubApiMock.moderateClubTarget);
    expect(payload).toEqual({ targetType: "reply", targetId: REPLY, action: "hide" });
    expect(JSON.stringify(payload)).not.toContain(CLUB);
  });

  it("masowa moderacja, przeniesienie i ujawnienie autora tak samo", async () => {
    const { wrapper } = harness();
    clubApiMock.bulkModerateClubTargets.mockResolvedValue(2);
    clubApiMock.moveClubThread.mockResolvedValue(true);
    clubApiMock.revealClubAuthor.mockResolvedValue({
      authorId: "u9",
      displayName: "Osoba Testowa",
      profileSlug: null,
    });

    const bulk = renderHook(() => useBulkModerateClub(CLUB), { wrapper });
    await bulk.result.current.mutateAsync({
      targetType: "thread",
      targetIds: [THREAD, "thread-2"],
      action: "delete",
    });
    const move = renderHook(() => useMoveClubThread(CLUB), { wrapper });
    await move.result.current.mutateAsync({ threadId: THREAD, groupId: "group-9" });
    const reveal = renderHook(() => useRevealClubAuthor(), { wrapper });
    await reveal.result.current.mutateAsync({
      targetType: "reply",
      targetId: REPLY,
      reason: "Podejrzenie podszywania sie",
    });

    expect(callArg(clubApiMock.bulkModerateClubTargets)).toEqual({
      targetType: "thread",
      targetIds: [THREAD, "thread-2"],
      action: "delete",
    });
    expect(callArg(clubApiMock.moveClubThread)).toEqual({
      threadId: THREAD,
      groupId: "group-9",
    });
    expect(callArg(clubApiMock.revealClubAuthor)).toEqual({
      targetType: "reply",
      targetId: REPLY,
      reason: "Podejrzenie podszywania sie",
    });
    for (const spy of [
      clubApiMock.bulkModerateClubTargets,
      clubApiMock.moveClubThread,
      clubApiMock.revealClubAuthor,
    ]) {
      expect(JSON.stringify(callArg(spy))).not.toContain(CLUB);
    }
  });

  it("klub celu rozwiązuje RPC z identyfikatora celu - i dopiero tam pyta o uprawnienie", () => {
    // To jest ODPOWIEDŹ na pytanie „czy operacja nie przekracza granicy
    // najemcy". W tej klasie operacji odpowiedź NIE MOŻE paść w kliencie:
    // klient nie podaje klubu, więc nie ma czego podmienić. Klub wynika
    // z wiersza celu, a uprawnienie liczy się DLA TEGO klubu.
    expect(A5_SQL).toMatch(
      /SELECT club_id, group_id INTO v_club, v_group FROM public\.club_threads WHERE id = p_target_id;/,
    );
    expect(A5_SQL).toMatch(/FROM public\.club_replies r JOIN public\.club_threads t/);
    expect(A5_SQL).toMatch(/IF v_club IS NULL THEN[\s\S]{0,120}clubs: not found/);
  });

  it("hook NIE MA gałęzi omijającej warstwę danych - każda akcja idzie jedną drogą", async () => {
    const { wrapper } = harness();
    clubApiMock.moderateClubTarget.mockResolvedValue(true);

    const { result } = renderHook(() => useModerateClubTarget(CLUB), { wrapper });
    for (const action of CLUB_MODERATION_ACTIONS) {
      await result.current.mutateAsync({ targetType: "thread", targetId: THREAD, action });
    }

    // Osiem akcji, osiem wywołań, ładunek 1:1. Gdyby którakolwiek miała
    // skrót (np. „ukrycie robimy lokalnie"), licznik by się nie zgadzał.
    expect(clubApiMock.moderateClubTarget).toHaveBeenCalledTimes(CLUB_MODERATION_ACTIONS.length);
    CLUB_MODERATION_ACTIONS.forEach((action, index) => {
      expect(callArg(clubApiMock.moderateClubTarget, index)).toEqual({
        targetType: "thread",
        targetId: THREAD,
        action,
      });
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Cofnięcie
// ---------------------------------------------------------------------------

describe("cofnięcie tam, gdzie jest przewidziane", () => {
  it("`restore` przechodzi tym samym hookiem, co usunięcie", async () => {
    const { wrapper } = harness();
    clubApiMock.moderateClubTarget.mockResolvedValue(true);

    const { result } = renderHook(() => useModerateClubTarget(CLUB), { wrapper });
    await result.current.mutateAsync({
      targetType: "thread",
      targetId: THREAD,
      action: "delete",
      reason: "Naruszenie zasad",
    });
    await result.current.mutateAsync({
      targetType: "thread",
      targetId: THREAD,
      action: "restore",
      reason: "Odwolanie uwzglednione",
    });

    expect(callArg(clubApiMock.moderateClubTarget, 1)).toEqual({
      targetType: "thread",
      targetId: THREAD,
      action: "restore",
      reason: "Odwolanie uwzglednione",
    });
  });

  it("przywrócenie ma OSOBNE RPC, bo musi wiedzieć, do jakiego statusu wraca", () => {
    expect(API_SRC).toMatch(/if \(params\.action === "restore"\)/);
    expect(API_SRC).toMatch(/supabase\.rpc\("admin_club_restore"/);
    // Kontrola dodatnia: `club_moderate` przywrócenia NIE zna, więc gdyby
    // gałąź wyżej zniknęła, panel dostawałby „invalid moderation action".
    expect(A5_SQL).toMatch(
      /IF p_action NOT IN \('approve','hide','delete','lock','unlock','pin','unpin'\) THEN/,
    );
  });

  it("masowe przywrócenie idzie tą samą drogą co masowe usunięcie", async () => {
    const { wrapper } = harness();
    clubApiMock.bulkModerateClubTargets.mockResolvedValue(2);

    const { result } = renderHook(() => useBulkModerateClub(CLUB), { wrapper });
    await result.current.mutateAsync({
      targetType: "reply",
      targetIds: [REPLY, "reply-2"],
      action: "restore",
    });

    expect(callArg(clubApiMock.bulkModerateClubTargets)).toEqual({
      targetType: "reply",
      targetIds: [REPLY, "reply-2"],
      action: "restore",
    });
    // Partia rozdziela przywrócenie od reszty PO STRONIE BAZY.
    expect(A7_SQL).toMatch(
      /IF p_action = 'restore' THEN[\s\S]{0,160}PERFORM public\.admin_club_restore/,
    );
  });

  it("blokada członka cofa się tą samą mutacją z `banned: false`", async () => {
    const { wrapper } = harness();
    clubApiMock.banClubMember.mockResolvedValue(true);

    const { result } = renderHook(() => useBanClubMember(CLUB), { wrapper });
    await result.current.mutateAsync({ userId: "u1", banned: true, reason: "Spam w watkach" });
    await result.current.mutateAsync({ userId: "u1", banned: false, reason: null });

    expect(clubApiMock.banClubMember).toHaveBeenNthCalledWith(2, {
      clubId: CLUB,
      userId: "u1",
      banned: false,
      reason: null,
    });
  });

  it("USUNIĘCIE CZŁONKA cofnięcia nie ma - i to jest kontrakt, nie przeoczenie", () => {
    // `useRemoveClubMember` kasuje wiersz członkostwa; powrót to ponowne
    // zaproszenie, czyli INNA operacja. Zapisuję to jako ustalenie, żeby
    // nikt nie szukał tu „undo", którego z definicji nie ma.
    expect(ADMIN_HOOKS_SRC).toMatch(/mutationFn: \(userId\) => removeClubMember\(clubId, userId\)/);
    expect(ADMIN_HOOKS_SRC).not.toMatch(/restoreClubMember|unremoveClubMember/);
  });
});

// ---------------------------------------------------------------------------
// 5. Błąd serwera
// ---------------------------------------------------------------------------

describe("odmowa bazy nie zostawia ekranu w stanie „zrobione\"", () => {
  it("moduł NIE MA optymistycznej podmiany - nie ma więc czego wycofywać", () => {
    for (const src of [MODERATION_HOOKS_SRC, ADMIN_HOOKS_SRC]) {
      expect(src).not.toMatch(/onMutate|setQueryData|cancelQueries/);
    }
    // Kontrola dodatnia dla tej negacji: w SĄSIEDNIM module optymizm JEST,
    // więc powyższy grep rzeczywiście coś rozróżnia, a nie zawsze przechodzi.
    const reactions = readFileSync("src/lib/clubs/useClubReactions.ts", "utf8");
    expect(reactions).toMatch(/onMutate/);
    expect(reactions).toMatch(/setQueryData/);
  });

  it("odmowa moderacji NIE unieważnia niczego - kolejka zostaje przy swoich danych", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.moderateClubTarget.mockRejectedValue(new Error("clubs: forbidden"));

    const { result } = renderHook(() => useModerateClubTarget(CLUB), { wrapper });
    await expect(
      result.current.mutateAsync({ targetType: "thread", targetId: THREAD, action: "delete" }),
    ).rejects.toThrow("clubs: forbidden");

    // Inwalidacja wisi WYŁĄCZNIE w `onSuccess`. Gdyby siedziała w `onSettled`,
    // odmowa kasowałaby ekran i moderator zobaczyłby przeładowaną listę
    // wyglądającą jak potwierdzenie akcji, której baza nie przyjęła.
    expect(invalidated).toEqual([]);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isSuccess).toBe(false);
  });

  it("odmowa masowej moderacji zachowuje się identycznie", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.bulkModerateClubTargets.mockRejectedValue(new Error("clubs: bulk limit is 200"));

    const { result } = renderHook(() => useBulkModerateClub(CLUB), { wrapper });
    await expect(
      result.current.mutateAsync({ targetType: "thread", targetIds: [THREAD], action: "delete" }),
    ).rejects.toThrow(/bulk limit/);

    expect(invalidated).toEqual([]);
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("odmowa blokady członka nie odświeża listy członków", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.banClubMember.mockRejectedValue(new Error("clubs: forbidden"));

    const { result } = renderHook(() => useBanClubMember(CLUB), { wrapper });
    await expect(
      result.current.mutateAsync({ userId: "u1", banned: true }),
    ).rejects.toThrow("clubs: forbidden");

    expect(invalidated).toEqual([]);
  });

  it("po odmowie operacja jest POWTARZALNA - drugie podejście znów woła bazę", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.moderateClubTarget
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(true);

    const { result } = renderHook(() => useModerateClubTarget(CLUB), { wrapper });
    await expect(
      result.current.mutateAsync({ targetType: "thread", targetId: THREAD, action: "hide" }),
    ).rejects.toThrow("network");
    await result.current.mutateAsync({ targetType: "thread", targetId: THREAD, action: "hide" });

    expect(clubApiMock.moderateClubTarget).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(sawKeys(invalidated, clubModerationKeys(CLUB))).toBe(true));
  });

  it("toast błędu rysuje ORGANIZM, nie hook - tam jest `onError`", () => {
    const moderationTab = readFileSync(
      "src/components/admin/clubs/organisms/ClubModerationTab.tsx",
      "utf8",
    );
    expect(moderationTab).toMatch(/onError: \(\) => toast\.error\(t\("adminClubs\.saveFailed"\)\)/);
    for (const src of [MODERATION_HOOKS_SRC, ADMIN_HOOKS_SRC]) {
      expect(src).not.toMatch(/onError|toast/);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Inwalidacje
// ---------------------------------------------------------------------------

describe("inwalidacje - zgodność z katalogiem `clubInvalidations`", () => {
  it("moderacja pojedyncza i masowa sięgają po TEN SAM skutek", async () => {
    const { wrapper: w1, invalidated: i1 } = harness();
    clubApiMock.moderateClubTarget.mockResolvedValue(true);
    const single = renderHook(() => useModerateClubTarget(CLUB), { wrapper: w1 });
    await single.result.current.mutateAsync({
      targetType: "thread",
      targetId: THREAD,
      action: "hide",
    });
    await waitFor(() => expect(sawKeys(i1, clubModerationKeys(CLUB))).toBe(true));

    const { wrapper: w2, invalidated: i2 } = harness();
    clubApiMock.bulkModerateClubTargets.mockResolvedValue(30);
    const bulk = renderHook(() => useBulkModerateClub(CLUB), { wrapper: w2 });
    await bulk.result.current.mutateAsync({
      targetType: "thread",
      targetIds: [THREAD],
      action: "hide",
    });

    // To jest regresja opisana w nagłówku hooka: wcześniej partia czyściła sam
    // korzeń klubu, a odpowiedzi panelu i licznik plakietki wiszą wyżej.
    await waitFor(() => expect(sawKeys(i2, clubModerationKeys(CLUB))).toBe(true));
  });

  it("redakcja moderatorska wątku i odpowiedzi idzie od KORZENIA modułu", async () => {
    // Dwa osobne klienty, bo `sawKeys` mierzy zestaw DOKŁADNY: wspólny szpieg
    // zobaczyłby dwa korzenie i nie odróżnił „każda z tych mutacji unieważnia
    // korzeń" od „jedna unieważnia dwa razy".
    const first = harness();
    const { wrapper, invalidated } = first;
    clubApiMock.editClubThread.mockResolvedValue(true);
    clubApiMock.editClubReply.mockResolvedValue(true);

    const thread = renderHook(() => useModeratorEditThread(CLUB), { wrapper });
    await thread.result.current.mutateAsync({
      threadId: THREAD,
      title: "Poprawiony tytul",
      reason: "Mowa nienawisci w tytule",
    });
    expect(callArg(clubApiMock.editClubThread)).toEqual({
      threadId: THREAD,
      title: "Poprawiony tytul",
      reason: "Mowa nienawisci w tytule",
    });

    await waitFor(() => expect(sawKeys(invalidated, clubModerationKeys(CLUB))).toBe(true));

    const second = harness();
    const reply = renderHook(() => useModeratorEditReply(CLUB), { wrapper: second.wrapper });
    await reply.result.current.mutateAsync({
      replyId: REPLY,
      body: "Tresc po redakcji",
      reason: "Dane osobowe",
    });
    expect(callArg(clubApiMock.editClubReply)).toEqual({
      replyId: REPLY,
      body: "Tresc po redakcji",
      reason: "Dane osobowe",
    });

    await waitFor(() =>
      expect(sawKeys(second.invalidated, clubModerationKeys(CLUB))).toBe(true),
    );
  });

  it("blokada, masowa rola, przeniesienie i wątek z panelu ruszają SAM klub", async () => {
    for (const scenario of [
      async (w: ReturnType<typeof harness>) => {
        clubApiMock.banClubMember.mockResolvedValue(true);
        const h = renderHook(() => useBanClubMember(CLUB), { wrapper: w.wrapper });
        await h.result.current.mutateAsync({ userId: "u1", banned: true });
      },
      async (w: ReturnType<typeof harness>) => {
        clubApiMock.bulkSetClubMemberRole.mockResolvedValue(2);
        const h = renderHook(() => useBulkSetClubMemberRole(CLUB), { wrapper: w.wrapper });
        await h.result.current.mutateAsync({ userIds: ["u1"], role: "member" });
      },
      async (w: ReturnType<typeof harness>) => {
        clubApiMock.moveClubThread.mockResolvedValue(true);
        const h = renderHook(() => useMoveClubThread(CLUB), { wrapper: w.wrapper });
        await h.result.current.mutateAsync({ threadId: THREAD, groupId: "g2" });
      },
      async (w: ReturnType<typeof harness>) => {
        clubApiMock.adminCreateClubThread.mockResolvedValue({
          threadId: THREAD,
          threadSlug: "temat",
        });
        const h = renderHook(() => useAdminCreateThread(CLUB), { wrapper: w.wrapper });
        await h.result.current.mutateAsync({ groupId: "g1", title: "T", body: "B" });
      },
    ]) {
      const w = harness();
      await scenario(w);
      await waitFor(() => expect(sawKeys(w.invalidated, clubOnlyKeys(CLUB))).toBe(true));
    }
  });

  it("odpowiedź z panelu unieważnia KORZEŃ, bo `adminReplies` wisi poza klubem", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.adminCreateClubReply.mockResolvedValue(REPLY);

    const { result } = renderHook(() => useAdminCreateReply(CLUB), { wrapper });
    await result.current.mutateAsync({ threadId: THREAD, body: "Odpowiedz redakcji" });

    await waitFor(() => expect(sawKeys(invalidated, clubModerationKeys(CLUB))).toBe(true));
  });

  it("kampania segmentowa unieważnia ustawienia klubu I listę panelu", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.inviteClubSegment.mockResolvedValue(12);

    const { result } = renderHook(() => useInviteClubSegment(CLUB), { wrapper });
    await result.current.mutateAsync({ rule: { kind: "badge", badge: "x" }, role: "member" });

    await waitFor(() => expect(sawKeys(invalidated, clubSettingsKeys(CLUB))).toBe(true));
  });

  it("zgłoszenie i ujawnienie autora NIE unieważniają nic - i tak ma być", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.reportClubContent.mockResolvedValue("report-1");
    clubApiMock.revealClubAuthor.mockResolvedValue(null);

    const report = renderHook(() => useReportClubContent(), { wrapper });
    await report.result.current.mutateAsync({
      targetType: "reply",
      targetId: REPLY,
      reason: "harassment",
      details: "Osobiste wycieczki",
    });
    const reveal = renderHook(() => useRevealClubAuthor(), { wrapper });
    await reveal.result.current.mutateAsync({
      targetType: "thread",
      targetId: THREAD,
      reason: "Wniosek prawny",
    });

    expect(callArg(clubApiMock.reportClubContent)).toEqual({
      targetType: "reply",
      targetId: REPLY,
      reason: "harassment",
      details: "Osobiste wycieczki",
    });
    // Zgłoszenie nie jest akcją PUBLICZNĄ: dla zgłaszającego nic się nie
    // zmienia. Ujawnienie autora niczego nie zmienia w danych - jest odczytem
    // audytowanym, dlatego jest mutacją, a nie zapytaniem.
    await flush();
    expect(invalidated).toEqual([]);
  });

  it("unieważniany prefiks FAKTYCZNIE dosięga kolejki, dziennika i listy panelu", () => {
    // Dowód ZGODNOŚCI, nie powtórka testów `clubInvalidations.test.ts`: tam
    // sprawdza się, jakie klucze zwraca skutek; tutaj - że widoki, które
    // moderator ma na ekranie, leżą pod tymi kluczami. Bez tego zestaw kluczy
    // może być „poprawny" i nie odświeżać niczego.
    const root = clubModerationKeys(CLUB)[0];
    for (const view of [
      clubKeys.moderationQueue(CLUB),
      clubKeys.moderationLog(CLUB),
      clubKeys.adminThreads(CLUB, null, null, null, "", 0),
      clubKeys.adminReplies(THREAD),
      clubKeys.pendingCounts(),
      clubKeys.searchAll(),
    ]) {
      expect(isUnder(view, root)).toBe(true);
    }

    const clubOnly = clubOnlyKeys(CLUB)[0];
    // Sam klub wystarcza dla listy członków i tematów...
    expect(isUnder(clubKeys.members(CLUB, null, 0, 25), clubOnly)).toBe(true);
    expect(isUnder(clubKeys.adminThreads(CLUB, null, null, null, "", 0), clubOnly)).toBe(true);
    // ...ale NIE dla odpowiedzi panelu ani wyszukiwarki. Dlatego redakcja
    // moderatorska ma szerszy skutek niż blokada członka.
    expect(isUnder(clubKeys.adminReplies(THREAD), clubOnly)).toBe(false);
    expect(isUnder(clubKeys.searchAll(), clubOnly)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Odczyty, które karmią moderację
// ---------------------------------------------------------------------------

describe("odczyty pulpitu moderacji", () => {
  it("kolejka i dziennik pytają o WSKAZANY klub", async () => {
    const { wrapper } = harness();
    clubApiMock.fetchClubModerationQueue.mockResolvedValue({ rows: [], total: 0 });
    clubApiMock.fetchClubModerationLog.mockResolvedValue([]);

    const queue = renderHook(() => useClubModerationQueue(CLUB), { wrapper });
    const log = renderHook(() => useClubModerationLog(CLUB), { wrapper });

    await waitFor(() => expect(queue.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(log.result.current.isSuccess).toBe(true));
    expect(clubApiMock.fetchClubModerationQueue).toHaveBeenCalledWith({ clubId: CLUB });
    expect(clubApiMock.fetchClubModerationLog).toHaveBeenCalledWith({ clubId: CLUB });
  });

  it("lista tematów panelu bez filtrów wysyła JAWNE puste wartości, nie `undefined`", async () => {
    const { wrapper } = harness();
    clubApiMock.fetchAdminClubThreads.mockResolvedValue({ rows: [], total: 0 });

    const { result } = renderHook(() => useAdminClubThreads(CLUB, {}), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // `undefined` w ładunku RPC znaczy „użyj domyślnej", a `null` znaczy
    // „wszystkie" - to dwie różne odpowiedzi i hook musi wybrać jedną.
    expect(clubApiMock.fetchAdminClubThreads).toHaveBeenCalledWith({
      clubId: CLUB,
      groupId: null,
      status: null,
      kind: null,
      search: "",
      offset: 0,
    });
  });

  it("filtry i strona listy tematów są CZĘŚCIĄ klucza - inaczej strona 2 czyta stronę 1", async () => {
    const { wrapper } = harness();
    clubApiMock.fetchAdminClubThreads.mockResolvedValue({ rows: [], total: 0 });

    const filters = {
      groupId: "group-3",
      kind: "consultation",
      status: "hidden",
      search: "energia",
    };
    const a = renderHook(() => useAdminClubThreads(CLUB, { ...filters, offset: 0 }), { wrapper });
    await waitFor(() => expect(a.result.current.isSuccess).toBe(true));
    const b = renderHook(() => useAdminClubThreads(CLUB, { ...filters, offset: 50 }), { wrapper });
    await waitFor(() => expect(b.result.current.isSuccess).toBe(true));

    expect(clubApiMock.fetchAdminClubThreads).toHaveBeenCalledTimes(2);
    expect(clubApiMock.fetchAdminClubThreads).toHaveBeenLastCalledWith({
      clubId: CLUB,
      ...filters,
      offset: 50,
    });
  });

  it("odpowiedzi panelu i licznik plakietki czytają swoje źródła", async () => {
    const { wrapper } = harness();
    clubApiMock.fetchAdminClubReplies.mockResolvedValue({ rows: [], total: 0 });
    clubApiMock.fetchClubPendingCounts.mockResolvedValue({
      moderationPending: 4,
      joinRequests: 1,
    });

    const replies = renderHook(() => useAdminClubReplies(THREAD), { wrapper });
    const counts = renderHook(() => useClubPendingCounts(), { wrapper });

    await waitFor(() => expect(replies.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(counts.result.current.data?.moderationPending).toBe(4));
    expect(clubApiMock.fetchAdminClubReplies).toHaveBeenCalledWith({ threadId: THREAD });
    expect(clubApiMock.fetchClubPendingCounts).toHaveBeenCalled();
  });

  it("panel klubu czyta klub, działy, statystyki i podgląd uprawnień", async () => {
    const { wrapper } = harness();
    clubApiMock.fetchAdminClub.mockResolvedValue(null);
    clubApiMock.fetchAdminClubGroups.mockResolvedValue([]);
    clubApiMock.fetchAdminClubStats.mockResolvedValue(null);
    clubApiMock.previewClubCapabilities.mockResolvedValue({ can_moderate: true });

    const club = renderHook(() => useAdminClub(CLUB), { wrapper });
    const groups = renderHook(() => useAdminClubGroups(CLUB), { wrapper });
    const stats = renderHook(() => useAdminClubStats(CLUB), { wrapper });
    const caps = renderHook(
      () => useClubCapabilitiesPreview({ clubId: CLUB, userId: "u1", groupId: "g1" }),
      { wrapper },
    );

    await waitFor(() => expect(club.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(groups.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(stats.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(caps.result.current.isSuccess).toBe(true));

    expect(clubApiMock.fetchAdminClub).toHaveBeenCalledWith(CLUB);
    expect(clubApiMock.fetchAdminClubGroups).toHaveBeenCalledWith(CLUB);
    expect(clubApiMock.fetchAdminClubStats).toHaveBeenCalledWith(CLUB);
    expect(clubApiMock.previewClubCapabilities).toHaveBeenCalledWith({
      clubId: CLUB,
      userId: "u1",
      groupId: "g1",
    });
  });

  it("podgląd segmentu liczy się PRZED wysyłką i osobno dla każdej reguły", async () => {
    const { wrapper } = harness();
    clubApiMock.previewClubSegment.mockResolvedValue({ count: 12, sample: [] });

    const first = renderHook(
      () =>
        useClubSegmentPreview({
          clubId: CLUB,
          rule: { kind: "badge", badge: "ekspert" },
          enabled: true,
        }),
      { wrapper },
    );
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));

    const second = renderHook(
      () =>
        useClubSegmentPreview({
          clubId: CLUB,
          rule: { kind: "specialization", value: "energetyka" },
          enabled: true,
        }),
      { wrapper },
    );
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    // Reguła jest w kluczu przez `JSON.stringify` - dwie różne reguły to dwa
    // różne wyniki, a nie odświeżenie tego samego. Bez tego administrator
    // widziałby liczbę z POPRZEDNIEJ reguły tuż przed wysyłką zaproszeń.
    expect(clubApiMock.previewClubSegment).toHaveBeenCalledTimes(2);
    expect(clubApiMock.previewClubSegment).toHaveBeenLastCalledWith({
      clubId: CLUB,
      rule: { kind: "specialization", value: "energetyka" },
    });
  });

  it("podgląd segmentu milczy, dopóki formularz go nie włączy", async () => {
    const { wrapper } = harness();

    renderHook(
      () => useClubSegmentPreview({ clubId: CLUB, rule: { kind: "badge" }, enabled: false }),
      { wrapper },
    );
    renderHook(
      () => useClubSegmentPreview({ clubId: undefined, rule: { kind: "badge" }, enabled: true }),
      { wrapper },
    );

    await flush();
    expect(clubApiMock.previewClubSegment).not.toHaveBeenCalled();
  });

  it("wyszukiwarka bez wektora pyta trybem pełnotekstowym, z wektorem - hybrydowym", async () => {
    const { wrapper, queryClient } = harness();
    clubApiMock.searchClubThreads.mockResolvedValue([]);

    const fts = renderHook(() => useClubSearch({ query: "  budzet  ", clubId: CLUB }), { wrapper });
    await waitFor(() => expect(fts.result.current.isSuccess).toBe(true));
    expect(clubApiMock.searchClubThreads).toHaveBeenCalledWith({
      query: "budzet",
      clubId: CLUB,
      limit: 20,
      embedding: null,
    });
    expect(queryClient.getQueryData([...clubKeys.search("budzet", CLUB), "fts"])).toEqual([]);

    clubApiMock.embedClubQuery.mockResolvedValue({ embedding: [0.5, 0.25] });
    const hybrid = renderHook(() => useClubSearch({ query: "energia jadrowa", clubId: null }), {
      wrapper,
    });
    await waitFor(() => expect(hybrid.result.current.isSuccess).toBe(true));
    await waitFor(() =>
      expect(clubApiMock.searchClubThreads).toHaveBeenLastCalledWith(
        expect.objectContaining({ embedding: [0.5, 0.25] }),
      ),
    );
    // Wektor jest CZĘŚCIĄ klucza: doliczony po fakcie nie może cicho podmienić
    // listy, którą czytelnik ma już na ekranie.
    expect(
      queryClient.getQueryData([...clubKeys.search("energia jadrowa", null), "hybrid"]),
    ).toEqual([]);
  });

  it("wątki kotwicy i podpowiedzi kotwicy dojeżdżają z pełnym zapytaniem", async () => {
    const { wrapper } = harness();
    clubApiMock.fetchClubThreadsForAnchor.mockResolvedValue([]);
    clubApiMock.fetchClubAnchorSuggestions.mockResolvedValue([]);

    const anchor = renderHook(
      () => useClubThreadsForAnchor({ anchorType: "post", anchorId: "post-1", limit: 3 }),
      { wrapper },
    );
    await waitFor(() => expect(anchor.result.current.isSuccess).toBe(true));
    expect(clubApiMock.fetchClubThreadsForAnchor).toHaveBeenCalledWith({
      anchorType: "post",
      anchorId: "post-1",
      limit: 3,
    });

    const suggest = renderHook(
      () => useClubAnchorSuggestions({ query: "  dyrektywa ", anchorType: "eu_policy_item" }),
      { wrapper },
    );
    await waitFor(() => expect(suggest.result.current.isSuccess).toBe(true));
    expect(clubApiMock.fetchClubAnchorSuggestions).toHaveBeenCalledWith({
      query: "dyrektywa",
      anchorType: "eu_policy_item",
    });
  });

  it("bramka `enabled` wycisza wyszukiwarkę, podpowiedzi i listę panelu", async () => {
    const { wrapper } = harness();

    // Fraza jest DŁUGA - gdyby liczył się tylko próg znaków, oba zapytania by
    // poleciały. Wycisza je jawne `enabled: false` (gość na stronie publicznej,
    // zamknięty kompozytor, panel bez wybranego klubu).
    renderHook(() => useClubSearch({ query: "energia jadrowa", enabled: false }), { wrapper });
    renderHook(
      () => useClubAnchorSuggestions({ query: "dyrektywa", enabled: false }),
      { wrapper },
    );
    renderHook(() => useAdminClubs({ search: "energia" }, false), { wrapper });

    await flush();
    expect(clubApiMock.searchClubThreads).not.toHaveBeenCalled();
    expect(clubApiMock.fetchClubAnchorSuggestions).not.toHaveBeenCalled();
    expect(clubApiMock.fetchAdminClubs).not.toHaveBeenCalled();
  });

  it("podgląd uprawnień bez KLUBU milczy tak samo, jak bez osoby", async () => {
    const { wrapper } = harness();

    renderHook(() => useClubCapabilitiesPreview({ clubId: undefined, userId: "u1" }), { wrapper });

    await flush();
    expect(clubApiMock.previewClubCapabilities).not.toHaveBeenCalled();
  });

  it("kotwica bez identyfikatora nie odpytuje", async () => {
    const { wrapper } = harness();

    renderHook(() => useClubThreadsForAnchor({ anchorType: "post", anchorId: undefined }), {
      wrapper,
    });
    renderHook(() => useClubThreadsForAnchor({ anchorType: undefined, anchorId: "post-1" }), {
      wrapper,
    });

    await flush();
    expect(clubApiMock.fetchClubThreadsForAnchor).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 8. Wartość zastępcza identyfikatora
// ---------------------------------------------------------------------------

describe("brak identyfikatora daje PUSTY napis, nigdy `undefined`", () => {
  // DLACZEGO TO NIE JEST CZEPIALSTWO. `enabled` wycisza zapytanie, ale NIE jest
  // ostatnią linią obrony: `refetch()` z React Query świadomie ignoruje
  // `enabled` (tak działa przycisk „odśwież" i ręczne ponowienie po błędzie),
  // więc `queryFn` DA SIĘ wykonać bez identyfikatora. Wtedy liczy się, co
  // pojedzie do bazy. `""` to identyfikator, który nie pasuje do niczego -
  // odpowiedź jest pusta. `undefined` w ładunku RPC znaczy „argument
  // pominięty", czyli „użyj domyślnej", a domyślna dla filtra klubu to BRAK
  // FILTRA. Ta różnica to granica najemcy dla ścieżki, którą łatwo przeoczyć,
  // bo w normalnym renderze nigdy się nie wykonuje.
  it("odczyty panelu klubu wysyłają pusty identyfikator, nie pomijają argumentu", async () => {
    const { wrapper } = harness();
    clubApiMock.fetchAdminClub.mockResolvedValue(null);
    clubApiMock.fetchAdminClubGroups.mockResolvedValue([]);
    clubApiMock.fetchAdminClubStats.mockResolvedValue(null);
    clubApiMock.previewClubCapabilities.mockResolvedValue({ can_moderate: false });
    clubApiMock.previewClubSegment.mockResolvedValue({ count: 0, sample: [] });

    const club = renderHook(() => useAdminClub(undefined), { wrapper });
    const groups = renderHook(() => useAdminClubGroups(undefined), { wrapper });
    const stats = renderHook(() => useAdminClubStats(undefined), { wrapper });
    const caps = renderHook(
      () => useClubCapabilitiesPreview({ clubId: undefined, userId: undefined }),
      { wrapper },
    );
    const segment = renderHook(
      () => useClubSegmentPreview({ clubId: undefined, rule: { kind: "badge" }, enabled: true }),
      { wrapper },
    );

    await Promise.all([
      club.result.current.refetch(),
      groups.result.current.refetch(),
      stats.result.current.refetch(),
      caps.result.current.refetch(),
      segment.result.current.refetch(),
    ]);

    expect(clubApiMock.fetchAdminClub).toHaveBeenCalledWith("");
    expect(clubApiMock.fetchAdminClubGroups).toHaveBeenCalledWith("");
    expect(clubApiMock.fetchAdminClubStats).toHaveBeenCalledWith("");
    expect(clubApiMock.previewClubCapabilities).toHaveBeenCalledWith({
      clubId: "",
      userId: "",
      groupId: undefined,
    });
    expect(clubApiMock.previewClubSegment).toHaveBeenCalledWith({
      clubId: "",
      rule: { kind: "badge" },
    });
  });

  it("odczyty pulpitu moderacji zachowują się tak samo", async () => {
    const { wrapper } = harness();
    clubApiMock.fetchAdminClubThreads.mockResolvedValue({ rows: [], total: 0 });
    clubApiMock.fetchAdminClubReplies.mockResolvedValue({ rows: [], total: 0 });
    clubApiMock.fetchClubModerationQueue.mockResolvedValue({ rows: [], total: 0 });
    clubApiMock.fetchClubModerationLog.mockResolvedValue([]);
    clubApiMock.fetchClubThreadsForAnchor.mockResolvedValue([]);

    const threads = renderHook(() => useAdminClubThreads(undefined, {}), { wrapper });
    const replies = renderHook(() => useAdminClubReplies(undefined), { wrapper });
    const queue = renderHook(() => useClubModerationQueue(undefined), { wrapper });
    const log = renderHook(() => useClubModerationLog(undefined), { wrapper });
    const anchor = renderHook(
      () => useClubThreadsForAnchor({ anchorType: undefined, anchorId: undefined }),
      { wrapper },
    );

    await Promise.all([
      threads.result.current.refetch(),
      replies.result.current.refetch(),
      queue.result.current.refetch(),
      log.result.current.refetch(),
      anchor.result.current.refetch(),
    ]);

    expect(clubApiMock.fetchAdminClubThreads).toHaveBeenCalledWith({
      clubId: "",
      groupId: null,
      status: null,
      kind: null,
      search: "",
      offset: 0,
    });
    expect(clubApiMock.fetchAdminClubReplies).toHaveBeenCalledWith({ threadId: "" });
    expect(clubApiMock.fetchClubModerationQueue).toHaveBeenCalledWith({ clubId: "" });
    expect(clubApiMock.fetchClubModerationLog).toHaveBeenCalledWith({ clubId: "" });
    expect(clubApiMock.fetchClubThreadsForAnchor).toHaveBeenCalledWith({
      anchorType: "",
      anchorId: "",
      limit: 5,
    });
  });
});

// ---------------------------------------------------------------------------
// 9. Defekt: rozmiar strony poza kluczem cache'u
// ---------------------------------------------------------------------------

describe("rozmiar strony NIE jest częścią klucza - defekt", () => {
  // TA SAMA KLASA BŁĘDU, KTÓRĄ REPO NAPRAWIAŁO JUŻ TRZY RAZY. Komentarze
  // w `queryKeys.ts` opisują ją przy `list` („'pokaż więcej' trafia w stary
  // wpis"), przy `board` („gubi po szesnascie pozycji na stronie") i przy
  // `eventAttendees` („gubil trzydziesci osiem potwierdzonych obecnosci").
  // `anchor()` i `search()` jej nie mają: `limit` jedzie do zapytania, ale nie
  // do klucza, więc dwa widoki proszące o różną liczbę wierszy dzielą JEDEN
  // wpis cache'u i drugi dostaje listę pierwszego. Dziś nie ma na to skargi
  // wyłącznie dlatego, że `ClubAnchorThreads` jest montowany w jednym miejscu
  // - ale `limit` jest jego PUBLICZNYM propsem, więc drugie miejsce montażu
  // wywoła defekt bez jednej linii zmiany w tym module.
  it.fails("kotwica: dwa różne limity powinny dać dwa zapytania, dają jedno", async () => {
    const { wrapper } = harness();
    clubApiMock.fetchClubThreadsForAnchor.mockResolvedValue([]);

    const small = renderHook(
      () => useClubThreadsForAnchor({ anchorType: "post", anchorId: "post-1", limit: 5 }),
      { wrapper },
    );
    await waitFor(() => expect(small.result.current.isSuccess).toBe(true));
    const big = renderHook(
      () => useClubThreadsForAnchor({ anchorType: "post", anchorId: "post-1", limit: 25 }),
      { wrapper },
    );
    await waitFor(() => expect(big.result.current.isSuccess).toBe(true));

    expect(clubApiMock.fetchClubThreadsForAnchor).toHaveBeenCalledTimes(2);
  });

  it.fails("wyszukiwarka: dwa różne limity powinny dać dwa zapytania, dają jedno", async () => {
    const { wrapper } = harness();
    clubApiMock.searchClubThreads.mockResolvedValue([]);

    const small = renderHook(() => useClubSearch({ query: "budzet", limit: 20 }), { wrapper });
    await waitFor(() => expect(small.result.current.isSuccess).toBe(true));
    const big = renderHook(() => useClubSearch({ query: "budzet", limit: 100 }), { wrapper });
    await waitFor(() => expect(big.result.current.isSuccess).toBe(true));

    expect(clubApiMock.searchClubThreads).toHaveBeenCalledTimes(2);
  });

  it("KONTROLA DODATNIA: te same hooki rozróżniają cel i frazę, więc licznik działa", async () => {
    const { wrapper } = harness();
    clubApiMock.fetchClubThreadsForAnchor.mockResolvedValue([]);
    clubApiMock.searchClubThreads.mockResolvedValue([]);

    const a = renderHook(
      () => useClubThreadsForAnchor({ anchorType: "post", anchorId: "post-1" }),
      { wrapper },
    );
    await waitFor(() => expect(a.result.current.isSuccess).toBe(true));
    const b = renderHook(
      () => useClubThreadsForAnchor({ anchorType: "post", anchorId: "post-2" }),
      { wrapper },
    );
    await waitFor(() => expect(b.result.current.isSuccess).toBe(true));
    expect(clubApiMock.fetchClubThreadsForAnchor).toHaveBeenCalledTimes(2);

    const s1 = renderHook(() => useClubSearch({ query: "budzet" }), { wrapper });
    await waitFor(() => expect(s1.result.current.isSuccess).toBe(true));
    const s2 = renderHook(() => useClubSearch({ query: "energia" }), { wrapper });
    await waitFor(() => expect(s2.result.current.isSuccess).toBe(true));
    expect(clubApiMock.searchClubThreads).toHaveBeenCalledTimes(2);
  });
});
