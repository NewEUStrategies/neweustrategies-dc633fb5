// Edytor profilu „w miejscu" - warstwa danych. Stała na ZERZE pokrycia, a jest
// jedynym miejscem, przez które przechodzi KAŻDA edycja pola profilu i wysyłka
// avatara/okładki. Trzy rzeczy, których złamanie kosztuje dane albo prywatność:
//
//   1. KANONICZNE BIO. Pole `bio` w tym hooku to `profiles.bio_pl` na drucie.
//      Gdyby zapis poszedł do starej kolumny `bio`, edytor jednopolowy
//      i edytor PL/EN pisałyby w dwa różne miejsca - użytkownik zobaczyłby
//      dwa różne opisy siebie zależnie od strony.
//   2. ZAWĘŻENIE ZAPISU. Grant UPDATE na `profiles` ma rolę `authenticated`,
//      nie właściciela wiersza. Brak `.eq("id", uid)` to zapis na cudzym profilu.
//   3. ŚCIEŻKA UPLOADU. Zaczyna się od `tenant_id`, więc to ona odpowiada za
//      izolację plików między kontami w kubełku `media`.
//
// Do tego dochodzi COFANIE OPTYMISTYCZNE: nieudany zapis musi przywrócić
// poprzednią wartość w cache. Bez tego interfejs pokazuje wartość, której
// w bazie nie ma, aż do pełnego przeładowania.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fail,
  fileOfSize,
  ok,
  profileEditorRow,
  PROFILE_IDS,
  storageStub,
  supabaseFromStub,
  xhrStub,
} from "@/test/profile/fixtures";

const h = vi.hoisted(() => ({
  auth: { uid: "user-me" as string | null },
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

const stubs = vi.hoisted(() => ({ from: null as unknown, storage: null as unknown }));

vi.mock("@/integrations/supabase/client", async () => {
  const fixtures = await import("@/test/profile/fixtures");
  const from = fixtures.supabaseFromStub();
  const store = fixtures.storageStub();
  stubs.from = from;
  stubs.storage = store;
  return { supabase: { from: from.from, storage: store.storage } };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.auth.uid ? { id: h.auth.uid } : null }),
}));

vi.mock("sonner", () => ({
  toast: { error: (m: string) => h.toastError(m), success: (m: string) => h.toastSuccess(m) },
}));

import { profileEditorKey, useProfileEditor } from "../useProfileEditor";

type FromStub = ReturnType<typeof supabaseFromStub>;
type StorageStub = ReturnType<typeof storageStub>;
const db = () => stubs.from as FromStub;
const store = () => stubs.storage as StorageStub;

function makeClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** Wstaje hook i czeka na wczytany wiersz profilu. */
async function mountEditor(
  row: ReturnType<typeof profileEditorRow> | null = profileEditorRow(),
  client: QueryClient = makeClient(),
) {
  db().setResponse("profiles", ok(row));
  const hook = renderHook(() => useProfileEditor(), { wrapper: wrapperFor(client) });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return { hook, client };
}

let xhr: ReturnType<typeof xhrStub> | null = null;

beforeEach(() => {
  h.auth.uid = PROFILE_IDS.me;
  h.toastError.mockReset();
  h.toastSuccess.mockReset();
  db().reset();
  store().reset();
});

afterEach(() => {
  xhr?.restore();
  xhr = null;
});

