// Podgląd karty publicznej + kontrolki mediów profilu. Komponent jest czysto
// prezentacyjny (tłumaczenia wstrzykiwane propem `t`), więc test pilnuje
// dokładnie tego, co widzi użytkownik: kolejność fallbacków nazwy, budowę
// nagłówka „stanowisko · firma", pustostany okładki i awatara oraz stany
// wysyłki (postęp, sukces, porażka) razem z blokadą przycisku.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ProfileMediaPreview } from "../ProfileMediaPreview";

type Props = Parameters<typeof ProfileMediaPreview>[0];

const t = (key: string, vars?: Record<string, unknown>): string =>
  vars && "percent" in vars ? `${key}:${String(vars.percent)}` : key;

function renderPreview(overrides: Partial<Props> = {}) {
  const props: Props = {
    firstName: "Anna",
    lastName: "Kowalska",
    displayName: null,
    jobTitle: null,
    currentCompany: null,
    location: null,
    bio: null,
    avatarUrl: null,
    coverUrl: null,
    uploading: null,
    progress: { avatar: 0, cover: 0 },
    status: { avatar: "idle", cover: "idle" },
    onAvatarUrlChange: vi.fn(),
    onCoverUrlChange: vi.fn(),
    onAvatarUploadClick: vi.fn(),
    onCoverUploadClick: vi.fn(),
    t,
    ...overrides,
  };
  return { props, ...render(<ProfileMediaPreview {...props} />) };
}

describe("ProfileMediaPreview - karta podglądu", () => {
  it("nazwa wyświetlana wygrywa z imieniem i nazwiskiem", () => {
    renderPreview({ displayName: "Ania K." });
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Ania K.");
  });

  it("bez nazwy wyświetlanej pokazuje imię i nazwisko", () => {
    renderPreview();
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Anna Kowalska");
  });

  it('bez żadnej nazwy spada na etykietę „bez nazwy"', () => {
    renderPreview({ firstName: null, lastName: null });
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("profile.account.unnamed");
  });

  it("nagłówek łączy stanowisko z firmą, a przy jednym z nich nie zostawia separatora", () => {
    const { unmount } = renderPreview({ jobTitle: "Analityk", currentCompany: "NES" });
    expect(screen.getByText("Analityk · NES")).toBeInTheDocument();
    unmount();

    renderPreview({ jobTitle: "Analityk" });
    expect(screen.getByText("Analityk")).toBeInTheDocument();
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });

  it("pokazuje lokalizację i biogram tylko wtedy, gdy są", () => {
    const { unmount } = renderPreview();
    expect(screen.queryByText("Warszawa")).not.toBeInTheDocument();
    unmount();

    renderPreview({ location: "Warszawa", bio: "Krótko o mnie" });
    expect(screen.getByText("Warszawa")).toBeInTheDocument();
    expect(screen.getByText("Krótko o mnie")).toBeInTheDocument();
  });

  it("pustostany okładki i awatara zastępują obrazy komunikatem", () => {
    renderPreview();
    expect(screen.getByText("profile.account.coverPlaceholder")).toBeInTheDocument();
    expect(screen.getByText("profile.account.avatarPlaceholder")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("okładka jest dekoracyjna (puste alt), a awatar opisany nazwą osoby", () => {
    renderPreview({
      avatarUrl: "https://example.test/a.jpg",
      coverUrl: "https://example.test/c.jpg",
    });
    const avatar = screen.getByRole("img", { name: "Anna Kowalska" });
    expect(avatar).toHaveAttribute("src", "https://example.test/a.jpg");
    // Okładka nie niesie treści - alt="" wypada z drzewa dostępności.
    expect(screen.getAllByRole("img")).toHaveLength(1);
  });
});

describe("ProfileMediaPreview - kontrolki", () => {
  it("edycja adresu awatara i okładki woła osobne callbacki", () => {
    const { props } = renderPreview();
    const inputs = screen.getAllByPlaceholderText("https://...");
    fireEvent.change(inputs[0], { target: { value: "https://a" } });
    fireEvent.change(inputs[1], { target: { value: "https://c" } });
    expect(props.onAvatarUrlChange).toHaveBeenCalledWith("https://a");
    expect(props.onCoverUrlChange).toHaveBeenCalledWith("https://c");
  });

  it("przyciski wysyłki wołają swoje akcje", () => {
    const { props } = renderPreview();
    fireEvent.click(screen.getByRole("button", { name: /uploadAvatar/ }));
    fireEvent.click(screen.getByRole("button", { name: /uploadCover/ }));
    expect(props.onAvatarUploadClick).toHaveBeenCalledTimes(1);
    expect(props.onCoverUploadClick).toHaveBeenCalledTimes(1);
  });

  it("trwająca wysyłka blokuje TYLKO swój przycisk", () => {
    renderPreview({ uploading: "avatar" });
    expect(screen.getByRole("button", { name: /uploading/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /uploadCover/ })).toBeEnabled();
  });

  it("postęp wysyłki jest ogłaszany na żywo z procentem", () => {
    renderPreview({
      uploading: "cover",
      status: { avatar: "idle", cover: "uploading" },
      progress: { avatar: 0, cover: 42 },
    });
    expect(screen.getByText("profile.account.uploadProgress:42")).toBeInTheDocument();
  });

  it("sukces i porażka mają rolę statusu (czytnik ekranu je usłyszy)", () => {
    renderPreview({ status: { avatar: "success", cover: "failed" } });
    const statuses = screen.getAllByRole("status");
    expect(statuses).toHaveLength(2);
    expect(screen.getByText("profile.account.uploadSuccess")).toBeInTheDocument();
    expect(screen.getByText("profile.account.uploadFailed")).toBeInTheDocument();
  });

  it("stan spoczynku nie renderuje żadnego komunikatu", () => {
    renderPreview();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
