// Karta „Linki podglądu (embargo)" edytora wpisu: tokenowe adresy do szkicu,
// lista aktywnych z datą wygaśnięcia, kopiowanie i odwołanie.
//
// CO TU DOWODZIMY:
//   * link tworzy się z ustalonym czasem życia (72 h) dla TEGO wpisu,
//   * adres podglądu składa się z origin bieżącej instancji + /preview/<token>,
//   * skopiowanie do schowka jest potwierdzane, a AWARIA schowka nie udaje
//     sukcesu (użytkownik dostaje inny komunikat, bo linku nie ma w schowku),
//   * odwołanie linku unieważnia listę i jest zabezpieczone przed podwójnym
//     kliknięciem (dwa odwołania tego samego tokenu to jedno żądanie),
//   * data wygaśnięcia jest formatowana w języku panelu (pl-PL / en-GB),
//   * każdy błąd serwera jest POKAZANY, nie zjedzony.
//
// DLACZEGO TO WAŻNE: te linki dają dostęp do NIEOPUBLIKOWANEJ treści bez konta -
// to narzędzie embarga. Cicha awaria kopiowania oznacza, że redaktor wysyła
// dziennikarzowi pusty schowek (albo stary link); niedziałające odwołanie
// zostawia otwarty dostęp do materiału pod embargiem; brak komunikatu o błędzie
// tworzenia sprawia, że redakcja czeka na link, którego nigdy nie było.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { BASE_ISO, EDITOR_IDS, isoOffset } from "@/test/post-editor/fixtures";

