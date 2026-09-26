// @vitest-environment node
// `subscribeConsentChange` poza przegladarka (SSR, worker).
//
// CO KONKRETNIE PSUJE SIE BEZ TEGO TESTU. Funkcja jest eksportowana z modulu,
// ktory laduje sie tez na serwerze; bez straznika `window` wywolanie w kodzie
// wspoldzielonym rzucaloby `ReferenceError` w SSR zamiast zwrocic nic.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const { subscribeConsentChange } = await import("@/lib/ads/consent");

describe("subscribeConsentChange na serwerze", () => {
  it("nie dotyka `window`, zwraca bezpieczne odpiecie i nie wola sluchacza", () => {
    const listener = vi.fn();
    const off = subscribeConsentChange(listener);
    expect(() => off()).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });
});
