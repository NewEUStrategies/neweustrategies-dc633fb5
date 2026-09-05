// Trasa /club/$clubSlug/new - kompozytor nowego tematu klubowego.
//
// CO TEN PLIK DOWODZI. Formularz, w którym ludzie piszą NAJDŁUŻSZE teksty
// w całym serwisie (do 20 000 znaków), więc każda pomyłka kosztuje tu autora
// całą pracę, a nie jedno kliknięcie. Dowodzimy warstwa po warstwie, od
// kontraktu adresu do payloadu wysyłki:
//
//   1. `validateSearch` - kontrakt LINKU wklejanego do maila i generowanego
//      przez kompozytor na hubie („Zadaj pytanie”, „Zajmij stanowisko”,
//      „Napisz w tym dziale”). Wartość złego typu ani spoza słownika nie ma
//      prawa wywrócić formularza - degraduje do wartości domyślnej.
//   2. BRAMKA - kto widzi formularz. `can_post_thread = false` pokazuje ODMOWĘ
//      z powodem z `club_view`, a nie pusty formularz, którego zapis odmówi.
//   3. SKLEJENIE Z ZAPYTANIAMI - co trasa wysyła do RPC działów i co robi
//      z ich odpowiedzią: droplista bez działów, w których nie wolno pisać,
//      dział z adresu respektowany TYLKO gdy dozwolony, zapytanie w locie
//      (`data: undefined`) nie wywala renderu.
//   4. WIDOCZNOŚĆ PÓL zależna od rodzaju i od zasady autorstwa DZIAŁU:
//      przełącznik anonimowości tylko tam, gdzie RPC ją przyjmie, droplista
//      zaostrzenia tylko z realnym wyborem, przełącznik zamknięcia odpowiedzi
//      tylko dla moderacji.
//   5. PAYLOAD - najważniejsza asercja tego pliku: KSZTAŁT obiektu jadącego do
//      mutacji, z przycięciem pól, ikoną przez katalog, `lockReplies` tylko dla
//      moderatora i SUROWYM nadpisaniem atrybucji.
//   6. WYSYŁKA - puste pole wymagane NIE wysyła żądania, podwójne kliknięcie
//      nie wysyła dwa razy, klucz idempotencji jest jeden na CAŁĄ akcję (także
//      przy ponowieniu po błędzie), sukces unieważnia klucze karty klubu
//      i nawiguje we WŁAŚCIWE miejsce (premoderacja NIE prowadzi do wątku),
//      a błąd API pokazuje KLUCZ i18n, nigdy surowego tekstu z Postgresa.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - REGUŁ kompozytora: `newThreadForm.ts` ma własną tabelę przypadków
//   (`src/lib/clubs/__tests__/newThreadForm.test.ts`) - progi pól,
//   dziedziczenie atrybucji, dozwolone zaostrzenia, deskryptor widoczności,
//   złożenie payloadu i wynik publikacji. Tutaj dowodzimy, że trasa je WOŁA
//   i RESPEKTUJE ich wynik.
// - ZESTAWU UNIEWAŻNIANYCH KLUCZY: `clubCardKeys` ma test w
//   `clubInvalidations.test.ts`, więc importujemy je stamtąd zamiast
//   przepisywać tablice kluczy w asercji.
// - AUTOZAPISU SZKICU: `useThreadDraft` ma własny test (localStorage, wygasanie,
//   debounce). Tutaj hook jest atrapą, bo przedmiotem dowodu jest to, co trasa
//   robi ze szkicem: wznawia pola, kasuje kopię po publikacji.
// - MAPOWANIA na argumenty RPC (`p_group_id`, `p_lock_replies`, ...): to jest
//   `api.test.ts` i pgTAP. Tutaj kończymy na argumencie mutacji.
// - MOLEKUŁ `ClubTopicSelect`, `ClubIconPicker`, `ClubAnchorPicker`
//   i `MentionTextarea`: to atrapy sterowane z testu, bo ich zachowanie należy
//   do etapu molekuł. Liczy się to, co trasa robi z ich wartością.
// - AUTORYTETU: `can_post_thread`, `can_moderate` i `attribution_mode`
//   pochodzą z SECURITY DEFINER RPC i mają pgTAP. Trasa je czyta, nie liczy.
//
// DWIE GAŁĘZIE NIEDOBITE ŚWIADOMIE - i to nie jest luka w testach:
// - linia 287, `if (!formReady) return` w handlerze wysyłki: DEFENSYWNE
//   powtórzenie warunku, który już wyłącza przycisk. Nie ma w tej trasie
//   elementu `<form>`, więc nie istnieje zdarzenie `submit`, a `onClick`
//   wyłączonego przycisku nie odpala się ani myszą, ani klawiaturą. Gałąź jest
//   warta swojej ceny (chroni handler przed wywołaniem z innego miejsca), tylko
//   nie da się jej dosięgnąć bez zmiany zachowania produkcyjnego.
// - linia 406, `if (draft.restored === null) return` w przycisku wznowienia:
//   ten przycisk RENDERUJE SIĘ wyłącznie wtedy, gdy szkic istnieje, a szkic nie
//   znika między renderem a kliknięciem (zniknięcie zabiera cały pasek razem
//   z przyciskiem). Warunek jest tu po to, żeby domknięcie nie czytało `null`,
//   gdyby pasek kiedyś przestał być jedynym wywołaniem.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { CreateThreadResult } from "@/lib/clubs/api";
import type { CreateThreadVars } from "@/lib/clubs/useClubThreadsData";
import type { ClubAnchorValue } from "@/components/clubs/molecules/ClubAnchorPicker";

