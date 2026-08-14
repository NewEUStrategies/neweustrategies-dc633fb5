// Wpisy klubowe: kontrakt argumentów RPC i magazyn plików - 190 linii, zero
// testów do dziś.
//
// CZEGO NIE MA SENSU TU TESTOWAĆ, I DLACZEGO. Cała autoryzacja modułu klubów
// żyje w funkcjach SECURITY DEFINER: w `src/lib/clubs/**` nie ma ANI JEDNEGO
// zapytania `supabase.from(<tabela>)`, więc nie istnieje klientowy filtr po
// tenancie, który dałoby się tu sprawdzić. `club_posts` nie ma nawet polityk
// RLS - `from()` oddałby pusty zbiór własnemu autorowi.
//
// CO WOBEC TEGO JEST TESTOWALNE, I CO REALNIE PSUJE SIĘ W TEJ WARSTWIE.
// Zostają DWIE rzeczy, obie po stronie klienta i obie bez testu:
//
//   1. KONTRAKT ARGUMENTÓW. Skoro serwer zakresuje po tym, co dostanie, to
//      zgubiony albo przemianowany argument jest tu równoważny utracie
//      zawężenia. `p_club_id`, które przestaje dojeżdżać, nie wywala niczego -
//      RPC dostaje `undefined` i sam decyduje, co to znaczy. Ten rodzaj błędu
//      przechodzi przez `tsc` (obiekt argumentów jest luźny), przez przegląd
//      (jedna literówka w nazwie klucza) i przez interfejs (lista i tak coś
//      pokazuje). Dlatego każdy argument jest tu sprawdzony po NAZWIE.
//
//   2. ŚCIEŻKA W MAGAZYNIE. Ta jedna rzecz jest w całości składana po stronie
//      klienta, a polityka zapisu w kubełku dopuszcza wyłącznie katalog
//      `<uid>/`. Nazwa pliku jest daną dostarczoną przez użytkownika, więc jej
//      sanityzacja (`safeName`) jest realną granicą - i to granicą, której nikt
//      dotąd nie sprawdził.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface RpcCall {
  name: string;
  args: Record<string, unknown> | undefined;
}

interface UploadCall {
  bucket: string;
  path: string;
  options: { contentType?: string; upsert?: boolean };
}

const sb = vi.hoisted(() => {
  const state = {
    userId: "user-1" as string | null,
    rpcs: [] as RpcCall[],
    rpcData: null as unknown,
    rpcError: null as { message: string } | null,
    uploads: [] as UploadCall[],
    uploadError: null as { message: string } | null,
    removed: [] as Array<{ bucket: string; paths: string[] }>,
    signRequests: [] as Array<{ bucket: string; paths: string[]; expiresIn: number }>,
    signResult: [] as Array<{ path: string | null; signedUrl: string | null }>,
    signError: null as Error | null,
  };
  return { state };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    async rpc(name: string, args?: Record<string, unknown>) {
      sb.state.rpcs.push({ name, args });
      return { data: sb.state.rpcData, error: sb.state.rpcError };
    },
    auth: {
      async getUser() {
        return { data: { user: sb.state.userId === null ? null : { id: sb.state.userId } } };
      },
    },
    storage: {
      from(bucket: string) {
        return {
          async upload(
            path: string,
            _file: unknown,
            options: { contentType?: string; upsert?: boolean },
          ) {
            sb.state.uploads.push({ bucket, path, options });
            return { data: { path }, error: sb.state.uploadError };
          },
          async remove(paths: string[]) {
            sb.state.removed.push({ bucket, paths });
            return { data: null, error: null };
          },
          async createSignedUrls(paths: string[], expiresIn: number) {
            sb.state.signRequests.push({ bucket, paths, expiresIn });
            if (sb.state.signError) return { data: null, error: sb.state.signError };
            return { data: sb.state.signResult, error: null };
          },
        };
      },
    },
  },
}));

