// Regresja RODO: licznik odsłon jest bramkowany zgodą analityczną.
//
// Hook zapisywał `post_views` (i mintował trwały `viewer_hash` w localStorage)
// od razu po 1,5 s, bez pytania o zgodę - a /cookies deklaruje `post_views`
// w kategorii „analityka”. Test pilnuje obu stron bramki: braku zapisu i braku
// identyfikatora przed zgodą, oraz kompletnej ścieżki po zgodzie.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

const h = vi.hoisted(() => ({
  record: vi.fn(),
  hasAnalyticsConsent: vi.fn(),
  upsertThen: vi.fn(),
  user: null as { id: string } | null,
}));

vi.mock("@tanstack/react-start", () => ({ useServerFn: () => h.record }));
vi.mock("@/lib/views/postViews.functions", () => ({ recordPostView: {} }));
vi.mock("@/lib/ads/consent", () => ({
  hasAnalyticsConsent: () => h.hasAnalyticsConsent(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ upsert: () => ({ then: h.upsertThen }) }) },
}));

import { useRecordPostView } from "./useRecordPostView";

const POST = "11111111-1111-1111-1111-111111111111";
const STORAGE_KEY = "viewer_hash:v2";
const LEGACY_KEY = "__viewer_hash";

/** Montuje hook i przepuszcza opóźnienie 1,5 s filtrujące odbicia. */
async function mountAndTick(): Promise<void> {
  renderHook(() => useRecordPostView(POST, null));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  h.record.mockReset().mockResolvedValue({ ok: true });
  h.hasAnalyticsConsent.mockReset().mockReturnValue(false);
  h.upsertThen.mockReset();
  h.user = null;
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useRecordPostView - bramka zgody analitycznej", () => {
  it("bez zgody nie zapisuje odsłony ani nie mintuje identyfikatora", async () => {
    await mountAndTick();

    expect(h.record).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("po zgodzie zapisuje odsłonę z nieprzejrzystym identyfikatorem widza", async () => {
    h.hasAnalyticsConsent.mockReturnValue(true);

    await mountAndTick();

    expect(h.record).toHaveBeenCalledTimes(1);
    const arg = h.record.mock.calls[0]?.[0] as { data: { postId: string; viewerHash: string } };
    expect(arg.data.postId).toBe(POST);
    // `record_post_view` waliduje długość tokenu (min. 16 znaków).
    expect(arg.data.viewerHash.length).toBeGreaterThanOrEqual(16);
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain(arg.data.viewerHash);
  });

  it("wycofana zgoda usuwa identyfikator zapisany wcześniej", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ hash: "0123456789abcdef0123", mintedAt: Date.now() }),
    );
    window.localStorage.setItem(LEGACY_KEY, "0123456789abcdef0123");

    await mountAndTick();

    expect(h.record).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("zgoda nie znosi reguły, że autor nie nabija odsłon własnego wpisu", async () => {
    h.hasAnalyticsConsent.mockReturnValue(true);
    h.user = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };

    renderHook(() => useRecordPostView(POST, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(h.record).not.toHaveBeenCalled();
  });
});