const h = vi.hoisted(() => ({
  /** Karta klubu oddawana i loaderowi, i zapytaniu (`null` = RPC bez wiersza). */
  club: null as unknown,
  /** Loader pada - cache zostaje pusty, więc zapytanie idzie po dane samo. */
  loaderFails: false,
  /** Zapytanie o klub nigdy się nie kończy - stan `isPending`. */
  clubHangs: false,
  groups: [] as unknown[],
  /** Zapytanie o działy w locie: `data` jeszcze nie istnieje. */
  groupsHang: false,
  /** Identyfikator klubu, z jakim trasa poprosiła o autozapis szkicu. */
  draftClubId: undefined as string | undefined,
  draftRestored: null as { title: string; body: string; savedAt: number } | null,
  draftSavedAt: null as number | null,
  draftDiscard: vi.fn(),
  draftClear: vi.fn(),
  create: vi.fn<(vars: CreateThreadVars) => Promise<CreateThreadResult>>(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  /** Ile razy powstał klucz idempotencji - dowód „per AKCJA, nie per render”. */
  idempotencyCalls: 0,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: () => undefined }));
// Sesja rozstrzygnięta - bez tego kompozytor nigdy nie schodzi ze szkieletu.
// `useClubBySlug` wstrzymuje zapytanie o kartę, dopóki `useAuth().loading`
// jest prawdą (klucz karty niesie WIDZA), a domyślny kontekst haka - bez
// providera w drzewie testu - mówi „sesja w locie” bez końca. Widz jest
// anonimowy, bo autorytet (`can_post_thread`, `can_moderate`) i tak przychodzi
// z RPC `club_view`, a nie z sesji.
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
// Klucz idempotencji jest LOSOWY w produkcji, a jego wartość jest przedmiotem
// asercji (jeden klucz na akcję), więc atrapa liczy wywołania i numeruje klucze.
vi.mock("@/lib/http/idempotency", () => ({
  newIdempotencyKey: (command: string) => {
    h.idempotencyCalls += 1;
    return `${command}:test-${h.idempotencyCalls}`;
  },
}));
// Loader czyta klub osobnym modułem (chunk publicznej trasy), więc atrapa jest
// osobna - i pozwala oddzielić „loader padł” od „zapytanie w locie”.
vi.mock("@/lib/clubs/publicClub", () => ({
  fetchClubBySlug: () =>
    h.loaderFails ? Promise.reject(new Error("club_view padło")) : Promise.resolve(h.club),
}));
// Warstwa dostępu podmieniona na poziomie MODUŁU, nie klienta Supabase: hooki
// (a z nimi unieważnianie kluczy po mutacji) zostają PRAWDZIWE, a przedmiotem
// dowodu jest argument, który trasa wysyła.
vi.mock("@/lib/clubs/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/clubs/api")>()),
  fetchClubBySlug: () => (h.clubHangs ? new Promise(() => undefined) : Promise.resolve(h.club)),
  fetchClubGroups: () => (h.groupsHang ? new Promise(() => undefined) : Promise.resolve(h.groups)),
  createClubThread: h.create,
}));
vi.mock("@/lib/clubs/useThreadDraft", () => ({
  useThreadDraft: (clubId: string | undefined) => {
    h.draftClubId = clubId;
    return {
      restored: h.draftRestored,
      savedAt: h.draftSavedAt,
      discard: h.draftDiscard,
      clear: h.draftClear,
    };
  },
}));
// Radix Select nie działa pod happy-dom bez pełnego pointer API - primitywy
// zamieniamy na natywny `<select>`, w którym `id` wędruje z wyzwalacza na pole
// (tak samo, jak wiąże je `Label htmlFor`). Jedna atrapa obsługuje wszystkie
// trzy droplisty trasy oraz molekułę `ClubEnumSelect`, która zostaje PRAWDZIWA.
vi.mock("@/components/ui/select", async () => {
  const { Children, isValidElement } = await import("react");
  interface TriggerLike {
    readonly id?: string;
  }
  const triggerId = (children: ReactNode): string | undefined => {
    for (const child of Children.toArray(children)) {
      if (!isValidElement<TriggerLike>(child)) continue;
      if (typeof child.props.id === "string") return child.props.id;
    }
    return undefined;
  };
  return {
    Select: ({
      value,
      onValueChange,
      disabled,
      children,
    }: {
      value?: string;
      onValueChange?: (next: string) => void;
      disabled?: boolean;
      children?: ReactNode;
    }) => (
      <select
        id={triggerId(children)}
        value={value}
        disabled={disabled}
        onChange={(event) => onValueChange?.(event.target.value)}
      >
        {children}
      </select>
    ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
    SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
      <option value={value}>{children}</option>
    ),
  };
});
vi.mock("@/components/mentions/MentionTextarea", () => ({
  MentionTextarea: ({
    id,
    label,
    value,
    onChange,
    maxLength,
  }: {
    id?: string;
    label: string;
    value: string;
    onChange: (next: string) => void;
    maxLength?: number;
  }) => (
    <textarea
      id={id}
      aria-label={label}
      value={value}
      maxLength={maxLength}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
vi.mock("@/components/clubs/molecules/ClubTopicSelect", () => ({
  ClubTopicSelect: ({
    id,
    label,
    value,
    onChange,
    disabled,
  }: {
    id?: string;
    label?: string;
    value: string | null;
    onChange: (next: string | null) => void;
    disabled?: boolean;
  }) => (
    <select
      id={id}
      aria-label={label}
      disabled={disabled}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
    >
      <option value="" />
      <option value="energy" />
      <option value="digital" />
    </select>
  ),
}));
vi.mock("@/components/clubs/molecules/ClubIconPicker", () => ({
  ClubIconPicker: ({
    id,
    value,
    onChange,
    disabled,
  }: {
    id?: string;
    value: string | null;
    onChange: (next: string | null) => void;
    disabled?: boolean;
  }) => (
    <select
      id={id}
      aria-label="club.iconPicker.label"
      disabled={disabled}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
    >
      <option value="" />
      <option value="shield" />
      <option value="nie-ma-takiej-ikony" />
    </select>
  ),
}));
vi.mock("@/components/clubs/molecules/ClubAnchorPicker", () => ({
  ClubAnchorPicker: ({
    value,
    onChange,
    disabled,
  }: {
    value: ClubAnchorValue | null;
    onChange: (next: ClubAnchorValue | null) => void;
    disabled?: boolean;
  }) => (
    <div>
      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          onChange({ anchorType: "eu_policy_item", anchorId: "pol-1", label: "Akt prawny" })
        }
      >
        anchor-set
      </button>
      <button type="button" onClick={() => onChange(null)}>
        anchor-clear
      </button>
      <span data-testid="anchor-label">{value?.label ?? ""}</span>
    </div>
  ),
}));

import { renderRoute, routeSearchValidator, type RouteMetaEntry } from "@/test/routeHarness";
import { buildClubHead, toClubHeadSource } from "@/lib/clubs/clubHead";
import { clubCardKeys } from "@/lib/clubs/clubInvalidations";
import { formatDateTime } from "@/lib/i18n/format";
import { CLUB_IDS, clubGroupRow, clubIsoOffset, clubViewRow } from "@/test/clubs/fixtures";
import { Route as NewThreadRoute } from "@/routes/club.$clubSlug.new";

const SLUG = "klub-energetyczny";
const PATH = "/club/$clubSlug/new";
const ENTRY = `/club/${SLUG}/new`;
const OTHER_GROUP = CLUB_IDS.otherGroup;

/** Znacznik czasu szkicu - stały (pół godziny przed bazą fixture'ów), bo
 *  asercja nie ma prawa zależeć od zegara maszyny. */
const DRAFT_STAMP = Date.parse(clubIsoOffset(-30));

/** Montaż BEZ czekania na dane - dla dowodów, w których zapytanie ma ZOSTAĆ
 *  w locie (szkielet, działy w locie) albo skończyć się odmową. */
async function mountRaw(entry: string = ENTRY) {
  return renderRoute({ route: NewThreadRoute, path: PATH, initialEntry: entry });
}

/**
 * Montaż plus czekanie, aż kompozytor ma KOMPLET danych.
 *
 * Karta klubu jedzie kluczem WIDZA (`clubKeys.bySlugViewer`), więc wpis
 * odłożony przez loader jej nie karmi - zapytanie o klub startuje dopiero po
 * montażu, a droplista działów czeka jeszcze na `club.id`. Obie warstwy domyka
 * jeden warunek: wypełniony wybór działu. To on odblokowuje publikację, więc
 * test, który go nie doczeka, oglądałby szkielet albo formularz bez adresata.
 */
async function mount(entry: string = ENTRY) {
  const rendered = await mountRaw(entry);
  await waitFor(() => {
    expect(selectByLabel("club.group").value).not.toBe("");
  });
  return rendered;
}

function titleField(): HTMLElement {
  return screen.getByLabelText("club.threadTitle");
}

function bodyField(): HTMLElement {
  return screen.getByLabelText("club.threadBody");
}

function publishButton(): HTMLElement {
  return screen.getByRole("button", { name: "club.publishThread" });
}

function selectByLabel(label: string): HTMLSelectElement {
  const node = screen.getByLabelText(label);
  if (!(node instanceof HTMLSelectElement)) throw new Error(`test: ${label} nie jest dropListą`);
  return node;
}

function optionValues(select: HTMLSelectElement): string[] {
  return Array.from(select.querySelectorAll("option")).map((option) => option.value);
}

/** Minimum, które przechodzi progi tytułu i treści. */
function fillValidText(): void {
  fireEvent.change(titleField(), { target: { value: "  Korytarz północ-południe  " } });
  fireEvent.change(bodyField(), {
    target: { value: "  Treść tematu, która przechodzi próg dziesięciu znaków.  " },
  });
}

function lastPayload(): CreateThreadVars {
  const call = h.create.mock.calls.at(-1);
  if (call === undefined) throw new Error("test: mutacja nie została wywołana");
  return call[0];
}

function robotsOf(meta: readonly RouteMetaEntry[]): string | null {
  const entry = meta.find((item) => item.name === "robots");
  return typeof entry?.content === "string" ? entry.content : null;
}

beforeEach(() => {
  cleanup();
  h.club = clubViewRow({ can_post_thread: true, can_moderate: false });
  h.loaderFails = false;
  h.clubHangs = false;
  h.groups = [clubGroupRow()];
  h.groupsHang = false;
  h.draftClubId = undefined;
  h.draftRestored = null;
  h.draftSavedAt = null;
  h.draftDiscard.mockReset();
  h.draftClear.mockReset();
  h.idempotencyCalls = 0;
  h.create
    .mockReset()
    .mockResolvedValue({ id: CLUB_IDS.thread, slug: "temat-pierwszy", status: "open" });
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

// --- 1. kontrakt adresu ----------------------------------------------------

describe("validateSearch - kontrakt linku z huba i z maila", () => {
  const validate = routeSearchValidator(NewThreadRoute);

  it("przepuszcza rodzaj wątku ze słownika", () => {
    expect(validate({ kind: "question" })).toEqual({ kind: "question" });
  });

  it("brak parametrów daje pusty obiekt, nie `undefined`", () => {
    // `search.kind ?? "discussion"` w komponencie musi mieć na czym stanąć.
    expect(validate({})).toEqual({});
  });

  it.each([
    ["liczba", { kind: 7 }],
    ["tablica", { kind: ["question"] }],
    ["null", { kind: null }],
    ["obiekt", { kind: { kind: "question" } }],
    ["wartość logiczna", { kind: true }],
  ])("rodzaj o złym typie (%s) jest ODRZUCANY", (_label, raw) => {
    expect(validate(raw)).toEqual({});
  });

  it("rodzaj spoza słownika jest odrzucany - CHECK w bazie zna zamkniętą listę", () => {
    expect(validate({ kind: "manifest" })).toEqual({});
  });

  it("przepuszcza dział z adresu", () => {
    expect(validate({ groupId: OTHER_GROUP })).toEqual({ groupId: OTHER_GROUP });
  });

  it.each([
    ["pusty napis", { groupId: "" }],
    ["liczba", { groupId: 12 }],
    ["null", { groupId: null }],
  ])("dział %s jest odrzucany", (_label, raw) => {
    expect(validate(raw)).toEqual({});
  });

  it("oba parametry razem przechodzą, a nadmiarowe są ODCINANE", () => {
    expect(
      validate({ kind: "position", groupId: OTHER_GROUP, utm_source: "newsletter", ref: "x" }),
    ).toEqual({ kind: "position", groupId: OTHER_GROUP });
  });

  it("identyfikator działu, którego nie ma, przechodzi walidację adresu", () => {
    // `validateSearch` nie zna listy działów (ta przychodzi z RPC), więc
    // martwy link degraduje do pierwszego dozwolonego działu, a nie do błędu.
    expect(validate({ groupId: "group-ktorego-nie-ma" })).toEqual({
      groupId: "group-ktorego-nie-ma",
    });
  });
});

describe("head - kompozytor jest powierzchnią CZYNNOŚCIOWĄ", () => {
  it("nagłówek zgadza się z `buildClubHead` z `forceNoindex`", async () => {
    const rendered = await mount();
    const expected = buildClubHead({
      fallbackPath: `/club/${SLUG}/new`,
      club: toClubHeadSource(clubViewRow({ can_post_thread: true, can_moderate: false })),
      forceNoindex: true,
    });
    expect(rendered.meta()).toEqual(expected.meta);
  });

  it("pusty formularz NIGDY nie wchodzi do indeksu - także w klubie publicznym", async () => {
    h.club = clubViewRow({ visibility: "public", can_post_thread: true });
    const rendered = await mount();
    expect(robotsOf(rendered.meta())).toBe("noindex, nofollow");
  });

  it("awaria loadera nie gubi nagłówka - tytuł istnieje bez danych klubu", async () => {
    h.loaderFails = true;
    const rendered = await mount();
    const title = rendered.meta().find((item) => typeof item.title === "string");
    expect(title).toBeDefined();
    expect(robotsOf(rendered.meta())).toBe("noindex, nofollow");
  });
});

// --- 2. bramka -------------------------------------------------------------

describe("bramka - kto widzi kompozytor", () => {
  it("wczytywanie klubu pokazuje szkielet, a nie pusty formularz", async () => {
    h.loaderFails = true;
    h.clubHangs = true;
    await mountRaw();
    expect(document.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "club.publishThread" })).toBeNull();
  });

  it("brak prawa do zakładania tematów pokazuje POWÓD z `club_view`", async () => {
    h.club = clubViewRow({ can_post_thread: false, reason: "tier_too_low" });
    await mountRaw();
    expect(await screen.findByText("club.reason.tier_too_low")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "club.publishThread" })).toBeNull();
    const back = screen.getByRole("link", { name: "club.backToClub" });
    expect(back.getAttribute("href")).toBe(`/club/${SLUG}`);
  });

  it("odmowa bez powodu degraduje do zdania ogólnego", async () => {
    h.club = clubViewRow({ can_post_thread: false, reason: "" });
    await mountRaw();
    expect(await screen.findByText("club.cannotPost")).toBeTruthy();
  });

  it("klub, którego RPC nie zwróciło, też kończy się odmową, a nie wyjątkiem", async () => {
    h.club = null;
    await mountRaw();
    expect(await screen.findByText("club.cannotPost")).toBeTruthy();
  });

  it("prawo do zakładania tematów pokazuje formularz", async () => {
    await mount();
    expect(publishButton()).toBeTruthy();
    expect(screen.getByText("club.newThread")).toBeTruthy();
  });
});

// --- 3. dział --------------------------------------------------------------

describe("droplista działów - tylko tam, gdzie wolno pisać", () => {
  it("dział bez prawa do zakładania tematu NIE stoi na dropliście", async () => {
    h.groups = [
      clubGroupRow({ id: "g-zamkniety", can_post_thread: false }),
      clubGroupRow({ id: OTHER_GROUP, can_post_thread: true }),
    ];
    await mount();
    await waitFor(() => {
      expect(selectByLabel("club.group").value).toBe(OTHER_GROUP);
    });
    expect(optionValues(selectByLabel("club.group"))).toEqual([OTHER_GROUP]);
  });

  it("dział z adresu obowiązuje, gdy wolno w nim pisać", async () => {
    h.groups = [clubGroupRow(), clubGroupRow({ id: OTHER_GROUP })];
    await mount(`${ENTRY}?groupId=${OTHER_GROUP}`);
    await waitFor(() => {
      expect(selectByLabel("club.group").value).toBe(OTHER_GROUP);
    });
  });

  it("dział z adresu, w którym pisać NIE WOLNO, spada na pierwszy dozwolony", async () => {
    // Inaczej link z huba prowadziłby do formularza, którego zapis odmówi -
    // po napisaniu całego tekstu.
    h.groups = [clubGroupRow(), clubGroupRow({ id: OTHER_GROUP, can_post_thread: false })];
    await mount(`${ENTRY}?groupId=${OTHER_GROUP}`);
    await waitFor(() => {
      expect(selectByLabel("club.group").value).toBe(CLUB_IDS.group);
    });
  });

  it("zapytanie o działy W LOCIE nie wywala renderu i blokuje publikację", async () => {
    // `groupsQ.data ?? []`: bez wybranego działu wysyłka nie ma adresata.
    h.groupsHang = true;
    await mountRaw();
    // Formularz staje na karcie klubu, a droplista działów zostaje pusta.
    await screen.findByRole("button", { name: "club.publishThread" });
    expect(optionValues(selectByLabel("club.group"))).toEqual([]);
    fillValidText();
    expect(publishButton()).toBeDisabled();
  });

  it("autozapis szkicu jest kluczowany KLUBEM, nie działem", async () => {
    await mount();
    await waitFor(() => {
      expect(h.draftClubId).toBe(CLUB_IDS.club);
    });
  });
});

// --- 4. rodzaj wątku -------------------------------------------------------

describe("rodzaj wątku - ogłoszenie wymaga moderacji", () => {
  it("zwykły członek nie dostaje `announcement` na dropliście", async () => {
    await mount();
    expect(optionValues(selectByLabel("club.kind.label"))).not.toContain("announcement");
  });

  it("moderator dostaje `announcement` i ostrzeżenie o przypięciu", async () => {
    h.club = clubViewRow({ can_post_thread: true, can_moderate: true });
    await mount(`${ENTRY}?kind=announcement`);
    expect(selectByLabel("club.kind.label").value).toBe("announcement");
    expect(screen.getByText("club.composer.announcementPinned")).toBeTruthy();
  });

  it("`?kind=announcement` bez uprawnienia degraduje do dyskusji", async () => {
    await mount(`${ENTRY}?kind=announcement`);
    await waitFor(() => {
      expect(selectByLabel("club.kind.label").value).toBe("discussion");
    });
    expect(screen.queryByText("club.composer.announcementPinned")).toBeNull();
  });

  it("`?kind=question` ustawia droplistę - inaczej skrót z huba byłby ozdobą", async () => {
    await mount(`${ENTRY}?kind=question`);
    expect(selectByLabel("club.kind.label").value).toBe("question");
  });

  it("ogłoszenie domyślnie zamyka odpowiedzi, ale decyzja moderatora ZOSTAJE", async () => {
    h.club = clubViewRow({ can_post_thread: true, can_moderate: true });
    await mount(`${ENTRY}?kind=announcement`);
    const lock = screen.getByRole("switch", { name: "club.composer.lockReplies" });
    expect(lock.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(lock);
    await waitFor(() => {
      expect(lock.getAttribute("aria-checked")).toBe("false");
    });
    // Zmiana rodzaju nie ma prawa cofnąć wyboru, którego ktoś już dotknął.
    fireEvent.change(selectByLabel("club.kind.label"), { target: { value: "discussion" } });
    fireEvent.change(selectByLabel("club.kind.label"), { target: { value: "announcement" } });
    await waitFor(() => {
      expect(selectByLabel("club.kind.label").value).toBe("announcement");
    });
    expect(
      screen
        .getByRole("switch", { name: "club.composer.lockReplies" })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("przełącznik zamknięcia odpowiedzi nie istnieje bez uprawnienia moderacyjnego", async () => {
    await mount();
    expect(screen.queryByRole("switch", { name: "club.composer.lockReplies" })).toBeNull();
  });
});

// --- 5. atrybucja ----------------------------------------------------------

describe("zasada autorstwa - dziedziczona z DZIAŁU, nie z klubu", () => {
  it("dział w regule Chatham House przykrywa ustawienie klubu", async () => {
    // To jest ten błąd: przełącznik anonimowości pojawiał się tam, gdzie RPC go
    // odrzuca, bo zasadę czytano z klubu.
    h.club = clubViewRow({ can_post_thread: true, attribution_mode: "anonymous_allowed" });
    h.groups = [clubGroupRow({ attribution_mode: "chatham" })];
    await mount();
    // Etykieta i podpowiedź muszą wejść W TYM SAMYM oczekiwaniu: sprawdzenie
    // podpowiedzi synchronicznie PO `waitFor` zakłada, że oba napisy trafiają
    // do DOM-u w jednym zatwierdzeniu Reacta - a przy obciążonej maszynie
    // drugi z nich potrafi dojść w kolejnym, co daje test migotliwy.
    await waitFor(() => {
      expect(screen.getByText("club.attribution.chatham")).toBeTruthy();
      expect(screen.getByText("club.attributionHint.chatham")).toBeTruthy();
    });
    expect(screen.queryByRole("switch", { name: "club.postAnonymously" })).toBeNull();
  });

  it("dział `anonymous_allowed` daje przełącznik anonimowości i JEDNO zaostrzenie", async () => {
    h.groups = [clubGroupRow({ attribution_mode: "anonymous_allowed" })];
    await mount();
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "club.postAnonymously" })).toBeTruthy();
    });
    expect(optionValues(selectByLabel("club.composer.participantAnonymity"))).toEqual([
      "inherit",
      "chatham",
    ]);
    expect(screen.getByText("club.composer.participantAnonymityHint")).toBeTruthy();
  });

  it("moderator dostaje CAŁY słownik zaostrzeń", async () => {
    h.club = clubViewRow({ can_post_thread: true, can_moderate: true });
    await mount();
    expect(optionValues(selectByLabel("club.composer.participantAnonymity"))).toEqual([
      "inherit",
      "attributed",
      "chatham",
      "anonymous_allowed",
    ]);
  });

  it("etykieta „dziedzicz” niesie nazwę zasady działu jako parametr", async () => {
    h.club = clubViewRow({ can_post_thread: true, can_moderate: true });
    h.groups = [clubGroupRow({ attribution_mode: "chatham" })];
    await mount();
    await waitFor(() => {
      expect(
        screen.getByText(
          "club.composer.participantAnonymityInherit(mode=club.attribution.chatham)",
        ),
      ).toBeTruthy();
    });
  });

  it("bez rozstrzygniętej zasady „dziedzicz” mówi wprost „podpisane”", async () => {
    h.club = clubViewRow({ can_post_thread: true, can_moderate: true, attribution_mode: "" });
    h.groups = [clubGroupRow({ attribution_mode: "" })];
    await mount();
    await waitFor(() => {
      expect(
        optionValues(selectByLabel("club.composer.participantAnonymity")).length,
      ).toBeGreaterThan(0);
    });
    const inherit = selectByLabel("club.composer.participantAnonymity").querySelector("option");
    expect(inherit?.textContent).toBe("club.attribution.attributed");
    // Zasada nieznana = nie ma czego pokazywać nad dropListą.
    expect(screen.queryByText("club.attributionHint.attributed")).toBeNull();
  });

  it("zaostrzenie do Chatham House zmienia PODPOWIEDŹ pod dropListą", async () => {
    h.groups = [clubGroupRow({ attribution_mode: "anonymous_allowed" })];
    await mount();
    await waitFor(() => {
      expect(screen.getByText("club.composer.participantAnonymityHint")).toBeTruthy();
    });
    fireEvent.change(selectByLabel("club.composer.participantAnonymity"), {
      target: { value: "chatham" },
    });
    await waitFor(() => {
      expect(screen.getByText("club.composer.participantAnonymityChatham")).toBeTruthy();
    });
  });

  it("zmiana działu ODBIERA prawo do anonimowości i gasi przełącznik", async () => {
    // Zostawiony włączony przełącznik kończyłby się odmową
    // 'clubs: anonymous posting disabled' po napisaniu całego tekstu.
    h.groups = [
      clubGroupRow({ attribution_mode: "anonymous_allowed" }),
      clubGroupRow({ id: OTHER_GROUP, attribution_mode: "chatham" }),
    ];
    await mount();
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "club.postAnonymously" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("switch", { name: "club.postAnonymously" }));
    await waitFor(() => {
      expect(
        screen.getByRole("switch", { name: "club.postAnonymously" }).getAttribute("aria-checked"),
      ).toBe("true");
    });
    fireEvent.change(selectByLabel("club.group"), { target: { value: OTHER_GROUP } });
    await waitFor(() => {
      expect(screen.queryByRole("switch", { name: "club.postAnonymously" })).toBeNull();
    });
    fillValidText();
    fireEvent.click(publishButton());
    await waitFor(() => {
      expect(h.create).toHaveBeenCalledTimes(1);
    });
    expect(lastPayload().anonymous).toBe(false);
  });

  it("zmiana działu unieważnia NADPISANIE, którego RPC już nie przyjmie", async () => {
    h.groups = [
      clubGroupRow({ attribution_mode: "anonymous_allowed" }),
      clubGroupRow({ id: OTHER_GROUP, attribution_mode: "chatham" }),
    ];
    await mount();
    await waitFor(() => {
      expect(selectByLabel("club.composer.participantAnonymity")).toBeTruthy();
    });
    fireEvent.change(selectByLabel("club.composer.participantAnonymity"), {
      target: { value: "chatham" },
    });
    fireEvent.change(selectByLabel("club.group"), { target: { value: OTHER_GROUP } });
    await waitFor(() => {
      // Dział już prowadzony w tej regule nie oferuje członkowi zaostrzeń.
      expect(screen.queryByLabelText("club.composer.participantAnonymity")).toBeNull();
    });
    fillValidText();
    fireEvent.click(publishButton());
    await waitFor(() => {
      expect(h.create).toHaveBeenCalledTimes(1);
    });
    expect(lastPayload().attributionMode).toBeNull();
  });

  it("wybór spoza słownika w dropliście wraca do dziedziczenia", async () => {
    h.club = clubViewRow({ can_post_thread: true, can_moderate: true });
    await mount();
    fireEvent.change(selectByLabel("club.composer.participantAnonymity"), {
      target: { value: "chatham" },
    });
    await waitFor(() => {
      expect(selectByLabel("club.composer.participantAnonymity").value).toBe("chatham");
    });
    fireEvent.change(selectByLabel("club.composer.participantAnonymity"), {
      target: { value: "inherit" },
    });
    await waitFor(() => {
      expect(selectByLabel("club.composer.participantAnonymity").value).toBe("inherit");
    });
  });
});

