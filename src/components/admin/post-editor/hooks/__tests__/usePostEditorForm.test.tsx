// MASZYNA STANU formularza edytora wpisu - obudowa nad czystymi regułami
// z `../lib` (te mają własne testy jednostkowe). Tutaj testujemy WYŁĄCZNIE to,
// czego czyste funkcje nie widzą: sklejenie stanu, efektów, zapisu i toastów.
//
// Dlaczego to ma osobny plik, a nie „jeszcze kilka asercji" w testach reguł:
// hook nie da się wywołać bez routera, klienta react-query, `useServerFn`,
// i18n oraz klienta Supabase, więc jego test to inna klasa kosztu. Reguły
// sprawdzamy tanio i wyczerpująco w `lib/__tests__`, a tutaj dowodzimy, że są
// PODŁĄCZONE - i że ścieżka błędu nie kłamie użytkownikowi.
//
// NAJWAŻNIEJSZE, CZEGO TU PILNUJEMY: nieudany zapis NIE MOŻE zameldować
// sukcesu. `useAutosave.flush()` celowo ODRZUCA, gdy zapis padł (komentarz
// w useAutosave.ts opisuje, że kłamstwo w tym miejscu spowodowało kiedyś
// całkowitą utratę pracy w page builderze). Ten hook jest miejscem, w którym
// to odrzucenie zamienia się w komunikat dla redaktora.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EDIT_CONFLICT_CODE } from "@/lib/content/saveConflict";
import { DISCLOSURE_ERROR_PREFIX } from "@/lib/content/sponsored";
import { postEditorData, postForm, seoIssue } from "@/test/post-editor/fixtures";

const h = vi.hoisted(() => ({
  navigate: null as unknown,
  invalidateRouter: null as unknown,
  update: null as unknown,
  del: null as unknown,
  registerUpload: null as unknown,
  confirm: null as unknown,
  toast: null as unknown,
  canPublish: true,
  persistResult: {
    doc: null as unknown,
    changed: false,
    failed: 0,
    replacements: new Map<string, string>(),
  },
  invalidateWidgetCaches: null as unknown,
  emitWidgetCacheInvalidate: null as unknown,
  invalidateSeoCaches: null as unknown,
  // Czy atrapa `persistDataUrlImages` ma FAKTYCZNIE wywolac przekazany callback
  // uploadu. Domyslnie nie - wiekszosc testow nie potrzebuje tej sciezki.
  runUpload: false,
  uploadArgs: [] as Array<Record<string, unknown>>,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(),
);
vi.mock("@/lib/i18n-admin-post-panes", () => ({}));

vi.mock("@tanstack/react-router", async () => {
  const { vi: v } = await import("vitest");
  h.navigate = v.fn();
  h.invalidateRouter = v.fn();
  return {
    useNavigate: () => h.navigate,
    useRouter: () => ({ invalidate: h.invalidateRouter }),
    // Bloker nawigacji jest tu nieistotny - jego własną logikę pokrywa
    // src/hooks/__tests__/useUnsavedChangesGuard.test.tsx.
    useBlocker: () => undefined,
  };
});

vi.mock("@tanstack/react-start", () => ({
  // `useServerFn` w produkcji owija server fn; w teście oddajemy atrapę wprost.
  useServerFn: (fn: unknown) => fn,
}));

vi.mock("@/lib/content.functions", async () => {
  const { vi: v } = await import("vitest");
  h.update = v.fn(async () => ({ ok: true as const, slug: "moj-wpis", updatedAt: "SAVED-1" }));
  h.del = v.fn(async () => ({ ok: true as const }));
  return { updatePost: h.update, deletePost: h.del };
});

vi.mock("@/lib/media.functions", async () => {
  const { vi: v } = await import("vitest");
  h.registerUpload = v.fn(async () => ({ id: "media-1" }));
  return { registerMediaUpload: h.registerUpload };
});

vi.mock("@/lib/media/upload", () => ({
  uploadAndRegisterMedia: async (args: Record<string, unknown>) => {
    h.uploadArgs.push(args);
    return { publicUrl: "https://storage.example/x.png" };
  },
  IMAGE_MIME: ["image/png"],
}));

vi.mock("@/lib/blocks/persistImages", () => ({
  // Skaner dokumentu jest atrapowany (ma wlasne testy w @/lib/blocks), ale gdy
  // test tego chce, WYWOLUJEMY przekazany callback uploadu - to jedyny sposob,
  // zeby sprawdzic, do jakiego najemcy i katalogu ladują wklejone grafiki.
  persistDataUrlImages: async (
    _doc: unknown,
    upload: (decoded: { bytes: Uint8Array; filename: string; mime: string }) => Promise<string>,
  ) => {
    if (h.runUpload) {
      await upload({
        bytes: new Uint8Array([1, 2, 3]),
        filename: "wklejka.png",
        mime: "image/png",
      });
    }
    return h.persistResult;
  },
  replaceDataUrlImages: <T,>(doc: T) => doc,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: h.canPublish, user: { id: "user-1" } }),
}));

