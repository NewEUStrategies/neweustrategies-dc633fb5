// Atomy testowe POWIERZCHNI PROFILU - atomic design zastosowany do testów,
// dokładnie jak w `src/test/chat/fixtures.ts` i `src/test/network/fixtures.ts`.
//
// DLACZEGO TO ISTNIEJE. Profil był po czacie najsłabiej pokrytą powierzchnią
// audytu (`src/lib/profile` 22%, `src/components/profile` 27,8%, piętnaście
// plików na okrągłym zerze), a koszt wejścia był ten sam, co przy czacie:
// warstwa danych profilu czyta i pisze przez ŁAŃCUCH PostgREST
// (`.from().select().eq().maybeSingle()`), do tego dochodzi Storage
// (podpisany URL uploadu + adres publiczny) i XMLHttpRequest w wysyłce
// avatara/okładki. Każdy test musiałby budować własne atrapy tych trzech
// światów. Ten moduł robi to raz.
//
// Świadomie BEZ JSX i bez importu komponentów - moduł jest wciągany także
// z wnętrza fabryk `vi.mock` (przez dynamiczny import, patrz
// `reactI18nextStub` w `src/test/reactStubs.ts`), więc musi być tani
// i wolny od side-effectów.
import type { ProfileCompletenessInput } from "@/lib/profile/completeness";
import type { PersonalityQuestion } from "@/lib/profile/personality";
import type { ProfileEditorRow } from "@/lib/profile/useProfileEditor";
import type { RawExposureRow } from "@/lib/profile/publicExposure";

// Atrapa łańcucha PostgREST jest wspólna dla wszystkich powierzchni (mieszka
// w `src/test/supabase/`) - re-eksport, żeby test profilu miał JEDEN
// import atomów, tak jak testy czatu i sieci.
export {
  fail,
  ok,
  okCount,
  pgError,
  supabaseFromStub,
  type PostgrestErrorLike,
  type RecordedCall,
  type RecordedChain,
  type SupabaseFromStub,
  type SupabaseResult,
  type TableResponder,
} from "@/test/supabase";

/**
 * Identyfikatory testowe. Tenant jest JAWNY, bo ścieżka uploadu do Storage
 * zaczyna się od `tenant_id` (`<tenant>/users/<uid>/avatar-...`) i to ona
 * odpowiada za izolację plików między kontami - testy uploadu odwołują się do
 * tych stałych, nie do literałów rozsypanych po plikach.
 */
export const PROFILE_IDS = {
  me: "user-me",
  other: "user-other",
  tenant: "tenant-alfa",
  foreignTenant: "tenant-beta",
  company: "company-1",
  otherCompany: "company-2",
} as const;

/** Stabilny znacznik czasu bazowy - testy liczą od niego, nie od `Date.now()`. */
export const BASE_ISO = "2026-08-18T10:00:00.000Z";

// --- wiersze bazy -----------------------------------------------------------

/**
 * Wiersz czytany przez `useProfileEditor`. Domyślnie profil UZUPEŁNIONY
 * i z tenantem, bo brak tenanta blokuje upload - test tej blokady zeruje pole
 * jawnie, żeby było widać, że o nią chodzi.
 */
export function profileEditorRow(overrides: Partial<ProfileEditorRow> = {}): ProfileEditorRow {
  return {
    display_name: "Anna Nowak",
    first_name: "Anna",
    last_name: "Nowak",
    job_title: "Head of EU Affairs",
    current_company: "New European Strategies",
    current_company_id: PROFILE_IDS.company,
    specialization: "Energia",
    location: "Bruksela",
    phone: "+32 2 000 00 00",
    bio: "Zajmuję się polityką energetyczną UE.",
    avatar_url: "https://cdn.example/avatar.jpg",
    cover_url: null,
    tenant_id: PROFILE_IDS.tenant,
    gender: "female",
    linkedin_url: "https://linkedin.com/in/anna",
    twitter_url: null,
    verified_at: null,
    ...overrides,
  };
}

