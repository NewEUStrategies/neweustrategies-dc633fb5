// ORKIESTRACJA operacji na plikach biblioteki mediów - `media.functions.ts`.
// Do 18.08.2026: 0 z 38 funkcji, 10,1% linii.
//
// DLACZEGO AKURAT TEN PLIK. Tu siedzą jedyne w module operacje NIEODWRACALNE:
// skasowanie obiektu ze storage, skasowanie folderu z zawartością, przeniesienie
// i nadpisanie. Błąd nie daje czerwonego ekranu - daje brakujący plik.
//
// GRANICA ODPOWIEDZIALNOŚCI. Testy niżej dowodzą ORKIESTRACJI: skąd bierze się
// tenant, w jakiej kolejności lecą zapytania, co się dzieje przy porażce
// pośredniego kroku, jaki wzorzec trafia do LIKE. NIE dowodzą RLS-u ani polityk
// bucketu - to egzekwuje baza i ma własne testy pgTAP w `supabase/tests`.
// Odtwarzanie tamtych reguł atrapą dałoby zieleń bez pokrycia.
//
// Bramki ścieżek (`normalizeFolderPath`, `likePrefix`) mają osobny plik z
// tabelą granic - `mediaFolderPaths.test.ts`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ok,
  okCount,
  fail,
  type SupabaseFromStub,
  type SupabaseResult,
} from "@/test/supabaseChain";
import { callServerFn } from "@/test/serverFn";

const h = vi.hoisted(() => ({
  audits: [] as Array<Record<string, unknown>>,
  rateLimitOk: true,
  storage: {
    removed: [] as string[][],
    removeError: null as { message: string } | null,
    copies: [] as Array<[string, string]>,
    copyError: null as { message: string } | null,
  },
}));

vi.mock("@tanstack/react-start", async () => (await import("@/test/serverFn")).reactStartStub());
vi.mock("@/integrations/supabase/require-staff", () => ({ requireStaff: {} }));
vi.mock("@/lib/server/rate-limit.server", () => ({
  rateLimit: async () => h.rateLimitOk,
}));
vi.mock("@/lib/server/audit.server", () => ({
  recordAudit: async (_client: unknown, entry: Record<string, unknown>) => {
    h.audits.push(entry);
  },
}));
vi.mock("@/lib/server/userTenant.server", () => ({
  resolveUserTenantId: async () => TENANT,
}));

const adminStubs = vi.hoisted(() => ({ from: null as SupabaseFromStub | null }));

vi.mock("@/integrations/supabase/client.server", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  adminStubs.from = from;
  return {
    supabaseAdmin: {
      from: from.from,
      storage: {
        from: () => ({
          remove: async (paths: string[]) => {
            h.storage.removed.push(paths);
            return { error: h.storage.removeError };
          },
          copy: async (source: string, target: string) => {
            h.storage.copies.push([source, target]);
            return { error: h.storage.copyError };
          },
          getPublicUrl: (path: string) => ({
            data: { publicUrl: `https://cdn.example/${path}` },
          }),
        }),
      },
    },
  };
});

import {
  registerMediaUpload,
  deleteMedia,
  bulkDeleteMedia,
  bulkMoveMedia,
  updateMediaMeta,
  duplicateMedia,
  createMediaFolder,
  renameMediaFolder,
  deleteMediaFolder,
  getMediaUsage,
  regenerateThumbnails,
  type MediaUsageItem,
  type ThumbnailRegenResult,
} from "@/lib/media.functions";
import { supabaseFromStub } from "@/test/supabaseChain";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const MEDIA_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEDIA_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let user: SupabaseFromStub;

/** Kontekst, jaki middleware `requireStaff` wstawia handlerowi. */
function ctx() {
  return { supabase: { from: user.from }, userId: USER };
}

/** Domyślny profil: użytkownik należy do TENANT. */
function withProfile(tenantId: string | null = TENANT) {
  user.setResponse("profiles", ok(tenantId === null ? {} : { tenant_id: tenantId }));
}

beforeEach(() => {
  user = supabaseFromStub();
  adminStubs.from?.reset();
  h.audits.length = 0;
  h.rateLimitOk = true;
  h.storage.removed.length = 0;
  h.storage.copies.length = 0;
  h.storage.removeError = null;
  h.storage.copyError = null;
  withProfile();
});

// ---------------------------------------------------------------------------
// registerMediaUpload - bramka wejścia do biblioteki
// ---------------------------------------------------------------------------

const UPLOAD = {
  storagePath: `${TENANT}/${USER}/1700000000-abc.png`,
  filename: "zdjecie.png",
  mimeType: "image/png",
  sizeBytes: 1024,
  publicUrl: "https://cdn.example/a.png",
};

