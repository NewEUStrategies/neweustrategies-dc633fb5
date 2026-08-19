// Linki podglądu (embargo). Karta stała na 0%, a rozdaje dostęp do
// NIEOPUBLIKOWANEGO wpisu OSOBOM BEZ KONTA - token w adresie jest jedynym
// zabezpieczeniem. Trzy rzeczy muszą tu działać dokładnie: token ma wygasać
// (domyślnie 72 h), odwołanie ma faktycznie dobiegać do serwera, a adres
// wkładany do schowka ma być tym, który zadziała u odbiorcy.
import "@/lib/i18n-admin-post-panes";
import i18n from "@/lib/i18n";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const create$ = vi.fn();
const list$ = vi.fn();
const revoke$ = vi.fn();

// Podmieniamy WYŁĄCZNIE `useServerFn` - reszta modułu (m.in.
// `createIsomorphicFn`) jest używana tranzytywnie przez inne importy.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: { __name: string }) => {
    if (fn.__name === "create") return create$;
    if (fn.__name === "list") return list$;
    return revoke$;
  },
}));

vi.mock("@/lib/content/previewTokens.functions", () => ({
  createPreviewToken: { __name: "create" },
  listPreviewTokens: { __name: "list" },
  revokePreviewToken: { __name: "revoke" },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) },
}));

import { PreviewLinksCard } from "../PreviewLinksCard";

const t = i18n.getFixedT("pl");
const POST_ID = "post-1";

function row(over: Record<string, unknown> = {}) {
  return {
    id: "tok-1",
    token: "abc123",
    expires_at: "2026-09-01T10:00:00.000Z",
    ...over,
  };
}