/** Kolumny `profiles`, które czyta `useProfileIntent` (snake_case, jak z bazy). */
export interface ProfileIntentRow {
  avatar_url: string | null;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  current_company: string | null;
  location: string | null;
  specialization: string | null;
  bio_pl: string | null;
  bio_en: string | null;
  open_to: string[] | null;
  seeking_pl: string | null;
  seeking_en: string | null;
  offering_pl: string | null;
  offering_en: string | null;
  intent_updated_at: string | null;
  completeness_score: number | null;
}

/**
 * Wiersz warstwy intencji. Domyślnie profil PUSTY intencyjnie (bez `open_to`,
 * bez tekstów), bo to stan wyjściowy każdego konta - test zaliczenia pola
 * wypełnia je jawnie.
 */
export function profileIntentRow(overrides: Partial<ProfileIntentRow> = {}): ProfileIntentRow {
  return {
    avatar_url: null,
    display_name: "Anna Nowak",
    first_name: "Anna",
    last_name: "Nowak",
    job_title: null,
    current_company: null,
    location: null,
    specialization: null,
    bio_pl: null,
    bio_en: null,
    open_to: null,
    seeking_pl: null,
    seeking_en: null,
    offering_pl: null,
    offering_en: null,
    intent_updated_at: null,
    completeness_score: null,
    ...overrides,
  };
}

/** Wiersz RPC `get_my_public_exposure()` - domyślnie profil niepubliczny. */
export function exposureRow(overrides: Partial<RawExposureRow> = {}): RawExposureRow {
  return {
    is_public: false,
    discoverable: false,
    by_editorial_role: false,
    by_expert_badge: false,
    by_author_profile: false,
    by_speaker_profile: false,
    by_published_content: false,
    ...overrides,
  };
}

// --- kompletność profilu ----------------------------------------------------

/**
 * Wejście oceny kompletności dla profilu PUSTEGO (wynik 0). Testy dosypują
 * wyłącznie pole, którego dotyczą - dzięki temu z asercji widać, ILE punktów
 * daje dokładnie to pole, a nie „jakiś wynik”.
 */
export function emptyCompletenessInput(
  overrides: Partial<ProfileCompletenessInput> = {},
): ProfileCompletenessInput {
  return {
    avatar_url: null,
    display_name: null,
    first_name: null,
    last_name: null,
    job_title: null,
    current_company: null,
    location: null,
    specialization: null,
    bio_pl: null,
    bio_en: null,
    open_to: null,
    seeking_pl: null,
    seeking_en: null,
    skills: 0,
    experiences: 0,
    education: 0,
    ...overrides,
  };
}

/**
 * Wejście oceny dla profilu PEŁNEGO (wynik 100). Progi jakościowe są tu
 * spełnione z zapasem policzonym z definicji (`PROFILE_BIO_MIN`,
 * `PROFILE_SEEKING_MIN`), a nie „na oko” - test progu skraca pole jawnie.
 */
export function fullCompletenessInput(
  overrides: Partial<ProfileCompletenessInput> = {},
): ProfileCompletenessInput {
  return {
    avatar_url: "https://cdn.example/avatar.jpg",
    display_name: "Anna Nowak",
    first_name: "Anna",
    last_name: "Nowak",
    job_title: "Head of EU Affairs",
    current_company: "New European Strategies",
    location: "Bruksela",
    specialization: "Energia",
    bio_pl: text(140),
    bio_en: text(140),
    open_to: ["consortium"],
    seeking_pl: text(60),
    seeking_en: text(60),
    skills: 3,
    experiences: 1,
    education: 1,
    ...overrides,
  };
}

/** Napis o DOKŁADNEJ długości - progi bio/seeking liczą znaki, nie słowa. */
export function text(length: number): string {
  return "x".repeat(length);
}

// --- kwestionariusz osobowości ----------------------------------------------

/**
 * Zestaw pytań Big Five: `perAxis` pytań na każdą z pięciu osi, co drugie
 * odwrócone. Odwzorowuje seed migracji (6 pytań na oś, połowa odwrócona),
 * ale rozmiar jest parametrem, żeby test normalizacji mógł policzyć wynik
 * w głowie.
 */
