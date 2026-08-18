// Obecność edytorska: „kto jeszcze ma ten wpis otwarty”. Cała funkcjonalność
// stała na 0% - a jest to jedyna rzecz, która zamienia równoczesną edycję
// w decyzję świadomą zamiast w ciche nadpisanie cudzej pracy.
//
// Testujemy KONTRAKT, nie wygląd: adresowanie pokoju presence (zły argument =
// banner z cudzego wpisu albo cisza przy realnej kolizji), warunek pustki
// (pusty banner „ktoś tu jest" bez nazwisk byłby gorszy niż jego brak)
// i zapowiedź dla czytnika ekranu.
import { render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EntityPresencePeer } from "@/lib/realtime/useEntityPresence";

const useEntityPresence = vi.fn<(t: string, id: string | null | undefined) => EntityPresencePeer[]>();

vi.mock("@/lib/realtime/useEntityPresence", () => ({
  useEntityPresence: (t: string, id: string | null | undefined) => useEntityPresence(t, id),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && "names" in opts ? `${key}:${String(opts.names)}` : key,
  }),
}));

import { useEditPresence } from "../useEditPresence";
import { EditPresenceBanner } from "@/components/admin/molecules/EditPresenceBanner";

function peer(name: string, userId = name): EntityPresencePeer {
  return { userId, name, sinceIso: "2026-08-18T10:00:00.000Z" };
}

beforeEach(() => {
  useEntityPresence.mockReset();
  useEntityPresence.mockReturnValue([]);
});

describe("useEditPresence", () => {
  it("adresuje pokój obecności DOKŁADNIE tym typem i identyfikatorem encji", () => {
    // Zamiana argumentów miejscami nie wywala się na typach (oba to stringi),
    // a skutek jest cichy: banner pokazuje edytorów zupełnie innego bytu albo
    // milczy przy realnej kolizji.
    renderHook(() => useEditPresence("page", "abc-123"));
    expect(useEntityPresence).toHaveBeenCalledWith("page", "abc-123");
  });

  it("przekazuje brak identyfikatora dalej, zamiast podstawiać wartość zastępczą", () => {
    renderHook(() => useEditPresence("post", null));
    expect(useEntityPresence).toHaveBeenCalledWith("post", null);

    renderHook(() => useEditPresence("post", undefined));
    expect(useEntityPresence).toHaveBeenCalledWith("post", undefined);
  });

  it("oddaje listę obecnych bez zmian", () => {
    const peers = [peer("Ola"), peer("Jan")];
    useEntityPresence.mockReturnValue(peers);
    const { result } = renderHook(() => useEditPresence("post", "p1"));
    expect(result.current).toBe(peers);
  });
});

describe("EditPresenceBanner", () => {
  it("nie renderuje NICZEGO, gdy nikogo innego nie ma", () => {
    useEntityPresence.mockReturnValue([]);
    const { container } = render(<EditPresenceBanner entityType="post" entityId="p1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("wymienia obecnych po przecinku", () => {
    useEntityPresence.mockReturnValue([peer("Ola"), peer("Jan"), peer("Zofia")]);
    render(<EditPresenceBanner entityType="post" entityId="p1" />);
    expect(screen.getByRole("status")).toHaveTextContent("admin.presence.editingNow:Ola, Jan, Zofia");
  });

  it("zapowiada zmianę czytnikowi ekranu, nie przerywając mu pracy", () => {
    // `aria-live="polite"` to świadomy wybór: pojawienie się drugiego edytora
    // jest ważne, ale nie na tyle, żeby przerwać zdanie w trakcie czytania.
    useEntityPresence.mockReturnValue([peer("Ola")]);
    render(<EditPresenceBanner entityType="post" entityId="p1" />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("przekazuje encję z propsów do warstwy obecności", () => {
    useEntityPresence.mockReturnValue([]);
    render(<EditPresenceBanner entityType="page" entityId="page-7" />);
    expect(useEntityPresence).toHaveBeenCalledWith("page", "page-7");
  });
});
