// Edytor profilu AUTORA (/profile/author i /admin/users/$id) - stał na ZERZE
// pokrycia przy 219 instrukcjach, największy pojedynczy plik profilu bez
// żadnej asercji. Współdzielony między dwoma trybami: `self` (właściciel
// edytuje siebie) i `admin` (staff edytuje dowolnego użytkownika w tenancie).
//
// Cztery reguły, których złamanie widzi użytkownik albo inny tenant:
//
//   1. TRYB DECYDUJE O ŹRÓDLE ODCZYTU. `self` czyta przez
//      `get_own_author_profile()` (scope: auth.uid()), `admin` przez
//      `admin_get_author_profile()` (scope: rola admina + tenant admina).
//      Zamiana tych dwóch RPC-ów pozwoliłaby administratorowi odczytać PII
//      (`contact_email`, `phone`) profilu spoza własnego tenanta.
//   2. KANONICZNE BIO WYGRYWA NAD LEGACY OVERLAY. `profiles.bio_pl/bio_en`
//      są źródłem prawdy; `author_profiles.bio_*` to fallback wyłącznie dla
//      kont, które nigdy nie zapisały bio w `profiles`.
//   3. SYNCHRONIZACJA OBSZARÓW EKSPERTYZY LICZY RÓŻNICĘ, NIE NADPISUJE
//      WSZYSTKIEGO. `syncExpertiseAreas` czyta bieżący stan z bazy PONOWNIE
//      przy zapisie i wysyła TYLKO dodane/usunięte id - reset całej tabeli
//      przy każdym zapisie kasowałby znaczniki `created_at` powiązań, które
//      nic tu nie zmieniły.
//   4. ZAPIS JEST TRZEMA OPERACJAMI RAPORTOWANYMI JAKO JEDNA. `author_profiles`
//      (upsert), `profiles.bio_*` (update) i obszary ekspertyzy (diff) - błąd
//      KTÓREJKOLWIEK musi dać komunikat błędu, nie częściowy sukces.
//
// DOPISANE W ETAPIE 7c (blok na końcu pliku): drugi koniec KAŻDEJ ścieżki
// zapisu i wysyłki - odmowa podpisu URL-a, podpis bez danych, odrzucenie HTTP,
// awaria sieci, błąd INSERT/DELETE powiązania z obszarem ekspertyzy - plus
// komplet pól formularza (żadne nie nadpisuje sąsiada), podpowiedź o presecie
// layoutu w obu językach i dostępność formularza (axe).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE:
// - WNĘTRZA sekcji wzmianek medialnych - `MediaMentionsSection.test.tsx`;
//   tutaj liczy się tylko to, KIEDY się pojawia.
// - kadrowania i skalowania obrazu - `ImageCropDialog` jest zaatrapowany,
//   jego własne testy stoją przy komponencie.
// - wyboru kanonicznego bio jako funkcji - `preferCanonicalBio` ma testy
//   w `src/lib/profile/__tests__/`.
// - RLS i uprawnień RPC - to warstwa pgTAP, nie vitest.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import {
  fail,
  ok,
  PROFILE_IDS,
  queryStub,
  storageStub,
  supabaseFromStub,
  xhrStub,
  type SupabaseResult,
} from "@/test/profile/fixtures";
import { axeViolations, summarize } from "@/test/axe";
import type { Result } from "axe-core";

type RpcResult = SupabaseResult;

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  adminGetAuthorProfile: vi.fn(),
  refreshOg: vi.fn(),
  layoutSettings: { current: null as unknown },
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  // Język WIDOKU. Edytor wybiera po nim etykietę presetu layoutu i nazwę
  // obszaru ekspertyzy - obie gałęzie muszą dać się przełączyć z testu.
  language: "pl",
}));

const stubs = vi.hoisted(() => ({ from: null as unknown, storage: null as unknown }));

vi.mock("react-i18next", async () => {
  const fixtures = await import("@/test/profile/fixtures");
  return fixtures.reactI18nextStub(() => h.language);
});

vi.mock("@/lib/i18n-experts", () => ({}));

vi.mock("@/integrations/supabase/client", async () => {
  const fixtures = await import("@/test/profile/fixtures");
  const from = fixtures.supabaseFromStub();
  // Storage bierzemy z fixture'ów zamiast lepić doraźnie w tym pliku: atrapa
  // z `src/test/profile/fixtures.ts` zwraca DOKŁADNIE te same adresy
  // (`https://upload.example/...`, `https://cdn.example/...`), ale dodatkowo
  // umie ODMÓWIĆ podpisu (`failSign`) i odpowiedzieć „bez błędu i bez danych"
  // (`signWithoutData`). Bez tego gałąź `if (signErr || !signed)` w wysyłce
  // avatara nie ma jak się wykonać, a to ona decyduje, czy nieudany upload
  // pokaże komunikat, czy podmieni avatar na `undefined`.
  const storage = fixtures.storageStub();
  stubs.from = from;
  stubs.storage = storage;
  return {
    supabase: {
      from: from.from,
      rpc: (fn: string, args?: Record<string, unknown>) => {
        // `get_own_author_profile()` jest łańcuchowane przez `.maybeSingle()`
        // w kodzie produkcyjnym - atrapa musi dać ten sam kształt budowniczego,
        // co `supabase.from(...)`, nie gołą obietnicę.
        const result = h.rpc(fn, args) as RpcResult;
        return { maybeSingle: () => Promise.resolve(result) };
      },
      storage: storage.storage,
    },
  };
});

vi.mock("@/lib/experts/adminAuthorProfileRpc", () => ({
  adminGetAuthorProfile: (userId: string) => {
    const result = h.adminGetAuthorProfile(userId) as RpcResult;
    return { maybeSingle: () => Promise.resolve(result) };
  },
}));

vi.mock("@/hooks/useExpertLayoutSettings", () => ({
  useExpertLayoutSettings: () => h.layoutSettings.current,
}));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => h.refreshOg,
}));

vi.mock("@/lib/experts/refreshOg.functions", () => ({
  refreshAuthorOgImage: () => h.refreshOg(),
}));

// Sekcja mentions w mediach ma WŁASNY plik testowy i własną warstwę danych -
// tutaj liczy się TYLKO to, KIEDY się pojawia (`exists`), nie jej wnętrze.
vi.mock("@/components/profile/MediaMentionsSection", () => ({
  MediaMentionsSection: ({ userId }: { userId: string }) => (
    <div data-testid="media-mentions">{userId}</div>
  ),
}));

// Kadrowanie avatara potrzebuje canvasu, którego happy-dom nie ma - atrapa
// odgrywa WYŁĄCZNIE potwierdzenie z gotowym blobem, tak jak w testach
// AccountIdentityPanel.
vi.mock("@/components/media/ImageCropDialog", async () => {
  const React = await import("react");
  return {
    CROP_PRESETS: { avatar: { aspect: 1, targetWidth: 512, targetHeight: 512 } },
    ImageCropDialog: (props: {
      open: boolean;
      file: File | null;
      onConfirm: (blob: Blob) => void;
      onOpenChange: (open: boolean) => void;
    }) => {
      if (!props.open) return null;
      return React.createElement("div", null, [
        React.createElement(
          "button",
          {
            key: "confirm",
            type: "button",
            "data-testid": "crop-confirm",
            // Odgrywa `file` NIEZMIENIONY jako "wykadrowany" blob - kadrowanie
            // realnie zmienia rozmiar, ale test bramki rozmiaru potrzebuje
            // rozmiaru pliku wybranego przez użytkownika, nie sztywnej wartości.
            onClick: () => props.onConfirm(props.file ?? new Blob([new Uint8Array(10)])),
          },
          "confirm crop",
        ),
        // Rezygnacja z kadrowania. Prawdziwy dialog woła `onOpenChange(false)`
        // z trzech miejsc (Escape, kliknięcie tła, przycisk „Anuluj") i to
        // JEDYNY sposób, w jaki edytor dowiaduje się, że ma wyrzucić wybrany
        // plik - bez tego przycisku gałąź czyszczenia `pendingFile` jest
        // nieosiągalna z testu.
        React.createElement(
          "button",
          {
            key: "cancel",
            type: "button",
            "data-testid": "crop-cancel",
            onClick: () => props.onOpenChange(false),
          },
          "cancel crop",
        ),
      ]);
    },
  };
});

