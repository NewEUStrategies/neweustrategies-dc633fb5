// Maszyna stanu edytora wpisu. Hook stał na 0% pokrycia, a przechodzi przez
// niego KAŻDY zapis artykułu w panelu - łącznie z tymi, których redaktor nie
// zleca świadomie (autozapis co 1,5 s). Reguły, których złamanie kosztuje
// TREŚĆ albo pracę redakcji:
//
//   1. RESET DOKŁADNIE RAZ NA WPIS. Kolejny refetch wiersza (`post-by-slug`)
//      przynosi starszy `updated_at` niż ten, który przyszedł z odpowiedzi po
//      ostatnim zapisie. Ponowny reset nadpisałby edycje redaktora treścią
//      z cache'u i cofnął bazę optimistic-locka - następny zapis leciałby na
//      fałszywy EDIT_CONFLICT i redaktor nie miałby jak zapisać niczego.
//   2. SKRÓTY UNDO/REDO. Ctrl/Cmd+Z, Shift+Ctrl+Z, Ctrl+Y - z `preventDefault`,
//      bo bez niego natywne cofanie przeglądarki zadziała RÓWNOLEGLE i cofnie
//      dwa kroki naraz.
//   3. `applyStatus` JEDNYM SNAPSHOTEM. Zmiana statusu i treść idą w jednym
//      zapisie; rozbicie na dwa dałoby wyścig z autozapisem i publikację
//      wersji bez ostatnich poprawek.
//   4. MIĘKKA BRAMKA CHECKLISTY - pytanie TYLKO przy wejściu w publikację
//      i tylko przy brakach. Pytanie przy każdym zapisie nauczyłoby redakcję
//      klikać „mimo to" odruchowo.
//   5. TWARDA BRAMKA SEO blokuje `save()`, ale NIE `applyStatus`. To asymetria
//      opisana przy `seoSaveGate` w ../lib/postPatch.ts - test JĄ PRZYPINA,
//      nie ocenia (zmiana wymaga decyzji produktowej).
//   6. `discardToSaved` wraca do OSTATNIO ZAPISANEGO stanu, nie do wiersza
//      z montowania - inaczej „odrzuć zmiany" nadpisałoby autozapisaną pracę
//      starszą treścią.
//   7. CIĘŻKIE INWALIDACJE przy odmontowaniu, LEKKIE przy autozapisie. Odwrotny
//      układ powodował „auto-refresh" edytora w trakcie pisania.
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EDIT_CONFLICT_CODE } from "@/lib/content/saveConflict";
import { DISCLOSURE_ERROR_PREFIX } from "@/lib/content/sponsored";
import type { SeoIssue } from "@/lib/seo/validation";
import type { PostForm } from "../../types";

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  router: { invalidate: vi.fn() },
  blocker: vi.fn(),
  qc: { invalidateQueries: vi.fn() },
  updatePost: vi.fn(),
  deletePost: vi.fn(),
  registerMediaUpload: vi.fn(),
  uploadAndRegisterMedia: vi.fn(),
  confirmDialog: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
  invalidateWidgetCaches: vi.fn(),
  emitWidgetCacheInvalidate: vi.fn(),
  invalidateSeoCaches: vi.fn(),
  auth: { isAdmin: true, user: { id: "user-1" } as { id: string } | null },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => h.navigate,
  useRouter: () => h.router,
  // Strażnik niezapisanych zmian (useUnsavedChangesGuard) siada na blokerze
  // routera - atrapa zapisuje, z jakim `disabled` został uzbrojony.
  useBlocker: (opts: unknown) => h.blocker(opts),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => h.qc,
}));

