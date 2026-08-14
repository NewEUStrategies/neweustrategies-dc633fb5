// Izolacja najemcy w wysyłce CV - 89 linii produkcyjnych, zero testów do dziś.
//
// DLACZEGO TO JEST TEST BEZPIECZEŃSTWA, A NIE TEST WYSYŁKI PLIKU. Cała
// izolacja najemcy w buckecie `career-cv` stoi na PIERWSZYM SEGMENCIE ŚCIEŻKI.
// Polityka INSERT-u pozwala anonimowi wgrać plik wyłącznie do katalogu tenanta
// przeglądanego hosta, a podpisany odczyt ma personel TEGO tenanta - bo
// `is_staff()` sprawdza ROLĘ, nie tenanta. Bez tenanta w ścieżce redaktor
// jednego najemcy może podpisać CV każdego innego. To jest zapisane w komentarzu
// nad modułem i do dziś nie było zapisane w żadnym warunku.
//
// Ścieżka jest składana PO STRONIE KLIENTA, więc jej kształt jest w całości
// odpowiedzialnością tego pliku. Trzy rzeczy muszą być prawdziwe naraz:
//
//   1. tenant jest PIERWSZYM segmentem (i to tenant z `public_tenant_id()`,
//      nie żadna wartość podana przez wołającego);
//   2. bez tenanta wysyłka NIE dochodzi (fail-closed) - inaczej plik leci pod
//      ścieżkę bez prefiksu i albo dostaje 403 z magazynu, albo, przy luźniejszej
//      polityce, ląduje w miejscu, którego nie widzi żaden tenant;
//   3. ORYGINALNA NAZWA PLIKU nie trafia do ścieżki - nazwa jest danymi
//      dostarczonymi przez kandydata i nośnikiem przejścia po katalogach.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMock = vi.hoisted(() => {
  interface UploadCall {
    bucket: string;
    path: string;
    options: { contentType?: string; upsert?: boolean };
  }
  interface SignCall {
    bucket: string;
    path: string;
    expiresIn: number;
  }
  const state = {
    /** Odpowiedź `public_tenant_id()` - sterowana per test. */
    tenant: null as unknown,
    tenantError: null as { message: string } | null,
    rpcCalls: [] as string[],
    uploads: [] as UploadCall[],
    uploadError: null as { message: string } | null,
    signs: [] as SignCall[],
    signError: null as { message: string } | null,
    signedUrl: "https://magazyn.example/podpisany" as string | null,
  };
  return { state };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string) => {
      supabaseMock.state.rpcCalls.push(name);
      return { data: supabaseMock.state.tenant, error: supabaseMock.state.tenantError };
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (
          path: string,
          _file: unknown,
          options: { contentType?: string; upsert?: boolean },
        ) => {
          supabaseMock.state.uploads.push({ bucket, path, options });
          return { data: { path }, error: supabaseMock.state.uploadError };
        },
        createSignedUrl: async (path: string, expiresIn: number) => {
          supabaseMock.state.signs.push({ bucket, path, expiresIn });
          return {
            data:
              supabaseMock.state.signedUrl === null
                ? null
                : { signedUrl: supabaseMock.state.signedUrl },
            error: supabaseMock.state.signError,
          };
        },
      }),
    },
  },
}));

import { CV_MAX_BYTES } from "../applicationSchema";
import { CV_BUCKET, currentTenantFolder, signCvUrl, uploadCv, validateCvFile } from "../cvUpload";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";

/**
 * Plik testowy.
 *
 * happy-dom dostarcza `File`, ale nie kontroluje `size` przy podanej treści,
 * więc rozmiar nadpisujemy jawnie - inaczej test limitu 5 MB musiałby alokować
 * pięć megabajtów w pamięci na każdy przypadek.
 */
function cvFile(name: string, type: string, size = 1024): File {
  const file = new File(["treść cv"], name, { type });
  Object.defineProperty(file, "size", { value: size, configurable: true });
  return file;
}

