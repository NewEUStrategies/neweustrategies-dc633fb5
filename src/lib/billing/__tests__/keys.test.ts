// KLUCZE CACHE MONETYZACJI (`billingKeys`) - kontrakt, na którym stoi świeżość
// i prywatność ekranów płatności.
//
// Fabryka kluczy wygląda na trywialną, ale niesie trzy reguły, których złamanie
// widać dopiero u klienta:
//
//  1. CUDZE DANE Z CACHE. Klucze per-user niosą uid (bez sesji: „anon"), więc
//     po przelogowaniu na wspólnym urządzeniu karta nie poda z pamięci cudzej
//     subskrypcji, faktur ani podglądu karty płatniczej. Środowisko operatora
//     (test/live) też jest w kluczu - podgląd z piaskownicy nie wyświetli się
//     w produkcji.
//  2. INWALIDACJA MUSI TRAFIĆ WSZYSTKICH. Warianty `*All()` są prefiksami, którymi
//     mutacje i mapa zdarzeń (`eventInvalidationMap`) unieważniają wpisy KAŻDEGO
//     uid/organizacji/leada. Prefiks, który nie jest prefiksem, oznacza kartę
//     ze starym stanem po webhooku Stripe.
//  3. INWALIDACJA NIE MOŻE TRAFIĆ SĄSIADA. Lista organizacji i szczegół
//     organizacji, miejsca w profilu i miejsca w panelu admina, publiczny
//     i administracyjny katalog warstw - to osobne rodziny. Prefiks zbyt szeroki
//     unieważnia cudze ekrany (burza zapytań), a kolizja nazw podaje jednemu
//     widokowi dane drugiego.
//
// Dopasowanie prefiksem liczy PRAWDZIWY `QueryClient` z @tanstack/react-query -
// ten sam algorytm, którego używa `invalidateQueries` w produkcji.
import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { billingKeys } from "@/lib/billing/keys";

interface Family {
  name: string;
  /** Wpisy, które realnie leżą w cache (różne uid / id / filtry). */
  members: QueryKey[];
  /** Klucz, którym kod produkcyjny unieważnia całą rodzinę. */
  prefix: QueryKey;
}

const A = "user-a";
const B = "user-b";

const FAMILIES: Family[] = [
  // --- per-user: uid w kluczu, `*All()` jako prefiks ---
  {
    name: "currentTier",
    members: [billingKeys.currentTier(A), billingKeys.currentTier(undefined)],
    prefix: billingKeys.currentTierAll(),
  },
  {
    name: "mySubscription",
    members: [
      billingKeys.mySubscription(A),
      billingKeys.mySubscription(B),
      billingKeys.mySubscription(undefined),
    ],
    prefix: billingKeys.mySubscriptionAll(),
  },
  {
    name: "myStripeSubscription",
    members: [
      billingKeys.myStripeSubscription(A, "live"),
      billingKeys.myStripeSubscription(A, "sandbox"),
      billingKeys.myStripeSubscription(undefined, "live"),
    ],
    prefix: billingKeys.myStripeSubscriptionAll(),
  },
  {
    name: "myOrders",
    members: [billingKeys.myOrders(A), billingKeys.myOrders(B), billingKeys.myOrders(undefined)],
    prefix: billingKeys.myOrdersAll(),
  },
  {
    name: "myBillingDocuments",
    members: [billingKeys.myBillingDocuments(A), billingKeys.myBillingDocuments(undefined)],
    prefix: billingKeys.myBillingDocumentsAll(),
  },
  {
    name: "myGrants",
    members: [billingKeys.myGrants(A), billingKeys.myGrants(B), billingKeys.myGrants(undefined)],
    prefix: billingKeys.myGrantsAll(),
  },
  {
    name: "myDonations",
    members: [billingKeys.myDonations(A), billingKeys.myDonations(undefined)],
    prefix: billingKeys.myDonationsAll(),
  },
  {
    name: "myOrganization",
    members: [
      billingKeys.myOrganization(A),
      billingKeys.myOrganization(B),
      billingKeys.myOrganization(undefined),
    ],
    prefix: billingKeys.myOrganizationAll(),
  },
  {
    name: "orgSeats",
    members: [billingKeys.orgSeats("org-1"), billingKeys.orgSeats(null)],
    prefix: billingKeys.orgSeatsAll(),
  },
  {
    name: "crmLeadMembership",
    members: [billingKeys.crmLeadMembership("lead-1"), billingKeys.crmLeadMembership("lead-2")],
    prefix: billingKeys.crmLeadMembershipAll(),
  },
  // --- per-encja w panelu admina ---
  {
    name: "admin.memberOrg",
    members: [billingKeys.admin.memberOrg("org-1"), billingKeys.admin.memberOrg("org-2")],
    prefix: billingKeys.admin.memberOrgAll(),
  },
  {
    name: "admin.orgSeats",
    members: [billingKeys.admin.orgSeats("org-1"), billingKeys.admin.orgSeats("org-2")],
    prefix: billingKeys.admin.orgSeatsAll(),
  },
  {
    name: "admin.crmCompanyMemberOrgs",
    members: [
      billingKeys.admin.crmCompanyMemberOrgs("company-1"),
      billingKeys.admin.crmCompanyMemberOrgs("company-2"),
    ],
    prefix: billingKeys.admin.crmCompanyMemberOrgsAll(),
  },
  // --- prefiksy rozszerzane w miejscu użycia (filtry dat / tenant + język) ---
  {
    name: "admin.monetization",
    members: [
      [...billingKeys.admin.monetization(), "plans"],
      [...billingKeys.admin.monetization(), "from", "to", "plan-1", "org-1"],
    ],
    prefix: billingKeys.admin.monetization(),
  },
  {
    name: "admin.allUserSubscriptions",
    members: [
      [...billingKeys.admin.allUserSubscriptions(), "tenant-alfa", "pl"],
      [...billingKeys.admin.allUserSubscriptions(), "tenant-beta", "en"],
    ],
    prefix: billingKeys.admin.allUserSubscriptions(),
  },
  // --- klucze stałe: klucz jest jednocześnie własnym prefiksem ---
  ...(
    [
      ["membershipTiers", billingKeys.membershipTiers()],
      ["plansActive", billingKeys.plansActive()],
      ["pricingAudiences", billingKeys.pricingAudiences()],
      ["pricingFaq", billingKeys.pricingFaq()],
      ["planChangePreview", billingKeys.planChangePreview("sub-1", "price-1", "live")],
      ["admin.membershipTiers", billingKeys.admin.membershipTiers()],
      ["admin.plans", billingKeys.admin.plans()],
      ["admin.membershipGrants", billingKeys.admin.membershipGrants()],
      ["admin.pricingAudiences", billingKeys.admin.pricingAudiences()],
      ["admin.pricingFaq", billingKeys.admin.pricingFaq()],
      ["admin.memberOrgs", billingKeys.admin.memberOrgs()],
      ["admin.stripeSubscriptions", billingKeys.admin.stripeSubscriptions()],
      ["admin.paymentWebhookEvents", billingKeys.admin.paymentWebhookEvents()],
    ] as const
  ).map(([name, key]): Family => ({ name, members: [key], prefix: key })),
  // --- per-user bez wariantu `*All()`: nikt nie unieważnia całej rodziny,
  // więc wpis jest własnym prefiksem i nie może trafić sąsiada (inny uid,
  // inne środowisko) ani innej rodziny ---
  ...(
    [
      ["myPaymentMethod(A, live)", billingKeys.myPaymentMethod(A, "live")],
      ["myPaymentMethod(B, sandbox)", billingKeys.myPaymentMethod(B, "sandbox")],
      ["myPaymentMethod(anon, live)", billingKeys.myPaymentMethod(undefined, "live")],
    ] as const
  ).map(([name, key]): Family => ({ name, members: [key], prefix: key })),
];