describe("registerMediaUpload - prefiks tenanta w ścieżce", () => {
  it("rejestruje plik z prefiksem własnego tenanta", async () => {
    user.setResponse("media", ok({ id: MEDIA_A }));
    const out = await callServerFn(registerMediaUpload, UPLOAD, ctx());
    expect(out).toEqual({ id: MEDIA_A });
  });

  it("ODRZUCA ścieżkę z prefiksem cudzego tenanta", async () => {
    // To jest ta bramka: klient wgrywa plik prosto do storage i dopiero potem
    // rejestruje go tutaj. Bez porównania z tenantem z `profiles` mógłby
    // zarejestrować w swojej bibliotece obiekt leżący pod cudzym prefiksem.
    user.setResponse("media", ok({ id: MEDIA_A }));
    await expect(
      callServerFn(
        registerMediaUpload,
        { ...UPLOAD, storagePath: `${OTHER_TENANT}/${USER}/a.png` },
        ctx(),
      ),
    ).rejects.toThrow("Storage path tenant prefix mismatch");
  });

  it("ODRZUCA prefiks, który nie jest UUID-em", async () => {
    await expect(
      callServerFn(registerMediaUpload, { ...UPLOAD, storagePath: `public/a.png` }, ctx()),
    ).rejects.toThrow("Storage path tenant prefix mismatch");
  });

  it("porównuje prefiks BEZ względu na wielkość liter", async () => {
    // Postgres oddaje UUID małymi literami, ale klient bywa źródłem wersji
    // wielkoliterowej - to ten sam katalog, nie cudzy.
    user.setResponse("media", ok({ id: MEDIA_A }));
    const out = await callServerFn(
      registerMediaUpload,
      { ...UPLOAD, storagePath: `${TENANT.toUpperCase()}/${USER}/a.png` },
      ctx(),
    );
    expect(out).toEqual({ id: MEDIA_A });
  });

  it("ODRZUCA ścieżkę zawierającą segment nadrzędny", async () => {
    user.setResponse("media", ok({ id: MEDIA_A }));
    await expect(
      callServerFn(
        registerMediaUpload,
        { ...UPLOAD, storagePath: `${TENANT}/../${OTHER_TENANT}/a.png` },
        ctx(),
      ),
    ).rejects.toThrow("Invalid storage path");
  });

  it("ODRZUCA użytkownika bez tenanta - fail-closed", async () => {
    withProfile(null);
    await expect(callServerFn(registerMediaUpload, UPLOAD, ctx())).rejects.toThrow(
      "No tenant for current user",
    );
  });
});

describe("registerMediaUpload - typ i rozmiar", () => {
  it("ODRZUCA SVG, bo bucket jest publiczny i serwuje bajty wprost", async () => {
    // SVG może wykonać osadzony <script> - stored XSS. Upload idzie
    // browser -> storage z pominięciem sanityzacji, więc jedyną pewną obroną
    // jest zablokowanie typu przy rejestracji.
    await expect(
      callServerFn(registerMediaUpload, { ...UPLOAD, mimeType: "image/svg+xml" }, ctx()),
    ).rejects.toThrow("Disallowed mime type: image/svg+xml");
  });

  it.each(["text/html", "application/javascript", "application/x-msdownload"])(
    "ODRZUCA typ %s",
    async (mimeType) => {
      await expect(
        callServerFn(registerMediaUpload, { ...UPLOAD, mimeType }, ctx()),
      ).rejects.toThrow("Disallowed mime type");
    },
  );

  it("ODRZUCA obraz powyżej 10 MB", async () => {
    await expect(
      callServerFn(registerMediaUpload, { ...UPLOAD, sizeBytes: 10 * 1024 * 1024 + 1 }, ctx()),
    ).rejects.toThrow("File too large for image/png");
  });

  it("PRZEPUSZCZA odcinek podcastu grubo powyżej limitu obrazu", async () => {
    // Pułap jest per typ: audio ma 300 MB, bo epizody podcastu idą tą samą
    // drogą co obrazy. Wspólny limit 10 MB uciąłby całą bibliotekę podcastów.
    user.setResponse("media", ok({ id: MEDIA_A }));
    const out = await callServerFn(
      registerMediaUpload,
      { ...UPLOAD, mimeType: "audio/mpeg", sizeBytes: 120 * 1024 * 1024 },
      ctx(),
    );
    expect(out).toEqual({ id: MEDIA_A });
  });

  it("ODRZUCA wideo powyżej 200 MB", async () => {
    await expect(
      callServerFn(
        registerMediaUpload,
        { ...UPLOAD, mimeType: "video/mp4", sizeBytes: 200 * 1024 * 1024 + 1 },
        ctx(),
      ),
    ).rejects.toThrow("File too large for video/mp4");
  });

  it("ODRZUCA rozmiar ponad twardy pułap schematu jeszcze przed handlerem", async () => {
    await expect(
      callServerFn(
        registerMediaUpload,
        { ...UPLOAD, mimeType: "audio/mpeg", sizeBytes: 400 * 1024 * 1024 },
        ctx(),
      ),
    ).rejects.toThrow();
  });
});

describe("registerMediaUpload - limit tempa i zapis", () => {
  it("ODRZUCA po przekroczeniu limitu wgrań", async () => {
    h.rateLimitOk = false;
    await expect(callServerFn(registerMediaUpload, UPLOAD, ctx())).rejects.toThrow(
      "Too many uploads, slow down",
    );
  });

  it("wstawia tenanta Z PROFILU, nie z żądania", async () => {
    user.setResponse("media", ok({ id: MEDIA_A }));
    await callServerFn(registerMediaUpload, UPLOAD, ctx());
    expect(user.lastChain("media")?.argsOf("insert")?.[0]).toMatchObject({
      tenant_id: TENANT,
      uploader_id: USER,
      storage_path: UPLOAD.storagePath,
    });
  });

  it("zapisuje wpis audytu z nazwą, typem i rozmiarem", async () => {
    user.setResponse("media", ok({ id: MEDIA_A }));
    await callServerFn(registerMediaUpload, UPLOAD, ctx());
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({
      tenantId: TENANT,
      action: "media.upload",
      entityId: MEDIA_A,
    });
  });

  it("błąd wstawienia wychodzi na wierzch i NIE zapisuje audytu", async () => {
    user.setResponse("media", fail("naruszenie klucza"));
    await expect(callServerFn(registerMediaUpload, UPLOAD, ctx())).rejects.toThrow(
      "naruszenie klucza",
    );
    expect(h.audits).toHaveLength(0);
  });

  it("brak alt-tekstu zapisuje null, nie undefined", async () => {
    user.setResponse("media", ok({ id: MEDIA_A }));
    await callServerFn(registerMediaUpload, UPLOAD, ctx());
    expect(user.lastChain("media")?.argsOf("insert")?.[0]).toMatchObject({ alt_text: null });
  });
});

