import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { periodEndFor } from "@/lib/billing/entitlement";
import { mockCheckoutAllowed } from "@/lib/billing/mockMode.server";
import { resolveReturnUrl } from "@/lib/http/resolveReturnUrl";

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
    let trialDays = 0;
    /** Czytelny identyfikator ceny katalogowej dla subskrypcji (cykl + trial). */
    let catalogPriceId: string | null = null;
    let catalogQuantity = 1;

    // Zakup jednorazowy PLANU: kind=one_time z plan_id i bez encji. Cena
    // pochodzi z planu, płatność jest jednorazowa, a uprawnienie dożywotnie
    // (patrz entitlementForOrder).
    const isOneTimePlan = data.kind === "one_time" && !!data.plan_id && !data.entity_id;
    // Bilet na płatne wydarzenie: kind=one_time z event_id i bez planu/encji.
    const isEventTicket =
      data.kind === "one_time" && !!data.event_id && !data.plan_id && !data.entity_id;

    if (data.kind === "subscription" || isOneTimePlan) {
      if (!data.plan_id) throw new Error("plan_id_required");
      const { data: plan, error } = await supabase
        .from("access_plans")
        .select(
          "price_cents, currency, name_pl, name_en, active, interval, trial_days, tier_key, volume_threshold_seats, volume_price_cents",
        )
        .eq("id", data.plan_id)
        .maybeSingle();
      if (error) throw error;
      if (!plan || !plan.active) throw new Error("plan_not_found");
      amountCents = Number(plan.price_cents);
      currency = String(plan.currency);
      label = String(plan.name_pl || plan.name_en);
      trialDays = data.kind === "subscription" ? Math.max(0, Number(plan.trial_days ?? 0)) : 0;
      // Subskrypcja MUSI powstać z ceny katalogowej dostawcy - tylko wtedy
      // operator zakłada cykl rozliczeniowy, trial i wysyła zdarzenia
      // `subscription.*` (odnowienia, dunning, anulowanie). Cena ad-hoc dałaby
      // pojedyncze obciążenie bez odnowienia.
      if (data.kind === "subscription") {
        const { catalogPriceForPlan } = await import("@/lib/billing/catalog");
        const entry = catalogPriceForPlan({
          tier_key: plan.tier_key as string | null,
          interval: plan.interval as string | null,
        });
        if (!entry) throw new Error("plan_price_missing");
        catalogPriceId = entry.priceId;
        catalogQuantity = entry.perSeat ? Math.min(Math.max(data.seats ?? 1, 1), 100) : 1;
        // Próg wolumenowy (katalog v6.1: Zespół od 11 miejsc po 79 zł). Cena
        // u operatora jest schodkowa w trybie `volume`, czyli po osiągnięciu
        // progu WSZYSTKIE miejsca liczą się niżej - podsumowanie zamówienia
        // musi liczyć tak samo, inaczej klient zobaczy w kasie inną kwotę niż
        // na fakturze.
        const volumeThreshold = Number(plan.volume_threshold_seats ?? 0);
        const volumeUnit = Number(plan.volume_price_cents ?? 0);
        const unitCents =
          entry.perSeat && volumeThreshold >= 2 && catalogQuantity >= volumeThreshold
            ? volumeUnit
            : amountCents;
        amountCents = unitCents * catalogQuantity;
      }
    } else if (isEventTicket && data.ticket_type_id) {
      // CENNIK WYDARZENIA. Kwotę, okno sprzedaży, miejsca, rangę członkostwa
      // i kod dostępu rozstrzyga JEDNA funkcja bazy - ta sama, z której czyta
      // publiczna karta biletu. Dwie implementacje progu czasowego znaczyłyby
      // dwie różne kwoty: jedną na karcie, drugą na paragonie.
      const { data: quote, error: quoteErr } = await supabase.rpc("event_ticket_checkout_quote", {
        p_ticket_type_id: data.ticket_type_id,
        // `undefined` = brak klucza w żądaniu; RPC ma wtedy własny default.
        p_access_code: data.access_code === "" ? undefined : data.access_code,
      });
      if (quoteErr) throw new Error(quoteErr.message);
      const parsed =
        quote !== null && typeof quote === "object" && !Array.isArray(quote)
          ? (quote as Record<string, unknown>)
          : null;
      if (parsed === null) throw new Error("ticket_not_available");
      const quotedEventId = typeof parsed.event_id === "string" ? parsed.event_id : null;
      // Bilet MUSI należeć do wydarzenia wskazanego przez klienta - inaczej
      // webhook potwierdziłby RSVP na innym wydarzeniu niż opłacone.
      if (quotedEventId === null || quotedEventId !== data.event_id) {
        throw new Error("ticket_not_available");
      }
      const quotedAmount =
        typeof parsed.amount_cents === "number" ? Math.trunc(parsed.amount_cents) : 0;
      // Pula wliczona w plan zjada także wejściówki z cennika - tak samo jak
      // przy cenie z wiersza wydarzenia, więc ścieżka „za darmo" jest jedna.
      const { ticketPriceForCaller } = await import("@/lib/events/ticketAllowance.server");
      const ticketPrice = await ticketPriceForCaller(supabase, quotedAmount);
      if (ticketPrice.amountCents <= 0) throw new Error("ticket_included_in_plan");
      amountCents = ticketPrice.amountCents;
      currency = typeof parsed.currency === "string" ? parsed.currency : "PLN";
      const eventTitle =
        (typeof parsed.event_title_pl === "string" && parsed.event_title_pl) ||
        (typeof parsed.event_title_en === "string" && parsed.event_title_en) ||
        "";
      const ticketName =
        (typeof parsed.name_pl === "string" && parsed.name_pl) ||
        (typeof parsed.name_en === "string" && parsed.name_en) ||
        "";
      label = ticketName === "" ? eventTitle : `${eventTitle} - ${ticketName}`;
      ticketListPriceCents =
        typeof parsed.list_price_cents === "number" ? Math.trunc(parsed.list_price_cents) : 0;
      const phase =
        parsed.phase !== null && typeof parsed.phase === "object" && !Array.isArray(parsed.phase)
          ? (parsed.phase as Record<string, unknown>)
          : null;
      const phaseSource = typeof phase?.source === "string" ? phase.source : "";
      const phaseName =
        (typeof phase?.label_pl === "string" && phase.label_pl) ||
        (typeof phase?.label_en === "string" && phase.label_en) ||
        "";
      ticketPhaseLabel =
        phaseName ||
        (phaseSource === "early_bird"
          ? "Early bird"
          : phaseSource === "last_minute"
            ? "Last minute"
            : phaseSource === "phase"
              ? "Faza sprzedaży"
              : "");
    } else if (isEventTicket) {
      // Cena biletu pochodzi z wiersza wydarzenia (RLS jako użytkownik), więc
      // klient przekazuje wyłącznie identyfikator wydarzenia.
      const { data: ev, error: evErr } = await supabase
        .from("events")
        .select("id, title_pl, title_en, ticket_price_cents, ticket_currency, status, starts_at")
        .eq("id", data.event_id ?? "")
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
    if (data.coupon_code && data.coupon_code.trim().length > 0) {
      const normalizedCode = data.coupon_code.trim().toUpperCase();
      const { data: rows, error: validateErr } = await supabase.rpc("validate_b2b_coupon", {
        _code: normalizedCode,
        _plan_id: data.plan_id ?? "00000000-0000-0000-0000-000000000000",
        _amount_cents: amountCents,
        _currency: currency,
      });
      if (validateErr) throw validateErr;
      const row = (rows ?? [])[0];
      if (!row || !row.ok) {
        return {
          ok: false as const,
          mode: "coupon" as const,
          error: (row?.error ?? "not_found") as string,
        };
      }
      couponId = row.coupon_id;
      couponCode = normalizedCode;
      couponDiscountCents = row.discount_cents;
      amountCents = row.final_cents;
      // Bezpiecznik: rabat 100% (final=0) traktujemy jak darmowy przydział -
      // i tak nie przejdzie minimalnej kwoty transakcji, więc odrzucamy < 50 gr.
      if (amountCents < 50) {
        return {
          ok: false as const,
          mode: "coupon" as const,
          error: "final_amount_too_low" as const,
        };
      }
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
    // Subskrypcja idzie z ceny katalogowej, więc walutę rozstrzyga operator
    // (`unit_price_overrides` EUR + lokalizacja) - lokalna konwersja tylko
    // rozjechałaby zamówienie z faktyczną kwotą obciążenia.
    if (data.display_currency && !catalogPriceId) {
      const [{ couponAuditInDisplayCurrency }, { ensureFxRateLoaded }] = await Promise.all([
        import("@/lib/billing/displayCurrency"),
        import("@/lib/billing/fxRate"),
      ]);
      await ensureFxRateLoaded();
      const conv = couponAuditInDisplayCurrency(
        originalCents,
        amountCents,
        currency,
        data.display_currency,
      );
      originalCents = conv.originalCents;
      amountCents = conv.finalCents;
      couponDiscountCents = conv.discountCents;
      currency = conv.currency;
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
        kind: data.kind,
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
          ...(eventId ? { event_id: eventId } : {}),
          ...(ticketTypeId ? { ticket_type_id: ticketTypeId } : {}),
          ...(couponCode
            ? {
                coupon_code: couponCode,
                coupon_id: couponId,
                coupon_discount_cents: couponDiscountCents,
                original_amount_cents: originalCents,
              }
            : {}),
        },
      } as never)
      .select("id, tenant_id")
      .single();
    if (insertError) throw insertError;

    // Atomowe rezerwowanie użycia kuponu - RPC sam sprawdza limity pod
    // blokadą wiersza, więc nawet równoległe zamówienia nie przekroczą maxa.
    if (couponId) {
      const { data: redeemed, error: redeemErr } = await supabase.rpc("redeem_b2b_coupon", {
        _coupon_id: couponId,
        _order_id: order.id,
        _applied_cents: couponDiscountCents,
        _original_cents: originalCents,
        _currency: currency,
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

      // Flagi checkoutu TENANTA ZAMÓWIENIA (kupony, Stripe Tax, NIP, faktury).
      // Zawężamy je do `order.tenant_id`, a nie do tenantu żądania - sesja u
      // operatora ma jechać na tej konfiguracji, którą stempluje zamówienie.
      const { loadCheckoutSettings } = await import("@/lib/billing/checkoutSettings.server");
      const settings = await loadCheckoutSettings(supabase, order.tenant_id);

      // Subskrypcja: sesja z CENY KATALOGOWEJ (cykl rozliczeniowy, trial,
      // lokalizacja waluty przez ceny Stripe). Tylko taka sesja zakłada u
      // operatora subskrypcję, a więc odnowienia, dunning i zdarzenia
      // `customer.subscription.*`. Rabat kuponu przekazujemy jako rabat
      // operatora - kwota nadal nie pochodzi od klienta.
      if (catalogPriceId) {
        const { createPlanCheckoutSession } = await import("@/lib/billing/adhocCheckout.server");
        let discount: { coupon: string } | null = null;
        if (couponCode && couponDiscountCents > 0) {
          const { createStripeClient } = await import("@/lib/stripe.server");
          const { createAdhocDiscountForCoupon } =
            await import("@/lib/billing/adhocCheckout.server");
          const stripe = createStripeClient(environment);
          const couponRef = await createAdhocDiscountForCoupon(stripe, {
            code: couponCode,
            discountCents: couponDiscountCents,
            currency,
          });
          if (couponRef) discount = { coupon: couponRef };
        }
        const createdSub = await createPlanCheckoutSession({
          environment,
          priceLookupKey: catalogPriceId,
          quantity: catalogQuantity,
          planId: data.plan_id as string,
          orderId: order.id,
          userId,
          customerEmail: receiptEmail,
          returnUrl,
          discount,
          // Bez tego okres próbny planu jest martwy: metadane ceny w katalogu
          // operatora niczego nie wymuszają, a karta zostaje obciążona od razu.
          trialDays,
        });
        if (!createdSub.ok) {
          await (
            await import("@/lib/billing/markOrderSession.server")
          ).markOrderSession(supabase, { orderId: order.id, sessionId: null, status: "failed" });
          if (couponId) {
            const { error: releaseErr } = await supabase.rpc("release_b2b_coupon", {
              _coupon_id: couponId,
              _order_id: order.id,
            });
            if (releaseErr) {
              console.error("[checkout] coupon release failed", order.id, releaseErr.message);
            }
          }
          return {
            ok: false as const,
            mode: "stripe" as const,
            error: createdSub.error,
            orderId: order.id,
          };
        }
        await (
          await import("@/lib/billing/markOrderSession.server")
        ).markOrderSession(supabase, {
          orderId: order.id,
          sessionId: createdSub.sessionId,
          status: "processing",
        });
        return {
          ok: true as const,
          mode: "stripe" as const,
          clientSecret: createdSub.clientSecret,
          orderId: order.id,
        };
      }

      // Kwota jest wyliczona serwerowo (plan / reguła dostępu / kupon /
      // waluta prezentacji), więc zamiast ceny katalogowej tworzymy sesję z
      // ceną osadzoną (`price_data`) i zwracamy `clientSecret` do nakładki.
      const { createAdhocCheckoutSession } = await import("@/lib/billing/adhocCheckout.server");

      // Rabat fazy sprzedaży (early bird / last minute) i benefit planu widoczne
      // w nakładce: pozycja idzie w cenie regularnej, różnicę zdejmuje kupon
      // jednorazowy. Bez tego kupujący widzi samą kwotę końcową i nie ma jak
      // sprawdzić, że promocja faktycznie zadziałała.
      let ticketDiscount: { coupon: string } | null = null;
      let lineAmountCents = amountCents;
      const phaseDiscountCents = ticketListPriceCents - amountCents;
      if (eventId && phaseDiscountCents > 0 && amountCents >= 50) {
        const { createStripeClient } = await import("@/lib/stripe.server");
        const { createAdhocDiscountForCoupon } = await import("@/lib/billing/adhocCheckout.server");
        const couponRef = await createAdhocDiscountForCoupon(createStripeClient(environment), {
          code: ticketPhaseLabel || "Rabat",
          discountCents: phaseDiscountCents,
          currency,
        }).catch((err: unknown) => {
          console.error("[checkout] phase discount failed", order.id, err);
          return null;
        });
        if (couponRef) {
          ticketDiscount = { coupon: couponRef };
          lineAmountCents = ticketListPriceCents;
        }
      }

      const created = await createAdhocCheckoutSession({
        environment,
        name: label || "Zamówienie",
        amountCents: lineAmountCents,
        discount: ticketDiscount,
        currency,
        orderId: order.id,
        purpose: eventId ? "event_ticket" : "content_unlock",
        userId,
        customerEmail: receiptEmail,
        returnUrl,
        metadata: eventId
          ? { event_id: eventId, ...(ticketTypeId ? { ticket_type_id: ticketTypeId } : {}) }
          : {},
        settings,
      });
      if (!created.ok) {
        await (
          await import("@/lib/billing/markOrderSession.server")
        ).markOrderSession(supabase, { orderId: order.id, sessionId: null, status: "failed" });
        // Kupon został zarezerwowany PRZED utworzeniem sesji. Skoro dostawca
        // odmówił, użycie musi wrócić do puli - inaczej limit przepadłby za
        // zamówienie, którego nikt nigdy nie opłaci.
        if (couponId) {
          const { error: releaseErr } = await supabase.rpc("release_b2b_coupon", {
            _coupon_id: couponId,
            _order_id: order.id,
          });
          if (releaseErr) {
            console.error("[checkout] coupon release failed", order.id, releaseErr.message);
          }
        }
        return {
          ok: false as const,
          mode: "stripe" as const,
          error: created.error,
          orderId: order.id,
        };
      }

      await (
        await import("@/lib/billing/markOrderSession.server")
      ).markOrderSession(supabase, {
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
    return {
      ok: true as const,
      mode: "mock" as const,
      url: `${data.success_path}?order=${order.id}&mock=1`,
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