/** Cache z wpisem dla KAŻDEGO członka KAŻDEJ rodziny. */
function seededClient(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const family of FAMILIES) {
    for (const key of family.members) client.setQueryData(key, { family: family.name });
  }
  return client;
}

function invalidatedKeys(client: QueryClient): string[] {
  return client
    .getQueryCache()
    .findAll()
    .filter((query) => query.state.isInvalidated)
    .map((query) => JSON.stringify(query.queryKey))
    .sort();
}

describe("billingKeys - inwalidacja prefiksem", () => {
  it("każdy wpis cache należy do dokładnie jednej rodziny (brak kolizji kluczy)", () => {
    const all = FAMILIES.flatMap((f) => f.members.map((key) => JSON.stringify(key)));

    expect(new Set(all).size).toBe(all.length);
  });

  it.each(FAMILIES)(
    "$name: prefiks unieważnia wszystkie swoje wpisy i żadnego wpisu innej rodziny",
    async (family) => {
      const client = seededClient();

      await client.invalidateQueries({ queryKey: family.prefix });

      expect(invalidatedKeys(client)).toEqual(
        family.members.map((key) => JSON.stringify(key)).sort(),
      );
    },
  );
});

describe("billingKeys - prywatność wpisów per użytkownik", () => {
  it("dane zapisane dla jednego konta nie są serwowane innemu ani sesji anonimowej", () => {
    const client = new QueryClient();
    client.setQueryData(billingKeys.myBillingDocuments(A), [{ id: "doc-a" }]);
    client.setQueryData(billingKeys.myPaymentMethod(A, "live"), { last4: "4242" });

    expect(client.getQueryData(billingKeys.myBillingDocuments(B))).toBeUndefined();
    expect(client.getQueryData(billingKeys.myBillingDocuments(undefined))).toBeUndefined();
    expect(client.getQueryData(billingKeys.myPaymentMethod(B, "live"))).toBeUndefined();
    expect(client.getQueryData(billingKeys.myPaymentMethod(A, "live"))).toEqual({ last4: "4242" });
  });

  it('brak sesji daje jawny segment „anon", a nie dziurę w kluczu', () => {
    expect(billingKeys.myBillingDocuments(undefined)).toEqual(["my-billing-documents", "anon"]);
    expect(billingKeys.myPaymentMethod(undefined, "live")).toEqual([
      "my-payment-method",
      "anon",
      "live",
    ]);
    expect(billingKeys.orgSeats(undefined)).toEqual(["org-seats", "none"]);
  });

  it("podgląd metody płatności z piaskownicy nie trafia do widoku produkcyjnego", () => {
    const client = new QueryClient();
    client.setQueryData(billingKeys.myPaymentMethod(A, "sandbox"), { last4: "0000" });

    expect(client.getQueryData(billingKeys.myPaymentMethod(A, "live"))).toBeUndefined();
  });
});