// ---------------------------------------------------------------------------
// deleteMedia - operacja NIEODWRACALNA
// ---------------------------------------------------------------------------

describe("deleteMedia", () => {
  const row = { id: MEDIA_A, tenant_id: TENANT, storage_path: `${TENANT}/${USER}/a.png` };

  it("kasuje obiekt ze storage, potem wiersz, potem zapisuje audyt", async () => {
    let selected = false;
    user.setResponse("media", (chain) => {
      if (chain.has("delete")) return ok(null);
      selected = true;
      return ok(row);
    });

    expect(await callServerFn(deleteMedia, { mediaId: MEDIA_A }, ctx())).toEqual({ ok: true });
    expect(selected).toBe(true);
    expect(h.storage.removed).toEqual([[row.storage_path]]);
    expect(h.audits[0]).toMatchObject({
      action: "media.delete",
      entityId: MEDIA_A,
      metadata: { storage_path: row.storage_path },
    });
  });

  it("ODMAWIA, gdy wiersz jest niewidoczny dla wołającego", async () => {
    // Odczyt idzie klientem UŻYTKOWNIKA - RLS decyduje, czy wiersz istnieje.
    // Brak wiersza musi zatrzymać operację PRZED dotknięciem storage, bo
    // kasowanie obiektu leci klientem administracyjnym z pominięciem RLS.
    user.setResponse("media", ok(null));
    await expect(callServerFn(deleteMedia, { mediaId: MEDIA_A }, ctx())).rejects.toThrow(
      "Media not found or access denied",
    );
    expect(h.storage.removed).toEqual([]);
  });

  it("błąd odczytu zatrzymuje operację przed storage", async () => {
    user.setResponse("media", fail("odmowa odczytu"));
    await expect(callServerFn(deleteMedia, { mediaId: MEDIA_A }, ctx())).rejects.toThrow(
      "odmowa odczytu",
    );
    expect(h.storage.removed).toEqual([]);
  });

  it("porażka kasowania w storage NIE blokuje kasowania wiersza", async () => {
    // Świadoma decyzja: osierocony obiekt w buckecie jest mniejszym złem niż
    // wiersz wskazujący na plik, którego nie ma. Pin, żeby zmiana była decyzją.
    h.storage.removeError = { message: "obiekt nie istnieje" };
    user.setResponse("media", (chain) => (chain.has("delete") ? ok(null) : ok(row)));

    expect(await callServerFn(deleteMedia, { mediaId: MEDIA_A }, ctx())).toEqual({ ok: true });
    expect(h.audits).toHaveLength(1);
  });

  it("błąd kasowania wiersza wychodzi na wierzch i NIE zapisuje audytu", async () => {
    user.setResponse("media", (chain) =>
      chain.has("delete") ? fail("wiersz zablokowany") : ok(row),
    );
    await expect(callServerFn(deleteMedia, { mediaId: MEDIA_A }, ctx())).rejects.toThrow(
      "wiersz zablokowany",
    );
    expect(h.audits).toHaveLength(0);
  });

  it("ODRZUCA identyfikator, który nie jest UUID-em", async () => {
    await expect(callServerFn(deleteMedia, { mediaId: "../etc/passwd" }, ctx())).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// bulkDeleteMedia
// ---------------------------------------------------------------------------

describe("bulkDeleteMedia", () => {
  const rows = [
    { id: MEDIA_A, tenant_id: TENANT, storage_path: `${TENANT}/${USER}/a.png` },
    { id: MEDIA_B, tenant_id: TENANT, storage_path: `${TENANT}/${USER}/b.png` },
  ];

  it("kasuje wszystkie obiekty JEDNYM wywołaniem storage", async () => {
    user.setResponse("media", (chain) => (chain.has("delete") ? ok(null) : ok(rows)));
    const out = await callServerFn(bulkDeleteMedia, { mediaIds: [MEDIA_A, MEDIA_B] }, ctx());
    expect(out).toEqual({ ok: true, deleted: 2 });
    expect(h.storage.removed).toEqual([[rows[0].storage_path, rows[1].storage_path]]);
  });

  it("pusty wynik odczytu NIE dotyka storage", async () => {
    // Kluczowe przy identyfikatorach spoza tenanta: RLS odcina je na SELECT-cie,
    // a wtedy nie wolno kasować NICZEGO - także nie wolno wołać remove([]).
    user.setResponse("media", ok([]));
    expect(await callServerFn(bulkDeleteMedia, { mediaIds: [MEDIA_A] }, ctx())).toEqual({
      ok: true,
      deleted: 0,
    });
    expect(h.storage.removed).toEqual([]);
    expect(h.audits).toHaveLength(0);
  });

  it("kasuje DOKŁADNIE te wiersze, które zwrócił odczyt", async () => {
    user.setResponse("media", (chain) => (chain.has("delete") ? ok(null) : ok([rows[0]])));
    await callServerFn(bulkDeleteMedia, { mediaIds: [MEDIA_A, MEDIA_B] }, ctx());
    const del = user.chainsFor("media").find((c) => c.has("delete"));
    expect(del?.argsOf("in")).toEqual(["id", [MEDIA_A]]);
  });

  it("ODRZUCA pustą listę i listę powyżej 500 pozycji", async () => {
    await expect(callServerFn(bulkDeleteMedia, { mediaIds: [] }, ctx())).rejects.toThrow();
    const many = Array.from({ length: 501 }, () => MEDIA_A);
    await expect(callServerFn(bulkDeleteMedia, { mediaIds: many }, ctx())).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// bulkMoveMedia / updateMediaMeta
// ---------------------------------------------------------------------------

describe("bulkMoveMedia", () => {
  it("normalizuje folder docelowy przed zapisem", async () => {
    user.setResponse("media", ok([{ id: MEDIA_A, tenant_id: TENANT }]));
    const out = await callServerFn(
      bulkMoveMedia,
      { mediaIds: [MEDIA_A], folderPath: "press//2026" },
      ctx(),
    );
    expect(out).toEqual({ ok: true, moved: 1 });
    expect(user.lastChain("media")?.argsOf("update")?.[0]).toEqual({ folder_path: "/press/2026/" });
  });

  it("ODRZUCA folder wyprowadzający poza drzewo", async () => {
    await expect(
      callServerFn(bulkMoveMedia, { mediaIds: [MEDIA_A], folderPath: "/press/../tajne/" }, ctx()),
    ).rejects.toThrow("Invalid folder path");
  });

  it("nie zapisuje audytu, gdy nic się nie przeniosło", async () => {
    user.setResponse("media", ok([]));
    expect(
      await callServerFn(bulkMoveMedia, { mediaIds: [MEDIA_A], folderPath: "/press/" }, ctx()),
    ).toEqual({ ok: true, moved: 0 });
    expect(h.audits).toHaveLength(0);
  });
});

describe("updateMediaMeta", () => {
  it("czyści ukośniki z nazwy pliku - nazwa nie może udawać ścieżki", async () => {
    user.setResponse("media", ok({ id: MEDIA_A, tenant_id: TENANT }));
    await callServerFn(updateMediaMeta, { mediaId: MEDIA_A, filename: "../../etc/passwd" }, ctx());
    expect(user.lastChain("media")?.argsOf("update")?.[0]).toEqual({
      filename: "..-..-etc-passwd",
    });
  });

  it("ODRZUCA nazwę, z której po oczyszczeniu nic nie zostaje", async () => {
    // Same białe znaki przechodzą schemat (`min(1)` liczy znaki), ale po
    // `trim()` zostaje pustka - i to musi zatrzymać zapis, bo plik bez nazwy
    // znika z listy i z wyszukiwarki biblioteki.
    await expect(
      callServerFn(updateMediaMeta, { mediaId: MEDIA_A, filename: "   " }, ctx()),
    ).rejects.toThrow("Invalid filename");
  });

  it("ukośnik otoczony spacjami zostaje myślnikiem, a nie pustką", async () => {
    // Granica sąsiadująca z poprzednim przypadkiem: " / " czyści się do "-",
    // czyli nazwy KRÓTKIEJ, ale prawidłowej - zapis ma przejść.
    user.setResponse("media", ok({ id: MEDIA_A, tenant_id: TENANT }));
    await callServerFn(updateMediaMeta, { mediaId: MEDIA_A, filename: " / " }, ctx());
    expect(user.lastChain("media")?.argsOf("update")?.[0]).toEqual({ filename: "-" });
  });

  it("puste żądanie kończy się bez zapisu", async () => {
    // Bez tego strażnika PostgREST dostałby UPDATE z pustym payloadem.
    expect(await callServerFn(updateMediaMeta, { mediaId: MEDIA_A }, ctx())).toEqual({ ok: true });
    expect(user.chainsFor("media")).toHaveLength(0);
  });

  it("pozwala WYCZYŚCIĆ alt-tekst jawnym nullem", async () => {
    user.setResponse("media", ok({ id: MEDIA_A, tenant_id: TENANT }));
    await callServerFn(updateMediaMeta, { mediaId: MEDIA_A, altText: null }, ctx());
    expect(user.lastChain("media")?.argsOf("update")?.[0]).toEqual({ alt_text: null });
  });

  it("normalizuje folder przy przenoszeniu pojedynczego pliku", async () => {
    user.setResponse("media", ok({ id: MEDIA_A, tenant_id: TENANT }));
    await callServerFn(updateMediaMeta, { mediaId: MEDIA_A, folderPath: "press" }, ctx());
    expect(user.lastChain("media")?.argsOf("update")?.[0]).toEqual({ folder_path: "/press/" });
  });
});

// ---------------------------------------------------------------------------
// duplicateMedia - kopia w storage
// ---------------------------------------------------------------------------

describe("duplicateMedia", () => {
  const source = {
    id: MEDIA_A,
    storage_path: `${TENANT}/${USER}/a.PNG`,
    filename: "raport roczny.png",
    mime_type: "image/png",
    size_bytes: 10,
    alt_text: null,
  };

  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  it("kopiuje obiekt pod NOWY klucz z prefiksem tenanta i użytkownika", async () => {
    user.setResponse("media", (chain) =>
      chain.has("insert") ? ok({ id: MEDIA_B }) : ok([source]),
    );
    const out = await callServerFn(
      duplicateMedia,
      { mediaIds: [MEDIA_A], folderPath: "/press/" },
      ctx(),
    );

    expect(out).toEqual({ ok: true, ids: [MEDIA_B] });
    const [[from, to]] = h.storage.copies;
    expect(from).toBe(source.storage_path);
    expect(to.startsWith(`${TENANT}/${USER}/`)).toBe(true);
    expect(to.endsWith(".png")).toBe(true);
  });

  it("dokleja sufiks kopii PRZED rozszerzeniem", async () => {
    user.setResponse("media", (chain) =>
      chain.has("insert") ? ok({ id: MEDIA_B }) : ok([source]),
    );
    await callServerFn(duplicateMedia, { mediaIds: [MEDIA_A], folderPath: "/" }, ctx());
    expect(user.lastChain("media")?.argsOf("insert")?.[0]).toMatchObject({
      filename: "raport roczny - kopia.png",
    });
  });

  it("radzi sobie z plikiem BEZ rozszerzenia", async () => {
    const noExt = { ...source, filename: "raport", storage_path: `${TENANT}/${USER}/a` };
    user.setResponse("media", (chain) => (chain.has("insert") ? ok({ id: MEDIA_B }) : ok([noExt])));
    await callServerFn(duplicateMedia, { mediaIds: [MEDIA_A], folderPath: "/" }, ctx());
    expect(user.lastChain("media")?.argsOf("insert")?.[0]).toMatchObject({
      filename: "raport - kopia",
    });
  });

  it("POMIJA plik, którego nie udało się skopiować, i kończy resztę", async () => {
    // Częściowa porażka nie może przewrócić całej operacji - użytkownik
    // zaznaczył dziesięć plików, jeden zniknął z bucketu.
    h.storage.copyError = { message: "źródło nie istnieje" };
    user.setResponse("media", (chain) =>
      chain.has("insert") ? ok({ id: MEDIA_B }) : ok([source]),
    );

    expect(
      await callServerFn(duplicateMedia, { mediaIds: [MEDIA_A], folderPath: "/" }, ctx()),
    ).toEqual({ ok: true, ids: [] });
    expect(user.chainsFor("media").some((c) => c.has("insert"))).toBe(false);
  });

  it("POMIJA plik, którego nie udało się zarejestrować", async () => {
    user.setResponse("media", (chain) =>
      chain.has("insert") ? fail("naruszenie ograniczenia") : ok([source]),
    );
    expect(
      await callServerFn(duplicateMedia, { mediaIds: [MEDIA_A], folderPath: "/" }, ctx()),
    ).toEqual({ ok: true, ids: [] });
  });

  it("ODRZUCA folder docelowy wyprowadzający poza drzewo", async () => {
    await expect(
      callServerFn(duplicateMedia, { mediaIds: [MEDIA_A], folderPath: "/../" }, ctx()),
    ).rejects.toThrow("Invalid folder path");
  });

  it("sanityzuje rozszerzenie wzięte z klucza źródłowego", async () => {
    // Rozszerzenie leci do NAZWY nowego obiektu w buckecie - musi zostać
    // sprowadzone do małych liter i znaków alfanumerycznych.
    const odd = { ...source, storage_path: `${TENANT}/${USER}/a.P N!G` };
    user.setResponse("media", (chain) => (chain.has("insert") ? ok({ id: MEDIA_B }) : ok([odd])));
    await callServerFn(duplicateMedia, { mediaIds: [MEDIA_A], folderPath: "/" }, ctx());
    expect(h.storage.copies[0][1].endsWith(".png")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Foldery
// ---------------------------------------------------------------------------

describe("createMediaFolder", () => {
  it("tworzy CAŁY łańcuch przodków, nie tylko liść", async () => {
    // Inaczej folder zagnieżdżony byłby niewidoczny w drzewie - rodzic nie
    // istniałby jako wiersz.
    user.setResponse("media_folders", ok(null));
    const out = await callServerFn(createMediaFolder, { path: "/press/2026/q1/" }, ctx());
    expect(out).toEqual({ ok: true, path: "/press/2026/q1/" });
    const rows = user.lastChain("media_folders")?.argsOf("upsert")?.[0] as Array<{ path: string }>;
    expect(rows.map((r) => r.path)).toEqual(["/press/", "/press/2026/", "/press/2026/q1/"]);
  });

  it("ODMAWIA tworzenia katalogu głównego", async () => {
    await expect(callServerFn(createMediaFolder, { path: "/" }, ctx())).rejects.toThrow(
      "Root folder always exists",
    );
  });

  it("ODRZUCA ścieżkę wyprowadzającą poza drzewo", async () => {
    await expect(
      callServerFn(createMediaFolder, { path: "/press/../tajne/" }, ctx()),
    ).rejects.toThrow("Invalid folder path");
  });

  it("błąd zapisu wychodzi na wierzch", async () => {
    user.setResponse("media_folders", fail("duplikat"));
    await expect(callServerFn(createMediaFolder, { path: "/press/" }, ctx())).rejects.toThrow(
      "duplikat",
    );
  });
});

describe("renameMediaFolder", () => {
  it("przepina foldery potomne i pliki na nowy prefiks", async () => {
    user.setResponse("media_folders", (chain) =>
      chain.has("update") ? ok(null) : ok([{ id: "f1", path: "/press/2026/" }]),
    );
    user.setResponse("media", (chain) =>
      chain.has("update") ? ok(null) : ok([{ id: MEDIA_A, folder_path: "/press/2026/" }]),
    );

    await callServerFn(renameMediaFolder, { oldPath: "/press/", newPath: "/prasa/" }, ctx());

    const folderUpdate = user.chainsFor("media_folders").find((c) => c.has("update"));
    expect(folderUpdate?.argsOf("update")?.[0]).toEqual({ path: "/prasa/2026/" });
    const mediaUpdate = user.chainsFor("media").find((c) => c.has("update"));
    expect(mediaUpdate?.argsOf("update")?.[0]).toEqual({ folder_path: "/prasa/2026/" });
  });

  it("szuka potomków ESCAPOWANYM wzorcem LIKE", async () => {
    // Folder "raporty_2026" nie może złapać "raportyX2026": nieescapowane
    // podkreślenie jest w LIKE jednoznakowym wildcardem, więc operacja
    // przepięłaby cudze pliki w obrębie tenanta.
    user.setResponse("media_folders", ok([]));
    user.setResponse("media", ok([]));
    await callServerFn(
      renameMediaFolder,
      { oldPath: "/raporty_2026/", newPath: "/raporty 2026/" },
      ctx(),
    );
    expect(user.chainsFor("media_folders")[0]?.argsOf("like")).toEqual([
      "path",
      "/raporty\\_2026/%",
    ]);
    expect(user.chainsFor("media")[0]?.argsOf("like")).toEqual([
      "folder_path",
      "/raporty\\_2026/%",
    ]);
  });

  it("ODMAWIA zmiany nazwy katalogu głównego w obie strony", async () => {
    await expect(
      callServerFn(renameMediaFolder, { oldPath: "/", newPath: "/prasa/" }, ctx()),
    ).rejects.toThrow("Cannot rename root");
    await expect(
      callServerFn(renameMediaFolder, { oldPath: "/press/", newPath: "/" }, ctx()),
    ).rejects.toThrow("Cannot rename root");
  });

  it("zmiana na tę samą ścieżkę kończy się bez żadnego zapisu", async () => {
    expect(
      await callServerFn(renameMediaFolder, { oldPath: "/press/", newPath: "press" }, ctx()),
    ).toEqual({ ok: true });
    expect(user.chainsFor("media_folders")).toHaveLength(0);
  });

  it("błąd przepięcia folderu przerywa operację", async () => {
    user.setResponse("media_folders", (chain) =>
      chain.has("update") ? fail("konflikt ścieżki") : ok([{ id: "f1", path: "/press/" }]),
    );
    await expect(
      callServerFn(renameMediaFolder, { oldPath: "/press/", newPath: "/prasa/" }, ctx()),
    ).rejects.toThrow("konflikt ścieżki");
  });
});

describe("deleteMediaFolder - operacja NIEODWRACALNA", () => {
  /** Atrapa `media`: zapytanie liczące oddaje `count`, zwykłe - wiersze. */
  function mediaWith(count: number, rows: Array<{ id: string; storage_path: string }>) {
    user.setResponse("media", (chain): SupabaseResult => {
      const selectArgs = chain.argsOf("select");
      const isCount = (selectArgs?.[1] as { head?: boolean } | undefined)?.head === true;
      if (isCount) return okCount(count);
      if (chain.has("delete")) return ok(null);
      return ok(rows);
    });
  }

  it("ODMAWIA skasowania NIEPUSTEGO folderu bez zgody na rekursję", async () => {
    // To jest ta bramka: bez niej jedno kliknięcie kasuje zawartość, o której
    // użytkownik nie wiedział.
    mediaWith(3, []);
    user.setResponse("media_folders", ok(null));
    await expect(
      callServerFn(deleteMediaFolder, { path: "/press/", recursive: false }, ctx()),
    ).rejects.toThrow("Folder is not empty");
    expect(h.storage.removed).toEqual([]);
  });

  it("kasuje PUSTY folder bez dotykania storage", async () => {
    mediaWith(0, []);
    user.setResponse("media_folders", ok(null));
    expect(
      await callServerFn(deleteMediaFolder, { path: "/press/", recursive: false }, ctx()),
    ).toEqual({ ok: true });
    expect(h.storage.removed).toEqual([]);
  });

  it("rekursywnie kasuje obiekty, wiersze i same foldery", async () => {
    mediaWith(2, [
      { id: MEDIA_A, storage_path: `${TENANT}/${USER}/a.png` },
      { id: MEDIA_B, storage_path: `${TENANT}/${USER}/b.png` },
    ]);
    user.setResponse("media_folders", ok(null));

    expect(
      await callServerFn(deleteMediaFolder, { path: "/press/", recursive: true }, ctx()),
    ).toEqual({ ok: true });
    expect(h.storage.removed).toEqual([[`${TENANT}/${USER}/a.png`, `${TENANT}/${USER}/b.png`]]);
    const del = user.chainsFor("media").find((c) => c.has("delete"));
    expect(del?.argsOf("in")).toEqual(["id", [MEDIA_A, MEDIA_B]]);
    expect(h.audits[0]).toMatchObject({
      action: "media.folder_delete",
      metadata: { path: "/press/", recursive: true },
    });
  });

  it("ODMAWIA skasowania katalogu głównego", async () => {
    await expect(
      callServerFn(deleteMediaFolder, { path: "/", recursive: true }, ctx()),
    ).rejects.toThrow("Cannot delete root");
  });

  it("ODRZUCA ścieżkę wyprowadzającą poza drzewo", async () => {
    await expect(
      callServerFn(deleteMediaFolder, { path: "/press/../", recursive: true }, ctx()),
    ).rejects.toThrow("Invalid folder path");
  });

  it("domyślnie NIE jest rekursywne", async () => {
    // Domyślna wartość schematu jest tu decyzją bezpieczeństwa, nie wygodą.
    mediaWith(1, []);
    user.setResponse("media_folders", ok(null));
    await expect(callServerFn(deleteMediaFolder, { path: "/press/" }, ctx())).rejects.toThrow(
      "Folder is not empty",
    );
  });

  it("błąd kasowania folderów wychodzi na wierzch", async () => {
    mediaWith(0, []);
    user.setResponse("media_folders", fail("folder w użyciu"));
    await expect(
      callServerFn(deleteMediaFolder, { path: "/press/", recursive: false }, ctx()),
    ).rejects.toThrow("folder w użyciu");
  });
});

// ---------------------------------------------------------------------------
// getMediaUsage - "gdzie ten plik jest używany"
// ---------------------------------------------------------------------------

describe("getMediaUsage", () => {
  const MEDIA_URL = "https://cdn.example/media/okladka.png";
  const MEDIA_PATH = `${TENANT}/${USER}/okladka.png`;

  /** Wiersz mediów + rodzeństwo o tej samej nazwie pliku. */
  function mediaRow(siblings: Array<Record<string, unknown>> = []) {
    user.setResponse("media", (chain) => {
      const eq = chain.argsOf("eq");
      if (eq?.[0] === "filename") return ok(siblings);
      return ok({
        id: MEDIA_A,
        public_url: MEDIA_URL,
        storage_path: MEDIA_PATH,
        filename: "okladka.png",
      });
    });
  }

  function admin() {
    const a = adminStubs.from;
    if (!a) throw new Error("test: atrapa klienta administracyjnego nie istnieje");
    return a;
  }

  function noContent() {
    admin().setResponse("posts", ok([]));
    admin().setResponse("pages", ok([]));
  }

  it("znajduje wpis po adresie publicznym w okładce", async () => {
    mediaRow();
    admin().setResponse(
      "posts",
      ok([{ id: "p1", slug: "wpis", title_pl: "Wpis", cover_image_url: MEDIA_URL }]),
    );
    admin().setResponse("pages", ok([]));

    const out = await callServerFn<{ items: MediaUsageItem[] }>(
      getMediaUsage,
      { mediaId: MEDIA_A },
      ctx(),
    );
    expect(out.items).toEqual([
      { kind: "post", id: "p1", slug: "wpis", title: "Wpis", where: ["cover"] },
    ]);
  });

  it("rozpoznaje użycie w treści, zajawce, builderze, blokach i layoucie", async () => {
    mediaRow();
    admin().setResponse(
      "posts",
      ok([
        {
          id: "p1",
          slug: "wpis",
          title_pl: "Wpis",
          cover_image_url: null,
          excerpt_pl: `zajawka ${MEDIA_URL}`,
          content_en: `<img src="${MEDIA_URL}">`,
          builder_data: { widgets: [{ src: MEDIA_PATH }] },
          blocks_data: [{ url: MEDIA_URL }],
          layout_overrides: { hero: MEDIA_URL },
        },
      ]),
    );
    admin().setResponse("pages", ok([]));

    const out = await callServerFn<{ items: MediaUsageItem[] }>(
      getMediaUsage,
      { mediaId: MEDIA_A },
      ctx(),
    );
    expect(out.items[0].where).toEqual(["excerpt", "content", "builder", "blocks", "layout"]);
  });

  it("obszary użycia są NEUTRALNE JĘZYKOWO - tłumaczy je interfejs", async () => {
    // Serwer nie może zapiec jednego języka w danych: ten sam wynik czyta
    // panel PL i EN.
    mediaRow();
    admin().setResponse(
      "posts",
      ok([{ id: "p1", slug: "s", title_pl: "T", cover_image_url: MEDIA_URL }]),
    );
    admin().setResponse("pages", ok([]));

    const out = await callServerFn<{ items: MediaUsageItem[] }>(
      getMediaUsage,
      { mediaId: MEDIA_A },
      ctx(),
    );
    expect(out.items[0].where).toEqual(["cover"]);
  });

  it("traktuje DUPLIKAT o tej samej nazwie jak ten sam zasób", async () => {
    // Bez tego otwarcie kopii pliku pokazywałoby fałszywe "0 użyć", a operator
    // skasowałby zasób nadal osadzony we wpisach.
    const twinUrl = "https://cdn.example/media/okladka-kopia.png";
    mediaRow([{ id: MEDIA_B, public_url: twinUrl, storage_path: `${TENANT}/${USER}/kopia.png` }]);
    admin().setResponse(
      "posts",
      ok([{ id: "p1", slug: "s", title_pl: "T", cover_image_url: twinUrl }]),
    );
    admin().setResponse("pages", ok([]));

    const out = await callServerFn<{ items: MediaUsageItem[] }>(
      getMediaUsage,
      { mediaId: MEDIA_A },
      ctx(),
    );
    expect(out.items).toHaveLength(1);
  });

  it("skanuje także strony", async () => {
    mediaRow();
    admin().setResponse("posts", ok([]));
    admin().setResponse(
      "pages",
      ok([{ id: "g1", slug: "o-nas", title_en: "About", cover_image_url: MEDIA_URL }]),
    );

    const out = await callServerFn<{ items: MediaUsageItem[] }>(
      getMediaUsage,
      { mediaId: MEDIA_A },
      ctx(),
    );
    expect(out.items).toEqual([
      { kind: "page", id: "g1", slug: "o-nas", title: "About", where: ["cover"] },
    ]);
  });

  it("spada na slug, gdy wpis nie ma tytułu w żadnym języku", async () => {
    mediaRow();
    admin().setResponse(
      "posts",
      ok([
        { id: "p1", slug: "bez-tytulu", title_pl: "", title_en: null, cover_image_url: MEDIA_URL },
      ]),
    );
    admin().setResponse("pages", ok([]));

    const out = await callServerFn<{ items: MediaUsageItem[] }>(
      getMediaUsage,
      { mediaId: MEDIA_A },
      ctx(),
    );
    expect(out.items[0].title).toBe("bez-tytulu");
  });

  it("pomija wpisy bez ani jednego trafienia", async () => {
    mediaRow();
    admin().setResponse(
      "posts",
      ok([{ id: "p1", slug: "s", title_pl: "T", cover_image_url: "https://inny/plik.png" }]),
    );
    admin().setResponse("pages", ok([]));

    const out = await callServerFn<{ items: MediaUsageItem[] }>(
      getMediaUsage,
      { mediaId: MEDIA_A },
      ctx(),
    );
    expect(out.items).toEqual([]);
  });

  it("skan jest PRZYPIĘTY do tenanta wołającego i pomija kosz", async () => {
    // Odczyt idzie rolą serwisową (kolumny treści są odebrane roli
    // authenticated), więc filtr tenanta jest tu JEDYNĄ granicą izolacji.
    mediaRow();
    noContent();
    await callServerFn(getMediaUsage, { mediaId: MEDIA_A }, ctx());

    for (const table of ["posts", "pages"]) {
      const chain = admin().lastChain(table);
      expect(chain?.argsOf("eq")).toEqual(["tenant_id", TENANT]);
      expect(chain?.argsOf("is")).toEqual(["deleted_at", null]);
    }
  });

  it("ODMAWIA, gdy wiersz mediów jest niewidoczny dla wołającego", async () => {
    user.setResponse("media", ok(null));
    noContent();
    await expect(callServerFn(getMediaUsage, { mediaId: MEDIA_A }, ctx())).rejects.toThrow(
      "Media not found or access denied",
    );
  });

  it("błąd skanu wpisów wychodzi na wierzch", async () => {
    mediaRow();
    admin().setResponse("posts", fail("odmowa skanu"));
    admin().setResponse("pages", ok([]));
    await expect(callServerFn(getMediaUsage, { mediaId: MEDIA_A }, ctx())).rejects.toThrow(
      "odmowa skanu",
    );
  });

  it("błąd odczytu wiersza mediów wychodzi na wierzch", async () => {
    user.setResponse("media", fail("odmowa odczytu"));
    noContent();
    await expect(callServerFn(getMediaUsage, { mediaId: MEDIA_A }, ctx())).rejects.toThrow(
      "odmowa odczytu",
    );
  });
});

// ---------------------------------------------------------------------------
// regenerateThumbnails - rozgrzewanie wariantów w Storage
// ---------------------------------------------------------------------------

describe("regenerateThumbnails", () => {
  const SRC = "https://proj.supabase.co/storage/v1/object/public/media/a.jpg";

  function library(urls: Array<string | null>, sizes: Array<Record<string, unknown>>) {
    user.setResponse("media", ok(urls.map((public_url) => ({ public_url }))));
    user.setResponse("custom_crop_sizes", ok(sizes));
  }

  it("odpytuje KAŻDY rozmiar dla KAŻDEGO pliku metodą HEAD", async () => {
    // Natywny `sharp` nie działa w Workers - warianty materializuje sam
    // Supabase przy pierwszym żądaniu, więc rozgrzewka to seria HEAD-ów.
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    library([SRC, SRC], [{ name: "karta", width: 640, height: 360 }]);

    const out = await callServerFn<ThumbnailRegenResult>(regenerateThumbnails, {}, ctx());
    expect(out).toMatchObject({ media: 2, sizes: 1, ok: 2, failed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]).toEqual({ method: "HEAD" });
    vi.unstubAllGlobals();
  });

  it("liczy odpowiedź nie-2xx jako porażkę i zapisuje jej status", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 502 }));
    library([SRC], [{ name: "karta", width: 640, height: 360 }]);

    const out = await callServerFn<ThumbnailRegenResult>(regenerateThumbnails, {}, ctx());
    expect(out).toMatchObject({ ok: 0, failed: 1 });
    expect(out.details[0]).toMatchObject({ size: "karta", ok: false, status: 502 });
    vi.unstubAllGlobals();
  });

  it("wyjątek sieci nie przewraca całej rozgrzewki", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("ECONNRESET");
    });
    library([SRC], [{ name: "karta", width: 640, height: 360 }]);

    const out = await callServerFn<ThumbnailRegenResult>(regenerateThumbnails, {}, ctx());
    expect(out).toMatchObject({ ok: 0, failed: 1 });
    expect(out.details[0]).toMatchObject({ ok: false });
    expect(out.details[0].status).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("pomija wiersze bez adresu publicznego", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    library([null, SRC], [{ name: "karta", width: 640, height: 360 }]);

    const out = await callServerFn<ThumbnailRegenResult>(regenerateThumbnails, {}, ctx());
    expect(out.media).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("bez zdefiniowanych rozmiarów nie wykonuje ANI JEDNEGO żądania", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    library([SRC], []);

    const out = await callServerFn<ThumbnailRegenResult>(regenerateThumbnails, {}, ctx());
    expect(out).toMatchObject({ sizes: 0, ok: 0, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("ODMAWIA użytkownikowi bez tenanta", async () => {
    withProfile(null);
    await expect(callServerFn(regenerateThumbnails, {}, ctx())).rejects.toThrow("No tenant");
  });

  it("przycina raport do 200 pozycji, ale liczniki obejmują całość", async () => {
    // Raport wraca do przeglądarki - pełna lista przy tysiącach plików byłaby
    // odpowiedzią wielomegabajtową.
    vi.stubGlobal("fetch", async () => ({ ok: true, status: 200 }));
    library(
      Array.from({ length: 120 }, () => SRC),
      [
        { name: "a", width: 100, height: 100 },
        { name: "b", width: 200, height: 200 },
      ],
    );

    const out = await callServerFn<ThumbnailRegenResult>(regenerateThumbnails, {}, ctx());
    expect(out.ok).toBe(240);
    expect(out.details).toHaveLength(200);
    vi.unstubAllGlobals();
  });

  it("domyślny limit to 100 plików, a schemat odrzuca limit spoza zakresu", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: true, status: 200 }));
    library([SRC], []);
    await callServerFn(regenerateThumbnails, {}, ctx());
    expect(user.chainsFor("media")[0]?.argsOf("limit")).toEqual([100]);

    await expect(callServerFn(regenerateThumbnails, { limit: 0 }, ctx())).rejects.toThrow();
    await expect(callServerFn(regenerateThumbnails, { limit: 501 }, ctx())).rejects.toThrow();
    vi.unstubAllGlobals();
  });
});
