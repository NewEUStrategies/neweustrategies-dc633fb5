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
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import {
  fail,
  ok,
  PROFILE_IDS,
  queryStub,
  supabaseFromStub,
  xhrStub,
  type SupabaseResult,
} from "@/test/profile/fixtures";

type RpcResult = SupabaseResult;

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  adminGetAuthorProfile: vi.fn(),
  refreshOg: vi.fn(),
  layoutSettings: { current: null as unknown },
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

const stubs = vi.hoisted(() => ({ from: null as unknown }));

vi.mock("react-i18next", async () => {
  const fixtures = await import("@/test/profile/fixtures");
  return fixtures.reactI18nextStub();
});

vi.mock("@/lib/i18n-experts", () => ({}));

vi.mock("@/integrations/supabase/client", async () => {
  const fixtures = await import("@/test/profile/fixtures");
  const from = fixtures.supabaseFromStub();
  stubs.from = from;
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
      storage: {
        from: () => ({
          createSignedUploadUrl: (path: string) =>
            Promise.resolve({
              data: { signedUrl: `https://upload.example/${path}` },
              error: null,
            }),
          getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.example/${path}` } }),
        }),
      },
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
    }) => {
      if (!props.open) return null;
      return React.createElement(
        "button",
        {
          type: "button",
          "data-testid": "crop-confirm",
          // Odgrywa `file` NIEZMIENIONY jako "wykadrowany" blob - kadrowanie
          // realnie zmienia rozmiar, ale test bramki rozmiaru potrzebuje
          // rozmiaru pliku wybranego przez użytkownika, nie sztywnej wartości.
          onClick: () => props.onConfirm(props.file ?? new Blob([new Uint8Array(10)])),
        },
        "confirm crop",
      );
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
  db().reset();
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
