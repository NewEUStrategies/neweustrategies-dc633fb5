// Toast odmowy operacji na subskrypcji: odmowa DOMENOWA (pauza poboru
// operatora przy nieopłaconym okresie) ma własny komunikat w obu kartach -
// karta operatora niesie kod w `ProviderCallError`, karta lokalna w treści
// błędu rzuconego przez server fn. Ogólne „nie udało się" odsyłało klienta
// do ponowień, które nigdy nie przejdą.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: h.error } }));

import { toastSubscriptionFailure } from "@/lib/billing/paymentOutcomeToast";
import { ProviderCallError } from "@/lib/billing/providerResult";

const t = (key: string) => key;

beforeEach(() => h.error.mockClear());

describe("toastSubscriptionFailure - odmowy domenowe", () => {
  it("karta operatora: `subscription_paused_by_operator` dostaje komunikat o kontakcie", () => {
    const paymentRefusal = toastSubscriptionFailure(
      t,
      new ProviderCallError("subscription_paused_by_operator"),
      "profile.subscription.resumeError",
    );

    expect(paymentRefusal).toBe(false);
    expect(h.error).toHaveBeenCalledWith("profile.subscription.pausedByOperator");
  });

  it("karta lokalna: ten sam kod w treści błędu server fn daje ten sam komunikat", () => {
    toastSubscriptionFailure(
      t,
      new Error("subscription_paused_by_operator"),
      "profile.subscription.resumeError",
    );

    expect(h.error).toHaveBeenCalledWith("profile.subscription.pausedByOperator");
  });

  it("każda inna odmowa zostaje przy komunikacie zapasowym", () => {
    toastSubscriptionFailure(
      t,
      new Error("provider_resume_failed"),
      "profile.subscription.resumeError",
    );

    expect(h.error).toHaveBeenCalledWith("profile.subscription.resumeError");
  });
});
