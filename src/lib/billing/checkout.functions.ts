import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { codeProbeRpcError, parseCouponVerdict } from "@/lib/billing/coupons";
import { isBelowMinimumCharge, minimumChargeCents } from "@/lib/billing/chargeMinimum";
import { periodEndFor } from "@/lib/billing/entitlement";
import { mockCheckoutAllowed } from "@/lib/billing/mockMode.server";
import { planCheckoutPricing, type PlanCheckoutPricing } from "@/lib/billing/planPricing";
import { resolveReturnUrl } from "@/lib/http/resolveReturnUrl";
import type { TicketTaxMode } from "@/lib/events/ticketTaxGroup";

// Zamówienie płatnicze (server-side, RLS jako użytkownik).
// Kwota jest zawsze wyliczana serwerowo (plan / reguła dostępu / bilet /
// kupon / waluta prezentacji) i osadzana w sesji Stripe Embedded Checkout, więc
// klient nie może jej podmienić. Bez konfiguracji dostawcy zwracamy adres mock,
// żeby dało się przetestować lejek w dev; na produkcji tryb mock jest
// fail-closed (mockCheckoutAllowed) - błędna konfiguracja nie rozdaje płatnego
// dostępu.

const createOrderSchema = z.object({
  kind: z.enum(["subscription", "one_time"]),
  plan_id: z.string().uuid().nullable().optional(),
  entity_type: z.enum(["post", "page"]).nullable().optional(),
  entity_id: z.string().uuid().nullable().optional(),
  success_path: z.string().min(1),
  cancel_path: z.string().min(1),
  // Kupon B2B: kod aplikowany przy zamówieniu. Rabat wyliczamy WYŁĄCZNIE
  // serwerowo (validate_b2b_coupon → atomowe redeem_b2b_coupon), więc klient
  // nigdy nie może obniżyć unit_amount ręcznie.
  coupon_code: z.string().trim().max(64).optional(),
  // Waluta prezentacji/rozliczenia. Dla EN pobieramy EUR (parytet 1 EUR = 2 PLN,
  // spójne z cennikiem i /support). Konwersja liczona jest serwerowo, więc
  // klient nie może zmienić kwoty - jedynie wybrać docelową walutę z listy.
  display_currency: z.enum(["PLN", "EUR"]).optional(),
  // Bilet na płatne wydarzenie - webhook po zapłacie potwierdza RSVP.
  event_id: z.string().uuid().nullable().optional(),
  // Rodzaj wejściówki z cennika wydarzenia. Kwotę i tak liczy baza
  // (`event_ticket_checkout_quote`) - klient wskazuje wyłącznie pozycję.
  ticket_type_id: z.string().uuid().nullable().optional(),
  // Zgłoszenie etapu 4, za które płacimy. Klient WSKAZUJE wiersz, więc serwer
  // musi sprawdzić, że należy do wołającego i do tego samego wydarzenia -
  // robi to `event_registration_payment_context` (baza, nie ten plik).
  // Bez tego klucza webhook dopasowuje wpłatę PO OSOBIE, a uczestnik z dwoma
  // zgłoszeniami na to samo wydarzenie dostaje bilet przypięty do najnowszego
  // wiersza, niekoniecznie tego, za który zapłacił.
  registration_id: z.string().uuid().nullable().optional(),
  // Kod z zaproszenia. Porównuje go baza ze skrótem SHA-256; serwer aplikacji
  // nie zna kodu i nie może go obejść.
  access_code: z.string().trim().max(64).optional(),
  // Liczba miejsc dla planów rozliczanych za miejsce (Zespół). Ignorowana dla
  // pozostałych planów - autorytetem jest wpis katalogu (`perSeat`).
  seats: z.number().int().min(1).max(100).optional(),
  // Środowisko bramki wyprowadzone po stronie klienta z prefiksu tokenu.
  environment: z.enum(["sandbox", "live"]).optional(),
});

