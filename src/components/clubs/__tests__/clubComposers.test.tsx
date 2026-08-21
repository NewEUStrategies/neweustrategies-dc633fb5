// Kompozytory krótkiej formy: wpis ze ściany (`ClubPostComposer`) i redakcja
// wpisu w miejscu (`ClubInlineEditor`).
//
// CO TEN PLIK DOWODZI.
//  1. PAYLOAD wysyłki wpisu - przez PRAWDZIWĄ warstwę danych (`createClubPost`
//     -> `supabase.rpc`), więc asercja patrzy na nazwy argumentów RPC, a nie na
//     zaślepkę hooka. Zgubiony `p_group_id` to cicha utrata zawężenia działu.
//  2. PLIKI LECĄ OD RAZU po wybraniu, nie przy wysyłce: pusty wybór nie startuje
//     wgrywania, odmowa magazynu pokazuje komunikat z wyjątku (a bez wyjątku -
//     klucz zapasowy), a nieudane sprzątanie kubełka NIE cofa usunięcia z listy.
//  3. STAN PRZYCISKU: pusta treść bez plików blokuje wysyłkę, trwająca wysyłka
//     blokuje przycisk i drugie kliknięcie nie wysyła drugiego żądania.
//  4. SKRÓTY KLAWIATURY: Cmd/Ctrl+Enter wysyła, a Enter na punktorze przechodzi
//     przez autoformat listy i przestawia karetkę.
//  5. REGUŁA ZAPISU redakcji: próg dziesięciu znaków treści, próg trzech znaków
//     tytułu, wymóg JAKIEJKOLWIEK zmiany oraz powód widoczny WYŁĄCZNIE moderacji
//     i normalizowany do `null`, gdy są w nim same spacje.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//  - REGUŁ autoformatu list: `applyListAutoformat` ma własne testy na czystej
//    funkcji; tutaj dowodzimy tylko, że kompozytor ją WOŁA i respektuje wynik
//    (podmiana treści + pozycja karetki).
//  - WALIDACJI typu i rozmiaru załącznika: siedzi w `uploadClubPostMedia`
//    (`postsApi`) i tam jest testowana. Kompozytor widzi z niej tylko wyjątek.
//  - UNIEWAŻNIANIA cache po wpisie: to kontrakt `useCreateClubPost`.
//  - UPRAWNIEŃ: `canPost` przychodzi z `club_capabilities`; tutaj sprawdzamy
//    jedynie, że fałsz nie renderuje powierzchni pisania.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ClubPostMediaAttachment } from "@/lib/clubs/postTypes";

const h = vi.hoisted(() => ({
  toast: {
    success: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>(),
  },
  upload: vi.fn<(file: File) => Promise<ClubPostMediaAttachment>>(),
  removeMedia: vi.fn<(path: string) => Promise<void>>(),
  /** Zatrzask odpowiedzi RPC - pozwala zobaczyć stan „wysyłka w locie”. */
  gate: null as Promise<void> | null,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("sonner", () => ({ toast: h.toast }));

vi.mock("@/integrations/supabase/client", async () => {
  const { clubSupabaseMock } = await import("@/test/clubs/fixtures");
  return {
    supabase: {
      ...clubSupabaseMock.supabase,
      // Wywołanie zapisuje się NATYCHMIAST (żeby dało się asertować „jedno
      // żądanie”), a jego rozwiązanie czeka na zatrzask.
      rpc: (name: string, args?: Record<string, unknown>) => {
        const result = clubSupabaseMock.supabase.rpc(name, args);
        const gate = h.gate;
        return gate === null ? result : gate.then(() => result);
      },
    },
  };
});

vi.mock("@/lib/clubs/postsApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/clubs/postsApi")>();
  return { ...actual, uploadClubPostMedia: h.upload, removeClubPostMedia: h.removeMedia };
});

import { ClubPostComposer } from "@/components/clubs/molecules/ClubPostComposer";
import { ClubInlineEditor } from "@/components/clubs/molecules/ClubInlineEditor";
import { CLUB_IDS, clubRpc, resetClubRpc } from "@/test/clubs/fixtures";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { translateKey } from "@/test/i18nStub";

const CREATE_RPC = "club_post_create";

function attachment(overrides: Partial<ClubPostMediaAttachment> = {}): ClubPostMediaAttachment {
  return {
    type: "file",
    path: `${CLUB_IDS.me}/raport.pdf`,
    name: "raport.pdf",
    mime: "application/pdf",
    size: 1024,
    width: null,
    height: null,
    ...overrides,
  };
}

function bodyField(): HTMLTextAreaElement {
  const el = screen.getByLabelText(translateKey("club.post.placeholder"));
  if (!(el instanceof HTMLTextAreaElement)) throw new Error("pole treści nie jest polem tekstowym");
  return el;
}

function fileField(container: HTMLElement): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (el === null) throw new Error("brak ukrytego wejścia plików");
  return el;
}

