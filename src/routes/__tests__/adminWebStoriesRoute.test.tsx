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
// SIEDEM REGUŁ, KTÓRYCH ZŁAMANIE KOSZTUJE:
//
//   1. `slug` POWSTAJE Z TYTUŁU, gdy redakcja go nie poda - i musi zostać
//      oczyszczony Z TRANSLITERACJĄ. Historia AMP jest adresowalna publicznie
//      (`/web-stories/$slug` + wariant `.amp`), a slug ze spacjami daje adres,
//      którego nie da się udostępnić. Polskie litery NIE MOGĄ stawać się
//      dywizami („Gdańsk" -> `gdansk`, nie `gda-sk`) - to był defekt tej trasy.
//   2. PUBLIKACJA STEMPLUJE `published_at`, ALE TYLKO RAZ. Nadpisanie
//      istniejącego znacznika przy każdym zapisie przestawiałoby historię na
//      początek listy publicznej po każdej literówce.
//   3. NOWA HISTORIA WYMAGA OBSZARU ROBOCZEGO. Insert bez `tenant_id` to
//      wiersz, którego nie widzi żadna strona publiczna - dlatego panel
//      odmawia zapisu, zamiast wysyłać go z pustym polem.
//   4. ZAPIS I USUNIĘCIE UNIEWAŻNIAJĄ TO, CO WIDZI CZYTELNIK. Publiczna lista
//      historii ma własny klucz cache. Do tej pracy unieważniał go tylko
//      zapis; usunięcie zostawiało historię na liście publicznej (naprawione,
//      test regresyjny niżej).
//   5. TRASA NIE MA WŁASNEJ POWŁOKI PANELU. `admin.tsx` owija każde `/admin/*`
//      w `AdminShell`; druga powłoka tutaj dawała zduplikowane
//      `main#main-content`, drugi przełącznik języka i podwójne zapytania.
//   6. CZAS PLANSZY JEST CAŁKOWITY. `StoryPageSchema` wymaga `int()`, a
//      `safeParsePages` przy jednej złej planszy odrzuca CAŁĄ tablicę - „2.5"
//      kasowało po zapisie wszystkie strony historii.
//   7. KAŻDE POLE EDYTORA TRAFIA DO SWOJEGO KLUCZA, a pole planszy - do
//      AKTYWNEJ planszy. Pola różnią się tylko kluczem (jeden binder), więc
//      zamiana kluczy nie daje błędu, tylko treść w złym miejscu.
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
  /** Liczba montaży `AdminShell` - reguła 5 wymaga ZERA. */
  shellMounts: 0,
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
    error: () => "adminToasts.error",
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ tenantId: h.tenantId }) }));
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const db = supabaseFromStub();
  h.db = db;
  return { supabase: { from: db.from } };
});
// Powłoka panelu ciągnie router, sesję i motyw. Atrapa LICZY montaże i niesie
// ten sam znacznik `data-admin-shell`, co prawdziwa - reguła 5 mówi, że ta trasa
// nie ma prawa jej montować (robi to layout `admin.tsx`).
vi.mock("@/components/admin/AdminShell", () => ({
  AdminShell: ({ children }: { children?: ReactNode }) => {
    h.shellMounts += 1;
    return <div data-admin-shell="">{children}</div>;
  },
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
import { axeViolations, summarize } from "@/test/axe";
import { safeParsePages } from "@/lib/web-stories/types";
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
 * Lista statusu historii - po ETYKIECIE. Do tej pracy `<Label>Status</Label>`
 * nie miał `htmlFor`, więc lista nie miała nazwy dostępnej (czytnik ekranu
 * czytał „lista rozwijana" bez słowa o tym, czego dotyczy), a test szukał jej
 * po zestawie opcji. `getByLabelText` jest więc tu także dowodem naprawy.
 */
function statusSelect(): HTMLElement {
  return screen.getByLabelText("Status");
}

/** Plansza w kształcie `StoryPageSchema` (pełny zestaw pól, bez wartości domyślnych). */
function storyPage(id: string, title: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    background: "image",
    media_url: "",
    poster_url: "",
    color: "#141414",
    title_pl: title,
    title_en: "",
    caption_pl: "",
    caption_en: "",
    cta_label_pl: "",
    cta_label_en: "",
    cta_href: "",
    text_position: "bottom",
    text_align: "left",
    duration_seconds: 6,
    ...patch,
  };
}

const PAGE_A = storyPage("p1", "Plansza A");
const PAGE_B = storyPage("p2", "Plansza B");
const PAGE_C = storyPage("p3", "Plansza C");

/** Historia z TRZEMA planszami - dowody kolejności i „aktywnej planszy". */
function serveThreePages(): void {
  db().setResponse("web_stories", (chain) =>
    chain.has("maybeSingle")
      ? ok(fullStory({ pages: [PAGE_A, PAGE_B, PAGE_C] }))
      : chain.has("select")
        ? ok([row()])
        : ok([]),
  );
}

/** Plansze z ładunku UPDATE - z twardym błędem, gdy to nie tablica. */
function savedPages(): Record<string, unknown>[] {
  const pages = savePayload("update").pages;
  if (!Array.isArray(pages)) throw new Error("test: ładunek bez tablicy plansz");
  return pages as Record<string, unknown>[];
}

/** Zapis i oczekiwanie na łańcuch UPDATE. */
async function saveAndWaitForUpdate(): Promise<void> {
  fireEvent.click(button("common.save"));
  await waitFor(() =>
    expect(
      db()
        .chainsFor("web_stories")
        .some((c) => c.has("update")),
    ).toBe(true),
  );
}

const change = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

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
  h.shellMounts = 0;
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

  it("REGUŁA 5: trasa NIE montuje własnej powłoki panelu - robi to layout `/admin`", async () => {
    // Regresja: `<AdminShell hideSidebar>` w tej trasie zagnieżdżał drugą
    // powłokę w tej z `admin.tsx` - drugi `main#main-content` (zduplikowane id),
    // pływający przełącznik języka nad paskiem bocznym i podwójne zapytania
    // powłoki. Trasa ma oddać SAM kontent.
    const view = await mount();
    await screen.findByText("Szczyt w liczbach");

    expect(h.shellMounts).toBe(0);
    expect(view.container.querySelector("[data-admin-shell]")).toBeNull();
    expect(view.container.querySelectorAll("#main-content")).toHaveLength(0);
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

  it("nieudany dociąg NIE otwiera edytora i MÓWI redakcji, co się stało", async () => {
    // Regresja: mutacja `loadOne` nie miała `onError`, więc klik w tytuł po
    // odmowie RLS albo padniętym transporcie kończył się CISZĄ - redaktor
    // klikał kolejne razy i zgłaszał „nie da się edytować historii". Edytor
    // nadal NIE MOŻE się otworzyć na `undefined` (zapis nadpisałby istniejącą
    // historię pustkami), ale komunikat musi paść.
    db().setResponse("web_stories", (chain) =>
      chain.has("maybeSingle")
        ? fail("test: odmowa odczytu wiersza", "42501")
        : chain.has("select")
          ? ok([row()])
          : ok([]),
    );
    await mount();
    fireEvent.click(await screen.findByText("Szczyt w liczbach"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("test: odmowa odczytu wiersza"));
    expect(screen.queryByLabelText("Slug")).toBeNull();
  });

  it("historia usunięta w międzyczasie (pusty odczyt) też daje komunikat, nie ciszę", async () => {
    db().setResponse("web_stories", (chain) =>
      chain.has("maybeSingle") ? ok(null) : chain.has("select") ? ok([row()]) : ok([]),
    );
    await mount();
    fireEvent.click(await screen.findByText("Szczyt w liczbach"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adminToasts.error"));
    expect(screen.queryByLabelText("Slug")).toBeNull();
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

  it("REGUŁA 1: polskie litery TRANSLITERUJĄ się w slugu, zamiast stawać się dywizami", async () => {
    // Regresja: generator miał sam krok `[^a-z0-9]+ -> -`, więc „Gdańsk"
    // dawało `gda-sk`, a „Łódź" - `d`. Adres jest trwały (linkowany
    // i indeksowany), więc pocięty slug zostaje z historią na zawsze.
    await openEditor();
    change(screen.getByLabelText("Slug"), "");
    change(
      screen.getByLabelText("adminMiscRoutes.webStories.title"),
      "Łódź i Gdańsk: żółć, źdźbło",
    );
    await saveAndWaitForUpdate();

    expect(savePayload("update").slug).toBe("lodz-i-gdansk-zolc-zdzblo");
  });

  it("slug PODANY przez redakcję też przechodzi przez tę samą normalizację", async () => {
    // Pole slugu przyjmuje dowolny tekst; zapis go oczyszcza. Istniejący,
    // poprawny slug wychodzi z tego kroku bez zmian (idempotencja), więc
    // ponowny zapis opublikowanej historii nie przestawia jej adresu.
    await openEditor();
    change(screen.getByLabelText("Slug"), "  Raport Wrocław 2026  ");
    await saveAndWaitForUpdate();

    expect(savePayload("update").slug).toBe("raport-wroclaw-2026");
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

describe("admin.web-stories - pola historii", () => {
  async function openEditor() {
    const view = await mount();
    fireEvent.click(await screen.findByText("Szczyt w liczbach"));
    await screen.findByLabelText("Slug");
    return view;
  }

  it("REGUŁA 7: każde pole historii trafia do SWOJEJ kolumny ładunku", async () => {
    // Pola tekstowe różnią się wyłącznie kluczem (jeden binder). Wartości są
    // RÓŻNE, więc zamiana dwóch kluczy - np. opis EN wpięty pod pole PL -
    // wywraca tę asercję, zamiast przejść niezauważona.
    await openEditor();
    change(screen.getByLabelText("Slug"), "nowy-adres");
    change(screen.getByLabelText("adminMiscRoutes.webStories.cover"), "https://example.org/o.jpg");
    change(statusSelect(), "archived");
    change(screen.getByLabelText("adminMiscRoutes.webStories.title"), "Tytuł PL po zmianie");
    change(screen.getByLabelText("adminMiscRoutes.webStories.description"), "Opis PL po zmianie");
    fireEvent.click(screen.getByRole("tab", { name: /EN/ }));
    change(screen.getByLabelText("adminMiscRoutes.webStories.title"), "EN title changed");
    change(
      screen.getByLabelText("adminMiscRoutes.webStories.description"),
      "EN description changed",
    );
    await saveAndWaitForUpdate();

    expect(savePayload("update")).toMatchObject({
      slug: "nowy-adres",
      cover_url: "https://example.org/o.jpg",
      status: "archived",
      title_pl: "Tytuł PL po zmianie",
      description_pl: "Opis PL po zmianie",
      title_en: "EN title changed",
      description_en: "EN description changed",
    });
  });

  it("wyczyszczony adres okładki zapisuje się jako `null`, nie pusty ciąg", async () => {
    // Pusty ciąg w `cover_url` to `<img src="">` na liście i w kanale - i
    // nagłówek AMP, który ogłasza dokument bez okładki (patrz trasa publiczna).
    db().setResponse("web_stories", (chain) =>
      chain.has("maybeSingle")
        ? ok(fullStory({ cover_url: "https://example.org/stara.jpg" }))
        : chain.has("select")
          ? ok([row()])
          : ok([]),
    );
    await openEditor();
    change(screen.getByLabelText("adminMiscRoutes.webStories.cover"), "");
    await saveAndWaitForUpdate();

    expect(savePayload("update").cover_url).toBeNull();
  });

  it("„Nowa historia” w trakcie edycji otwiera CZYSTY szkic i zapisuje go INSERTEM", async () => {
    // Regresja: edytor trzyma kopię roboczą w `useState(s)` i bez `key` nie
    // przemontowywał się przy zmianie `s`. Klik „Nowa historia" nad otwartą
    // historią zostawiał ją na ekranie, a zapis szedł UPDATE-em w NIĄ.
    await openEditor();
    fireEvent.click(button(/adminMiscRoutes\.webStories\.newStory/));

    await waitFor(() => expect(screen.getByLabelText("Slug")).toHaveValue(""));
    change(screen.getByLabelText("Slug"), "druga-historia");
    fireEvent.click(button("common.save"));

    await waitFor(() =>
      expect(
        db()
          .chainsFor("web_stories")
          .some((c) => c.has("insert")),
      ).toBe(true),
    );
    expect(savePayload("insert").slug).toBe("druga-historia");
    expect(
      db()
        .chainsFor("web_stories")
        .some((c) => c.has("update")),
    ).toBe(false);
  });

  it("anulowanie zamyka edytor BEZ zapisu i wraca do listy", async () => {
    await openEditor();
    change(screen.getByLabelText("adminMiscRoutes.webStories.title"), "Zmiana do porzucenia");
    fireEvent.click(button("common.cancel"));

    expect(screen.queryByLabelText("Slug")).toBeNull();
    expect(await screen.findByText("Szczyt w liczbach")).toBeInTheDocument();
    expect(
      db()
        .chainsFor("web_stories")
        .some((c) => c.has("update") || c.has("insert")),
    ).toBe(false);
  });

  it("edytor nie zostawia pól bez nazwy dostępnej", async () => {
    // Regresja: cztery listy wyboru (status, tło, pozycja, wyrównanie) i pole
    // czasu stały pod `<Label>` bez `htmlFor` - czytnik ekranu czytał gołe
    // „lista rozwijana", a axe zgłaszał `select-name` (waga krytyczna).
    const view = await openEditor();

    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("admin.web-stories - strony historii", () => {
  async function openEditor() {
    const view = await mount();
    fireEvent.click(await screen.findByText("Szczyt w liczbach"));
    await screen.findByLabelText("Slug");
    return view;
  }

  it("historia z NIECZYTELNYMI planszami nie nadpisuje ich pustą tablicą", async () => {
    // `safeParsePages` przy jednej złej planszy oddaje `[]`, więc edytor
    // otwiera się z zerem plansz. Zapis w tym stanie wymazałby w bazie
    // wszystko, czego panel nie umiał odczytać - walidacja `errPages` jest tu
    // jedyną barierą przed utratą treści.
    db().setResponse("web_stories", (chain) =>
      chain.has("maybeSingle")
        ? ok(fullStory({ pages: [{ id: "p1", duration_seconds: 2.5 }] }))
        : chain.has("select")
          ? ok([row()])
          : ok([]),
    );
    await openEditor();
    fireEvent.click(button("common.save"));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("adminMiscRoutes.webStories.errPages"),
    );
    expect(
      db()
        .chainsFor("web_stories")
        .some((c) => c.has("update")),
    ).toBe(false);
  });

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

describe("admin.web-stories - pola i kolejność plansz", () => {
  async function openEditor() {
    serveThreePages();
    const view = await mount();
    fireEvent.click(await screen.findByText("Szczyt w liczbach"));
    await screen.findByLabelText("Slug");
    return view;
  }

  /** Pola tekstowe planszy: [etykieta, klucz w `pages[i]`, wpisana wartość]. */
  const PAGE_TEXT_FIELDS = [
    ["adminMiscRoutes.webStories.mediaUrlImage", "media_url", "https://example.org/b.jpg"],
    ["adminMiscRoutes.webStories.titlePl", "title_pl", "Tytuł planszy B"],
    ["adminMiscRoutes.webStories.titleEn", "title_en", "Card B title"],
    ["adminMiscRoutes.webStories.captionPl", "caption_pl", "Podpis planszy B"],
    ["adminMiscRoutes.webStories.captionEn", "caption_en", "Card B caption"],
    ["CTA PL", "cta_label_pl", "Czytaj raport"],
    ["CTA EN", "cta_label_en", "Read the report"],
    ["adminMiscRoutes.webStories.ctaLink", "cta_href", "/raporty/szczyt"],
    ["adminMiscRoutes.webStories.textPosition", "text_position", "top"],
    ["adminMiscRoutes.webStories.align", "text_align", "right"],
  ] as const;

  it("REGUŁA 7: każde pole planszy trafia do SWOJEGO klucza i do AKTYWNEJ planszy", async () => {
    // Dwie pomyłki, z których żadna nie daje błędu: klucz pola zamieniony
    // z sąsiednim (podpis PL w polu EN) i zapis do planszy #1 zamiast tej,
    // którą redakcja wybrała z listy. Sąsiednie plansze muszą wyjść z zapisu
    // BEZ ZMIAN - to druga połowa dowodu.
    await openEditor();
    fireEvent.click(button("#2 Plansza B"));
    for (const [label, , value] of PAGE_TEXT_FIELDS) change(screen.getByLabelText(label), value);
    await saveAndWaitForUpdate();

    const [first, second, third] = savedPages();
    expect(second).toMatchObject(
      Object.fromEntries(PAGE_TEXT_FIELDS.map(([, key, value]) => [key, value])),
    );
    expect(second.id).toBe("p2");
    expect(first).toEqual(PAGE_A);
    expect(third).toEqual(PAGE_C);
  });

  it("tło WIDEO pyta o adres wideo i poster; poster trafia do `poster_url`", async () => {
    await openEditor();
    change(screen.getByLabelText("adminMiscRoutes.webStories.background"), "video");
    change(
      screen.getByLabelText("adminMiscRoutes.webStories.mediaUrlVideo"),
      "https://example.org/v.mp4",
    );
    change(screen.getByLabelText("adminMiscRoutes.webStories.poster"), "https://example.org/p.jpg");
    await saveAndWaitForUpdate();

    expect(savedPages()[0]).toMatchObject({
      background: "video",
      media_url: "https://example.org/v.mp4",
      poster_url: "https://example.org/p.jpg",
    });
  });

  it("tło KOLOR zastępuje adres mediów wyborem koloru, a kolor trafia do `color`", async () => {
    // Plansza kolorowa nie ma mediów - pole adresu znika, żeby redakcja nie
    // wpisała tam czegoś, czego przeglądarka historii i tak nie pokaże.
    await openEditor();
    change(screen.getByLabelText("adminMiscRoutes.webStories.background"), "color");

    expect(screen.queryByLabelText("adminMiscRoutes.webStories.mediaUrlImage")).toBeNull();
    change(screen.getByLabelText("bg-color"), "#FA9346");
    await saveAndWaitForUpdate();

    expect(savedPages()[0]).toMatchObject({ background: "color", color: "#FA9346" });
  });

  it.each([
    ["2.5", 3],
    ["29.6", 30],
    ["1", 2],
    ["45", 30],
    ["", 6],
    ["12", 12],
  ])(
    "REGUŁA 6: czas planszy %j zapisuje się jako %i - całkowity, w granicach 2..30",
    async (typed, expected) => {
      // Regresja dla wartości ułamkowych: `StoryPageSchema` wymaga `int()`,
      // a `safeParsePages` przy jednej złej planszy oddaje PUSTĄ tablicę -
      // zapisane „2.5" znikało więc całą historię. Drugi `expect` jest tym,
      // co widzi czytelnik: zapisane plansze MUSZĄ przejść przez parser.
      await openEditor();
      change(screen.getByLabelText("adminMiscRoutes.webStories.duration"), typed);
      await saveAndWaitForUpdate();

      expect(savedPages()[0].duration_seconds).toBe(expected);
      expect(safeParsePages(savedPages())).toHaveLength(3);
    },
  );

  it("„w dół” przestawia planszę w ŁADUNKU, a edytor idzie za przesuniętą planszą", async () => {
    await openEditor();
    fireEvent.click(screen.getAllByRole("button", { name: "Down" })[0]);

    // Aktywna jest teraz ta sama plansza na nowej pozycji - pola nie mogą
    // przeskoczyć na planszę, która wjechała na jej miejsce.
    expect(screen.getByLabelText("adminMiscRoutes.webStories.titlePl")).toHaveValue("Plansza A");
    await saveAndWaitForUpdate();

    expect(savedPages().map((page) => page.id)).toEqual(["p2", "p1", "p3"]);
  });

  it("strzałki na KRAWĘDZI listy nie przestawiają niczego", async () => {
    await openEditor();
    fireEvent.click(screen.getAllByRole("button", { name: "Up" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Down" })[2]);
    await saveAndWaitForUpdate();

    expect(savedPages().map((page) => page.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("usunięcie planszy ŚRODKOWEJ usuwa TĘ planszę, nie ostatnią", async () => {
    await openEditor();
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[1]);
    await saveAndWaitForUpdate();

    expect(savedPages().map((page) => page.id)).toEqual(["p1", "p3"]);
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

  it("REGUŁA 4: usunięcie unieważnia OBA klucze - panelu i PUBLICZNY", async () => {
    // Regresja: `remove.onSuccess` unieważniał tylko `["admin", "web-stories"]`,
    // a `save.onSuccess` oba. Redakcja usuwała historię, panel pokazywał to
    // natychmiast, a publiczna lista w tej samej sesji dalej ją oferowała -
    // klik prowadził na `/web-stories/$slug`, którego wiersza już nie ma.
    // Dowód po STANIE cache'u, nie po argumentach wywołania: wpisy publiczne
    // (lista i pojedyncza historia) muszą wyjść z tego zapisu przeterminowane.
    const view = await mount();
    await screen.findByText("Szczyt w liczbach");
    view.queryClient.setQueryData(["web-stories", "latest", 8], [row()]);
    view.queryClient.setQueryData(["web-stories", "slug", "szczyt-w-liczbach"], row());
    const spy = vi.spyOn(view.queryClient, "invalidateQueries");
    fireEvent.click(button(/adminMiscRoutes\.webStories\.remove/));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminToasts.deleted"));
    expect(view.queryClient.getQueryState(["web-stories", "latest", 8])?.isInvalidated).toBe(true);
    expect(
      view.queryClient.getQueryState(["web-stories", "slug", "szczyt-w-liczbach"])?.isInvalidated,
    ).toBe(true);
    // Lista panelu ma aktywnego obserwatora, więc po unieważnieniu od razu się
    // dociąga (flaga wraca do `false`) - tu dowodem jest samo wywołanie.
    expect(spy).toHaveBeenCalledWith({ queryKey: ADMIN_KEY });
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