vi.mock("@/lib/appDialogs", async () => {
  const { vi: v } = await import("vitest");
  h.confirm = v.fn(async () => true);
  return { confirmDialog: h.confirm };
});

vi.mock("sonner", async () => {
  const { toastStub } = await import("@/test/post-editor/fixtures");
  const toast = toastStub();
  h.toast = toast;
  return { toast, Toaster: () => null };
});

vi.mock("@/lib/builder/widgetCacheInvalidation", async () => {
  const { vi: v } = await import("vitest");
  h.invalidateWidgetCaches = v.fn();
  h.emitWidgetCacheInvalidate = v.fn();
  return {
    invalidateWidgetCaches: h.invalidateWidgetCaches,
    emitWidgetCacheInvalidate: h.emitWidgetCacheInvalidate,
  };
});

vi.mock("@/lib/seo/invalidate", async () => {
  const { vi: v } = await import("vitest");
  h.invalidateSeoCaches = v.fn();
  return { invalidateSeoCaches: h.invalidateSeoCaches };
});

import { usePostEditorForm } from "../usePostEditorForm";

type Mock = ReturnType<typeof vi.fn>;
const update = () => h.update as Mock;
const del = () => h.del as Mock;
const navigate = () => h.navigate as Mock;
const confirmDialog = () => h.confirm as Mock;
const toast = () => h.toast as Record<string, Mock>;

/**
 * Domyślny stan to wpis KOMPLETNY z punktu widzenia checklisty publikacji -
 * czyli także z przypisaną kategorią (`category` jest pozycją WYMAGANĄ, a
 * checklista liczy ją z `selectedCats`, nie z wiersza wpisu). Bez tego każdy
 * test „ścieżki szczęśliwej" wpadałby w miękką bramkę i dowodziłby czegoś
 * innego, niż zapowiada jego nazwa.
 */
function harness(dataOverrides: Parameters<typeof postEditorData>[0] = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const data = postEditorData({
    postCats: [{ category_id: "cat-1" }],
    ...dataOverrides,
  }) as unknown as Parameters<typeof usePostEditorForm>[1];
  const rendered = renderHook(() => usePostEditorForm("moj-wpis", data), { wrapper });
  return { ...rendered, client };
}

