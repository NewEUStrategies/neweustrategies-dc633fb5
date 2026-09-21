// ZASTĘPCZY BACKEND DLA POMIARU PRZESTRZENI ROBOCZEJ CZŁONKA.
//
// ── PO CO OSOBNY MODUŁ, A NIE ROZBUDOWA `homeFixture` ────────────────────
// `homeFixture` obsługuje WYŁĄCZNIE `/rest/v1/` i wyłącznie tabele strony
// głównej; jego nagłówek mówi wprost, że żadna nowa trasa ani atrapa backendu
// nie ma prawa wejść do wdrożonego builda. Dok potrzebuje czegoś innego:
// SESJI (`/auth/v1/`) i pięciu tabel prywatnych użytkownika. Dopisanie tego do
// wspólnego modułu ruszyłoby dwa istniejące pomiary (`first-visit`,
// `typography`), które są kalibrowane na tamtym zestawie odpowiedzi.
//
// ── DLACZEGO TEN MODUŁ *DELEGUJE*, A NIE DUBLUJE ────────────────────────
// To jest naprawa realnej wady pierwszej wersji. Serwer artefaktu ma własną
// zaślepkę (`replayFetch.mjs` -> `homeFixture`), a przeglądarka dostaje tę
// nakładkę przez `page.route`. Gdy OBIE strony odpowiadają na te same tabele
// WŁASNYMI danymi, serwer renderuje jedno drzewo, klient liczy drugie i React
// melduje niezgodność hydratacji (#418) - a wtedy pomiar mierzy WADĘ STANOWISKA
// POMIAROWEGO, nie produkt. Dlatego wszystko, co publiczne (`posts`, `pages`,
// `menus`, `site_design_tokens`, `tenants`, RPC strony głównej), idzie do
// `homeFixture.fixtureResponse` - jednym i tym samym zestawem po obu stronach.
// Ten moduł zatrzymuje dla siebie DOKŁADNIE to, czego serwer nigdy nie
// renderuje: sesję i tabele prywatne członka.
//
// ── DLACZEGO OPÓŹNIENIE JEST STAŁE I DUŻE ───────────────────────────────
// Każda odpowiedź czeka `DOCK_ROUND_TRIP_MS`. Bez tego wszystko odpowiada
// natychmiast, a różnica między otwarciem ZIMNYM (paczka i zapytanie
// szeregowo po kliknięciu) i ROZGRZANYM (`prefetchDockPanel` +
// `prefetchDockData` na najechaniu) tonie w szumie. 120 ms to nie prognoza
// sieci czytelnika - to pomiar LABORATORYJNY, w którym efekt rozgrzewania
// jest widoczny ponad wariancją hosta.
//
// Dane są syntetyczne. Żadnych rekordów produkcyjnych, żadnych kluczy.
import { fixtureResponse as homeResponse, homeFixture } from "./homeFixture";

type Row = Record<string, unknown>;

/** Stałe opóźnienie jednej podróży do bazy - patrz nagłówek. */
export const DOCK_ROUND_TRIP_MS = 120;

export const DOCK_USER_ID = "00000000-0000-4000-8000-00000000d0ck";
export const DOCK_TENANT_ID = "performance-tenant";

/**
 * Ile wierszy dostaje każdy panel. Liczby są UMYŚLNIE różne, żeby asercja
 * „panel pokazał SWOJĄ treść" nie mogła przejść na cudzej liście.
 */
export const DOCK_ROW_COUNTS = { todos: 7, notes: 5, bookmarks: 6, readLater: 4 } as const;

/**
 * Napisy WYŁĄCZNE dla tego zestawu. Test rozpoznaje po nich treść panelu -
 * mocniej niż po liczbie wierszy, bo szkielet ładowania też renderuje `<li>`,
 * a semantyka filtrów panelu może zmienić liczbę widocznych pozycji bez
 * zmiany zachowania, które mierzymy.
 */
export const DOCK_MARKERS = {
  todos: "Zadanie pomiarowe 1",
  notes: "Notatka pomiarowa 1",
  saved: "Do przeczytania 1",
} as const;

/**
 * Tytuł zakładki - napis, który panel „Zapisane" może pokazać TYLKO wtedy, gdy
 * DRUGA tura zapytań doszła do końca (`user_bookmarks` -> `posts`). Trzymany
 * osobno od `DOCK_MARKERS`, bo dowodzi czegoś innego: nie „panel się otworzył",
 * a „najdłuższa droga do pierwszego wiersza w całym doku jest przejechana".
 */
export function savedBookmarkMarker(): string {
  const title = bookmarkedPosts[0]?.title_pl;
  if (typeof title !== "string" || title.length === 0)
    throw new Error("Zestaw first-visit stracił `title_pl` w pierwszym wpisie");
  return title;
}