beforeEach(() => {
  const { state } = supabaseMock;
  state.tenant = TENANT;
  state.tenantError = null;
  state.rpcCalls = [];
  state.uploads = [];
  state.uploadError = null;
  state.signs = [];
  state.signError = null;
  state.signedUrl = "https://magazyn.example/podpisany";
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-14T09:30:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("validateCvFile", () => {
  it("przepuszcza PDF w granicy rozmiaru", () => {
    expect(validateCvFile(cvFile("cv.pdf", "application/pdf"))).toEqual({ ok: true });
  });

  it.each([
    ["application/pdf", "cv.pdf"],
    ["application/msword", "cv.doc"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "cv.docx"],
  ])("przepuszcza typ %s", (type, name) => {
    expect(validateCvFile(cvFile(name, type)).ok).toBe(true);
  });

  it("przepuszcza plik po ROZSZERZENIU, gdy przeglądarka nie podała typu", () => {
    // Realny przypadek: część przeglądarek oddaje pusty `type` dla `.doc`
    // z niektórych systemów plików. Odrzucenie takiego pliku wywalałoby
    // kandydata z formularza bez powodu, który dałoby się naprawić.
    expect(validateCvFile(cvFile("cv.doc", "")).ok).toBe(true);
    expect(validateCvFile(cvFile("cv.DOCX", "")).ok).toBe(true);
  });

  it("odrzuca plik ponad limit ZANIM dotknie sieci", () => {
    const result = validateCvFile(cvFile("cv.pdf", "application/pdf", CV_MAX_BYTES + 1));
    expect(result).toEqual({ ok: false, errorKey: "cvTooLarge" });
  });

  it("limit jest WŁĄCZNY - dokładnie 5 MB przechodzi", () => {
    expect(validateCvFile(cvFile("cv.pdf", "application/pdf", CV_MAX_BYTES)).ok).toBe(true);
  });

  it("rozmiar jest sprawdzany PRZED typem", () => {
    // Kolejność ma znaczenie dla komunikatu: kandydat z 40-megabajtowym PNG-iem
    // ma się dowiedzieć o rozmiarze, a nie dostać "nieobsługiwany format"
    // i przycinać obrazek, który i tak nie przejdzie.
    const huge = cvFile("kot.png", "image/png", CV_MAX_BYTES + 1);
    expect(validateCvFile(huge)).toEqual({ ok: false, errorKey: "cvTooLarge" });
  });

  it.each(["kot.png", "skrypt.js", "archiwum.zip", "cv.pdf.exe", "bez-rozszerzenia"])(
    "odrzuca %s",
    (name) => {
      expect(validateCvFile(cvFile(name, "application/octet-stream"))).toEqual({
        ok: false,
        errorKey: "cvType",
      });
    },
  );
});

describe("currentTenantFolder", () => {
  it("czyta tenanta z `public_tenant_id()`", async () => {
    await expect(currentTenantFolder()).resolves.toBe(TENANT);
    expect(supabaseMock.state.rpcCalls).toEqual(["public_tenant_id"]);
  });

  it("oddaje `null` przy błędzie RPC - nie zgaduje tenanta", async () => {
    supabaseMock.state.tenantError = { message: "boom" };
    await expect(currentTenantFolder()).resolves.toBeNull();
  });

  it.each([null, "", 42, {}, []])("oddaje `null` dla odpowiedzi %j", async (data) => {
    // Kształt odpowiedzi RPC nie jest gwarantowany typem, a każda wartość poza
    // niepustym napisem daje ścieżkę bez poprawnego prefiksu tenanta.
    supabaseMock.state.tenant = data;
    await expect(currentTenantFolder()).resolves.toBeNull();
  });
});

describe("uploadCv - tenant jest PIERWSZYM segmentem ścieżki", () => {
  it("składa ścieżkę `<tenant>/uploads/<data>/<uuid>.<ext>`", async () => {
    const result = await uploadCv(cvFile("Moje CV.pdf", "application/pdf"));
    expect(result.ok).toBe(true);
    const [call] = supabaseMock.state.uploads;
    expect(call.bucket).toBe(CV_BUCKET);
    expect(call.path).toMatch(new RegExp(`^${TENANT}/uploads/2026-08-14/[0-9a-fA-F-]{8,}\\.pdf$`));
  });

  it("pierwszy segment jest DOKŁADNIE tenantem z RPC", async () => {
    // Warunek postawiony wprost na segmencie, nie na całym wzorcu: to ten
    // segment jest jedynym, co polityka magazynu porównuje z tenantem hosta.
    await uploadCv(cvFile("cv.pdf", "application/pdf"));
    expect(supabaseMock.state.uploads[0].path.split("/")[0]).toBe(TENANT);
  });

  it("zmiana tenanta zmienia katalog - dwa najemcy nie dzielą prefiksu", async () => {
    await uploadCv(cvFile("cv.pdf", "application/pdf"));
    supabaseMock.state.tenant = OTHER_TENANT;
    await uploadCv(cvFile("cv.pdf", "application/pdf"));
    const [first, second] = supabaseMock.state.uploads;
    expect(first.path.startsWith(`${TENANT}/`)).toBe(true);
    expect(second.path.startsWith(`${OTHER_TENANT}/`)).toBe(true);
    expect(first.path.split("/")[0]).not.toBe(second.path.split("/")[0]);
  });

  it("BEZ tenanta wysyłka nie dochodzi (fail-closed)", async () => {
    // Najważniejszy warunek w pliku. Gdyby moduł spadł na ścieżkę bez prefiksu,
    // plik z CV kandydata trafiłby poza jakikolwiek katalog najemcy - a wtedy
    // o tym, kto go przeczyta, decyduje wyłącznie to, jak luźna jest polityka
    // bucketu w danym momencie.
    supabaseMock.state.tenant = null;
    const result = await uploadCv(cvFile("cv.pdf", "application/pdf"));
    expect(result).toEqual({ ok: false, errorKey: "cvUploadFailed" });
    expect(supabaseMock.state.uploads).toEqual([]);
  });

  it("BŁĄD odczytu tenanta też zamyka wysyłkę", async () => {
    supabaseMock.state.tenantError = { message: "sieć padła" };
    const result = await uploadCv(cvFile("cv.pdf", "application/pdf"));
    expect(result.ok).toBe(false);
    expect(supabaseMock.state.uploads).toEqual([]);
  });

  it("walidacja odcina plik PRZED zapytaniem o tenanta", async () => {
    // Kolejność jest oszczędnością rundy po sieci, ale też mniejszą powierzchnią:
    // odrzucony plik nie powoduje żadnego zapytania.
    const result = await uploadCv(cvFile("kot.png", "image/png"));
    expect(result).toEqual({ ok: false, errorKey: "cvType" });
    expect(supabaseMock.state.rpcCalls).toEqual([]);
    expect(supabaseMock.state.uploads).toEqual([]);
  });
});

describe("uploadCv - nazwa pliku kandydata nie trafia do ścieżki", () => {
  // Nazwa pliku jest danymi dostarczonymi przez kandydata. Moduł generuje nazwę
  // po swojej stronie i zachowuje oryginał osobno, w metadanych zgłoszenia.
  it.each([
    "Moje CV.pdf",
    "../../etc/passwd.pdf",
    "..%2F..%2Fsekret.pdf",
    "cv .pdf",
    "CV Anny Kowalskiej (ostateczne, poprawione).pdf",
    "życiorys-łódź.pdf",
  ])("ścieżka nie niesie nazwy %j", async (name) => {
    supabaseMock.state.uploads = [];
    const result = await uploadCv(cvFile(name, "application/pdf"));
    expect(result.ok).toBe(true);
    const { path } = supabaseMock.state.uploads[0];
    // Trzon nazwy (bez rozszerzenia) nie może pojawić się w ścieżce.
    const stem = name.replace(/\.[^.]*$/, "");
    expect(path).not.toContain(stem);
    // Ścieżka ma DOKŁADNIE cztery segmenty - przejście po katalogach musiałoby
    // dołożyć piąty albo wstawić `..`.
    expect(path.split("/")).toHaveLength(4);
    expect(path).not.toContain("..");
  });

  it("oryginalna nazwa wraca w wyniku, żeby dało się ją zapisać w zgłoszeniu", async () => {
    const result = await uploadCv(cvFile("Moje CV.pdf", "application/pdf", 2048));
    expect(result).toMatchObject({ ok: true, fileName: "Moje CV.pdf", size: 2048 });
  });

  it("dwie wysyłki tego samego pliku dają RÓŻNE ścieżki", async () => {
    // Wspólna ścieżka przy `upsert: false` odrzuciłaby drugie zgłoszenie -
    // a przy `upsert: true` nadpisałaby CV pierwszego kandydata.
    await uploadCv(cvFile("cv.pdf", "application/pdf"));
    await uploadCv(cvFile("cv.pdf", "application/pdf"));
    const [first, second] = supabaseMock.state.uploads;
    expect(first.path).not.toBe(second.path);
  });

  it("wysyłka NIE nadpisuje istniejącego obiektu", async () => {
    await uploadCv(cvFile("cv.pdf", "application/pdf"));
    expect(supabaseMock.state.uploads[0].options.upsert).toBe(false);
  });

  it("rozszerzenie w ścieżce bierze się z TYPU, nie z nazwy", async () => {
    // Plik nazwany `cv.pdf`, ale zadeklarowany jako docx, dostaje `.docx` -
    // inaczej podpisany link oddawałby dokument z mylącym rozszerzeniem.
    await uploadCv(
      cvFile("cv.pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    );
    expect(supabaseMock.state.uploads[0].path.endsWith(".docx")).toBe(true);
  });

  it("nieznany typ z rozpoznawalnym rozszerzeniem dostaje to rozszerzenie", async () => {
    await uploadCv(cvFile("cv.docx", ""));
    expect(supabaseMock.state.uploads[0].path.endsWith(".docx")).toBe(true);
  });

  it("typ przekazany do magazynu ma zapas, a nie pustkę", async () => {
    await uploadCv(cvFile("cv.doc", ""));
    expect(supabaseMock.state.uploads[0].options.contentType).toBe("application/octet-stream");
  });

  it("data w ścieżce jest datą UTC, nie lokalną", async () => {
    // Katalog dzienny jest podstawą retencji CV (`careerCvRetention.server`).
    // Data lokalna dawałaby dwa różne katalogi dla jednego dnia w zależności od
    // strefy przeglądarki kandydata, a skaner retencji liczy dni po UTC.
    vi.setSystemTime(new Date("2026-08-14T23:30:00.000Z"));
    await uploadCv(cvFile("cv.pdf", "application/pdf"));
    expect(supabaseMock.state.uploads[0].path.split("/")[2]).toBe("2026-08-14");
  });
});

describe("uploadCv - awaria magazynu", () => {
  it("błąd wysyłki nie udaje sukcesu", async () => {
    supabaseMock.state.uploadError = { message: "403" };
    const result = await uploadCv(cvFile("cv.pdf", "application/pdf"));
    expect(result).toEqual({ ok: false, errorKey: "cvUploadFailed" });
  });

  it("wynik błędu NIE niesie ścieżki - nie ma czego zapisać w zgłoszeniu", async () => {
    supabaseMock.state.uploadError = { message: "403" };
    const result = await uploadCv(cvFile("cv.pdf", "application/pdf"));
    expect(result).not.toHaveProperty("path");
  });
});

describe("signCvUrl", () => {
  it("podpisuje wskazaną ścieżkę w buckecie CV", async () => {
    await expect(signCvUrl(`${TENANT}/uploads/2026-08-14/abc.pdf`)).resolves.toBe(
      "https://magazyn.example/podpisany",
    );
    expect(supabaseMock.state.signs[0]).toMatchObject({
      bucket: CV_BUCKET,
      path: `${TENANT}/uploads/2026-08-14/abc.pdf`,
    });
  });

  it("domyślne okno ważności to pięć minut", async () => {
    // Link do CV jest przekazywalny: krótkie okno jest jedyną rzeczą, która
    // ogranicza jego dalsze życie po skopiowaniu z panelu.
    await signCvUrl(`${TENANT}/uploads/2026-08-14/abc.pdf`);
    expect(supabaseMock.state.signs[0].expiresIn).toBe(300);
  });

  it("okno ważności da się zawęzić wołaniem", async () => {
    await signCvUrl(`${TENANT}/uploads/2026-08-14/abc.pdf`, 60);
    expect(supabaseMock.state.signs[0].expiresIn).toBe(60);
  });

  it("błąd podpisu daje `null`, nie wyjątek i nie pusty napis", async () => {
    // Panel renderuje przycisk „Pobierz CV" tylko dla wartości niepustej.
    // Pusty napis przeszedłby jako adres i dał link prowadzący w nikąd.
    supabaseMock.state.signError = { message: "not found" };
    await expect(signCvUrl("brak.pdf")).resolves.toBeNull();
  });

  it("brak adresu w odpowiedzi też daje `null`", async () => {
    supabaseMock.state.signedUrl = null;
    await expect(signCvUrl("brak.pdf")).resolves.toBeNull();
  });

  it("podpisuje ścieżkę PODANĄ PRZEZ WOŁAJĄCEGO - bramką jest polityka bucketu", async () => {
    // Zapisany kontrakt, nie luka. Klient nie sprawdza, czy ścieżka należy do
    // jego tenanta, bo nie jest w stanie tego wiedzieć - `is_staff()` sprawdza
    // rolę, nie tenanta, więc jedynym miejscem, w którym da się to rozstrzygnąć,
    // jest polityka SELECT na buckecie porównująca pierwszy segment ścieżki
    // z tenantem. Ten warunek istnieje, żeby nikt nie usunął tej polityki
    // „bo klient i tak podaje własne ścieżki".
    await signCvUrl(`${OTHER_TENANT}/uploads/2026-08-14/cudze.pdf`);
    expect(supabaseMock.state.signs[0].path).toBe(`${OTHER_TENANT}/uploads/2026-08-14/cudze.pdf`);
  });
});
