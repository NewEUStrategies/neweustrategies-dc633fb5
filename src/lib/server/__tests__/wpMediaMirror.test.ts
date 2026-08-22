// Lustrowanie mediow z importu WordPressa: co konczy sie plikiem w kubelku
// i wierszem w bazie, a co MUSI skonczyc sie odmowa bez zadnego sladu.
//
// CO TO DOWODZI. Redaktor klika "importuj", widzi licznik i wierzy
// podsumowaniu. Ten plik sprawdza, co ten licznik znaczy DLA DANYCH:
//   * zadna odmowa (404 na zrodle, plik ponad 15 MiB, MIME poza lista,
//     zerwane pobieranie, adres zablokowany przez bramke egress) nie tworzy
//     ani obiektu w kubelku, ani wiersza w tabeli - konczy sie pozycja
//     w `failed` i ostrzezeniem dla redakcji;
//   * sukces zapisuje plik do KUBELKA `media` klientem service-role, a wiersz
//     do TABELI `media` klientem uzytkownika (RLS + tenant), i tylko wtedy
//     oddaje publiczny adres do podmiany w tresci - czyli tresc nigdy nie
//     wskazuje na plik, ktorego nie ma;
//   * powtorny import tego samego pliku nie kupuje transferu i uploadu drugi
//     raz (dedup po sha256 w sciezce) i nie mnozy wierszy w bibliotece;
//   * kiedy insert wiersza padnie, plik NIE zostaje sierota w kubelku
//     (bo do sieroty nikt nigdy nie wroci - nie ma wiersza, ktory by ja opisal).
// Rok w sciezce (`<tenant>/wp-import/2026/<sha>.<ext>`) bierze sie z zegara,
// dlatego zegar jest ustalony: bez tego test przestalby dowodzic sciezki
// w noc Nowego Roku, a nie w chwili zmiany kodu.
//
// CZEGO SWIADOMIE NIE DUBLUJE.
//   * bramki SSRF nie sprawdzam tu wcale - `assertPublicHttpUrl` ma wlasny
//     plik (`src/lib/http/__tests__/egressGuard.test.ts`) i jest tu atrapa
//     bez DNS; dowodze tylko tego, ze JEJ ODMOWA zatrzymuje prace PRZED
//     `fetch`, i ze komunikat odmowy dociera do redakcji;
//   * autoryzacji nie sprawdzam, bo `mirrorWpMedia` nie jest server fn i nie
//     ma wlasnej kontroli uprawnien - dostaje gotowy klient uzytkownika
//     (RLS), tenant i userId od wolajacego. Wszystkie wolajace
//     (`wp-import.functions.ts`, `wordpress-import.functions.ts`) sa za
//     `requireStaff`, a ich testem jest
//     `src/lib/__tests__/wordpressImport.functions.test.ts`;
//   * sciezki importu BEZ lustrowania (`buildPageFromHtmlPair` z `mirror:
//     false`) dowodzi `src/lib/wp-import/__tests__/buildPage.test.ts`;
//   * grantow i polityk RLS na tabeli `media` dowodzi pgTAP - tutaj atrapa
//     zwraca to, co zaplanuje test, wiec o RLS nie moze powiedziec nic.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { BuilderDocument } from "@/lib/builder/types";
import {
  fail,
  ok,
  supabaseFromStub,
  type SupabaseFromStub,
  type SupabaseResult,
} from "@/test/supabaseChain";

/** Wynik `storage.upload` / `storage.remove` w ksztalcie, ktory czyta kod. */
type StorageWrite = () => Promise<{ error: { message: string } | null }>;
type UploadFn = (
  path: string,
  body: Uint8Array,
  options: { contentType: string; upsert: boolean },
) => ReturnType<StorageWrite>;
type RemoveFn = (paths: string[]) => ReturnType<StorageWrite>;
type PublicUrlFn = (path: string) => { data: { publicUrl: string } };

const h = vi.hoisted(() => ({
  fetchMock: vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(),
  guard: vi.fn<(raw: string) => Promise<URL>>(),
  upload: vi.fn<UploadFn>(),
  remove: vi.fn<RemoveFn>(),
  getPublicUrl: vi.fn<PublicUrlFn>(),
  /** Nazwy kubelkow, o ktore poprosil kod - `media` to KUBELEK, nie tabela. */
  buckets: [] as string[],
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    storage: {
      from: (bucket: string) => {
        h.buckets.push(bucket);
        return { upload: h.upload, remove: h.remove, getPublicUrl: h.getPublicUrl };
      },
    },
  },
}));
vi.mock("@/lib/http/egressGuard.server", () => ({ assertPublicHttpUrl: h.guard }));