function writeText(): ReturnType<typeof vi.fn> {
  return navigator.clipboard.writeText as unknown as ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  create$.mockReset();
  list$.mockReset().mockResolvedValue([]);
  revoke$.mockReset().mockResolvedValue(undefined);
  toastSuccess.mockReset();
  toastError.mockReset();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe("PreviewLinksCard - tworzenie linku", () => {
  it("REGUŁA EMBARGA: nowy link dostaje 72 h życia i identyfikator TEGO wpisu", async () => {
    // Token bez wygaśnięcia byłby stałym, publicznym adresem do materiału
    // pod embargiem. TTL jest tu jedyną rzeczą, która zamyka dostęp w czasie.
    create$.mockResolvedValue(row());
    renderWithQueryClient(<PreviewLinksCard postId={POST_ID} />);

    fireEvent.click(screen.getByRole("button", { name: /Utwórz|Create/i }));

    await waitFor(() => expect(create$).toHaveBeenCalledTimes(1));
    expect(create$).toHaveBeenCalledWith({ data: { postId: POST_ID, ttlHours: 72 } });
  });

  it("po utworzeniu wkłada do schowka PEŁNY adres podglądu", async () => {
    // Sam token nic nie da odbiorcy - do schowka musi trafić adres, który
    // da się wkleić w przeglądarkę.
    create$.mockResolvedValue(row({ token: "xyz789" }));
    renderWithQueryClient(<PreviewLinksCard postId={POST_ID} />);

    fireEvent.click(screen.getByRole("button", { name: /Utwórz|Create/i }));

    await waitFor(() => expect(writeText()).toHaveBeenCalled());
    expect(writeText()).toHaveBeenCalledWith(`${window.location.origin}/preview/xyz789`);
    expect(toastSuccess).toHaveBeenCalledWith(t("adminPostPanes.previewLinks.createdCopied"));
  });

  it("odmowa schowka NIE jest błędem - link i tak powstał", async () => {
    // Przeglądarka odmawia zapisu do schowka bez gestu użytkownika albo na
    // http. Zgłoszenie tego jako błędu kazałoby redaktorowi tworzyć link
    // drugi raz, choć pierwszy jest już na liście.
    create$.mockResolvedValue(row());
    (navigator.clipboard.writeText as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("brak zgody"),
    );
    renderWithQueryClient(<PreviewLinksCard postId={POST_ID} />);

    fireEvent.click(screen.getByRole("button", { name: /Utwórz|Create/i }));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(t("adminPostPanes.previewLinks.created")),
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it("błąd serwera zgłasza się jako błąd, nie jako sukces", async () => {
    create$.mockRejectedValue(new Error("rate limit"));
    renderWithQueryClient(<PreviewLinksCard postId={POST_ID} />);

    fireEvent.click(screen.getByRole("button", { name: /Utwórz|Create/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("rate limit"));
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe("PreviewLinksCard - lista aktywnych linków", () => {
  it("brak linków nie renderuje pustej listy", async () => {
    list$.mockResolvedValue([]);
    renderWithQueryClient(<PreviewLinksCard postId={POST_ID} />);

    await waitFor(() => expect(list$).toHaveBeenCalled());
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("każdy link pokazuje DATĘ WYGAŚNIĘCIA, nie sam token", async () => {
    // Data jest jedyną informacją, po której redaktor pozna, czy link
    // wysłany tydzień temu jeszcze działa.
    list$.mockResolvedValue([row()]);
    renderWithQueryClient(<PreviewLinksCard postId={POST_ID} />);

    await waitFor(() => expect(screen.getByRole("list")).toBeInTheDocument());
    expect(screen.getByText(/2026/)).toBeInTheDocument();
    // Sam token nie może wisieć w treści - jest tajemnicą, nie etykietą.
    expect(screen.queryByText(/abc123/)).not.toBeInTheDocument();
  });

  it("kopiowanie istniejącego linku wkłada jego własny adres", async () => {
    list$.mockResolvedValue([row({ token: "tok-abc" })]);
    renderWithQueryClient(<PreviewLinksCard postId={POST_ID} />);

    await waitFor(() => expect(screen.getByRole("list")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(t("adminPostPanes.previewLinks.copy")));

    await waitFor(() =>
      expect(writeText()).toHaveBeenCalledWith(`${window.location.origin}/preview/tok-abc`),
    );
    expect(toastSuccess).toHaveBeenCalledWith(t("adminPostPanes.previewLinks.copied"));
  });

  it("nieudane kopiowanie mówi o tym wprost", async () => {
    list$.mockResolvedValue([row()]);
    (navigator.clipboard.writeText as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("odmowa"),
    );
    renderWithQueryClient(<PreviewLinksCard postId={POST_ID} />);

    await waitFor(() => expect(screen.getByRole("list")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(t("adminPostPanes.previewLinks.copy")));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(t("adminPostPanes.previewLinks.copyFailed")),
    );
  });
});

describe("PreviewLinksCard - odwołanie linku", () => {
  it("odwołanie idzie do serwera z identyfikatorem WIERSZA, nie z tokenem", async () => {
    // Token jest tajemnicą i nie musi być kluczem - odwołanie po nim
    // wymagałoby przesłania sekretu z powrotem przez sieć.
    list$.mockResolvedValue([row({ id: "tok-row-9", token: "sekret" })]);
    renderWithQueryClient(<PreviewLinksCard postId={POST_ID} />);

    await waitFor(() => expect(screen.getByRole("list")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(t("adminPostPanes.previewLinks.revoke")));

    await waitFor(() => expect(revoke$).toHaveBeenCalledWith({ data: { id: "tok-row-9" } }));
  });

  it("błąd odwołania jest widoczny - link NADAL działa, więc cisza byłaby myląca", async () => {
    list$.mockResolvedValue([row()]);
    revoke$.mockRejectedValue(new Error("brak uprawnień"));
    renderWithQueryClient(<PreviewLinksCard postId={POST_ID} />);

    await waitFor(() => expect(screen.getByRole("list")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(t("adminPostPanes.previewLinks.revoke")));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("brak uprawnień"));
  });

  it("po odwołaniu lista jest odświeżana z serwera", async () => {
    list$.mockResolvedValue([row()]);
    const { queryClient } = renderWithQueryClient(<PreviewLinksCard postId={POST_ID} />);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await waitFor(() => expect(screen.getByRole("list")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(t("adminPostPanes.previewLinks.revoke")));

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["admin", "preview-tokens", POST_ID],
      }),
    );
  });
});