export const createCheckoutOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => createOrderSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Resolve amount/currency from plan or entity
    let amountCents = 0;
    let currency = "PLN";
    let label = "";
    // Cena regularna biletu i etykieta aktywnej fazy sprzedaży. Kwota do
    // zapłaty pozostaje tą wyliczoną przez bazę - to tylko sposób pokazania
    // rabatu w nakładce operatora.
    let ticketListPriceCents = 0;
    let ticketPhaseLabel = "";
    let ticketTaxMode: TicketTaxMode | null = null;
    /** Miejsca opłacane jednym zamówieniem (rejestracja grupowa), domyślnie 1. */
    let ticketSeats = 1;
    /**
     * Nazwa pozycji JEDNEGO miejsca. Pozycja w Stripe idzie jako „N × cena
     * miejsca" pod tą nazwą, a etykieta zamówienia niesie sufiks „× N".
     */
    let ticketLineName = "";
    /**
     * Benefit planu na miejscu prowadzącego i ceny miejsc (prowadzący / gość).
     * `null` = wszystkie miejsca po tej samej cenie - zwłaszcza każdy zakup
     * poza cennikiem wejściówek.
     */
    let ticketPlan: {
      benefit: "included" | "discount";
      leadCents: number;
      guestCents: number;
    } | null = null;
    /** Cena miejsca prowadzącego dla rozbicia kodu kwotowego (tylko cennik wejściówek). */
    let ticketLeadCents: number | undefined;
    let trialDays = 0;
    /**
     * Wycena planu (`planPricing.ts`) - jedyne źródło ceny katalogowej, ilości,
     * kwoty, rodzaju zamówienia, trybu sesji i cyklu ceny. `null` poza zakupem
     * planu (treść, bilet - kwota osadzona w pozycji sesji).
     */
    let planPricing: PlanCheckoutPricing | null = null;

    // Zgłoszenie etapu 4 wskazane przez klienta. Deklaracja stoi TU, a nie przy
    // metadanych niżej, bo walidacja własności musi się odbyć PRZED wyceną
    // i przed założeniem zamówienia.
    const registrationId = data.registration_id ?? null;

    // JEDNO ZAMÓWIENIE = JEDEN PRZEDMIOT. Plan, treść i bilet wydarzenia
    // wykluczają się wzajemnie. Ręcznie złożone żądanie łączące je dawało
    // zamówienie wycenione jednym przedmiotem i zrealizowane drugim: plan
    // z `event_id` szedł kodem wydarzenia od ceny planu i niósł `event_id`
    // w metadanych (realizacja potwierdza wtedy miejsce na wydarzeniu), a treść
    // z `event_id` sprzedawała bilet po cenie wpisu. Żaden ekran nie składa
    // takiego żądania, więc odmowa nie kosztuje legalnego zakupu.
    const targets = [
      !!data.plan_id,
      !!data.entity_id || !!data.entity_type,
      !!data.event_id || !!data.ticket_type_id || !!registrationId,
    ].filter(Boolean).length;
    if (targets > 1) throw new Error("purchase_target_conflict");
    if (data.kind === "subscription" && !data.plan_id) throw new Error("plan_id_required");

    // Zakup PLANU (subskrypcja albo plan jednorazowy). RODZAJ ZAMÓWIENIA
    // WYNIKA Z PLANU, nie z żądania (przegląd PAY-01, 0.0/7.0): `kind` z żądania
    // jest wyłącznie deklaracją, którą porównujemy z wyceną. Dotąd
    // `kind=one_time` z planem MIESIĘCZNYM omijało wycenę, sprzedawało jeden
    // okres ceną osadzoną i zakładało zamówienie `one_time` - a takie
    // zamówienie realizacja zamienia w dostęp DOŻYWOTNI (`entitlementForOrder`).
    // W drugą stronę `kind=subscription` z planem jednorazowym dawało
    // miesięczny dostęp za produkt jednorazowy.
    const isPlanPurchase = !!data.plan_id;
    // Bilet na płatne wydarzenie: kind=one_time z event_id i bez planu/encji.
    const isEventTicket =
      data.kind === "one_time" && !!data.event_id && !data.plan_id && !data.entity_id;

    if (isPlanPurchase) {
      const { data: plan, error } = await supabase
        .from("access_plans")
        .select(
          "price_cents, currency, name_pl, name_en, active, interval, trial_days, tier_key, volume_threshold_seats, volume_price_cents",
        )
        .eq("id", data.plan_id as string)
        .maybeSingle();
      if (error) throw error;
      if (!plan || !plan.active) throw new Error("plan_not_found");
      // Plan MUSI iść ceną katalogową dostawcy - subskrypcja tylko tak dostaje
      // cykl rozliczeniowy, trial i zdarzenia `subscription.*` (odnowienia,
      // dunning, anulowanie), a plan jednorazowy tę samą cenę, z której
      // synchronizacja katalogu buduje produkt (jak w drugim silniku).
      //
      // Wpis katalogu (wyłącznie dokładna para warstwa-cykl), liczba miejsc,
      // próg wolumenowy, rodzaj, tryb sesji i cykl liczy JEDNA funkcja wspólna
      // z drugim silnikiem (`planPricing.ts`) - dwie kopie tej reguły to dwie
      // różne kwoty za ten sam plan. Odmowa zapada PRZED kuponem i zamówieniem.
      const pricing = planCheckoutPricing(plan, data.seats);
      if (!pricing) throw new Error("plan_price_missing");
      if (pricing.kind !== data.kind) throw new Error("kind_mismatch");
      planPricing = pricing;
      amountCents = pricing.amountCents;
      currency = String(plan.currency);
      label = String(plan.name_pl || plan.name_en);
      trialDays = pricing.mode === "subscription" ? Math.max(0, Number(plan.trial_days ?? 0)) : 0;
    } else if (isEventTicket && data.ticket_type_id) {
      // WYCENA WEJŚCIÓWKI Z CENNIKA żyje w `eventTicketPricing.server.ts`, bo
      // tę samą liczbę pokazuje podgląd kasy (`quoteEventTicketCheckout`) -
      // dwie kopie tej reguły to dwie różne kwoty: jedna na ekranie, druga na
      // paragonie. Kolejność sprawdzeń (zgłoszenie PRZED cennikiem, liczba
      // miejsc fail-closed) opisuje tamten moduł.
      const { priceEventTicket } = await import("@/lib/billing/eventTicketPricing.server");
      const price = await priceEventTicket(supabase, {
        userId,
        eventId: data.event_id as string,
        ticketTypeId: data.ticket_type_id,
        registrationId,
        accessCode: data.access_code,
        // Kasa - i tylko kasa - zajmuje bilet z puli planu dla miejsca
        // prowadzącego (podgląd liczy, ale nie konsumuje).
        claimPlanSeat: true,
      });
      amountCents = price.amountCents;
      ticketLeadCents = price.leadUnitCents;
      ticketPlan =
        price.planBenefit === null
          ? null
          : {
              benefit: price.planBenefit,
              leadCents: price.leadUnitCents,
              guestCents: price.unitCents,
            };
      currency = price.currency;
      ticketListPriceCents = price.listCents;
      ticketPhaseLabel = price.phaseLabel;
      ticketTaxMode = price.taxMode;
      ticketSeats = price.seats;
      ticketLineName = price.label;
      label = price.seats > 1 ? `${price.label} × ${price.seats}` : price.label;
    } else if (isEventTicket) {
      // Cena biletu pochodzi z wiersza wydarzenia (RLS jako użytkownik), więc
      // klient przekazuje wyłącznie identyfikator wydarzenia.
      const { data: ev, error: evErr } = await supabase
        .from("events")
        .select("id, title_pl, title_en, ticket_price_cents, ticket_currency, status, starts_at")
        // `isEventTicket` gwarantuje niepusty identyfikator - bez martwej gałęzi `?? ""`.
        .eq("id", String(data.event_id))
        .maybeSingle();
      if (evErr) throw evErr;
      if (!ev || !ev.ticket_price_cents || ev.ticket_price_cents <= 0) {
        throw new Error("ticket_not_available");
      }
      if (ev.status !== "published") throw new Error("ticket_not_available");
      if (ev.starts_at && new Date(ev.starts_at).getTime() < Date.now()) {
        throw new Error("event_finished");
      }
      // Limit miejsc egzekwujemy serwerowo tuż przed utworzeniem zamówienia -
      // przycisk w UI jest tylko podpowiedzią, autorytetem jest backend.
      const { assertSeatAvailable } = await import("@/lib/events/ticket.server");
      await assertSeatAvailable(supabase, String(ev.id), userId);
      // Kwota po benefitach planu: stawki ulgowe płacą mniej, a członek
      // z nieużytą pulą nie płaci wcale - i wtedy kasa jest ZŁĄ ścieżką.
      // Bilet z puli konsumuje `rsvp_event` (bramka biletowa, 20260822091000),
      // więc odsyłamy tam zamiast zakładać zamówienie na zero złotych.
      const { ticketPriceForCaller } = await import("@/lib/events/ticketAllowance.server");
      const ticketPrice = await ticketPriceForCaller(supabase, Number(ev.ticket_price_cents));
      if (ticketPrice.amountCents <= 0) throw new Error("ticket_included_in_plan");
      amountCents = ticketPrice.amountCents;
      currency = String(ev.ticket_currency ?? "PLN");
      label = String(ev.title_pl || ev.title_en || "");
    } else {
      if (!data.entity_type || !data.entity_id) throw new Error("entity_required");
      // Price is taken from the per-entity access rule server-side, so the
      // client can never tamper with the amount it is charged.
      const { data: rule, error: ruleErr } = await supabase
        .from("content_access_public")
        .select("mode, one_time_price_cents, one_time_currency")
        .eq("entity_type", data.entity_type)
        .eq("entity_id", data.entity_id)
        .maybeSingle();
      if (ruleErr) throw ruleErr;
      if (
        !rule ||
        rule.mode !== "paid" ||
        !rule.one_time_price_cents ||
        rule.one_time_price_cents <= 0
      ) {
        throw new Error("one_time_not_available");
      }
      amountCents = Number(rule.one_time_price_cents);
      currency = String(rule.one_time_currency ?? "PLN");
      const table = data.entity_type === "post" ? "posts" : "pages";
      const { data: row } = await supabase
        .from(table)
        .select("title_pl, title_en")
        .eq("id", data.entity_id)
        .maybeSingle();
      label = String(row?.title_pl || row?.title_en || "");
    }

    if (amountCents <= 0) throw new Error("zero_amount");

    // Zapamiętujemy oryginalną kwotę do audytu użycia kuponu (redemption row).
    // `let`, bo przy walucie prezentacji (EN → EUR) przeliczamy ją parytetowo
    // razem z kwotą finalną, żeby audyt kuponu był spójny walutowo (patrz niżej).
    let originalCents = amountCents;
    let couponId: string | null = null;
    let couponCode: string | null = null;
    let couponDiscountCents = 0;
    /**
     * Rabat kodu kwotowego na jedno miejsce - gdy każde miejsce zeszło tak
     * samo (`applyEventTicketCoupon`); `null` dla procentu i miejsc różnych.
     */
    let couponPerSeatCents: number | null = null;
    if (data.coupon_code && data.coupon_code.trim().length > 0) {
      const normalizedCode = data.coupon_code.trim().toUpperCase();
      if (data.event_id) {
        // Bilet wydarzenia: kod sprawdzany z zakresem wydarzenia i biletu
        // (kody tworzone w studiu wydarzenia), a kod kwotowy schodzi z KAŻDEGO
        // miejsca - ta sama funkcja liczy podgląd kasy.
        const { applyEventTicketCoupon } = await import("@/lib/billing/eventTicketPricing.server");
        const applied = await applyEventTicketCoupon(supabase, {
          userId,
          code: normalizedCode,
          eventId: data.event_id,
          ticketTypeId: data.ticket_type_id ?? null,
          amountCents,
          currency,
          seats: ticketSeats,
          leadCents: ticketLeadCents,
        });
        if (!applied.ok) {
          return { ok: false as const, mode: "coupon" as const, error: applied.error };
        }
        couponId = applied.couponId;
        couponPerSeatCents = applied.perSeatCents;
        couponDiscountCents = applied.discountCents;
        amountCents = applied.finalCents;
      } else {
        // Pozostałe zakupy: kod ogólny (plan, odblokowanie treści). Rola
        // serwisowa z jawnym najemcą, kontem i skrótem adresu - baza liczy
        // pudła kasy także po adresie (20261007120200, audyt ed13 D-13-1).
        const { validatePlanCouponForUser } = await import("@/lib/billing/couponRpc.server");
        const { data: rows, error: validateErr } = await validatePlanCouponForUser(supabase, {
          userId,
          code: normalizedCode,
          planId: data.plan_id ?? "00000000-0000-0000-0000-000000000000",
          amountCents,
          currency,
        });
        // Limit prób kodów to wyjątek, nie odmowa kodu (`codeProbeRpcError`).
        if (validateErr) throw codeProbeRpcError(validateErr);
        const row = parseCouponVerdict(rows);
        if (!row || !row.ok) {
          return {
            ok: false as const,
            mode: "coupon" as const,
            error: (row?.error ?? "not_found") as string,
          };
        }
        couponId = row.coupon_id;
        couponDiscountCents = row.discount_cents;
        amountCents = row.final_cents;
        // Bezpiecznik: rabat 100% (final=0) traktujemy jak darmowy przydział -
        // i tak nie przejdzie minimalnej kwoty transakcji, więc odrzucamy
        // kwotę poniżej minimum operatora W WALUCIE ZAMÓWIENIA (2,00 zł,
        // 0,50 EUR). Reguła i kod odmowy są wspólne z drugim silnikiem
        // (`chargeMinimum.ts`, przegląd PAY-01, 0.3) - kupon 100% i kwota tuż
        // pod minimum kończą się tak samo w obu kasach, przed zamówieniem
        // i rezerwacją kuponu. Bilet wydarzenia ma bezpiecznik
        // w `applyEventTicketCoupon`; kwotę poniżej minimum, która go minie,
        // zatrzymuje jeszcze `createAdhocCheckoutSession` (`amount_too_low`).
        if (isBelowMinimumCharge(amountCents, currency)) {
          return {
            ok: false as const,
            mode: "coupon" as const,
            error: "final_amount_too_low" as const,
          };
        }
      }
      couponCode = normalizedCode;
    }

    // Konwersja waluty prezentacji (EN → EUR) PO wyliczeniu kuponu, żeby
    // walidacja kuponu B2B odbyła się w oryginalnej walucie planu (kupony
    // są zdefiniowane per waluta). Koszyk u dostawcy widzi już walutę
    // wybraną przez klienta.
    //
    // WAŻNE (spójność walutowa audytu kuponu): kwoty zapisywane w redemption
    // Konwertujemy po AKTUALNYM kursie NBP (tabela A) - `ensureFxRateLoaded()`
    // odświeża cache w tle, zanim `couponAuditInDisplayCurrency` zejdzie
    // do sync `getEurPlnRate()`. Oryginał i finał konwertujemy razem, a RABAT
    // wyprowadzamy z ich RÓŻNICY, dzięki czemu niezmiennik
    // `original = final + discount` trzyma się dokładnie w walucie docelowej
    // (bez dryfu zaokrągleń między osobno konwertowanymi wartościami).
    // Plan (subskrypcja i plan jednorazowy) idzie z ceny katalogowej, więc
    // walutę rozstrzyga operator (`unit_price_overrides` EUR + lokalizacja) -
    // lokalna konwersja tylko rozjechałaby zamówienie z faktyczną kwotą
    // obciążenia.
    if (data.display_currency && !planPricing) {
      const [{ convertToDisplayCurrency, couponAuditInDisplayCurrency }, { ensureFxRateLoaded }] =
        await Promise.all([
          import("@/lib/billing/displayCurrency"),
          import("@/lib/billing/fxRate"),
        ]);
      await ensureFxRateLoaded();
      const pricedCurrency = currency;
      const target = data.display_currency;
      const conv = couponAuditInDisplayCurrency(originalCents, amountCents, currency, target);
      originalCents = conv.originalCents;
      amountCents = conv.finalCents;
      couponDiscountCents = conv.discountCents;
      currency = conv.currency;
      // Metadane miejsc w walucie ZAMÓWIENIA. Ceny miejsc przeliczamy osobno
      // (bez proporcji - zaokrąglenie z proporcji rozjeżdża „N × cena"),
      // a rabat na miejsce liczymy od przeliczonego rabatu, jak przed
      // rozbiciem kodu na miejsca.
      if (currency !== pricedCurrency) {
        if (ticketPlan !== null) {
          ticketPlan = {
            benefit: ticketPlan.benefit,
            leadCents: convertToDisplayCurrency(ticketPlan.leadCents, pricedCurrency, target).cents,
            guestCents: convertToDisplayCurrency(ticketPlan.guestCents, pricedCurrency, target)
              .cents,
          };
        }
        if (couponPerSeatCents !== null) {
          couponPerSeatCents = Math.floor(couponDiscountCents / ticketSeats);
        }
      }
    }

    // Fail-closed ZANIM powstanie zamówienie: produkcja bez działającej
    // konfiguracji dostawcy płatności odmawia checkoutu, zamiast po cichu
    // wpaść w tryb mock i rozdać dostęp za darmo.
    const { paymentsConfiguredServer } = await import("@/lib/billing/mockMode.server");
    const paymentsReady = paymentsConfiguredServer();
    if (!paymentsReady && !mockCheckoutAllowed()) {
      console.error("[checkout] billing unconfigured: refusing mock checkout in production");
      return {
        ok: false as const,
        mode: "unconfigured" as const,
        error: "billing_unconfigured" as const,
      };
    }

    const receiptEmail = context.claims.email ?? null;

    // Bilet na płatne wydarzenie: rozpoznawany po metadanych zamówienia -
    // webhook po zaksięgowaniu potwierdza RSVP i wysyła mail rejestracyjny.
    const eventId = data.event_id ?? null;
    const ticketTypeId = data.ticket_type_id ?? null;

    // Środowisko jest rozstrzygane SERWEROWO (w produkcji zawsze 'live') i
    // stemplowane na zamówieniu, żeby webhook zrealizował je wyłącznie zdarzeniem
    // z tego samego środowiska (izolacja sandbox/live, P0). Tę samą wartość
    // przekazujemy do sesji dostawcy poniżej - order.environment === env sesji.
    const { resolveEnvironment } = await import("@/lib/stripe.server");
    const environment = resolveEnvironment(data.environment);

    // Insert pending order (z metadanymi kuponu - webhook potem policzy revenue netto).
    const { data: order, error: insertError } = await supabase
      .from("payment_orders")
      .insert({
        user_id: userId,
        // Rodzaj z WYCENY dla planu (równy deklaracji - rozbieżność odmówiła
        // wyżej), dla treści i biletu - zakup jednorazowy.
        kind: planPricing?.kind ?? data.kind,
        status: "pending",
        amount_cents: amountCents,
        currency,
        plan_id: data.plan_id ?? null,
        entity_type: data.entity_type ?? null,
        entity_id: data.entity_id ?? null,
        provider: paymentsReady ? "stripe" : "mock",
        receipt_email: receiptEmail,
        // `environment`: kolumna z migracji 20260731220000, jeszcze nie w
        // wygenerowanym types.ts - stąd cast całego payloadu (konwencja repo).
        environment,
        metadata: {
          label,
          // `quantity` = miejsca opłacone TYM zamówieniem. Panel zamówień
          // biletowych (`ticketOrders.server.ts`) czyta z niego liczbę biletów;
          // bez klucza zamówienie grupowe na trzy osoby wyglądało jak „1 bilet".
          ...(eventId ? { event_id: eventId, quantity: ticketSeats } : {}),
          ...(ticketTypeId ? { ticket_type_id: ticketTypeId } : {}),
          // `registration_id` jest KLUCZEM DOWIĄZANIA wpłaty do zgłoszenia
          // (`payments_apply_event_ticket_outcome`). Bez niego zostaje
          // dopasowanie po osobie z `LIMIT 1` po dacie utworzenia.
          ...(registrationId ? { registration_id: registrationId } : {}),
          // Benefit planu członka i ceny miejsc - „200 zł za trzy miejsca"
          // da się wtedy sprawdzić jako 0 zł (bilet z puli) + 2 × 100 zł.
          ...(ticketPlan
            ? {
                plan_benefit: ticketPlan.benefit,
                lead_unit_cents: ticketPlan.leadCents,
                guest_unit_cents: ticketPlan.guestCents,
              }
            : {}),
          ...(couponCode
            ? {
                coupon_code: couponCode,
                coupon_id: couponId,
                coupon_discount_cents: couponDiscountCents,
                original_amount_cents: originalCents,
                // Kod kwotowy na bilet: ile zeszło z JEDNEGO miejsca - po to,
                // żeby „-60 zł" na zamówieniu dało się sprawdzić jako 3 × 20 zł.
                // Miejsca zeszły różnie (prowadzący tańszy od kodu) - bez klucza.
                ...(couponPerSeatCents === null
                  ? {}
                  : { coupon_discount_per_seat_cents: couponPerSeatCents }),
              }
            : {}),
        },
      } as never)
      .select("id, tenant_id")
      .single();
    if (insertError) throw insertError;

    // Atomowe rezerwowanie użycia kuponu - RPC sam sprawdza limity pod
    // blokadą wiersza, więc nawet równoległe zamówienia nie przekroczą maxa.
    // Najemca rezerwacji to stempel ZAMÓWIENIA, nie host - baza odmawia
    // rezerwacji na zamówieniu innego konta albo najemcy.
    if (couponId) {
      const { redeemCouponForUser } = await import("@/lib/billing/couponRpc.server");
      const { data: redeemed, error: redeemErr } = await redeemCouponForUser(supabase, {
        tenantId: order.tenant_id,
        userId,
        couponId,
        orderId: order.id,
        appliedCents: couponDiscountCents,
        originalCents,
        currency,
      });
      if (redeemErr || !redeemed) {
        // Ktoś przejął ostatnie użycie zanim doszliśmy tutaj - unieważniamy zamówienie.
        await (
          await import("@/lib/billing/markOrderSession.server")
        ).markOrderSession(supabase, { orderId: order.id, sessionId: null, status: "canceled" });
        return {
          ok: false as const,
          mode: "coupon" as const,
          error: "limit_reached" as const,
        };
      }
    }

    if (paymentsReady) {
      const returnUrl = resolveReturnUrl(data.success_path);
      const { markOrderSession } = await import("@/lib/billing/markOrderSession.server");

      // Odmowa PO założeniu zamówienia: zamówienie dostaje `failed` (nigdy
      // wiszące `pending` bez sesji - na takie nie przyjdzie
      // `checkout.session.expired`), a zarezerwowane użycie kuponu wraca do
      // puli - inaczej limit przepadałby za zamówienie, którego nikt nigdy nie
      // opłaci. Ten sam kształt co `failOrder` w drugim silniku.
      const failOrder = async (error: string) => {
        await markOrderSession(supabase, { orderId: order.id, sessionId: null, status: "failed" });
        if (couponId) {
          const { releaseCouponForUser } = await import("@/lib/billing/couponRpc.server");
          const { error: releaseErr } = await releaseCouponForUser(supabase, {
            tenantId: order.tenant_id,
            userId,
            couponId,
            orderId: order.id,
          });
          if (releaseErr) {
            console.error("[checkout] coupon release failed", order.id, releaseErr.message);
          }
        }
        return { ok: false as const, mode: "stripe" as const, error, orderId: order.id };
      };

      // Flagi checkoutu TENANTA ZAMÓWIENIA (kupony, Stripe Tax, NIP, faktury).
      // Zawężamy je do `order.tenant_id`, a nie do tenantu żądania - sesja u
      // operatora ma jechać na tej konfiguracji, którą stempluje zamówienie.
      const { loadCheckoutSettings } = await import("@/lib/billing/checkoutSettings.server");
      const settings = await loadCheckoutSettings(supabase, order.tenant_id);

      // Plan: sesja z CENY KATALOGOWEJ (cykl rozliczeniowy, trial,
      // lokalizacja waluty przez ceny Stripe). Tylko taka sesja zakłada u
      // operatora subskrypcję, a więc odnowienia, dunning i zdarzenia
      // `customer.subscription.*`; plan jednorazowy idzie tą samą ceną
      // w trybie `payment`. Rabat kuponu przekazujemy jako rabat operatora -
      // kwota nadal nie pochodzi od klienta.
      if (planPricing) {
        const { createPlanCheckoutSession, createAdhocDiscountForCoupon } =
          await import("@/lib/billing/adhocCheckout.server");
        // Rabat u operatora powstaje DOPIERO PO zamówieniu (klucz idempotencji
        // z `order.id`). Rabat, którego operator nie założył - wyjątek albo
        // odpowiedź bez identyfikatora - to sesja po cenie BEZ zniżki przy
        // zamówieniu zapisanym po zniżce: kupujący zapłaciłby więcej, niż
        // pokazała kasa, a realizacja oflagowałaby rozjazd kwot dopiero po
        // pobraniu pieniędzy. Dotąd wyjątek wylatywał z handlera i zostawiał
        // zamówienie `pending` bez sesji z zajętym użyciem kuponu (przegląd
        // PAY-16a, 0.2) - teraz zamykamy je tak samo jak drugi silnik.
        let discount: { coupon: string } | null = null;
        if (couponCode && couponDiscountCents > 0) {
          try {
            const { getStripeClient } = await import("@/lib/stripe.server");
            const stripe = await getStripeClient(environment);
            const couponRef = await createAdhocDiscountForCoupon(stripe, {
              code: couponCode,
              discountCents: couponDiscountCents,
              currency,
              orderId: order.id,
            });
            if (!couponRef) return await failOrder("discount_unavailable");
            discount = { coupon: couponRef };
          } catch (e) {
            const { getStripeErrorMessage } = await import("@/lib/stripe.server");
            console.error("[checkout] provider coupon failed", order.id, e);
            return await failOrder(getStripeErrorMessage(e));
          }
        }
        const createdPlan = await createPlanCheckoutSession({
          environment,
          priceLookupKey: planPricing.entry.priceId,
          quantity: planPricing.quantity,
          // Cena u operatora innego typu, w innej walucie, w innym cyklu albo
          // z inną kwotą za tę liczbę sztuk niż zamówienie kończy się odmową
          // `price_mismatch`, a nie sesją na coś innego.
          expectedMode: planPricing.mode,
          expectedCurrency: currency,
          expectedRecurring: planPricing.recurring,
          expectedAmountCents: planPricing.amountCents,
          planId: data.plan_id as string,
          orderId: order.id,
          userId,
          customerEmail: receiptEmail,
          returnUrl,
          discount,
          // Bez tego okres próbny planu jest martwy: metadane ceny w katalogu
          // operatora niczego nie wymuszają, a karta zostaje obciążona od razu.
          trialDays,
          settings,
        });
        if (!createdPlan.ok) return await failOrder(createdPlan.error);
        await markOrderSession(supabase, {
          orderId: order.id,
          sessionId: createdPlan.sessionId,
          status: "processing",
        });
        return {
          ok: true as const,
          mode: "stripe" as const,
          clientSecret: createdPlan.clientSecret,
          orderId: order.id,
        };
      }

      // Kwota jest wyliczona serwerowo (reguła dostępu / bilet / kupon /
      // waluta prezentacji), więc zamiast ceny katalogowej tworzymy sesję z
      // ceną osadzoną (`price_data`) i zwracamy `clientSecret` do nakładki.
      const { createAdhocCheckoutSession, MAX_LINE_QUANTITY } =
        await import("@/lib/billing/adhocCheckout.server");

      // Rabat fazy sprzedaży (early bird / last minute) i benefit planu widoczne
      // w nakładce: pozycja idzie w cenie regularnej, różnicę zdejmuje kupon
      // jednorazowy. Bez tego kupujący widzi samą kwotę końcową i nie ma jak
      // sprawdzić, że promocja faktycznie zadziałała.
      let ticketDiscount: { coupon: string } | null = null;
      let lineAmountCents = amountCents;
      const phaseDiscountCents = ticketListPriceCents - amountCents;
      if (eventId && phaseDiscountCents > 0 && !isBelowMinimumCharge(amountCents, currency)) {
        const { getStripeClient } = await import("@/lib/stripe.server");
        const { createAdhocDiscountForCoupon } = await import("@/lib/billing/adhocCheckout.server");
        const couponRef = await createAdhocDiscountForCoupon(await getStripeClient(environment), {
          // Różnica cena regularna - kwota końcowa obejmuje fazę sprzedaży
          // ORAZ kod rabatowy, więc nazwa rabatu w Stripe mówi o obu.
          code:
            // Kod PRZED benefitem planu: nazwa rabatu ma 40 znaków, a kod to
            // jedyna część, którą kupujący wpisał (i po której go szuka).
            [ticketPhaseLabel, couponCode, ticketPlan ? "Benefit planu" : ""]
              .filter((part) => Boolean(part))
              .join(" + ") || "Rabat",
          discountCents: phaseDiscountCents,
          currency,
          orderId: order.id,
        }).catch((err: unknown) => {
          console.error("[checkout] phase discount failed", order.id, err);
          return null;
        });
        if (couponRef) {
          ticketDiscount = { coupon: couponRef };
          lineAmountCents = ticketListPriceCents;
        }
      }

      // POZYCJA „N × CENA MIEJSCA". Zamówienie grupowe szło dotąd jedną linią
      // „Tytuł × 3" za sumę, z jednym rabatem pod spodem - nakładka nie
      // pokazywała, że kod zszedł z każdego miejsca. Linia `quantity = N` po
      // cenie miejsca mówi to wprost. Tylko gdy suma dzieli się przez N bez
      // reszty (inaczej Stripe policzyłby inną kwotę niż zamówienie), mieści się
      // w limicie ilości sesji i cena miejsca przechodzi minimum operatora -
      // w pozostałych przypadkach zostaje jedna linia za sumę.
      //
      // Z benefitem planu miejsce prowadzącego kosztuje mniej niż miejsce
      // gościa - „N × cena" wolno pokazać tylko wtedy, gdy linia idzie w cenie
      // regularnej (rabat zdejmuje kupon). Bez kuponu podzielna suma dałaby
      // „N × średnia", której nie płaci nikt.
      const perSeatLine =
        (ticketPlan === null || ticketDiscount !== null) &&
        ticketSeats > 1 &&
        ticketSeats <= MAX_LINE_QUANTITY &&
        lineAmountCents % ticketSeats === 0 &&
        lineAmountCents / ticketSeats >= minimumChargeCents(currency);

      const created = await createAdhocCheckoutSession({
        environment,
        name: (perSeatLine ? ticketLineName : label) || "Zamówienie",
        amountCents: perSeatLine ? lineAmountCents / ticketSeats : lineAmountCents,
        ...(perSeatLine ? { quantity: ticketSeats } : {}),
        discount: ticketDiscount,
        ...(ticketTaxMode ? { taxBehavior: ticketTaxMode } : {}),
        currency,
        orderId: order.id,
        purpose: eventId ? "event_ticket" : "content_unlock",
        userId,
        customerEmail: receiptEmail,
        returnUrl,
        metadata: eventId
          ? {
              event_id: eventId,
              ...(ticketTypeId ? { ticket_type_id: ticketTypeId } : {}),
              ...(registrationId ? { registration_id: registrationId } : {}),
            }
          : {},
        // BILET NIE DOSTAJE POLA KODU STRIPE - ale tej reguły NIE egzekwujemy
        // tutaj. Wyłącza je sam `createAdhocCheckoutSession` dla KAŻDEGO
        // `purpose: "event_ticket"` (patrz `adhocSessionSettings`), bo sesję
        // biletu buduje też server fn ad-hoc; ustawienia tenantu idą więc
        // bez zmian, a odblokowanie treści zachowuje z nich pole kodu.
        settings,
      });
      // Kupon został zarezerwowany PRZED utworzeniem sesji - odmowa dostawcy
      // zamyka zamówienie i oddaje użycie do puli (`failOrder`).
      if (!created.ok) return await failOrder(created.error);

      await markOrderSession(supabase, {
        orderId: order.id,
        sessionId: created.sessionId,
        status: "processing",
      });
      return {
        ok: true as const,
        mode: "stripe" as const,
        clientSecret: created.clientSecret,
        orderId: order.id,
      };
    }

    // Tryb mock - brak dostawcy. Zwracamy adres sukcesu, żeby dało się
    // przetestować lejek w dev.
    //
    // TEN SAM ADRES, TA SAMA BRAMKA. Wcześniej `data.success_path` szło tu
    // wprost do interpolacji, bez żadnego parsowania - czyli ostatnie miejsce
    // na tej powierzchni, w którym ścieżka od klienta stawała się adresem bez
    // sprawdzenia originu. Tryb mock jest w produkcji fail-closed
    // (`mockMode.server.ts`), więc nie był to otwór wykorzystywalny, ale był to
    // ten sam kształt - a zostawianie jednej kopii defektu „bo i tak nieczynna"
    // to dokładnie sposób, w jaki wraca druga.
    const mockUrl = new URL(resolveReturnUrl(data.success_path));
    mockUrl.searchParams.set("order", order.id);
    mockUrl.searchParams.set("mock", "1");
    return {
      ok: true as const,
      mode: "mock" as const,
      url: mockUrl.toString(),
      orderId: order.id,
    };
  });

