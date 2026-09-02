// OKŁADKA KLUBU - jedyna ścieżka, którą plik użytkownika trafia do PUBLICZNEGO
// kubełka, i jedyne miejsce, w którym klucz obiektu składa KLIENT.
//
// PO CO TEN PLIK ISTNIEJE. `src/lib/clubs/coverApi.ts` miał 46,1% pokrycia
// linii i 3 z 6 funkcji: sprawdzone było to, co czyste (dopuszczalny typ,
// rozmiar, sanityzacja rozszerzenia), a NIETKNIĘTE dokładnie to, co robi
// skutki uboczne - `uploadClubCover` i `setClubCover`. To odwrotność
// właściwego rozkładu uwagi. Nagłówek modułu produkcyjnego obiecuje trzy
// rzeczy: pliki lądują w wydzielonym prefiksie `club-covers/<clubId>/`, adres
// przechodzi przez `club_set_cover` (sprawdza uprawnienie do TEGO klubu
// i akceptuje wyłącznie adresy z naszego magazynu), a nieudany zapis SPRZĄTA
// obiekt, żeby w publicznym kubełku nie została sierota. Żadna z tych trzech
// obietnic nie miała dowodu.
//
// CO JEST PRZEDMIOTEM DOWODU:
//   * bramka wejściowa pliku (typ MIME co do znaku, próg 8 MB, kolejność
//     odmów) - bo to ona trzyma SVG poza publicznym kubełkiem, a SVG w takim
//     kubełku to trwały XSS na cudzej stronie klubu;
//   * KSZTAŁT KLUCZA OBIEKTU - jedyna rzecz w tej ścieżce składana po stronie
//     klienta, a więc jedyna, którą klient może złożyć źle;
//   * argumenty wysłane do magazynu (kubełek, `contentType`, `upsert`) oraz do
//     RPC (`p_club_id`, `p_url`) - w module RPC-only zgubiony albo przemianowany
//     argument nie wywala niczego, tylko cicho traci zawężenie;
//   * KAŻDA gałąź błędu wgrywania: odmowa magazynu, brak publicznego adresu,
//     pusty adres, odmowa RPC oraz awaria samego sprzątania.
//
// CO JEST ATRAPOWANE I DLACZEGO. Wyłącznie `@/integrations/supabase/client`.
// Część RPC to gotowy rejestrator repo (`clubRpc` z `@/test/clubs/fixtures`,
// czyli `supabaseRpcStub`) - kluby są RPC-only, więc testowalnym kontraktem
// jest nazwa funkcji i nazwy argumentów. Część `storage` jest dostawiona
// lokalnie: wspólna atrapa `@/test/supabase/storage` zna podpisy
// (`createSignedUrl(s)`, `createSignedUploadUrl`), a ta ścieżka używa
// `upload` / `getPublicUrl` / `remove`, których tamta atrapa nie wystawia.
// Rozszerzanie wspólnego atomu pod jeden moduł zrobiłoby z niego worek;
// atrapa jest tu zapisana jako REJESTR (co poszło do kubełka, co zostało
// skasowane), bo asercje mają mierzyć skutek, a nie sam fakt wywołania.
// Żaden test nie wychodzi do sieci i nie dotyka prawdziwego magazynu.
//
// GRANICA DOWODU - UCZCIWIE. Autoryzacja tej ścieżki NIE mieszka w TypeScript:
// zapis adresu chroni `club_set_cover` (SECURITY DEFINER, sprawdza
// `club_capabilities` dla TEGO klubu), a zapis pliku - polityka
// `storage.objects`. Ten plik nie może więc powiedzieć „obcy nie podmieni
// okładki"; mówi, że klient WOŁA właściwą funkcję z właściwymi argumentami
// i że po odmowie sprząta po sobie. Reszta należy do pgTAP i do polityk.
//
// ZNALEZISKA (opisane przy testach `it.fails`, każde z kontrolą dodatnią):
// klucz obiektu nie jest wiązany z tenantem, `clubId` wchodzi do klucza
// nieprzefiltrowany, a plik ląduje w publicznym kubełku ZANIM ktokolwiek
// sprawdzi prawo do tego konkretnego klubu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CLUB_COVER_ACCEPT_ATTR,
  CLUB_COVER_MAX_BYTES,
  CLUB_COVER_MIME,
  checkClubCoverFile,
  clubCoverObjectPath,
  setClubCover,
  uploadClubCover,
} from "@/lib/clubs/coverApi";
import { CLUB_IDS, clubRpc, resetClubRpc } from "@/test/clubs/fixtures";