import { CLUB_POST_MAX_FILE_BYTES, CLUB_POST_MEDIA_BUCKET } from "../postTypes";
import {
  ClubMediaError,
  createClubPost,
  deleteClubPost,
  fetchClubPosts,
  removeClubPostMedia,
  signClubMediaUrls,
  toggleClubPostLike,
  uploadClubPostMedia,
} from "../postsApi";

const CLUB = "club-energy-cee";

function mediaFile(name: string, type: string, size = 1024): File {
  const file = new File(["dane"], name, { type });
  Object.defineProperty(file, "size", { value: size, configurable: true });
  return file;
}

function lastRpc(): RpcCall {
  const call = sb.state.rpcs.at(-1);
  if (!call) throw new Error("nie zanotowano żadnego wywołania RPC");
  return call;
}

beforeEach(() => {
  const { state } = sb;
  state.userId = "user-1";
  state.rpcs = [];
  state.rpcData = [];
  state.rpcError = null;
  state.uploads = [];
  state.uploadError = null;
  state.removed = [];
  state.signRequests = [];
  state.signResult = [];
  state.signError = null;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-14T09:00:00.000Z"));
  // `Math.random` steruje sufiksem ścieżki - ustalamy go, żeby asercje mogły
  // porównywać całą ścieżkę, a nie tylko wzorzec.
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("fetchClubPosts - kontrakt argumentów", () => {
  it("przekazuje identyfikator klubu jako `p_club_id`", async () => {
    await fetchClubPosts({ clubId: CLUB });
    expect(lastRpc().name).toBe("club_posts_list");
    expect(lastRpc().args?.p_club_id).toBe(CLUB);
  });

  it("zawężenia opcjonalne dojeżdżają pod właściwymi nazwami", async () => {
    await fetchClubPosts({ clubId: CLUB, groupId: "group-7", threadId: "thread-3", limit: 5 });
    expect(lastRpc().args).toMatchObject({
      p_club_id: CLUB,
      p_group_id: "group-7",
      p_thread_id: "thread-3",
      p_limit: 5,
    });
  });

  it("brak zawężenia idzie jako `undefined`, nie jako `null`", async () => {
    // Różnica jest istotna po stronie bazy: `null` jest WARTOŚCIĄ argumentu,
    // `undefined` pomija go, więc funkcja bierze swoją domyślną. Przy zawężeniu
    // działu `null` znaczyłby „wpisy bez działu", a nie „wpisy z każdego działu".
    await fetchClubPosts({ clubId: CLUB, groupId: null, threadId: null });
    expect(lastRpc().args?.p_group_id).toBeUndefined();
    expect(lastRpc().args?.p_thread_id).toBeUndefined();
  });

  it("domyślny rozmiar strony to dwadzieścia", async () => {
    await fetchClubPosts({ clubId: CLUB });
    expect(lastRpc().args?.p_limit).toBe(20);
  });

  it("licznik całości czyta się z PIERWSZEGO wiersza", async () => {
    sb.state.rpcData = [
      { id: "p1", total_count: 42 },
      { id: "p2", total_count: 42 },
    ];
    const page = await fetchClubPosts({ clubId: CLUB });
    expect(page.total).toBe(42);
    expect(page.rows).toHaveLength(2);
  });

  it("pusta odpowiedź daje zero, nie `NaN`", async () => {
    // `Number(rows[0].total_count)` na pustej liście dałoby `NaN`, a paginacja
    // licząca strony z `NaN` renderuje puste sterowanie bez żadnego błędu.
    sb.state.rpcData = [];
    await expect(fetchClubPosts({ clubId: CLUB })).resolves.toEqual({ rows: [], total: 0 });
  });

  it("brak danych (`null`) też daje pustą stronę", async () => {
    sb.state.rpcData = null;
    await expect(fetchClubPosts({ clubId: CLUB })).resolves.toEqual({ rows: [], total: 0 });
  });

  it("błąd RPC jest rzucany, nie zamieniany w pustą listę", async () => {
    // Pusta lista przy błędzie wygląda w interfejsie jak „brak wpisów", czyli
    // jak stan poprawny - a to zachęca do odświeżania zamiast do zgłoszenia.
    sb.state.rpcError = { message: "permission denied" };
    await expect(fetchClubPosts({ clubId: CLUB })).rejects.toBeTruthy();
  });
});

describe("createClubPost / deleteClubPost / toggleClubPostLike - kontrakt argumentów", () => {
  it("tworzenie wpisu niesie klub - zakres jest w argumencie, nie w sesji", async () => {
    sb.state.rpcData = "post-1";
    await createClubPost({ clubId: CLUB, body: "Notatka", attachments: [] });
    expect(lastRpc().args?.p_club_id).toBe(CLUB);
  });

  it("usunięcie wpisu idzie po SAMYM identyfikatorze wpisu", async () => {
    // Świadomie zapisany kontrakt, nie luka. Klient nie wysyła klubu, bo klub
    // wpisu ustala RPC z samego wiersza - wysłanie klubu z klienta dawałoby
    // wołającemu wpływ na zakres sprawdzenia. Ten warunek istnieje, żeby nikt
    // nie „poprawił" tego, dokładając `p_club_id` z pola formularza.
    await deleteClubPost("post-9");
    expect(lastRpc().args).toEqual({ p_post_id: "post-9" });
  });

  it("polubienie idzie po samym identyfikatorze wpisu", async () => {
    sb.state.rpcData = [{ liked: true, likes: 3 }];
    await toggleClubPostLike("post-9");
    expect(lastRpc().args).toEqual({ p_post_id: "post-9" });
  });
});

describe("uploadClubPostMedia - walidacja przed siecią", () => {
  it("odrzuca nieobsługiwany typ i NIE dotyka magazynu", async () => {
    await expect(uploadClubPostMedia(mediaFile("skrypt.js", "text/javascript"))).rejects.toThrow(
      ClubMediaError,
    );
    expect(sb.state.uploads).toEqual([]);
  });

  it("kod błędu typu jest rozpoznawalny - widok mapuje go na komunikat", async () => {
    await expect(
      uploadClubPostMedia(mediaFile("skrypt.js", "text/javascript")),
    ).rejects.toMatchObject({ code: "type" });
  });

  it("odrzuca plik ponad limit z kodem `size`", async () => {
    const huge = mediaFile("film.mp4", "video/mp4", CLUB_POST_MAX_FILE_BYTES + 1);
    await expect(uploadClubPostMedia(huge)).rejects.toMatchObject({ code: "size" });
    expect(sb.state.uploads).toEqual([]);
  });

  it("limit jest WŁĄCZNY - dokładnie 50 MB przechodzi walidację", async () => {
    const atLimit = mediaFile("film.mp4", "video/mp4", CLUB_POST_MAX_FILE_BYTES);
    await expect(uploadClubPostMedia(atLimit)).resolves.toMatchObject({ type: "video" });
  });

  it("BEZ sesji wysyłka nie dochodzi (fail-closed)", async () => {
    // Ścieżka w kubełku zaczyna się identyfikatorem konta, a polityka zapisu
    // dopuszcza wyłącznie własny katalog. Bez sesji nie ma z czego złożyć
    // pierwszego segmentu, więc jedyną poprawną odpowiedzią jest odmowa.
    sb.state.userId = null;
    await expect(uploadClubPostMedia(mediaFile("zdjecie.png", "image/png"))).rejects.toMatchObject({
      code: "auth",
    });
    expect(sb.state.uploads).toEqual([]);
  });

  it("błąd magazynu wraca jako `upload`, nie jako sukces", async () => {
    sb.state.uploadError = { message: "403" };
    await expect(uploadClubPostMedia(mediaFile("zdjecie.png", "image/png"))).rejects.toMatchObject({
      code: "upload",
    });
  });
});

describe("uploadClubPostMedia - ścieżka w magazynie", () => {
  it("pierwszym segmentem jest identyfikator konta", async () => {
    await uploadClubPostMedia(mediaFile("zdjecie.png", "image/png"));
    const [call] = sb.state.uploads;
    expect(call.bucket).toBe(CLUB_POST_MEDIA_BUCKET);
    expect(call.path.split("/")[0]).toBe("user-1");
  });

  it("ścieżka ma DOKŁADNIE dwa segmenty - katalog konta i nazwa pliku", async () => {
    // Trzeci segment znaczyłby, że nazwa pliku wniosła ukośnik, czyli przejście
    // po katalogach wewnątrz kubełka.
    await uploadClubPostMedia(mediaFile("zdjecie.png", "image/png"));
    expect(sb.state.uploads[0].path.split("/")).toHaveLength(2);
  });

  it("dwie wysyłki tego samego pliku dają różne ścieżki", async () => {
    // Znacznik czasu z ustalonym `Math.random` mógłby dać kolizję, więc czas
    // przesuwamy - dokładnie jak w rzeczywistości między dwoma wysyłkami.
    await uploadClubPostMedia(mediaFile("zdjecie.png", "image/png"));
    vi.setSystemTime(new Date("2026-08-14T09:00:05.000Z"));
    await uploadClubPostMedia(mediaFile("zdjecie.png", "image/png"));
    const [first, second] = sb.state.uploads;
    expect(first.path).not.toBe(second.path);
  });

  it("wysyłka nie nadpisuje istniejącego obiektu", async () => {
    await uploadClubPostMedia(mediaFile("zdjecie.png", "image/png"));
    expect(sb.state.uploads[0].options.upsert).toBe(false);
  });

  it("zwrócony załącznik niesie tę SAMĄ ścieżkę, którą zapisał magazyn", async () => {
    // Rozjazd tych dwóch wartości daje wpis z załącznikiem, którego nie da się
    // podpisać - obraz nie ładuje się i nikt nie wie dlaczego.
    const attachment = await uploadClubPostMedia(mediaFile("zdjecie.png", "image/png"));
    expect(attachment.path).toBe(sb.state.uploads[0].path);
  });

  it("oryginalna nazwa wraca w załączniku, przycięta do 120 znaków", async () => {
    const long = `${"a".repeat(200)}.png`;
    const attachment = await uploadClubPostMedia(mediaFile(long, "image/png"));
    expect(attachment.name).toHaveLength(120);
  });
});

describe("uploadClubPostMedia - sanityzacja nazwy pliku (dane od użytkownika)", () => {
  /** Nazwa pliku zapisana w ścieżce (drugi segment, bez znacznika i losowości). */
  async function pathSuffix(name: string, type = "image/png"): Promise<string> {
    sb.state.uploads = [];
    await uploadClubPostMedia(mediaFile(name, type));
    const segment = sb.state.uploads[0].path.split("/")[1];
    // Format: `<base36-czas>-<6 znaków losowych>-<nazwa>`.
    return segment.split("-").slice(2).join("-");
  }

  it.each([
    ["../../etc/passwd.png", "przejście po katalogach"],
    ["..%2F..%2Fsekret.png", "przejście zakodowane procentowo"],
    ["zdjęcie łódź.png", "znaki diakrytyczne"],
    ["zdjecie (1) [kopia].png", "nawiasy"],
    ["plik\"z'cudzyslowami.png", "cudzysłowy"],
    ["plik\0null.png", "bajt zerowy"],
    ["plik\nnowa-linia.png", "znak nowej linii"],
    ["#hash?query=1.png", "znaki adresu"],
    ["\\windows\\sciezka.png", "ukośnik odwrotny"],
  ])("nazwa %j (%s) nie wnosi separatora ścieżki", async (name) => {
    const suffix = await pathSuffix(name);
    expect(suffix).not.toContain("/");
    expect(suffix).not.toContain("\\");
    expect(suffix).not.toContain("\0");
    expect(suffix).not.toContain("\n");
    // Zbiór dozwolony: litery, cyfry, podkreślenie, kropka, łącznik.
    expect(suffix).toMatch(/^[\w.-]*$/);
  });

  it("kropki OCALAŁE w nazwie nie są przejściem, bo separator jest wycięty", async () => {
    // Uczciwe zapisanie granicy, a nie asercja na życzenie. `safeName` NIE
    // usuwa kropek: `../../etc/passwd.png` staje się `....etcpasswd.png`.
    // I to wystarcza, bo przejście po katalogach wymaga SEPARATORA, a separator
    // wypada z nazwy razem z resztą znaków poza `[\w.\- ]`. Do tego segment
    // nazwy jest zawsze poprzedzony `<czas>-<losowość>-`, więc nie może być ANI
    // równy `..`, ANI zacząć się od `../`.
    //
    // Warunek stoi tu po to, żeby przyszła zmiana `safeName` nie mogła wpuścić
    // separatora „bo kropki i tak przechodzą" - to kropki są nieszkodliwe, nie
    // przejście.
    const suffix = await pathSuffix("../../etc/passwd.png");
    expect(suffix).toBe("....etcpasswd.png");
    expect(suffix.startsWith("../")).toBe(false);
    expect(suffix).not.toBe("..");

    const segments = sb.state.uploads[0].path.split("/");
    expect(segments).toHaveLength(2);
    for (const segment of segments) {
      expect(segment === "." || segment === "..", `segment ${segment}`).toBe(false);
    }
  });

  it("nazwa sprowadzona do ZERA znaków dostaje zapas `plik`", async () => {
    // Bez zapasu ścieżka kończyłaby się łącznikiem, a magazyn przyjąłby obiekt
    // o nazwie pustej - nie do odróżnienia od innych takich w tym katalogu.
    expect(await pathSuffix("„”€", "image/png")).toBe("plik");
  });

  it("samo rozszerzenie NIE uruchamia zapasu - i to jest bezpieczne", async () => {
    // `„”…€.png` -> `....png`. Dwie rzeczy naraz: wielokropek `…` rozkłada się
    // pod NFKD na TRZY kropki, a kropka jest znakiem dozwolonym - więc nazwa nie
    // schodzi do zera i `plik` się nie pojawia. Wynik jest bez separatora
    // i niepusty, czyli poprawny, ale zupełnie nieoczywisty; stąd warunek wprost.
    expect(await pathSuffix("„”…€.png")).toBe("....png");
  });

  it("bardzo długa nazwa jest przycięta do 80 znaków", async () => {
    // Ścieżki w magazynie mają górny limit długości; nazwa 300-znakowa
    // odrzucałaby zapis dopiero po przesłaniu całego pliku.
    const suffix = await pathSuffix(`${"a".repeat(300)}.png`);
    expect(suffix.length).toBeLessThanOrEqual(80);
  });

  it("przycięcie zachowuje KONIEC nazwy, czyli rozszerzenie", async () => {
    // `slice(-80)`, nie `slice(0, 80)`: bez rozszerzenia przeglądarka nie zna
    // typu przy pobraniu, a galeria nie umie rozpoznać obrazu.
    expect(await pathSuffix(`${"a".repeat(300)}.png`)).toMatch(/\.png$/);
  });

  it("spacje zamieniają się w łączniki, a wielkie litery na małe", async () => {
    expect(await pathSuffix("Moje Zdjecie.PNG")).toBe("moje-zdjecie.png");
  });
});

describe("removeClubPostMedia", () => {
  it("usuwa wskazaną ścieżkę z kubełka mediów", async () => {
    await removeClubPostMedia("user-1/abc-def-zdjecie.png");
    expect(sb.state.removed).toEqual([
      { bucket: CLUB_POST_MEDIA_BUCKET, paths: ["user-1/abc-def-zdjecie.png"] },
    ]);
  });
});

describe("signClubMediaUrls", () => {
  it("podpisuje całą partię JEDNYM żądaniem", async () => {
    // Galeria czterech zdjęć nie ma prawa generować czterech rund po sieci.
    sb.state.signResult = [
      { path: "a.png", signedUrl: "https://s.example/a" },
      { path: "b.png", signedUrl: "https://s.example/b" },
    ];
    const out = await signClubMediaUrls(["a.png", "b.png"]);
    expect(sb.state.signRequests).toHaveLength(1);
    expect(out).toEqual({ "a.png": "https://s.example/a", "b.png": "https://s.example/b" });
  });

  it("odsiewa duplikaty przed żądaniem", async () => {
    sb.state.signResult = [{ path: "a.png", signedUrl: "https://s.example/a" }];
    await signClubMediaUrls(["a.png", "a.png", "a.png"]);
    expect(sb.state.signRequests[0].paths).toEqual(["a.png"]);
  });

  it("odsiewa ścieżki puste i złożone z białych znaków", async () => {
    sb.state.signResult = [{ path: "a.png", signedUrl: "https://s.example/a" }];
    await signClubMediaUrls(["a.png", "", "   "]);
    expect(sb.state.signRequests[0].paths).toEqual(["a.png"]);
  });

  it("pusta lista NIE powoduje żądania", async () => {
    await expect(signClubMediaUrls([])).resolves.toEqual({});
    await expect(signClubMediaUrls(["", "  "])).resolves.toEqual({});
    expect(sb.state.signRequests).toEqual([]);
  });

  it("domyślne okno ważności to godzina", async () => {
    sb.state.signResult = [{ path: "a.png", signedUrl: "https://s.example/a" }];
    await signClubMediaUrls(["a.png"]);
    expect(sb.state.signRequests[0].expiresIn).toBe(3600);
  });

  it("okno ważności da się zawęzić wołaniem", async () => {
    sb.state.signResult = [{ path: "a.png", signedUrl: "https://s.example/a" }];
    await signClubMediaUrls(["a.png"], 60);
    expect(sb.state.signRequests[0].expiresIn).toBe(60);
  });

  it("wpis bez ścieżki albo bez adresu jest pomijany, nie wpisywany jako `null`", async () => {
    // Magazyn oddaje wpis na każdą PROSZONĄ ścieżkę, także tę, której nie umiał
    // podpisać. Wpisanie `null` do mapy dałoby `src="null"` w znaczniku obrazu.
    sb.state.signResult = [
      { path: "a.png", signedUrl: "https://s.example/a" },
      { path: null, signedUrl: "https://s.example/x" },
      { path: "b.png", signedUrl: null },
    ];
    await expect(signClubMediaUrls(["a.png", "b.png"])).resolves.toEqual({
      "a.png": "https://s.example/a",
    });
  });

  it("błąd podpisu jest rzucany - galeria musi wiedzieć, że nie ma adresów", async () => {
    sb.state.signError = new Error("not found");
    await expect(signClubMediaUrls(["a.png"])).rejects.toThrow("not found");
  });

  it("podpisuje ścieżki PODANE PRZEZ WOŁAJĄCEGO - bramką jest polityka kubełka", async () => {
    // Zapisany kontrakt, nie przeoczenie. Klient nie sprawdza właściciela
    // ścieżki, bo nie ma czym: `club_posts` nie ma polityk RLS, a przynależność
    // pliku do klubu jest wiedzą serwera. Jedynym miejscem, w którym da się to
    // rozstrzygnąć, jest polityka SELECT na kubełku `club-media`. Ten warunek
    // istnieje, żeby nikt jej nie rozluźnił „bo klient i tak podaje własne
    // ścieżki" - podaje DOWOLNE.
    sb.state.signResult = [{ path: "obcy-uid/tajne.png", signedUrl: "https://s.example/x" }];
    await signClubMediaUrls(["obcy-uid/tajne.png"]);
    expect(sb.state.signRequests[0].paths).toEqual(["obcy-uid/tajne.png"]);
  });
});