import { mirrorWpMedia, rewriteBuilderDoc, rewriteHtml } from "@/lib/server/wp-media.server";

const TENANT = "tenant-1";
const USER = "user-1";
const IMG = "https://blog.test/wp-content/uploads/2024/05/wykres.png";
const IMG2 = "https://blog.test/wp-content/uploads/2024/05/tabela.png";
/** 15 MiB - dokladny limit z `MAX_BYTES` w module produkcyjnym. */
const MAX_BYTES = 15 * 1024 * 1024;

/** Powierzchnia klienta Supabase, ktorej dotyka ten modul. */
interface FromSurface {
  from: (table: string) => unknown;
}

/**
 * STRAZNIK, nie rzutowanie. `as unknown as SupabaseClient` przepuscilby atrape
 * BEZ ogniwa `from` - czyli test "przeszedlby" tam, gdzie kod produkcyjny nie
 * mialby czym wykonac zapytania. Ten warunek sprawdza to w runtime i dopiero
 * wtedy zaweza typ.
 */
function isDbClient(candidate: FromSurface): candidate is FromSurface & SupabaseClient<Database> {
  return typeof candidate.from === "function";
}

function userClient(stub: SupabaseFromStub): SupabaseClient<Database> {
  const candidate: FromSurface = { from: stub.from };
  if (!isDbClient(candidate)) throw new Error("test: atrapa nie niesie ogniwa from()");
  return candidate;
}

/** Wiersz, ktory kod wstawia do tabeli `media`. */
interface MediaInsertRow {
  tenant_id: string;
  uploader_id: string;
  storage_path: string;
  public_url: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
}

function isMediaInsertRow(value: unknown): value is MediaInsertRow {
  return (
    typeof value === "object" &&
    value !== null &&
    "tenant_id" in value &&
    typeof value.tenant_id === "string" &&
    "uploader_id" in value &&
    typeof value.uploader_id === "string" &&
    "storage_path" in value &&
    typeof value.storage_path === "string" &&
    "public_url" in value &&
    typeof value.public_url === "string" &&
    "filename" in value &&
    typeof value.filename === "string" &&
    "mime_type" in value &&
    typeof value.mime_type === "string" &&
    "size_bytes" in value &&
    typeof value.size_bytes === "number"
  );
}

/** Wiersz z argumentu `insert(...)` - brak wiersza to blad testu, nie `undefined`. */
function insertedRow(stub: SupabaseFromStub): MediaInsertRow {
  const chain = stub.chainsFor("media").find((c) => c.has("insert"));
  const payload = chain?.argsOf("insert")?.[0];
  if (!isMediaInsertRow(payload)) {
    throw new Error("test: kod nie wstawil wiersza `media` w oczekiwanym ksztalcie");
  }
  return payload;
}

/**
 * Odpowiedz `fetch` dla pliku binarnego (bez naglowka, gdy `contentType` null).
 * Bufor jest zawezony do `Uint8Array<ArrayBuffer>`, bo `BodyInit` nie przyjmuje
 * widoku nad `SharedArrayBuffer` - to zawezenie TYPU, nie rzutowanie.
 */