function isoDaysAgo(days: number): string {
  // Chwila ODNIESIENIA jest stała: fixture nie może zależeć od zegara hosta,
  // bo wtedy ten sam przebieg za rok daje inne dane (ta sama zasada, co
  // w kanonicznym zegarze testów `src/test/time.ts`).
  const base = Date.UTC(2099, 5, 15, 12, 0, 0);
  return new Date(base - days * 86_400_000).toISOString();
}

const todos: Row[] = Array.from({ length: DOCK_ROW_COUNTS.todos }, (_, i) => ({
  id: `todo-${i}`,
  title: `Zadanie pomiarowe ${i + 1}`,
  priority: ["urgent", "high", "medium", "low"][i % 4],
  due_at: null,
  done: i >= 5,
  done_at: null,
  source_task_id: null,
  created_at: isoDaysAgo(i),
}));

const notes: Row[] = Array.from({ length: DOCK_ROW_COUNTS.notes }, (_, i) => ({
  id: `note-${i}`,
  title: `Notatka pomiarowa ${i + 1}`,
  body: "Treść notatki w pomiarze.",
  color: ["amber", "rose", "sky", "emerald", "violet"][i % 5],
  pinned: i === 0,
  entity_type: null,
  entity_id: null,
  entity_title: null,
  entity_url: null,
  created_at: isoDaysAgo(i),
  updated_at: isoDaysAgo(i),
}));

/**
 * Zakładki wskazują WPISY ZE WSPÓLNEGO ZESTAWU, a nie wymyślone tutaj. Panel
 * „Zapisane" czyta w dwóch turach (najpierw `user_bookmarks`, potem tytuły
 * wskazanych materiałów z `posts`), a `posts` obsługuje `homeFixture` - więc
 * identyfikatory MUSZĄ pochodzić stamtąd, inaczej druga tura nie znajduje
 * tytułu i panel słusznie pomija wiersz.
 */
const bookmarkedPosts = homeFixture.posts.slice(0, DOCK_ROW_COUNTS.bookmarks);

const bookmarks: Row[] = bookmarkedPosts.map((post, i) => ({
  id: `bm-${i}`,
  entity_type: "post",
  entity_id: post.id,
  created_at: isoDaysAgo(i),
}));

const readLater: Row[] = Array.from({ length: DOCK_ROW_COUNTS.readLater }, (_, i) => ({
  id: `rl-${i}`,
  entity_type: "external",
  entity_id: `ext-${i}`,
  title: `Do przeczytania ${i + 1}`,
  url: `https://example.invalid/${i}`,
  state: i === 0 ? "read" : "unread",
  note: null,
  read_at: null,
  created_at: isoDaysAgo(i),
}));

/**
 * ── CZEGO TU CELOWO NIE MA: `site_settings` ─────────────────────────────
 * Pierwsza wersja podmieniała tu klucz `mobile_bottom_bar`, żeby na pasku
 * pojawiła się zakładka „Czat" (powstaje wyłącznie dla pozycji
 * o identyfikatorze `chats`, a zestaw `first-visit` ma `fixture-node-*`).
 * Podmiana była NIESKUTECZNA i SZKODLIWA jednocześnie: ustawienia przyjeżdżają
 * do przeglądarki w stanie odwodnionym z serwera, więc react-query nie pyta
 * o nie sieci i nakładka nie miała jak wejść - a gdyby weszła, serwer i klient
 * liczyłyby powłokę z DWÓCH różnych konfiguracji, czyli dokładnie ten rozjazd,
 * któremu ten moduł ma zapobiegać. Skrzynkę rozmów otwiera więc test drogą,
 * która ustawienia nie potrzebuje (pigułka „+N" nad paskiem).
 */

/** Tabele PRYWATNE członka - `homeFixture` ich nie zna i znać nie musi. */
const MEMBER_TABLES: Record<string, Row[]> = {
  user_todos: todos,
  user_notes: notes,
  user_bookmarks: bookmarks,
  event_bookmarks: [],
  user_read_later: readLater,
  user_roles: [{ role: "member" }],
  profiles: [{ id: DOCK_USER_ID, tenant_id: DOCK_TENANT_ID }],
};

/**
 * Tabele, bez których pomiar traci sens. Gdy któraś trafi na „nie znam",
 * pusty panel znaczyłby „fixture niepełny", a nie „tak działa produkt" -
 * i test ma to zgłosić, a nie przemilczeć.
 */
export const DOCK_REQUIRED_TABLES = [
  "user_todos",
  "user_notes",
  "user_bookmarks",
  "user_read_later",
] as const;

export function isDockBackend(url: string): boolean {
  const parsed = new URL(url);
  if (parsed.hostname !== "127.0.0.1" && !parsed.hostname.endsWith(".supabase.co")) return false;
  return parsed.pathname.startsWith("/rest/v1/") || parsed.pathname.startsWith("/auth/v1/");
}

