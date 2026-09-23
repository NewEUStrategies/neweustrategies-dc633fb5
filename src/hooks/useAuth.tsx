import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { hasAnonPersonalization, mergeAnonPersonalization } from "@/lib/personalization/anonMerge";
import { AUTH_DEFAULTS, AUTH_SETTINGS_KEY } from "@/lib/authSettings";
import { resolveSetting, siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { clearReservedSpace } from "@/lib/dock/reservedSpace";

export type Role = "super_admin" | "admin" | "editor" | "author" | "user";

/**
 * Górna granica czekania na rozstrzygnięcie sesji startowej.
 *
 * PO CO. `loading` znaczy „NIE WIEMY, czy to gość" - i każda bramka tożsamości
 * (`AuthGate`, `GuestCheckoutGate`, `ClubAccessGate`) kręci wtedy spinner
 * zamiast pokazać jedyne realne wyjście, czyli odnośnik do logowania. Dopóki to
 * „nie wiemy" nie miało terminu, wystarczyła JEDNA wisząca obietnica, żeby
 * spinner został na ekranie na zawsze. Drogi do takiego zawieszenia są dwie
 * i obie są realne przy niedostępnym backendzie:
 *   * `getSession()` z PRZETERMINOWANYM tokenem w magazynie idzie do sieci po
 *     odświeżenie - `fetch` klienta Supabase nie ma limitu czasu, więc przy
 *     zapytaniu, które nigdy nie wraca (DNS/proxy wisi zamiast odmówić),
 *     obietnica nie rozstrzyga się nigdy;
 *   * aktualizacja stanu z `.then` jedzie w `startTransition` (patrz niżej),
 *     a przejście czeka na chunki zawieszonych wysp - dostatecznie wolny
 *     lub martwy chunk zatrzymuje commit.
 *
 * PO TERMINIE mówimy „nie wiemy, więc traktujemy jak gościa": `loading` schodzi,
 * bramka pokazuje CTA logowania. NIE czyścimy magazynu i NIE wołamy
 * `signOut()` - to jest właśnie różnica między „brak sesji" a „nie wiemy".
 * Spóźniona odpowiedź `getSession()` albo późniejsze `onAuthStateChange`
 * nadal promują użytkownika z powrotem na zalogowanego.
 *
 * 5 s: rząd wielkości powyżej zdrowego odświeżenia tokenu (dziesiątki-setki ms)
 * i poniżej domyślnego budżetu asercji e2e (10 s).
 */
export const SESSION_SETTLE_TIMEOUT_MS = 5_000;

/**
 * Górna granica czekania na role i tenanta ZALOGOWANEGO.
 *
 * `loading` jest sumą (`sessionLoading || rolesLoading` dla zalogowanego), więc
 * wiszące `user_roles`/`profiles` dają dokładnie ten sam wieczny spinner, co
 * wisząca sesja - tylko na innej powierzchni (panel, profil, katalog osób).
 *
 * Termin jest tu dłuższy, bo cena jego wyczerpania jest wyższa: guard `/admin`
 * czyta `isStaff`, a po terminie zobaczy PUSTY zestaw ról (kierunek bezpieczny -
 * najmniejsze uprawnienia), czyli zalogowany redaktor wyląduje na logowaniu.
 * To i tak jest tańsze niż ekran, który nigdy się nie kończy - a gdy zapytania
 * wrócą później, role wskakują i guard przelicza się ponownie.
 */
export const ROLE_SETTLE_TIMEOUT_MS = 8_000;

/**
 * Pusty zestaw ról jako JEDNA stała. `setRoles([])` z nową tablicą za każdym
 * razem to nowa wartość dla Reacta (`Object.is([], []) === false`), więc każde
 * wylogowanie i każda zmiana konta przebudowywała kontekst także wtedy, gdy ról
 * już nie było. Ta sama referencja pozwala Reactowi pominąć render.
 */
const NO_ROLES: Role[] = [];

/**
 * Klucze, pod którymi klient Supabase trzyma sesję w `localStorage`:
 * `sb-<subdomena projektu>-auth-token` (`defaultStorageKey`
 * w `@supabase/supabase-js`), wariant dzielony na części (`...-auth-token.0`)
 * oraz historyczne `supabase.auth.token`. Ten sam wzorzec zna rejestr
 * ciasteczek (`lib/cookieBanner/registry.ts`).
 */
const STORED_SESSION_KEY_RE = /^(?:sb-.+-auth-token(?:\.\d+)?|supabase\.auth\.token)$/;

/**
 * Czy w przeglądarce LEŻY zapisana sesja - rozstrzygane synchronicznie, bez
 * sieci i bez `getSession()`.
 *
 * PO CO. „Brak sesji" jest wiedzą LOKALNĄ: sesja Supabase mieszka w
 * `localStorage` (`persistSession: true` w `integrations/supabase/client.ts`),
 * nie w ciasteczku, więc pusty magazyn to PEWNE „to gość" - bez jednego bajtu
 * ruchu i bez czekania na klienta Supabase. Dopiero zapisana sesja wymaga
 * czekania, bo może być przeterminowana i wymagać odświeżenia w sieci.
 *
 * Na serwerze zwraca `false`, ale NIE korzystamy z tego do zasiewu stanu
 * startowego: `/admin` renderuje serwerowo szkielet powłoki dokładnie na
 * `useAuth().loading === true` (audyt CWV 2026-09-20, F32) i pierwszy render
 * klienta musi wyjść identycznie, inaczej hydratacja się rozjeżdża.
 *
 * NIE JEST EKSPORTOWANA celowo: eksport funkcji z modułu komponentu psuje
 * fast refresh (`react-refresh/only-export-components`), a kontrakt i tak
 * mierzy się przez zachowanie `AuthProvider` - patrz
 * `hooks/__tests__/useAuth.test.tsx` i `components/profile/__tests__/AuthGate.test.tsx`.
 *
 * W RAMCE POŚREDNIKA (podgląd Lovable) magazynem nie jest `localStorage`, tylko
 * broker `postMessage` do edytora (`previewAuthStorage.ts`) - pusty
 * `localStorage` nie znaczy tam „brak sesji", więc w ramce wracamy do czekania
 * na `getSession()`.
 */
function hasStoredAuthSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.parent && window.parent !== window) return true;
    const store = window.localStorage;
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key && STORED_SESSION_KEY_RE.test(key) && store.getItem(key)) return true;
    }
  } catch {
    // Zablokowany magazyn (tryb prywatny, zablokowane ciasteczka): klient
    // Supabase odczyta z niego dokładnie tyle samo, co my - nic.
  }
  return false;
}