vi.mock("sonner", () => ({
  toast: {
    success: (m: string) => h.toastSuccess(m),
    error: (m: string) => h.toastError(m),
  },
}));

import { AuthorProfileEditor } from "@/components/profile/AuthorProfileEditor";

type FromStub = ReturnType<typeof supabaseFromStub>;
const db = () => stubs.from as FromStub;

type StorageStubShape = ReturnType<typeof storageStub>;
const files = () => stubs.storage as StorageStubShape;

/** Wiersz `author_profiles` (kształt zwracany przez oba RPC odczytu). */
function authorRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    avatar_url: null,
    job_title: "Head of EU Affairs",
    company: "NES",
    bio_pl: "Stare bio z author_profiles",
    bio_en: null,
    full_bio_pl: null,
    full_bio_en: null,
    org_functions: [],
    contact_email: null,
    phone: null,
    website_url: null,
    x_url: null,
    linkedin_url: null,
    facebook_url: null,
    instagram_url: null,
    spotify_url: null,
    media_contact_name: null,
    media_contact_email: null,
    media_contact_phone: null,
    custom_socials: [],
    is_public: false,
    ...overrides,
  };
}

/** Plan odpowiedzi wszystkich czterech zapytań ładujących formularz. */
function planLoad(options: {
  row?: Record<string, unknown> | null;
  mode?: "self" | "admin";
  canonicalBio?: { bio_pl: string | null; bio_en: string | null };
  areas?: Array<{ id: string; name_pl: string; name_en: string }>;
  myAreaIds?: string[];
}): void {
  const mode = options.mode ?? "self";
  const result = ok(options.row ?? null);
  if (mode === "self") h.rpc.mockReturnValue(result);
  else h.adminGetAuthorProfile.mockReturnValue(result);
  db().setResponse("profiles", ok(options.canonicalBio ?? { bio_pl: null, bio_en: null }));
  db().setResponse("expertise_areas", ok(options.areas ?? []));
  db().setResponse(
    "expert_expertise_areas",
    ok((options.myAreaIds ?? []).map((area_id) => ({ area_id }))),
  );
}

async function renderEditor(props: Partial<React.ComponentProps<typeof AuthorProfileEditor>> = {}) {
  const view = renderWithQueryClient(
    <AuthorProfileEditor
      userId={PROFILE_IDS.me}
      tenantId={PROFILE_IDS.tenant}
      mode="self"
      {...props}
    />,
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /profile\.(account\.save|author\.create)/ }),
    ).toBeInTheDocument(),
  );
  return view;
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: /profile\.(account\.save|author\.create)/ });
}

/** Przycisk "dodaj" wewnątrz sekcji o wskazanym nagłówku - `common.add` jest
 *  etykietą DWÓCH przycisków (funkcje organizacyjne, linki niestandardowe). */
function addButtonIn(sectionHeading: string): HTMLElement {
  const heading = screen.getByText(sectionHeading);
  const section = heading.closest("div")!;
  const button = section.querySelector("button");
  if (!button) throw new Error(`test: brak przycisku dodawania w sekcji "${sectionHeading}"`);
  return button;
}

let xhr: ReturnType<typeof xhrStub> | null = null;

beforeEach(() => {
  h.rpc.mockReset();
  h.adminGetAuthorProfile.mockReset();
  h.refreshOg.mockReset();
  h.layoutSettings.current = queryStub(null);
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.language = "pl";
  db().reset();
  files().reset();
  planLoad({ row: null });
});

afterEach(() => {
  xhr?.restore();
  xhr = null;
});

describe("wybór źródła odczytu wg trybu", () => {
  it("`self` czyta przez get_own_author_profile(), NIE adminGetAuthorProfile", async () => {
    // Reguła 1. Odwrócenie tych dwóch RPC-ów w trybie self byłoby nieszkodliwe
    // (własny wiersz), ale dowodzi, że gałąź trybu w ogóle nie jest sprawdzana.
    await renderEditor({ mode: "self" });

    expect(h.rpc).toHaveBeenCalledWith("get_own_author_profile", undefined);
    expect(h.adminGetAuthorProfile).not.toHaveBeenCalled();
  });

  it("`admin` czyta przez adminGetAuthorProfile(userId), NIE get_own_author_profile", async () => {
    // Odwrotna gałąź reguły 1: gdyby admin czytał `get_own_author_profile`,
    // dostałby WŁASNY wiersz zamiast wiersza edytowanego użytkownika.
    planLoad({ mode: "admin", row: authorRow({ job_title: "Cudzy tytuł" }) });
    await renderEditor({ mode: "admin", userId: PROFILE_IDS.other });

    expect(h.adminGetAuthorProfile).toHaveBeenCalledWith(PROFILE_IDS.other);
    expect(h.rpc).not.toHaveBeenCalledWith("get_own_author_profile", expect.anything());
  });

  it("błąd odczytu pokazuje komunikat, formularz zostaje pusty (nie awaria)", async () => {
    h.rpc.mockReturnValue(fail("permission denied"));
    await renderEditor();
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("profile.author.loadError"));
    expect(screen.getByLabelText("profile.account.jobTitle")).toHaveValue("");
  });
});