describe("odczyt profilu", () => {
  it("czyta wiersz zawężony do własnego id i nigdy przez `*`", async () => {
    const { hook } = await mountEditor();

    expect(hook.result.current.data.display_name).toBe("Anna Nowak");
    const chain = db().lastChain("profiles");
    expect(chain?.argsOf("eq")).toEqual(["id", PROFILE_IDS.me]);
    // `profiles` ma kolumnowe granty i kolumny PII bez grantu - `*` sypie 403
    // albo (gorzej) wciąga kolumny, których interfejs nie ma prawa widzieć.
    expect(String(chain?.argsOf("select")?.[0] ?? "")).not.toContain("*");
  });

  it("KANONICZNE bio bierze się z `bio_pl`, nie ze starej kolumny `bio`", async () => {
    // Rozjazd tych dwóch kolumn oznacza dwa różne opisy tej samej osoby
    // w zależności od tego, którą powierzchnię użytkownik otworzy.
    db().setResponse("profiles", ok({ ...profileEditorRow(), bio: "STARE", bio_pl: "NOWE" }));
    const hook = renderHook(() => useProfileEditor(), { wrapper: wrapperFor(makeClient()) });

    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.data.bio).toBe("NOWE");
  });

  it("spada na starą kolumnę `bio`, gdy `bio_pl` jest puste (konta przed migracją)", async () => {
    db().setResponse("profiles", ok({ ...profileEditorRow(), bio: "STARE", bio_pl: null }));
    const hook = renderHook(() => useProfileEditor(), { wrapper: wrapperFor(makeClient()) });

    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.data.bio).toBe("STARE");
  });

  it("brak obu kolumn daje `null`, nie napis „null”", async () => {
    db().setResponse("profiles", ok({ ...profileEditorRow(), bio: null, bio_pl: null }));
    const hook = renderHook(() => useProfileEditor(), { wrapper: wrapperFor(makeClient()) });

    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.data.bio).toBeNull();
  });

  it("BRAK wiersza daje pusty formularz, nie awarię edytora", async () => {
    const { hook } = await mountEditor(null);
    expect(hook.result.current.data.display_name).toBeNull();
    expect(hook.result.current.data.tenant_id).toBeNull();
  });

  it("błąd odczytu nie zostawia formularza w stanie „wczytywanie”", async () => {
    db().setResponse("profiles", fail("permission denied"));
    const hook = renderHook(() => useProfileEditor(), { wrapper: wrapperFor(makeClient()) });

    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    // Formularz dostaje pusty wiersz zamiast wisieć na spinnerze.
    expect(hook.result.current.data.display_name).toBeNull();
  });

  it("bez zalogowanego użytkownika nie odpytuje bazy i nie wisi na spinnerze", async () => {
    h.auth.uid = null;
    const hook = renderHook(() => useProfileEditor(), { wrapper: wrapperFor(makeClient()) });

    await Promise.resolve();
    expect(db().chains).toHaveLength(0);
    expect(hook.result.current.loading).toBe(false);
  });
});