interface AuthCtx {
  session: Session | null;
  user: User | null;
  roles: Role[];
  tenantId: string | null;
  loading: boolean;
  isStaff: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  session: null,
  user: null,
  roles: [],
  tenantId: null,
  loading: true,
  isStaff: false,
  isAdmin: false,
  isSuperAdmin: false,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<Role[]>(NO_ROLES);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  // Role/tenant context is fetched separately from the session. Route guards
  // read `isStaff`, so they MUST NOT run while roles are still in flight -
  // otherwise a hard reload of /admin bounces a signed-in editor to /login.
  const [rolesLoading, setRolesLoading] = useState(false);
  // Track the last-seen user id so we only re-gate content when identity
  // actually changes (login / logout / account switch), not on token refresh.
  const lastUidRef = useRef<string | null>(null);
  // Termin na role/tenant - trzymany w ref, bo gasi go zarówno powrót zapytań
  // (`settleRoles` w `finally`), jak i odmontowanie prowajdera.
  const roleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // NUMER BIEŻĄCEGO PYTANIA O ROLE I TENANTA. Każda zmiana tożsamości (logowanie,
  // wylogowanie, zmiana konta) dostaje nowy numer, a odpowiedź `loadContext`
  // wolno zapisać WYŁĄCZNIE wtedy, gdy jej numer nadal jest bieżący.
  //
  // PO CO. Zapytania o role nie wracają w kolejności wysłania. Bez numeru
  // odpowiedź konta A, która dojechała po przełączeniu na konto B, nadpisywała
  // role i tenanta B - panel pokazywał uprawnienia A, a `useRequiredTenant()`
  // oddawał tenanta A. Ta sama spóźniona odpowiedź po wylogowaniu wpisywała
  // role do sesji gościa, a jej `finally` zdejmowało `rolesLoading` i kasowało
  // termin NOWEGO konta, więc guardy dostawały pół-tożsamość (sesja B, role A).
  // Numer, a nie sam uid: po A -> gość -> A pierwsza odpowiedź A też jest
  // nieaktualna, bo pytała przed wylogowaniem.
  const contextRequestRef = useRef(0);

  const settleRoles = useCallback(() => {
    if (roleTimerRef.current !== undefined) {
      clearTimeout(roleTimerRef.current);
      roleTimerRef.current = undefined;
    }
    setRolesLoading(false);
  }, []);