describe("kanoniczne bio", () => {
  it("bio z `profiles` WYGRYWA nad `author_profiles` (legacy overlay)", async () => {
    // Reguła 2. Konto, które ma bio w obu miejscach, ma pokazać TO z profiles -
    // ono jest źródłem prawdy dla reszty platformy (karta autora, widget bio).
    planLoad({
      row: authorRow({ bio_pl: "Legacy z author_profiles" }),
      canonicalBio: { bio_pl: "Kanoniczne z profiles", bio_en: null },
    });
    await renderEditor();

    expect(screen.getByDisplayValue("Kanoniczne z profiles")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Legacy z author_profiles")).not.toBeInTheDocument();
  });

  it("SPADA na legacy overlay, gdy `profiles.bio_pl` jest puste", async () => {
    planLoad({
      row: authorRow({ bio_pl: "Jedyne dostępne bio" }),
      canonicalBio: { bio_pl: null, bio_en: null },
    });
    await renderEditor();

    expect(screen.getByDisplayValue("Jedyne dostępne bio")).toBeInTheDocument();
  });

  it("bio zamienia się na punktory - jeden wiersz na linię", async () => {
    planLoad({
      row: authorRow({ bio_pl: "Pierwszy punkt\nDrugi punkt" }),
    });
    await renderEditor();

    expect(screen.getByDisplayValue("Pierwszy punkt")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Drugi punkt")).toBeInTheDocument();
  });
});

describe("stan istnienia wiersza", () => {
  it("BRAK wiersza: przycisk mówi 'utwórz', sekcja mediów się NIE pokazuje", async () => {
    planLoad({ row: null });
    await renderEditor();

    expect(screen.getByRole("button", { name: "profile.author.create" })).toBeInTheDocument();
    expect(screen.queryByTestId("media-mentions")).not.toBeInTheDocument();
  });

  it("ISTNIEJĄCY wiersz: przycisk mówi 'zapisz', sekcja mediów się pokazuje", async () => {
    planLoad({ row: authorRow() });
    await renderEditor();

    expect(screen.getByRole("button", { name: "profile.account.save" })).toBeInTheDocument();
    expect(screen.getByTestId("media-mentions")).toHaveTextContent(PROFILE_IDS.me);
  });
});

describe("obszary ekspertyzy - synchronizacja różnicowa", () => {
  const AREAS = [
    { id: "area-1", name_pl: "Energia", name_en: "Energy" },
    { id: "area-2", name_pl: "Klimat", name_en: "Climate" },
    { id: "area-3", name_pl: "Handel", name_en: "Trade" },
  ];

  it("wysyła TYLKO dodane id, nie całą listę zaznaczonych", async () => {
    // Reguła 3. Obszar już zapisany (area-1) nie może wrócić w INSERT - RPC
    // złapałby duplikat klucza, a semantycznie oznaczałoby to nowe powiązanie.
    planLoad({ areas: AREAS, myAreaIds: ["area-1"], row: authorRow() });
    db().setResponse("author_profiles", ok(null));
    db().setResponse("profiles", ok({ bio_pl: null, bio_en: null }));
    await renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Klimat" }));
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const insertChain = db()
      .chainsFor("expert_expertise_areas")
      .find((c) => c.has("insert"));
    expect(insertChain?.argsOf("insert")).toEqual([
      [{ user_id: PROFILE_IDS.me, area_id: "area-2" }],
    ]);
  });

  it("wysyła TYLKO usunięte id, nie zeruje całej tabeli", async () => {
    planLoad({ areas: AREAS, myAreaIds: ["area-1", "area-3"], row: authorRow() });
    db().setResponse("author_profiles", ok(null));
    await renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Handel" }));
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const deleteChain = db()
      .chainsFor("expert_expertise_areas")
      .find((c) => c.has("delete"));
    expect(deleteChain?.argsOf("eq")).toEqual(["user_id", PROFILE_IDS.me]);
    expect(deleteChain?.argsOf("in")).toEqual(["area_id", ["area-3"]]);
  });

  it("bez zmian w zaznaczeniu NIE woła ani insert, ani delete", async () => {
    planLoad({ areas: AREAS, myAreaIds: ["area-1"], row: authorRow() });
    db().setResponse("author_profiles", ok(null));
    await renderEditor();

    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(
      db()
        .chainsFor("expert_expertise_areas")
        .some((c) => c.has("insert")),
    ).toBe(false);
    expect(
      db()
        .chainsFor("expert_expertise_areas")
        .some((c) => c.has("delete")),
    ).toBe(false);
  });

  it("chipy renderują etykietę w JĘZYKU interfejsu", async () => {
    planLoad({ areas: AREAS, row: authorRow() });
    await renderEditor();
    expect(screen.getByRole("button", { name: "Energia" })).toBeInTheDocument();
  });

  it("kliknięcie przełącza stan `aria-pressed`", async () => {
    planLoad({ areas: AREAS, row: authorRow() });
    await renderEditor();

    const chip = screen.getByRole("button", { name: "Energia" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("błąd ODCZYTU stanu bieżącego przy synchronizacji blokuje zapis komunikatem", async () => {
    planLoad({ areas: AREAS, myAreaIds: ["area-1"], row: authorRow() });
    db().setResponse("author_profiles", ok(null));
    await renderEditor();
    // Druga odpowiedź (przy SAMYM zapisie) zwraca błąd - pierwsza (hydratacja)
    // już przeszła, więc podmieniamy odpowiedź PO wyrenderowaniu formularza.
    db().setResponse("expert_expertise_areas", fail("read failed"));

    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("profile.account.saveError"));
  });
});

describe("filtrowanie pustych funkcji organizacyjnych", () => {
  it("wiersz z OBOMA pustymi polami NIE trafia do zapisu", async () => {
    planLoad({ row: authorRow() });
    db().setResponse("author_profiles", ok(null));
    await renderEditor();

    fireEvent.click(addButtonIn("expert.orgFunctions"));
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const chain = db().lastChain("author_profiles");
    const payload = chain?.argsOf("upsert")?.[0] as { org_functions: unknown[] };
    expect(payload.org_functions).toEqual([]);
  });

  it("wiersz z TREŚCIĄ choćby w jednym języku PRZECHODZI", async () => {
    planLoad({ row: authorRow() });
    db().setResponse("author_profiles", ok(null));
    await renderEditor();

    fireEvent.click(addButtonIn("expert.orgFunctions"));
    fireEvent.change(screen.getByPlaceholderText("expert.orgFunctionPl"), {
      target: { value: "Przewodniczący komisji" },
    });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const chain = db().lastChain("author_profiles");
    const payload = chain?.argsOf("upsert")?.[0] as { org_functions: unknown[] };
    expect(payload.org_functions).toEqual([{ pl: "Przewodniczący komisji", en: "" }]);
  });

  it("usunięcie wiersza funkcji organizacyjnej działa przed zapisem", async () => {
    // `authorRow()` ma domyślnie bio - BulletEditor renderuje WŁASNY przycisk
    // "remove", więc szukanie po samej etykiecie złapałoby TEN, nie wiersz
    // funkcji organizacyjnej. Rozróżniamy po polu obok (unikalny placeholder).
    planLoad({ row: authorRow() });
    await renderEditor();

    fireEvent.click(addButtonIn("expert.orgFunctions"));
    fireEvent.click(addButtonIn("expert.orgFunctions"));
    expect(screen.getAllByPlaceholderText("expert.orgFunctionPl")).toHaveLength(2);

    const orgFnRemove = screen
      .getAllByPlaceholderText("expert.orgFunctionPl")[0]
      .closest("div")!
      .querySelector('button[aria-label="remove"]')!;
    fireEvent.click(orgFnRemove);
    expect(screen.getAllByPlaceholderText("expert.orgFunctionPl")).toHaveLength(1);
  });
});

describe("zapis - atomowość raportowania", () => {
  it("upsert do author_profiles jest ZAWĘŻONY do userId/tenantId", async () => {
    planLoad({ row: authorRow() });
    db().setResponse("author_profiles", ok(null));
    await renderEditor();

    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const payload = db().lastChain("author_profiles")?.argsOf("upsert")?.[0] as Record<
      string,
      unknown
    >;
    expect(payload.user_id).toBe(PROFILE_IDS.me);
    expect(payload.tenant_id).toBe(PROFILE_IDS.tenant);
  });

  it("zapisuje bio SKŁADAJĄC punktory z powrotem w profiles.bio_pl/en", async () => {
    planLoad({ row: authorRow({ bio_pl: "Jeden\nDwa" }) });
    db().setResponse("author_profiles", ok(null));
    await renderEditor();

    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const patch = db().lastChain("profiles")?.argsOf("update")?.[0] as Record<string, unknown>;
    expect(patch.bio_pl).toBe("Jeden\nDwa");
  });

  it("błąd upsertu `author_profiles` daje komunikat błędu (reguła 4)", async () => {
    planLoad({ row: authorRow() });
    db().setResponse("author_profiles", fail("upsert failed"));
    await renderEditor();

    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("profile.account.saveError"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("błąd update `profiles.bio_*` TEŻ daje komunikat błędu, mimo że author_profiles się zapisał", async () => {
    // Reguła 4: dwa zapisy idą RÓWNOLEGLE (`Promise.all`) - sukces jednego nie
    // przykrywa błędu drugiego.
    planLoad({ row: authorRow() });
    db().setResponse("author_profiles", ok(null));
    db().setResponse("profiles", fail("profiles update failed"));
    await renderEditor();

    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("profile.account.saveError"));
  });

  it("BEZ tenanta nie zapisuje nic", async () => {
    planLoad({ row: authorRow() });
    await renderEditor({ tenantId: null });

    fireEvent.click(saveButton());
    await act(async () => {
      await Promise.resolve();
    });

    expect(db().chainsFor("author_profiles")).toHaveLength(0);
  });

  it("po udanym zapisie unieważnia strony publiczne autora i widok admina", async () => {
    planLoad({ row: authorRow() });
    db().setResponse("author_profiles", ok(null));
    const view = await renderEditor();
    const spy = vi.spyOn(view.queryClient, "invalidateQueries");

    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const keys = spy.mock.calls.map((c) =>
      JSON.stringify((c[0] as { queryKey: unknown }).queryKey),
    );
    expect(keys).toContain(JSON.stringify(["public", "resolved"]));
    expect(keys).toContain(JSON.stringify(["public", "expert"]));
    expect(keys).toContain(JSON.stringify(["admin-user", PROFILE_IDS.me]));
  });

  it("po pierwszym udanym zapisie BEZ wiersza przełącza na tryb 'zapisz'", async () => {
    planLoad({ row: null });
    db().setResponse("author_profiles", ok(null));
    await renderEditor();
    expect(screen.getByRole("button", { name: "profile.author.create" })).toBeInTheDocument();

    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "profile.account.save" })).toBeInTheDocument(),
    );
  });
});

describe("wysyłka avatara", () => {
  it("stempluje ścieżkę tenantem i id edytowanego użytkownika (nie zalogowanego admina)", async () => {
    // Ścieżka MUSI nieść id osoby, KTÓREJ profil jest edytowany - w trybie
    // admina to inna osoba niż wołający.
    xhr = xhrStub(200);
    planLoad({ mode: "admin", row: authorRow() });
    db().setResponse("author_profiles", ok(null));
    await renderEditor({ mode: "admin", userId: PROFILE_IDS.other, tenantId: PROFILE_IDS.tenant });

    fireEvent.click(screen.getByRole("button", { name: "profile.account.uploadAvatar" }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File([new Uint8Array(10)], "a.png", { type: "image/png" })] },
    });
    fireEvent.click(await screen.findByTestId("crop-confirm"));

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("profile.account.uploadSuccess"),
    );
    expect(xhr.requests[0].url).toContain(
      `${PROFILE_IDS.tenant}/users/${PROFILE_IDS.other}/author-avatar-`,
    );
  });

  it("odrzuca plik powyżej 2 MB bez wołania Storage", async () => {
    planLoad({ row: authorRow() });
    await renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "profile.account.uploadAvatar" }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File([new Uint8Array(2 * 1024 * 1024 + 1)], "a.png")] },
    });
    fireEvent.click(await screen.findByTestId("crop-confirm"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("profile.account.fileTooLarge"));
  });

  it("przycisk USUŃ czyści avatar bez wołania Storage", async () => {
    planLoad({ row: authorRow({ avatar_url: "https://cdn.example/old.jpg" }) });
    await renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "common.remove" }));

    expect(screen.queryByRole("button", { name: "common.remove" })).not.toBeInTheDocument();
    expect(screen.getByText("profile.account.avatarPlaceholder")).toBeInTheDocument();
  });

  it("BEZ tenanta nie wysyła nic", async () => {
    planLoad({ row: authorRow() });
    await renderEditor({ tenantId: null });

    fireEvent.click(screen.getByRole("button", { name: "profile.account.uploadAvatar" }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File([new Uint8Array(10)], "a.png")] },
    });
    const confirm = screen.queryByTestId("crop-confirm");
    expect(confirm).toBeInTheDocument();
    fireEvent.click(confirm!);

    await act(async () => {
      await Promise.resolve();
    });
    expect(h.toastSuccess).not.toHaveBeenCalledWith("profile.account.uploadSuccess");
  });
});