// Finalizacja zamówienia w trybie mock (brak skonfigurowanego dostawcy).
// Oznacza własne zamówienie jako opłacone i nadaje uprawnienie tą samą ścieżką
// co webhook. Gdy dostawca jest skonfigurowany, funkcja jest świadomym no-opem -
// źródłem prawdy jest webhook - więc nie da się nią ominąć realnej płatności.
export const finalizeCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ order_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { paymentsConfiguredServer } = await import("@/lib/billing/mockMode.server");
    if (paymentsConfiguredServer()) {
      return { ok: false as const, reason: "provider_mode" as const };
    }
    // Ten sam bezpiecznik co przy tworzeniu zamówienia: produkcja bez dostawcy
    // nie może finalizować zamówień mock (rozdanie uprawnień bez płatności).
    if (!mockCheckoutAllowed()) {
      console.error("[checkout] billing unconfigured: refusing mock finalize in production");
      return { ok: false as const, reason: "mock_disabled" as const };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { grantEntitlement } = await import("@/lib/billing/grant.server");

    // Idempotent + ownership-scoped: only a not-yet-paid order owned by the
    // caller is finalised; a replay updates zero rows and grants nothing again.
    const { data: order, error } = await supabaseAdmin
      .from("payment_orders")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", data.order_id)
      .eq("user_id", context.userId)
      .neq("status", "paid")
      .select(
        "id, user_id, tenant_id, plan_id, kind, entity_type, entity_id, amount_cents, currency",
      )
      .maybeSingle();
    if (error) throw error;
    if (!order) return { ok: true as const, alreadyFinalized: true as const };

    await grantEntitlement(order, order.id);
    // Efekty kuponu B2B po zaksięgowaniu płatności (ta gałąź już ustawiła
    // status='paid' powyżej) - ta sama ścieżka co w webhooku dostawcy, żeby kupon
    // z `grants_tier_key` działał identycznie w obu trybach.
    const { applyCouponEffectsForOrder } = await import("@/lib/billing/couponEffects.server");
    await applyCouponEffectsForOrder(order.id);
    return { ok: true as const };
  });