// --- 6. payload ------------------------------------------------------------

describe("payload mutacji - KSZTAŁT obiektu jadącego do `club_create_thread`", () => {
  it("komplet pól zwykłego członka", async () => {
    h.groups = [clubGroupRow({ attribution_mode: "anonymous_allowed" })];
    await mount(`${ENTRY}?kind=question`);
    await waitFor(() => {
      expect(selectByLabel("club.group").value).toBe(CLUB_IDS.group);
    });
    fillValidText();
    fireEvent.change(selectByLabel("club.topic.label"), { target: { value: "digital" } });
    fireEvent.change(selectByLabel("club.iconPicker.label"), { target: { value: "shield" } });
    fireEvent.click(screen.getByRole("button", { name: "anchor-set" }));
    fireEvent.click(screen.getByRole("switch", { name: "club.postAnonymously" }));
    fireEvent.click(publishButton());
    await waitFor(() => {
      expect(h.create).toHaveBeenCalledTimes(1);
    });
    expect(lastPayload()).toEqual({
      groupId: CLUB_IDS.group,
      title: "Korytarz północ-południe",
      body: "Treść tematu, która przechodzi próg dziesięciu znaków.",
      kind: "question",
      anonymous: true,
      anchorType: "eu_policy_item",
      anchorId: "pol-1",
      idempotencyKey: "club_create_thread:test-1",
      lockReplies: false,
      topic: "digital",
      icon: "shield",
      attributionMode: null,
    });
  });

  it("obszar tematyczny DZIEDZICZY klub, dopóki autor nie dotknie dropListy", async () => {
    h.club = clubViewRow({ can_post_thread: true, policy_area: "energy" });
    await mount();
    await waitFor(() => {
      expect(selectByLabel("club.topic.label").value).toBe("energy");
    });
    fillValidText();
    fireEvent.click(publishButton());
    await waitFor(() => {
      expect(lastPayload().topic).toBe("energy");
    });
  });

  it("wyczyszczenie obszaru przez autora ZOSTAJE - podpowiedź klubu go nie cofa", async () => {
    h.club = clubViewRow({ can_post_thread: true, policy_area: "energy" });
    await mount();
    await waitFor(() => {
      expect(selectByLabel("club.topic.label").value).toBe("energy");
    });
    fireEvent.change(selectByLabel("club.topic.label"), { target: { value: "" } });
    fillValidText();
    fireEvent.click(publishButton());
    await waitFor(() => {
      expect(h.create).toHaveBeenCalledTimes(1);
    });
    expect(lastPayload().topic).toBeNull();
  });

  it("ikona spoza katalogu jedzie jako `null`, a nie jako napis", async () => {
    await mount();
    fillValidText();
    fireEvent.change(selectByLabel("club.iconPicker.label"), {
      target: { value: "nie-ma-takiej-ikony" },
    });
    fireEvent.click(publishButton());
    await waitFor(() => {
      expect(h.create).toHaveBeenCalledTimes(1);
    });
    expect(lastPayload().icon).toBeNull();
  });

  it("odjęta kotwica jedzie jako dwa `null`", async () => {
    await mount();
    fillValidText();
    fireEvent.click(screen.getByRole("button", { name: "anchor-set" }));
    await waitFor(() => {
      expect(screen.getByTestId("anchor-label").textContent).toBe("Akt prawny");
    });
    fireEvent.click(screen.getByRole("button", { name: "anchor-clear" }));
    fireEvent.click(publishButton());
    await waitFor(() => {
      expect(h.create).toHaveBeenCalledTimes(1);
    });
    expect(lastPayload().anchorType).toBeNull();
    expect(lastPayload().anchorId).toBeNull();
  });

  it("moderator wysyła `lockReplies` i wybrane nadpisanie atrybucji", async () => {
    h.club = clubViewRow({ can_post_thread: true, can_moderate: true });
    await mount(`${ENTRY}?kind=announcement`);
    fillValidText();
    fireEvent.change(selectByLabel("club.composer.participantAnonymity"), {
      target: { value: "chatham" },
    });
    fireEvent.click(publishButton());
    await waitFor(() => {
      expect(h.create).toHaveBeenCalledTimes(1);
    });
    expect(lastPayload().lockReplies).toBe(true);
    expect(lastPayload().attributionMode).toBe("chatham");
    expect(lastPayload().kind).toBe("announcement");
  });

  it("pole treści niesie limit 20 000 znaków, a licznik idzie po PRZYCIĘTEJ długości", async () => {
    await mount();
    expect(bodyField().getAttribute("maxlength")).toBe("20000");
    expect(titleField().getAttribute("maxlength")).toBe("200");
    fireEvent.change(titleField(), { target: { value: "  abc  " } });
    expect(screen.getByText("3 / 200")).toBeTruthy();
  });
});

