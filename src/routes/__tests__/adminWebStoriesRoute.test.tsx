// Trasa `/admin/web-stories` ZAMONTOWANA - redakcja historii AMP (Web Stories):
// lista, edytor stron z podstronami PL/EN, publikacja i usuwanie.
//
// DLACZEGO TA TRASA MA WŁASNY PLIK. Cała warstwa danych stoi w niej wprost:
// jeden `useQuery` i trzy `useMutation` z klientem Supabase w `queryFn`,
// a reguły publikacji (`slug` z tytułu, znacznik `published_at`) mieszkają
// w domknięciu mutacji. Kształt strony historii (`safeParsePages`,
// `newStoryPage`) ma własne testy w `src/lib/web-stories/types` i jest tu
// GRANICĄ, nie przedmiotem dowodu.
//
// CZTERY REGUŁY, KTÓRYCH ZŁAMANIE KOSZTUJE:
//
//   1. `slug` POWSTAJE Z TYTUŁU, gdy redakcja go nie poda - i musi zostać
//      oczyszczony. Historia AMP jest adresowalna publicznie
//      (`/web-stories/$slug` + wariant `.amp`), a slug ze spacjami albo
//      polskimi znakami daje adres, którego nie da się udostępnić.
//   2. PUBLIKACJA STEMPLUJE `published_at`, ALE TYLKO RAZ. Nadpisanie
//      istniejącego znacznika przy każdym zapisie przestawiałoby historię na
//      początek listy publicznej po każdej literówce.
//   3. NOWA HISTORIA WYMAGA OBSZARU ROBOCZEGO. Insert bez `tenant_id` to
//      wiersz, którego nie widzi żadna strona publiczna - dlatego panel
//      odmawia zapisu, zamiast wysyłać go z pustym polem.
//   4. USUNIĘCIE PYTA I UNIEWAŻNIA TO, CO WIDZI CZYTELNIK. Publiczna lista
//      historii ma własny klucz cache; zapis go unieważnia, usunięcie - nie
//      (defekt PRZYPIĘTY niżej, z kontrolą dodatnią).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - DOSTĘPU: `/admin` przepuszcza tylko `isStaff`, a prawo zapisu do
//   `web_stories` egzekwuje RLS; warstw pilnuje
//   `src/routes/__tests__/adminRouteAuthority.gate.test.ts`.
// - POWIERZCHNI AMP: `web-stories.$slug.amp.ts` ma kontrakt degradacji
//   w `feedRoutesDegradation.test.ts`.
// - KSZTAŁTU STRONY: `safeParsePages` / `newStoryPage` mają własne asercje.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { RecordedChain, SupabaseFromStub } from "@/test/supabaseChain";