export function personalityQuestions(perAxis = 6): PersonalityQuestion[] {
  const axes: PersonalityQuestion["axis"][] = [
    "openness",
    "conscientiousness",
    "extraversion",
    "agreeableness",
    "neuroticism",
  ];
  const out: PersonalityQuestion[] = [];
  let id = 1;
  for (const axis of axes) {
    for (let i = 0; i < perAxis; i += 1) {
      out.push({
        id,
        axis,
        reverse: i % 2 === 1,
        text_pl: `pytanie ${id}`,
        text_en: `question ${id}`,
        sort_order: id,
      });
      id += 1;
    }
  }
  return out;
}

/** Wszystkie pytania odpowiedziane tą samą wartością (1..5). */
export function answerAll(
  questions: ReadonlyArray<PersonalityQuestion>,
  value: number,
): Record<number, number> {
  return Object.fromEntries(questions.map((q) => [q.id, value]));
}

// --- Storage ----------------------------------------------------------------

export interface StorageStub {
  /** Podmienialny `supabase.storage` do wstrzyknięcia w atrapę klienta. */
  storage: { from: (bucket: string) => unknown };
  /** Kubełki, o które kod poprosił (upload avatara MUSI iść w „media”). */
  buckets: string[];
  /** Ścieżki, dla których podpisano URL uploadu - stąd izolacja tenanta. */
  signedPaths: string[];
  /** Ścieżki, dla których zapytano o adres publiczny. */
  publicPaths: string[];
  /** Wymuś błąd podpisu (kwota, brak grantu). */
  failSign(message: string): void;
  /**
   * Wymuś odrzucenie podpisu wartością, która NIE jest `Error` (tak wygląda
   * odrzucenie z warstwy transportowej). Kod uploadu ma wtedy podać komunikat
   * zapasowy, a nie `[object Object]`.
   */
  failSignWith(value: unknown): void;
  /** Odpowiedź bez błędu I bez danych - podpis „udany”, ale puste. */
  signWithoutData(): void;
  reset(): void;
}

/**
 * Atrapa Storage dla wysyłki avatara/okładki. Zapisuje ŚCIEŻKĘ, bo to ona
 * niesie stempel tenanta i id użytkownika - a nie sam fakt uploadu.
 */
export function storageStub(): StorageStub {
  const state = {
    buckets: [] as string[],
    signedPaths: [] as string[],
    publicPaths: [] as string[],
    signError: null as unknown,
    signErrorSet: false,
    signEmpty: false,
  };
  return {
    storage: {
      from: (bucket: string) => {
        state.buckets.push(bucket);
        return {
          createSignedUploadUrl: (path: string) => {
            state.signedPaths.push(path);
            if (state.signErrorSet) {
              return Promise.resolve({ data: null, error: state.signError });
            }
            if (state.signEmpty) {
              return Promise.resolve({ data: null, error: null });
            }
            return Promise.resolve({
              data: { signedUrl: `https://upload.example/${path}`, path, token: "t" },
              error: null,
            });
          },
          getPublicUrl: (path: string) => {
            state.publicPaths.push(path);
            return { data: { publicUrl: `https://cdn.example/${path}` } };
          },
        };
      },
    },
    get buckets() {
      return state.buckets;
    },
    get signedPaths() {
      return state.signedPaths;
    },
    get publicPaths() {
      return state.publicPaths;
    },
    failSign(message: string) {
      state.signError = new Error(message);
      state.signErrorSet = true;
    },
    failSignWith(value: unknown) {
      state.signError = value;
      state.signErrorSet = true;
    },
    signWithoutData() {
      state.signEmpty = true;
    },
    reset() {
      state.buckets.length = 0;
      state.signedPaths.length = 0;
      state.publicPaths.length = 0;
      state.signError = null;
      state.signErrorSet = false;
      state.signEmpty = false;
    },
  };
}

// --- XMLHttpRequest ---------------------------------------------------------