// --- 7. wysyłka ------------------------------------------------------------

describe("wysyłka - walidacja, idempotencja, unieważnienie, nawigacja", () => {
  it("puste pola wymagane NIE wysyłają żądania", async () => {
    await mount();
    expect(publishButton()).toBeDisabled();
    fireEvent.click(publishButton());
    expect(h.create).not.toHaveBeenCalled();
  });

  it.each([
    ["tytuł pod progiem", "abc", "Treść tematu dłuższa niż próg."],
    ["treść pod progiem", "Tytuł tematu", "krotka"],
    ["tytuł z samych spacji", "       ", "Treść tematu dłuższa niż próg."],
  ])("%s trzyma przycisk nieaktywny", async (_label, title, body) => {
    await mount();
    fireEvent.change(titleField(), { target: { value: title } });
    fireEvent.change(bodyField(), { target: { value: body } });
    expect(publishButton()).toBeDisabled();
    fireEvent.click(publishButton());
    expect(h.create).not.toHaveBeenCalled();
  });

  it("PODWÓJNE kliknięcie nie zakłada dwóch wątków", async () => {
    // Uchwyt w OBIEKCIE, nie w zmiennej: analiza przepływu TypeScriptu zawęża
    // `let x = null` do `null` i nie widzi przypisania z wnętrza wykonawcy.
    const held: { release: ((result: CreateThreadResult) => void) | null } = { release: null };
    h.create.mockImplementation(
      () =>
        new Promise<CreateThreadResult>((resolve) => {
          held.release = resolve;
        }),
    );
    await mount();
    fillValidText();
    fireEvent.click(publishButton());
    await waitFor(() => {
      expect(h.create).toHaveBeenCalledTimes(1);
    });
    expect(publishButton()).toBeDisabled();
    fireEvent.click(publishButton());
    fireEvent.click(publishButton());
    expect(h.create).toHaveBeenCalledTimes(1);
    if (held.release !== null) {
      held.release({ id: CLUB_IDS.thread, slug: "temat-pierwszy", status: "open" });
    }
    await waitFor(() => {
      expect(h.toastSuccess).toHaveBeenCalledWith("club.threadCreated");
    });
  });

  it("klucz idempotencji powstaje RAZ na wejście i przeżywa ponowienie po błędzie", async () => {
    h.create.mockRejectedValueOnce(new Error("23505: duplicate key value"));
    await mount();
    fillValidText();
    fireEvent.click(publishButton());
    await waitFor(() => {
      expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed");
    });
    fireEvent.click(publishButton());
    await waitFor(() => {
      expect(h.create).toHaveBeenCalledTimes(2);
    });
    const [first, second] = h.create.mock.calls;
    expect(first?.[0].idempotencyKey).toBe("club_create_thread:test-1");
    // TEN SAM klucz w retry - inaczej ponowienie zakłada drugi wątek.
    expect(second?.[0].idempotencyKey).toBe(first?.[0].idempotencyKey);
    expect(h.idempotencyCalls).toBe(1);
  });

  it("błąd API pokazuje KLUCZ i18n, nigdy surowego tekstu z Postgresa", async () => {
    h.create.mockRejectedValue(new Error("clubs: anonymous posting disabled"));
    await mount();
    fillValidText();
    fireEvent.click(publishButton());
    await waitFor(() => {
      expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed");
    });
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(screen.queryByText(/anonymous posting disabled/)).toBeNull();
    // Nieudana publikacja NIE kasuje szkicu - to jedyna kopia tekstu.
    expect(h.draftClear).not.toHaveBeenCalled();
  });

  it("sukces unieważnia klucze karty klubu, kasuje szkic i otwiera wątek", async () => {
    const rendered = await mount();
    const spy = vi.spyOn(rendered.queryClient, "invalidateQueries");
    fillValidText();
    fireEvent.click(publishButton());
    await waitFor(() => {
      expect(h.toastSuccess).toHaveBeenCalledWith("club.threadCreated");
    });
    for (const queryKey of clubCardKeys(CLUB_IDS.club)) {
      expect(spy).toHaveBeenCalledWith({ queryKey });
    }
    expect(h.draftClear).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(rendered.currentPath()).toBe(`/club/${SLUG}/t/temat-pierwszy`);
    });
  });

  it("wpis w premoderacji NIE prowadzi do wątku, tylko na listę klubu", async () => {
    h.create.mockResolvedValue({ id: CLUB_IDS.thread, slug: "temat-pierwszy", status: "pending" });
    const rendered = await mount();
    fillValidText();
    fireEvent.click(publishButton());
    await waitFor(() => {
      expect(h.toastSuccess).toHaveBeenCalledWith("club.threadPending");
    });
    await waitFor(() => {
      expect(rendered.currentPath()).toBe(`/club/${SLUG}`);
    });
    expect(h.toastSuccess).not.toHaveBeenCalledWith("club.threadCreated");
  });
});