const TENANT = "11111111-1111-4111-8111-111111111111";
const STORY_ID = "77777777-7777-4777-8777-777777777777";

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  /** `null` = sesja bez obszaru roboczego (świeży token, brak profilu). */
  tenantId: null as string | null,
  confirmAnswer: true,
  confirmMessages: [] as string[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-misc-routes", () => ({ ensureI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/adminToasts", () => ({
  adminToast: {
    saved: () => "adminToasts.saved",
    deleted: () => "adminToasts.deleted",
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ tenantId: h.tenantId }) }));
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const db = supabaseFromStub();
  h.db = db;
  return { supabase: { from: db.from } };
});
vi.mock("@/components/admin/AdminShell", () => ({
  AdminShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/tabs", async () => {
  const react = await import("react");
  const { radixTabsStub } = await import("@/test/reactStubs");
  return radixTabsStub(react);
});
// Wybór koloru tła strony historii to organizm z pipetą i paletą; tutaj
// przedmiotem dowodu jest ładunek zapisu, więc pole staje się natywnym inputem.
vi.mock("@/components/admin/blocks/AdminColorPicker", async () => {
  const react = await import("react");
  return {
    AdminColorPicker: ({
      value,
      onChange,
    }: {
      value?: string;
      onChange?: (next: string) => void;
    }) =>
      react.createElement("input", {
        "aria-label": "bg-color",
        value: value ?? "",
        onChange: (event: { target: { value: string } }) => onChange?.(event.target.value),
      }),
  };
});

import { ok, fail } from "@/test/supabaseChain";
import { renderRoute, routeMeta } from "@/test/routeHarness";
import { Route as WebStoriesRoute } from "@/routes/admin.web-stories";

const PATH = "/admin/web-stories";
const PUBLIC_KEY = ["web-stories"];
const ADMIN_KEY = ["admin", "web-stories"];

function db(): SupabaseFromStub {
  if (!h.db) throw new Error("test: atrapa bazy nie została ustawiona");
  return h.db;
}

/** Wiersz listy historii. Tytuły WYMYŚLONE (RODO w fixtures). */
function row(patch: Record<string, unknown> = {}) {
  return {
    id: STORY_ID,
    slug: "szczyt-w-liczbach",
    title_pl: "Szczyt w liczbach",
    title_en: "Summit by numbers",
    status: "published",
    cover_url: null,
    published_at: "2026-03-01T10:00:00Z",
    ...patch,
  };
}

/** Pełna historia oddawana przez `loadOne` (select `*`). */
function fullStory(patch: Record<string, unknown> = {}) {
  return {
    ...row(),
    tenant_id: TENANT,
    description_pl: "Trzy dni w dziesięciu planszach.",
    description_en: "Three days in ten cards.",
    pages: [
      {
        id: "p1",
        title_pl: "Plansza pierwsza",
        title_en: "First card",
        body_pl: "",
        body_en: "",
        bg_kind: "color",
        bg_color: "#0F172A",
        bg_image_url: null,
        cta_label_pl: "",
        cta_label_en: "",
        cta_href: "",
        duration_seconds: 6,
      },
    ],
    author_id: null,
    created_at: "2026-03-01T09:00:00Z",
    updated_at: "2026-03-01T09:30:00Z",
    ...patch,
  };
}

async function mount() {
  return renderRoute({ route: WebStoriesRoute, path: PATH, initialEntry: PATH });
}

function chainWith(table: string, method: string): RecordedChain {
  const found = db()
    .chainsFor(table)
    .find((c) => c.has(method));
  if (!found) throw new Error(`test: brak łańcucha "${table}" z ogniwem "${method}"`);
  return found;
}

const button = (name: string | RegExp) => screen.getByRole("button", { name });

/**
 * Lista statusu historii. `<Label>Status</Label>` w tej trasie NIE MA `htmlFor`,
 * więc pola nie da się znaleźć etykietą - rozpoznajemy je po zestawie opcji
 * (twardy błąd zamiast cichego `undefined`, bo test klikający w nieistniejące
 * pole „przechodzi" bez dowodu).
 */
function statusSelect(): HTMLElement {
  const found = screen
    .getAllByRole("combobox")
    .find((el) => el.querySelector('option[value="published"]'));
  if (!found) throw new Error("test: brak listy statusu historii");
  return found;
}

/** Ładunek ostatniego zapisu (`insert` albo `update`) tabeli historii. */
function savePayload(method: "insert" | "update"): Record<string, unknown> {
  const args = chainWith("web_stories", method).argsOf(method)?.[0];
  if (!args || typeof args !== "object") throw new Error(`test: ${method} bez ładunku`);
  return args as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.tenantId = TENANT;
  h.confirmAnswer = true;
  h.confirmMessages = [];
  db().reset();
  db().setResponse("web_stories", (chain) =>
    chain.has("maybeSingle") ? ok(fullStory()) : chain.has("select") ? ok([row()]) : ok([]),
  );
  // Panel woła NATYWNY `confirm` (a nie `confirmDialog` z `@/lib/appDialogs`,
  // jak pozostałe panele modułu) - zapisujemy treść pytania, bo to ona mówi
  // redakcji, KTÓRA historia zniknie.
  vi.stubGlobal("confirm", (message?: string) => {
    h.confirmMessages.push(String(message));
    return h.confirmAnswer;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("admin.web-stories - lista i sklejenie", () => {
  it("czyta historie od najnowszej - redakcja pracuje na świeżych", async () => {
    await mount();
    await screen.findByText("Szczyt w liczbach");

    expect(chainWith("web_stories", "select").argsOf("order")).toEqual([
      "created_at",
      { ascending: false },
    ]);
  });

  it("pusta lista mówi o pustce i zostawia drogę dodania historii", async () => {
    db().setResponse("web_stories", () => ok([]));
    await mount();

    expect(await screen.findByText("adminMiscRoutes.webStories.empty")).toBeInTheDocument();
    expect(button(/adminMiscRoutes\.webStories\.newStory/)).toBeInTheDocument();
  });

  it("awaria odczytu nie wywala panelu - zostaje nagłówek i akcja dodania", async () => {
    // Panel bez tej odporności zamienia odmowę RLS w biały ekran, czyli
    // odcina redakcję także od tworzenia nowej historii.
    db().setResponse("web_stories", () => fail("test: odmowa odczytu web_stories", "42501"));
    await mount();

    expect(await screen.findByText("Web Stories")).toBeInTheDocument();
    expect(button(/adminMiscRoutes\.webStories\.newStory/)).toBeInTheDocument();
  });

  it("status historii jest widoczny na liście - szkic nie udaje publikacji", async () => {
    db().setResponse("web_stories", (chain) =>
      chain.has("select") ? ok([row({ status: "draft" })]) : ok([]),
    );
    await mount();

    expect(await screen.findByText("draft")).toBeInTheDocument();
  });

  it("panel nie zostawia w nagłówku pustego tytułu", async () => {
    const meta = await routeMeta(WebStoriesRoute);
    for (const entry of meta) {
      if ("title" in entry) expect(entry.title).not.toBe("");
    }
  });
});

describe("admin.web-stories - wejście w edycję", () => {
  it("klik w tytuł dociąga PEŁNY wiersz osobnym odczytem po identyfikatorze", async () => {
    // Lista czyta wąski zestaw kolumn (bez `pages`), bo strony historii to
    // duży jsonb. Edytor otwarty na danych z listy miałby zero stron
    // i pierwszy zapis skasowałby całą treść historii.
    await mount();
    fireEvent.click(await screen.findByText("Szczyt w liczbach"));

    await waitFor(() => expect(db().chainsFor("web_stories").length).toBeGreaterThan(1));
    const single = chainWith("web_stories", "maybeSingle");
    expect(single.argsOf("eq")).toEqual(["id", STORY_ID]);
    expect(String(single.argsOf("select")?.[0])).toBe("*");
    expect(await screen.findByLabelText("Slug")).toHaveValue("szczyt-w-liczbach");
  });

  it("KONTROLA DODATNIA: nieudany dociąg NIE otwiera edytora, ale też NIC nie mówi", async () => {
    // Dzisiejsze zachowanie: mutacja `loadOne` ma tylko `onSuccess`, więc
    // odmowa odczytu kończy się CISZĄ. Ten test przybija jedną rzecz, która
    // jest tu poprawna (edytor się NIE otwiera na `undefined`, bo zapis
    // nadpisałby istniejącą historię pustkami) i drugą, która poprawna nie
    // jest - stąd przypięcie niżej.
    db().setResponse("web_stories", (chain) =>
      chain.has("maybeSingle")
        ? fail("test: odmowa odczytu wiersza", "42501")
        : chain.has("select")
          ? ok([row()])
          : ok([]),
    );
    await mount();
    fireEvent.click(await screen.findByText("Szczyt w liczbach"));

    await waitFor(() => expect(db().chainsFor("web_stories").length).toBeGreaterThan(1));
    expect(screen.queryByLabelText("Slug")).toBeNull();
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it.fails("nieudany dociąg historii MUSI powiedzieć redakcji, co się stało", async () => {
    // DEFEKT PRODUKCYJNY (nienaprawiony: brak `onError` w mutacji `loadOne`).
    //
    // KONSEKWENCJA. Klik w tytuł historii po odmowie RLS albo padniętym
    // transporcie nie robi NIC: edytor się nie otwiera, żaden komunikat nie
    // pada. Redaktor klika kolejne razy, uznaje panel za zepsuty i zgłasza
    // „nie da się edytować historii" - bez informacji, że to kwestia
    // uprawnień. Dwie pozostałe mutacje tej trasy (`save`, `remove`) MAJĄ
    // `onError` z toastem, więc to pominięcie, nie decyzja.
    db().setResponse("web_stories", (chain) =>
      chain.has("maybeSingle")
        ? fail("test: odmowa odczytu wiersza", "42501")
        : chain.has("select")
          ? ok([row()])
          : ok([]),
    );
    await mount();
    fireEvent.click(await screen.findByText("Szczyt w liczbach"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
  });

  it("etykiety pól PL i EN są TYMI SAMYMI kluczami - zakładka mówi o języku treści", async () => {
    // Etykieta opisuje POLE („tytuł"), a nie język interfejsu. Wpisanie przy
    // zakładce EN angielskiego napisu na sztywno dawałoby panel mówiący dwoma
    // językami naraz, niezależnie od wyboru użytkownika.
    await mount();
    fireEvent.click(await screen.findByText("Szczyt w liczbach"));
    await screen.findByLabelText("Slug");

    expect(screen.getByLabelText("adminMiscRoutes.webStories.title")).toHaveValue(
      "Szczyt w liczbach",
    );
    fireEvent.click(screen.getByRole("tab", { name: /EN/ }));
    // Ten sam KLUCZ etykiety, inna WARTOŚĆ pola - to jest cały kontrakt.
    // Przed naprawą zakładka EN niosła napisy „Title" i „Description" wpisane
    // na sztywno, więc to `getByLabelText` z kluczem NIE MIAŁO co znaleźć.
    expect(screen.getByLabelText("adminMiscRoutes.webStories.title")).toHaveValue(
      "Summit by numbers",
    );
    expect(screen.getByLabelText("adminMiscRoutes.webStories.description")).toHaveValue(
      "Three days in ten cards.",
    );
  });
});

describe("admin.web-stories - zapis", () => {
  async function openEditor() {
    const view = await mount();
    fireEvent.click(await screen.findByText("Szczyt w liczbach"));
    await screen.findByLabelText("Slug");
    return view;
  }

  it("pusty slug jest wyliczany z tytułu i OCZYSZCZANY do adresu", async () => {
    // REGUŁA 1. Historia jest adresowalna publicznie, więc slug ze spacjami
    // i wielkimi literami daje adres, którego nie da się udostępnić - a link
    // do historii jest całym jej sensem.
    await openEditor();
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("adminMiscRoutes.webStories.title"), {
      target: { value: "Szczyt 2026 --- Podsumowanie!" },
    });
    fireEvent.click(button("common.save"));

    await waitFor(() =>
      expect(
        db()
          .chainsFor("web_stories")
          .some((c) => c.has("update")),
      ).toBe(true),
    );
    expect(savePayload("update").slug).toBe("szczyt-2026-podsumowanie");
  });

  it("historia bez tytułu i bez slugu jest ODRZUCANA zamiast zapisana pod pustym adresem", async () => {
    await openEditor();
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("adminMiscRoutes.webStories.title"), {
      target: { value: "" },
    });
    fireEvent.click(button("common.save"));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("adminMiscRoutes.webStories.errSlug"),
    );
    expect(
      db()
        .chainsFor("web_stories")
        .some((c) => c.has("update")),
    ).toBe(false);
  });

  it("publikacja szkicu STEMPLUJE `published_at`", async () => {
    // REGUŁA 2, pierwsza połowa: bez znacznika historia nie ma daty na liście
    // publicznej i w kanale - czyli nie da się jej uporządkować w czasie.
    db().setResponse("web_stories", (chain) =>
      chain.has("maybeSingle")
        ? ok(fullStory({ status: "draft", published_at: null }))
        : chain.has("select")
          ? ok([row({ status: "draft", published_at: null })])
          : ok([]),
    );
    await openEditor();
    fireEvent.change(statusSelect(), { target: { value: "published" } });
    fireEvent.click(button("common.save"));

    await waitFor(() =>
      expect(
        db()
          .chainsFor("web_stories")
          .some((c) => c.has("update")),
      ).toBe(true),
    );
    expect(typeof savePayload("update").published_at).toBe("string");
    expect(String(savePayload("update").published_at)).not.toBe("");
  });

  it("kolejny zapis opublikowanej historii NIE przestawia jej daty publikacji", async () => {
    // REGUŁA 2, druga połowa: nadpisanie znacznika przy każdym zapisie
    // wypychałoby historię na czoło listy publicznej po każdej literówce.
    await openEditor();
    fireEvent.click(button("common.save"));

    await waitFor(() =>
      expect(
        db()
          .chainsFor("web_stories")
          .some((c) => c.has("update")),
      ).toBe(true),
    );
    expect(savePayload("update").published_at).toBe("2026-03-01T10:00:00Z");
  });

  it("cofnięcie do szkicu ZOSTAWIA poprzednią datę, a nie zeruje jej", async () => {
    // Data pierwszej publikacji jest faktem historycznym; wyzerowanie jej
    // przy schowaniu historii gubi informację, kiedy poszła w świat.
    await openEditor();
    fireEvent.change(statusSelect(), { target: { value: "draft" } });
    fireEvent.click(button("common.save"));

    await waitFor(() =>
      expect(
        db()
          .chainsFor("web_stories")
          .some((c) => c.has("update")),
      ).toBe(true),
    );
    expect(savePayload("update").published_at).toBe("2026-03-01T10:00:00Z");
    expect(savePayload("update").status).toBe("draft");
  });

  it("istniejąca historia jedzie UPDATE po identyfikatorze, nie INSERTEM", async () => {
    await openEditor();
    fireEvent.click(button("common.save"));

    await waitFor(() =>
      expect(
        db()
          .chainsFor("web_stories")
          .some((c) => c.has("update")),
      ).toBe(true),
    );
    expect(chainWith("web_stories", "update").argsOf("eq")).toEqual(["id", STORY_ID]);
    expect(
      db()
        .chainsFor("web_stories")
        .some((c) => c.has("insert")),
    ).toBe(false);
  });

  it("NOWA historia bez obszaru roboczego jest ODRZUCANA przed zapytaniem", async () => {
    // REGUŁA 3. Wiersz bez `tenant_id` nie wychodzi na żadnej domenie -
    // byłby historią widmo, zajmującą slug.
    h.tenantId = null;
    await mount();
    await screen.findByText("Szczyt w liczbach");
    fireEvent.click(button(/adminMiscRoutes\.webStories\.newStory/));
    await screen.findByLabelText("Slug");
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "nowa-historia" } });
    fireEvent.click(button("common.save"));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("adminMiscRoutes.webStories.errTenant"),
    );
    expect(
      db()
        .chainsFor("web_stories")
        .some((c) => c.has("insert")),
    ).toBe(false);
  });

  it("NOWA historia z obszarem roboczym jedzie INSERTEM z `tenant_id` i jedną stroną", async () => {
    // Historia AMP bez ani jednej strony jest pustym dokumentem, którego
    // przeglądarka nie wyrenderuje - stąd `newStoryPage()` w szkicu.
    await mount();
    await screen.findByText("Szczyt w liczbach");
    fireEvent.click(button(/adminMiscRoutes\.webStories\.newStory/));
    await screen.findByLabelText("Slug");
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "nowa-historia" } });
    fireEvent.click(button("common.save"));

    await waitFor(() =>
      expect(
        db()
          .chainsFor("web_stories")
          .some((c) => c.has("insert")),
      ).toBe(true),
    );
    const payload = savePayload("insert");
    expect(payload.tenant_id).toBe(TENANT);
    expect(payload.slug).toBe("nowa-historia");
    expect(Array.isArray(payload.pages) ? (payload.pages as unknown[]).length : 0).toBe(1);
  });

  it("udany zapis unieważnia OBA klucze: panelu i publiczny", async () => {
    // Publiczna lista historii ma własny klucz. Bez drugiego unieważnienia
    // czytelnik w tej samej sesji widzi wersję sprzed zapisu.
    const view = await openEditor();
    const spy = vi.spyOn(view.queryClient, "invalidateQueries");
    fireEvent.click(button("common.save"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminToasts.saved"));
    expect(spy).toHaveBeenCalledWith({ queryKey: ADMIN_KEY });
    expect(spy).toHaveBeenCalledWith({ queryKey: PUBLIC_KEY });
  });

  it("błąd zapisu NIE zamyka edytora i nie chwali", async () => {
    db().setResponse("web_stories", (chain) =>
      chain.has("maybeSingle")
        ? ok(fullStory())
        : chain.has("select")
          ? ok([row()])
          : fail("test: odmowa polityki RLS", "42501"),
    );
    await openEditor();
    fireEvent.click(button("common.save"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Slug")).toBeInTheDocument();
  });
});

describe("admin.web-stories - strony historii", () => {
  async function openEditor() {
    const view = await mount();
    fireEvent.click(await screen.findByText("Szczyt w liczbach"));
    await screen.findByLabelText("Slug");
    return view;
  }

  it("dodana strona trafia do ładunku zapisu, a nie tylko na ekran", async () => {
    await openEditor();
    fireEvent.click(button(/adminMiscRoutes\.webStories\.addPage/));
    fireEvent.click(button("common.save"));

    await waitFor(() =>
      expect(
        db()
          .chainsFor("web_stories")
          .some((c) => c.has("update")),
      ).toBe(true),
    );
    expect(Array.isArray(savePayload("update").pages)).toBe(true);
    expect((savePayload("update").pages as unknown[]).length).toBe(2);
  });

  it("OSTATNIEJ strony nie da się usunąć - historia bez stron się nie renderuje", async () => {
    // `if (d.pages.length <= 1) return` jest jedyną barierą; bez niej redakcja
    // zapisuje historię z pustą tablicą stron, a walidacja zapisu odrzuca ją
    // dopiero komunikatem - po utracie treści z ekranu.
    await openEditor();
    fireEvent.click(button("Delete"));
    fireEvent.click(button("common.save"));

    await waitFor(() =>
      expect(
        db()
          .chainsFor("web_stories")
          .some((c) => c.has("update")),
      ).toBe(true),
    );
    expect((savePayload("update").pages as unknown[]).length).toBe(1);
    expect(h.toastError).not.toHaveBeenCalled();
  });
});

describe("admin.web-stories - usunięcie historii", () => {
  async function clickRemove() {
    await mount();
    await screen.findByText("Szczyt w liczbach");
    fireEvent.click(button(/adminMiscRoutes\.webStories\.remove/));
  }

  it("pyta o potwierdzenie PRZED usunięciem", async () => {
    // REGUŁA 4. Historia niesie wszystkie swoje strony w jednym wierszu -
    // usunięcie jest nieodwracalne i kasuje całą treść naraz.
    await clickRemove();

    expect(h.confirmMessages).toEqual(["adminMiscRoutes.webStories.confirmRemove"]);
  });

  it("ODMOWA w potwierdzeniu nie wysyła DELETE", async () => {
    h.confirmAnswer = false;
    await clickRemove();

    expect(
      db()
        .chainsFor("web_stories")
        .some((c) => c.has("delete")),
    ).toBe(false);
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("ZGODA usuwa DOKŁADNIE ten wiersz", async () => {
    await clickRemove();

    await waitFor(() =>
      expect(
        db()
          .chainsFor("web_stories")
          .some((c) => c.has("delete")),
      ).toBe(true),
    );
    expect(chainWith("web_stories", "delete").argsOf("eq")).toEqual(["id", STORY_ID]);
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminToasts.deleted"));
  });

  it("KONTROLA DODATNIA: usunięcie unieważnia dziś TYLKO klucz panelu", async () => {
    // Dzisiejsze zachowanie, przybite, żeby przypięty niżej defekt nie był
    // „testem przechodzącym na brakującym wywołaniu".
    const view = await mount();
    await screen.findByText("Szczyt w liczbach");
    const spy = vi.spyOn(view.queryClient, "invalidateQueries");
    fireEvent.click(button(/adminMiscRoutes\.webStories\.remove/));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminToasts.deleted"));
    expect(spy).toHaveBeenCalledWith({ queryKey: ADMIN_KEY });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: PUBLIC_KEY });
  });

  it.fails("usunięcie historii MUSI unieważnić PUBLICZNĄ listę historii", async () => {
    // DEFEKT PRODUKCYJNY (nienaprawiony w tej pracy: poprawka to jedna linia
    // w `onSuccess` mutacji `remove`, ale zmienia zachowanie cache na
    // powierzchni publicznej i należy do pracy nad tą powierzchnią).
    //
    // ASYMETRIA JEST CAŁYM DOWODEM: `save.onSuccess` unieważnia DWA klucze
    // (`["admin", "web-stories"]` i `["web-stories"]`), a `remove.onSuccess`
    // tylko pierwszy.
    //
    // KONSEKWENCJA. Redakcja usuwa historię - panel pokazuje to natychmiast,
    // a publiczna lista w tej samej sesji przeglądarki dalej ją oferuje.
    // Klik prowadzi na `/web-stories/$slug`, którego wiersza już nie ma, więc
    // czytelnik dostaje 404 z linku, który właśnie widział jako aktywny.
    const view = await mount();
    await screen.findByText("Szczyt w liczbach");
    const spy = vi.spyOn(view.queryClient, "invalidateQueries");
    fireEvent.click(button(/adminMiscRoutes\.webStories\.remove/));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminToasts.deleted"));
    expect(spy).toHaveBeenCalledWith({ queryKey: PUBLIC_KEY });
  });

  it("błąd usunięcia pokazuje komunikat i NIE chwali", async () => {
    db().setResponse("web_stories", (chain) =>
      chain.has("delete") ? fail("test: odmowa usunięcia", "42501") : ok([row()]),
    );
    await clickRemove();

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});
