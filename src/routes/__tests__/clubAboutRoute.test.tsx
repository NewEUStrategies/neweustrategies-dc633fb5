// `/club/$clubSlug/about` - warunki członkostwa, wejście, wyjście i cichy
// przełącznik powiadomień.
//
// CO TEN PLIK DOWODZI. Ta strona jest MIEJSCEM DECYZJI: człowiek poznaje tu
// warunki i albo składa prośbę, albo wychodzi z klubu, albo zmienia poziom
// powiadomień. Trzy z tych czynności są nieodwracalne albo trudno odwracalne,
// więc wartość testu leży w sklejeniu, którego czysta funkcja nie dosięga:
//
//   1. LOADER dogrzewa cache pod DOKŁADNIE tym kluczem, z którego czyta
//      komponent (`clubKeys.bySlug`), i NIE WYWALA trasy przy awarii RPC
//      (`.catch(() => null)`): poprawny link ma pokazać stronę, a nie ekran
//      błędu routera.
//   2. `head()` liczy indeksowalność Z WIDOCZNOŚCI KLUBU. Strona „o klubie"
//      jest wejściem z wyszukiwarki dla klubu publicznego i nie ma prawa
//      istnieć w indeksie dla klubu zamkniętego - wyciek nazwy usuwa się
//      z indeksu tygodniami.
//   3. TRZY STANY WCZYTYWANIA są rozłączne i to jest reguła, nie kosmetyka:
//      awaria RPC daje komunikat z ponowieniem (problem po naszej stronie),
//      zero wierszy daje „nie znaleziono" (klub zamknięty nie zdradza, że
//      istnieje), a dopiero karta klubu daje treść.
//   4. AKCJE WOŁAJĄ RPC Z IDENTYFIKATOREM TEGO klubu i tłumaczą wynik na
//      komunikat, który mówi PRAWDĘ: `pending` z `club_join` to prośba, nie
//      wejście, a kod odmowy ze słownika dostaje własne zdanie zamiast
//      surowego tekstu z Postgresa.
//   5. POZIOM POWIADOMIEŃ pokazuje TO, CO UŻYTKOWNIK MA USTAWIONE. Stał tu
//      literał „digest": człowiek ustawiał „wszystkie", dostawał zielony toast
//      i natychmiast widział z powrotem „skrót". Zapytanie o członkostwa jest
//      przy tym WYŁĄCZONE dla gościa - inaczej RPC dostaje ruch za funkcję,
//      której wynik i tak byłby pusty.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - REGUŁ WIDOKU: panel akcji, komplet warunków, widoczność akceptacji zasad,
//   klucze komunikatów i wybór wiersza członkostwa mają tabelę przypadków
//   w `src/lib/clubs/__tests__/aboutView.test.ts`. Tutaj dowodzimy, że trasa
//   ich UŻYWA i co robi z ich wynikiem.
// - REGUŁ NAGŁÓWKA: `clubHead.ts` (`isClubIndexable`, tytuł podrzędny) ma
//   własny zakres; asercje idą PRZECIW `buildClubHead` wywołanemu wprost.
// - MAPOWANIA KOMUNIKATU BAZY NA KOD: `toClubInviteError` ma
//   `inviteErrors.test.ts`.
// - MOLEKUŁ `ClubEnumSelect` i `ClubErrorNotice`: pierwsza jest tu atrapą na
//   natywnym `<select>` (bo Radix nie daje się kliknąć bez layoutu), druga
//   markerem z zapisem propsów. Ich zachowanie należy do etapu molekuł.
// - AUTORYTETU DOSTĘPU: `my_status`, `join_policy`, `rules_accepted_at`
//   pochodzą z SECURITY DEFINER RPC i mają pgTAP. Trasa je CZYTA.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";

/** Uchwyty, które atrapy mutacji wołają po zakończeniu żądania. */
interface MutationHandlers<TData> {
  onSuccess?: (data: TData) => void;
  onError?: (error: unknown) => void;
}

