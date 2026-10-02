// SEKCJE CV NA PUBLICZNYM PROFILU AUTORA (`/author/$slug`).
//
// CO DOWODZI TEN PLIK. Komponent zamienia pięć list z bazy na sekcje profilu -
// i każda decyzja po drodze jest widoczna dla czytelnika: czy sekcja w ogóle
// powstaje (pusta nie ma nagłówka), jak brzmi zakres dat („obecnie", kolejność),
// czy nagroda jest linkiem (tylko bezpieczny schemat), komu wolno poprzeć
// umiejętność i jak odmienia się licznik poparć. Asercje czytają napisy
// z PRAWDZIWEGO słownika (`@/test/i18nReal`), więc zniknięcie klucza oblewa test.
//
// CO JEST ZAATRAPOWANE: sesja (`useAuth`), warstwa poparć i statusów sieci
// kontaktów (mają własne testy), `sonner` oraz opcje zapytania CV - dane CV
// wkładamy wprost do cache react-query pod tym samym kluczem, którego używa
// komponent. Fabryka `react-i18next` jest synchroniczna i pusta w zależnościach
// (wzorzec z `ReputationLevelChip.test.tsx`), tłumacz wstrzykujemy po imporcie.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AuthorAward, AuthorCv, AuthorExperience } from "@/lib/queries/authorCv";
import type { CvPrintIdentity } from "@/components/author/CvPrintSheet";

interface ToggleVars {
  skillId: string;
  endorsed: boolean;
}

const h = vi.hoisted(() => ({
  lang: "pl" as "pl" | "en",
  fixedT: null as null | typeof realT,
  user: null as { id: string } | null,
  endorsements: [] as Array<{ skill_id: string; cnt: number; by_me: boolean }>,
  statuses: new Map<string, { status: string }>(),
  statusRequests: [] as string[][],
  pending: false,
  failWith: null as string | null,
  mutations: [] as Array<{ recipientId: string } & ToggleVars>,
  toasts: [] as string[],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.(h.lang), i18n: { language: h.lang }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));

vi.mock("@/lib/i18n/useLang", () => ({ useLang: () => h.lang }));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user }) }));

vi.mock("@/lib/network/useEndorsements", () => ({
  useSkillEndorsements: () => ({ data: h.endorsements }),
  useToggleEndorsement: (recipientId: string) => ({
    isPending: h.pending,
    mutate: (vars: ToggleVars, opts?: { onError?: (error: Error) => void }) => {
      h.mutations.push({ recipientId, ...vars });
      if (h.failWith !== null) opts?.onError?.(new Error(h.failWith));
    },
  }),
}));

vi.mock("@/lib/network/useConnections", () => ({
  useConnectionStatuses: (ids: ReadonlyArray<string>) => {
    h.statusRequests.push([...ids]);
    return { data: h.statuses };
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: (message: string) => {
      h.toasts.push(message);
    },
  },
}));

// Zapytanie, które nigdy się nie kończy: dane przychodzą z cache (patrz
// `renderCv`), a brak danych w cache to stan „jeszcze się wczytuje".
vi.mock("@/lib/queries/authorCv", () => ({
  authorCvQueryOptions: (userId: string | null | undefined) => ({
    queryKey: ["public", "author-cv", userId ?? "none"],
    queryFn: () => new Promise<never>(() => {}),
  }),
}));

import { realT } from "@/test/i18nReal";
import { AuthorCvSections } from "@/components/author/AuthorCvSections";

h.fixedT = realT;

const AUTHOR = "author-1";

function emptyCv(): AuthorCv {
  return { experiences: [], education: [], skills: [], awards: [], hobbies: [] };
}

function experience(over: Partial<AuthorExperience> = {}): AuthorExperience {
  return {
    id: "exp-1",
    role_title: "Analityczka",
    company: "NES",
    location: "Warszawa",
    start_date: "2019-05-01",
    end_date: "2021-01-15",
    is_current: false,
    description: "Bezpieczeństwo energetyczne",
    logo_url: null,
    ...over,
  };
}