const cancelSubscriptionSchema = z.object({ subscriptionId: z.string().uuid() });

// Cancel-at-period-end for the caller's own subscription. user_subscriptions
// grants no UPDATE to authenticated (a client UPDATE could self-grant access),
// so this runs service-role with an explicit ownership check. We set
// canceled_at and keep status 'active': has_content_access already ends access
// at current_period_end, so paid time is preserved and the UI shows "cancels at".
//
// Przy realnym dostawcy subskrypcja jest anulowana NAJPIERW u operatora
// (effective_from=next_billing_period). Kolejność ma znaczenie: jeśli operator
// odmówi, wiersza NIE wolno oznaczyć jako anulowany - inaczej UI mówi
// "anulowano", a klient jest dalej obciążany. Webhook subscription.updated /
// subscription.canceled pozostaje źródłem prawdy przy zmianach po stronie
// operatora.
export const cancelSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => cancelSubscriptionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: sub, error: loadError } = await supabaseAdmin
      .from("user_subscriptions")
      .select("id, external_ref, canceled_at")
      .eq("id", data.subscriptionId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!sub) throw new Error("subscription_not_found");
    if (sub.canceled_at) return { ok: true as const, alreadyCanceled: true as const };

    const { cancelSubscriptionAtPeriodEnd, isProviderSubscriptionRef, subscriptionEnvironment } =
      await import("@/lib/billing/subscriptionProvider.server");
    const { paymentsConfiguredServer } = await import("@/lib/billing/mockMode.server");
    if (paymentsConfiguredServer() && isProviderSubscriptionRef(sub.external_ref)) {
      const result = await cancelSubscriptionAtPeriodEnd(
        subscriptionEnvironment(),
        sub.external_ref,
      );
      if (!result.ok) {
        console.error("[billing] provider cancel failed", sub.external_ref, result.error);
        throw new Error("provider_cancel_failed");
      }
    }

    const { data: updated, error } = await supabaseAdmin
      .from("user_subscriptions")
      .update({ canceled_at: new Date().toISOString() })
      .eq("id", sub.id)
      .is("canceled_at", null)
      .select("id");
    if (error) throw new Error(error.message);
    if (!updated?.length) return { ok: true as const, alreadyCanceled: true as const };
    return { ok: true as const, alreadyCanceled: false as const };
  });