vi.mock("@tanstack/react-start", () => ({
  // W produkcji `useServerFn` owija funkcję serwerową; w teście tożsamość
  // wystarcza - asercje idą wprost na atrapę `updatePost`/`deletePost`.
  useServerFn: <T,>(fn: T) => fn,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}|${JSON.stringify(opts)}` : key,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (m: string, o?: unknown) => h.toastSuccess(m, o),
    error: (m: string, o?: unknown) => h.toastError(m, o),
    warning: (m: string, o?: unknown) => h.toastWarning(m, o),
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: h.auth.isAdmin, user: h.auth.user }),
}));

vi.mock("@/lib/appDialogs", () => ({
  confirmDialog: (req: unknown) => h.confirmDialog(req),
}));

vi.mock("@/lib/content.functions", () => ({
  updatePost: (args: unknown) => h.updatePost(args),
  deletePost: (args: unknown) => h.deletePost(args),
}));

vi.mock("@/lib/media.functions", () => ({
  registerMediaUpload: (args: unknown) => h.registerMediaUpload(args),
}));

vi.mock("@/lib/media/upload", () => ({
  uploadAndRegisterMedia: (args: unknown) => h.uploadAndRegisterMedia(args),
  IMAGE_MIME: ["image/png", "image/jpeg"],
}));

vi.mock("@/lib/builder/widgetCacheInvalidation", () => ({
  invalidateWidgetCaches: (qc: unknown) => h.invalidateWidgetCaches(qc),
  emitWidgetCacheInvalidate: () => h.emitWidgetCacheInvalidate(),
}));

vi.mock("@/lib/seo/invalidate", () => ({
  invalidateSeoCaches: (qc: unknown, router: unknown) => h.invalidateSeoCaches(qc, router),
}));

vi.mock("@/lib/i18n-admin-post-panes", () => ({}));

import { usePostEditorForm } from "../usePostEditorForm";
import type { PostEditorData } from "../usePostEditorData";

const TENANT = "tenant-1";
const POST_ID = "post-1";
const ROUTE_SLUG = "moj-wpis";
const LOADED_UPDATED_AT = "2026-08-01T10:00:00.000Z";
const SAVED_UPDATED_AT = "2026-08-02T11:22:33.000Z";
/** Najmniejszy poprawny PNG jako data-URL (1x1, przezroczysty). */
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/**
 * Formularz KOMPLETNY (typ `PostForm` wymusza komplet), z checklistą publikacji
 * spełnioną: tytuł, okładka i opis są wypełnione, a wpis nie jest komercyjny.
 * Dzięki temu miękka bramka nie odzywa się w testach, które jej nie dotyczą -
 * a testy bramki celowo psują jedno pole.
 */
function postForm(over: Partial<PostForm> = {}): PostForm {
  return {
    id: POST_ID,
    slug: ROUTE_SLUG,
    updated_at: LOADED_UPDATED_AT,
    status: "draft",
    author_id: "author-1",
    editor: "blocks",
    title_pl: "Tytuł z bazy",
    title_en: "Title from DB",
    excerpt_pl: "Zajawka PL",
    excerpt_en: "Excerpt EN",
    content_pl: "<p>PL</p>",
    content_en: "<p>EN</p>",
    cover_image_url: "https://example.test/cover.jpg",
    audio_url_pl: null,
    audio_url_en: null,
    tts_voice_pl: null,
    tts_voice_en: null,
    read_minutes: null,
    published_at: null,
    publish_at: null,
    builder_data: null,
    blocks_data: null,
    parent_page_id: "",
    post_format: "standard",
    layout_overrides: null,
    takeaways_pl: [],
    takeaways_en: [],
    takeaways_variant: null,
    toc_override: null,
    custom_meta: null,
    related_override: null,
    seo_title_pl: null,
    seo_title_en: null,
    seo_description_pl: "Opis SEO PL",
    seo_description_en: null,
    seo_canonical_url: null,
    seo_noindex: false,
    seo_og_image_url: null,
    og_image_generated_url: null,
    organization_id: null,
    organization_name: null,
    organization_logo_url: null,
    organization_website: null,
    is_sponsored: false,
    sponsored_kind: null,
    sponsored_advertiser_name: null,
    sponsored_advertiser_url: null,
    sponsored_payer_name: null,
    sponsored_note_pl: null,
    sponsored_note_en: null,
    sponsored_affiliate: false,
    sponsored_political: false,
    sponsored_political_process: null,
    sponsored_sponsor_controller: null,
    sponsored_order_ref: null,
    sponsored_marked_at: null,
    ...over,
  };
}

function makeData(over: Partial<PostEditorData> = {}): PostEditorData {
  return {
    tenantId: TENANT,
    post: postForm(),
    isLoading: false,
    id: POST_ID,
    allCats: [],
    allTags: [],
    allPrograms: [],
    allRegions: [],
    postCats: undefined,
    postTags: undefined,
    postPrograms: undefined,
    postRegions: undefined,
    ...over,
  };
}

type Props = { data: PostEditorData; routeSlug: string };

function mount(over: Partial<PostEditorData> = {}, routeSlug = ROUTE_SLUG) {
  return renderHook((props: Props) => usePostEditorForm(props.routeSlug, props.data), {
    initialProps: { data: makeData(over), routeSlug },
  });
}

/** Ostatni payload wysłany do `updatePost` (kształt `{ data: {...} }`). */
function lastPayload(): {
  id: string;
  fields: Record<string, unknown>;
  categories: string[];
  tags: string[];
  programs: string[];
  regions: string[];
  baseUpdatedAt?: string;
} {
  const call = h.updatePost.mock.calls.at(-1);
  return (call?.[0] as { data: ReturnType<typeof lastPayload> }).data;
}

/** Wciska klawisz na oknie i zwraca zdarzenie (do sprawdzenia preventDefault). */
function press(
  key: string,
  mods: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    ctrlKey: !!mods.ctrl,
    metaKey: !!mods.meta,
    shiftKey: !!mods.shift,
    cancelable: true,
    bubbles: true,
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

function seoIssue(severity: SeoIssue["severity"]): SeoIssue {
  return {
    lang: "pl",
    kind: "title",
    severity,
    chars: 90,
    charLimit: 60,
    px: 700,
    pxLimit: 580,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.isAdmin = true;
  h.auth.user = { id: "user-1" };
  // Serwer domyślnie zapisuje slug tak, jak przyszedł, i odsyła nowy
  // `updated_at` - to jest kontrakt `updatePost` (patrz content.functions.ts).
  h.updatePost.mockImplementation(async (args: { data: { fields: { slug: string } } }) => ({
    ok: true as const,
    slug: args.data.fields.slug,
    updatedAt: SAVED_UPDATED_AT,
  }));
  h.deletePost.mockResolvedValue({ ok: true });
  h.confirmDialog.mockResolvedValue(true);
  h.uploadAndRegisterMedia.mockResolvedValue({ publicUrl: "https://cdn.test/wklejony.png" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("wczytanie wpisu do formularza", () => {
  it("wstawia wiersz z bazy do formularza przy pierwszym wczytaniu", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.form).not.toBeNull());
    expect(result.current.form?.title_pl).toBe("Tytuł z bazy");
    expect(result.current.form?.slug).toBe(ROUTE_SLUG);
  });

  it("nie stawia formularza, dopóki wiersz się nie wczytał", () => {
    const { result } = mount({ post: undefined, id: "", isLoading: true });
    expect(result.current.form).toBeNull();
    // Checklista bez formularza musi być `null`, a nie „wszystko brakuje" -
    // karta w sidebarze pokazałaby wtedy komplet czerwonych pozycji dla wpisu,
    // którego jeszcze nie widać.
    expect(result.current.publishChecklist).toBeNull();
  });

  it("edycja pola przed wczytaniem wiersza nie tworzy formularza z powietrza", () => {
    const { result } = mount({ post: undefined, id: "", isLoading: true });

    act(() => result.current.set("title_pl", "Wpisane za wcześnie"));

    // Gdyby `set` zbudował obiekt z jednego pola, autozapis wysłałby do bazy
    // wpis bez treści i nadpisał wiersz, który dopiero się wczytywał.
    expect(result.current.form).toBeNull();
  });

  it("REGRESJA: kolejny refetch TEGO SAMEGO wpisu nie nadpisuje edycji", async () => {
    const { result, rerender } = mount();
    act(() => result.current.set("title_pl", "Wersja redaktora"));

    // Refetch `post-by-slug` (np. po powrocie sieci) przynosi wiersz z cache'u.
    rerender({
      data: makeData({ post: postForm({ title_pl: "Stara wersja z cache" }) }),
      routeSlug: ROUTE_SLUG,
    });

    // Gdyby reset odpalił się ponownie, redaktor zobaczyłby, jak jego tekst
    // znika w trakcie pisania - bez żadnego komunikatu.
    expect(result.current.form?.title_pl).toBe("Wersja redaktora");
  });

  it("REGRESJA: refetch nie kasuje historii cofania", () => {
    const { result, rerender } = mount();
    act(() => result.current.set("title_pl", "Wersja redaktora"));
    expect(result.current.history.canUndo).toBe(true);

    rerender({
      data: makeData({ post: postForm({ title_pl: "Stara wersja z cache" }) }),
      routeSlug: ROUTE_SLUG,
    });

    // `history.reset` czyści stos cofania. Po refetchu Ctrl+Z musi nadal
    // cofać zmiany redaktora, a nie być martwym skrótem.
    expect(result.current.history.canUndo).toBe(true);
  });

  it("REGRESJA: refetch ze STARSZYM updated_at nie cofa bazy optimistic-locka", async () => {
    const { result, rerender } = mount();

    act(() => result.current.set("title_pl", "Pierwsza zmiana"));
    await act(async () => {
      await result.current.save();
    });
    expect(lastPayload().baseUpdatedAt).toBe(LOADED_UPDATED_AT);

    // Cache `post-by-slug` NIE jest bumpowany po autozapisie, więc refetch
    // przynosi updated_at sprzed zapisu.
    rerender({
      data: makeData({ post: postForm({ updated_at: LOADED_UPDATED_AT }) }),
      routeSlug: ROUTE_SLUG,
    });

    act(() => result.current.set("title_pl", "Druga zmiana"));
    await act(async () => {
      await result.current.save();
    });

    // Wysłanie starej bazy oznacza EDIT_CONFLICT na każdym kolejnym zapisie -
    // redaktor zostaje z tekstem, którego nie da się zapisać.
    expect(lastPayload().baseUpdatedAt).toBe(SAVED_UPDATED_AT);
  });

  it("przełączenie na INNY wpis wczytuje go od nowa razem z jego bazą locka", async () => {
    const { result, rerender } = mount();
    act(() => result.current.set("title_pl", "Zmiana w pierwszym wpisie"));

    rerender({
      data: makeData({
        post: postForm({
          id: "post-2",
          slug: "drugi-wpis",
          title_pl: "Drugi wpis",
          updated_at: "2026-08-05T08:00:00.000Z",
        }),
        id: "post-2",
      }),
      routeSlug: "drugi-wpis",
    });

    expect(result.current.form?.title_pl).toBe("Drugi wpis");
    act(() => result.current.set("excerpt_pl", "cokolwiek"));
    await act(async () => {
      await result.current.save();
    });
    expect(lastPayload().baseUpdatedAt).toBe("2026-08-05T08:00:00.000Z");
  });

  it("przenosi relacje wpisu na zaznaczenia i wysyła je w zapisie", async () => {
    const { result } = mount({
      postCats: [{ category_id: "c-1" }, { category_id: "c-2" }],
      postTags: [{ tag_id: "t-1" }],
      postPrograms: [{ program_id: "pr-1" }],
      postRegions: [{ region_id: "r-1" }],
    });

    expect(result.current.selectedCats).toEqual(["c-1", "c-2"]);
    expect(result.current.selectedTags).toEqual(["t-1"]);
    expect(result.current.selectedPrograms).toEqual(["pr-1"]);
    expect(result.current.selectedRegions).toEqual(["r-1"]);

    act(() => result.current.set("title_pl", "Zmiana"));
    await act(async () => {
      await result.current.save();
    });

    // Taksonomie jadą w TYM SAMYM żądaniu co treść - zapis bez nich zerwałby
    // przypisania wpisu do kategorii przy pierwszym autozapisie.
    const payload = lastPayload();
    expect(payload.categories).toEqual(["c-1", "c-2"]);
    expect(payload.tags).toEqual(["t-1"]);
    expect(payload.programs).toEqual(["pr-1"]);
    expect(payload.regions).toEqual(["r-1"]);
  });
});

describe("skróty klawiszowe undo/redo", () => {
  it("Ctrl+Z cofa ostatnią zmianę formularza", () => {
    const { result } = mount();
    act(() => result.current.set("title_pl", "Nowy tytuł"));

    press("z", { ctrl: true });

    expect(result.current.form?.title_pl).toBe("Tytuł z bazy");
  });

  it("Cmd+Z (macOS) cofa tak samo jak Ctrl+Z", () => {
    const { result } = mount();
    act(() => result.current.set("title_pl", "Nowy tytuł"));

    press("Z", { meta: true });

    // Klawisz przychodzi wielką literą przy wciśniętym Shifcie/CapsLocku -
    // porównanie bez `toLowerCase()` zabiłoby skrót na macOS.
    expect(result.current.form?.title_pl).toBe("Tytuł z bazy");
  });

  it("Shift+Ctrl+Z ponawia cofniętą zmianę", () => {
    const { result } = mount();
    act(() => result.current.set("title_pl", "Nowy tytuł"));
    press("z", { ctrl: true });

    press("z", { ctrl: true, shift: true });

    expect(result.current.form?.title_pl).toBe("Nowy tytuł");
  });

  it("Ctrl+Y ponawia cofniętą zmianę (wariant windowsowy)", () => {
    const { result } = mount();
    act(() => result.current.set("title_pl", "Nowy tytuł"));
    press("z", { ctrl: true });

    press("y", { ctrl: true });

    expect(result.current.form?.title_pl).toBe("Nowy tytuł");
  });

  it("blokuje natywne cofanie przeglądarki przy obsłużonym skrócie", () => {
    const { result } = mount();
    act(() => result.current.set("title_pl", "Nowy tytuł"));

    const event = press("z", { ctrl: true });

    // Bez `preventDefault` przeglądarka cofnęłaby RÓWNOLEGLE własną historię
    // pola tekstowego - jedno wciśnięcie Ctrl+Z cofałoby dwa kroki.
    expect(event.defaultPrevented).toBe(true);
  });

  it("samo „z” bez Ctrl/Cmd nie cofa (to zwykłe pisanie)", () => {
    const { result } = mount();
    act(() => result.current.set("title_pl", "Nowy tytuł"));

    const event = press("z");

    expect(result.current.form?.title_pl).toBe("Nowy tytuł");
    expect(event.defaultPrevented).toBe(false);
  });

  it("seria zmian w tym samym polu cofa się JEDNYM Ctrl+Z", () => {
    const { result } = mount();
    act(() => result.current.set("title_pl", "N"));
    act(() => result.current.set("title_pl", "No"));
    act(() => result.current.set("title_pl", "Nowy"));

    press("z", { ctrl: true });

    // Wpis historii jest sklejany kluczem pola: cofanie ma wracać do stanu
    // sprzed CAŁEJ serii pisania, a nie kasować literę po literze.
    expect(result.current.form?.title_pl).toBe("Tytuł z bazy");
  });

  it("nie przechwytuje innych skrótów z Ctrl (np. Ctrl+S)", () => {
    const { result } = mount();
    act(() => result.current.set("title_pl", "Nowy tytuł"));

    const event = press("s", { ctrl: true });

    // Edytor obsługuje WYŁĄCZNIE cofanie i ponawianie. Połknięcie innych
    // skrótów odbierałoby przeglądarce i systemowi ich własne funkcje.
    expect(event.defaultPrevented).toBe(false);
    expect(result.current.form?.title_pl).toBe("Nowy tytuł");
  });

  it("po odmontowaniu edytora skrót przestaje być przechwytywany", () => {
    const { unmount } = mount();
    unmount();

    const event = press("z", { ctrl: true });

    // Wyciek nasłuchu oznaczałby, że Ctrl+Z na INNYM ekranie panelu nadal
    // trafia w martwy edytor zamiast w przeglądarkę.
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("zapis jawny (save)", () => {
  it("wysyła komplet pól, taksonomie i bazę optimistic-locka", async () => {
    const { result } = mount({ postCats: [{ category_id: "c-1" }] });
    act(() => result.current.set("title_pl", "Zapisany tytuł"));

    await act(async () => {
      await result.current.save();
    });

    const payload = lastPayload();
    expect(payload.id).toBe(POST_ID);
    expect(payload.fields.title_pl).toBe("Zapisany tytuł");
    expect(payload.fields.slug).toBe(ROUTE_SLUG);
    expect(payload.baseUpdatedAt).toBe(LOADED_UPDATED_AT);
    expect(h.toastSuccess).toHaveBeenCalledWith("admin.saved", undefined);
  });

  it("wpis bez znacznika updated_at zapisuje się BEZ pola optimistic-locka", async () => {
    const { result } = mount({ post: postForm({ updated_at: null }) });
    act(() => result.current.set("title_pl", "Zmiana"));

    await act(async () => {
      await result.current.save();
    });

    // Walidator `updatePost` przyjmuje `baseUpdatedAt` jako opcjonalny STRING;
    // wysłanie `null` wywróciłoby cały zapis na walidacji, a nie tylko
    // pominęło kontrolę konfliktu.
    expect(lastPayload().baseUpdatedAt).toBeUndefined();
    expect(h.updatePost).toHaveBeenCalledTimes(1);
  });

  it("nierozpoznany błąd bez klasy Error też dociera do redaktora", async () => {
    const { result } = mount();
    act(() => result.current.set("title_pl", "Zmiana"));
    h.updatePost.mockRejectedValueOnce("serwer zwrócił goły tekst");

    await act(async () => {
      await result.current.save();
    });

    // Odrzucenie nie-Errorem (tak potrafi wracać błąd zza granicy server-fn)
    // nie może skończyć się pustym toastem - redaktor musi wiedzieć, że
    // zapis NIE przeszedł.
    expect(h.toastError).toHaveBeenCalledWith("serwer zwrócił goły tekst", undefined);
  });

  it("REGRESJA: twarda bramka SEO nie dopuszcza zapisu i mówi o tym redaktorowi", async () => {
    const { result } = mount();
    act(() => result.current.set("title_pl", "Zmiana"));
    act(() => result.current.setSeoIssues([seoIssue("error")]));

    await act(async () => {
      await result.current.save();
    });

    expect(h.updatePost).not.toHaveBeenCalled();
    expect(h.toastError).toHaveBeenCalledWith("admin.seo.validation.blockToast", undefined);
    // Cichy brak zapisu byłby gorszy niż błąd: redaktor wyszedłby z edytora
    // przekonany, że zapisał.
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("ostrzeżenia SEO tylko ostrzegają - zapis idzie dalej", async () => {
    const { result } = mount();
    act(() => result.current.set("title_pl", "Zmiana"));
    act(() => result.current.setSeoIssues([seoIssue("warning"), seoIssue("warning")]));

    await act(async () => {
      await result.current.save();
    });

    expect(h.toastWarning).toHaveBeenCalledWith(
      'admin.seo.validation.warnToast|{"count":2}',
      undefined,
    );
    expect(h.updatePost).toHaveBeenCalledTimes(1);
  });

  it("nazywa konflikt edycji osobnym komunikatem", async () => {
    const { result } = mount();
    act(() => result.current.set("title_pl", "Zmiana"));
    h.updatePost.mockRejectedValueOnce(new Error(`${EDIT_CONFLICT_CODE}: ktoś inny zapisał`));

    await act(async () => {
      await result.current.save();
    });

    // Stały `id` toasta: seria nieudanych autozapisów ma dać JEDEN komunikat,
    // a nie stos identycznych.
    expect(h.toastError).toHaveBeenCalledWith("admin.editConflict", { id: "edit-conflict" });
  });

  it("wymienia BRAKUJĄCE pola ujawnienia komercyjnego, gdy serwer odrzuca publikację", async () => {
    const { result } = mount();
    act(() => result.current.set("title_pl", "Zmiana"));
    h.updatePost.mockRejectedValueOnce(
      new Error(`${DISCLOSURE_ERROR_PREFIX}advertiser,advertiserUrl`),
    );

    await act(async () => {
      await result.current.save();
    });

    // „Zapis odrzucony" bez wskazania pól kazałoby redaktorowi zgadywać,
    // czego brakuje w oznaczeniu materiału.
    const call = h.toastError.mock.calls.find(([m]) =>
      String(m).startsWith("adminPostPanes.sponsored.gapToast"),
    );
    expect(call?.[0]).toContain("adminPostPanes.sponsored.gap.advertiser");
    expect(call?.[0]).toContain("adminPostPanes.sponsored.gap.advertiserUrl");
    expect(call?.[1]).toEqual({ id: "sponsored-disclosure-gap" });
  });

  it("nierozpoznany błąd zapisu leci do redaktora surowy", async () => {
    const { result } = mount();
    act(() => result.current.set("title_pl", "Zmiana"));
    h.updatePost.mockRejectedValueOnce(new Error("bazy nie ma"));

    await act(async () => {
      await result.current.save();
    });

    expect(h.toastError).toHaveBeenCalledWith("bazy nie ma", undefined);
    expect(h.toastError).not.toHaveBeenCalledWith("admin.editConflict", expect.anything());
    expect(h.toastSuccess).not.toHaveBeenCalled();
    // Formularz zostaje w stanie „brudnym", żeby strażnik wyjścia dalej
    // chronił niezapisany tekst.
    expect(result.current.autosave.isDirty).toBe(true);
  });

  it("zwalnia blokadę przycisków także po nieudanym zapisie", async () => {
    const { result } = mount();
    act(() => result.current.set("title_pl", "Zmiana"));
    h.updatePost.mockRejectedValueOnce(new Error("sieć padła"));

    await act(async () => {
      await result.current.save();
    });

    // `busy` zawieszone na `true` zablokowałoby edytor na stałe - jedyną
    // drogą naprawy byłoby przeładowanie strony i utrata tekstu.
    expect(result.current.busy).toBe(false);
  });
});

describe("zapis ze zmianą statusu (applyStatus)", () => {
  it("zapisuje status i treść JEDNYM żądaniem", async () => {
    const { result } = mount();
    act(() => result.current.set("title_pl", "Tekst po poprawkach"));

    await act(async () => {
      await result.current.applyStatus("pending_review");
    });

    expect(h.updatePost).toHaveBeenCalledTimes(1);
    const payload = lastPayload();
    // Rozbicie na dwa zapisy dałoby wyścig z autozapisem: recenzent dostałby
    // wpis ze statusem „do recenzji", ale bez ostatnich poprawek.
    expect(payload.fields.status).toBe("pending_review");
    expect(payload.fields.title_pl).toBe("Tekst po poprawkach");
    expect(result.current.form?.status).toBe("pending_review");
  });

  it("blokuje przyciski na czas zapisu i zwalnia po jego końcu", async () => {
    const { result } = mount();
    let release!: (value: unknown) => void;
    h.updatePost.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.applyStatus("published");
      await Promise.resolve();
    });
    // Bez blokady dwukrotne kliknięcie „Publikuj" wysłałoby dwa zapisy,
    // z których drugi poleciałby na nieaktualną bazę locka.
    expect(result.current.busy).toBe(true);

    await act(async () => {
      release({ ok: true, slug: ROUTE_SLUG, updatedAt: SAVED_UPDATED_AT });
      await pending;
    });
    expect(result.current.busy).toBe(false);
  });

  it("REGRESJA: twarda bramka SEO NIE blokuje publikacji (asymetria wobec save)", async () => {
    const { result } = mount({ postCats: [{ category_id: "c-1" }] });
    act(() => result.current.setSeoIssues([seoIssue("error")]));

    await act(async () => {
      await result.current.applyStatus("published");
    });

    // ZACHOWANIE ISTNIEJĄCE, przypięte świadomie: ta sama treść, której
    // „Zapisz" nie przepuści, przechodzi ścieżką „Publikuj". Zmiana wymaga
    // decyzji produktowej - test ma sprawić, żeby asymetria przestała być
    // niewidoczna (patrz komentarz przy `seoSaveGate`).
    expect(h.updatePost).toHaveBeenCalledTimes(1);
    expect(lastPayload().fields.status).toBe("published");
  });

  it("nie robi nic, dopóki formularz nie jest wczytany", async () => {
    const { result } = mount({ post: undefined, id: "", isLoading: true });

    await act(async () => {
      await result.current.applyStatus("published");
    });

    expect(h.updatePost).not.toHaveBeenCalled();
  });

  it("pokazuje błąd zapisu i nie kłamie sukcesem", async () => {
    const { result } = mount();
    h.updatePost.mockRejectedValueOnce(new Error("odmowa serwera"));

    await act(async () => {
      await result.current.applyStatus("pending_review");
    });

    expect(h.toastError).toHaveBeenCalledWith("odmowa serwera", undefined);
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
  });

  it("błąd bez klasy Error również kończy się komunikatem, a nie ciszą", async () => {
    const { result } = mount();
    h.updatePost.mockRejectedValueOnce("odmowa bez klasy Error");

    await act(async () => {
      await result.current.applyStatus("pending_review");
    });

    expect(h.toastError).toHaveBeenCalledWith("odmowa bez klasy Error", undefined);
  });
});

describe("miękka bramka checklisty publikacji", () => {
  const withGap = { cover_image_url: null };

  it("pyta o zgodę przy wejściu w publikację z brakami i wymienia braki", async () => {
    const { result } = mount({ post: postForm(withGap) });

    await act(async () => {
      await result.current.applyStatus("published");
    });

    const request = h.confirmDialog.mock.calls[0][0] as { title: string; description: string };
    expect(request.title).toBe("adminPostPanes.publishChecklist.gateTitle");
    // Pytanie bez wskazania braków jest bezwartościowe - redaktor musi
    // wiedzieć, CO pomija, klikając „publikuj mimo to".
    expect(request.description).toContain("adminPostPanes.publishChecklist.items.cover");
  });

  it("odmowa w oknie potwierdzenia zostawia wpis w spokoju", async () => {
    h.confirmDialog.mockResolvedValueOnce(false);
    const { result } = mount({ post: postForm(withGap) });

    await act(async () => {
      await result.current.applyStatus("published");
    });

    expect(h.updatePost).not.toHaveBeenCalled();
    // Status też nie może „przeskoczyć" mimo rezygnacji - inaczej następny
    // autozapis dokończyłby publikację, której redaktor nie chciał.
    expect(result.current.form?.status).toBe("draft");
  });

  it("zgoda w oknie potwierdzenia publikuje mimo braków", async () => {
    const { result } = mount({ post: postForm(withGap) });

    await act(async () => {
      await result.current.applyStatus("published");
    });

    expect(lastPayload().fields.status).toBe("published");
  });

  it("nie pyta, gdy checklista jest kompletna", async () => {
    // Kategoria jest pozycją WYMAGANĄ liczoną z zaznaczeń, nie z formularza -
    // stąd relacja wpisu w danych wejściowych.
    const { result } = mount({ postCats: [{ category_id: "c-1" }] });

    await act(async () => {
      await result.current.applyStatus("published");
    });

    // Pytanie przy każdej publikacji nauczyłoby redakcję klikać „mimo to"
    // odruchowo i bramka przestałaby cokolwiek chronić.
    expect(h.confirmDialog).not.toHaveBeenCalled();
    expect(h.updatePost).toHaveBeenCalledTimes(1);
  });

  it("nie pyta przy przejściach spoza publikacji, nawet z brakami", async () => {
    const { result } = mount({ post: postForm(withGap) });

    await act(async () => {
      await result.current.applyStatus("pending_review");
    });

    expect(h.confirmDialog).not.toHaveBeenCalled();
    expect(lastPayload().fields.status).toBe("pending_review");
  });

  it("nie pyta przy zapisie wpisu JUŻ opublikowanego", async () => {
    const { result } = mount({ post: postForm({ ...withGap, status: "published" }) });

    await act(async () => {
      await result.current.applyStatus("scheduled");
    });

    // Wpis jest już publiczny; bramka pilnuje WEJŚCIA w publikację, a nie
    // każdej korekty żywego artykułu.
    expect(h.confirmDialog).not.toHaveBeenCalled();
  });

  it("liczy brak ujawnienia komercyjnego jako pozycję wymaganą", async () => {
    const { result } = mount({
      post: postForm({ is_sponsored: true, sponsored_kind: null }),
    });

    expect(result.current.publishChecklist?.requiredOk).toBe(false);
    await act(async () => {
      await result.current.confirmPublishGaps("published");
    });

    // Serwer i tak odrzuci taką publikację - redaktor ma się o tym dowiedzieć
    // w bramce, a nie z komunikatu błędu po kliknięciu.
    const request = h.confirmDialog.mock.calls[0][0] as { description: string };
    expect(request.description).toContain(
      "adminPostPanes.publishChecklist.items.sponsoredDisclosure",
    );
  });

  it("przepuszcza bez pytania, gdy formularz nie jest wczytany", async () => {
    const { result } = mount({ post: undefined, id: "", isLoading: true });

    let decision = false;
    await act(async () => {
      decision = await result.current.confirmPublishGaps("published");
    });

    expect(decision).toBe(true);
    expect(h.confirmDialog).not.toHaveBeenCalled();
  });
});

describe("odrzucenie zmian (discardToSaved)", () => {
  it("REGRESJA: wraca do OSTATNIO ZAPISANEGO stanu, nie do wiersza z montowania", async () => {
    const { result } = mount({ postCats: [{ category_id: "c-1" }] });

    act(() => result.current.set("title_pl", "Wersja zapisana"));
    await act(async () => {
      await result.current.save();
    });

    act(() => result.current.set("title_pl", "Wersja porzucona"));
    act(() => result.current.setSelectedCats(["c-9"]));

    act(() => result.current.discardToSaved());

    // Powrót do wiersza z montowania nadpisałby autozapisaną pracę treścią
    // sprzed zapisu - i to autozapis utrwaliłby tę stratę sekundę później.
    expect(result.current.form?.title_pl).toBe("Wersja zapisana");
    expect(result.current.form?.title_pl).not.toBe("Tytuł z bazy");
    expect(result.current.selectedCats).toEqual(["c-1"]);
  });

  it("kliknięcie „odrzuć” przed wczytaniem wpisu nie tworzy formularza", () => {
    const { result } = mount({ post: undefined, id: "", isLoading: true });

    act(() => result.current.discardToSaved());

    // Ostatni zapisany stan nie istnieje - podstawienie go bezwarunkowo
    // dałoby formularz `null` w miejscu, gdzie reszta edytora oczekuje wpisu.
    expect(result.current.form).toBeNull();
    expect(result.current.selectedCats).toEqual([]);
  });

  it("po odrzuceniu zmian autozapis nadal uważa formularz za brudny i zapisuje go raz jeszcze", async () => {
    // ZACHOWANIE ISTNIEJĄCE, przypięte świadomie (zgłoszone w raporcie, kodu
    // nie ruszam). `useAutosave` porównuje wartości przez `Object.is`, a
    // `discardToSaved` odtwarza krotkę [formularz, taksonomie] jako NOWY
    // obiekt - identyczny treścią, inny tożsamością. Skutek dla redaktora:
    // po kliknięciu „odrzuć zmiany" strażnik wyjścia dalej ostrzega o
    // niezapisanych zmianach, a sekundę później leci zapis tej samej treści
    // (podbity `updated_at` i dodatkowy wpis w historii wersji). Naprawa
    // wymaga porównania po treści - to decyzja produktowa, nie literówka.
    vi.useFakeTimers();
    const { result } = mount();
    act(() => result.current.set("title_pl", "Wersja zapisana"));
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.autosave.isDirty).toBe(false);
    act(() => result.current.set("title_pl", "Wersja porzucona"));

    act(() => result.current.discardToSaved());
    expect(result.current.form?.title_pl).toBe("Wersja zapisana");
    expect(result.current.autosave.isDirty).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(h.updatePost).toHaveBeenCalledTimes(2);
    expect(lastPayload().fields.title_pl).toBe("Wersja zapisana");
  });
});

describe("strażnik niezapisanych zmian", () => {
  it("uzbraja blokadę nawigacji dopiero przy niezapisanej zmianie", () => {
    const { result } = mount();
    expect((h.blocker.mock.calls.at(-1)?.[0] as { disabled: boolean }).disabled).toBe(true);

    act(() => result.current.set("title_pl", "Nowy tytuł"));

    // Bez uzbrojenia blokera zamknięcie karty w trakcie pisania wyrzuca tekst
    // sprzed ostatniego autozapisu bez żadnego ostrzeżenia.
    expect((h.blocker.mock.calls.at(-1)?.[0] as { disabled: boolean }).disabled).toBe(false);
  });
});

describe("normalizacja slugu po zapisie", () => {
  it("pokazuje kolizję, poprawia pole i przenosi trasę na slug ZAPISANY", async () => {
    const { result } = mount();
    act(() => result.current.set("slug", "zajety-slug"));
    h.updatePost.mockResolvedValueOnce({
      ok: true,
      slug: "zajety-slug-2",
      updatedAt: SAVED_UPDATED_AT,
    });

    await act(async () => {
      await result.current.save();
    });

    expect(h.toastWarning).toHaveBeenCalledWith(
      'admin.slugTaken|{"slug":"zajety-slug-2"}',
      undefined,
    );
    expect(result.current.form?.slug).toBe("zajety-slug-2");
    // Nawigacja MUSI iść na slug zapisany: przejście na „zajety-slug"
    // załadowałoby CUDZY wpis, który ten slug posiada.
    expect(h.navigate).toHaveBeenCalledWith({
      to: "/admin/posts/$slug",
      params: { slug: "zajety-slug-2" },
      replace: true,
    });
  });

  it("przenosi trasę przy świadomej zmianie slugu, bez ostrzeżenia o kolizji", async () => {
    const { result } = mount();
    act(() => result.current.set("slug", "nowy-slug"));

    await act(async () => {
      await result.current.save();
    });

    expect(h.toastWarning).not.toHaveBeenCalled();
    expect(h.navigate).toHaveBeenCalledWith({
      to: "/admin/posts/$slug",
      params: { slug: "nowy-slug" },
      replace: true,
    });
  });

  it("REGRESJA: korekta kolizji nie nadpisuje slugu wpisanego W TRAKCIE zapisu", async () => {
    const { result } = mount();
    let release!: (value: unknown) => void;
    h.updatePost.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    act(() => result.current.set("slug", "zajety-slug"));

    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.save();
      await Promise.resolve();
    });
    // Redaktor pisze dalej, zanim serwer odpowie na poprzedni zapis.
    act(() => result.current.set("slug", "trzeci-pomysl"));

    await act(async () => {
      release({ ok: true, slug: "zajety-slug-2", updatedAt: SAVED_UPDATED_AT });
      await pending;
    });

    // Synchronizacja pola z bazą dotyczy TYLKO slugu, który poszedł w tym
    // żądaniu. Bezwarunkowe podstawienie kasowałoby litery pisane w trakcie
    // zapisu - pole „skakałoby" redaktorowi pod palcami.
    expect(result.current.form?.slug).toBe("trzeci-pomysl");
  });

  it("REGRESJA: zwykły zapis nie przenosi trasy", async () => {
    const { result } = mount();
    act(() => result.current.set("title_pl", "Zmiana bez slugu"));

    await act(async () => {
      await result.current.save();
    });

    // Nawigacja przy KAŻDYM autozapisie przerysowywałaby trasę co 1,5 s -
    // to był objaw „auto-refresh" edytora zgłaszany przez redakcję.
    expect(h.navigate).not.toHaveBeenCalled();
  });
});

describe("inwalidacje cache", () => {
  it("autozapis rusza WYŁĄCZNIE listę wpisów, i to bez pobierania", async () => {
    const { result } = mount();
    act(() => result.current.set("title_pl", "Zmiana"));

    await act(async () => {
      await result.current.save();
    });

    expect(h.qc.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["admin-posts"],
      refetchType: "none",
    });
    // Ciężkie inwalidacje przy każdym zapisie kazały loaderom trasy pobierać
    // wiersz od nowa - edytor sam się odświeżał redaktorowi pod palcami.
    expect(h.invalidateWidgetCaches).not.toHaveBeenCalled();
    expect(h.emitWidgetCacheInvalidate).not.toHaveBeenCalled();
    expect(h.invalidateSeoCaches).not.toHaveBeenCalled();
    expect(h.router.invalidate).not.toHaveBeenCalled();
  });

  it("odmontowanie po zapisie odświeża widoki publiczne i dashboard SEO", async () => {
    const { result, unmount } = mount();
    act(() => result.current.set("title_pl", "Zmiana"));
    await act(async () => {
      await result.current.save();
    });
    h.qc.invalidateQueries.mockClear();

    unmount();

    // Bez tego kroku publiczna strona i /admin/seo pokazywałyby starą treść
    // aż do twardego przeładowania.
    expect(h.qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["admin-posts"] });
    expect(h.invalidateWidgetCaches).toHaveBeenCalledWith(h.qc);
    expect(h.emitWidgetCacheInvalidate).toHaveBeenCalledTimes(1);
    expect(h.invalidateSeoCaches).toHaveBeenCalledWith(h.qc, h.router);
  });

  it("wyjście z edytora BEZ zapisu nie unieważnia niczego", () => {
    const { unmount } = mount();

    unmount();

    // Samo obejrzenie wpisu nie może kasować cache'u całej witryny - to
    // kosztuje pełne przeładowanie danych każdemu, kto akurat czyta panel.
    expect(h.invalidateWidgetCaches).not.toHaveBeenCalled();
    expect(h.emitWidgetCacheInvalidate).not.toHaveBeenCalled();
    expect(h.invalidateSeoCaches).not.toHaveBeenCalled();
  });

  it("przywrócenie wersji odświeża wiersz wpisu i cache widgetów", () => {
    const { result } = mount();

    act(() => result.current.onRevisionRestored());

    // Klucz jest zawężony tenantem: bez tego przywrócenie wersji w jednym
    // obszarze roboczym unieważniałoby wpisy innego.
    expect(h.qc.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["post-by-slug", TENANT, ROUTE_SLUG],
    });
    expect(h.invalidateWidgetCaches).toHaveBeenCalledWith(h.qc);
    expect(h.emitWidgetCacheInvalidate).toHaveBeenCalledTimes(1);
  });
});

describe("autozapis w tle", () => {
  it("zapisuje po chwili bezczynności, bez udziału redaktora", async () => {
    vi.useFakeTimers();
    const { result } = mount();
    act(() => result.current.set("title_pl", "Pisane w tle"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });

    expect(h.updatePost).toHaveBeenCalledTimes(1);
    expect(lastPayload().fields.title_pl).toBe("Pisane w tle");
  });

  it("REGRESJA: sama zmiana taksonomii też wyzwala autozapis", async () => {
    vi.useFakeTimers();
    const { result } = mount({ postCats: [{ category_id: "c-1" }] });
    act(() => result.current.setSelectedCats(["c-1", "c-2"]));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });

    // Autozapis obserwuje krotkę [formularz, kategorie, tagi, programy,
    // regiony]. Gdyby patrzył tylko na formularz, przypisanie kategorii
    // ginęłoby przy wyjściu z edytora bez dotknięcia treści.
    expect(h.updatePost).toHaveBeenCalledTimes(1);
    expect(lastPayload().categories).toEqual(["c-1", "c-2"]);
  });

  it("samo wczytanie wpisu nie wywołuje zapisu", async () => {
    vi.useFakeTimers();
    mount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    // Zapis „z powietrza" przy otwarciu wpisu podbijałby `updated_at` i
    // fałszował historię wersji dla wpisów, których nikt nie edytował.
    expect(h.updatePost).not.toHaveBeenCalled();
  });
});

describe("wklejone grafiki (data-URL)", () => {
  const blocksWithImage = () => ({
    pl: {
      version: 1 as const,
      blocks: [{ id: "b1", type: "image" as const, data: { url: PNG_DATA_URL } }],
    },
    en: { version: 1 as const, blocks: [] },
  });

  it("wgrywa wklejoną grafikę do biblioteki mediów i zapisuje publiczny adres", async () => {
    const { result } = mount({ post: postForm({ blocks_data: blocksWithImage() }) });
    act(() => result.current.set("title_pl", "Wpis z wklejonym obrazkiem"));

    await act(async () => {
      await result.current.save();
    });

    expect(h.uploadAndRegisterMedia).toHaveBeenCalledTimes(1);
    const uploadArgs = h.uploadAndRegisterMedia.mock.calls[0][0] as {
      file: File;
      tenantId: string;
      userId: string;
      subfolder: string;
    };
    // Stempel tenanta i użytkownika decyduje o tym, w czyim obszarze roboczym
    // wyląduje plik - pomyłka wynosi grafikę do cudzej biblioteki.
    expect(uploadArgs.tenantId).toBe(TENANT);
    expect(uploadArgs.userId).toBe("user-1");
    expect(uploadArgs.subfolder).toBe("posts");
    expect(uploadArgs.file.name).toBe("wklejony-obraz-1.png");

    const saved = JSON.stringify(lastPayload().fields.blocks_data);
    // Base64 w kolumnie jsonb rozdyma bazę i nie pokazuje się w /admin/media.
    expect(saved).not.toContain("data:image");
    expect(saved).toContain("https://cdn.test/wklejony.png");
  });

  it("podmienia adres także w formularzu, więc kolejny zapis nie wgrywa go ponownie", async () => {
    const { result } = mount({ post: postForm({ blocks_data: blocksWithImage() }) });
    act(() => result.current.set("title_pl", "Pierwsza zmiana"));
    await act(async () => {
      await result.current.save();
    });

    expect(JSON.stringify(result.current.form?.blocks_data)).toContain(
      "https://cdn.test/wklejony.png",
    );

    act(() => result.current.set("title_pl", "Druga zmiana"));
    await act(async () => {
      await result.current.save();
    });

    expect(h.uploadAndRegisterMedia).toHaveBeenCalledTimes(1);
  });

  it("tę samą grafikę w blokach i w builderze wgrywa RAZ", async () => {
    const { result } = mount({
      post: postForm({
        blocks_data: blocksWithImage(),
        builder_data: {
          version: 1,
          sections: [{ id: "s1", type: "image", props: { url: PNG_DATA_URL } }],
        } as unknown as PostForm["builder_data"],
      }),
    });
    act(() => result.current.set("title_pl", "Zmiana"));

    await act(async () => {
      await result.current.save();
    });

    // Wspólny cache sesji edycji: bez niego ta sama grafika lądowałaby
    // w bibliotece mediów w dwóch egzemplarzach przy jednym zapisie.
    expect(h.uploadAndRegisterMedia).toHaveBeenCalledTimes(1);
  });

  it("grafika wklejona w widoku buildera (bez bloków) też trafia do biblioteki", async () => {
    const { result } = mount({
      post: postForm({
        blocks_data: null,
        builder_data: {
          version: 1,
          sections: [{ id: "s1", type: "image", props: { url: PNG_DATA_URL } }],
        } as unknown as PostForm["builder_data"],
      }),
    });
    act(() => result.current.set("title_pl", "Zmiana"));

    await act(async () => {
      await result.current.save();
    });

    expect(h.uploadAndRegisterMedia).toHaveBeenCalledTimes(1);
    const saved = JSON.stringify(lastPayload().fields.builder_data);
    expect(saved).toContain("https://cdn.test/wklejony.png");
    // Dokument bloków jest pusty i taki ma zostać - synchronizacja formularza
    // nie może „ożywić" nieużywanego edytora.
    expect(lastPayload().fields.blocks_data).toBeNull();
  });

  it("nieudany upload ostrzega, ale NIE wywraca zapisu wpisu", async () => {
    h.uploadAndRegisterMedia.mockRejectedValueOnce(new Error("storage padł"));
    const { result } = mount({ post: postForm({ blocks_data: blocksWithImage() }) });
    act(() => result.current.set("title_pl", "Zmiana"));

    await act(async () => {
      await result.current.save();
    });

    expect(h.toastWarning).toHaveBeenCalledWith('blocks.clipboard.imagePersistFailed|{"count":1}', {
      id: "blocks-image-persist",
    });
    // Tekst redaktora jest ważniejszy niż jedna grafika: zapis idzie dalej,
    // a data-URL zostaje do ponownej próby przy następnym zapisie.
    expect(h.updatePost).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(lastPayload().fields.blocks_data)).toContain("data:image");
  });

  it("bez zalogowanego użytkownika nie próbuje wgrywać niczego", async () => {
    h.auth.user = null;
    const { result } = mount({ post: postForm({ blocks_data: blocksWithImage() }) });
    act(() => result.current.set("title_pl", "Zmiana"));

    await act(async () => {
      await result.current.save();
    });

    // Upload bez właściciela nie ma jak zarejestrować pliku w bibliotece -
    // lepiej zapisać treść z data-URL niż wywalić zapis.
    expect(h.uploadAndRegisterMedia).not.toHaveBeenCalled();
    expect(h.updatePost).toHaveBeenCalledTimes(1);
  });
});

describe("usuwanie wpisu", () => {
  it("nie usuwa, gdy redaktor cofnie potwierdzenie", async () => {
    h.confirmDialog.mockResolvedValueOnce(false);
    const { result } = mount();

    await act(async () => {
      await result.current.del();
    });

    expect(h.deletePost).not.toHaveBeenCalled();
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("usuwa po potwierdzeniu i wraca na listę wpisów", async () => {
    const { result } = mount();

    await act(async () => {
      await result.current.del();
    });

    expect(h.confirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({ destructive: true, title: "admin.confirmDelete" }),
    );
    expect(h.deletePost).toHaveBeenCalledWith({ data: { id: POST_ID } });
    expect(h.toastSuccess).toHaveBeenCalledWith("admin.deleted", undefined);
    expect(h.navigate).toHaveBeenCalledWith({ to: "/admin/posts" });
  });

  it("przy błędzie usuwania zostaje w edytorze i pokazuje powód", async () => {
    h.deletePost.mockRejectedValueOnce(new Error("wpis ma powiązania"));
    const { result } = mount();

    await act(async () => {
      await result.current.del();
    });

    // Wyjście na listę po nieudanym usunięciu sugerowałoby, że wpis zniknął.
    expect(h.navigate).not.toHaveBeenCalled();
    expect(h.toastError).toHaveBeenCalledWith("wpis ma powiązania", undefined);
  });

  it("odmowa usunięcia bez klasy Error też jest pokazana", async () => {
    h.deletePost.mockRejectedValueOnce("brak uprawnień");
    const { result } = mount();

    await act(async () => {
      await result.current.del();
    });

    expect(h.toastError).toHaveBeenCalledWith("brak uprawnień", undefined);
    expect(h.navigate).not.toHaveBeenCalled();
  });
});

describe("uprawnienia i terminy", () => {
  it("autorowi bez prawa publikacji oznacza statusy wydawcy", () => {
    h.auth.isAdmin = false;
    const { result } = mount();

    const byValue = Object.fromEntries(
      result.current.statusOptions.map((o) => [o.value, o.publisherOnly]),
    );
    // Lista musi POKAZAĆ te statusy jako niedostępne, a nie je ukryć - autor
    // ma widzieć, że wpis czeka na publikującego, a nie że opcji nie ma.
    expect(byValue.published).toBe(true);
    expect(byValue.scheduled).toBe(true);
    expect(byValue.draft).toBe(false);
    expect(result.current.canPublish).toBe(false);
  });

  it("wydawcy udostępnia wszystkie statusy", () => {
    const { result } = mount();
    expect(result.current.statusOptions.every((o) => !o.publisherOnly)).toBe(true);
  });

  it("oznacza zaplanowany wpis z minionym terminem", () => {
    const { result } = mount({
      post: postForm({ status: "scheduled", publish_at: "2020-01-01T00:00:00.000Z" }),
    });

    // Taki wpis czeka na przebieg `publish_due_posts()` i bez ostrzeżenia
    // wygląda jak zgubiony.
    expect(result.current.scheduledInPast).toBe(true);
  });

  it("nie oznacza wpisu zaplanowanego na przyszłość", () => {
    const { result } = mount({
      post: postForm({ status: "scheduled", publish_at: "2099-01-01T00:00:00.000Z" }),
    });
    expect(result.current.scheduledInPast).toBe(false);
  });
});
