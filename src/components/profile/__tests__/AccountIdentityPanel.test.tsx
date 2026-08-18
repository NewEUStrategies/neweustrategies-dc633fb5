// Panel „Dane podstawowe” skonsolidowanej edycji tożsamości (/profile/edit) -
// stał na ZERZE pokrycia przy 141 instrukcjach. Trzy reguły, których nie widać
// z kodu, a każda ma konkretną cenę:
//
//   1. ODCZYT IDZIE PRZEZ RPC `get_own_profile`, NIE PRZEZ SELECT NA `profiles`.
//      Kolumny PII (`phone`, `gender`, `location`, `contact_email`) NIE mają już
//      grantu dla roli `authenticated` - da się je przeczytać wyłącznie dla
//      własnego wiersza przez SECURITY DEFINER. Powrót do zwykłego selecta nie
//      wywali się na typach; formularz po prostu wstanie z pustymi polami PII,
//      a pierwszy zapis nadpisze je NULL-ami.
//   2. METADANE REJESTRACJI NIGDY NIE NADPISUJĄ DANYCH Z BAZY. Prefill z
//      `user_metadata` (logowanie przez dostawcę) uzupełnia WYŁĄCZNIE puste
//      pola. Odwrócenie tego priorytetu cofałoby ręczne poprawki nazwiska przy
//      każdym wejściu w edycję.
//   3. PREFILL ZAPISUJE SIĘ TYLKO WTEDY, GDY COŚ UZUPEŁNIŁ. Bezwarunkowy UPDATE
//      przy każdym montażu formularza to zapis na `profiles` przy każdym wejściu
//      na stronę - i stempel `updated_at`, przez który profil udaje świeży.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PROFILE_IDS, xhrStub } from "@/test/profile/fixtures";

type Rpc = { data: unknown; error: unknown };