const changePlanSchema = z.object({
  subscriptionId: z.string().uuid(),
  newPlanId: z.string().uuid(),
});

// Samoobsługowy upgrade/downgrade planu. Kolejność jak przy cancel/resume:
// najpierw operator, potem baza. Reguła biznesowa: upgrade rozlicza się od
// razu z proratą, downgrade wchodzi dopiero od nowego okresu. Nieudana dopłata
// NIE zmienia planu (on_payment_failure=prevent_change). Zmiana planu czyści
// zaplanowane anulowanie - klient zostaje. Cena i waluta pochodzą z katalogu
// dostawcy (stały cennik per plan), więc nic nie przeliczamy tutaj.
export const changeSubscriptionPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => changePlanSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: sub, error: loadError } = await supabaseAdmin
      .from("user_subscriptions")
      .select("id, tenant_id, plan_id, status, external_ref, canceled_at, current_period_end")
      .eq("id", data.subscriptionId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!sub) throw new Error("subscription_not_found");
    if (sub.status !== "active") throw new Error("subscription_not_active");
    if (sub.current_period_end && new Date(sub.current_period_end).getTime() < Date.now()) {
      // Okres opłacony wygasł - zmiana planu wymaga nowego checkoutu.
      throw new Error("subscription_period_ended");
    }
    if (sub.plan_id === data.newPlanId) throw new Error("same_plan");

    const { data: newPlan, error: planErr } = await supabaseAdmin
      .from("access_plans")
      .select("id, tenant_id, active, price_cents, currency, interval, tier_key, name_pl, name_en")
      .eq("id", data.newPlanId)
      .maybeSingle();
    if (planErr) throw new Error(planErr.message);
    if (!newPlan || !newPlan.active) throw new Error("plan_not_found");
    if (newPlan.tenant_id !== sub.tenant_id) throw new Error("plan_not_found");
    const interval = String(newPlan.interval);
    if (
      interval !== "two_weeks" &&
      interval !== "month" &&
      interval !== "quarter" &&
      interval !== "year"
    ) {
      // Przepustki/plany jednorazowe nie są celem zmiany subskrypcji.
      throw new Error("plan_not_recurring");
    }

    const {
      changeSubscriptionPrice,
      catalogPriceFor,
      fetchSubscriptionSnapshot,
      isProviderSubscriptionRef,
      subscriptionEnvironment,
    } = await import("@/lib/billing/subscriptionProvider.server");
    const { planChangeDirection } = await import("@/lib/billing/catalog");
    const { paymentsConfiguredServer } = await import("@/lib/billing/mockMode.server");

    const providerConfigured = paymentsConfiguredServer();
    let providerPeriodEnd: string | null = null;

    if (providerConfigured && isProviderSubscriptionRef(sub.external_ref)) {
      const env = subscriptionEnvironment();
      const snap = await fetchSubscriptionSnapshot(env, sub.external_ref);
      if (!snap.ok) {
        console.error("[billing] subscription snapshot failed", sub.external_ref, snap.error);
        throw new Error("provider_plan_change_failed");
      }

      const targetPriceId = catalogPriceFor(newPlan.tier_key, interval);
      if (!targetPriceId) throw new Error("plan_not_switchable");
      const direction = planChangeDirection(snap.snapshot.priceId, targetPriceId);
      if (direction === "same") throw new Error("same_plan");

      const changeRes = await changeSubscriptionPrice(env, sub.external_ref, {
        newPriceExternalId: targetPriceId,
        quantity: snap.snapshot.quantity,
        direction,
      });
      if (!changeRes.ok) {
        console.error("[billing] provider plan change failed", sub.external_ref, changeRes.error);
        throw new Error("provider_plan_change_failed");
      }
      providerPeriodEnd = changeRes.currentPeriodEnd ?? snap.snapshot.currentPeriodEnd;
    } else if (providerConfigured) {
      // Subskrypcja bez identyfikatora u dostawcy (np. dożywotnia z zakupu
      // jednorazowego) nie ma czego przełączać po stronie operatora.
      throw new Error("subscription_not_switchable");
    } else if (!mockCheckoutAllowed()) {
      console.error("[checkout] billing unconfigured: refusing mock plan change in production");
      throw new Error("billing_unconfigured");
    }

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("user_subscriptions")
      .update({
        plan_id: newPlan.id,
        canceled_at: null,
        // Operator jest źródłem prawdy o kotwicy okresu; mock liczy od teraz.
        current_period_end:
          providerPeriodEnd ??
          (providerConfigured
            ? (sub.current_period_end ?? undefined)
            : periodEndFor(interval, new Date()).toISOString()),
      })
      .eq("id", sub.id)
      .select("id")
      .maybeSingle();
    if (updateErr) throw new Error(updateErr.message);
    if (!updated) throw new Error("subscription_not_found");
    return { ok: true as const };
  });