// --- 8. szkic --------------------------------------------------------------

describe("szkic - pasek wznowienia i znacznik autozapisu", () => {
  it("zastany szkic proponuje wznowienie z DATĄ ostatniego zapisu", async () => {
    h.draftRestored = { title: "Zaczęty tytuł", body: "Zaczęta treść", savedAt: DRAFT_STAMP };
    await mount();
    expect(
      screen.getByText(`club.composer.draftFound(when=${formatDateTime(DRAFT_STAMP, "pl")})`),
    ).toBeTruthy();
  });

  it("wznowienie wypełnia OBA pola i chowa pasek", async () => {
    h.draftRestored = { title: "Zaczęty tytuł", body: "Zaczęta treść", savedAt: DRAFT_STAMP };
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "club.composer.draftRestore" }));
    expect((titleField() as HTMLInputElement).value).toBe("Zaczęty tytuł");
    expect((bodyField() as HTMLTextAreaElement).value).toBe("Zaczęta treść");
    expect(h.draftDiscard).toHaveBeenCalledTimes(1);
  });

  it("odrzucenie szkicu nie rusza pól - tekst w formularzu należy do autora", async () => {
    h.draftRestored = { title: "Zaczęty tytuł", body: "Zaczęta treść", savedAt: DRAFT_STAMP };
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "club.composer.draftDiscard" }));
    expect(h.draftDiscard).toHaveBeenCalledTimes(1);
    expect((titleField() as HTMLInputElement).value).toBe("");
  });

  it("brak szkicu nie rysuje paska wznowienia", async () => {
    await mount();
    expect(screen.queryByRole("button", { name: "club.composer.draftRestore" })).toBeNull();
  });

  it("autozapis MUSI być widoczny - inaczej jest funkcją, o której nikt nie wie", async () => {
    h.draftSavedAt = DRAFT_STAMP;
    await mount();
    expect(
      screen.getByText(`club.composer.draftSaved(when=${formatDateTime(DRAFT_STAMP, "pl")})`),
    ).toBeTruthy();
  });

  it("bez zapisu nie ma znacznika „zapisano”", async () => {
    await mount();
    expect(screen.queryByText(/club\.composer\.draftSaved/)).toBeNull();
  });
});

