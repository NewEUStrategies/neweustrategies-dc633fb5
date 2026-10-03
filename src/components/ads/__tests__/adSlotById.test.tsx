// Pojedynczy slot reklamowy po ID: `src/components/ads/AdSlotById.tsx`.
//
// PO CO TEN PLIK. Komponent stoi za widgetem buildera „slot reklamowy", czyli
// za każdym miejscem, w którym redakcja wstawia reklamę RĘCZNIE, poza siatką
// placementów. Bramkę zgody dla tej ścieżki dowodzi `consentGate.test.tsx`;
// tutaj pilnujemy tego, co należy wyłącznie do niego:
//
//   * pusty widget (redakcja jeszcze nie wybrała slotu) mówi, co zrobić, i NIE
//     pyta bazy o slot o pustym ID;
//   * zapytanie bierze wyłącznie slot AKTYWNY o tym ID - wstrzymana kampania
//     nie może wrócić na stronę przez widget;
//   * błąd bazy trafia do react-query jako BŁĄD (a nie jako „brak slotu"), więc
//     nie jest cache'owany jak poprawna, pusta odpowiedź - i strona się nie
//     wywraca;
//   * slot renderuje się przez `AdSlotView` w syntetycznym placemencie.
//
// ATRAPUJEMY WYŁĄCZNIE GRANICE: klienta Supabase, beacon analityczny
// i IntersectionObserver (happy-dom nie liczy układu).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import "@/test/i18nReal";

vi.mock("@/lib/analytics/events", () => ({
  beaconAdEvent: () => {},
  beaconPopupEvent: () => {},
}));

const stubs = vi.hoisted(() => ({ from: null as unknown }));
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  stubs.from = from;
  return {
    supabase: {
      from: from.from,
      auth: {
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      rpc: async () => ({ data: [], error: null }),
    },
  };
});

import { AdSlotById } from "@/components/ads/AdSlotById";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { fail, ok, type SupabaseFromStub } from "@/test/supabaseChain";
import { PUBLIC_AD_SLOT_COLUMNS, type AdSlot } from "@/lib/ads/types";

const from = () => stubs.from as SupabaseFromStub;
const SLOT_ID = "11111111-2222-3333-4444-555555555555";
const HINT = "Wybierz slot reklamowy w ustawieniach widgetu.";

class ImmediateIntersectionObserver implements IntersectionObserver {
  readonly root: Element | null = null;
  readonly rootMargin: string = "";
  readonly scrollMargin: string = "";
  readonly thresholds: ReadonlyArray<number> = [];
  private readonly cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
  }
  observe(target: Element): void {
    this.cb([{ isIntersecting: true, target } as IntersectionObserverEntry], this);
  }
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

function slot(over: Partial<AdSlot> = {}): AdSlot {
  return {
    id: SLOT_ID,
    tenant_id: "aaaaaaaa-0000-0000-0000-00000000000a",
    name: "Kreacja widgetu",
    kind: "image",
    status: "active",
    html: null,
    script: null,
    image_url: "https://cdn.example.com/widget.png",
    image_link: null,
    image_alt: "Kreacja widgetu",
    width: 300,
    height: 250,
    // Zgoda nie jest przedmiotem tego pliku - patrz `consentGate.test.tsx`.
    requires_consent: false,
    targeting: {},
    notes: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

const realIntersectionObserver = globalThis.IntersectionObserver;

beforeEach(() => {
  globalThis.IntersectionObserver = ImmediateIntersectionObserver;
  from().reset();
  from().setResponse("ad_slots", ok(slot()));
});

afterEach(() => {
  cleanup();
  globalThis.IntersectionObserver = realIntersectionObserver;
});

// ---------------------------------------------------------------------------
describe("widget bez wybranego slotu", () => {
  it("podpowiada redakcji, co zrobić, i nie pyta bazy o pusty identyfikator", async () => {
    renderWithQueryClient(<AdSlotById slotId="" className="w-full" />);

    const hint = screen.getByText(HINT);
    expect(hint.className).toContain("border-dashed");
    expect(hint.className).toContain("w-full");
    // Chwila na ewentualny (błędny) odczyt - `enabled: !!slotId` ma go wstrzymać.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(from().chainsFor("ad_slots")).toHaveLength(0);
  });

  it("bez klasy z zewnątrz podpowiedź nie dostaje śmieciowego `undefined`", () => {
    renderWithQueryClient(<AdSlotById slotId="" />);

    expect(screen.getByText(HINT).className).not.toContain("undefined");
  });
});

// ---------------------------------------------------------------------------
describe("odczyt slotu po ID", () => {
  it("pyta wyłącznie o AKTYWNY slot o tym ID, bez notatek operatora", async () => {
    renderWithQueryClient(<AdSlotById slotId={SLOT_ID} />);

    await waitFor(() => expect(from().chainsFor("ad_slots")).toHaveLength(1));
    const chain = from().lastChain("ad_slots")!;
    expect(chain.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["id", SLOT_ID],
      ["status", "active"],
    ]);
    expect(chain.has("maybeSingle")).toBe(true);
    // Lista kolumn publicznych, nie `*`: notatki operatora (warunki umowy,
    // kontakt do reklamodawcy) nie mogą trafić do cache'u czytelnika.
    expect(chain.argsOf("select")).toEqual([PUBLIC_AD_SLOT_COLUMNS]);
    expect(PUBLIC_AD_SLOT_COLUMNS).not.toContain("notes");
  });

  it("renderuje slot przez AdSlotView w syntetycznym placemencie z klasą widgetu", async () => {
    const { container } = renderWithQueryClient(
      <AdSlotById slotId={SLOT_ID} className="widget-reklama" />,
    );

    expect(await screen.findByAltText("Kreacja widgetu")).toHaveAttribute(
      "src",
      "https://cdn.example.com/widget.png",
    );
    const box = container.querySelector<HTMLElement>(`[data-ad-slot="${SLOT_ID}"]`);
    expect(box).not.toBeNull();
    expect(box!.getAttribute("data-ad-position")).toBe("top_of_post");
    expect(box!.className).toContain("widget-reklama");
  });

  it("błąd bazy trafia do react-query jako BŁĄD i nie wywraca strony", async () => {
    from().setResponse("ad_slots", fail("permission denied for table ad_slots", "42501"));

    const { container, queryClient } = renderWithQueryClient(<AdSlotById slotId={SLOT_ID} />);

    await waitFor(() =>
      expect(queryClient.getQueryState(["ad_slot", SLOT_ID])?.status).toBe("error"),
    );
    // Gdyby błąd był połykany jako `null`, trafiłby do cache jako poprawna
    // odpowiedź „slotu nie ma" i nie byłoby czego ponowić.
    expect(queryClient.getQueryState(["ad_slot", SLOT_ID])?.error?.message).toContain(
      "permission denied",
    );
    expect(container.querySelector("[data-ad-slot]")).toBeNull();
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it("slot wstrzymany albo usunięty to poprawna, pusta odpowiedź - nic się nie renderuje", async () => {
    from().setResponse("ad_slots", ok(null));

    const { container, queryClient } = renderWithQueryClient(<AdSlotById slotId={SLOT_ID} />);

    await waitFor(() =>
      expect(queryClient.getQueryState(["ad_slot", SLOT_ID])?.status).toBe("success"),
    );
    expect(queryClient.getQueryData(["ad_slot", SLOT_ID])).toBeNull();
    expect(container.querySelector("[data-ad-slot]")).toBeNull();
  });
});