/** Jedno wgranie zapisane przez atrapę magazynu. */
interface UploadRecord {
  bucket: string;
  path: string;
  fileName: string;
  options: { cacheControl?: string; upsert?: boolean; contentType?: string };
}

const st = vi.hoisted(() => {
  const state = {
    uploads: [] as UploadRecord[],
    /** Odmowa magazynu (kształt PostgREST-owy: obiekt z `message`). */
    uploadError: null as { message: string } | null,
    /** Odpowiedź `getPublicUrl` - `null` odwzorowuje brak `data`. */
    publicUrlData: null as { publicUrl?: string } | null,
    publicUrlPaths: [] as Array<{ bucket: string; path: string }>,
    removed: [] as Array<{ bucket: string; paths: string[] }>,
    /** Gdy ustawione, samo sprzątanie odrzuca - `catch` w kodzie ma je zjeść. */
    removeRejection: null as Error | null,
  };
  return { state };
});

vi.mock("@/integrations/supabase/client", async () => {
  const { clubSupabaseMock } = await import("@/test/clubs/fixtures");
  return {
    supabase: {
      ...clubSupabaseMock.supabase,
      storage: {
        from(bucket: string) {
          return {
            async upload(
              path: string,
              file: File,
              options: { cacheControl?: string; upsert?: boolean; contentType?: string },
            ) {
              st.state.uploads.push({ bucket, path, fileName: file.name, options });
              if (st.state.uploadError !== null) {
                return { data: null, error: st.state.uploadError };
              }
              return { data: { path }, error: null };
            },
            getPublicUrl(path: string) {
              st.state.publicUrlPaths.push({ bucket, path });
              return { data: st.state.publicUrlData };
            },
            async remove(paths: string[]) {
              if (st.state.removeRejection !== null) throw st.state.removeRejection;
              st.state.removed.push({ bucket, paths });
              return { data: null, error: null };
            },
          };
        },
      },
    },
  };
});

/** Adres, jaki zwróciłby prawdziwy magazyn - domena `.example`, nie prawdziwa. */
const PUBLIC_BASE = "https://projekt.example/storage/v1/object/public/media";

/** Plik okładki o zadanej nazwie, typie i rozmiarze w bajtach. */
function coverFile(name = "baner.png", type = "image/png", size = 1024): File {
  return new File([new Uint8Array(size)], name, { type });
}