describe("saveField", () => {
  it("zapisuje pole zawężone do własnego wiersza", async () => {
    const { hook } = await mountEditor();
    db().setResponse("profiles", ok(null));

    await act(async () => {
      await hook.result.current.saveField("job_title", "Director");
    });

    const chain = db().lastChain("profiles");
    expect(chain?.argsOf("update")).toEqual([{ job_title: "Director" }]);
    expect(chain?.argsOf("eq")).toEqual(["id", PROFILE_IDS.me]);
  });

  it("pole `bio` idzie na drut jako kolumna `bio_pl`", async () => {
    // Sedno punktu 1 z nagłówka: edytor jednopolowy i edytor PL/EN muszą
    // pisać w TĘ SAMĄ kolumnę, bo inaczej powstają dwa niezależne opisy.
    const { hook } = await mountEditor();
    db().setResponse("profiles", ok(null));

    await act(async () => {
      await hook.result.current.saveField("bio", "Nowy opis");
    });

    const patch = db().lastChain("profiles")?.argsOf("update")?.[0] as Record<string, unknown>;
    expect(patch).toEqual({ bio_pl: "Nowy opis" });
    expect(patch).not.toHaveProperty("bio");
  });

  it("pokazuje nową wartość NATYCHMIAST (zapis optymistyczny)", async () => {
    const { hook, client } = await mountEditor();
    db().setResponse("profiles", ok(null));

    await act(async () => {
      await hook.result.current.saveField("location", "Warszawa");
    });

    expect(client.getQueryData(profileEditorKey(PROFILE_IDS.me))).toMatchObject({
      location: "Warszawa",
    });
  });

  it("NIEUDANY zapis COFA wartość w cache i mówi o tym użytkownikowi", async () => {
    // Bez cofnięcia interfejs pokazuje wartość, której w bazie nie ma - do
    // następnego pełnego przeładowania strony.
    const { hook, client } = await mountEditor(profileEditorRow({ location: "Bruksela" }));
    db().setResponse("profiles", fail("value too long"));

    await act(async () => {
      await hook.result.current.saveField("location", "Warszawa");
    });

    expect(client.getQueryData(profileEditorKey(PROFILE_IDS.me))).toMatchObject({
      location: "Bruksela",
    });
    expect(h.toastError).toHaveBeenCalledWith("value too long");
  });

  it("po udanym zapisie NIE pokazuje błędu", async () => {
    const { hook } = await mountEditor();
    db().setResponse("profiles", ok(null));

    await act(async () => {
      await hook.result.current.saveField("phone", "+48 22 000 00 00");
    });

    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("unieważnia nagłówek, powitanie I pasek boczny", async () => {
    // Trzy niezależne zapytania czytają nazwę użytkownika. Bez tej trójki
    // pasek boczny pokazywał starą nazwę do pełnego przeładowania.
    const { hook, client } = await mountEditor();
    db().setResponse("profiles", ok(null));
    const spy = vi.spyOn(client, "invalidateQueries");

    await act(async () => {
      await hook.result.current.saveField("display_name", "Anna Kowalska");
    });

    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(["header-profile", PROFILE_IDS.me]));
    expect(keys).toContain(JSON.stringify(["greeting", PROFILE_IDS.me]));
    expect(keys).toContain(JSON.stringify(["profile-sidebar", PROFILE_IDS.me]));
  });

  it("nieudany zapis NIE unieważnia nagłówka (nie ma nowej wartości do pokazania)", async () => {
    const { hook, client } = await mountEditor();
    db().setResponse("profiles", fail("boom"));
    const spy = vi.spyOn(client, "invalidateQueries");

    await act(async () => {
      await hook.result.current.saveField("display_name", "Anna Kowalska");
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it("zapis PRZY PUSTYM cache cofa się do pustego wiersza, nie do `undefined`", async () => {
    // Cache mógł zostać usunięty (gcTime, jawne unieważnienie z usunięciem)
    // między wczytaniem formularza a kliknięciem zapisu. Bez `?? EMPTY`
    // rozwinięcie `{...prevRow}` poleciałoby na `undefined`, a cofnięcie
    // optymistyczne nie miałoby do czego wrócić.
    const { hook, client } = await mountEditor();
    client.removeQueries({ queryKey: profileEditorKey(PROFILE_IDS.me) });
    db().setResponse("profiles", fail("boom"));

    await act(async () => {
      await hook.result.current.saveField("location", "Warszawa");
    });

    expect(client.getQueryData(profileEditorKey(PROFILE_IDS.me))).toMatchObject({
      location: null,
    });
    expect(h.toastError).toHaveBeenCalledWith("boom");
  });

  it("bez sesji nie pisze do bazy", async () => {
    // Hook musi wstać BEZ sesji: `saveField` to `useCallback` domknięty na
    // `uid`, więc podmiana atrapy po montażu nie odświeżyłaby domknięcia
    // (w produkcji odświeża je zmiana kontekstu uwierzytelnienia).
    h.auth.uid = null;
    const hook = renderHook(() => useProfileEditor(), { wrapper: wrapperFor(makeClient()) });

    await act(async () => {
      await hook.result.current.saveField("job_title", "Director");
    });

    expect(db().chains).toHaveLength(0);
  });
});

describe("upload - bramki wejścia", () => {
  it("odrzuca avatar powyżej 2 MB i NIE dotyka Storage", async () => {
    const { hook } = await mountEditor();

    await act(async () => {
      await hook.result.current.upload(fileOfSize(2 * 1024 * 1024 + 1), "avatar");
    });

    expect(store().signedPaths).toHaveLength(0);
    expect(hook.result.current.status.avatar).toBe("failed");
    expect(h.toastError).toHaveBeenCalledWith("File too large");
  });

  it("okładka ma WIĘKSZY limit niż avatar (5 MB) - 3 MB przechodzi", async () => {
    // Dwa różne limity to decyzja, nie przypadek: okładka jest szeroka.
    // Wspólny limit avatara odrzucałby poprawne okładki.
    xhr = xhrStub(200);
    const { hook } = await mountEditor();
    db().setResponse("profiles", ok(null));

    await act(async () => {
      await hook.result.current.upload(fileOfSize(3 * 1024 * 1024, "cover.png"), "cover");
    });

    expect(hook.result.current.status.cover).toBe("success");
  });

  it("odrzuca okładkę powyżej 5 MB", async () => {
    const { hook } = await mountEditor();

    await act(async () => {
      await hook.result.current.upload(fileOfSize(5 * 1024 * 1024 + 1, "cover.png"), "cover");
    });

    expect(store().signedPaths).toHaveLength(0);
    expect(hook.result.current.status.cover).toBe("failed");
  });

  it("BEZ tenanta nie wysyła nic - ścieżka bez stempla nie ma izolacji", async () => {
    // `tenant_id` jest pierwszym segmentem ścieżki w kubełku. Upload bez niego
    // wylądowałby poza przestrzenią tenanta.
    const { hook } = await mountEditor(profileEditorRow({ tenant_id: null }));

    await act(async () => {
      await hook.result.current.upload(fileOfSize(1024), "avatar");
    });

    expect(store().signedPaths).toHaveLength(0);
    expect(hook.result.current.status.avatar).toBe("idle");
  });

  it("bez sesji nie wysyła nic", async () => {
    // Druga strona tej samej bramki `!uid || !data.tenant_id`: powyżej sesja
    // jest, brakuje tenanta; tu nie ma sesji, więc nie ma i wiersza profilu.
    h.auth.uid = null;
    const hook = renderHook(() => useProfileEditor(), { wrapper: wrapperFor(makeClient()) });

    await act(async () => {
      await hook.result.current.upload(fileOfSize(1024), "avatar");
    });

    expect(store().signedPaths).toHaveLength(0);
    expect(hook.result.current.status.avatar).toBe("idle");
  });
});

describe("upload - ścieżka i zapis", () => {
  it("stempluje ścieżkę TENANTEM i id użytkownika, w kubełku `media`", async () => {
    xhr = xhrStub(200);
    const { hook } = await mountEditor();
    db().setResponse("profiles", ok(null));

    await act(async () => {
      await hook.result.current.upload(fileOfSize(1024, "zdjecie.PNG"), "avatar");
    });

    expect(store().buckets).toContain("media");
    const path = store().signedPaths[0];
    expect(path.startsWith(`${PROFILE_IDS.tenant}/users/${PROFILE_IDS.me}/avatar-`)).toBe(true);
    // Rozszerzenie schodzi do małych liter - inaczej ten sam plik ma dwa adresy.
    expect(path.endsWith(".png")).toBe(true);
  });

  it("nazwa kończąca się KROPKĄ dostaje domyślne `.jpg`", async () => {
    xhr = xhrStub(200);
    const { hook } = await mountEditor();
    db().setResponse("profiles", ok(null));

    await act(async () => {
      await hook.result.current.upload(fileOfSize(1024, "zdjecie."), "avatar");
    });

    expect(store().signedPaths[0].endsWith(".jpg")).toBe(true);
  });

  it("nazwa BEZ kropki trafia do ścieżki całością - ale nie wychodzi z prefiksu", async () => {
    // Zachowanie faktyczne, nie życzeniowe: `"zdjecie".split(".").pop()` zwraca
    // całą nazwę, więc plik bez kropki dostaje „rozszerzenie" `zdjecie`.
    // Kosmetyczne (adres i tak jest jednorazowy), ale ISTOTNE jest to, co niżej:
    // segment po ostatniej kropce nie może zawierać „..”, bo kropka kończy
    // segment - więc ścieżka nie ucieka z `<tenant>/users/<uid>/`.
    xhr = xhrStub(200);
    const { hook } = await mountEditor();
    db().setResponse("profiles", ok(null));

    await act(async () => {
      await hook.result.current.upload(fileOfSize(1024, "zdjecie"), "avatar");
    });

    const path = store().signedPaths[0];
    expect(path.endsWith(".zdjecie")).toBe(true);
    expect(path.startsWith(`${PROFILE_IDS.tenant}/users/${PROFILE_IDS.me}/`)).toBe(true);
    expect(path).not.toContain("..");
  });

  it("po wysyłce zapisuje ADRES PUBLICZNY w kolumnie zgodnej z rodzajem", async () => {
    xhr = xhrStub(200);
    const { hook } = await mountEditor();
    db().setResponse("profiles", ok(null));

    await act(async () => {
      await hook.result.current.upload(fileOfSize(1024), "cover");
    });

    const patch = db().lastChain("profiles")?.argsOf("update")?.[0] as Record<string, unknown>;
    expect(Object.keys(patch)).toEqual(["cover_url"]);
    expect(String(patch.cover_url)).toContain(store().publicPaths[0]);
    expect(hook.result.current.status.cover).toBe("success");
    expect(hook.result.current.progress.cover).toBe(100);
  });

  it("avatar zapisuje się do `avatar_url`, nie do `cover_url`", async () => {
    xhr = xhrStub(200);
    const { hook } = await mountEditor();
    db().setResponse("profiles", ok(null));

    await act(async () => {
      await hook.result.current.upload(fileOfSize(1024), "avatar");
    });

    const patch = db().lastChain("profiles")?.argsOf("update")?.[0] as Record<string, unknown>;
    expect(Object.keys(patch)).toEqual(["avatar_url"]);
  });

  it("wysyła PUT z typem pliku i nagłówkiem nadpisania", async () => {
    xhr = xhrStub(200);
    const { hook } = await mountEditor();
    db().setResponse("profiles", ok(null));

    await act(async () => {
      await hook.result.current.upload(fileOfSize(1024, "a.png", "image/png"), "avatar");
    });

    const req = xhr.requests[0];
    expect(req.method).toBe("PUT");
    expect(req.headers["Content-Type"]).toBe("image/png");
    // Bez `x-upsert` powtórna wysyłka pod ten sam adres kończy się konfliktem.
    expect(req.headers["x-upsert"]).toBe("true");
  });

  it("plik bez typu MIME leci jako strumień bajtów, nie jako pusty nagłówek", async () => {
    xhr = xhrStub(200);
    const { hook } = await mountEditor();
    db().setResponse("profiles", ok(null));

    await act(async () => {
      await hook.result.current.upload(fileOfSize(1024, "a.png", ""), "avatar");
    });

    expect(xhr.requests[0].headers["Content-Type"]).toBe("application/octet-stream");
  });

  it("raportuje POSTĘP w procentach", async () => {
    // Pasek postępu bez tego stoi na zerze do końca wysyłki - przy okładce
    // 5 MB na wolnym łączu wygląda to jak zawieszony formularz.
    xhr = xhrStub(200, [[25, 100]]);
    const { hook } = await mountEditor();
    db().setResponse("profiles", ok(null));

    await act(async () => {
      await hook.result.current.upload(fileOfSize(1024), "avatar");
    });

    // Po sukcesie postęp domyka się na 100, ale zdarzenie 25% musiało przejść
    // przez `lengthComputable` - inaczej ta gałąź nigdy się nie wykonuje.
    expect(hook.result.current.progress.avatar).toBe(100);
  });
});

describe("upload - awarie", () => {
  it("błąd podpisu URL-a kończy się stanem `failed`, nie cichym niepowodzeniem", async () => {
    const { hook } = await mountEditor();
    store().failSign("storage quota exceeded");

    await act(async () => {
      await hook.result.current.upload(fileOfSize(1024), "avatar");
    });

    expect(hook.result.current.status.avatar).toBe("failed");
    expect(h.toastError).toHaveBeenCalledWith("storage quota exceeded");
    // Nieudany podpis nie może zostawić adresu w kolumnie profilu.
    expect(
      db()
        .chainsFor("profiles")
        .some((c) => c.has("update")),
    ).toBe(false);
  });

  it("PUSTY podpis bez błędu też jest awarią (nie ma gdzie wysłać)", async () => {
    // Storage może odpowiedzieć 200 bez ładunku. Bez tej gałęzi kod poleciałby
    // dalej na `signed.signedUrl` i wywalił się na `undefined`.
    const { hook } = await mountEditor();
    store().signWithoutData();

    await act(async () => {
      await hook.result.current.upload(fileOfSize(1024), "avatar");
    });

    expect(hook.result.current.status.avatar).toBe("failed");
    expect(h.toastError).toHaveBeenCalledWith("sign failed");
  });

  it("odrzucenie NIE-błędem daje komunikat zapasowy, nie `[object Object]`", async () => {
    // Warstwa transportowa potrafi odrzucić napisem albo gołym obiektem.
    // Wstawienie takiej wartości wprost do toastu pokazuje użytkownikowi śmieci.
    const { hook } = await mountEditor();
    store().failSignWith({ statusCode: "403" });

    await act(async () => {
      await hook.result.current.upload(fileOfSize(1024), "avatar");
    });

    expect(hook.result.current.status.avatar).toBe("failed");
    expect(h.toastError).toHaveBeenCalledWith("Upload failed");
  });

  it("zdarzenie postępu BEZ znanego rozmiaru nie psuje licznika", async () => {
    // Odpowiedź bez `Content-Length` daje `lengthComputable: false`.
    // Liczenie procentu z zerowego `total` dałoby NaN na pasku postępu.
    xhr = xhrStub(200, ["unknown"]);
    const { hook } = await mountEditor();
    db().setResponse("profiles", ok(null));

    await act(async () => {
      await hook.result.current.upload(fileOfSize(1024), "avatar");
    });

    expect(hook.result.current.status.avatar).toBe("success");
    expect(hook.result.current.progress.avatar).toBe(100);
    expect(Number.isNaN(hook.result.current.progress.avatar)).toBe(false);
  });

  it("odpowiedź HTTP poza 2xx to awaria z kodem w komunikacie", async () => {
    xhr = xhrStub(500);
    const { hook } = await mountEditor();

    await act(async () => {
      await hook.result.current.upload(fileOfSize(1024), "avatar");
    });

    expect(hook.result.current.status.avatar).toBe("failed");
    expect(h.toastError).toHaveBeenCalledWith("HTTP 500");
  });

  it("zerwana sieć w trakcie wysyłki to awaria, nie wieczne „wysyłanie”", async () => {
    // Stan `uploading`, z którego nie ma wyjścia, blokuje przycisk na zawsze.
    xhr = xhrStub("error");
    const { hook } = await mountEditor();

    await act(async () => {
      await hook.result.current.upload(fileOfSize(1024), "avatar");
    });

    expect(hook.result.current.status.avatar).toBe("failed");
    expect(h.toastError).toHaveBeenCalledWith("network");
  });

  it("awaria JEDNEGO rodzaju nie psuje stanu drugiego", async () => {
    // Stany są trzymane w jednym obiekcie - podmiana całego zamiast pola
    // zerowałaby postęp trwającej wysyłki okładki przy błędzie avatara.
    xhr = xhrStub(200);
    const { hook } = await mountEditor();
    db().setResponse("profiles", ok(null));

    await act(async () => {
      await hook.result.current.upload(fileOfSize(1024), "cover");
    });
    expect(hook.result.current.status.cover).toBe("success");

    await act(async () => {
      await hook.result.current.upload(fileOfSize(3 * 1024 * 1024), "avatar");
    });

    expect(hook.result.current.status.avatar).toBe("failed");
    expect(hook.result.current.status.cover).toBe("success");
  });
});