function publishButton(): HTMLElement {
  return screen.getByRole("button", { name: translateKey("club.post.publish") });
}

function mediaButton(): HTMLElement {
  return screen.getByRole("button", { name: translateKey("club.post.addMedia") });
}

/** Podstawia listę plików w ukrytym wejściu i emituje `change`. */
function chooseFiles(container: HTMLElement, files: File[] | null): void {
  const input = fileField(container);
  Object.defineProperty(input, "files", { value: files, configurable: true });
  fireEvent.change(input);
}

function typeBody(value: string): HTMLTextAreaElement {
  const field = bodyField();
  fireEvent.change(field, { target: { value } });
  return field;
}

beforeEach(() => {
  resetClubRpc();
  h.toast.success.mockReset();
  h.toast.error.mockReset();
  h.upload.mockReset();
  h.removeMedia.mockReset();
  h.removeMedia.mockResolvedValue(undefined);
  h.gate = null;
  clubRpc.setData(CREATE_RPC, [{ post_id: "post-1" }]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ClubPostComposer - powierzchnia pisania", () => {
  it("bez uprawnienia do pisania nie renderuje niczego", () => {
    const { container } = renderWithQueryClient(
      <ClubPostComposer clubId={CLUB_IDS.club} canPost={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("wariant w ramce dokłada powierzchnię karty, bez ramki jej nie ma", () => {
    const { container } = renderWithQueryClient(
      <ClubPostComposer clubId={CLUB_IDS.club} canPost className="moja-klasa" />,
    );
    const framed = container.querySelector('[data-testid="club-post-composer"]');
    expect(framed).toHaveClass("border-border/60", "moja-klasa");

    cleanup();
    const bare = renderWithQueryClient(
      <ClubPostComposer clubId={CLUB_IDS.club} canPost chromeless className="moja-klasa" />,
    ).container.querySelector('[data-testid="club-post-composer"]');
    expect(bare).toHaveClass("moja-klasa");
    expect(bare).not.toHaveClass("border-border/60");
  });

  it("pusta treść bez załączników blokuje przycisk i nie wysyła żądania", () => {
    renderWithQueryClient(<ClubPostComposer clubId={CLUB_IDS.club} canPost />);
    expect(publishButton()).toBeDisabled();

    typeBody("   ");
    expect(publishButton()).toBeDisabled();
    fireEvent.click(publishButton());
    expect(clubRpc.callsFor(CREATE_RPC)).toHaveLength(0);
  });
});

describe("ClubPostComposer - payload wysyłki", () => {
  it("niesie klub, dział, wątek i PRZYCIĘTĄ treść, a po sukcesie czyści pole", async () => {
    renderWithQueryClient(
      <ClubPostComposer
        clubId={CLUB_IDS.club}
        groupId={CLUB_IDS.group}
        threadId={CLUB_IDS.thread}
        canPost
      />,
    );
    typeBody("  Notatka z posiedzenia  ");
    fireEvent.click(publishButton());

    await waitFor(() => expect(clubRpc.callsFor(CREATE_RPC)).toHaveLength(1));
    const call = clubRpc.lastCall(CREATE_RPC);
    expect(call?.arg("p_club_id")).toBe(CLUB_IDS.club);
    expect(call?.arg("p_group_id")).toBe(CLUB_IDS.group);
    expect(call?.arg("p_thread_id")).toBe(CLUB_IDS.thread);
    expect(call?.arg("p_body")).toBe("Notatka z posiedzenia");
    expect(call?.arg("p_attachments")).toEqual([]);
    await waitFor(() => expect(bodyField()).toHaveValue(""));
    expect(h.toast.success).toHaveBeenCalledWith("club.post.published");
  });

  it("bez działu i bez wątku nie dokłada tych zawężeń do RPC", async () => {
    renderWithQueryClient(<ClubPostComposer clubId={CLUB_IDS.club} canPost />);
    typeBody("Wpis bez działu");
    fireEvent.click(publishButton());

    await waitFor(() => expect(clubRpc.callsFor(CREATE_RPC)).toHaveLength(1));
    const call = clubRpc.lastCall(CREATE_RPC);
    expect(call?.arg("p_group_id")).toBeUndefined();
    expect(call?.arg("p_thread_id")).toBeUndefined();
  });

  it("sam załącznik bez treści też jest wpisem", async () => {
    h.upload.mockResolvedValue(attachment());
    const { container } = renderWithQueryClient(
      <ClubPostComposer clubId={CLUB_IDS.club} canPost />,
    );
    chooseFiles(container, [new File(["x"], "raport.pdf", { type: "application/pdf" })]);
    await screen.findByText("raport.pdf");

    expect(publishButton()).toBeEnabled();
    fireEvent.click(publishButton());

    await waitFor(() => expect(clubRpc.callsFor(CREATE_RPC)).toHaveLength(1));
    expect(clubRpc.lastCall(CREATE_RPC)?.arg("p_body")).toBe("");
    expect(clubRpc.lastCall(CREATE_RPC)?.arg("p_attachments")).toEqual([attachment()]);
    await waitFor(() => expect(screen.queryByText("raport.pdf")).toBeNull());
  });

  it("odmowa bazy pokazuje jej komunikat i ZOSTAWIA napisaną treść", async () => {
    clubRpc.setError(CREATE_RPC, "club_post_denied");
    renderWithQueryClient(<ClubPostComposer clubId={CLUB_IDS.club} canPost />);
    typeBody("Treść do zachowania");
    fireEvent.click(publishButton());

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("club_post_denied"));
    expect(bodyField()).toHaveValue("Treść do zachowania");
    expect(h.toast.success).not.toHaveBeenCalled();
  });

  it("wysyłka w locie blokuje przycisk, a drugie kliknięcie nie wysyła drugi raz", async () => {
    let open = (): void => undefined;
    h.gate = new Promise<void>((resolve) => {
      open = () => resolve();
    });
    const { container } = renderWithQueryClient(
      <ClubPostComposer clubId={CLUB_IDS.club} canPost />,
    );
    typeBody("Wpis wysyłany raz");
    fireEvent.click(publishButton());

    await waitFor(() => expect(publishButton()).toBeDisabled());
    expect(mediaButton()).toBeDisabled();
    expect(container.querySelector(".animate-spin")).not.toBeNull();

    fireEvent.click(publishButton());
    expect(clubRpc.callsFor(CREATE_RPC)).toHaveLength(1);

    open();
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith("club.post.published"));
  });
});

describe("ClubPostComposer - załączniki", () => {
  it("wybrane pliki wgrywają się od razu i wchodzą na listę", async () => {
    h.upload
      .mockResolvedValueOnce(attachment())
      .mockResolvedValueOnce(
        attachment({ path: "p/zdjecie.png", name: "zdjecie.png", type: "image" }),
      );
    const { container } = renderWithQueryClient(
      <ClubPostComposer clubId={CLUB_IDS.club} canPost />,
    );
    chooseFiles(container, [
      new File(["a"], "raport.pdf", { type: "application/pdf" }),
      new File(["b"], "zdjecie.png", { type: "image/png" }),
    ]);

    await screen.findByText("zdjecie.png");
    expect(screen.getByText("raport.pdf")).toBeInTheDocument();
    expect(h.upload).toHaveBeenCalledTimes(2);
    expect(fileField(container).value).toBe("");
  });

  it("wgrywanie w locie pokazuje kręciołek i blokuje przyciski", async () => {
    let finish = (value: ClubPostMediaAttachment): void => void value;
    h.upload.mockImplementation(
      () =>
        new Promise<ClubPostMediaAttachment>((resolve) => {
          finish = resolve;
        }),
    );
    const { container } = renderWithQueryClient(
      <ClubPostComposer clubId={CLUB_IDS.club} canPost />,
    );
    chooseFiles(container, [new File(["a"], "raport.pdf", { type: "application/pdf" })]);

    await waitFor(() => expect(mediaButton()).toBeDisabled());
    expect(container.querySelector(".animate-spin")).not.toBeNull();

    finish(attachment());
    await screen.findByText("raport.pdf");
    expect(mediaButton()).toBeEnabled();
  });

  it("widoczny przycisk otwiera ukryte wejście plików", () => {
    const { container } = renderWithQueryClient(
      <ClubPostComposer clubId={CLUB_IDS.club} canPost />,
    );
    const opened = vi.fn<() => void>();
    fileField(container).addEventListener("click", opened);

    fireEvent.click(mediaButton());

    expect(opened).toHaveBeenCalledTimes(1);
  });

  it("pusty i niezainicjowany wybór nie startuje wgrywania", () => {
    const { container } = renderWithQueryClient(
      <ClubPostComposer clubId={CLUB_IDS.club} canPost />,
    );
    chooseFiles(container, []);
    chooseFiles(container, null);
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("odmowa magazynu pokazuje komunikat z wyjątku i zeruje wejście plików", async () => {
    h.upload.mockRejectedValue(new Error("Plik przekracza limit"));
    const { container } = renderWithQueryClient(
      <ClubPostComposer clubId={CLUB_IDS.club} canPost />,
    );
    chooseFiles(container, [new File(["a"], "wielki.pdf", { type: "application/pdf" })]);

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("Plik przekracza limit"));
    expect(screen.queryByText("wielki.pdf")).toBeNull();
    expect(fileField(container).value).toBe("");
  });

  it("awaria bez obiektu Error spada na klucz zapasowy", async () => {
    h.upload.mockRejectedValue("zerwane połączenie");
    const { container } = renderWithQueryClient(
      <ClubPostComposer clubId={CLUB_IDS.club} canPost />,
    );
    chooseFiles(container, [new File(["a"], "raport.pdf", { type: "application/pdf" })]);

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("club.post.uploadFailed"));
  });

  it("usunięcie załącznika zdejmuje go z listy i sprząta kubełek", async () => {
    h.upload.mockResolvedValue(attachment());
    const { container } = renderWithQueryClient(
      <ClubPostComposer clubId={CLUB_IDS.club} canPost />,
    );
    chooseFiles(container, [new File(["a"], "raport.pdf", { type: "application/pdf" })]);
    await screen.findByText("raport.pdf");

    fireEvent.click(
      screen.getByRole("button", {
        name: translateKey("club.post.removeAttachment", { name: "raport.pdf" }),
      }),
    );

    expect(screen.queryByText("raport.pdf")).toBeNull();
    expect(h.removeMedia).toHaveBeenCalledWith(`${CLUB_IDS.me}/raport.pdf`);
  });

  it("nieudane sprzątanie kubełka NIE cofa usunięcia z listy", async () => {
    h.upload.mockResolvedValue(attachment());
    h.removeMedia.mockRejectedValue(new Error("brak dostępu do kubełka"));
    const { container } = renderWithQueryClient(
      <ClubPostComposer clubId={CLUB_IDS.club} canPost />,
    );
    chooseFiles(container, [new File(["a"], "raport.pdf", { type: "application/pdf" })]);
    await screen.findByText("raport.pdf");

    fireEvent.click(
      screen.getByRole("button", {
        name: translateKey("club.post.removeAttachment", { name: "raport.pdf" }),
      }),
    );

    expect(screen.queryByText("raport.pdf")).toBeNull();
    await waitFor(() => expect(h.removeMedia).toHaveBeenCalledTimes(1));
    expect(h.toast.error).not.toHaveBeenCalled();
  });
});

describe("ClubPostComposer - klawiatura", () => {
  it("Cmd+Enter i Ctrl+Enter wysyłają wpis", async () => {
    renderWithQueryClient(<ClubPostComposer clubId={CLUB_IDS.club} canPost />);
    const field = typeBody("Wysyłka skrótem");
    fireEvent.keyDown(field, { key: "Enter", metaKey: true });
    await waitFor(() => expect(clubRpc.callsFor(CREATE_RPC)).toHaveLength(1));

    typeBody("Druga wysyłka skrótem");
    fireEvent.keyDown(bodyField(), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(clubRpc.callsFor(CREATE_RPC)).toHaveLength(2));
  });

  it("Ctrl+Enter przy pustym polu nie wysyła pustego wpisu", () => {
    renderWithQueryClient(<ClubPostComposer clubId={CLUB_IDS.club} canPost />);
    fireEvent.keyDown(bodyField(), { key: "Enter", ctrlKey: true });
    expect(clubRpc.callsFor(CREATE_RPC)).toHaveLength(0);
  });

  it("Enter na punktorze dopisuje kolejny punktor i przestawia karetkę", () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    renderWithQueryClient(<ClubPostComposer clubId={CLUB_IDS.club} canPost />);
    const field = typeBody("- alfa");
    field.selectionStart = field.value.length;
    field.selectionEnd = field.value.length;

    fireEvent.keyDown(field, { key: "Enter" });

    expect(bodyField().value).toBe("- alfa\n- ");
    expect(bodyField().selectionStart).toBe("- alfa\n- ".length);
    expect(clubRpc.callsFor(CREATE_RPC)).toHaveLength(0);
  });

  it("gdy przeglądarka nie zgłasza zaznaczenia, autoformat liczy od końca treści", () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    renderWithQueryClient(<ClubPostComposer clubId={CLUB_IDS.club} canPost />);
    const field = typeBody("1. alfa");
    // Zaznaczenie bywa `null` w polach, które go nie raportują - kompozytor ma
    // wtedy przyjąć koniec treści, a nie wywalić się na `null`.
    Object.defineProperty(field, "selectionStart", { value: null, configurable: true });
    Object.defineProperty(field, "selectionEnd", { value: null, configurable: true });

    fireEvent.keyDown(field, { key: "Enter" });

    expect(bodyField().value).toBe("1. alfa\n2. ");
  });

  it("zwykły znak nie przechodzi przez autoformat", () => {
    renderWithQueryClient(<ClubPostComposer clubId={CLUB_IDS.club} canPost />);
    const field = typeBody("- alfa");
    field.selectionStart = field.value.length;
    field.selectionEnd = field.value.length;

    fireEvent.keyDown(field, { key: "a" });

    expect(bodyField().value).toBe("- alfa");
  });
});

describe("ClubInlineEditor - reguła zapisu", () => {
  const saveButton = (): HTMLElement =>
    screen.getByRole("button", { name: translateKey("common.save") });
  const cancelButton = (): HTMLElement =>
    screen.getByRole("button", { name: translateKey("common.cancel") });

  it("odpowiedź nie ma pola tytułu, a jej zapis nie niesie klucza tytułu", () => {
    const onSave =
      vi.fn<(patch: { title?: string; body: string; reason: string | null }) => void>();
    render(
      <ClubInlineEditor
        idPrefix="reply-1"
        initialBody="Pierwotna treść odpowiedzi"
        showReason={false}
        pending={false}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    );
    expect(screen.queryByLabelText(translateKey("club.editor.titleLabel"))).toBeNull();
    expect(screen.queryByLabelText(translateKey("club.editor.reasonLabel"))).toBeNull();

    fireEvent.change(screen.getByLabelText(translateKey("club.editor.bodyLabel")), {
      target: { value: "Poprawiona treść odpowiedzi" },
    });
    fireEvent.click(saveButton());

    expect(onSave).toHaveBeenCalledWith({ body: "Poprawiona treść odpowiedzi", reason: null });
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty("title");
  });

  it("treść krótsza niż dziesięć znaków oraz brak zmiany blokują zapis", () => {
    render(
      <ClubInlineEditor
        idPrefix="reply-1"
        initialBody="Pierwotna treść odpowiedzi"
        showReason={false}
        pending={false}
        onCancel={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(saveButton()).toBeDisabled();

    const field = screen.getByLabelText(translateKey("club.editor.bodyLabel"));
    fireEvent.change(field, { target: { value: "za krótko" } });
    expect(saveButton()).toBeDisabled();

    fireEvent.change(field, { target: { value: "  Pierwotna treść odpowiedzi  " } });
    expect(saveButton()).toBeDisabled();
  });

  it("wątek wymaga tytułu od trzech znaków, a sama zmiana tytułu wystarczy do zapisu", () => {
    const onSave =
      vi.fn<(patch: { title?: string; body: string; reason: string | null }) => void>();
    render(
      <ClubInlineEditor
        idPrefix="thread-1"
        initialTitle="Tytuł pierwotny"
        initialBody="Treść wątku o dłuższej formie"
        showReason={false}
        pending={false}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    );
    const title = screen.getByLabelText(translateKey("club.editor.titleLabel"));
    fireEvent.change(title, { target: { value: "ab" } });
    expect(saveButton()).toBeDisabled();

    fireEvent.change(title, { target: { value: "  Tytuł poprawiony  " } });
    expect(saveButton()).toBeEnabled();
    fireEvent.click(saveButton());

    expect(onSave).toHaveBeenCalledWith({
      title: "Tytuł poprawiony",
      body: "Treść wątku o dłuższej formie",
      reason: null,
    });
  });

  it("moderacja podaje powód, a powód z samych spacji schodzi do null", () => {
    const onSave =
      vi.fn<(patch: { title?: string; body: string; reason: string | null }) => void>();
    render(
      <ClubInlineEditor
        idPrefix="thread-1"
        initialBody="Treść cudzego wpisu do korekty"
        showReason
        pending={false}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    );
    fireEvent.change(screen.getByLabelText(translateKey("club.editor.bodyLabel")), {
      target: { value: "Treść cudzego wpisu po korekcie" },
    });
    const reason = screen.getByLabelText(translateKey("club.editor.reasonLabel"));
    fireEvent.change(reason, { target: { value: "   " } });
    fireEvent.click(saveButton());
    expect(onSave).toHaveBeenLastCalledWith({
      body: "Treść cudzego wpisu po korekcie",
      reason: null,
    });

    fireEvent.change(reason, { target: { value: "  mowa nienawiści  " } });
    fireEvent.click(saveButton());
    expect(onSave).toHaveBeenLastCalledWith({
      body: "Treść cudzego wpisu po korekcie",
      reason: "mowa nienawiści",
    });
    expect(screen.getByText(translateKey("club.editor.reasonHint"))).toBeInTheDocument();
  });

  it("trwający zapis blokuje pola, oba przyciski i pokazuje kręciołek", () => {
    const { container } = render(
      <ClubInlineEditor
        idPrefix="thread-1"
        initialTitle="Tytuł pierwotny"
        initialBody="Treść wątku o dłuższej formie"
        showReason
        pending
        onCancel={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(translateKey("club.editor.titleLabel"))).toBeDisabled();
    expect(screen.getByLabelText(translateKey("club.editor.bodyLabel"))).toBeDisabled();
    expect(screen.getByLabelText(translateKey("club.editor.reasonLabel"))).toBeDisabled();
    expect(saveButton()).toBeDisabled();
    expect(cancelButton()).toBeDisabled();
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("anulowanie oddaje decyzję rodzicowi", () => {
    const onCancel = vi.fn<() => void>();
    render(
      <ClubInlineEditor
        idPrefix="reply-1"
        initialBody="Pierwotna treść odpowiedzi"
        showReason={false}
        pending={false}
        onCancel={onCancel}
        onSave={vi.fn()}
      />,
    );
    fireEvent.click(cancelButton());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("świeższa treść z zewnątrz nadpisuje formularz", () => {
    const { rerender } = render(
      <ClubInlineEditor
        idPrefix="thread-1"
        initialTitle="Tytuł pierwotny"
        initialBody="Treść wątku o dłuższej formie"
        showReason={false}
        pending={false}
        onCancel={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(translateKey("club.editor.bodyLabel")), {
      target: { value: "Moja lokalna kopia treści" },
    });

    rerender(
      <ClubInlineEditor
        idPrefix="thread-1"
        initialTitle="Tytuł po korekcie moderatora"
        initialBody="Treść po korekcie moderatora"
        showReason={false}
        pending={false}
        onCancel={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(translateKey("club.editor.titleLabel"))).toHaveValue(
      "Tytuł po korekcie moderatora",
    );
    expect(screen.getByLabelText(translateKey("club.editor.bodyLabel"))).toHaveValue(
      "Treść po korekcie moderatora",
    );
  });
});