beforeEach(() => {
  h.canPublish = true;
  h.runUpload = false;
  h.uploadArgs = [];
  h.persistResult = { doc: null, changed: false, failed: 0, replacements: new Map() };
  update().mockReset();
  update().mockResolvedValue({ ok: true as const, slug: "moj-wpis", updatedAt: "SAVED-1" });
  del().mockReset();
  del().mockResolvedValue({ ok: true as const });
  navigate().mockReset();
  confirmDialog().mockReset();
  confirmDialog().mockResolvedValue(true);
  for (const fn of Object.values(toast())) fn.mockReset();
  (h.invalidateWidgetCaches as Mock).mockReset();
  (h.emitWidgetCacheInvalidate as Mock).mockReset();
  (h.invalidateSeoCaches as Mock).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Wczytanie wpisu do formularza
// ---------------------------------------------------------------------------

describe("usePostEditorForm - wczytanie", () => {
  it("wypełnia formularz wierszem wpisu i przenosi wybory taksonomii", async () => {
    const { result } = harness({
      postCats: [{ category_id: "cat-1" }],
      postTags: [{ tag_id: "tag-1" }],
      postPrograms: [{ program_id: "prog-1" }],
      postRegions: [{ region_id: "reg-1" }],
    });

    await waitFor(() => expect(result.current.form?.slug).toBe("moj-wpis"));
    expect(result.current.selectedCats).toEqual(["cat-1"]);
    expect(result.current.selectedTags).toEqual(["tag-1"]);
    expect(result.current.selectedPrograms).toEqual(["prog-1"]);
    expect(result.current.selectedRegions).toEqual(["reg-1"]);
  });

  it("`set` zmienia pojedyncze pole formularza", async () => {
    const { result } = harness();
    await waitFor(() => expect(result.current.form).not.toBeNull());

    act(() => result.current.set("title_pl", "Zmieniony tytuł"));

    await waitFor(() => expect(result.current.form?.title_pl).toBe("Zmieniony tytuł"));
    // Reszta pól nietknięta - `set` jest punktowy, nie podmienia całej migawki.
    expect(result.current.form?.title_en).toBe(postForm().title_en);
  });
});

// ---------------------------------------------------------------------------
// Bramka publikacji (uprawnienia)
// ---------------------------------------------------------------------------

describe("usePostEditorForm - bramka publikacji", () => {
  it("wydawca nie ma zablokowanej żadnej opcji statusu", async () => {
    h.canPublish = true;
    const { result } = harness();
    await waitFor(() => expect(result.current.form).not.toBeNull());
    expect(result.current.canPublish).toBe(true);
    expect(result.current.statusOptions.every((o) => !o.publisherOnly)).toBe(true);
  });

  it("autor/redaktor ma zablokowane `scheduled` i `published`", async () => {
    // Ta sama reguła jest lustrzana po stronie serwera i w triggerze bazy;
    // tutaj pilnujemy, że UI jej nie obchodzi.
    h.canPublish = false;
    const { result } = harness();
    await waitFor(() => expect(result.current.form).not.toBeNull());
    const gated = result.current.statusOptions.filter((o) => o.publisherOnly).map((o) => o.value);
    expect(gated).toEqual(["scheduled", "published"]);
  });
});

// ---------------------------------------------------------------------------
// Zapis ze zmianą statusu
// ---------------------------------------------------------------------------

describe("usePostEditorForm - applyStatus", () => {
  it("zapisuje status i treść JEDNĄ migawką, potem melduje sukces", async () => {
    // Rozbicie na dwa zapisy (najpierw treść, potem status) dawało wyścig
    // z autosave'em, który potrafił rozdzielić zmianę na pół.
    const { result } = harness();
    await waitFor(() => expect(result.current.form).not.toBeNull());

    await act(async () => {
      await result.current.applyStatus("published");
    });

    expect(update()).toHaveBeenCalledTimes(1);
    const payload = update().mock.calls[0][0] as {
      data: { id: string; fields: Record<string, unknown>; baseUpdatedAt?: string };
    };
    expect(payload.data.fields.status).toBe("published");
    expect(payload.data.fields.title_pl).toBe(postForm().title_pl);
    // Optimistic-lock jedzie razem z zapisem.
    expect(payload.data.baseUpdatedAt).toBe(postForm().updated_at);
    expect(toast().success).toHaveBeenCalled();
  });

  it("przesuwa bazę optimistic-locka na updated_at zwrócony przez serwer", async () => {
    const { result } = harness();
    await waitFor(() => expect(result.current.form).not.toBeNull());

    await act(async () => {
      await result.current.applyStatus("pending_review");
    });
    await act(async () => {
      await result.current.applyStatus("draft");
    });

    const second = update().mock.calls[1][0] as { data: { baseUpdatedAt?: string } };
    // Bez tego przesunięcia DRUGI zapis zgłaszałby fałszywy konflikt edycji.
    expect(second.data.baseUpdatedAt).toBe("SAVED-1");
  });

  it("konflikt edycji: komunikat dla redaktora i BRAK meldunku o sukcesie", async () => {
    update().mockRejectedValue(new Error(`${EDIT_CONFLICT_CODE}: ktoś inny zapisał`));
    const { result } = harness();
    await waitFor(() => expect(result.current.form).not.toBeNull());

    await act(async () => {
      await result.current.applyStatus("published");
    });

    expect(toast().error).toHaveBeenCalled();
    // Kluczowe: żadnego „Zapisano" po zapisie, który się nie udał.
    expect(toast().success).not.toHaveBeenCalled();
    // I formularz nie jest zablokowany na zawsze.
    expect(result.current.busy).toBe(false);
  });

  it("odrzucona deklaracja komercyjna: komunikat WYMIENIA brakujące pola", async () => {
    // „Zapis odrzucony" bez wskazania pola kazałoby redaktorowi zgadywać,
    // czego brakuje w ustawowym oznaczeniu materiału komercyjnego.
    update().mockRejectedValue(new Error(`${DISCLOSURE_ERROR_PREFIX} kind, advertiser`));
    const { result } = harness();
    await waitFor(() => expect(result.current.form).not.toBeNull());

    await act(async () => {
      await result.current.applyStatus("published");
    });

    const messages = toast().error.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("gapToast"))).toBe(true);
    expect(messages.some((m) => m.includes("kind") && m.includes("advertiser"))).toBe(true);
  });

  it("miękka bramka checklisty: brak wymaganej pozycji pyta, nie blokuje", async () => {
    // Wpis bez okładki wchodzący w `published` - checklista ma braki, więc
    // pytamy; potwierdzenie przepuszcza zapis.
    const { result } = harness({ post: postForm({ cover_image_url: null }) });
    await waitFor(() => expect(result.current.form).not.toBeNull());
    confirmDialog().mockResolvedValue(true);

    await act(async () => {
      await result.current.applyStatus("published");
    });

    expect(confirmDialog()).toHaveBeenCalledTimes(1);
    expect(update()).toHaveBeenCalledTimes(1);
  });

  it("odmowa w miękkiej bramce PRZERYWA zapis", async () => {
    const { result } = harness({ post: postForm({ cover_image_url: null }) });
    await waitFor(() => expect(result.current.form).not.toBeNull());
    confirmDialog().mockResolvedValue(false);

    await act(async () => {
      await result.current.applyStatus("published");
    });

    expect(update()).not.toHaveBeenCalled();
    expect(toast().success).not.toHaveBeenCalled();
  });

  it("kompletny wpis przechodzi w published BEZ pytania", async () => {
    const { result } = harness();
    await waitFor(() => expect(result.current.form).not.toBeNull());

    await act(async () => {
      await result.current.applyStatus("published");
    });

    expect(confirmDialog()).not.toHaveBeenCalled();
  });

  it("przejście, które NIE jest publikacją, nie dotyka bramki", async () => {
    // Autosave i zwykłe zapisy nie mogą przechodzić przez bramkę publikacji -
    // inaczej redaktor dostawałby pytanie przy każdym zapisie szkicu.
    const { result } = harness({ post: postForm({ cover_image_url: null }) });
    await waitFor(() => expect(result.current.form).not.toBeNull());

    await act(async () => {
      await result.current.applyStatus("pending_review");
    });

    expect(confirmDialog()).not.toHaveBeenCalled();
    expect(update()).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Normalizacja sluga przez serwer
// ---------------------------------------------------------------------------

describe("usePostEditorForm - slug znormalizowany przez serwer", () => {
  it("ostrzega redaktora i nawiguje na slug FAKTYCZNIE zapisany", async () => {
    // Nawigacja na slug wpisany w formularzu załadowałaby CUDZY wpis, który ten
    // slug już posiada - i następny autosave zapisałby na tamtym wierszu.
    update().mockResolvedValue({ ok: true as const, slug: "moj-wpis-2", updatedAt: "SAVED-2" });
    const { result } = harness();
    await waitFor(() => expect(result.current.form).not.toBeNull());

    await act(async () => {
      await result.current.applyStatus("published");
    });

    expect(toast().warning).toHaveBeenCalled();
    expect(navigate()).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/admin/posts/$slug",
        params: { slug: "moj-wpis-2" },
        replace: true,
      }),
    );
    // Pole formularza zsynchronizowane z tym, co realnie trafiło do bazy.
    await waitFor(() => expect(result.current.form?.slug).toBe("moj-wpis-2"));
  });

  it("slug niezmieniony: żadnego ostrzeżenia i żadnej nawigacji", async () => {
    const { result } = harness();
    await waitFor(() => expect(result.current.form).not.toBeNull());

    await act(async () => {
      await result.current.applyStatus("published");
    });

    expect(toast().warning).not.toHaveBeenCalled();
    expect(navigate()).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Jawny zapis i bramka SEO
// ---------------------------------------------------------------------------

describe("usePostEditorForm - save() i bramka SEO", () => {
  it("blokujący problem SEO wstrzymuje zapis", async () => {
    const { result } = harness();
    await waitFor(() => expect(result.current.form).not.toBeNull());
    act(() => result.current.setSeoIssues([seoIssue({ severity: "error" })]));

    await act(async () => {
      await result.current.save();
    });

    expect(update()).not.toHaveBeenCalled();
    expect(toast().error).toHaveBeenCalled();
    expect(toast().success).not.toHaveBeenCalled();
  });

  it("ostrzeżenia pikselowe NIE blokują - ostrzegają i zapisują", async () => {
    const { result } = harness();
    await waitFor(() => expect(result.current.form).not.toBeNull());
    act(() => result.current.setSeoIssues([seoIssue({ severity: "warning" })]));
    // Formularz musi być brudny, żeby flush miał co zapisać.
    act(() => result.current.set("title_pl", "Zmiana"));

    await act(async () => {
      await result.current.save();
    });

    expect(toast().warning).toHaveBeenCalled();
    expect(toast().success).toHaveBeenCalled();
  });

  it("nieudany zapis w save(): błąd, nie meldunek sukcesu", async () => {
    // `useAutosave.flush()` celowo ODRZUCA, gdy zapis padł. To tutaj odrzucenie
    // ma zamienić się w komunikat - „Zapisano" po nieudanym zapisie było
    // przyczyną całkowitej utraty pracy w page builderze.
    update().mockRejectedValue(new Error("serwer odmówił"));
    const { result } = harness();
    await waitFor(() => expect(result.current.form).not.toBeNull());
    act(() => result.current.set("title_pl", "Zmiana"));

    await act(async () => {
      await result.current.save();
    });

    expect(toast().error).toHaveBeenCalled();
    expect(toast().success).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Porzucenie zmian
// ---------------------------------------------------------------------------

describe("usePostEditorForm - discardToSaved", () => {
  it("wraca do OSTATNIO ZAPISANEJ migawki, nie do wiersza z montażu", async () => {
    // Powrót do stanu z montażu kazałby autosave'owi zapisać STARĄ treść na
    // nowszej, już zapisanej pracy.
    const { result } = harness();
    await waitFor(() => expect(result.current.form).not.toBeNull());

    act(() => result.current.set("title_pl", "Roboczy tytuł"));
    await waitFor(() => expect(result.current.form?.title_pl).toBe("Roboczy tytuł"));

    act(() => result.current.discardToSaved());

    await waitFor(() => expect(result.current.form?.title_pl).toBe(postForm().title_pl));
  });

  it("przywraca też wybory taksonomii z ostatniego zapisu", async () => {
    const { result } = harness();
    await waitFor(() => expect(result.current.form).not.toBeNull());

    await waitFor(() => expect(result.current.selectedCats).toEqual(["cat-1"]));
    act(() => result.current.setSelectedCats(["cat-nowa"]));
    await waitFor(() => expect(result.current.selectedCats).toEqual(["cat-nowa"]));

    act(() => result.current.discardToSaved());

    // Powrot do stanu OSTATNIEGO ZAPISU, czyli kategorii wczytanej z bazy.
    await waitFor(() => expect(result.current.selectedCats).toEqual(["cat-1"]));
  });
});

// ---------------------------------------------------------------------------
// Usunięcie wpisu
// ---------------------------------------------------------------------------

describe("usePostEditorForm - del()", () => {
  it("pyta o potwierdzenie, usuwa i wraca na listę", async () => {
    const { result } = harness();
    await waitFor(() => expect(result.current.form).not.toBeNull());

    await act(async () => {
      await result.current.del();
    });

    expect(confirmDialog()).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }));
    expect(del()).toHaveBeenCalledWith({ data: { id: postForm().id } });
    expect(navigate()).toHaveBeenCalledWith({ to: "/admin/posts" });
    expect(toast().success).toHaveBeenCalled();
  });

  it("odmowa potwierdzenia NIE usuwa niczego", async () => {
    confirmDialog().mockResolvedValue(false);
    const { result } = harness();
    await waitFor(() => expect(result.current.form).not.toBeNull());

    await act(async () => {
      await result.current.del();
    });

    expect(del()).not.toHaveBeenCalled();
    expect(navigate()).not.toHaveBeenCalled();
  });

  it("błąd usunięcia jest pokazany i NIE nawiguje", async () => {
    del().mockRejectedValue(new Error("nie można usunąć"));
    const { result } = harness();
    await waitFor(() => expect(result.current.form).not.toBeNull());

    await act(async () => {
      await result.current.del();
    });

    expect(toast().error).toHaveBeenCalled();
    // Nawigacja na listę po nieudanym usunięciu wyglądałaby jak sukces.
    expect(navigate()).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Skróty klawiaturowe (podłączenie reguły do okna)
// ---------------------------------------------------------------------------

describe("usePostEditorForm - skróty historii", () => {
  it("Ctrl+Z cofa zmianę w formularzu", async () => {
    const { result } = harness();
    await waitFor(() => expect(result.current.form).not.toBeNull());
    act(() => result.current.set("title_pl", "Wersja druga"));
    await waitFor(() => expect(result.current.form?.title_pl).toBe("Wersja druga"));

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true }));
    });

    await waitFor(() => expect(result.current.form?.title_pl).toBe(postForm().title_pl));
  });

  it("Shift+Ctrl+Z ponawia cofniętą zmianę", async () => {
    const { result } = harness();
    await waitFor(() => expect(result.current.form).not.toBeNull());
    act(() => result.current.set("title_pl", "Wersja druga"));
    await waitFor(() => expect(result.current.form?.title_pl).toBe("Wersja druga"));

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true }));
    });
    await waitFor(() => expect(result.current.form?.title_pl).toBe(postForm().title_pl));

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", ctrlKey: true, shiftKey: true }),
      );
    });

    await waitFor(() => expect(result.current.form?.title_pl).toBe("Wersja druga"));
  });

  it("nasłuch jest zdejmowany przy odmontowaniu", async () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { result, unmount } = harness();
    await waitFor(() => expect(result.current.form).not.toBeNull());

    unmount();

    expect(remove).toHaveBeenCalledWith("keydown", expect.any(Function));
    remove.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Inwalidacje
// ---------------------------------------------------------------------------

describe("usePostEditorForm - inwalidacje", () => {
  it("autosave NIE uruchamia ciężkich inwalidacji (to był „auto-refresh” edytora)", async () => {
    const { result } = harness();
    await waitFor(() => expect(result.current.form).not.toBeNull());

    await act(async () => {
      await result.current.applyStatus("pending_review");
    });

    // Cache widgetów, cache SEO i router.invalidate() przy KAŻDYM zapisie
    // powodowały ciągłe przeładowywanie edytora w trakcie pisania.
    expect(h.invalidateWidgetCaches as Mock).not.toHaveBeenCalled();
    expect(h.invalidateSeoCaches as Mock).not.toHaveBeenCalled();
  });

  it("przywrócenie rewizji odświeża wiersz wpisu i cache widgetów", async () => {
    const { result, client } = harness();
    await waitFor(() => expect(result.current.form).not.toBeNull());
    const spy = vi.spyOn(client, "invalidateQueries");

    act(() => result.current.onRevisionRestored());

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["post-by-slug", postEditorData().tenantId, "moj-wpis"],
      }),
    );
    expect(h.invalidateWidgetCaches as Mock).toHaveBeenCalled();
    expect(h.emitWidgetCacheInvalidate as Mock).toHaveBeenCalled();
  });

  it("odmontowanie BEZ zapisu nie odpala ciężkich inwalidacji", async () => {
    const { result, unmount } = harness();
    await waitFor(() => expect(result.current.form).not.toBeNull());

    unmount();

    expect(h.invalidateWidgetCaches as Mock).not.toHaveBeenCalled();
    expect(h.invalidateSeoCaches as Mock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Przeterminowany harmonogram
// ---------------------------------------------------------------------------

describe("usePostEditorForm - scheduledInPast", () => {
  it("wpis zaplanowany na przeszłość jest oznaczony", async () => {
    // Taki wpis czeka na najbliższy przebieg schedulera, a redaktor widzi status
    // „zaplanowany" i zakłada, że wszystko jest w porządku.
    const { result } = harness({
      post: postForm({ status: "scheduled", publish_at: "2020-01-01T00:00:00.000Z" }),
    });
    await waitFor(() => expect(result.current.form).not.toBeNull());
    expect(result.current.scheduledInPast).toBe(true);
  });

  it("wpis zaplanowany na przyszłość nie jest oznaczony", async () => {
    const { result } = harness({
      post: postForm({ status: "scheduled", publish_at: "2099-01-01T00:00:00.000Z" }),
    });
    await waitFor(() => expect(result.current.form).not.toBeNull());
    expect(result.current.scheduledInPast).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Checklista publikacji
// ---------------------------------------------------------------------------

describe("usePostEditorForm - publishChecklist", () => {
  it("kompletny wpis: wymagane pozycje spełnione", async () => {
    const { result } = harness();
    await waitFor(() => expect(result.current.form).not.toBeNull());
    expect(result.current.publishChecklist?.requiredOk).toBe(true);
  });

  it("brak okładki: pozycja `cover` na liście brakujących", async () => {
    const { result } = harness({ post: postForm({ cover_image_url: null }) });
    await waitFor(() => expect(result.current.form).not.toBeNull());
    const missing = result.current.publishChecklist?.missingRequired.map((i) => i.id);
    expect(missing).toContain("cover");
  });

  it("braki deklaracji komercyjnej wchodzą do checklisty przez tę samą funkcję domenową", async () => {
    // Checklista nie liczy tej reguły po swojemu - woła `disclosureGaps`, tę
    // samą, której używa bramka serwerowa. Inaczej UI i serwer rozjechałyby się.
    const { result } = harness({
      post: postForm({ is_sponsored: true, sponsored_kind: null }),
    });
    await waitFor(() => expect(result.current.form).not.toBeNull());
    const ids = result.current.publishChecklist?.items.map((i) => i.id) ?? [];
    expect(ids).toContain("sponsoredDisclosure");
    expect(result.current.publishChecklist?.requiredOk).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Wklejone grafiki (data-URL z Worda / zrzutów ekranu)
// ---------------------------------------------------------------------------

describe("usePostEditorForm - wklejone grafiki przy zapisie", () => {
  /** Formularz z dokumentem bloków - bez niego ścieżka grafik nawet nie startuje. */
  const withBlocks = () =>
    postForm({
      blocks_data: {
        pl: { version: 1, blocks: [{ type: "image", src: "data:image/png;base64,AAAA" }] },
      } as unknown as ReturnType<typeof postForm>["blocks_data"],
    });

  it("wgrane grafiki wchodzą do ZAPISYWANEJ migawki, nie tylko do formularza", async () => {
    // Baza nie przechowuje base64. Gdyby podmiana trafiała wyłącznie do stanu
    // formularza, do bazy poszedłby dokument z data-URL - i grafika zniknęłaby
    // po odświeżeniu, a biblioteka mediów nigdy by jej nie zobaczyła.
    const persisted = {
      pl: { version: 1, blocks: [{ type: "image", src: "https://storage.example/x.png" }] },
    };
    h.persistResult = {
      doc: persisted,
      changed: true,
      failed: 0,
      replacements: new Map([["data:image/png;base64,AAAA", "https://storage.example/x.png"]]),
    };

    const { result } = harness({ post: withBlocks() });
    await waitFor(() => expect(result.current.form).not.toBeNull());

    await act(async () => {
      await result.current.applyStatus("pending_review");
    });

    const payload = update().mock.calls[0][0] as { data: { fields: Record<string, unknown> } };
    expect(payload.data.fields.blocks_data).toEqual(persisted);
  });

  it("nieudane wgranie części grafik OSTRZEGA, ale nie przerywa zapisu", async () => {
    // Redaktor musi wiedzieć, że dwie grafiki nie doszły - ale tekst, który
    // właśnie napisał, ma się zapisać. Przerwanie zapisu z powodu grafiki
    // kosztowałoby więcej, niż ratuje.
    h.persistResult = {
      doc: null,
      changed: false,
      failed: 2,
      replacements: new Map<string, string>(),
    };

    const { result } = harness({ post: withBlocks() });
    await waitFor(() => expect(result.current.form).not.toBeNull());

    await act(async () => {
      await result.current.applyStatus("pending_review");
    });

    const warnings = toast().warning.mock.calls.map((c) => String(c[0]));
    expect(warnings.some((m) => m.includes("blocks.clipboard.imagePersistFailed"))).toBe(true);
    expect(warnings.some((m) => m.includes('"count":2'))).toBe(true);
    // Zapis mimo wszystko doszedł.
    expect(update()).toHaveBeenCalledTimes(1);
    expect(toast().success).toHaveBeenCalled();
  });

  it("brak grafik: żadnego ostrzeżenia i żadnej podmiany dokumentu", async () => {
    const { result } = harness({ post: withBlocks() });
    await waitFor(() => expect(result.current.form).not.toBeNull());

    await act(async () => {
      await result.current.applyStatus("pending_review");
    });

    expect(toast().warning).not.toHaveBeenCalled();
    const payload = update().mock.calls[0][0] as { data: { fields: Record<string, unknown> } };
    // Dokument przechodzi w postaci, w jakiej był - `changed: false`.
    expect(payload.data.fields.blocks_data).toEqual(withBlocks().blocks_data);
  });

  it("dokument pusty pomija całą ścieżkę wgrywania", async () => {
    // `blocks_data: null` - nie ma czego skanować, więc nie wołamy uploadu ani
    // nie ruszamy formularza.
    h.persistResult = {
      doc: null,
      changed: true,
      failed: 3,
      replacements: new Map<string, string>(),
    };
    const { result } = harness({ post: postForm({ blocks_data: null, builder_data: null }) });
    await waitFor(() => expect(result.current.form).not.toBeNull());

    await act(async () => {
      await result.current.applyStatus("pending_review");
    });

    // Gdyby strażnik `!doc` nie działał, zobaczylibyśmy ostrzeżenie o 3 błędach.
    expect(toast().warning).not.toHaveBeenCalled();
  });
});

describe("usePostEditorForm - upload wklejonej grafiki", () => {
  const withBlocksDoc = () =>
    postForm({
      blocks_data: {
        pl: { version: 1, blocks: [{ type: "image", src: "data:image/png;base64,AAAA" }] },
      } as unknown as ReturnType<typeof postForm>["blocks_data"],
    });

  it("grafika ląduje w bibliotece WŁAŚCIWEGO najemcy, w katalogu wpisów", async () => {
    // Wklejona grafika staje się trwałym plikiem w /admin/media. Zły `tenantId`
    // wpuściłby ją do biblioteki obcej firmy - i to bez żadnego sygnału dla
    // redaktora, bo dokument dostałby poprawny adres publiczny.
    h.runUpload = true;
    h.persistResult = {
      doc: null,
      changed: false,
      failed: 0,
      replacements: new Map<string, string>(),
    };

    const { result } = harness({ post: withBlocksDoc() });
    await waitFor(() => expect(result.current.form).not.toBeNull());

    await act(async () => {
      await result.current.applyStatus("pending_review");
    });

    expect(h.uploadArgs.length).toBeGreaterThan(0);
    const args = h.uploadArgs[0];
    expect(args.tenantId).toBe(postEditorData().tenantId);
    expect(args.userId).toBe("user-1");
    expect(args.subfolder).toBe("posts");
    expect(args.allowedMime).toEqual(["image/png"]);
    // Plik zbudowany z dekodowanych bajtów, z nazwą i typem z data-URL.
    const file = args.file as File;
    expect(file.name).toBe("wklejka.png");
    expect(file.type).toBe("image/png");
  });
});

// ---------------------------------------------------------------------------
// Stan „wpis jeszcze się nie wczytał" i błędy nie-Error
// ---------------------------------------------------------------------------

describe("usePostEditorForm - formularz przed wczytaniem wpisu", () => {
  const empty = () => ({ post: undefined, id: "", postCats: undefined });

  it("bez wiersza wpisu formularz jest pusty, a checklista nie istnieje", async () => {
    const { result } = harness(empty() as Parameters<typeof postEditorData>[0]);
    expect(result.current.form).toBeNull();
    // Karta checklisty nie ma z czego liczyć - `null`, nie zerowa punktacja
    // udająca ocenę pustego wpisu.
    expect(result.current.publishChecklist).toBeNull();
    expect(result.current.scheduledInPast).toBe(false);
  });

  it("`set` na pustym formularzu jest bezpieczny (nie tworzy wpisu z powietrza)", async () => {
    const { result } = harness(empty() as Parameters<typeof postEditorData>[0]);
    act(() => result.current.set("title_pl", "Tytuł bez wpisu"));
    expect(result.current.form).toBeNull();
  });

  it("`applyStatus` na pustym formularzu nic nie zapisuje", async () => {
    const { result } = harness(empty() as Parameters<typeof postEditorData>[0]);
    await act(async () => {
      await result.current.applyStatus("published");
    });
    expect(update()).not.toHaveBeenCalled();
  });

  it("`confirmPublishGaps` bez formularza przepuszcza (nie ma czego pilnować)", async () => {
    const { result } = harness(empty() as Parameters<typeof postEditorData>[0]);
    await expect(result.current.confirmPublishGaps("published")).resolves.toBe(true);
    expect(confirmDialog()).not.toHaveBeenCalled();
  });

  it("wiersz bez updated_at nie ustawia bazy optimistic-locka", async () => {
    // Wiersz sprzed dodania kolumny albo odpowiedź bez tego pola: zapis nie może
    // wysłać `baseUpdatedAt: null`, bo serwer potraktowałby to jak konflikt.
    const { result } = harness({ post: postForm({ updated_at: null }) });
    await waitFor(() => expect(result.current.form).not.toBeNull());

    await act(async () => {
      await result.current.applyStatus("pending_review");
    });

    const payload = update().mock.calls[0][0] as { data: { baseUpdatedAt?: string } };
    expect(payload.data.baseUpdatedAt).toBeUndefined();
  });
});

describe("usePostEditorForm - błąd, który nie jest instancją Error", () => {
  it("applyStatus: surowy string jest pokazany, nie zjedzony", async () => {
    // Błąd przechodzi granicę server-fn i nie zawsze dociera jako Error.
    // Bez `String(e)` redaktor zobaczyłby „undefined" zamiast powodu.
    update().mockRejectedValue("serwer zwrócił goły tekst");
    const { result } = harness();
    await waitFor(() => expect(result.current.form).not.toBeNull());

    await act(async () => {
      await result.current.applyStatus("pending_review");
    });

    expect(toast().error).toHaveBeenCalledWith("serwer zwrócił goły tekst");
  });

  it("save(): surowy obiekt jest zserializowany do komunikatu", async () => {
    update().mockRejectedValue({ code: 500 });
    const { result } = harness();
    await waitFor(() => expect(result.current.form).not.toBeNull());
    act(() => result.current.set("title_pl", "Zmiana"));

    await act(async () => {
      await result.current.save();
    });

    expect(toast().error).toHaveBeenCalled();
    expect(toast().success).not.toHaveBeenCalled();
  });

  it("del(): surowy string jest pokazany i nie ma nawigacji", async () => {
    del().mockRejectedValue("brak uprawnień");
    const { result } = harness();
    await waitFor(() => expect(result.current.form).not.toBeNull());

    await act(async () => {
      await result.current.del();
    });

    expect(toast().error).toHaveBeenCalledWith("brak uprawnień");
    expect(navigate()).not.toHaveBeenCalled();
  });
});

describe("usePostEditorForm - klawisz, który nie jest skrótem historii", () => {
  it("Ctrl+S nie rusza historii formularza", async () => {
    const { result } = harness();
    await waitFor(() => expect(result.current.form).not.toBeNull());
    act(() => result.current.set("title_pl", "Wersja druga"));
    await waitFor(() => expect(result.current.form?.title_pl).toBe("Wersja druga"));

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true }));
    });

    // Gdyby `historyShortcut` zwracał akcję dla Ctrl+S, tekst by się cofnął.
    expect(result.current.form?.title_pl).toBe("Wersja druga");
  });

  it("zwykła litera bez modyfikatora też nie rusza historii", async () => {
    const { result } = harness();
    await waitFor(() => expect(result.current.form).not.toBeNull());
    act(() => result.current.set("title_pl", "Wersja druga"));
    await waitFor(() => expect(result.current.form?.title_pl).toBe("Wersja druga"));

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "z" }));
    });

    expect(result.current.form?.title_pl).toBe("Wersja druga");
  });
});