function award(over: Partial<AuthorAward> = {}): AuthorAward {
  return {
    id: "aw-1",
    title: "Nagroda Roku",
    issuer: "Fundacja",
    awarded_at: null,
    description: null,
    icon: null,
    url: null,
    kind: null,
    ...over,
  };
}

function renderCv(
  cv: AuthorCv | null,
  opts: { userId?: string | null; printIdentity?: CvPrintIdentity } = {},
) {
  const userId = opts.userId === undefined ? AUTHOR : opts.userId;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  if (cv) client.setQueryData(["public", "author-cv", userId ?? "none"], cv);
  return render(
    <QueryClientProvider client={client}>
      <AuthorCvSections userId={userId} printIdentity={opts.printIdentity} />
    </QueryClientProvider>,
  );
}

const ORIGINAL_TZ = process.env.TZ;

beforeEach(() => {
  h.lang = "pl";
  h.user = null;
  h.endorsements = [];
  h.statuses = new Map();
  h.statusRequests.length = 0;
  h.pending = false;
  h.failWith = null;
  h.mutations.length = 0;
  h.toasts.length = 0;
});

afterEach(() => {
  cleanup();
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
  vi.restoreAllMocks();
});

describe("AuthorCvSections - kiedy CV w ogóle powstaje", () => {
  it("dopóki dane się wczytują, nie ma ani sekcji, ani przycisku PDF", () => {
    const { container } = renderCv(null, { printIdentity: { name: "Anna Nowak" } });
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("CV bez ani jednej pozycji nie pokazuje pustych nagłówków", () => {
    const { container } = renderCv(emptyCv(), { printIdentity: { name: "Anna Nowak" } });
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("heading")).toBeNull();
    expect(document.querySelector(".cv-print-sheet")).toBeNull();
  });

  it("renderuje WYŁĄCZNIE sekcje z danymi - bez pustej siatki umiejętności", () => {
    const { container } = renderCv({ ...emptyCv(), experiences: [experience()] });
    const section = container.querySelector("section");
    expect(screen.getAllByRole("heading", { level: 2 }).map((el) => el.textContent)).toEqual([
      "Doświadczenie zawodowe",
    ]);
    // Pusta siatka umiejętności/zainteresowań dokładała odstęp bez treści.
    expect(section?.children).toHaveLength(1);
  });
});

describe("AuthorCvSections - doświadczenie i edukacja", () => {
  it("pozycja doświadczenia: stanowisko, firma, zakres dat, miejsce i opis", () => {
    renderCv({
      ...emptyCv(),
      experiences: [experience({ logo_url: "https://cdn.example.com/nes.png" })],
    });
    const item = screen.getByRole("listitem");
    expect(within(item).getByRole("heading", { level: 3 })).toHaveTextContent("Analityczka");
    expect(item).toHaveTextContent("· NES");
    expect(item).toHaveTextContent("maj 2019 - sty 2021");
    expect(item).toHaveTextContent("Warszawa");
    expect(item).toHaveTextContent("Bezpieczeństwo energetyczne");
    // Logo jest ozdobą obok nazwy firmy - pusty alt, poza drzewem dostępności.
    expect(item.querySelector("img")).toHaveAttribute("src", "https://cdn.example.com/nes.png");
    expect(within(item).queryByRole("img")).toBeNull();
  });

  it("bieżące stanowisko kończy się na „obecnie”, nawet gdy w bazie została data końca", () => {
    renderCv({
      ...emptyCv(),
      experiences: [experience({ is_current: true, end_date: "2020-02-01" })],
    });
    const item = screen.getByRole("listitem");
    expect(item).toHaveTextContent("maj 2019 - obecnie");
    expect(item).not.toHaveTextContent("lut 2020");
  });

  it("odwrócone daty (koniec przed początkiem) czytają się chronologicznie", () => {
    renderCv({
      ...emptyCv(),
      experiences: [experience({ start_date: "2021-01-15", end_date: "2018-05-01" })],
    });
    const item = screen.getByRole("listitem");
    expect(item).toHaveTextContent("maj 2018 - sty 2021");
    expect(item).not.toHaveTextContent("sty 2021 - maj 2018");
  });

  it("brak stanowiska, firmy i miejsca: zapasowa etykieta i sama data", () => {
    renderCv({
      ...emptyCv(),
      experiences: [
        experience({
          role_title: null,
          company: null,
          location: null,
          description: null,
          start_date: "nie-data",
          end_date: "2020-07-01",
        }),
      ],
    });
    const item = screen.getByRole("listitem");
    expect(within(item).getByRole("heading", { level: 3 })).toHaveTextContent("Stanowisko");
    // Uszkodzona data początku znika, zamiast drukować „Invalid Date - …".
    expect(item.textContent).toBe("Stanowiskolip 2020");
  });

  it("edukacja: uczelnia, stopień · kierunek i zakres dat bez „obecnie”", () => {
    renderCv({
      ...emptyCv(),
      education: [
        {
          id: "edu-1",
          school: "Uniwersytet Warszawski",
          degree: "Magister",
          field: "Stosunki międzynarodowe",
          start_date: "2012-10-01",
          end_date: "2017-06-30",
          description: "Praca o NATO",
          logo_url: "https://cdn.example.com/uw.png",
        },
        {
          id: "edu-2",
          school: null,
          degree: null,
          field: "Ekonomia",
          start_date: null,
          end_date: null,
          description: null,
          logo_url: null,
        },
      ],
    });
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Edukacja");
    const [first, second] = screen.getAllByRole("article");
    expect(first).toHaveTextContent("Uniwersytet Warszawski");
    expect(first).toHaveTextContent("Magister · Stosunki międzynarodowe");
    expect(first).toHaveTextContent("paź 2012 - cze 2017");
    expect(first).toHaveTextContent("Praca o NATO");
    expect(within(second).getByRole("heading", { level: 3 })).toHaveTextContent("Uczelnia");
    expect(second.textContent).toBe("UczelniaEkonomia");
  });
});

describe("AuthorCvSections - umiejętności i poparcia", () => {
  const skills: AuthorCv["skills"] = [
    { id: "s1", label: "Analiza", level: 4, category: "Twarde" },
    { id: "s2", label: "Negocjacje", level: null, category: null },
    { id: "s3", label: "Mediacje", level: 0, category: "Twarde" },
  ];

  it("grupuje umiejętności po kategorii, a poziom podaje jako miernik 1-5", () => {
    renderCv({ ...emptyCv(), skills });
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Umiejętności");
    expect(screen.getByText("Twarde")).toBeInTheDocument();
    const meter = screen.getByRole("meter", { name: "Analiza 4/5" });
    expect(meter).toHaveAttribute("aria-valuenow", "4");
    expect(meter.querySelectorAll(".bg-brand")).toHaveLength(4);
    // Poziom null i 0 to „bez oceny" - bez miernika, nie „0/5".
    expect(screen.getAllByRole("meter")).toHaveLength(1);
  });

  it("kategoria nazwana „default” nie zderza się kluczem z grupą bez kategorii", () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    renderCv({
      ...emptyCv(),
      skills: [
        { id: "s1", label: "Bez kategorii", level: null, category: null },
        { id: "s2", label: "Z kategorią", level: null, category: "default" },
      ],
    });
    expect(screen.getByRole("button", { name: "Bez kategorii" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Z kategorią" })).toBeInTheDocument();
    expect(errors.filter((line) => line.includes("same key"))).toEqual([]);
  });

  it("gość widzi licznik poparć, ale przycisk jest nieaktywny i zaprasza do logowania", () => {
    h.endorsements = [{ skill_id: "s1", cnt: 2, by_me: false }];
    renderCv({ ...emptyCv(), skills });
    const chip = screen.getByRole("button", { name: /Analiza/ });
    expect(chip).toBeDisabled();
    expect(chip).toHaveAttribute("title", "Zaloguj się, aby poprzeć");
    expect(within(chip).getByLabelText("2 osoby poparły")).toHaveTextContent("2");
    // Gość nie pyta o status znajomości - to zapytanie wymaga sesji.
    expect(h.statusRequests.every((ids) => ids.length === 0)).toBe(true);
    fireEvent.click(chip);
    expect(h.mutations).toEqual([]);
  });

  it("licznik odmienia się po polsku także dla „many”", () => {
    h.endorsements = [{ skill_id: "s1", cnt: 5, by_me: false }];
    renderCv({ ...emptyCv(), skills });
    expect(screen.getByLabelText("5 osób poparło")).toHaveTextContent("5");
    expect(screen.queryByLabelText("5 osoby poparły")).toBeNull();
  });

  it("właściciel profilu nie może poprzeć własnej umiejętności i nie pyta o znajomość", () => {
    h.user = { id: AUTHOR };
    renderCv({ ...emptyCv(), skills });
    const chip = screen.getByRole("button", { name: /Analiza/ });
    expect(chip).toBeDisabled();
    expect(chip).toHaveAttribute("title", "Nie możesz poprzeć własnej umiejętności");
    expect(h.statusRequests.every((ids) => ids.length === 0)).toBe(true);
  });

  it("zalogowany bez połączenia dostaje wyjaśnienie zamiast aktywnego przycisku", () => {
    h.user = { id: "reader-1" };
    h.statuses = new Map([[AUTHOR, { status: "pending_out" }]]);
    renderCv({ ...emptyCv(), skills });
    const chip = screen.getByRole("button", { name: /Analiza/ });
    expect(chip).toBeDisabled();
    expect(chip).toHaveAttribute("title", "Aby poprzeć, musisz być połączony w sieci kontaktów");
    expect(h.statusRequests).toContainEqual([AUTHOR]);
  });

  it("połączony czytelnik popiera umiejętność, a cudze poparcie przełącza na cofnięcie", () => {
    h.user = { id: "reader-1" };
    h.statuses = new Map([[AUTHOR, { status: "connected" }]]);
    h.endorsements = [{ skill_id: "s2", cnt: 1, by_me: true }];
    renderCv({ ...emptyCv(), skills });

    const add = screen.getByRole("button", { name: /Analiza/ });
    expect(add).toHaveAttribute("title", "Poprzyj tę umiejętność");
    expect(add).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(add);

    const remove = screen.getByRole("button", { name: /Negocjacje/ });
    expect(remove).toHaveAttribute("title", "Cofnij poparcie");
    expect(remove).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(remove);

    expect(h.mutations).toEqual([
      { recipientId: AUTHOR, skillId: "s1", endorsed: false },
      { recipientId: AUTHOR, skillId: "s2", endorsed: true },
    ]);
  });

  it("odmowa zapisu poparcia melduje się komunikatem z błędu", () => {
    h.user = { id: "reader-1" };
    h.statuses = new Map([[AUTHOR, { status: "connected" }]]);
    h.failWith = "Brak znajomości";
    renderCv({ ...emptyCv(), skills });
    fireEvent.click(screen.getByRole("button", { name: /Analiza/ }));
    expect(h.toasts).toEqual(["Brak znajomości"]);
    expect(h.mutations).toHaveLength(1);
  });

  it("w trakcie zapisu przycisk jest zablokowany - bez podwójnego poparcia", () => {
    h.user = { id: "reader-1" };
    h.statuses = new Map([[AUTHOR, { status: "connected" }]]);
    h.pending = true;
    renderCv({ ...emptyCv(), skills });
    const chip = screen.getByRole("button", { name: /Analiza/ });
    expect(chip).toBeDisabled();
    fireEvent.click(chip);
    expect(h.mutations).toEqual([]);
  });

  it("profil bez identyfikatora autora nie przypisuje poparcia nikomu", () => {
    h.user = { id: "reader-1" };
    renderCv({ ...emptyCv(), skills }, { userId: null });
    const chip = screen.getByRole("button", { name: /Analiza/ });
    expect(chip).toBeDisabled();
    expect(chip).toHaveAttribute("title", "Aby poprzeć, musisz być połączony w sieci kontaktów");
    expect(h.statusRequests.every((ids) => ids.length === 0)).toBe(true);
  });
});

describe("AuthorCvSections - zainteresowania i wyróżnienia", () => {
  it("zainteresowania: etykieta z ikoną ukrytą przed czytnikiem ekranu", () => {
    renderCv({
      ...emptyCv(),
      hobbies: [
        { id: "h1", label: "Żeglarstwo", icon: "⛵" },
        { id: "h2", label: "Szachy", icon: null },
      ],
    });
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Zainteresowania");
    const sailing = screen.getByText("Żeglarstwo");
    expect(sailing.querySelector("[aria-hidden]")).toHaveTextContent("⛵");
    expect(screen.getByText("Szachy").querySelector("[aria-hidden]")).toBeNull();
  });

  it("nagroda z bezpiecznym adresem jest linkiem w nowej karcie", () => {
    renderCv({
      ...emptyCv(),
      awards: [award({ url: "https://example.org/nagroda", icon: "🏆", description: "Za raport" })],
    });
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "Wyróżnienia i certyfikaty",
    );
    const link = screen.getByRole("link", { name: /Nagroda Roku/ });
    expect(link).toHaveAttribute("href", "https://example.org/nagroda");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
    expect(link).toHaveTextContent("Fundacja");
    expect(link).toHaveTextContent("Za raport");
  });

  it("nagroda z adresem `javascript:` zostaje zwykłą kartą, nie linkiem", () => {
    renderCv({ ...emptyCv(), awards: [award({ url: "javascript:alert(1)" })] });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("article")).toHaveTextContent("Nagroda Roku");
  });

  it("data nagrody (kolumna DATE) nie cofa się o miesiąc w strefie na zachód od UTC", () => {
    process.env.TZ = "America/New_York";
    // Kanarek: bez jawnej strefy ta sama data w Nowym Jorku to jeszcze luty.
    expect(new Date("2020-03-01").toLocaleDateString("pl-PL", { month: "long" })).toBe("luty");
    renderCv({
      ...emptyCv(),
      awards: [award({ awarded_at: "2020-03-01" }), award({ id: "aw-2", awarded_at: "zła" })],
    });
    const [dated, broken] = screen.getAllByRole("article");
    expect(dated).toHaveTextContent("marzec 2020");
    expect(dated).not.toHaveTextContent("luty");
    // Uszkodzona data nie drukuje „Invalid Date" - po prostu jej nie ma.
    expect(broken.textContent).toBe("Nagroda RokuFundacja");
  });
});

describe("AuthorCvSections - eksport PDF i język", () => {
  it("z tożsamością autora pokazuje przycisk PDF i montuje arkusz wydruku w <body>", () => {
    const { container } = renderCv(
      { ...emptyCv(), hobbies: [{ id: "h1", label: "Szachy", icon: null }] },
      { printIdentity: { name: "Anna Nowak" } },
    );
    expect(within(container).getByRole("button", { name: "Pobierz CV (PDF)" })).toBeVisible();
    const sheet = document.body.querySelector(".cv-print-sheet");
    expect(sheet).not.toBeNull();
    expect(container.contains(sheet)).toBe(false);
  });

  it("bez tożsamości nie ma ani przycisku, ani arkusza (arkusz bez imienia jest bezużyteczny)", () => {
    renderCv({ ...emptyCv(), hobbies: [{ id: "h1", label: "Szachy", icon: null }] });
    expect(screen.queryByRole("button", { name: "Pobierz CV (PDF)" })).toBeNull();
    expect(document.body.querySelector(".cv-print-sheet")).toBeNull();
  });

  it("angielski profil: nagłówki, zapasowe etykiety, „present” i liczba pojedyncza poparć", () => {
    h.lang = "en";
    h.endorsements = [{ skill_id: "s1", cnt: 1, by_me: false }];
    renderCv({
      ...emptyCv(),
      experiences: [experience({ role_title: null, is_current: true })],
      skills: [{ id: "s1", label: "Analysis", level: null, category: null }],
    });
    expect(screen.getAllByRole("heading", { level: 2 }).map((el) => el.textContent)).toEqual([
      "Experience",
      "Skills",
    ]);
    expect(screen.getByRole("listitem")).toHaveTextContent("Role");
    expect(screen.getByRole("listitem")).toHaveTextContent("May 2019 - present");
    expect(screen.getByLabelText("1 endorsement")).toHaveTextContent("1");
  });
});