beforeEach(() => {
  resetClubRpc();
  st.state.uploads.length = 0;
  st.state.uploadError = null;
  st.state.publicUrlPaths.length = 0;
  st.state.removed.length = 0;
  st.state.removeRejection = null;
  st.state.publicUrlData = { publicUrl: `${PUBLIC_BASE}/club-covers/${CLUB_IDS.club}/x.png` };
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("co w ogóle wolno wgrać jako okładkę", () => {
  it("przyjmuje cztery formaty rastrowe i tylko te cztery", () => {
    for (const type of CLUB_COVER_MIME) {
      expect(checkClubCoverFile({ type, size: 1024 }), type).toBeNull();
    }
    expect([...CLUB_COVER_MIME]).toEqual(["image/jpeg", "image/png", "image/webp", "image/avif"]);
  });

  it("odrzuca SVG - publiczny kubełek plus SVG to trwały XSS na stronie klubu", () => {
    expect(checkClubCoverFile({ type: "image/svg+xml", size: 1024 })).toEqual({
      kind: "mime",
      mime: "image/svg+xml",
    });
  });

  it("odrzuca wszystko, co nie jest obrazem, łącznie z pustym typem", () => {
    for (const type of ["text/html", "application/pdf", "image/gif", ""]) {
      expect(checkClubCoverFile({ type, size: 1 }), type).toEqual({ kind: "mime", mime: type });
    }
  });

  it("porównanie typu jest DOKŁADNE - `IMAGE/PNG` nie przechodzi", () => {
    // Przeglądarka podaje `file.type` małymi literami, więc wielka litera
    // znaczy tu wejście spreparowane ręcznie, a nie zwykły wybór z dysku.
    expect(checkClubCoverFile({ type: "IMAGE/PNG", size: 1 })).toEqual({
      kind: "mime",
      mime: "IMAGE/PNG",
    });
  });

  it("granica 8 MB: dokładnie limit przechodzi, jeden bajt więcej nie", () => {
    expect(CLUB_COVER_MAX_BYTES).toBe(8 * 1024 * 1024);
    expect(checkClubCoverFile({ type: "image/png", size: CLUB_COVER_MAX_BYTES })).toBeNull();
    expect(checkClubCoverFile({ type: "image/png", size: CLUB_COVER_MAX_BYTES + 1 })).toEqual({
      kind: "size",
      sizeBytes: CLUB_COVER_MAX_BYTES + 1,
      maxBytes: CLUB_COVER_MAX_BYTES,
    });
  });

  it("pusty plik przechodzi bramkę rozmiaru - zero to nie jest przekroczenie", () => {
    expect(checkClubCoverFile({ type: "image/webp", size: 0 })).toBeNull();
  });

  it("plik i zły, i za duży jest zgłaszany jako ZŁY TYP - to trafniejszy komunikat", () => {
    expect(checkClubCoverFile({ type: "image/svg+xml", size: CLUB_COVER_MAX_BYTES + 1 })).toEqual({
      kind: "mime",
      mime: "image/svg+xml",
    });
  });

  it("atrybut `accept` pola pliku jest wyprowadzony z tej samej listy", () => {
    expect(CLUB_COVER_ACCEPT_ATTR).toBe(CLUB_COVER_MIME.join(","));
  });
});

describe("klucz obiektu w magazynie", () => {
  it("trzyma plik w prefiksie klubu, którego pilnuje polityka storage", () => {
    expect(clubCoverObjectPath({ clubId: "abc", filename: "baner.PNG", uniqueSuffix: "u1" })).toBe(
      "club-covers/abc/u1.png",
    );
  });

  it("czyści rozszerzenie z przemytu ścieżki i podwójnego rozszerzenia", () => {
    expect(
      clubCoverObjectPath({ clubId: "abc", filename: "evil.png.../../x.hTmL", uniqueSuffix: "u2" }),
    ).toBe("club-covers/abc/u2.html");
  });

  it("bez rozszerzenia wpada w bezpieczny fallback", () => {
    expect(clubCoverObjectPath({ clubId: "abc", filename: "cover", uniqueSuffix: "u3" })).toBe(
      "club-covers/abc/u3.jpg",
    );
  });

  it("plik zaczynający się od kropki nie ma rozszerzenia - też fallback", () => {
    // `.env` to nazwa, nie rozszerzenie: `lastIndexOf(".") === 0`.
    expect(clubCoverObjectPath({ clubId: "abc", filename: ".env", uniqueSuffix: "u4" })).toBe(
      "club-covers/abc/u4.jpg",
    );
    expect(clubCoverObjectPath({ clubId: "abc", filename: "baner.", uniqueSuffix: "u5" })).toBe(
      "club-covers/abc/u5.jpg",
    );
  });

  it("rozszerzenie z samych znaków spoza [a-z0-9] znika i zostaje fallback", () => {
    expect(clubCoverObjectPath({ clubId: "abc", filename: "plik.!!!", uniqueSuffix: "u6" })).toBe(
      "club-covers/abc/u6.jpg",
    );
  });

  it("bardzo długie rozszerzenie jest ucinane do 10 znaków", () => {
    expect(
      clubCoverObjectPath({ clubId: "abc", filename: `x.${"a".repeat(40)}`, uniqueSuffix: "u7" }),
    ).toBe(`club-covers/abc/u7.${"a".repeat(10)}`);
  });

  it("bez podanego sufiksu klucz jest losowy, ale wciąż w prefiksie klubu", () => {
    const pierwszy = clubCoverObjectPath({ clubId: CLUB_IDS.club, filename: "baner.webp" });
    const drugi = clubCoverObjectPath({ clubId: CLUB_IDS.club, filename: "baner.webp" });

    expect(pierwszy).toMatch(new RegExp(`^club-covers/${CLUB_IDS.club}/[0-9]+-[a-z0-9]+\\.webp$`));
    expect(drugi).not.toBe(pierwszy);
  });
});

describe("ZNALEZISKO: z czym klucz obiektu jest, a z czym nie jest związany", () => {
  // Polityka `storage.objects` dla tego prefiksu (migracja 20260809182555)
  // sprawdza DOKŁADNIE dwie rzeczy: `(storage.foldername(name))[1] =
  // 'club-covers'` oraz `club_is_any_moderator(auth.uid())` - czyli „czy
  // wołający prowadzi JAKIKOLWIEK klub". Drugi człon klucza (`<clubId>`) nie
  // jest z niczym konfrontowany, a członu tenanta w kluczu nie ma w ogóle.
  // Skutek: prowadzący klub A może pisać (INSERT/UPDATE) i KASOWAĆ (DELETE)
  // obiekty w prefiksie klubu B - także z innego tenanta. Sam ADRES na klubie
  // pozostaje chroniony, bo `club_set_cover` liczy `club_capabilities` dla
  // TEGO klubu; niechroniona jest zawartość publicznego kubełka.
  // Nie zmieniam tu zachowania produkcyjnego - przypinam kontrakt.

  it.fails("ZNALEZISKO N8-1: klucz obiektu powinien wiązać plik z TENANTEM", () => {
    const path = clubCoverObjectPath({
      clubId: CLUB_IDS.club,
      filename: "baner.png",
      uniqueSuffix: "u1",
    });
    expect(path.split("/")).toContain(CLUB_IDS.tenant);
  });

  it("kontrola dodatnia do N8-1: człon KLUBU w kluczu jest i jest poprawny", () => {
    const path = clubCoverObjectPath({
      clubId: CLUB_IDS.club,
      filename: "baner.png",
      uniqueSuffix: "u1",
    });
    expect(path).toBe(`club-covers/${CLUB_IDS.club}/u1.png`);
    expect(path.split("/")[1]).toBe(CLUB_IDS.club);
  });

  it.fails("ZNALEZISKO N8-2: wrogi `clubId` nie powinien wyprowadzać klucza z prefiksu", () => {
    // Rozszerzenie jest sanityzowane starannie, `clubId` wchodzi do klucza
    // surowy. Człon `..` w kluczu obiektu przechodzi przez politykę (pierwszy
    // segment nadal brzmi `club-covers`), a w adresie publicznym przeglądarka
    // go rozwija - czyli `<img src>` okładki celuje poza prefiks.
    const path = clubCoverObjectPath({
      clubId: "../avatars",
      filename: "baner.png",
      uniqueSuffix: "u1",
    });
    expect(path.split("/")).not.toContain("..");
  });

  it("kontrola dodatnia do N8-2: wroga NAZWA PLIKU z prefiksu nie wyprowadza", () => {
    const path = clubCoverObjectPath({
      clubId: CLUB_IDS.club,
      filename: "../../etc/passwd.png",
      uniqueSuffix: "u1",
    });
    expect(path.split("/")).not.toContain("..");
    expect(path).toBe(`club-covers/${CLUB_IDS.club}/u1.png`);
  });
});

describe("wgranie okładki: ścieżka szczęśliwa", () => {
  it("wgrywa do kubełka `media`, w prefiks klubu, z typem pliku i bez nadpisywania", async () => {
    const url = `${PUBLIC_BASE}/club-covers/${CLUB_IDS.club}/nowa.webp`;
    st.state.publicUrlData = { publicUrl: url };
    clubRpc.setData("club_set_cover", url);

    await expect(
      uploadClubCover({ clubId: CLUB_IDS.club, file: coverFile("Baner Klubu.WEBP", "image/webp") }),
    ).resolves.toBe(url);

    expect(st.state.uploads).toHaveLength(1);
    const wgranie = st.state.uploads[0];
    expect(wgranie.bucket).toBe("media");
    expect(wgranie.path).toMatch(
      new RegExp(`^club-covers/${CLUB_IDS.club}/[0-9]+-[a-z0-9]+\\.webp$`),
    );
    expect(wgranie.options).toEqual({
      cacheControl: "3600",
      upsert: false,
      contentType: "image/webp",
    });
  });

  it("adres publiczny jest liczony dla DOKŁADNIE tego klucza, który poszedł do magazynu", async () => {
    const url = `${PUBLIC_BASE}/club-covers/${CLUB_IDS.club}/nowa.png`;
    st.state.publicUrlData = { publicUrl: url };
    clubRpc.setData("club_set_cover", url);

    await uploadClubCover({ clubId: CLUB_IDS.club, file: coverFile() });

    expect(st.state.publicUrlPaths).toEqual([{ bucket: "media", path: st.state.uploads[0].path }]);
  });

  it("zapisuje adres przez `club_set_cover` z identyfikatorem TEGO klubu", async () => {
    const url = `${PUBLIC_BASE}/club-covers/${CLUB_IDS.club}/nowa.png`;
    st.state.publicUrlData = { publicUrl: url };
    clubRpc.setData("club_set_cover", url);

    await uploadClubCover({ clubId: CLUB_IDS.club, file: coverFile() });

    expect(clubRpc.names()).toEqual(["club_set_cover"]);
    const wywolanie = clubRpc.lastCall("club_set_cover");
    expect(wywolanie?.arg("p_club_id")).toBe(CLUB_IDS.club);
    expect(wywolanie?.arg("p_url")).toBe(url);
    expect(wywolanie?.keys()).toEqual(["p_club_id", "p_url"]);
  });

  it("po udanym zapisie NIC nie jest kasowane - sprzątanie to ścieżka wyjątkowa", async () => {
    const url = `${PUBLIC_BASE}/club-covers/${CLUB_IDS.club}/nowa.png`;
    st.state.publicUrlData = { publicUrl: url };
    clubRpc.setData("club_set_cover", url);

    await uploadClubCover({ clubId: CLUB_IDS.club, file: coverFile() });

    expect(st.state.removed).toEqual([]);
  });

  it("oddaje WARTOŚĆ ZAPISANĄ PRZEZ BAZĘ, a nie adres policzony u klienta", async () => {
    // `club_set_cover` przycina i normalizuje adres; wołający ma zobaczyć to,
    // co realnie stoi w kolumnie, inaczej nagłówek pokaże co innego niż baza.
    st.state.publicUrlData = { publicUrl: `${PUBLIC_BASE}/club-covers/${CLUB_IDS.club}/a.png` };
    clubRpc.setData("club_set_cover", `${PUBLIC_BASE}/club-covers/${CLUB_IDS.club}/kanoniczna.png`);

    await expect(uploadClubCover({ clubId: CLUB_IDS.club, file: coverFile() })).resolves.toBe(
      `${PUBLIC_BASE}/club-covers/${CLUB_IDS.club}/kanoniczna.png`,
    );
  });
});

describe("wgranie okładki: każda gałąź błędu", () => {
  it("odmowa magazynu przerywa ścieżkę - żadnego RPC i żadnego sprzątania", async () => {
    st.state.uploadError = { message: "storage: new row violates row-level security policy" };

    await expect(
      uploadClubCover({ clubId: CLUB_IDS.club, file: coverFile() }),
    ).rejects.toMatchObject({ message: expect.stringContaining("row-level security") });

    expect(clubRpc.names()).toEqual([]);
    expect(st.state.removed).toEqual([]);
  });

  it("brak `data` z `getPublicUrl` kończy się błędem i SKASOWANIEM obiektu", async () => {
    st.state.publicUrlData = null;

    await expect(uploadClubCover({ clubId: CLUB_IDS.club, file: coverFile() })).rejects.toThrow(
      "storage_public_url_missing",
    );

    expect(clubRpc.names()).toEqual([]);
    expect(st.state.removed).toEqual([{ bucket: "media", paths: [st.state.uploads[0].path] }]);
  });

  it("pusty adres publiczny traktujemy jak jego brak - też sprzątamy", async () => {
    st.state.publicUrlData = { publicUrl: "" };

    await expect(uploadClubCover({ clubId: CLUB_IDS.club, file: coverFile() })).rejects.toThrow(
      "storage_public_url_missing",
    );

    expect(st.state.removed).toHaveLength(1);
  });

  it("odmowa `club_set_cover` NIE zostawia sieroty w publicznym kubełku", async () => {
    clubRpc.setError("club_set_cover", "clubs: forbidden", "42501");

    await expect(uploadClubCover({ clubId: CLUB_IDS.club, file: coverFile() })).rejects.toThrow(
      "clubs: forbidden",
    );

    expect(st.state.removed).toEqual([{ bucket: "media", paths: [st.state.uploads[0].path] }]);
  });

  it("awaria SAMEGO sprzątania nie podmienia błędu - wołający widzi przyczynę pierwotną", async () => {
    clubRpc.setError("club_set_cover", "clubs: invalid cover url", "22023");
    st.state.removeRejection = new Error("storage: network down");

    await expect(uploadClubCover({ clubId: CLUB_IDS.club, file: coverFile() })).rejects.toThrow(
      "clubs: invalid cover url",
    );
  });

  it.fails(
    "ZNALEZISKO N8-3: plik nie powinien trafiać do kubełka przed sprawdzeniem klubu",
    async () => {
      // Kolejność w kodzie to `upload` -> `club_set_cover`. Polityka magazynu
      // wpuszcza prowadzącego DOWOLNY klub, więc dla klubu, do którego wołający
      // praw nie ma, plik i tak przez chwilę stoi w publicznym kubełku - i to
      // pod adresem, który wołający zna. Okno jest krótkie (sprzątanie zaraz
      // po odmowie), ale istnieje i nie zależy od odmowy RPC.
      clubRpc.setError("club_set_cover", "clubs: forbidden", "42501");

      await expect(uploadClubCover({ clubId: CLUB_IDS.club, file: coverFile() })).rejects.toThrow();
      expect(st.state.uploads).toHaveLength(0);
    },
  );

  it("kontrola dodatnia do N8-3: po odmowie obiekt JEST kasowany, więc okno się zamyka", async () => {
    clubRpc.setError("club_set_cover", "clubs: forbidden", "42501");

    await expect(uploadClubCover({ clubId: CLUB_IDS.club, file: coverFile() })).rejects.toThrow();

    expect(st.state.uploads).toHaveLength(1);
    expect(st.state.removed).toEqual([{ bucket: "media", paths: [st.state.uploads[0].path] }]);
  });
});

describe("zapis samego adresu okładki", () => {
  it("przekazuje klub i adres pod nazwami, których oczekuje RPC", async () => {
    const url = `${PUBLIC_BASE}/club-covers/${CLUB_IDS.club}/a.png`;
    clubRpc.setData("club_set_cover", url);

    await expect(setClubCover({ clubId: CLUB_IDS.club, url })).resolves.toBe(url);

    const wywolanie = clubRpc.lastCall("club_set_cover");
    expect(wywolanie?.arg("p_club_id")).toBe(CLUB_IDS.club);
    expect(wywolanie?.arg("p_url")).toBe(url);
  });

  it("`null` to POPRAWNA wartość - zdjęcie okładki, nie brak argumentu", async () => {
    clubRpc.setData("club_set_cover", null);

    await expect(setClubCover({ clubId: CLUB_IDS.club, url: null })).resolves.toBe("");

    const wywolanie = clubRpc.lastCall("club_set_cover");
    expect(wywolanie?.has("p_url")).toBe(true);
    expect(wywolanie?.arg("p_url")).toBeNull();
  });

  it("odmowa bazy jest przepuszczana wołającemu, a nie połykana", async () => {
    clubRpc.setError("club_set_cover", "clubs: not found", "42501");

    await expect(setClubCover({ clubId: CLUB_IDS.otherClub, url: null })).rejects.toThrow(
      "clubs: not found",
    );
  });

  it("odpowiedź, która nie jest napisem, schodzi do pustego napisu, nie do `undefined`", async () => {
    clubRpc.setData("club_set_cover", { nieoczekiwany: "kształt" });

    await expect(
      setClubCover({ clubId: CLUB_IDS.club, url: `${PUBLIC_BASE}/club-covers/x/a.png` }),
    ).resolves.toBe("");
  });
});