// --- 9. blokada pól w czasie wysyłki --------------------------------------

describe("wysyłka w toku - pola są odcięte", () => {
  it("wszystkie droplisty i pola tekstowe są nieaktywne, dopóki mutacja trwa", async () => {
    const held: { release: ((result: CreateThreadResult) => void) | null } = { release: null };
    h.create.mockImplementation(
      () =>
        new Promise<CreateThreadResult>((resolve) => {
          held.release = resolve;
        }),
    );
    h.club = clubViewRow({ can_post_thread: true, can_moderate: true });
    await mount();
    fillValidText();
    fireEvent.click(publishButton());
    await waitFor(() => {
      expect(h.create).toHaveBeenCalledTimes(1);
    });
    expect(titleField()).toBeDisabled();
    expect(selectByLabel("club.group")).toBeDisabled();
    expect(selectByLabel("club.kind.label")).toBeDisabled();
    expect(selectByLabel("club.topic.label")).toBeDisabled();
    expect(selectByLabel("club.iconPicker.label")).toBeDisabled();
    expect(screen.getByRole("button", { name: "anchor-set" })).toBeDisabled();
    if (held.release !== null) {
      held.release({ id: CLUB_IDS.thread, slug: "temat-pierwszy", status: "open" });
    }
    await waitFor(() => {
      expect(h.toastSuccess).toHaveBeenCalledWith("club.threadCreated");
    });
  });
});