function fileResponse(
  bytes: Uint8Array<ArrayBuffer>,
  contentType: string | null,
  status = 200,
): Response {
  const headers = new Headers();
  if (contentType !== null) headers.set("content-type", contentType);
  return new Response(bytes, { status, headers });
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let db: SupabaseFromStub;

/**
 * Plan odpowiedzi tabeli `media`: SELECT (dedup) i INSERT to dwa rozne
 * lancuchy na tej samej tabeli, wiec responder rozroznia je po ogniwie.
 */
function planMedia(plan: { existing?: SupabaseResult; insert?: SupabaseResult }): void {
  db.setResponse("media", (chain) =>
    chain.has("insert") ? (plan.insert ?? ok({ id: "media-1" })) : (plan.existing ?? ok(null)),
  );
}

const baseOptions = () => ({
  html: `<p><img src="${IMG}" /></p>`,
  tenantId: TENANT,
  userId: USER,
  supabase: userClient(db),
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-21T10:00:00.000Z"));
  vi.stubGlobal("fetch", h.fetchMock);
  db = supabaseFromStub();
  h.buckets.length = 0;
  h.fetchMock.mockReset();
  h.guard.mockReset();
  h.upload.mockReset();
  h.remove.mockReset();
  h.getPublicUrl.mockReset();
  // Atrapa bramki egress: BEZ DNS, ale z tym samym rozstrzygnieciem dla
  // adresow, ktorych nie da sie sparsowac i dla schematu innego niz https.
  h.guard.mockImplementation(async (raw: string) => {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error("blocked_url:unparseable");
    }
    if (url.protocol !== "https:") throw new Error("blocked_url:scheme");
    return url;
  });
  h.fetchMock.mockImplementation(async () => fileResponse(PNG, "image/png"));
  h.upload.mockResolvedValue({ error: null });
  h.remove.mockResolvedValue({ error: null });
  h.getPublicUrl.mockImplementation((path: string) => ({
    data: { publicUrl: `https://cdn.test/storage/v1/object/public/media/${path}` },
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("mirrorWpMedia - co w ogole trafia do pobrania", () => {
  it("tresc bez mediow nie dotyka ani sieci, ani bazy, ani kubelka", async () => {
    const result = await mirrorWpMedia({ ...baseOptions(), html: "<p>Sam tekst</p>" });

    expect(result).toEqual({
      map: new Map(),
      warnings: [],
      mirroredCount: 0,
      reusedCount: 0,
      failed: [],
    });
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(db.chains).toEqual([]);
    expect(h.buckets).toEqual([]);
  });

  it("ten sam adres powtorzony w tresci sciagany jest raz", async () => {
    planMedia({});
    const html = `<img src="${IMG}"><a href="${IMG}">plik</a><img data-src="${IMG}">`;

    const result = await mirrorWpMedia({ ...baseOptions(), html });

    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    expect(result.mirroredCount).toBe(1);
  });

  it("adres spoza /wp-content/uploads/ jest pomijany BEZ pobrania i bez wpisu w failed", async () => {
    const cdn = "https://cdn.obcy.test/assets/banner.png";

    const result = await mirrorWpMedia({ ...baseOptions(), html: `<img src="${cdn}">` });

    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(result.failed).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(db.chains).toEqual([]);
  });

  it("ten sam adres z includeExternal jest juz lustrowany", async () => {
    planMedia({});
    const cdn = "https://cdn.obcy.test/assets/banner.png";

    const result = await mirrorWpMedia({
      ...baseOptions(),
      html: `<img src="${cdn}">`,
      includeExternal: true,
    });

    expect(h.fetchMock).toHaveBeenCalledWith(cdn, { method: "GET", redirect: "manual" });
    expect(result.mirroredCount).toBe(1);
  });

  it("na jedna strone bierze najwyzej 200 zasobow", async () => {
    planMedia({});
    const extraUrls = Array.from(
      { length: 201 },
      (_, i) => `https://blog.test/wp-content/uploads/2024/05/plik-${i}.png`,
    );

    const result = await mirrorWpMedia({ ...baseOptions(), html: "", extraUrls });

    expect(h.fetchMock).toHaveBeenCalledTimes(200);
    expect(result.mirroredCount).toBe(200);
  });
});

describe("mirrorWpMedia - odmowy nie zostawiaja sladu", () => {
  it("404 na zrodle: brak uploadu, brak wiersza, powod w podsumowaniu", async () => {
    h.fetchMock.mockImplementation(async () => fileResponse(new Uint8Array(), null, 404));

    const result = await mirrorWpMedia(baseOptions());

    expect(result.failed).toEqual([{ url: IMG, reason: "HTTP 404" }]);
    expect(result.mirroredCount).toBe(0);
    expect(result.map.size).toBe(0);
    expect(h.upload).not.toHaveBeenCalled();
    expect(db.chainsFor("media")).toEqual([]);
    expect(result.warnings).toEqual([
      "Nie udało się zaimportować 1 zasobów (wykres.png: HTTP 404).",
    ]);
  });

  it("500 na zrodle traktowane jest tak samo jak 404 - bez zapisu", async () => {
    h.fetchMock.mockImplementation(async () => fileResponse(new Uint8Array(), null, 500));

    const result = await mirrorWpMedia(baseOptions());

    expect(result.failed).toEqual([{ url: IMG, reason: "HTTP 500" }]);
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("plik o jeden bajt wiekszy niz 15 MiB jest odrzucany przed uploadem", async () => {
    h.fetchMock.mockImplementation(async () =>
      fileResponse(new Uint8Array(MAX_BYTES + 1), "image/png"),
    );

    const result = await mirrorWpMedia(baseOptions());

    expect(result.failed).toEqual([{ url: IMG, reason: `Za duży (${MAX_BYTES + 1} B)` }]);
    expect(h.upload).not.toHaveBeenCalled();
    expect(db.chainsFor("media")).toEqual([]);
  });

  it("plik dokladnie 15 MiB jeszcze przechodzi (limit jest ostry, nie domkniety)", async () => {
    planMedia({});
    h.fetchMock.mockImplementation(async () =>
      fileResponse(new Uint8Array(MAX_BYTES), "image/png"),
    );

    const result = await mirrorWpMedia(baseOptions());

    expect(result.mirroredCount).toBe(1);
    expect(insertedRow(db).size_bytes).toBe(MAX_BYTES);
  });

  it("MIME poza lista dozwolonych (text/html) nie wchodzi do kubelka", async () => {
    h.fetchMock.mockImplementation(async () => fileResponse(PNG, "text/html; charset=utf-8"));

    const result = await mirrorWpMedia(baseOptions());

    expect(result.failed).toEqual([{ url: IMG, reason: "Niedozwolony MIME text/html" }]);
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("brak naglowka content-type: MIME wnioskowany z rozszerzenia adresu", async () => {
    planMedia({});
    h.fetchMock.mockImplementation(async () => fileResponse(PNG, null));

    const result = await mirrorWpMedia(baseOptions());

    expect(result.mirroredCount).toBe(1);
    expect(insertedRow(db).mime_type).toBe("image/png");
  });

  it("bez naglowka content-type typ pliku rozstrzyga rozszerzenie - tabela przypadkow", async () => {
    // Ta tabela nie jest ozdoba: gdy WordPress nie odda naglowka (a stare
    // instalacje i CDN-y nie oddaja), TO rozszerzenie decyduje, czy plik
    // wejdzie do biblioteki i z jakim typem MIME sie w niej pokaze. Zly typ
    // MIME w wierszu = przegladarka pobiera plik zamiast go pokazac.
    const przypadki: ReadonlyArray<{ ext: string; mime: string }> = [
      { ext: "jpg", mime: "image/jpeg" },
      { ext: "jpeg", mime: "image/jpeg" },
      { ext: "PNG", mime: "image/png" },
      { ext: "gif", mime: "image/gif" },
      { ext: "webp", mime: "image/webp" },
      { ext: "svg", mime: "image/svg+xml" },
      { ext: "avif", mime: "image/avif" },
      { ext: "pdf", mime: "application/pdf" },
      { ext: "mp3", mime: "audio/mpeg" },
      { ext: "mp4", mime: "audio/mp4" },
      { ext: "m4a", mime: "audio/mp4" },
      { ext: "wav", mime: "audio/wav" },
      { ext: "webm", mime: "audio/webm" },
      { ext: "ogg", mime: "audio/ogg" },
      { ext: "oga", mime: "audio/ogg" },
    ];
    h.fetchMock.mockImplementation(async () => fileResponse(PNG, null));

    for (const { ext, mime } of przypadki) {
      db = supabaseFromStub();
      planMedia({});
      const url = `https://blog.test/wp-content/uploads/2024/05/plik.${ext}?ver=3`;

      const result = await mirrorWpMedia({ ...baseOptions(), html: "", extraUrls: [url] });

      expect(result.failed).toEqual([]);
      expect(insertedRow(db).mime_type).toBe(mime);
      expect(insertedRow(db).storage_path.endsWith(`.${ext.toLowerCase()}`)).toBe(true);
    }
  });

  it("adres bez rozszerzenia i bez naglowka konczy sie odmowa", async () => {
    h.fetchMock.mockImplementation(async () => fileResponse(PNG, null));
    const bezRozszerzenia = "https://blog.test/wp-content/uploads/2024/05/plik";

    const result = await mirrorWpMedia({
      ...baseOptions(),
      html: "",
      extraUrls: [bezRozszerzenia],
    });

    expect(result.failed).toEqual([
      { url: bezRozszerzenia, reason: "Niedozwolony MIME application/octet-stream" },
    ]);
  });

  it("nieznane rozszerzenie bez naglowka konczy sie odmowa (octet-stream)", async () => {
    h.fetchMock.mockImplementation(async () => fileResponse(PNG, null));
    const exe = "https://blog.test/wp-content/uploads/2024/05/instalator.exe";

    const result = await mirrorWpMedia({ ...baseOptions(), html: "", extraUrls: [exe] });

    expect(result.failed).toEqual([
      { url: exe, reason: "Niedozwolony MIME application/octet-stream" },
    ]);
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("adres bez ani jednej kropki nie ma z czego wywnioskowac typu - odmowa", async () => {
    h.fetchMock.mockImplementation(async () => fileResponse(PNG, null));
    const bezKropki = "https://blog/wp-content/uploads/plik";

    const result = await mirrorWpMedia({ ...baseOptions(), html: "", extraUrls: [bezKropki] });

    expect(result.failed).toEqual([
      { url: bezKropki, reason: "Niedozwolony MIME application/octet-stream" },
    ]);
  });

  it("adres bez czlonu pliku trafia do ostrzezenia jako 'asset', a puste wpisy sa pomijane", async () => {
    h.fetchMock.mockImplementation(async () => fileResponse(PNG, null));

    const result = await mirrorWpMedia({
      ...baseOptions(),
      html: "",
      extraUrls: ["", "https://cdn.obcy.test/"],
      includeExternal: true,
    });

    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    expect(result.warnings).toEqual([
      "Nie udało się zaimportować 1 zasobów (asset: Niedozwolony MIME application/octet-stream).",
    ]);
  });

  it("zerwane pobieranie (AbortError) konczy sie wpisem w failed, nie wyjatkiem", async () => {
    const aborted = new Error("The operation was aborted.");
    aborted.name = "AbortError";
    h.fetchMock.mockRejectedValue(aborted);

    const result = await mirrorWpMedia(baseOptions());

    expect(result.failed).toEqual([{ url: IMG, reason: "The operation was aborted." }]);
    expect(result.mirroredCount).toBe(0);
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("pobranie przerwane czyms, co nie jest bledem, tez konczy sie powodem w podsumowaniu", async () => {
    h.fetchMock.mockRejectedValue("zerwane polaczenie");

    const result = await mirrorWpMedia(baseOptions());

    expect(result.failed).toEqual([{ url: IMG, reason: "zerwane polaczenie" }]);
  });

  it("odmowa bramki egress zatrzymuje prace PRZED pobraniem", async () => {
    h.guard.mockRejectedValue(new Error("blocked_url:ip"));

    const result = await mirrorWpMedia(baseOptions());

    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(result.failed).toEqual([{ url: IMG, reason: "blocked_url:ip" }]);
  });

  it("odmowa bramki bez komunikatu dostaje zastepczy powod, a nie 'undefined'", async () => {
    h.guard.mockRejectedValue("nie wolno");

    const result = await mirrorWpMedia(baseOptions());

    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(result.failed).toEqual([{ url: IMG, reason: "Blocked by egress guard" }]);
  });

  it("adres, ktorego nie da sie sparsowac, trafia do ostrzezenia jako 'asset'", async () => {
    const broken = "https://exa mple.test/wp-content/uploads/x.png";

    const result = await mirrorWpMedia({ ...baseOptions(), html: "", extraUrls: [broken] });

    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(result.warnings).toEqual([
      "Nie udało się zaimportować 1 zasobów (asset: blocked_url:unparseable).",
    ]);
  });

  it("powyzej trzech odmow ostrzezenie jest skracane wielokropkiem", async () => {
    h.fetchMock.mockImplementation(async () => fileResponse(new Uint8Array(), null, 404));
    const extraUrls = Array.from(
      { length: 4 },
      (_, i) => `https://blog.test/wp-content/uploads/2024/05/p-${i}.png`,
    );

    const result = await mirrorWpMedia({ ...baseOptions(), html: "", extraUrls });

    expect(result.failed).toHaveLength(4);
    expect(result.warnings).toEqual([
      "Nie udało się zaimportować 4 zasobów (p-0.png: HTTP 404; p-1.png: HTTP 404; p-2.png: HTTP 404...).",
    ]);
  });
});

describe("mirrorWpMedia - zapis: kubelek osobno, wiersz osobno", () => {
  it("sukces: plik do KUBELKA media, wiersz do TABELI media, mapa z publicznym adresem", async () => {
    planMedia({ insert: ok({ id: "media-77" }) });

    const result = await mirrorWpMedia(baseOptions());

    // Kubelek (service-role) i tabela (klient uzytkownika) to dwie rozne rzeczy
    // o tej samej nazwie - test pilnuje, ze kod uzyl obu, kazdej po swojemu.
    expect(h.buckets).toEqual(["media", "media"]);
    const [path, body, options] = h.upload.mock.calls[0];
    expect(path).toMatch(/^tenant-1\/wp-import\/2026\/[0-9a-f]{64}\.png$/);
    expect(body.byteLength).toBe(PNG.byteLength);
    expect(options).toEqual({ contentType: "image/png", upsert: true });

    const row = insertedRow(db);
    expect(row).toEqual({
      tenant_id: TENANT,
      uploader_id: USER,
      storage_path: path,
      public_url: `https://cdn.test/storage/v1/object/public/media/${path}`,
      filename: "wykres.png",
      mime_type: "image/png",
      size_bytes: PNG.byteLength,
    });
    expect(result.mirroredCount).toBe(1);
    expect(result.reusedCount).toBe(0);
    expect(result.failed).toEqual([]);
    expect(result.map.get(IMG)).toEqual({
      publicUrl: row.public_url,
      mediaId: "media-77",
    });
  });

  it("dedup pyta o wiersz tenanta po sciezce ze sha - dwa filtry, jeden wiersz", async () => {
    planMedia({});

    await mirrorWpMedia(baseOptions());

    const select = db.chainsFor("media").find((c) => !c.has("insert"));
    expect(select?.argsOf("select")).toEqual(["id, public_url, storage_path"]);
    expect(select?.calls.filter((c) => c.method === "eq").map((c) => c.args[0])).toEqual([
      "tenant_id",
      "storage_path",
    ]);
    expect(select?.has("maybeSingle")).toBe(true);
  });

  it("reuzycie: istniejacy plik nie jest ani pobierany do kubelka, ani wpisywany drugi raz", async () => {
    planMedia({
      existing: ok({
        id: "media-stare",
        public_url: "https://cdn.test/storage/v1/object/public/media/stare.png",
        storage_path: "tenant-1/wp-import/2026/abc.png",
      }),
    });

    const result = await mirrorWpMedia(baseOptions());

    expect(result.reusedCount).toBe(1);
    expect(result.mirroredCount).toBe(0);
    expect(h.upload).not.toHaveBeenCalled();
    expect(db.chainsFor("media").some((c) => c.has("insert"))).toBe(false);
    expect(result.map.get(IMG)).toEqual({
      publicUrl: "https://cdn.test/storage/v1/object/public/media/stare.png",
      mediaId: "media-stare",
    });
  });

  it("wiersz bez public_url to nie reuzycie - plik jedzie do kubelka jeszcze raz", async () => {
    planMedia({ existing: ok({ id: "media-stare", public_url: null, storage_path: "p" }) });

    const result = await mirrorWpMedia(baseOptions());

    expect(result.reusedCount).toBe(0);
    expect(result.mirroredCount).toBe(1);
    expect(h.upload).toHaveBeenCalledTimes(1);
  });

  it("PUSTKA: brak wiersza w bazie prowadzi do uploadu i insertu", async () => {
    planMedia({ existing: ok(null) });

    const result = await mirrorWpMedia(baseOptions());

    expect(result.mirroredCount).toBe(1);
    expect(h.upload).toHaveBeenCalledTimes(1);
  });

  it("BLAD: nieudany odczyt dedupu jest nieodrozninalny od pustki - kod uploaduje dalej", async () => {
    // Stan faktyczny, nie zyczenie: `const { data: existing } = await ...`
    // (wp-media.server.ts:170-176) NIE czyta `error`, wiec odmowa RLS albo
    // awaria bazy wygladaja jak "tego pliku jeszcze nie mamy". Konsekwencja
    // jest w nastepnym tescie (`it.fails` o rollbacku).
    planMedia({ existing: fail("permission denied for table media", "42501") });

    const result = await mirrorWpMedia(baseOptions());

    expect(h.upload).toHaveBeenCalledTimes(1);
    expect(result.mirroredCount).toBe(1);
    expect(result.failed).toEqual([]);
  });

  it("blad uploadu do kubelka nie tworzy wiersza w tabeli", async () => {
    planMedia({});
    h.upload.mockResolvedValue({ error: { message: "quota exceeded" } });

    const result = await mirrorWpMedia(baseOptions());

    expect(result.failed).toEqual([{ url: IMG, reason: "Storage: quota exceeded" }]);
    expect(db.chainsFor("media").some((c) => c.has("insert"))).toBe(false);
    expect(h.remove).not.toHaveBeenCalled();
  });

  it("ROLLBACK: gdy insert wiersza padnie, plik nie zostaje sierota w kubelku", async () => {
    planMedia({ insert: fail("new row violates row-level security policy") });

    const result = await mirrorWpMedia(baseOptions());

    const path = h.upload.mock.calls[0][0];
    expect(h.remove).toHaveBeenCalledWith([path]);
    expect(result.failed).toEqual([
      { url: IMG, reason: "new row violates row-level security policy" },
    ]);
    expect(result.map.size).toBe(0);
    expect(result.mirroredCount).toBe(0);
  });

  it("PUSTKA po insercie (brak bledu, brak wiersza) tez wywoluje rollback", async () => {
    planMedia({ insert: ok(null) });

    const result = await mirrorWpMedia(baseOptions());

    expect(h.remove).toHaveBeenCalledTimes(1);
    expect(result.failed).toEqual([{ url: IMG, reason: "Insert failed" }]);
  });

  it("jeden zasob padniety nie przerywa lustrowania pozostalych", async () => {
    planMedia({});
    h.fetchMock.mockImplementation(async (input: string) =>
      input === IMG ? fileResponse(new Uint8Array(), null, 404) : fileResponse(PNG, "image/png"),
    );

    const result = await mirrorWpMedia({
      ...baseOptions(),
      html: `<img src="${IMG}"><img src="${IMG2}">`,
    });

    expect(result.failed).toEqual([{ url: IMG, reason: "HTTP 404" }]);
    expect(result.mirroredCount).toBe(1);
    expect(result.map.has(IMG2)).toBe(true);
  });

  it("nazwa pliku jest odkazana i przycieta do bezpiecznego zestawu znakow", async () => {
    planMedia({});
    const dziwny = "https://blog.test/wp-content/uploads/2024/05/raport%20o%20UE%20(2024).pdf";
    h.fetchMock.mockImplementation(async () => fileResponse(PNG, "application/pdf"));

    await mirrorWpMedia({ ...baseOptions(), html: "", extraUrls: [dziwny] });

    expect(insertedRow(db).filename).toBe("raport_o_UE__2024_.pdf");
  });

  it.fails(
    "rollback po nieudanym insercie kasuje plik nalezacy do wczesniejszego wiersza",
    async () => {
      // DEFEKT (zglaszany, nie naprawiany): src/lib/server/wp-media.server.ts.
      // Mechanizm: dedup (linie 170-176) ignoruje `error`, wiec nieudany odczyt
      // wyglada jak brak wiersza. Kod uploaduje wtedy z `upsert: true` (linia
      // 185) NADPISUJAC istniejacy obiekt, insert pada na unikalnosci
      // (`23505`), a galaz rollbacku (linie 200-205) robi
      // `storage.remove([storagePath])` - czyli USUWA obiekt, ktory opisuje
      // WCZESNIEJSZY, poprawny wiersz `media`.
      // Konsekwencja dla uzytkownika: opublikowana strona zaczyna pokazywac
      // puste miejsce po zdjeciu, ktore zaimportowano tygodnie wczesniej,
      // a wiersz w bibliotece nadal twierdzi, ze plik jest.
      // Dlaczego to decyzja czlowieka: poprawka wymaga wyboru polityki -
      // czytac `error` dedupu i przerywac import zasobu, czy rozpoznawac `23505`
      // i traktowac je jak reuzycie (wtedy trzeba doczytac wiersz), czy w ogole
      // nie kasowac obiektu przy `upsert: true`. Kazda z tych opcji zmienia
      // zachowanie importu, a nie tylko ten test.
      planMedia({
        existing: fail("could not connect to server", "08006"),
        insert: fail("duplicate key value violates unique constraint", "23505"),
      });

      await mirrorWpMedia(baseOptions());

      expect(h.remove).not.toHaveBeenCalled();
    },
  );
});

describe("rewriteHtml - podmiana adresow w tresci", () => {
  const map = new Map([[IMG, { publicUrl: "https://cdn.test/media/nowy.png", mediaId: "m1" }]]);

  it("pusta mapa oddaje tresc bez zmian (i bez kopiowania)", () => {
    const html = `<img src="${IMG}">`;
    expect(rewriteHtml(html, new Map())).toBe(html);
  });

  it("podmienia wszystkie wystapienia, takze w href i w atrybutach data-*", () => {
    const html = `<img src="${IMG}"><a href="${IMG}">x</a><div data-src="${IMG}">`;

    expect(rewriteHtml(html, map)).toBe(
      '<img src="https://cdn.test/media/nowy.png"><a href="https://cdn.test/media/nowy.png">x</a><div data-src="https://cdn.test/media/nowy.png">',
    );
  });

  it("adres ze znakami specjalnymi regexpu nie rozjezdza podmiany", () => {
    const tricky = "https://blog.test/wp-content/uploads/plik+(1).png?ver=2.1";
    const trickyMap = new Map([
      [tricky, { publicUrl: "https://cdn.test/media/plik.png", mediaId: "m2" }],
    ]);

    expect(rewriteHtml(`<img src="${tricky}">`, trickyMap)).toBe(
      '<img src="https://cdn.test/media/plik.png">',
    );
  });
});

describe("rewriteBuilderDoc - podmiana adresow w dokumencie buildera", () => {
  const map = new Map([[IMG, { publicUrl: "https://cdn.test/media/nowy.png", mediaId: "m1" }]]);

  const docWithColumn = (): BuilderDocument => ({
    version: 1,
    sections: [
      {
        id: "s1",
        kind: "section",
        children: [
          {
            id: "c1",
            kind: "column",
            span: { desktop: 12 },
            children: [
              {
                id: "w1",
                kind: "widget",
                type: "image",
                content: { src: IMG, alt: "Wykres", meta: { poster: IMG, ratio: 1.5 } },
              },
            ],
          },
        ],
      },
    ],
  });

  it("pusta mapa oddaje ten sam dokument", () => {
    const doc = docWithColumn();
    expect(rewriteBuilderDoc(doc, new Map())).toBe(doc);
  });

  it("podmienia adresy w widgetach kolumny, takze zagnieżdżone w obiektach", () => {
    const out = rewriteBuilderDoc(docWithColumn(), map);
    const column = out.sections[0].children[0];
    if (column.kind !== "column") throw new Error("test: pierwsze dziecko nie jest kolumna");

    expect(column.children[0].content).toEqual({
      src: "https://cdn.test/media/nowy.png",
      alt: "Wykres",
      meta: { poster: "https://cdn.test/media/nowy.png", ratio: 1.5 },
    });
  });

  it("podmienia adresy w tablicach i nie psuje wartosci nie-tekstowych", () => {
    const doc = docWithColumn();
    const column = doc.sections[0].children[0];
    if (column.kind !== "column") throw new Error("test: pierwsze dziecko nie jest kolumna");
    column.children[0].content = { slides: [IMG, null, 7, true], count: 4 };

    const out = rewriteBuilderDoc(doc, map);
    const outColumn = out.sections[0].children[0];
    if (outColumn.kind !== "column") throw new Error("test: pierwsze dziecko nie jest kolumna");

    expect(outColumn.children[0].content).toEqual({
      slides: ["https://cdn.test/media/nowy.png", null, 7, true],
      count: 4,
    });
  });

  it.fails("podmienia adresy takze w sekcji zagnieżdżonej (inner-section)", () => {
    // DEFEKT (zglaszany, nie naprawiany): src/lib/server/wp-media.server.ts:274-285.
    // Mechanizm: `rewriteBuilderDoc` wchodzi wylacznie w dzieci o `kind ===
    // "column"` (linia 277) i oddaje KAZDE inne dziecko nietkniete (linia 283).
    // `SectionChild` to jednak `ColumnNode | InnerSectionNode`, a
    // `InnerSectionNode.columns[].children[]` to normalne widgety z trescia.
    // Konsekwencja dla uzytkownika: zdjecia w sekcjach zagnieżdżonych zostaja
    // podlinkowane do STAREJ instalacji WordPressa - dzialaja do dnia
    // przelaczenia DNS (albo wygasniecia hostingu), po czym na opublikowanej
    // stronie zostaja puste ramki, mimo ze plik lezy juz w naszym kubelku
    // (mirror go sciagnal, tylko dokument nie dostal nowego adresu).
    // Dlaczego to decyzja czlowieka: naprawa to zmiana zachowania importu
    // (rekurencja po `inner-section`) - trzeba rozstrzygnac, czy schodzimy
    // tylko o jeden poziom, czy rekurencyjnie, i czy zmieniamy tez
    // `rewriteContent` dla stylu/tla sekcji (background.image te adresy tez
    // niesie, a dzisiaj nie jest podmieniane w zadnym wariancie).
    const doc: BuilderDocument = {
      version: 1,
      sections: [
        {
          id: "s1",
          kind: "section",
          children: [
            {
              id: "inner-1",
              kind: "inner-section",
              columns: [
                {
                  id: "c-inner",
                  kind: "column",
                  span: { desktop: 6 },
                  children: [
                    { id: "w-inner", kind: "widget", type: "image", content: { src: IMG } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const out = rewriteBuilderDoc(doc, map);
    const inner = out.sections[0].children[0];
    if (inner.kind !== "inner-section") throw new Error("test: dziecko nie jest inner-section");

    expect(inner.columns[0].children[0].content).toEqual({
      src: "https://cdn.test/media/nowy.png",
    });
  });
});