const h = vi.hoisted(() => ({
  /** Język interfejsu widziany przez `useTranslation`. */
  lang: "pl",
  session: null as { user: { id: string } } | null,
  /** Karta klubu z `useClubBySlug`; `null` = brak wiersza. */
  club: null as unknown,
  clubPending: false,
  clubError: false,
  refetch: vi.fn(),
  /** Slug, z jakim komponent zawołał zapytanie karty klubu. */
  clubQuerySlug: null as string | undefined | null,
  /** Odpowiedź `club_view` dla loadera. */
  loaded: null as unknown,
  loaderFails: false,
  fetchCalls: 0,
  /** Wiersze `club_my_memberships`; `undefined` = zapytanie w locie. */
  memberships: undefined as { club_id: string; notify_level: string }[] | undefined,
  /** Czy trasa włączyła zapytanie o członkostwa. */
  membershipsEnabled: null as boolean | null,
  /** Identyfikatory klubu podane hookom mutacji przy montowaniu. */
  rulesClubId: null as string | null,
  notifyClubId: null as string | null,
  joinCalls: [] as string[],
  leaveCalls: [] as string[],
  rulesCalls: 0,
  notifyCalls: [] as string[],
  /** Status oddawany przez `club_join` przy powodzeniu. */
  joinStatus: "active",
  joinError: null as unknown,
  leaveError: null as unknown,
  rulesError: null as unknown,
  notifyError: null as unknown,
  joinPending: false,
  leavePending: false,
  rulesPending: false,
  notifyPending: false,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  /** Propsy zapisane przez atrapę droplisty powiadomień. */
  enumSelect: null as Record<string, unknown> | null,
  /** Propsy zapisane przez atrapę komunikatu awarii. */
  errorNotice: null as Record<string, unknown> | null,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: h.session, user: h.session?.user ?? null, isStaff: false }),
}));
vi.mock("@/lib/clubs/publicClub", () => ({
  fetchClubBySlug: () => {
    h.fetchCalls += 1;
    if (h.loaderFails) return Promise.reject(new Error("club_view padło"));
    return Promise.resolve(h.loaded);
  },
}));
vi.mock("@/lib/clubs/useClubs", () => ({
  useClubBySlug: (slug: string | undefined) => {
    h.clubQuerySlug = slug;
    return {
      data: h.club,
      isPending: h.clubPending,
      isError: h.clubError,
      refetch: h.refetch,
    };
  },
  useMyClubMemberships: (enabled: boolean) => {
    h.membershipsEnabled = enabled;
    return { data: h.memberships };
  },
  useJoinClub: () => ({
    mutate: (clubId: string, handlers: MutationHandlers<string>) => {
      h.joinCalls.push(clubId);
      if (h.joinError !== null) handlers.onError?.(h.joinError);
      else handlers.onSuccess?.(h.joinStatus);
    },
    isPending: h.joinPending,
  }),
  useLeaveClub: () => ({
    mutate: (clubId: string, handlers: MutationHandlers<boolean>) => {
      h.leaveCalls.push(clubId);
      if (h.leaveError !== null) handlers.onError?.(h.leaveError);
      else handlers.onSuccess?.(true);
    },
    isPending: h.leavePending,
  }),
  useAcceptClubRules: (clubId: string) => {
    h.rulesClubId = clubId;
    return {
      mutate: (_vars: undefined, handlers: MutationHandlers<boolean>) => {
        h.rulesCalls += 1;
        if (h.rulesError !== null) handlers.onError?.(h.rulesError);
        else handlers.onSuccess?.(true);
      },
      isPending: h.rulesPending,
    };
  },
  useSetClubNotifyLevel: (clubId: string) => {
    h.notifyClubId = clubId;
    return {
      mutate: (level: string, handlers: MutationHandlers<boolean>) => {
        h.notifyCalls.push(level);
        if (h.notifyError !== null) handlers.onError?.(h.notifyError);
        else handlers.onSuccess?.(true);
      },
      isPending: h.notifyPending,
    };
  },
}));