/**
 * Sesja zasiewana do magazynu przeglądarki.
 *
 * Klucz liczy `supabase-js` z adresu projektu:
 * `sb-${hostname.split(".")[0]}-auth-token` - dla `http://127.0.0.1:4199`
 * wychodzi `sb-127-auth-token`. Liczymy go TĄ SAMĄ formułą zamiast wpisywać
 * literałem, żeby zmiana adresu fixture'u nie zostawiła cicho martwego klucza
 * (a wtedy pasek po prostu by się nie pokazał i test kłamałby o powodzie).
 */
export function authStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}

/** Token JWT-podobny: trzy segmenty base64url, `exp` daleko w przyszłości. */
function fakeJwt(): string {
  const b64 = (value: object) =>
    Buffer.from(JSON.stringify(value))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  const header = b64({ alg: "HS256", typ: "JWT" });
  // `exp` w 2099 - sesja nie ma jak wygasnąć w trakcie przebiegu, więc
  // `supabase-js` nie pójdzie po odświeżenie tokenu i pomiar nie łapie
  // dodatkowej podróży, której produkcja w tym miejscu nie ma.
  const payload = b64({
    sub: DOCK_USER_ID,
    role: "authenticated",
    exp: Math.floor(Date.UTC(2099, 0, 1) / 1000),
    iat: Math.floor(Date.UTC(2099, 0, 1) / 1000) - 3600,
  });
  return `${header}.${payload}.pomiar`;
}

const user = {
  id: DOCK_USER_ID,
  aud: "authenticated",
  role: "authenticated",
  email: "pomiar@example.invalid",
  app_metadata: {},
  user_metadata: {},
  created_at: isoDaysAgo(365),
};

export function dockSession(): Record<string, unknown> {
  const token = fakeJwt();
  return {
    access_token: token,
    refresh_token: "pomiar-refresh",
    token_type: "bearer",
    // Sekundy, nie milisekundy - `supabase-js` porównuje to z `Date.now()/1000`.
    expires_at: Math.floor(Date.UTC(2099, 0, 1) / 1000),
    expires_in: 3600,
    user,
  };
}

/** Kolumny z `?select=` - PostgREST zwraca dokładnie o nie poproszone pola. */
function project(rows: readonly Row[], select: string | null): Row[] {
  if (select === null || select === "*" || select.includes("(")) return [...rows];
  const columns = select
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  if (columns.length === 0) return [...rows];
  return rows.map((row) => {
    const out: Row = {};
    for (const column of columns) if (column in row) out[column] = row[column];
    return out;
  });
}

export interface DockFixtureResult {
  response: Response;
  /** Tabela lub trasa, której nie znamy - test ma to zgłosić, nie przemilczeć. */
  unknown?: string;
}

/**
 * Odpowiedzi w kształcie, którego oczekuje NIEZMIENIONA aplikacja.
 *
 * Kolejność jest umyślna: sesja, potem tabele prywatne członka, a wszystko
 * pozostałe DELEGOWANE do `homeFixture` - czyli do tego samego zestawu, którym
 * odpowiada serwer artefaktu. `homeFixture` rzuca na nieznanej tabeli i na
 * nieznanym RPC; tutaj taki rzut zamienia się w pustą odpowiedź Z RAPORTEM,
 * bo powierzchnie członka wołają rzeczy, których pomiar doku nie dotyczy
 * (powiadomienia, dzwonek rozmów, połączenia), a ich brak nie może wywracać
 * przebiegu - musi być tylko WIDOCZNY.
 */
export async function dockFixtureResponse(
  request: Request,
  { delayMs = DOCK_ROUND_TRIP_MS } = {},
): Promise<DockFixtureResult> {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return {
      response: new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, HEAD, POST, PATCH, DELETE, OPTIONS",
          "access-control-allow-headers":
            request.headers.get("access-control-request-headers") ?? "*",
        },
      }),
    };
  }

  if (url.pathname.startsWith("/auth/v1/")) {
    // Sesja siedzi w magazynie przeglądarki, więc `getSession()` nie pyta
    // sieci. Te trasy są zapasem na wypadek walidacji tokenu.
    if (url.pathname.endsWith("/user")) return { response: Response.json(user) };
    return { response: Response.json(dockSession()) };
  }

  const name = url.pathname.replace(/^\/rest\/v1\//, "");
  const rows = MEMBER_TABLES[name];
  if (rows !== undefined) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const projected = project(rows, url.searchParams.get("select"));
    const single = (request.headers.get("accept") ?? "").includes("vnd.pgrst.object");
    return { response: Response.json(single ? (projected[0] ?? null) : projected) };
  }

  try {
    return { response: await homeResponse(request, { delayMs }) };
  } catch {
    // `homeFixture` rzuca WYŁĄCZNIE na nieodnotowanej tabeli/RPC. Zwracamy
    // kształt neutralny dla wołającego i meldujemy nazwę.
    const empty = name.startsWith("rpc/") ? null : [];
    return { response: Response.json(empty), unknown: name };
  }
}