describe("odświeżenie podglądu OG (tylko self)", () => {
  it("przycisk odświeżenia pojawia się TYLKO w trybie self", async () => {
    planLoad({ mode: "admin", row: authorRow() });
    await renderEditor({ mode: "admin", userId: PROFILE_IDS.other });
    expect(
      screen.queryByRole("button", { name: /profile\.author\.ogRefresh/ }),
    ).not.toBeInTheDocument();
  });

  it("sukces pokazuje linki do debugerów trzech platform", async () => {
    h.refreshOg.mockResolvedValue({
      ok: true,
      debuggers: {
        facebook: "https://fb/debug",
        linkedin: "https://li/debug",
        twitter: "https://tw/debug",
      },
    });
    planLoad({ row: authorRow() });
    await renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "profile.author.ogRefreshBtn" }));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("profile.author.ogRefreshOk"));
    expect(screen.getByRole("link", { name: /Facebook/ })).toHaveAttribute(
      "href",
      "https://fb/debug",
    );
    // Etykieta jest DOSŁOWNIE `k.charAt(0).toUpperCase() + k.slice(1)` - dla
    // "linkedin" to "Linkedin" (jedna wielka litera), nie camelCase "LinkedIn".
    expect(screen.getByRole("link", { name: "Linkedin" })).toHaveAttribute(
      "href",
      "https://li/debug",
    );
  });

  it("odpowiedź `ok: false` daje komunikat błędu, nie ciche milczenie", async () => {
    h.refreshOg.mockResolvedValue({ ok: false });
    planLoad({ row: authorRow() });
    await renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "profile.author.ogRefreshBtn" }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("profile.author.ogRefreshError"));
  });

  it("rzucony wyjątek pokazuje jego treść, nie generyczny komunikat", async () => {
    h.refreshOg.mockRejectedValue(new Error("network down"));
    planLoad({ row: authorRow() });
    await renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "profile.author.ogRefreshBtn" }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("network down"));
  });
});

describe("punktory bio - sufit i usuwanie", () => {
  it("nie pozwala dodać więcej niż pięć punktorów", async () => {
    planLoad({ row: authorRow({ bio_pl: "1\n2\n3\n4\n5" }) });
    await renderEditor();

    const addButtons = screen.getAllByRole("button", { name: /Dodaj punktor/ });
    expect(addButtons[0]).toBeDisabled();
  });

  it("usunięcie punktora zmniejsza licznik i listę pól", async () => {
    planLoad({ row: authorRow({ bio_pl: "Jeden\nDwa" }) });
    await renderEditor();

    const removeButtons = screen.getAllByRole("button", { name: "remove" });
    fireEvent.click(removeButtons[0]);

    expect(screen.queryByDisplayValue("Jeden")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Dwa")).toBeInTheDocument();
  });
});

describe("linki społecznościowe niestandardowe", () => {
  it("dodaje pusty wiersz gotowy do wypełnienia", async () => {
    planLoad({ row: authorRow() });
    await renderEditor();
    expect(screen.getByText("profile.author.noCustomSocials")).toBeInTheDocument();

    fireEvent.click(addButtonIn("profile.author.customSocials"));

    expect(screen.queryByText("profile.author.noCustomSocials")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("profile.author.socialLabel")).toBeInTheDocument();
  });

  it("zapisuje niestandardowe linki jako WYPEŁNIONE dane, nie szkielet", async () => {
    planLoad({ row: authorRow() });
    db().setResponse("author_profiles", ok(null));
    await renderEditor();

    fireEvent.click(addButtonIn("profile.author.customSocials"));
    fireEvent.change(screen.getByPlaceholderText("profile.author.socialLabel"), {
      target: { value: "Substack" },
    });
    // "https://..." jest placeholderem SIEDMIU pól (strona + pięć socialów +
    // nowo dodany link niestandardowy) - ostatni w DOM jest tym, co dopisaliśmy.
    const urlFields = screen.getAllByPlaceholderText("https://...");
    fireEvent.change(urlFields[urlFields.length - 1], {
      target: { value: "https://example.substack.com" },
    });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const payload = db().lastChain("author_profiles")?.argsOf("upsert")?.[0] as {
      custom_socials: Array<{ label: string; url: string }>;
    };
    expect(payload.custom_socials).toEqual([
      { label: "Substack", url: "https://example.substack.com" },
    ]);
  });
});

/* ==================================================================== */
/* ETAP 7c - domknięcie ścieżek awaryjnych i pól formularza             */
/* ==================================================================== */

/** Wpisuje wartość w pole o podanej etykiecie (etykieta = klucz i18n albo
 *  dosłowna nazwa serwisu, jak w sekcji socialowej). */
function fillField(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

/**
 * Podglądany avatar. Rozpoznajemy go po `object-cover` - ikony linków
 * niestandardowych to też `<img>`, ale z `object-contain`, więc samo
 * „pierwsze img w dokumencie" byłoby asercją o kolejności w DOM, nie o avatarze.
 */
function avatarImg(): HTMLImageElement {
  const img = document.querySelector("img.object-cover");
  if (!(img instanceof HTMLImageElement)) throw new Error("test: brak podglądu avatara");
  return img;
}

/** Ukryte wejście pliku avatara - jedyne `input[type=file]` w tym formularzu. */
function avatarFileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("test: brak wejścia pliku avatara");
  return input;
}

/** Wybiera plik avatara i potwierdza kadrowanie (dwa kroki, jak użytkownik). */
async function pickAvatar(file: File): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "profile.account.uploadAvatar" }));
  fireEvent.change(avatarFileInput(), { target: { files: [file] } });
  fireEvent.click(await screen.findByTestId("crop-confirm"));
}