const h = vi.hoisted(() => ({
  lang: "pl",
  create: null as unknown,
  list: null as unknown,
  revoke: null as unknown,
  toast: null as unknown,
  writeText: null as unknown,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(() => h.lang),
);
vi.mock("@/lib/i18n-admin-post-panes", () => ({}));

vi.mock("@tanstack/react-start", () => ({
  // `useServerFn` w produkcji tylko owija funkcję serwerową - oddajemy ją wprost.
  useServerFn: (fn: unknown) => fn,
}));

vi.mock("@/lib/content/previewTokens.functions", async () => {
  const { vi: v } = await import("vitest");
  h.create = v.fn();
  h.list = v.fn();
  h.revoke = v.fn();
  return {
    createPreviewToken: h.create,
    listPreviewTokens: h.list,
    revokePreviewToken: h.revoke,
  };
});

vi.mock("sonner", async () => {
  const { toastStub } = await import("@/test/post-editor/fixtures");
  const toast = toastStub();
  h.toast = toast;
  return { toast, Toaster: () => null };
});

import { PreviewLinksCard } from "../PreviewLinksCard";

type Fn = ReturnType<typeof vi.fn>;
const create = () => h.create as Fn;
const list = () => h.list as Fn;
const revoke = () => h.revoke as Fn;
const toast = () => h.toast as ReturnType<typeof import("@/test/post-editor/fixtures").toastStub>;
const writeText = () => h.writeText as Fn;

const POST = EDITOR_IDS.post;
const ROWS = [
  { id: "tok-1", token: "aaaabbbbccccdddd", expires_at: isoOffset(4320), created_at: BASE_ISO },
  { id: "tok-2", token: "eeeeffffgggghhhh", expires_at: isoOffset(60), created_at: BASE_ISO },
];

/** Ręcznie sterowana obietnica - do testów stanu „w toku" i wyścigów. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const createButton = () =>
  screen.getByRole("button", { name: /adminPostPanes\.previewLinks\.create/ }) as HTMLButtonElement;
const copyButtons = () =>
  screen.getAllByRole("button", {
    name: "adminPostPanes.previewLinks.copy",
  }) as HTMLButtonElement[];
const revokeButtons = () =>
  screen.getAllByRole("button", {
    name: "adminPostPanes.previewLinks.revoke",
  }) as HTMLButtonElement[];

beforeEach(() => {
  h.lang = "pl";
  create().mockReset();
  list().mockReset();
  revoke().mockReset();
  list().mockResolvedValue([]);
  revoke().mockResolvedValue({ ok: true });
  create().mockResolvedValue({ id: "tok-new", token: "nowytokenpodgladu", expiresAt: BASE_ISO });
  toast().success.mockReset();
  toast().error.mockReset();
  const spy = vi.fn(async () => undefined);
  h.writeText = spy;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: spy },
  });
});

describe("PreviewLinksCard - lista linków", () => {
  it("pusta lista pokazuje tylko zaproszenie do utworzenia linku", async () => {
    renderWithQueryClient(<PreviewLinksCard postId={POST} />);
    await waitFor(() => expect(list()).toHaveBeenCalledWith({ data: { postId: POST } }));

    expect(createButton()).toBeInTheDocument();
    expect(screen.getByText("adminPostPanes.previewLinks.hint")).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("każdy aktywny link ma datę wygaśnięcia oraz akcje kopiowania i odwołania", async () => {
    list().mockResolvedValue(ROWS);
    renderWithQueryClient(<PreviewLinksCard postId={POST} />);

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    expect(copyButtons()).toHaveLength(2);
    expect(revokeButtons()).toHaveLength(2);
  });

  it("data wygaśnięcia jest w formacie polskim, gdy panel jest po polsku", async () => {
    list().mockResolvedValue([ROWS[0]]);
    renderWithQueryClient(<PreviewLinksCard postId={POST} />);

    const expected = new Date(ROWS[0].expires_at).toLocaleString("pl-PL");
    await waitFor(() =>
      expect(
        screen.getByText(`adminPostPanes.previewLinks.expires: ${expected}`),
      ).toBeInTheDocument(),
    );
  });

  it("ten sam link w panelu angielskim dostaje format en-GB", async () => {
    h.lang = "en";
    list().mockResolvedValue([ROWS[0]]);
    renderWithQueryClient(<PreviewLinksCard postId={POST} />);

    const expected = new Date(ROWS[0].expires_at).toLocaleString("en-GB");
    await waitFor(() =>
      expect(
        screen.getByText(`adminPostPanes.previewLinks.expires: ${expected}`),
      ).toBeInTheDocument(),
    );
  });

  it("błąd odczytu listy nie wywraca karty - przycisk tworzenia dalej działa", async () => {
    list().mockRejectedValue(new Error("RLS: brak dostępu"));
    renderWithQueryClient(<PreviewLinksCard postId={POST} />);

    await waitFor(() => expect(list()).toHaveBeenCalled());
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(createButton().disabled).toBe(false);
  });
});

describe("PreviewLinksCard - tworzenie linku", () => {
  it("tworzy link dla TEGO wpisu z czasem życia 72 h", async () => {
    renderWithQueryClient(<PreviewLinksCard postId={POST} />);
    await waitFor(() => expect(list()).toHaveBeenCalled());

    fireEvent.click(createButton());

    await waitFor(() =>
      expect(create()).toHaveBeenCalledWith({ data: { postId: POST, ttlHours: 72 } }),
    );
  });

  it("świeży link ląduje w schowku jako pełny adres podglądu i jest potwierdzony", async () => {
    renderWithQueryClient(<PreviewLinksCard postId={POST} />);
    await waitFor(() => expect(list()).toHaveBeenCalled());

    fireEvent.click(createButton());

    await waitFor(() =>
      expect(writeText()).toHaveBeenCalledWith(
        `${window.location.origin}/preview/nowytokenpodgladu`,
      ),
    );
    expect(toast().success).toHaveBeenCalledWith("adminPostPanes.previewLinks.createdCopied");
  });

  it("odświeża listę linków po utworzeniu (nowy link jest od razu widoczny)", async () => {
    const { queryClient } = renderWithQueryClient(<PreviewLinksCard postId={POST} />);
    await waitFor(() => expect(list()).toHaveBeenCalled());
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.click(createButton());

    await waitFor(() =>
      expect(spy.mock.calls.map(([a]) => JSON.stringify(a?.queryKey))).toContain(
        JSON.stringify(["admin", "preview-tokens", POST]),
      ),
    );
  });

  it("gdy schowek odmówi, komunikat MÓWI inaczej (link istnieje, ale nie jest skopiowany)", async () => {
    writeText().mockRejectedValue(new Error("odmowa dostępu do schowka"));
    renderWithQueryClient(<PreviewLinksCard postId={POST} />);
    await waitFor(() => expect(list()).toHaveBeenCalled());

    fireEvent.click(createButton());

    await waitFor(() =>
      expect(toast().success).toHaveBeenCalledWith("adminPostPanes.previewLinks.created"),
    );
    expect(toast().success).not.toHaveBeenCalledWith("adminPostPanes.previewLinks.createdCopied");
  });

  it("błąd serwera przy tworzeniu jest pokazany, a nie zjedzony", async () => {
    create().mockRejectedValue(new Error("Rate limit exceeded - please slow down"));
    renderWithQueryClient(<PreviewLinksCard postId={POST} />);
    await waitFor(() => expect(list()).toHaveBeenCalled());

    fireEvent.click(createButton());

    await waitFor(() =>
      expect(toast().error).toHaveBeenCalledWith("Rate limit exceeded - please slow down"),
    );
    expect(toast().success).not.toHaveBeenCalled();
  });

  it("awaria bez klasy Error trafia do toastu jako tekst", async () => {
    create().mockRejectedValue("serwer padł");
    renderWithQueryClient(<PreviewLinksCard postId={POST} />);
    await waitFor(() => expect(list()).toHaveBeenCalled());

    fireEvent.click(createButton());

    await waitFor(() => expect(toast().error).toHaveBeenCalledWith("serwer padł"));
  });

  it("w trakcie tworzenia przycisk jest zablokowany (żadnych dwóch linków z jednego kliknięcia)", async () => {
    const gate = deferred<{ id: string; token: string; expiresAt: string }>();
    create().mockReturnValue(gate.promise);
    renderWithQueryClient(<PreviewLinksCard postId={POST} />);
    await waitFor(() => expect(list()).toHaveBeenCalled());

    fireEvent.click(createButton());

    await waitFor(() => expect(createButton().disabled).toBe(true));
    gate.resolve({ id: "tok-new", token: "nowytokenpodgladu", expiresAt: BASE_ISO });
    await waitFor(() => expect(createButton().disabled).toBe(false));
    expect(create()).toHaveBeenCalledTimes(1);
  });
});

describe("PreviewLinksCard - kopiowanie istniejącego linku", () => {
  it("kopiuje adres wybranego tokenu i potwierdza", async () => {
    list().mockResolvedValue(ROWS);
    renderWithQueryClient(<PreviewLinksCard postId={POST} />);
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));

    fireEvent.click(copyButtons()[1]);

    await waitFor(() =>
      expect(writeText()).toHaveBeenCalledWith(
        `${window.location.origin}/preview/${ROWS[1].token}`,
      ),
    );
    expect(toast().success).toHaveBeenCalledWith("adminPostPanes.previewLinks.copied");
  });

  it("awaria schowka daje komunikat BŁĘDU, nie ciche powodzenie", async () => {
    list().mockResolvedValue([ROWS[0]]);
    writeText().mockRejectedValue(new Error("brak zgody"));
    renderWithQueryClient(<PreviewLinksCard postId={POST} />);
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));

    fireEvent.click(copyButtons()[0]);

    await waitFor(() =>
      expect(toast().error).toHaveBeenCalledWith("adminPostPanes.previewLinks.copyFailed"),
    );
    expect(toast().success).not.toHaveBeenCalled();
  });
});

describe("PreviewLinksCard - odwołanie linku", () => {
  it("odwołuje wybrany link i odświeża listę", async () => {
    list().mockResolvedValue(ROWS);
    const { queryClient } = renderWithQueryClient(<PreviewLinksCard postId={POST} />);
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.click(revokeButtons()[0]);

    await waitFor(() => expect(revoke()).toHaveBeenCalledWith({ data: { id: ROWS[0].id } }));
    await waitFor(() =>
      expect(spy.mock.calls.map(([a]) => JSON.stringify(a?.queryKey))).toContain(
        JSON.stringify(["admin", "preview-tokens", POST]),
      ),
    );
  });

  it("w trakcie odwoływania WSZYSTKIE przyciski odwołania są zablokowane", async () => {
    list().mockResolvedValue(ROWS);
    const gate = deferred<{ ok: true }>();
    revoke().mockReturnValue(gate.promise);
    renderWithQueryClient(<PreviewLinksCard postId={POST} />);
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));

    fireEvent.click(revokeButtons()[0]);

    await waitFor(() => expect(revokeButtons()[0].disabled).toBe(true));
    // Blokada jest wspólna dla karty: dostęp pod embargiem odwołujemy pojedynczo,
    // żeby nie zgubić błędu jednego z żądań.
    expect(revokeButtons()[1].disabled).toBe(true);
    gate.resolve({ ok: true });
    await waitFor(() => expect(revokeButtons()[0].disabled).toBe(false));
    expect(revoke()).toHaveBeenCalledTimes(1);
  });

  it("nieudane odwołanie pokazuje błąd (dostęp mógł zostać otwarty)", async () => {
    list().mockResolvedValue([ROWS[0]]);
    revoke().mockRejectedValue(new Error("RLS: brak prawa"));
    renderWithQueryClient(<PreviewLinksCard postId={POST} />);
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));

    fireEvent.click(revokeButtons()[0]);

    await waitFor(() => expect(toast().error).toHaveBeenCalledWith("RLS: brak prawa"));
  });

  it("po nieudanym odwołaniu przycisk znów działa (blokada nie zostaje na zawsze)", async () => {
    list().mockResolvedValue([ROWS[0]]);
    revoke().mockRejectedValue("awaria sieci");
    renderWithQueryClient(<PreviewLinksCard postId={POST} />);
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));

    fireEvent.click(revokeButtons()[0]);

    await waitFor(() => expect(toast().error).toHaveBeenCalledWith("awaria sieci"));
    await waitFor(() => expect(revokeButtons()[0].disabled).toBe(false));
    fireEvent.click(revokeButtons()[0]);
    await waitFor(() => expect(revoke()).toHaveBeenCalledTimes(2));
  });
});