export interface XhrRecord {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface XhrStub {
  /** Żądania w kolejności wywołań. */
  requests: XhrRecord[];
  /** Zdejmij atrapę i przywróć oryginalny konstruktor. */
  restore(): void;
}

/**
 * Atrapa `XMLHttpRequest` dla uploadu przez podpisany URL. `happy-dom` nie
 * wykonuje realnych żądań, a kod produkcyjny czyta `status`, `upload.onprogress`
 * i `onerror` - atrapa musi więc odegrać CAŁY cykl, w tym postęp, bo inaczej
 * gałąź `lengthComputable` nigdy się nie wykonuje.
 *
 * `outcome` decyduje o zakończeniu: `status` kończy `onload` z podanym kodem
 * HTTP (200 = sukces, 500 = odrzucenie), `"error"` odpala `onerror` (awaria
 * sieci). Postęp jest emitowany PRZED zakończeniem; wpis `"unknown"` odgrywa
 * zdarzenie bez znanego rozmiaru (`lengthComputable: false`).
 */
export function xhrStub(
  outcome: number | "error" = 200,
  progress: ReadonlyArray<[number, number] | "unknown"> = [[50, 100]],
): XhrStub {
  const requests: XhrRecord[] = [];
  const original = globalThis.XMLHttpRequest;

  class FakeXhr {
    status = 0;
    upload: { onprogress: ((e: ProgressEventLike) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private record: XhrRecord = { method: "", url: "", headers: {}, body: null };

    open(method: string, url: string): void {
      this.record.method = method;
      this.record.url = url;
    }

    setRequestHeader(name: string, value: string): void {
      this.record.headers[name] = value;
    }

    send(body: unknown): void {
      this.record.body = body;
      requests.push(this.record);
      for (const step of progress) {
        // `"unknown"` to zdarzenie bez znanego rozmiaru (odpowiedź bez
        // Content-Length): `lengthComputable` jest wtedy `false` i procentu
        // NIE da się policzyć - pasek musi zostać na ostatniej wartości.
        this.upload.onprogress?.(
          step === "unknown"
            ? { lengthComputable: false, loaded: 0, total: 0 }
            : { lengthComputable: true, loaded: step[0], total: step[1] },
        );
      }
      if (outcome === "error") {
        this.onerror?.();
        return;
      }
      this.status = outcome;
      this.onload?.();
    }
  }

  // `FakeXhr` odgrywa tylko cztery użyte przez kod produkcyjny człony, nie
  // pełny interfejs `XMLHttpRequest` (kilkadziesiąt pól) - dlatego `tsc` samo
  // odmawia pojedynczego `as` (TS2352: „neither type sufficiently overlaps”).
  // Próba obejścia typem docelowym węższym niż `typeof XMLHttpRequest` (bez
  // mostka przez `unknown`) NIE działa z tego samego powodu - to jest właśnie
  // sytuacja, do której `as unknown as` istnieje jako legalny idiom testowy
  // (patrz `scripts/lib/unknownCastBaseline.ts`), a nie coś do wymyślania na
  // nowo. Wpis jest w baseline bramki `check:unknown-casts`.
  globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
  return {
    requests,
    restore() {
      globalThis.XMLHttpRequest = original;
    },
  };
}

/** Kształt zdarzenia postępu, jaki czyta kod uploadu. */
export interface ProgressEventLike {
  lengthComputable: boolean;
  loaded: number;
  total: number;
}

/** Plik o zadanym rozmiarze - limity uploadu liczą bajty, nie treść. */
export function fileOfSize(bytes: number, name = "avatar.png", type = "image/png"): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

// --- atrapy warstwy reactowej ----------------------------------------------

// Echo klucza i18n, atrapa `useTranslation`, kształt wyniku `useQuery` i
// natywny `<select>` za Radixa mieszkają teraz w `src/test/reactStubs.ts` -
// nie ma w nich niczego profilowego, a monetyzacja potrzebuje ich identycznie
// (ten sam ruch, którym atrapa łańcucha PostgREST przeniosła się do
// `src/test/supabaseChain.ts`). Re-eksport, żeby żaden test profilu nie
// zmieniał importu.
export {
  pendingQueryStub,
  queryStub,
  radixSelectStub,
  reactI18nextStub,
  translateKey,
  type QueryStub,
} from "@/test/reactStubs";