// Atrapa na NATYWNYM `<select>`: droplista Radiksa otwiera się w portalu
// i wymaga layoutu, którego happy-dom nie ma. Przedmiotem dowodu jest to, co
// trasa robi z WYBRANĄ wartością - nie sposób jej wybrania.
vi.mock("@/components/clubs/molecules/ClubEnumSelect", () => ({
  ClubEnumSelect: ({
    id,
    label,
    value,
    options,
    i18nPrefix,
    onChange,
    disabled,
  }: {
    id?: string;
    label?: string;
    value: string;
    options: readonly string[];
    i18nPrefix: string;
    onChange: (value: string) => void;
    disabled?: boolean;
  }) => {
    h.enumSelect = { id, label, value, options, i18nPrefix, disabled };
    return (
      <select
        id={id}
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {`${i18nPrefix}.${option}`}
          </option>
        ))}
      </select>
    );
  },
}));

vi.mock("@/components/clubs/molecules/ClubErrorNotice", () => ({
  ClubErrorNotice: (props: Record<string, unknown>) => {
    h.errorNotice = props;
    return <div data-testid="ClubErrorNotice" />;
  },
}));

import { renderRoute, type RouteMetaEntry } from "@/test/routeHarness";
import { Route as AboutRoute } from "@/routes/club.$clubSlug.about";
import { buildClubHead, toClubHeadSource } from "@/lib/clubs/clubHead";
import { clubKeys } from "@/lib/clubs/queryKeys";
import { clubAboutAction, clubAboutTermKeys } from "@/lib/clubs/aboutView";
import { CLUB_NOTIFY_LEVELS } from "@/lib/clubs/types";
import { CLUB_BASE_ISO, CLUB_IDS, clubViewRow } from "@/test/clubs/fixtures";
import type { ClubViewRow } from "@/lib/clubs/types";

const PATH = "/club/$clubSlug/about";
const SLUG = "klub-energetyczny";

async function mount(slug: string = SLUG) {
  return renderRoute({ route: AboutRoute, path: PATH, initialEntry: `/club/${slug}/about` });
}

/** Wartość nagłówka `robots` z listy `meta`. */
function robotsOf(meta: readonly RouteMetaEntry[]): string | null {
  const entry = meta.find((item) => item.name === "robots");
  return typeof entry?.content === "string" ? entry.content : null;
}

/**
 * Karta klubu z NIEPRZYJĘTYMI zasadami.
 *
 * Osobna fabryka, bo generator typów Supabase wypuszcza `rules_accepted_at`
 * jako non-null (`RETURNS TABLE` nie deklaruje nullowalności), a baza realnie
 * zwraca tam NULL dla członka, który zasad jeszcze nie przyjął - i to jest
 * JEDYNY stan, w którym trasa o nie pyta. Zamiast rzutowania: obiekt składany
 * nad fixture'em, bo atrapa zapytania oddaje `unknown` i to trasa go czyta.
 */
function clubBezAkceptacjiZasad(overrides: Partial<ClubViewRow> = {}): unknown {
  return { ...clubViewRow(overrides), rules_accepted_at: null };
}

