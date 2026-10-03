// PASEK TEMATÓW `/admin/pages` - liczniki liczone po stronie klienta.
//
// CO DOWODZI TEN PLIK. `TopicTabs` stał na zerze, a to on decyduje, które
// kubełki tematów redakcja w ogóle widzi: pusty kubełek znika z paska, chyba
// że jest właśnie wybrany (inaczej filtr bez wyników nie miałby jak się
// odznaczyć). Liczniki biorą się z JEDNEGO zapytania o same slugi bieżącego
// widoku, więc asercje sprawdzają też, że widok kosza pyta o strony
// usunięte, a widok aktywny - o nieusunięte, zawsze w obrębie tenanta.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { SupabaseFromStub } from "@/test/supabaseChain";

const stubs = vi.hoisted(() => ({ from: null as SupabaseFromStub | null }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  stubs.from = from;
  return { supabase: { from: from.from } };
});

import { fail, ok } from "@/test/supabaseChain";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { TopicTabs } from "../TopicTabs";

function db(): SupabaseFromStub {
  if (!stubs.from) throw new Error("Atrapa klienta Supabase nie powstała");
  return stubs.from;
}

const SLUGS = ["home", "blog", "regulamin", "zupelnie-inna-strona"];

beforeEach(() => {
  db().reset();
  db().setResponse("pages", ok(SLUGS.map((slug) => ({ slug }))));
});

afterEach(cleanup);

/** Przycisk zakładki po etykiecie tematu (licznik siedzi w tym samym przycisku). */
function tab(label: string): HTMLElement {
  return screen.getByRole("tab", { name: new RegExp(`^${label}\\s*\\d+$`) });
}

describe("TopicTabs - liczniki", () => {
  it("„Wszystkie” liczy całość, a każdy slug trafia do dokładnie jednego tematu", async () => {
    renderWithQueryClient(
      <TopicTabs tenantId="t1" view="active" value="all" onChange={() => {}} lang="pl" />,
    );
    await waitFor(() => expect(tab("Wszystkie").textContent).toBe("Wszystkie4"));
    expect(tab("Strony podstawowe").textContent).toBe("Strony podstawowe2");
    // Suma kubełków tematycznych = liczba slugów (żaden nie liczy się dwa razy).
    const sum = screen
      .getAllByRole("tab")
      .filter((t) => !t.textContent?.startsWith("Wszystkie"))
      .reduce((acc, t) => acc + Number(t.textContent?.match(/\d+$/)?.[0] ?? 0), 0);
    expect(sum).toBe(4);
  });

  it("pusty kubełek znika, ale wybrany pusty kubełek zostaje - inaczej nie da się go odznaczyć", async () => {
    const { rerender, queryClient } = renderWithQueryClient(
      <TopicTabs tenantId="t1" view="active" value="all" onChange={() => {}} lang="pl" />,
    );
    await waitFor(() => expect(tab("Wszystkie").textContent).toBe("Wszystkie4"));
    expect(screen.queryByRole("tab", { name: /^Podcasty/ })).toBeNull();

    rerender(
      <QueryClientProvider client={queryClient}>
        <TopicTabs tenantId="t1" view="active" value="podcasts" onChange={() => {}} lang="pl" />
      </QueryClientProvider>,
    );
    const podcasts = screen.getByRole("tab", { name: /^Podcasty/ });
    expect(podcasts.getAttribute("aria-selected")).toBe("true");
    expect(podcasts.textContent).toMatch(/0$/);
  });

  it("klik w zakładkę oddaje klucz tematu", async () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <TopicTabs tenantId="t1" view="active" value="all" onChange={onChange} lang="pl" />,
    );
    await waitFor(() => expect(tab("Strony podstawowe")).toBeTruthy());
    fireEvent.click(tab("Strony podstawowe"));
    expect(onChange).toHaveBeenCalledWith("basic");
  });

  it("etykiety tematów idą za językiem panelu", async () => {
    renderWithQueryClient(
      <TopicTabs tenantId="t1" view="active" value="all" onChange={() => {}} lang="en" />,
    );
    await waitFor(() => expect(tab("All").textContent).toBe("All4"));
    expect(tab("Basic pages")).toBeTruthy();
  });
});

describe("TopicTabs - zapytanie", () => {
  it("widok aktywny pyta o NIEUSUNIĘTE strony tenanta, z limitem", async () => {
    renderWithQueryClient(
      <TopicTabs tenantId="t1" view="active" value="all" onChange={() => {}} lang="pl" />,
    );
    await waitFor(() => expect(db().lastChain("pages")).toBeTruthy());
    const chain = db().lastChain("pages");
    expect(chain?.argsOf("select")).toEqual(["slug"]);
    expect(chain?.argsOf("eq")).toEqual(["tenant_id", "t1"]);
    expect(chain?.argsOf("is")).toEqual(["deleted_at", null]);
    expect(chain?.has("not")).toBe(false);
    expect(chain?.argsOf("limit")).toEqual([2000]);
  });

  it("widok kosza pyta o strony USUNIĘTE", async () => {
    renderWithQueryClient(
      <TopicTabs tenantId="t1" view="trash" value="all" onChange={() => {}} lang="pl" />,
    );
    await waitFor(() => expect(db().lastChain("pages")).toBeTruthy());
    const chain = db().lastChain("pages");
    expect(chain?.argsOf("not")).toEqual(["deleted_at", "is", null]);
    expect(chain?.has("is")).toBe(false);
  });

  it("bez tenanta nie ma zapytania, a pasek pokazuje same zera", () => {
    renderWithQueryClient(
      <TopicTabs tenantId={null} view="active" value="all" onChange={() => {}} lang="pl" />,
    );
    expect(db().chainsFor("pages")).toHaveLength(0);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Wszystkie0"]);
  });

  it("błąd odczytu nie wywraca paska - liczniki zostają zerowe", async () => {
    db().setResponse("pages", fail("permission denied"));
    renderWithQueryClient(
      <TopicTabs tenantId="t1" view="active" value="all" onChange={() => {}} lang="pl" />,
    );
    await waitFor(() => expect(db().chainsFor("pages")).toHaveLength(1));
    expect(tab("Wszystkie").textContent).toBe("Wszystkie0");
  });

  it("pusta odpowiedź (`data: null`) to zero stron, nie awaria", async () => {
    db().setResponse("pages", ok(null));
    renderWithQueryClient(
      <TopicTabs tenantId="t1" view="active" value="all" onChange={() => {}} lang="pl" />,
    );
    await waitFor(() => expect(db().chainsFor("pages")).toHaveLength(1));
    expect(tab("Wszystkie").textContent).toBe("Wszystkie0");
  });
});