  const loadContext = async (uid: string, request: number) => {
    // Nieaktualna odpowiedź nie dotyka stanu: ani ról, ani tenanta, ani
    // `rolesLoading`, ani terminu - to wszystko należy już do nowej tożsamości.
    const current = () => contextRequestRef.current === request;
    try {
      const [{ data: rolesData }, { data: profile }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", uid),
        supabase.from("profiles").select("tenant_id").eq("id", uid).maybeSingle(),
      ]);
      if (!current()) return;
      setRoles(rolesData?.map((r) => r.role) ?? NO_ROLES);
      setTenantId(profile?.tenant_id ?? null);
    } catch (error) {
      // Martwy backend ODRZUCA te zapytania (`fetch` nie dojeżdża), a nie zwraca
      // `{ error }`. Bez tego `catch` odrzucenie leciało przez `void loadContext`
      // prosto w `unhandledrejection` - czyli w sondę bootu i w `pageerror`
      // każdego testu e2e, który akurat miał zalogowaną sesję. Odrzucenie
      // pytania o konto, którego już nie ma, nie jest alarmem.
      if (current()) console.warn("[auth] nie udało się wczytać ról i tenanta", error);
    } finally {
      if (current()) settleRoles();
    }
  };

  // When identity changes, drop any cached gated content so it is re-fetched
  // (and re-authorized) under the new session - prevents a previously unlocked
  // body lingering after logout, or stale gating after login.
  const reauthorizeContent = (uid: string | null) => {
    if (lastUidRef.current === uid) return;
    lastUidRef.current = uid;
    void queryClient.invalidateQueries({ queryKey: ["public", "resolved"] });
    void queryClient.invalidateQueries({ queryKey: ["unlocked-body"] });
  };

  useEffect(() => {
    // The browser Supabase client throws at FIRST touch when its public config
    // cannot be resolved (see lib/supabasePublicConfig.ts) - and a throw from
    // this effect lands in the root error boundary, replacing a fully-rendered
    // anonymous page with the error screen (production incident 2026-07-16).
    // Auth is progressive enhancement on a public content site: degrade to
    // signed-out, loudly, instead of taking the whole page down.
    let sub: { subscription: { unsubscribe: () => void } } | undefined;
    // Guard przeciw podwójnemu ładowaniu kontekstu przy starcie:
    // `INITIAL_SESSION` z listenera i `getSession().then` obydwa dostarczają
    // tę samą sesję - drugie wywołanie musi być no-opem, żeby nie dublować
    // zapytań o `user_roles` i `profiles` przy każdym mount.
    let contextLoadedForUid: string | null = null;
    let invitationAcceptedForUid: string | null = null;
    // Czy nasłuch dostał już INITIAL_SESSION. Do tego momentu odświeżenie
    // tokenu USTALA tożsamość startową, a nie ją zmienia (patrz niżej).
    let initialSessionSeen = false;
    // Czy sesja startowa DOSTAŁA już odpowiedź (jakąkolwiek - z magazynu, z
    // sieci albo odmowną). Steruje wyłącznie terminem niżej.
    let sessionAnswered = false;
    // TERMIN NA „NIE WIEMY". Patrz SESSION_SETTLE_TIMEOUT_MS: po jego upływie
    // schodzimy z `loading` PILNIE (poza `startTransition`), bo przejście może
    // być właśnie tym, co wisi. Magazynu nie ruszamy - to nie jest wylogowanie,
    // tylko rezygnacja z czekania, więc spóźniona odpowiedź nadal promuje
    // użytkownika z powrotem na zalogowanego.
    let settleTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      settleTimer = undefined;
      if (sessionAnswered) return;
      console.warn(
        `[auth] sesja nie rozstrzygnęła się w ${SESSION_SETTLE_TIMEOUT_MS} ms - traktujemy odwiedzającego jak gościa (magazyn sesji nietknięty)`,
      );
      setSessionLoading(false);
    }, SESSION_SETTLE_TIMEOUT_MS);
    const answerSession = () => {
      sessionAnswered = true;
      if (settleTimer !== undefined) {
        clearTimeout(settleTimer);
        settleTimer = undefined;
      }
    };
    // PUSTY MAGAZYN = PEWNE „TO GOŚĆ", i wiemy to OD RAZU - bez `getSession()`,
    // bez sieci, bez klienta Supabase. Bramki tożsamości dostają wtedy swoją
    // odpowiedź w pierwszym przebiegu efektów po hydratacji, zamiast czekać na
    // round-trip przez magazyn i kolejkę zdarzeń klienta. `startTransition` jak
    // niżej: zasłona hydratacji zawieszonych wysp ma zostać nienaruszona
    // (`hooks/__tests__/authHydration.test.tsx`).
    if (!hasStoredAuthSession()) {
      answerSession();
      startTransition(() => setSessionLoading(false));
    }
    const ensureContext = (uid: string | null) => {
      if (uid === contextLoadedForUid) return;
      contextLoadedForUid = uid;
      contextRequestRef.current += 1;
      const request = contextRequestRef.current;
      // Role i tenant poprzedniej tożsamości znikają OD RAZU, a nie dopiero
      // z odpowiedzią dla nowej. Inaczej po terminie ról (patrz
      // ROLE_SETTLE_TIMEOUT_MS) nowe konto zostawało z uprawnieniami starego
      // zamiast z obiecanym pustym zestawem, a konsument czytający `roles`
      // bez `loading` widział je przez cały czas czekania.
      setRoles(NO_ROLES);
      setTenantId(null);
      if (!uid) {
        settleRoles();
        return;
      }
      setRolesLoading(true);
      if (roleTimerRef.current !== undefined) clearTimeout(roleTimerRef.current);
      roleTimerRef.current = setTimeout(() => {
        roleTimerRef.current = undefined;
        console.warn(
          `[auth] role i tenant nie wróciły w ${ROLE_SETTLE_TIMEOUT_MS} ms - widok idzie dalej bez ról`,
        );
        setRolesLoading(false);
      }, ROLE_SETTLE_TIMEOUT_MS);
      setTimeout(() => {
        // Tożsamość zmieniła się, zanim pytanie wyszło - nie pytamy wcale.
        if (contextRequestRef.current !== request) return;
        void loadContext(uid, request);
      }, 0);
    };
    try {
      ({ data: sub } = supabase.auth.onAuthStateChange((event, s) => {
        setSession(s);
        const uid = s?.user?.id ?? null;
        // TOKEN_REFRESHED odpala się cyklicznie (co ~godzinę + focus tab) z
        // tą samą tożsamością - nie potrzebujemy wtedy nic przeładowywać
        // (bearer i tak jest odświeżany na poziomie klienta Supabase).
        //
        // ALE TO ZDARZENIE BYWA ZMIANĄ KONTA. `setSession()` z PRZETERMINOWANYM
        // tokenem odświeża go i emituje WYŁĄCZNIE TOKEN_REFRESHED z sesją
        // innego konta, bez SIGNED_IN (`_setSession` w `@supabase/auth-js`) -
        // także do pozostałych kart przez BroadcastChannel. Tak kończy się
        // wyjście z podglądu jako inny użytkownik trwające dłużej niż ważność
        // zapisanego tokenu admina (`lib/admin/impersonation.ts`). Bezwarunkowy
        // powrót zostawiał wtedy sesję admina z rolami i tenantem podglądanego
        // konta przy `loading === false`.
        if (event === "TOKEN_REFRESHED" && uid === lastUidRef.current) return;
        // Przed INITIAL_SESSION odświeżenie przeterminowanego tokenu z magazynu
        // USTALA tożsamość startową - jak INITIAL_SESSION, bez inwalidacji
        // cache'u, na którym stoi hydratacja treści.
        if (event === "INITIAL_SESSION" || (event === "TOKEN_REFRESHED" && !initialSessionSeen)) {
          if (event === "INITIAL_SESSION") initialSessionSeen = true;
          lastUidRef.current = uid;
        } else {
          // SIGNED_IN / SIGNED_OUT / USER_UPDATED / TOKEN_REFRESHED innego
          // konta -> re-gate cached content.
          reauthorizeContent(uid);
        }
        ensureContext(uid);
        // Domknij administracyjne zaproszenie po pierwszym poprawnym wejściu.
        // RPC jest idempotentne i może zaakceptować wyłącznie zaproszenie
        // przypisane do bieżącego konta, e-maila i tenanta.
        if (
          uid &&
          uid !== invitationAcceptedForUid &&
          (event === "SIGNED_IN" || event === "INITIAL_SESSION")
        ) {
          invitationAcceptedForUid = uid;
          setTimeout(() => {
            void supabase.rpc("accept_my_user_invitation").then(({ error }) => {
              if (error) console.warn("[auth] invitation acceptance sync failed", error.message);
            });
          }, 0);
        }
        if (
          s?.user &&
          (event === "SIGNED_IN" || event === "INITIAL_SESSION") &&
          hasAnonPersonalization()
        ) {
          const mergeUid = s.user.id;
          setTimeout(() => {
            void mergeAnonPersonalization(mergeUid, queryClient).catch((err) => {
              console.warn("[auth] anon personalization merge failed", err);
            });
          }, 0);
        }
      }));
      supabase.auth
        .getSession()
        .then(({ data }) => {
          // Listener już obsłużył INITIAL_SESSION dla tej samej sesji - tu tylko
          // domykamy `loading`, żeby konsument (route guards, header) mógł się
          // odpalić bez dodatkowego round-tripu.
          // Preserve the server-rendered reading surface while lazy widgets
          // hydrate. Initial auth settlement can wait; later identity changes
          // and logout remain urgent.
          answerSession();
          startTransition(() => {
            setSession(data.session);
            ensureContext(data.session?.user?.id ?? null);
            setSessionLoading(false);
          });
        })
        .catch((error) => {
          // ODMOWA ODCZYTU SESJI NIE JEST WYLOGOWANIEM. `getSession()` odrzuca,
          // gdy odświeżenie tokenu padnie na sieci - a to znaczy „nie wiemy",
          // nie „nie ma sesji". Przestajemy więc czekać (bramka pokaże CTA
          // logowania), ale zostawiamy magazyn w spokoju: `onAuthStateChange`
          // po powrocie sieci dostarczy sesję i widok wróci do zalogowanego.
          // Bez tego `catch` `loading` nie schodziło NIGDY, a odrzucenie
          // lądowało w `unhandledrejection`.
          answerSession();
          console.warn("[auth] nie udało się odczytać sesji - traktujemy jak gościa", error);
          setSessionLoading(false);
        });
    } catch (error) {
      console.error("[auth] Supabase client unavailable - continuing signed-out", error);
      answerSession();
      setSessionLoading(false);
    }
    return () => {
      // Odpowiedzi w locie należą do odmontowanego prowajdera - unieważnione.
      contextRequestRef.current += 1;
      if (settleTimer !== undefined) clearTimeout(settleTimer);
      if (roleTimerRef.current !== undefined) {
        clearTimeout(roleTimerRef.current);
        roleTimerRef.current = undefined;
      }
      sub?.subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    // Resolve the admin-configured post-logout destination BEFORE clearing the
    // cache (the bulk settings map is almost always already cached, so this is
    // a cache read, not a round-trip). Only internal paths are honoured -
    // "//evil.example" style values fall back to the homepage.
    let target = "/";
    try {
      const map = await queryClient.ensureQueryData(siteSettingsQueryOptions);
      const configured = resolveSetting(map, AUTH_SETTINGS_KEY, AUTH_DEFAULTS).logout_redirect_url;
      if (configured.startsWith("/") && !configured.startsWith("//")) target = configured;
    } catch {
      /* settings unavailable - fall back to the homepage */
    }
    await supabase.auth.signOut();
    // Rezerwacja dolnej krawędzi jest odtwarzana PRZED pierwszym malowaniem
    // z zapamiętanej wysokości paska doku (`lib/dock/reservedSpace.ts`).
    // Po wylogowaniu paska nie ma, więc znacznik musi zniknąć razem z sesją -
    // inaczej każda następna strona dostałaby pas pustego miejsca pod niczym.
    // To jedyne miejsce w kodzie, które wie o wylogowaniu.
    clearReservedSpace();
    setSession(null);
    setRoles(NO_ROLES);
    setTenantId(null);
    // Drop every cached query so the next user (e.g. on a shared device) never
    // sees the previous account's data - billing, orders, subscription and
    // bookmarks use static, user-independent query keys.
    queryClient.clear();
    // AuthProvider mounts outside the router, so use a hard navigation - on
    // logout a full reload is even desirable: it guarantees no per-user state
    // survives in memory.
    if (typeof window !== "undefined") window.location.assign(target);
  }, [queryClient]);

  const isSuperAdmin = roles.includes("super_admin");
  const isAdmin = isSuperAdmin || roles.includes("admin");
  const isStaff = isAdmin || roles.includes("editor") || roles.includes("author");
  // Signed-in users stay "loading" until roles land, so guards never see a
  // half-hydrated identity (session present, roles empty).
  const loading = sessionLoading || (session !== null && rolesLoading);

  // Unrelated root renders must not rebroadcast unchanged auth state through
  // pending SSR widget boundaries. Identity/role/loading changes still notify
  // every consumer, and logout keeps its existing urgent cache invalidation.
  const value = useMemo<AuthCtx>(
    () => ({
      session,
      user: session?.user ?? null,
      roles,
      tenantId,
      loading,
      isStaff,
      isAdmin,
      isSuperAdmin,
      signOut,
    }),
    [session, roles, tenantId, loading, isStaff, isAdmin, isSuperAdmin, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

export function useRequiredTenant(): string {
  const { tenantId } = useAuth();
  if (!tenantId) {
    throw new Error("Brak kontekstu tenanta - operacja wymaga zalogowanego użytkownika.");
  }
  return tenantId;
}