/**
 * Naruszenia dostępności BEZ artefaktu środowiska. Formularz trzyma ukryte
 * wejście pliku (`<input type="file" hidden>`) pod przyciskiem zmiany awatara.
 * W przeglądarce `hidden` znaczy `display: none`, więc tego pola nie ma
 * w drzewie dostępności - happy-dom nie stosuje arkusza UA, więc axe widzi je
 * jako WIDOCZNE pole formularza bez etykiety. Odsiewamy dokładnie ten jeden
 * kształt, a nie całą regułę `label`: brakująca etykieta przy polu, które
 * użytkownik naprawdę widzi, ma dalej wywalać test. Ten sam wzorzec co
 * `realAxeViolations` w `src/routes/__tests__/profileDashboardRoute.test.tsx`.
 */
async function realAxeViolations(container: Element): Promise<Result[]> {
  const found = await axeViolations(container);
  return found.filter(
    (violation) =>
      !violation.nodes.every(
        (node) => node.html.includes('type="file"') && node.html.includes("hidden"),
      ),
  );
}

describe("podpowiedź o presetach layoutu strony autora", () => {
  it("BEZ ustawień tenanta podpowiedzi nie ma wcale", async () => {
    // Domyślny stan `beforeEach` - `useExpertLayoutSettings` bez danych.
    planLoad({ row: authorRow() });
    await renderEditor();
    expect(screen.queryByText(/expert\.layoutHint/)).not.toBeInTheDocument();
  });

  it("pokazuje NAZWĘ presetu tenanta w języku widoku (pl)", async () => {
    h.layoutSettings.current = queryStub({ default_preset: "classic" });
    planLoad({ row: authorRow() });
    await renderEditor();
    // Autor musi wiedzieć, KTÓRY układ zobaczy gość - podpowiedź z surowym
    // identyfikatorem („classic") nie mówi mu tego w jego języku. Cała
    // podpowiedź to JEDEN `<span>` z kilkoma węzłami tekstowymi (klucz, nazwa
    // presetu, domknięcie zdania), więc asertujemy na jego treści.
    expect(screen.getByText(/expert\.layoutHintPreset/).textContent).toContain(
      '{"label":"Klasyczny"}',
    );
  });

  it("ta sama podpowiedź po angielsku bierze etykietę EN", async () => {
    h.language = "en";
    h.layoutSettings.current = queryStub({ default_preset: "classic" });
    planLoad({ row: authorRow() });
    await renderEditor();
    expect(screen.getByText(/expert\.layoutHintPreset/).textContent).toContain(
      '{"label":"Classic"}',
    );
  });

  it("preset NIEZNANY w kodzie spada na jego identyfikator, nie na pustkę", async () => {
    // Baza dopuszcza wartość spoza `EXPERT_LAYOUT_PRESETS` (np. preset dodany
    // migracją przed wdrożeniem frontu) - podpowiedź ma wtedy pokazać surowy
    // identyfikator, bo to jedyna informacja, jaką ma.
    h.layoutSettings.current = queryStub({ default_preset: "preset-z-przyszłości" });
    planLoad({ row: authorRow() });
    await renderEditor();
    expect(screen.getByText(/expert\.layoutHintPreset/).textContent).toContain(
      '{"label":"preset-z-przyszłości"}',
    );
  });

  it("PUSTY preset zostawia samą podpowiedź, bez fragmentu o nazwie układu", async () => {
    // Opis stanu FAKTYCZNEGO: `default_preset: ""` daje `presetLabel === ""`,
    // czyli wartość fałszywą - fragment z nazwą się nie renderuje. Zdanie nadal
    // ma sens („zmień układ w ustawieniach"), więc to nie defekt.
    h.layoutSettings.current = queryStub({ default_preset: "" });
    planLoad({ row: authorRow() });
    await renderEditor();
    expect(screen.getByText(/expert\.layoutHint/)).toBeInTheDocument();
    expect(screen.queryByText(/expert\.layoutHintPreset/)).not.toBeInTheDocument();
  });
});