const h = vi.hoisted(() => ({
  user: {
    current: null as { id: string; email?: string; user_metadata?: Record<string, string> } | null,
  },
  rpc: vi.fn(),
  updates: [] as Array<{ patch: Record<string, unknown>; filters: Array<[string, unknown]> }>,
  updateError: { current: null as { message: string } | null },
  signedPaths: [] as string[],
  signError: { current: null as Error | null },
  invalidated: [] as unknown[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  cropProps: { current: null as Record<string, unknown> | null },
}));

vi.mock("react-i18next", async () => {
  const fixtures = await import("@/test/profile/fixtures");
  return fixtures.reactI18nextStub();
});

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user.current }) }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string): Promise<Rpc> => h.rpc(fn),
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        const entry = { patch, filters: [] as Array<[string, unknown]> };
        h.updates.push(entry);
        return {
          eq: (column: string, value: unknown) => {
            entry.filters.push([column, value]);
            return Promise.resolve({ error: h.updateError.current });
          },
        };
      },
    }),
    storage: {
      from: () => ({
        createSignedUploadUrl: (path: string) => {
          h.signedPaths.push(path);
          return Promise.resolve(
            h.signError.current
              ? { data: null, error: h.signError.current }
              : { data: { signedUrl: `https://upload.example/${path}` }, error: null },
          );
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.example/${path}` } }),
      }),
    },
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: (args: unknown) => {
      h.invalidated.push(args);
    },
  }),
}));

vi.mock("@tanstack/react-router", async () => {
  const React = await import("react");
  return {
    Link: ({ to, children }: { to: string; children?: unknown }) =>
      React.createElement("a", { href: to }, children as never),
  };
});

vi.mock("sonner", () => ({
  toast: {
    success: (m: string) => h.toastSuccess(m),
    error: (m: string) => h.toastError(m),
  },
}));

// Rodzaj gramatyczny wybiera się Radixowym Selectem - patrz `radixSelectStub`.
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const fixtures = await import("@/test/profile/fixtures");
  return fixtures.radixSelectStub(React);
});

// Kadrowanie zdjęcia potrzebuje canvasu i realnych pomiarów obrazu, których
// happy-dom nie ma. Atrapa wystawia PRZYCISK potwierdzenia z gotowym blobem -
// asercje dotyczą tego, co dzieje się PO kadrowaniu (ścieżka w Storage, zapis
// adresu, komunikaty), a nie samego kadrowania.
vi.mock("@/components/media/ImageCropDialog", async () => {
  const React = await import("react");
  return {
    CROP_PRESETS: {
      avatar: { aspect: 1, targetWidth: 512, targetHeight: 512 },
      cover: { aspect: 16 / 6, targetWidth: 1600, targetHeight: 600 },
    },
    ImageCropDialog: (props: {
      open: boolean;
      kind: string;
      onConfirm: (blob: Blob) => void;
      onOpenChange: (open: boolean) => void;
    }) => {
      h.cropProps.current = props as unknown as Record<string, unknown>;
      if (!props.open) return null;
      return React.createElement(
        "div",
        null,
        React.createElement(
          "button",
          {
            type: "button",
            "data-testid": "crop-confirm",
            onClick: () =>
              props.onConfirm(new Blob([new Uint8Array(1024)], { type: "image/jpeg" })),
          },
          `crop:${props.kind}`,
        ),
        React.createElement(
          "button",
          {
            type: "button",
            "data-testid": "crop-cancel",
            onClick: () => props.onOpenChange(false),
          },
          "cancel",
        ),
      );
    },
  };
});

import { AccountIdentityPanel } from "@/components/profile/identity/AccountIdentityPanel";

/** Wiersz zwracany przez `get_own_profile` (domyślnie profil uzupełniony). */
function ownProfileRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    display_name: "Anna Nowak",
    first_name: "Anna",
    last_name: "Nowak",
    job_title: "Head of EU Affairs",
    current_company: "New European Strategies",
    location: "Bruksela",
    phone: "+32 2 000 00 00",
    bio: "Stare bio",
    bio_pl: "Kanoniczne bio",
    avatar_url: "https://cdn.example/a.jpg",
    cover_url: null,
    tenant_id: PROFILE_IDS.tenant,
    gender: "female",
    ...overrides,
  };
}

/** Ostatni UPDATE na `profiles` - testy zawsze pytają o parę patch+filtr. */
function lastUpdate() {
  return h.updates.at(-1);
}

/** Zapisy prefillu to te UPDATE-y, które poszły PRZED kliknięciem „Zapisz”. */
function updateCount(): number {
  return h.updates.length;
}

async function renderPanel(row: Record<string, unknown> | null = ownProfileRow()) {
  h.rpc.mockResolvedValue({ data: row ? [row] : [], error: null });
  const view = render(<AccountIdentityPanel />);
  await waitFor(() => expect(h.rpc).toHaveBeenCalled());
  return view;
}

let xhr: ReturnType<typeof xhrStub> | null = null;

beforeEach(() => {
  h.user.current = { id: PROFILE_IDS.me, email: "anna@example.test", user_metadata: {} };
  h.rpc.mockReset();
  h.updates.length = 0;
  h.updateError.current = null;
  h.signedPaths.length = 0;
  h.signError.current = null;
  h.invalidated.length = 0;
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.cropProps.current = null;
});

afterEach(() => {
  xhr?.restore();
  xhr = null;
});

describe("odczyt własnego wiersza", () => {
  it("czyta profil przez SECURITY DEFINER RPC, nie przez select na `profiles`", async () => {
    // Reguła 1. Kolumny PII nie mają grantu dla `authenticated` - zwykły select
    // zwróciłby je puste, a formularz nadpisałby je NULL-ami przy zapisie.
    await renderPanel();

    expect(h.rpc).toHaveBeenCalledWith("get_own_profile");
    // Zero zapytań odczytujących przez `from()` - `from` służy tu tylko zapisom.
    expect(updateCount()).toBe(0);
  });

  it("wypełnia pola PII wartościami z RPC", async () => {
    await renderPanel();

    expect(screen.getByLabelText("profile.account.firstName")).toHaveValue("Anna");
    expect(screen.getByLabelText("profile.account.phone")).toHaveValue("+32 2 000 00 00");
    expect(screen.getByLabelText("profile.account.location")).toHaveValue("Bruksela");
  });

  it("bio bierze z `bio_pl`, nie ze starej kolumny `bio`", async () => {
    await renderPanel();
    expect(screen.getByLabelText("profile.account.bio")).toHaveValue("Kanoniczne bio");
  });

  it("spada na starą kolumnę `bio`, gdy `bio_pl` jest puste", async () => {
    await renderPanel(ownProfileRow({ bio_pl: null, bio: "Stare bio" }));
    expect(screen.getByLabelText("profile.account.bio")).toHaveValue("Stare bio");
  });

  it("BRAK wiersza nie wywala formularza i nie zapisuje niczego", async () => {
    // Konto bez wiersza profilu (świeża rejestracja przed triggerem) nie może
    // wstać z formularzem, który natychmiast coś zapisze.
    await renderPanel(null);

    expect(screen.getByLabelText("profile.account.firstName")).toHaveValue("");
    expect(updateCount()).toBe(0);
  });

  it("bez sesji nie woła RPC", () => {
    h.user.current = null;
    render(<AccountIdentityPanel />);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("adres e-mail pochodzi z sesji i jest TYLKO do odczytu", async () => {
    // E-mail zmienia się przez osobną ścieżkę (weryfikacja w /profile/security).
    // Edytowalne pole tutaj sugerowałoby, że wystarczy je nadpisać.
    await renderPanel();

    const email = screen.getByLabelText("profile.account.email");
    expect(email).toHaveValue("anna@example.test");
    expect(email).toHaveAttribute("readonly");
    expect(email).toBeDisabled();
  });
});

describe("prefill z metadanych rejestracji", () => {
  it("NIE nadpisuje wartości, które są już w bazie", async () => {
    // Reguła 2. Odwrotny priorytet cofałby ręczną poprawkę nazwiska przy
    // każdym wejściu w edycję - i to bez żadnego sygnału.
    h.user.current = {
      id: PROFILE_IDS.me,
      email: "anna@example.test",
      user_metadata: { first_name: "ZMetadanych", last_name: "ZMetadanych" },
    };
    await renderPanel();

    expect(screen.getByLabelText("profile.account.firstName")).toHaveValue("Anna");
    expect(screen.getByLabelText("profile.account.lastName")).toHaveValue("Nowak");
    // Nic do uzupełnienia => żaden zapis.
    expect(updateCount()).toBe(0);
  });

  it("uzupełnia PUSTE pola i utrwala je JEDNYM zapisem", async () => {
    // Reguła 3: zapis leci tylko dlatego, że prefill coś dodał.
    h.user.current = {
      id: PROFILE_IDS.me,
      email: "a@example.test",
      user_metadata: { first_name: "Anna", last_name: "Nowak", avatar_url: "https://m/a.png" },
    };
    await renderPanel(
      ownProfileRow({ first_name: null, last_name: null, display_name: null, avatar_url: null }),
    );

    await waitFor(() => expect(updateCount()).toBe(1));
    expect(lastUpdate()?.patch).toEqual({
      first_name: "Anna",
      last_name: "Nowak",
      avatar_url: "https://m/a.png",
    });
    // Zapis prefillu też musi być zawężony do własnego wiersza.
    expect(lastUpdate()?.filters).toEqual([["id", PROFILE_IDS.me]]);
  });

  it("rozbija `full_name` na imię i nazwisko", async () => {
    h.user.current = {
      id: PROFILE_IDS.me,
      user_metadata: { full_name: "Jan Maria Kowalski" },
    };
    await renderPanel(ownProfileRow({ first_name: null, last_name: null, display_name: null }));

    expect(screen.getByLabelText("profile.account.firstName")).toHaveValue("Jan");
    // Wszystko po pierwszym członie to nazwisko - nie tylko drugi człon.
    expect(screen.getByLabelText("profile.account.lastName")).toHaveValue("Maria Kowalski");
  });

  it("czyta warianty pól od dostawców tożsamości (`given_name`, `family_name`, `picture`)", async () => {
    // Google zwraca `given_name`/`family_name`/`picture`, inni dostawcy
    // `first_name`/`last_name`/`avatar_url`. Obsługa jednego zestawu zostawiłaby
    // część kont z pustym profilem po rejestracji.
    h.user.current = {
      id: PROFILE_IDS.me,
      user_metadata: {
        given_name: "Piotr",
        family_name: "Zieliński",
        name: "Piotr Zieliński",
        picture: "https://g/p.png",
      },
    };
    await renderPanel(
      ownProfileRow({ first_name: null, last_name: null, display_name: null, avatar_url: null }),
    );

    expect(screen.getByLabelText("profile.account.firstName")).toHaveValue("Piotr");
    expect(screen.getByLabelText("profile.account.lastName")).toHaveValue("Zieliński");
    expect(screen.getByLabelText("profile.account.displayName")).toHaveValue("Piotr Zieliński");
  });

  it("jednoczłonowe `full_name` daje imię i PUSTE nazwisko", async () => {
    h.user.current = { id: PROFILE_IDS.me, user_metadata: { full_name: "Madonna" } };
    await renderPanel(ownProfileRow({ first_name: null, last_name: null, display_name: null }));

    expect(screen.getByLabelText("profile.account.firstName")).toHaveValue("Madonna");
    expect(screen.getByLabelText("profile.account.lastName")).toHaveValue("");
  });

  it("KONTO BEZ metadanych nie wywołuje ani jednego zapisu", async () => {
    // Reguła 3 od drugiej strony: brak czego uzupełniać => brak UPDATE-u,
    // więc wejście na stronę nie stempluje `updated_at`.
    await renderPanel(ownProfileRow({ first_name: null, last_name: null }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(updateCount()).toBe(0);
  });
});

describe("zapis formularza", () => {
  it("zapisuje bio do KANONICZNEJ kolumny `bio_pl`", async () => {
    // Ta sama reguła, co w `useProfileEditor`: jeden opis osoby, nie dwa.
    await renderPanel();

    fireEvent.change(screen.getByLabelText("profile.account.bio"), {
      target: { value: "Nowy opis" },
    });
    fireEvent.click(screen.getByRole("button", { name: "profile.account.save" }));

    await waitFor(() => expect(updateCount()).toBe(1));
    expect(lastUpdate()?.patch).toMatchObject({ bio_pl: "Nowy opis" });
    expect(lastUpdate()?.patch).not.toHaveProperty("bio");
  });

  it("zapis jest ZAWĘŻONY do własnego wiersza", async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "profile.account.save" }));

    await waitFor(() => expect(updateCount()).toBe(1));
    expect(lastUpdate()?.filters).toEqual([["id", PROFILE_IDS.me]]);
  });

  it("wysyła edytowane wartości wszystkich pól tożsamości", async () => {
    await renderPanel();

    fireEvent.change(screen.getByLabelText("profile.account.firstName"), {
      target: { value: "Ania" },
    });
    fireEvent.change(screen.getByLabelText("profile.account.jobTitle"), {
      target: { value: "Director" },
    });
    fireEvent.change(screen.getByLabelText("profile.account.phone"), {
      target: { value: "+48 22 111 11 11" },
    });
    fireEvent.click(screen.getByRole("button", { name: "profile.account.save" }));

    await waitFor(() => expect(updateCount()).toBe(1));
    expect(lastUpdate()?.patch).toMatchObject({
      first_name: "Ania",
      job_title: "Director",
      phone: "+48 22 111 11 11",
    });
  });

  it("po udanym zapisie unieważnia nagłówek, powitanie i pasek boczny", async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "profile.account.save" }));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("profile.account.saved"));
    const keys = h.invalidated.map((a) => JSON.stringify((a as { queryKey: unknown }).queryKey));
    expect(keys).toContain(JSON.stringify(["header-profile", PROFILE_IDS.me]));
    expect(keys).toContain(JSON.stringify(["greeting", PROFILE_IDS.me]));
    expect(keys).toContain(JSON.stringify(["profile-sidebar", PROFILE_IDS.me]));
  });

  it("NIEUDANY zapis nie unieważnia cache i nie udaje sukcesu", async () => {
    // Unieważnienie po błędzie kazałoby nagłówkowi przeczytać niezmieniony
    // wiersz i pokazać go jako „zapisany”.
    h.updateError.current = { message: "boom" };
    await renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "profile.account.save" }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("profile.account.saveError"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(h.invalidated).toHaveLength(0);
  });

  it("przycisk zapisu wraca do stanu aktywnego po błędzie", async () => {
    h.updateError.current = { message: "boom" };
    await renderPanel();
    const button = screen.getByRole("button", { name: "profile.account.save" });
    fireEvent.click(button);

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(button).not.toBeDisabled();
  });

  it("bez sesji formularz nie zapisuje", async () => {
    h.rpc.mockResolvedValue({ data: [], error: null });
    h.user.current = null;
    render(<AccountIdentityPanel />);

    fireEvent.click(screen.getByRole("button", { name: "profile.account.save" }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(updateCount()).toBe(0);
  });
});

describe("rodzaj gramatyczny", () => {
  it("wybór automatyczny zapisuje NULL, nie napis `auto`", async () => {
    // Kolumna `gender` steruje odmianą w powitaniach. Napis „auto” nie jest
    // wartością z CHECK-a - zapis by przeszedł tylko dlatego, że kolumna jest
    // tekstem, a silnik powitań dostałby wartość, której nie zna.
    await renderPanel(ownProfileRow({ gender: "female" }));

    fireEvent.change(screen.getByLabelText("profile.account.gender"), {
      target: { value: "auto" },
    });
    fireEvent.click(screen.getByRole("button", { name: "profile.account.save" }));

    await waitFor(() => expect(updateCount()).toBe(1));
    expect(lastUpdate()?.patch).toMatchObject({ gender: null });
  });

  it("wybór konkretnego rodzaju zapisuje jego kod", async () => {
    await renderPanel(ownProfileRow({ gender: null }));

    fireEvent.change(screen.getByLabelText("profile.account.gender"), {
      target: { value: "neutral" },
    });
    fireEvent.click(screen.getByRole("button", { name: "profile.account.save" }));

    await waitFor(() => expect(updateCount()).toBe(1));
    expect(lastUpdate()?.patch).toMatchObject({ gender: "neutral" });
  });

  it("brak rodzaju w bazie pokazuje opcję automatyczną", async () => {
    await renderPanel(ownProfileRow({ gender: null }));
    expect(screen.getByLabelText("profile.account.gender")).toHaveValue("auto");
  });
});

describe("wysyłka zdjęć po kadrowaniu", () => {
  /** Otwiera kadrowanie dla wskazanego rodzaju przez ukryty input pliku. */
  function pickFile(kind: "avatar" | "cover"): void {
    const label =
      kind === "avatar" ? "profile.account.uploadAvatar" : "profile.account.uploadCover";
    fireEvent.click(screen.getByRole("button", { name: label }));
    const inputs = document.querySelectorAll('input[type="file"]');
    const input = inputs[kind === "avatar" ? 0 : 1] as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File([new Uint8Array(10)], "a.png", { type: "image/png" })] },
    });
  }

  it("stempluje ścieżkę tenantem i id użytkownika, zawsze jako `.jpg`", async () => {
    // Kadrowanie zwraca JPEG niezależnie od formatu wejściowego, więc
    // rozszerzenie jest STAŁE - a prefiks decyduje o izolacji plików.
    xhr = xhrStub(200);
    await renderPanel();

    pickFile("avatar");
    fireEvent.click(await screen.findByTestId("crop-confirm"));

    await waitFor(() => expect(h.signedPaths).toHaveLength(1));
    const path = h.signedPaths[0];
    expect(path.startsWith(`${PROFILE_IDS.tenant}/users/${PROFILE_IDS.me}/avatar-`)).toBe(true);
    expect(path.endsWith(".jpg")).toBe(true);
  });

  it("okładka trafia w ścieżkę `cover-`, nie `avatar-`", async () => {
    xhr = xhrStub(200);
    await renderPanel();

    pickFile("cover");
    fireEvent.click(await screen.findByTestId("crop-confirm"));

    await waitFor(() => expect(h.signedPaths).toHaveLength(1));
    expect(h.signedPaths[0]).toContain(`/${PROFILE_IDS.me}/cover-`);
  });

  it("po wysyłce zapisuje adres w kolumnie zgodnej z rodzajem i potwierdza", async () => {
    xhr = xhrStub(200);
    await renderPanel();

    pickFile("cover");
    fireEvent.click(await screen.findByTestId("crop-confirm"));

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("profile.account.uploadSuccess"),
    );
    const patches = h.updates.map((u) => u.patch);
    expect(patches.some((p) => typeof p.cover_url === "string")).toBe(true);
    expect(patches.some((p) => "avatar_url" in p)).toBe(false);
  });

  it("po udanej wysyłce ODŚWIEŻA wiersz z RPC", async () => {
    // Bez ponownego odczytu formularz pokazuje adres, którego nie potwierdziła
    // baza - a mirror trigger mógł go jeszcze zmienić.
    xhr = xhrStub(200);
    await renderPanel();
    const callsBefore = h.rpc.mock.calls.length;

    pickFile("avatar");
    fireEvent.click(await screen.findByTestId("crop-confirm"));

    await waitFor(() => expect(h.rpc.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("błąd podpisu URL-a kończy się komunikatem, bez zapisu adresu", async () => {
    h.signError.current = new Error("quota");
    await renderPanel();

    pickFile("avatar");
    fireEvent.click(await screen.findByTestId("crop-confirm"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("profile.account.uploadError"));
    expect(h.updates.some((u) => "avatar_url" in u.patch)).toBe(false);
  });

  it("odpowiedź HTTP poza 2xx to awaria wysyłki", async () => {
    xhr = xhrStub(500);
    await renderPanel();

    pickFile("avatar");
    fireEvent.click(await screen.findByTestId("crop-confirm"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("profile.account.uploadError"));
  });

  it("zerwana sieć to awaria wysyłki, nie wieczne „wysyłanie”", async () => {
    xhr = xhrStub("error");
    await renderPanel();

    pickFile("avatar");
    fireEvent.click(await screen.findByTestId("crop-confirm"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("profile.account.uploadError"));
    // Stan „wysyłanie” musi się skończyć - inaczej przycisk zostaje zablokowany.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "profile.account.uploadAvatar" }),
      ).not.toBeDisabled(),
    );
  });

  it("błąd zapisu adresu po wysyłce też jest awarią", async () => {
    // Plik wylądował w Storage, ale profil o nim nie wie - użytkownik musi
    // wiedzieć, że nic nie widzi.
    xhr = xhrStub(200);
    h.updateError.current = { message: "boom" };
    await renderPanel();

    pickFile("avatar");
    fireEvent.click(await screen.findByTestId("crop-confirm"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("profile.account.uploadError"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("BEZ tenanta nie wysyła nic - ścieżka bez stempla nie ma izolacji", async () => {
    await renderPanel(ownProfileRow({ tenant_id: null }));

    pickFile("avatar");
    fireEvent.click(await screen.findByTestId("crop-confirm"));

    await act(async () => {
      await Promise.resolve();
    });
    expect(h.signedPaths).toHaveLength(0);
  });

  it("zamknięcie kadrowania bez potwierdzenia nie wysyła nic", async () => {
    await renderPanel();

    pickFile("avatar");
    fireEvent.click(await screen.findByTestId("crop-cancel"));

    await waitFor(() => expect(screen.queryByTestId("crop-confirm")).not.toBeInTheDocument());
    expect(h.signedPaths).toHaveLength(0);
  });

  it("kadrowanie dostaje rodzaj zgodny z klikniętym przyciskiem", async () => {
    // Wspólny dialog dla obu rodzajów: pomyłka `kind` kadruje okładkę
    // w proporcjach awatara (1:1 zamiast 16:6).
    await renderPanel();

    pickFile("cover");
    expect(await screen.findByText("crop:cover")).toBeInTheDocument();
  });
});

describe("wskazówka do huba prywatności", () => {
  it("prowadzi do /profile/privacy, gdzie ustawienia mieszkają od konsolidacji", async () => {
    // Ustawienia widoczności wyprowadziły się z tego formularza. Bez tej
    // wskazówki użytkownik szuka ich tam, gdzie były.
    await renderPanel();

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/profile/privacy");
    expect(screen.getByText("profile.account.privacyHintTitle")).toBeInTheDocument();
  });
});