// Wznowienie subskrypcji anulowanej "na koniec okresu": dopóki opłacony okres
// trwa, operator pozwala cofnąć zaplanowaną zmianę. Lustrzane do
// cancelSubscription - najpierw operator, potem baza, żeby UI nigdy nie
// pokazywał wznowienia, którego operator nie wykonał.
export const resumeSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => cancelSubscriptionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: sub, error: loadError } = await supabaseAdmin
      .from("user_subscriptions")
      .select("id, external_ref, canceled_at, status, current_period_end")
      .eq("id", data.subscriptionId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!sub || sub.canceled_at === null || sub.status !== "active") {
      throw new Error("subscription_not_resumable");
    }
    if (sub.current_period_end && new Date(sub.current_period_end).getTime() < Date.now()) {
      // Okres wygasł - odnowienia nie ma czego reaktywować; potrzebny nowy checkout.
      throw new Error("subscription_period_ended");
    }

    const { resumeScheduledCancellation, isProviderSubscriptionRef, subscriptionEnvironment } =
      await import("@/lib/billing/subscriptionProvider.server");
    const { paymentsConfiguredServer } = await import("@/lib/billing/mockMode.server");
    if (paymentsConfiguredServer() && isProviderSubscriptionRef(sub.external_ref)) {
      const result = await resumeScheduledCancellation(subscriptionEnvironment(), sub.external_ref);
      if (!result.ok) {
        console.error("[billing] provider resume failed", sub.external_ref, result.error);
        throw new Error("provider_resume_failed");
      }
    }

    const { data: updated, error } = await supabaseAdmin
      .from("user_subscriptions")
      .update({ canceled_at: null })
      .eq("id", sub.id)
      .not("canceled_at", "is", null)
      .select("id");
    if (error) throw new Error(error.message);
    if (!updated?.length) throw new Error("subscription_not_resumable");
    return { ok: true as const };
  });