describe("hydratacja - dane w kształcie, którego formularz nie zakłada", () => {
  it("BEZ identyfikatora użytkownika nie czyta NICZEGO", async () => {
    // Trasa admina montuje edytor, gdy parametr `$id` jeszcze nie jest znany.
    // Odczyt z pustym `user_id` byłby zapytaniem o cudzy (albo żaden) wiersz.
    await renderEditor({ userId: "" });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(db().chainsFor("profiles")).toHaveLength(0);
    expect(db().chainsFor("expertise_areas")).toHaveLength(0);
  });

  it("`custom_socials` NIE będące tablicą czyta jako brak linków", async () => {
    // Kolumna jest `jsonb` - wiersz zapisany przed walidacją kształtu może
    // trzymać obiekt albo `null`. Iteracja po tym wysypałaby cały formularz,
    // więc autor stracił by dostęp do edycji profilu.
    planLoad({ row: authorRow({ custom_socials: { substack: "https://example.com" } }) });
    await renderEditor();
    expect(screen.getByText("profile.author.noCustomSocials")).toBeInTheDocument();
  });

  it("`org_functions` NIE będące tablicą czyta jako brak funkcji", async () => {
    planLoad({ row: authorRow({ org_functions: null }) });
    await renderEditor();
    expect(screen.queryByPlaceholderText("expert.orgFunctionPl")).not.toBeInTheDocument();
  });

  it("PUSTE odpowiedzi słownika obszarów nie wywalają formularza", async () => {
    // `data: null` bez błędu to legalna odpowiedź PostgREST. Sekcja obszarów
    // ma się wtedy nie pokazać, a nie pokazać się bez treści.
    planLoad({ row: authorRow() });
    db().setResponse("expertise_areas", ok(null));
    db().setResponse("expert_expertise_areas", ok(null));
    await renderEditor();
    expect(screen.queryByText("expert.expertiseHeading")).not.toBeInTheDocument();
    expect(screen.getByLabelText("profile.account.jobTitle")).toBeInTheDocument();
  });

  it("chip obszaru po angielsku bierze nazwę EN", async () => {
    h.language = "en";
    planLoad({
      row: authorRow(),
      areas: [{ id: "area-1", name_pl: "Energia", name_en: "Energy" }],
    });
    await renderEditor();
    expect(screen.getByRole("button", { name: "Energy" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Energia" })).not.toBeInTheDocument();
  });
});

describe("synchronizacja obszarów ekspertyzy - końce nieudane", () => {
  const AREAS = [
    { id: "area-1", name_pl: "Energia", name_en: "Energy" },
    { id: "area-2", name_pl: "Klimat", name_en: "Climate" },
  ];

  it("błąd INSERT-u powiązania daje komunikat błędu, nie fałszywy sukces", async () => {
    planLoad({ areas: AREAS, myAreaIds: [], row: authorRow() });
    db().setResponse("author_profiles", ok(null));
    db().setResponse("expert_expertise_areas", (chain) =>
      chain.has("insert") ? fail("insert denied") : ok([]),
    );
    await renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Klimat" }));
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("profile.account.saveError"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("błąd DELETE powiązania daje komunikat błędu, nie fałszywy sukces", async () => {
    planLoad({ areas: AREAS, myAreaIds: ["area-1"], row: authorRow() });
    db().setResponse("author_profiles", ok(null));
    db().setResponse("expert_expertise_areas", (chain) =>
      chain.has("delete") ? fail("delete denied") : ok([{ area_id: "area-1" }]),
    );
    await renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Energia" }));
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("profile.account.saveError"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("PUSTY odczyt stanu bieżącego traktuje zaznaczenia jako nowe powiązania", async () => {
    // `data: null` przy odczycie różnicy nie może oznaczać „nic nie dodawaj" -
    // wtedy obszar wybrany przez autora nigdy nie trafiłby do bazy, a formularz
    // po przeładowaniu pokazałby go jako niezaznaczony.
    planLoad({ areas: AREAS, row: authorRow() });
    db().setResponse("author_profiles", ok(null));
    db().setResponse("expert_expertise_areas", ok(null));
    await renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Energia" }));
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const insertChain = db()
      .chainsFor("expert_expertise_areas")
      .find((c) => c.has("insert"));
    expect(insertChain?.argsOf("insert")).toEqual([
      [{ user_id: PROFILE_IDS.me, area_id: "area-1" }],
    ]);
  });
});

describe("wysyłka avatara - każdy koniec nieudany ma komunikat", () => {
  it("odmowa podpisu URL-a nie wysyła bajtów i pokazuje błąd", async () => {
    xhr = xhrStub(200);
    files().failSign("storage quota exceeded");
    planLoad({ row: authorRow() });
    await renderEditor();

    await pickAvatar(new File([new Uint8Array(10)], "a.png", { type: "image/png" }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("profile.account.uploadError"));
    expect(xhr.requests).toHaveLength(0);
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("podpis BEZ błędu i BEZ danych też jest awarią, nie uploadem w pustkę", async () => {
    // Odpowiedź `{ data: null, error: null }` jest legalna po stronie SDK.
    // Bez tej gałęzi kod wysłałby PUT na `undefined`.
    xhr = xhrStub(200);
    files().signWithoutData();
    planLoad({ row: authorRow() });
    await renderEditor();

    await pickAvatar(new File([new Uint8Array(10)], "a.png", { type: "image/png" }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("profile.account.uploadError"));
    expect(xhr.requests).toHaveLength(0);
  });

  it("odrzucenie HTTP przez Storage NIE podmienia avatara", async () => {
    xhr = xhrStub(500);
    planLoad({ row: authorRow({ avatar_url: "https://cdn.example/stary.jpg" }) });
    await renderEditor();

    await pickAvatar(new File([new Uint8Array(10)], "a.png", { type: "image/png" }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("profile.account.uploadError"));
    expect(avatarImg().getAttribute("src")).toBe("https://cdn.example/stary.jpg");
  });

  it("awaria sieci w trakcie wysyłki pokazuje błąd, nie zawiesza przycisku", async () => {
    xhr = xhrStub("error");
    planLoad({ row: authorRow() });
    await renderEditor();

    await pickAvatar(new File([new Uint8Array(10)], "a.png", { type: "image/png" }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("profile.account.uploadError"));
    // Przycisk wraca do stanu gotowego - `finally` zdjął blokadę.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "profile.account.uploadAvatar" })).toBeEnabled(),
    );
  });

  it("blob BEZ typu MIME jedzie jako obraz JPEG, nie bez nagłówka", async () => {
    // Kadrowanie zwraca blob, którego `type` bywa pusty. Storage bez
    // `Content-Type` zapisuje plik jako `application/octet-stream` i przeglądarka
    // pokazuje go jako pobieranie, nie jako avatar.
    xhr = xhrStub(200);
    planLoad({ row: authorRow() });
    await renderEditor();

    await pickAvatar(new File([new Uint8Array(10)], "a.png"));

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("profile.account.uploadSuccess"),
    );
    expect(xhr.requests[0].headers["Content-Type"]).toBe("image/jpeg");
    expect(xhr.requests[0].headers["x-upsert"]).toBe("true");
  });

  it("udany upload wstawia adres PUBLICZNY pliku jako podglądany avatar", async () => {
    xhr = xhrStub(200);
    planLoad({ row: authorRow() });
    await renderEditor();

    await pickAvatar(new File([new Uint8Array(10)], "a.png", { type: "image/png" }));

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("profile.account.uploadSuccess"),
    );
    expect(files().publicPaths).toHaveLength(1);
    expect(avatarImg().getAttribute("src")).toBe(`https://cdn.example/${files().publicPaths[0]}`);
  });

  it("wejście pliku BEZ wybranego pliku nie otwiera kadrowania", async () => {
    // Anulowanie systemowego okna wyboru daje zdarzenie `change` z pustą listą.
    planLoad({ row: authorRow() });
    await renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "profile.account.uploadAvatar" }));
    fireEvent.change(avatarFileInput(), { target: { files: [] } });

    expect(screen.queryByTestId("crop-confirm")).not.toBeInTheDocument();
  });

  it("rezygnacja z kadrowania WYRZUCA wybrany plik", async () => {
    // Gdyby `pendingFile` przetrwał zamknięcie, kolejne otwarcie kadrowania
    // pokazałoby STARY plik - autor wykadrowałby i zapisał zdjęcie, którego
    // właśnie nie chciał.
    xhr = xhrStub(200);
    planLoad({ row: authorRow() });
    await renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "profile.account.uploadAvatar" }));
    fireEvent.change(avatarFileInput(), {
      target: { files: [new File([new Uint8Array(10)], "a.png", { type: "image/png" })] },
    });
    fireEvent.click(await screen.findByTestId("crop-cancel"));

    expect(screen.queryByTestId("crop-confirm")).not.toBeInTheDocument();
    expect(xhr.requests).toHaveLength(0);
  });
});

describe("pola formularza - żadne nie gubi się i nie nadpisuje sąsiada", () => {
  it("wszystkie pola tekstowe trafiają do zapisu pod WŁASNYM kluczem", async () => {
    // Klasyczny defekt formularza z dwudziestoma polami: dwa `onChange` wpięte
    // w ten sam klucz stanu. Test wpisuje w KAŻDE pole inną wartość i sprawdza
    // cały payload, bo tylko to wyłapuje podmianę pary pól.
    planLoad({ row: authorRow() });
    db().setResponse("author_profiles", ok(null));
    await renderEditor();

    fillField("profile.account.jobTitle", "Dyrektor ds. polityki UE");
    fillField("profile.account.currentCompany", "Example Institute");
    fillField("expert.fullBioPl", "Pełne bio po polsku.");
    fillField("expert.fullBioEn", "Full bio in English.");
    fillField("profile.author.contactEmail", "kontakt@example.com");
    fillField("profile.account.phone", "+32 000 000 001");
    fillField("profile.author.website", "https://www.example.org");
    fillField("X (x.com)", "https://x.example.com/konto");
    fillField("LinkedIn", "https://linkedin.example.com/konto");
    fillField("Facebook", "https://facebook.example.com/konto");
    fillField("Instagram", "https://instagram.example.com/konto");
    fillField("Spotify", "https://spotify.example.com/konto");
    fillField("expert.mediaContactName", "Biuro prasowe");
    fillField("expert.mediaContactEmail", "prasa@example.org");
    fillField("expert.mediaContactPhone", "+32 000 000 002");
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const payload = db().lastChain("author_profiles")?.argsOf("upsert")?.[0] as Record<
      string,
      unknown
    >;
    expect({
      job_title: payload.job_title,
      company: payload.company,
      full_bio_pl: payload.full_bio_pl,
      full_bio_en: payload.full_bio_en,
      contact_email: payload.contact_email,
      phone: payload.phone,
      website_url: payload.website_url,
      x_url: payload.x_url,
      linkedin_url: payload.linkedin_url,
      facebook_url: payload.facebook_url,
      instagram_url: payload.instagram_url,
      spotify_url: payload.spotify_url,
      media_contact_name: payload.media_contact_name,
      media_contact_email: payload.media_contact_email,
      media_contact_phone: payload.media_contact_phone,
    }).toEqual({
      job_title: "Dyrektor ds. polityki UE",
      company: "Example Institute",
      full_bio_pl: "Pełne bio po polsku.",
      full_bio_en: "Full bio in English.",
      contact_email: "kontakt@example.com",
      phone: "+32 000 000 001",
      website_url: "https://www.example.org",
      x_url: "https://x.example.com/konto",
      linkedin_url: "https://linkedin.example.com/konto",
      facebook_url: "https://facebook.example.com/konto",
      instagram_url: "https://instagram.example.com/konto",
      spotify_url: "https://spotify.example.com/konto",
      media_contact_name: "Biuro prasowe",
      media_contact_email: "prasa@example.org",
      media_contact_phone: "+32 000 000 002",
    });
  });

  it("przełącznik widoczności zmienia to, co idzie do kolumny `is_public`", async () => {
    // Profil startuje jako UKRYTY (privacy by default). Autor publikuje go
    // świadomie - i to musi dojechać do bazy, bo inaczej strona publiczna
    // zostaje wyłączona mimo włączonego przełącznika.
    planLoad({ row: authorRow({ is_public: false }) });
    db().setResponse("author_profiles", ok(null));
    await renderEditor();

    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const payload = db().lastChain("author_profiles")?.argsOf("upsert")?.[0] as Record<
      string,
      unknown
    >;
    expect(payload.is_public).toBe(true);
  });

  it("funkcja organizacyjna zapisuje OBA języki, nie tylko polski", async () => {
    planLoad({ row: authorRow() });
    db().setResponse("author_profiles", ok(null));
    await renderEditor();

    fireEvent.click(addButtonIn("expert.orgFunctions"));
    fireEvent.change(screen.getByPlaceholderText("expert.orgFunctionPl"), {
      target: { value: "Przewodniczący rady" },
    });
    fireEvent.change(screen.getByPlaceholderText("expert.orgFunctionEn"), {
      target: { value: "Chair of the board" },
    });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const payload = db().lastChain("author_profiles")?.argsOf("upsert")?.[0] as {
      org_functions: unknown[];
    };
    expect(payload.org_functions).toEqual([
      { pl: "Przewodniczący rady", en: "Chair of the board" },
    ]);
  });

  it("OPIS STANU FAKTYCZNEGO: pola tekstowe idą do bazy BEZ przycięcia", async () => {
    // To NIE jest życzenie, tylko zapis rzeczywistości. Ten formularz nie ma
    // ani jednego pola WYMAGANEGO (pusty profil zapisuje się bez protestu, co
    // pokazuje test „po pierwszym udanym zapisie BEZ wiersza…") i nie przycina
    // białych znaków w polach zwykłych. Przycinane są WYŁĄCZNIE punktory bio
    // (`bulletsToBio`), a `org_functions` mają `trim()` tylko w warunku
    // odsiewania pustego wiersza - sama wartość leci nieprzycięta.
    //
    // Poprawność składni adresu i e-maila stoi na natywnej walidacji
    // przeglądarki (`type="url"`, `type="email"` w formularzu bez `noValidate`),
    // której happy-dom nie odtwarza - dlatego test tego NIE asertuje. Gdyby
    // trzeba było kiedyś przycinać, miejsce jest jedno: `payload` w `save`.
    planLoad({ row: authorRow() });
    db().setResponse("author_profiles", ok(null));
    await renderEditor();

    fillField("profile.account.jobTitle", "   Dyrektor   ");
    fireEvent.click(addButtonIn("expert.orgFunctions"));
    fireEvent.change(screen.getByPlaceholderText("expert.orgFunctionPl"), {
      target: { value: "   Przewodniczący   " },
    });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const payload = db().lastChain("author_profiles")?.argsOf("upsert")?.[0] as {
      job_title: unknown;
      org_functions: unknown[];
    };
    expect(payload.job_title).toBe("   Dyrektor   ");
    expect(payload.org_functions).toEqual([{ pl: "   Przewodniczący   ", en: "" }]);
  });

  it("link niestandardowy z WŁASNĄ ikoną pokazuje ją zamiast ikony zastępczej", async () => {
    planLoad({
      row: authorRow({
        custom_socials: [
          {
            label: "Substack",
            url: "https://example.substack.com",
            iconUrl: "https://cdn.example/ikona.svg",
          },
        ],
      }),
    });
    await renderEditor();

    const icon = document.querySelector('img[src="https://cdn.example/ikona.svg"]');
    expect(icon).not.toBeNull();
    // Ikona dekoracyjna: bez tekstu alternatywnego i bez przeciągania.
    expect(icon?.getAttribute("alt")).toBe("");
  });

  it("adres ikony linku niestandardowego trafia do zapisu", async () => {
    planLoad({ row: authorRow() });
    db().setResponse("author_profiles", ok(null));
    await renderEditor();

    fireEvent.click(addButtonIn("profile.author.customSocials"));
    fireEvent.change(screen.getByPlaceholderText("profile.author.iconUrl"), {
      target: { value: "https://cdn.example/ikona.svg" },
    });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const payload = db().lastChain("author_profiles")?.argsOf("upsert")?.[0] as {
      custom_socials: Array<Record<string, unknown>>;
    };
    expect(payload.custom_socials).toEqual([
      { label: "", url: "", iconUrl: "https://cdn.example/ikona.svg" },
    ]);
  });

  it("usunięcie linku niestandardowego zdejmuje TEN wiersz, nie wszystkie", async () => {
    planLoad({
      row: authorRow({
        custom_socials: [
          { label: "Substack", url: "https://example.substack.com" },
          { label: "Newsletter", url: "https://newsletter.example.org" },
        ],
      }),
    });
    db().setResponse("author_profiles", ok(null));
    await renderEditor();

    const rows = screen.getAllByPlaceholderText("profile.author.socialLabel");
    expect(rows).toHaveLength(2);
    const removeFirst = rows[0].closest("div")?.querySelector('button[aria-label="remove"]');
    expect(removeFirst).not.toBeNull();
    fireEvent.click(removeFirst!);
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const payload = db().lastChain("author_profiles")?.argsOf("upsert")?.[0] as {
      custom_socials: Array<Record<string, unknown>>;
    };
    expect(payload.custom_socials).toEqual([
      { label: "Newsletter", url: "https://newsletter.example.org" },
    ]);
  });
});

describe("punktory bio - dodawanie i edycja", () => {
  it("dodaje PUSTY punktor gotowy do wpisania treści", async () => {
    planLoad({ row: authorRow({ bio_pl: "Jeden" }) });
    await renderEditor();

    fireEvent.click(screen.getAllByRole("button", { name: /Dodaj punktor/ })[0]);

    // Licznik przy etykiecie pokazuje 2/5 - punktor istnieje, choć jest pusty.
    expect(screen.getByText("2/5")).toBeInTheDocument();
  });

  it("edycja punktora zmienia to, co idzie do `profiles.bio_pl`", async () => {
    planLoad({ row: authorRow({ bio_pl: "Stara treść" }) });
    db().setResponse("author_profiles", ok(null));
    await renderEditor();

    fireEvent.change(screen.getByDisplayValue("Stara treść"), {
      target: { value: "Nowa treść" },
    });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const patch = db().lastChain("profiles")?.argsOf("update")?.[0] as Record<string, unknown>;
    expect(patch.bio_pl).toBe("Nowa treść");
  });

  it("punktor PUSTY nie trafia do zapisanego bio", async () => {
    // Puste punktory są odsiewane przy składaniu bio - inaczej karta autora
    // pokazywałaby wypunktowanie z pustym wierszem.
    planLoad({ row: authorRow({ bio_pl: "Jeden" }) });
    db().setResponse("author_profiles", ok(null));
    await renderEditor();

    fireEvent.click(screen.getAllByRole("button", { name: /Dodaj punktor/ })[0]);
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const patch = db().lastChain("profiles")?.argsOf("update")?.[0] as Record<string, unknown>;
    expect(patch.bio_pl).toBe("Jeden");
  });

  it("bio z myślnikami na początku wierszy traci sam znacznik, nie treść", async () => {
    planLoad({ row: authorRow({ bio_pl: "- Pierwszy\n• Drugi\n* Trzeci" }) });
    await renderEditor();

    expect(screen.getByDisplayValue("Pierwszy")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Drugi")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Trzeci")).toBeInTheDocument();
  });
});

describe("dostępność formularza", () => {
  it("pełny formularz nie ma naruszeń axe", async () => {
    // W tym pliku poprawiono już raz osiem nienazwanych pól - regresja wraca
    // przy każdym nowym polu dopisanym bez `FieldLabel`/`htmlFor`.
    planLoad({
      row: authorRow({
        avatar_url: "https://cdn.example/avatar.jpg",
        org_functions: [{ pl: "Przewodniczący", en: "Chair" }],
        custom_socials: [{ label: "Substack", url: "https://example.substack.com" }],
        bio_pl: "Jeden\nDwa",
      }),
      areas: [{ id: "area-1", name_pl: "Energia", name_en: "Energy" }],
      myAreaIds: ["area-1"],
    });
    h.layoutSettings.current = queryStub({ default_preset: "classic" });
    const view = await renderEditor();

    const violations = await realAxeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("formularz PUSTY (nowy profil) też nie ma naruszeń axe", async () => {
    planLoad({ row: null });
    const view = await renderEditor();

    const violations = await realAxeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("defekty zapisu profilu publicznego", () => {
  it.fails("DEFEKT: bio dłuższe niż pięć punktów TRACI nadmiar przy zwykłym zapisie", async () => {
    // CO: `bioToBullets` (AuthorProfileEditor.tsx:140) obcina bio do pięciu
    // punktów przy WCZYTANIU formularza, a `save` (linia 369) skleja z powrotem
    // to, co zostało, i nadpisuje `profiles.bio_pl` ORAZ
    // `author_profiles.bio_pl`.
    // GDZIE: src/components/profile/AuthorProfileEditor.tsx:140 (slice) +
    // 369-375 (zapis obu kolumn).
    // KONSEKWENCJA: autor, którego bio zaimportowano z sześciu wierszy (albo
    // wpisano przez inny ekran), wchodzi na formularz, poprawia numer telefonu,
    // zapisuje - i BEZ OSTRZEŻENIA traci szósty punkt bio na stronie
    // publicznej. Formularz nie mówi, że coś obciął; wygląda to jak zjedzenie
    // treści przez system.
    planLoad({
      row: authorRow(),
      canonicalBio: { bio_pl: "Jeden\nDwa\nTrzy\nCztery\nPięć\nSześć", bio_en: null },
    });
    db().setResponse("author_profiles", ok(null));
    await renderEditor();

    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const patch = db().lastChain("profiles")?.argsOf("update")?.[0] as Record<string, unknown>;
    expect(patch.bio_pl).toBe("Jeden\nDwa\nTrzy\nCztery\nPięć\nSześć");
  });

  it.fails("DEFEKT: zapis bez tenanta kończy się CISZĄ - ani zapisu, ani komunikatu", async () => {
    // CO: `save` (AuthorProfileEditor.tsx:342) wychodzi na `if (!tenantId)
    // return;` PRZED `setBusy(true)` i bez żadnego `toast`. To samo robi
    // `upload` (linia 303).
    // GDZIE: src/components/profile/AuthorProfileEditor.tsx:342 i :303.
    // KONSEKWENCJA: konto bez przypisanego tenanta (świeża rejestracja, konto
    // przenoszone między obszarami) wypełnia cały formularz, klika „Zapisz"
    // i NIC się nie dzieje - przycisk nie mruga, nie ma błędu. Użytkownik
    // odchodzi ze strony w przekonaniu, że profil jest zapisany, i traci całą
    // wpisaną treść.
    planLoad({ row: authorRow() });
    await renderEditor({ tenantId: null });

    fireEvent.click(saveButton());
    await act(async () => {
      await Promise.resolve();
    });

    expect(h.toastError).toHaveBeenCalled();
  });

  it.fails("DEFEKT: nieudany zapis profilu NIE wstrzymuje zapisu obszarów ekspertyzy", async () => {
    // CO: `save` wykonuje `syncExpertiseAreas` (linia 378) BEZWARUNKOWO, już po
    // tym, jak `Promise.all` z upsertem profilu zwrócił błąd. Sprawdzenie
    // `error || bioError` przychodzi dopiero w linii 381.
    // GDZIE: src/components/profile/AuthorProfileEditor.tsx:371-384.
    // KONSEKWENCJA: upsert `author_profiles` odbija się o RLS, a powiązania
    // z obszarami ekspertyzy zostają ZAPISANE. Użytkownik widzi „nie udało się
    // zapisać", odświeża stronę - i widzi nowe obszary ekspertyzy przy starych
    // pozostałych polach. Te powiązania są czytane przez katalog ekspertów
    // (src/lib/experts/directory.ts:81) i stronę eksperta
    // (src/lib/experts/queries.ts:206), więc profil PUBLICZNY zostaje w stanie,
    // którego autor nigdy nie zatwierdził.
    planLoad({
      areas: [
        { id: "area-1", name_pl: "Energia", name_en: "Energy" },
        { id: "area-2", name_pl: "Klimat", name_en: "Climate" },
      ],
      myAreaIds: [],
      row: authorRow(),
    });
    db().setResponse("author_profiles", fail("new row violates row-level security policy"));
    await renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Klimat" }));
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("profile.account.saveError"));
    const insertChain = db()
      .chainsFor("expert_expertise_areas")
      .find((c) => c.has("insert"));
    expect(insertChain).toBeUndefined();
  });
});