function button(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

/** Droplista powiadomień z atrapy molekuły. */
function notifySelect(): HTMLSelectElement {
  const node = screen.getByLabelText("club.notifyLevel");
  if (!(node instanceof HTMLSelectElement)) throw new Error("test: to nie jest droplista");
  return node;
}

beforeEach(() => {
  cleanup();
  h.lang = "pl";
  h.session = { user: { id: CLUB_IDS.me } };
  h.club = clubViewRow();
  h.clubPending = false;
  h.clubError = false;
  h.refetch.mockClear();
  h.clubQuerySlug = null;
  h.loaded = clubViewRow();
  h.loaderFails = false;
  h.fetchCalls = 0;
  h.memberships = [];
  h.membershipsEnabled = null;
  h.rulesClubId = null;
  h.notifyClubId = null;
  h.joinCalls = [];
  h.leaveCalls = [];
  h.rulesCalls = 0;
  h.notifyCalls = [];
  h.joinStatus = "active";
  h.joinError = null;
  h.leaveError = null;
  h.rulesError = null;
  h.notifyError = null;
  h.joinPending = false;
  h.leavePending = false;
  h.rulesPending = false;
  h.notifyPending = false;
  // Atrapa `sonner` trzyma REFERENCJE do tych funkcji od chwili załadowania
  // modułu, więc między testami wolno je wyłącznie czyścić - podmiana
  // odwiązałaby atrapę od uchwytu, który czyta asercja.
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
  h.enumSelect = null;
  h.errorNotice = null;
});

// --- loader ----------------------------------------------------------------

describe("loader - jedno żądanie, ten sam klucz co komponent", () => {
  it("dogrzewa cache pod `clubKeys.bySlug`", async () => {
    // Rozjazd klucza jest niewidoczny na ekranie: strona się rysuje, tylko
    // płaci drugim round-tripem do RPC przy każdym wejściu.
    const { queryClient } = await mount();
    expect(h.fetchCalls).toBe(1);
    expect(queryClient.getQueryData(clubKeys.bySlug(SLUG))).not.toBeUndefined();
  });

  it("czyta slug Z PARAMETRU, nie ze stałej", async () => {
    const { queryClient } = await mount("inny-klub");
    expect(queryClient.getQueryData(clubKeys.bySlug("inny-klub"))).not.toBeUndefined();
    expect(queryClient.getQueryData(clubKeys.bySlug(SLUG))).toBeUndefined();
  });

  it("awaria RPC NIE wywala trasy", async () => {
    h.loaderFails = true;
    const rendered = await mount();
    expect(rendered.currentPath()).toBe(`/club/${SLUG}/about`);
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
  });

  it("brak wiersza `club_view` też nie wywala trasy", async () => {
    h.loaded = null;
    const rendered = await mount();
    expect(rendered.currentPath()).toBe(`/club/${SLUG}/about`);
  });

  it("komponent pyta o kartę klubu TYM SAMYM slugiem", async () => {
    await mount("klub-trzeci");
    expect(h.clubQuerySlug).toBe("klub-trzeci");
  });
});

// --- nagłówek SEO ----------------------------------------------------------

describe("head() - indeksowalność z WIDOCZNOŚCI klubu", () => {
  it("zgadza się z `buildClubHead` na tych samych danych", async () => {
    const row = clubViewRow({ visibility: "public" });
    h.loaded = row;
    const rendered = await mount();
    const expected = buildClubHead({
      fallbackPath: `/club/${SLUG}/about`,
      club: toClubHeadSource(row),
    });
    expect(rendered.meta()).toEqual(expected.meta);
    expect(rendered.links()).toEqual(expected.links);
  });

  it("kanoniczny adres wskazuje NA TĘ podstronę, nie na kartę klubu", async () => {
    h.loaded = clubViewRow({ visibility: "public" });
    const rendered = await mount();
    const klubRoot = buildClubHead({
      fallbackPath: `/club/${SLUG}`,
      club: toClubHeadSource(clubViewRow({ visibility: "public" })),
    });
    expect(rendered.links()).not.toEqual(klubRoot.links);
  });

  it("klub `public` JEST indeksowalny - to wejście z wyszukiwarki", async () => {
    h.loaded = clubViewRow({ visibility: "public" });
    const rendered = await mount();
    expect(robotsOf(rendered.meta())).toBe("index, follow");
  });

  it.each(["members", "private", "secret"])(
    "klub `%s` nigdy nie jest indeksowalny",
    async (visibility) => {
      h.loaded = clubViewRow({ visibility });
      const rendered = await mount();
      expect(robotsOf(rendered.meta())).toBe("noindex, nofollow");
    },
  );

  it("awaria loadera schodzi na `noindex` - bezpieczny domysł", async () => {
    h.loaderFails = true;
    const rendered = await mount();
    expect(robotsOf(rendered.meta())).toBe("noindex, nofollow");
  });

  it("tytuł istnieje także wtedy, gdy loader milczy", async () => {
    h.loaded = null;
    const rendered = await mount();
    const title = rendered.meta().find((item) => typeof item.title === "string");
    expect(title?.title).not.toBe("");
    expect(title).toBeDefined();
  });
});

// --- trzy stany wczytywania -----------------------------------------------

describe("stany karty klubu - awaria, pustka, treść", () => {
  it("oczekiwanie pokazuje szkielet, a nie pustą stronę", async () => {
    h.clubPending = true;
    const { container } = await mount();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("awaria RPC pokazuje komunikat z ponowieniem, a NIE „nie znaleziono”", async () => {
    // Sklejenie tych dwóch stanów jest najczęstszą regresją: użytkownik
    // z poprawnym linkiem dowiaduje się wtedy, że klubu nie ma.
    h.clubError = true;
    await mount();
    expect(screen.getByTestId("ClubErrorNotice")).toBeTruthy();
    expect(screen.queryByText("club.reason.not_found")).toBeNull();
  });

  it("ponowienie z komunikatu awarii woła `refetch`", async () => {
    h.clubError = true;
    await mount();
    const retry = h.errorNotice?.onRetry;
    expect(typeof retry).toBe("function");
    if (typeof retry === "function") retry();
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it("zero wierszy pokazuje „nie znaleziono”, a nie ekran awarii", async () => {
    h.club = null;
    await mount();
    expect(screen.getByText("club.reason.not_found")).toBeTruthy();
    expect(screen.queryByTestId("ClubErrorNotice")).toBeNull();
  });

  it("oczekiwanie ma pierwszeństwo nad brakiem wiersza", async () => {
    h.clubPending = true;
    h.club = null;
    const { container } = await mount();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText("club.reason.not_found")).toBeNull();
  });

  it("karta klubu daje nagłówek z nazwą i drogę powrotną do klubu", async () => {
    h.club = clubViewRow({ name_pl: "Klub korytarzowy" });
    const { container } = await mount();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Klub korytarzowy");
    const back = container.querySelector("a");
    expect(back?.getAttribute("href")).toBe(`/club/${SLUG}`);
  });

  it("język interfejsu wybiera kolumnę nazwy i zasad", async () => {
    h.lang = "en";
    h.club = clubViewRow({
      name_pl: "Klub",
      name_en: "Club",
      rules_pl: "Zasady",
      rules_en: "Rules",
    });
    await mount();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Club");
    expect(screen.getByText("Rules")).toBeTruthy();
  });
});

// --- warunki członkostwa ---------------------------------------------------

describe("warunki członkostwa - komplet przed wejściem", () => {
  it("wypisuje DOKŁADNIE klucze z `clubAboutTermKeys`, w tej kolejności", async () => {
    const club = clubViewRow({
      visibility: "members",
      join_policy: "request",
      attribution_mode: "chatham",
      who_can_post: "moderators",
    });
    h.club = club;
    await mount();
    for (const key of clubAboutTermKeys(club)) {
      expect(screen.getByText(key)).toBeTruthy();
    }
  });

  it("opis klubu pokazuje się, gdy jest", async () => {
    h.club = clubViewRow({ description_pl: "Opis klubu", description_en: "" });
    await mount();
    expect(screen.getByText("Opis klubu")).toBeTruthy();
  });

  it("klub bez opisu nie zostawia pustego akapitu", async () => {
    // Warunek `description ? ... : null` - bez niego strona ma pustą dziurę
    // między odznakami a kartą zasad.
    h.club = clubViewRow({ description_pl: "", description_en: "", rules_pl: "Zasady" });
    const { container } = await mount();
    const puste = Array.from(container.querySelectorAll("p")).filter(
      (node) => (node.textContent ?? "").trim().length === 0,
    );
    expect(puste).toHaveLength(0);
  });

  it("zasady stoją w osobnej karcie z nagłówkiem", async () => {
    h.club = clubViewRow({ rules_pl: "Nie cytuj poza klubem" });
    await mount();
    expect(screen.getByText("club.rules")).toBeTruthy();
    expect(screen.getByText("Nie cytuj poza klubem")).toBeTruthy();
  });

  it("klub bez zasad nie pokazuje karty zasad ani prośby o akceptację", async () => {
    h.club = clubBezAkceptacjiZasad({ rules_pl: "", rules_en: "" });
    await mount();
    expect(screen.queryByText("club.rules")).toBeNull();
    expect(screen.queryByText("club.acceptRules")).toBeNull();
  });
});

// --- akceptacja zasad ------------------------------------------------------

describe("akceptacja zasad - tylko członek i tylko raz", () => {
  it("członek bez akceptacji dostaje przycisk i wysyła RPC dla TEGO klubu", async () => {
    h.club = clubBezAkceptacjiZasad({ my_status: "active" });
    await mount();
    expect(h.rulesClubId).toBe(CLUB_IDS.club);
    fireEvent.click(button("club.acceptRules"));
    expect(h.rulesCalls).toBe(1);
    expect(h.toastSuccess).toHaveBeenCalledWith("club.rulesAccepted");
  });

  it("odmowa zapisu akceptacji nazywa niepowodzenie", async () => {
    h.club = clubBezAkceptacjiZasad({ my_status: "active" });
    h.rulesError = new Error("42501");
    await mount();
    fireEvent.click(button("club.acceptRules"));
    expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed");
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("przycisk jest zablokowany w czasie zapisu - żadnej podwójnej akceptacji", async () => {
    h.club = clubBezAkceptacjiZasad({ my_status: "active" });
    h.rulesPending = true;
    await mount();
    expect(button("club.acceptRules")).toBeDisabled();
  });

  it("członek, który już zaakceptował, nie jest pytany drugi raz", async () => {
    h.club = clubViewRow({ my_status: "active", rules_accepted_at: CLUB_BASE_ISO });
    await mount();
    expect(screen.queryByText("club.acceptRules")).toBeNull();
  });

  it("nie-członek nie dostaje przycisku akceptacji cudzych zasad", async () => {
    h.club = clubBezAkceptacjiZasad({ my_status: "pending" });
    await mount();
    expect(screen.getByText("club.rules")).toBeTruthy();
    expect(screen.queryByText("club.acceptRules")).toBeNull();
  });

  it("bez karty klubu hook mutacji dostaje pusty identyfikator, nie `undefined`", async () => {
    // `club?.id ?? ""` - hook liczy klucze unieważnień z identyfikatora, więc
    // `undefined` rozsypałoby tablicę klucza jeszcze przed kliknięciem.
    h.club = null;
    await mount();
    expect(h.rulesClubId).toBe("");
    expect(h.notifyClubId).toBe("");
  });
});

// --- panel akcji ----------------------------------------------------------

describe("panel akcji - gość, członek, klub na zaproszenie, wejście", () => {
  it("gość nie dostaje panelu akcji", async () => {
    // Dołączenie bez sesji kończy się odmową `auth_required` po stronie RPC.
    h.session = null;
    await mount();
    expect(screen.queryByText("club.join")).toBeNull();
    expect(screen.queryByText("club.requestJoin")).toBeNull();
    expect(screen.queryByText("club.leave")).toBeNull();
    expect(screen.queryByLabelText("club.notifyLevel")).toBeNull();
  });

  it("gość NIE pyta o listę członkostw", async () => {
    h.session = null;
    await mount();
    expect(h.membershipsEnabled).toBe(false);
  });

  it("zalogowany pyta o listę członkostw", async () => {
    await mount();
    expect(h.membershipsEnabled).toBe(true);
  });

  it("członek dostaje poziom powiadomień i wyjście z klubu", async () => {
    h.club = clubViewRow({ my_status: "active" });
    await mount();
    expect(notifySelect()).toBeTruthy();
    expect(button("club.leave")).toBeTruthy();
    expect(screen.queryByText("club.join")).toBeNull();
  });

  it("członek klubu `invite` widzi swój panel, nie zdanie o zaproszeniu", async () => {
    h.club = clubViewRow({ my_status: "active", join_policy: "invite" });
    await mount();
    expect(button("club.leave")).toBeTruthy();
    expect(screen.queryByText("adminClubs.invitations.error.invitation_required")).toBeNull();
  });

  it("klub `invite` mówi zdaniem, a nie martwym przyciskiem", async () => {
    h.club = clubViewRow({ my_status: "pending", join_policy: "invite" });
    await mount();
    expect(screen.getByText("adminClubs.invitations.error.invitation_required")).toBeTruthy();
    expect(screen.queryByText("club.requestJoin")).toBeNull();
    expect(screen.queryByText("club.join")).toBeNull();
  });

  it.each([
    { joinPolicy: "open", label: "club.join" },
    { joinPolicy: "request", label: "club.requestJoin" },
  ])("klub `$joinPolicy` obiecuje dokładnie to, co zrobi RPC", async ({ joinPolicy, label }) => {
    const club = clubViewRow({ my_status: "left", join_policy: joinPolicy });
    h.club = club;
    await mount();
    const action = clubAboutAction({
      signedIn: true,
      myStatus: club.my_status,
      joinPolicy: club.join_policy,
    });
    expect(action).toEqual({ kind: "join", labelKey: label });
    expect(button(label)).toBeTruthy();
  });
});

// --- wejście do klubu -----------------------------------------------------

describe("dołączenie - komunikat musi mówić prawdę o skutku", () => {
  it("wysyła identyfikator TEGO klubu", async () => {
    h.club = clubViewRow({ my_status: "left", join_policy: "open" });
    await mount();
    fireEvent.click(button("club.join"));
    expect(h.joinCalls).toEqual([CLUB_IDS.club]);
  });

  it("`active` z RPC ogłasza wejście", async () => {
    h.club = clubViewRow({ my_status: "left", join_policy: "open" });
    h.joinStatus = "active";
    await mount();
    fireEvent.click(button("club.join"));
    expect(h.toastSuccess).toHaveBeenCalledWith("club.joined");
  });

  it("`pending` z RPC ogłasza PROŚBĘ, nie wejście", async () => {
    // Klub z zatwierdzaniem zgłasza prośbę - komunikat „dołączono" wysyłałby
    // człowieka do klubu, który zaraz pokaże mu bramkę „nie jesteś członkiem".
    h.club = clubViewRow({ my_status: "left", join_policy: "request" });
    h.joinStatus = "pending";
    await mount();
    fireEvent.click(button("club.requestJoin"));
    expect(h.toastSuccess).toHaveBeenCalledWith("club.joinRequested");
  });

  it("kod odmowy ze słownika dostaje własne zdanie", async () => {
    h.club = clubViewRow({ my_status: "left", join_policy: "request" });
    h.joinError = new Error("clubs: user is banned from this club");
    await mount();
    fireEvent.click(button("club.requestJoin"));
    expect(h.toastError).toHaveBeenCalledWith("adminClubs.invitations.error.banned");
  });

  it("wyjątek bez rozpoznanego kodu degraduje się do ogólnego komunikatu", async () => {
    h.club = clubViewRow({ my_status: "left", join_policy: "open" });
    h.joinError = new Error("połączenie zerwane");
    await mount();
    fireEvent.click(button("club.join"));
    expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed");
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("przycisk jest zablokowany w czasie żądania", async () => {
    h.club = clubViewRow({ my_status: "left", join_policy: "open" });
    h.joinPending = true;
    await mount();
    expect(button("club.join")).toBeDisabled();
  });
});

// --- wyjście z klubu ------------------------------------------------------

describe("wyjście z klubu", () => {
  it("wysyła identyfikator klubu i potwierdza wyjście", async () => {
    h.club = clubViewRow({ my_status: "active" });
    await mount();
    fireEvent.click(button("club.leave"));
    expect(h.leaveCalls).toEqual([CLUB_IDS.club]);
    expect(h.toastSuccess).toHaveBeenCalledWith("club.leftClub");
  });

  it("odmowa nazywa niepowodzenie zapisu", async () => {
    h.club = clubViewRow({ my_status: "active" });
    h.leaveError = new Error("42501");
    await mount();
    fireEvent.click(button("club.leave"));
    expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed");
  });

  it("przycisk jest zablokowany w czasie żądania", async () => {
    h.club = clubViewRow({ my_status: "active" });
    h.leavePending = true;
    await mount();
    expect(button("club.leave")).toBeDisabled();
  });
});

// --- poziom powiadomień ---------------------------------------------------

describe("poziom powiadomień - pokazuje TO, co użytkownik ma ustawione", () => {
  it("czyta poziom z MOJEGO wiersza członkostwa", async () => {
    h.club = clubViewRow({ my_status: "active" });
    h.memberships = [{ club_id: CLUB_IDS.club, notify_level: "mentions" }];
    await mount();
    expect(notifySelect().value).toBe("mentions");
  });

  it("wiersz INNEGO klubu nie ustawia tej kontrolki", async () => {
    // To był defekt: kontrolka miała literał „digest" i pokazywała go każdemu.
    h.club = clubViewRow({ my_status: "active" });
    h.memberships = [{ club_id: CLUB_IDS.otherClub, notify_level: "none" }];
    await mount();
    expect(notifySelect().value).toBe("digest");
  });

  it("lista członkostw W LOCIE nie wywraca kontrolki", async () => {
    h.club = clubViewRow({ my_status: "active" });
    h.memberships = undefined;
    await mount();
    expect(notifySelect().value).toBe("digest");
  });

  it("droplista dostaje CAŁY słownik poziomów i prefiks kluczy", async () => {
    h.club = clubViewRow({ my_status: "active" });
    await mount();
    expect(h.enumSelect?.options).toEqual(CLUB_NOTIFY_LEVELS);
    expect(h.enumSelect?.i18nPrefix).toBe("club.notify");
    expect(h.enumSelect?.label).toBe("club.notifyLevel");
  });

  it("zmiana poziomu wysyła WYBRANĄ wartość dla TEGO klubu i potwierdza zapis", async () => {
    h.club = clubViewRow({ my_status: "active" });
    h.memberships = [{ club_id: CLUB_IDS.club, notify_level: "digest" }];
    await mount();
    expect(h.notifyClubId).toBe(CLUB_IDS.club);
    fireEvent.change(notifySelect(), { target: { value: "all" } });
    expect(h.notifyCalls).toEqual(["all"]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.saved");
  });

  it("odmowa zapisu poziomu nazywa niepowodzenie", async () => {
    h.club = clubViewRow({ my_status: "active" });
    h.notifyError = new Error("42501");
    await mount();
    fireEvent.change(notifySelect(), { target: { value: "none" } });
    expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed");
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("droplista jest zablokowana w czasie zapisu", async () => {
    h.club = clubViewRow({ my_status: "active" });
    h.notifyPending = true;
    await mount();
    expect(notifySelect()).toBeDisabled();
  });
});
