// Molekuła: JEDYNA droga ze zgłoszenia „unpaid" do kasy.
//
// PO CO TO ISTNIEJE. Migracja `20260828206000` zamknęła dziurę, w której płatna
// wejściówka wychodziła za darmo: zgłoszenie powstaje jako `pending`,
// z `payment_status = 'unpaid'` i BEZ kodu QR. Nagłówek tamtej migracji
// zapisał sobie resztę pracy wprost - „żeby formularz miał czym pokierować do
// kasy zamiast pokazywać potwierdzenie". Do tej molekuły ekran potwierdzenia
// mówił „nie masz jeszcze wejściówki" i na tym kończył: bez przycisku, bez
// odnośnika, bez niczego.
//
// PRZEBIEG SKOPIOWANY, KOMPONENT NIE. `EventTicketPurchase` (moduł
// społeczności) ma działający przebieg `createCheckoutOrder` → `clientSecret`
// → osadzony modal operatora, ale liczy cenę z WIERSZA WYDARZENIA i nie zna
// zgłoszeń etapu 4 ani cennika wejściówek. Wspólny jest przebieg, nie ekran.
//
// KWOTY NIE WYSYŁAMY. Klient przekazuje wyłącznie identyfikatory; kwotę liczy
// `event_ticket_checkout_quote` po stronie bazy - ta sama funkcja, z której
// czyta kartę biletu. Kwota na tym ekranie jest informacją, nie żądaniem.
//
// `registration_id` JEST KLUCZEM DOWIĄZANIA. Bez niego
// `payments_apply_event_ticket_outcome` dopasowuje wpłatę PO OSOBIE z `LIMIT 1`
// po dacie utworzenia, więc uczestnik z dwoma zgłoszeniami na to samo
// wydarzenie dostaje opłacony bilet przypięty do najnowszego wiersza -
// niekoniecznie tego, za który zapłacił.
//
// KWOTA POD PRZYCISKIEM TO PODGLĄD KASY, NIE CENA MIEJSCA. `amountCents`
// z bazy to cena JEDNEGO miejsca bez kodu - dla zamówienia grupowego na trzy
// osoby z kodem „-20 zł" ekran mówił „100 zł", a nakładka Stripe 240 zł.
// Właściciel czytał to jako „kod odjął się raz". Molekuła pyta więc
// `quoteEventTicketCheckout` (ta sama funkcja, którą liczy kasa) i pokazuje
// rozbicie: miejsca × cena, kod × miejsca, do zapłaty (z „+ podatek", gdy
// Stripe dolicza podatek do kwoty). Odmowa kodu pada TU, przed otwarciem kasy.
//
// KOD Z PAMIĘCI NIE BLOKUJE PŁATNOŚCI. Kod zapamiętany z linku `?code=` wpisał
// do pola ekran, nie kupujący - i zwykle odsłania bilet UKRYTY, a kupujący mógł
// wybrać inny. Kasa odmówiłaby go wtedy jako `ticket_not_eligible` (albo
// `expired`), zanim w ogóle doszłaby do „bez rabatu". Każda odmowa takiego kodu
// zdejmuje go więc z pola z jednym zdaniem wyjaśnienia; zdanie o błędnym kodzie
// dostaje tylko kod wpisany ręcznie.
//
// KOD DOSTĘPU WEJŚCIÓWKI JEDZIE DO PODGLĄDU I DO KASY. Bilet za kodem
// (`event_ticket_types.access_code_hash`) sprawdza go nie tylko przy zapisie,
// ale i w `event_ticket_checkout_quote` - bez `access_code` kasa odmawiała
// (`ticket_access_code_invalid`) zgłoszenia, które baza CHWILĘ WCZEŚNIEJ
// przyjęła z kodem. Kod bierzemy z pamięci karty (`recallAccessCodeHint`: ten,
// z którym przyjęto zapis, albo kod z linku zaproszenia); bilet bez kodu go
// pomija. To INNY kod niż rabatowy - zdjęcie kuponu z pola nie zdejmuje kodu
// dostępu. Z innej karty (link samoobsługi, profil) pamięci nie ma - odmowa
// podglądu albo kasy odsłania wtedy pole kodu dostępu.
//
// GOŚĆ BEZ KONTA NIE DOSTAJE MARTWEGO PRZYCISKU. `createCheckoutOrder` stoi za
// `requireSupabaseAuth`, a księgowanie wpłaty wymaga `payment_orders.user_id`,
// więc gość zobaczy zdanie z prawdziwym powodem (paragon i droga zwrotu należą
// do konta) i odnośnik do logowania - a nie kontrolkę, która go wyrzuci.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CreditCard, Loader2, LogIn } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { createCheckoutOrder } from "@/lib/billing/checkout.functions";
import { quoteEventTicketCheckout } from "@/lib/billing/eventTicketQuote.functions";
import { formatMoney } from "@/lib/billing/types";
import { getStripeEnvironment } from "@/lib/stripe";
import { LazyEmbeddedCheckoutDialog } from "@/components/checkout/LazyEmbeddedCheckoutDialog";
import {
  admissionQuoteMessageKey,
  ticketCheckoutRefusal,
  type TicketCheckoutRefusal,
} from "@/lib/events/admissionApi";
import { RegistrationAmountDue } from "@/components/events/registration/atoms/RegistrationAmountDue";
import {
  recallAccessCodeHint,
  recallEventCode,
  rememberTicketAccessCode,
} from "@/lib/events/eventCodeMemory";
import { ensureEventRegistrationI18n } from "@/lib/i18n-event-registration";

ensureEventRegistrationI18n();

/**
 * Prefiks klucza podglądu kasy. Jeden dla wszystkich zgłoszeń, bo odświeżamy
 * go hurtem po każdej udanej mutacji na ekranie (dopisanie gości zmienia
 * liczbę miejsc, a panel gości nie wie o tej molekule).
 */
const QUOTE_KEY = ["events", "ticket-checkout-quote"] as const;

function normalizeCode(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * Kod zdjęty z pola bez udziału kupującego i powód: `revealOnly` - kod nie daje
 * rabatu (tylko odsłania bilety), `remembered` - kod z pamięci, którego kasa
 * nie przyjmuje dla TEGO biletu (inny bilet, termin, limit).
 */
interface DroppedCode {
  code: string;
  reason: "revealOnly" | "remembered";
}

export interface RegistrationPayActionProps {
  registrationId: string;
  /** Wydarzenie i wejściówka - kasa wymaga kompletu, `null` wyłącza przycisk. */
  eventId: string | null;
  ticketTypeId: string | null;
  amountCents: number | null;
  currency: string | null;
  /** Dokąd wraca kupujący z kasy (sukces i rezygnacja). */
  returnPath: string;
  /** „Zapłać" na ekranie potwierdzenia, „Dokończ płatność" przy powrocie. */
  intent?: "pay" | "resume";
  /**
   * Czy TA molekuła ma pokazać kwotę (rozbicie z podglądu kasy).
   *
   * Domyślne `true` na każdej powierzchni: ekran potwierdzenia, panel
   * uczestnika i strona samoobsługi NIE mówią już kwoty same, bo znają tylko
   * cenę jednego miejsca - a zamówienie grupowe i kod zmieniają sumę.
   */
  showAmount?: boolean;
  /**
   * Zgłoszenie należy do zalogowanego wołającego.
   *
   * `undefined` znaczy „nie wiemy" - wtedy pytamy tylko o zalogowanie, bo
   * autorytetem i tak jest baza (`event_registration_payment_context`).
   */
  ownedByCaller?: boolean;
}

export function RegistrationPayAction({
  registrationId,
  eventId,
  ticketTypeId,
  amountCents,
  currency,
  returnPath,
  intent = "pay",
  showAmount = true,
  ownedByCaller,
}: RegistrationPayActionProps) {
  const { t, i18n } = useTranslation();
  const { session } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const checkout = useServerFn(createCheckoutOrder);
  const quoteFn = useServerFn(quoteEventTicketCheckout);

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<TicketCheckoutRefusal | null>(null);
  // Kod rabatowy to tylko napis - rabat liczy validate_event_ticket_coupon
  // w `createCheckoutOrder`, a Stripe dostaje go jako kupon na różnicę ceny.
  const [promo, setPromo] = useState("");
  // Kod, dla którego liczymy PODGLĄD. Osobno od pola, bo podgląd nie pyta
  // bazy przy każdym znaku - dopiero „Zastosuj" albo „Zapłać".
  const [appliedCode, setAppliedCode] = useState("");
  const [promoRejected, setPromoRejected] = useState(false);
  /**
   * Kod wpisany do pola Z PAMIĘCI (`recallEventCode`), dopóki nie zostanie
   * zdjęty. Kod o tej samej treści wpisany ręcznie PO zdjęciu jest już kodem
   * kupującego - i jego odmowa dostaje zwykłe zdanie o błędnym kodzie.
   */
  const [memoryCode, setMemoryCode] = useState<string | null>(null);
  /** Kod zdjęty z pola po cichu - zdanie wyjaśnia, dlaczego zniknął. */
  const [droppedCode, setDroppedCode] = useState<DroppedCode | null>(null);
  useEffect(() => {
    if (eventId !== null) {
      const remembered = recallEventCode(eventId);
      const normalized = normalizeCode(remembered);
      setPromo(remembered);
      setAppliedCode(normalized);
      setMemoryCode(normalized === "" ? null : normalized);
    }
  }, [eventId]);
  /** Kod dostępu wejściówki - osobny od kuponu, patrz nagłówek. */
  const [accessCode, setAccessCode] = useState("");
  const [accessInput, setAccessInput] = useState("");
  useEffect(() => {
    if (eventId !== null && ticketTypeId !== null) {
      const remembered = recallAccessCodeHint(eventId, ticketTypeId);
      setAccessCode(remembered);
      setAccessInput(remembered);
    }
  }, [eventId, ticketTypeId]);
  const accessPart = accessCode === "" ? {} : { access_code: accessCode };

  const ready = eventId !== null && ticketTypeId !== null;
  const quoteQ = useQuery({
    queryKey: [...QUOTE_KEY, registrationId, eventId, ticketTypeId, appliedCode, accessCode],
    queryFn: () =>
      quoteFn({
        data: {
          event_id: eventId as string,
          ticket_type_id: ticketTypeId as string,
          registration_id: registrationId,
          ...(appliedCode.length > 0 ? { coupon_code: appliedCode } : {}),
          ...accessPart,
        },
      }),
    // Podgląd stoi za `requireSupabaseAuth` i czyta zgłoszenie WOŁAJĄCEGO -
    // bez sesji albo z cudzym zgłoszeniem nie ma czego liczyć.
    enabled: ready && session !== null && ownedByCaller !== false,
    retry: false,
  });
  const quote = quoteQ.data ?? null;
  // Podgląd sprzed benefitu na miejscu członka (starszy serwer) pola nie ma -
  // wtedy wszystkie miejsca są po tej samej cenie.
  const quoteBenefit = quote?.planBenefit ?? null;

  // KOD BEZ RABATU ANI KOD Z PAMIĘCI NIE BLOKUJĄ PŁATNOŚCI. Kod bez rabatu
  // (`no_discount`) nie ma czego odjąć, a kod z linku `?code=` odsłania zwykle
  // bilet, którego kupujący NIE wybrał - kasa odrzuciłaby go i kupujący nie
  // mógłby zapłacić, dopóki sam nie wyczyści pola. Zdejmujemy je więc sami.
  useEffect(() => {
    if (quote === null || quote.couponError === null || appliedCode === "") return;
    const revealOnly = quote.couponError === "no_discount";
    if (!revealOnly && appliedCode !== memoryCode) return;
    setDroppedCode({ code: appliedCode, reason: revealOnly ? "revealOnly" : "remembered" });
    setMemoryCode(null);
    setAppliedCode("");
    setPromo("");
  }, [quote, appliedCode, memoryCode]);

  // Dopisanie gości (panel ponowienia) zmienia liczbę miejsc zamówienia, ale
  // nie wie o tej molekule. Każda udana mutacja na ekranie odświeża więc
  // podgląd - inaczej rozbicie mówiłoby o jednym miejscu, a kasa o trzech.
  useEffect(
    () =>
      queryClient.getMutationCache().subscribe((event) => {
        if (event.type === "updated" && event.action.type === "success") {
          void queryClient.invalidateQueries({ queryKey: QUOTE_KEY });
        }
      }),
    [queryClient],
  );

  // BRAK KONTA. Zdanie ma być prawdziwe - „płatna wejściówka wymaga konta, bo
  // do niego należy paragon i możliwość zwrotu" - a nie ogólne „zaloguj się".
  if (session === null) {
    return (
      <div className="space-y-2 rounded-[6px] border border-border bg-muted/30 p-3">
        <p className="text-sm font-semibold text-foreground">
          {t("eventRegistration.payment.accountRequiredTitle")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("eventRegistration.payment.accountRequiredBody")}
        </p>
        {showAmount && <RegistrationAmountDue amountCents={amountCents} currency={currency} />}
        <Link
          to="/login"
          search={{ mode: "signin" }}
          className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
        >
          <LogIn className="h-4 w-4" aria-hidden="true" />
          {t("eventRegistration.payment.signIn")}
        </Link>
      </div>
    );
  }

  // ZALOGOWANY, ALE NIE WŁAŚCICIEL. Baza odmówi (`not_found`), więc mówimy
  // o tym zawczasu, zamiast prowadzić do kasy pod odmowę.
  if (ownedByCaller === false) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t("eventRegistration.payment.notOwnerBody")}
      </p>
    );
  }

  function applyCode(): void {
    const code = normalizeCode(promo);
    setPromoRejected(false);
    setDroppedCode(null);
    if (code === appliedCode) {
      void quoteQ.refetch();
      return;
    }
    setAppliedCode(code);
  }

  /**
   * Kod dostępu wpisany po odmowie. Pole stoi tylko przy odmowie podglądu albo
   * kasy, a obie wymagają kompletu identyfikatorów (`ready`). Zapamiętujemy
   * go od razu - następne otwarcie kasy w tej karcie nie zapyta drugi raz.
   */
  function applyAccessCode(): void {
    const code = normalizeCode(accessInput);
    setRefusal(null);
    rememberTicketAccessCode(eventId as string, ticketTypeId as string, code);
    if (code === accessCode) {
      void quoteQ.refetch();
      return;
    }
    setAccessCode(code);
  }

  /**
   * `override` = kod wymuszony (pusty przy ponowieniu bez kodu bez rabatu).
   * Bramką „bez kompletu identyfikatorów nie ma kasy" jest `disabled` przycisku
   * (`!ready`) - to jedyne miejsce, z którego ta funkcja rusza.
   */
  async function pay(override?: string): Promise<void> {
    setBusy(true);
    setRefusal(null);
    setPromoRejected(false);
    const code = override ?? normalizeCode(promo);
    // Kod wpisany bez „Zastosuj" też trafia do podglądu - rozbicie pod
    // przyciskiem ma mówić o tym samym kodzie, który dostaje kasa.
    setAppliedCode(code);
    try {
      const result = await checkout({
        data: {
          kind: "one_time",
          event_id: eventId,
          ticket_type_id: ticketTypeId,
          registration_id: registrationId,
          success_path: returnPath,
          cancel_path: returnPath,
          environment: getStripeEnvironment(),
          ...(code.length > 0 ? { coupon_code: code } : {}),
          ...accessPart,
        },
      });
      if (!result.ok) {
        if (result.mode === "coupon") {
          // Kod bez rabatu albo kod z pamięci nie jest powodem, żeby nie
          // zapłacić: zdejmujemy go i płacimy cenę biletu (to samo, co robi
          // podgląd). Pusty kod nie wraca do kasy drugi raz - odmowa kodu,
          // którego nie wysłaliśmy, nie może zapętlić ponowienia.
          const revealOnly = result.error === "no_discount";
          if (code !== "" && (revealOnly || code === memoryCode)) {
            setDroppedCode({ code, reason: revealOnly ? "revealOnly" : "remembered" });
            setMemoryCode(null);
            setPromo("");
            await pay("");
            return;
          }
          setPromoRejected(true);
          return;
        }
        // Odmowa kuponu/konfiguracji wraca jako `ok: false` z własnym kodem;
        // mapujemy ją tym samym słownikiem, co odmowy wyceny.
        setRefusal(ticketCheckoutRefusal(result.error));
        return;
      }
      if (result.mode === "stripe") {
        setClientSecret(result.clientSecret);
        return;
      }
      // Tryb mock (brak dostawcy w dev) - ta sama trasa, co przy zakupie biletu.
      void navigate({ to: "/checkout/success", search: { order: result.orderId, mock: 1 } });
    } catch (error: unknown) {
      setRefusal(ticketCheckoutRefusal(error));
    } finally {
      setBusy(false);
    }
  }

  const money = (cents: number, code: string): string => formatMoney(cents, code, i18n.language);
  // Odmowa kodu z pamięci nie jest błędem kupującego - efekt wyżej zdejmie go
  // z pola, więc zdanie o błędnym kodzie nie mignie nawet na jedną klatkę.
  const codeRefused =
    promoRejected ||
    (quote !== null &&
      quote.couponError !== null &&
      quote.couponError !== "no_discount" &&
      appliedCode !== memoryCode);
  // Odmowa podglądu (zgłoszenie, bilet, liczba miejsc) to ta sama odmowa, którą
  // dałaby kasa - mówimy ją od razu, a po kliknięciu „Zapłać" wygrywa odmowa kasy.
  const shownRefusal = refusal ?? (quoteQ.isError ? ticketCheckoutRefusal(quoteQ.error) : null);

  return (
    <div className="space-y-2">
      <LazyEmbeddedCheckoutDialog
        clientSecret={clientSecret}
        onOpenChange={(open) => {
          if (!open) setClientSecret(null);
        }}
      />
      {/* BEZ KOMPLETU IDENTYFIKATORÓW (starszy backend) podglądu nie ma - zostaje
          kwota z bazy, a przycisk i tak jest wyłączony. */}
      {showAmount && !ready && (
        <RegistrationAmountDue amountCents={amountCents} currency={currency} />
      )}
      {showAmount && ready && quote === null && !quoteQ.isError && (
        <p className="text-sm text-muted-foreground">
          {t("eventRegistration.payment.quoteLoading")}
        </p>
      )}
      {showAmount && quote !== null && (
        <div className="space-y-0.5 text-sm">
          {/* BENEFIT PLANU MA JEDNO MIEJSCE: członka. Grupa z benefitem mówi
              więc osobno „Twoje miejsce" i „Goście: N × cena z cennika" -
              jedno „3 × cena" byłoby nieprawdą dla któregoś z miejsc. */}
          {quote.seats > 1 && quoteBenefit === null && (
            <p className="text-muted-foreground">
              {t("eventRegistration.payment.quoteSeats", {
                count: quote.seats,
                unit: money(quote.unitCents, quote.currency),
              })}
            </p>
          )}
          {quote.seats > 1 && quoteBenefit !== null && (
            <>
              <p className="text-muted-foreground">
                {quoteBenefit === "included"
                  ? t("eventRegistration.payment.quoteLeadIncluded")
                  : t("eventRegistration.payment.quoteLeadSeat", {
                      unit: money(quote.leadUnitCents, quote.currency),
                    })}
              </p>
              <p className="text-muted-foreground">
                {t("eventRegistration.payment.quoteGuestSeats", {
                  count: quote.seats - 1,
                  unit: money(quote.unitCents, quote.currency),
                })}
              </p>
            </>
          )}
          {quote.coupon !== null && (
            <p className="text-muted-foreground">
              {/* Kod kwotowy na kilku miejscach: „-20 zł × 3" - dokładnie to,
                  czego właściciel nie widział nigdzie przed nakładką Stripe. */}
              {quote.coupon.kind === "fixed" &&
              quote.coupon.perSeatCents !== null &&
              quote.seats > 1
                ? t("eventRegistration.payment.quoteCodeFixed", {
                    code: quote.coupon.code,
                    perSeat: money(quote.coupon.perSeatCents, quote.currency),
                    count: quote.seats,
                  })
                : quote.coupon.kind === "percent" && quote.coupon.percent !== null
                  ? t("eventRegistration.payment.quoteCodePercent", {
                      code: quote.coupon.code,
                      percent: quote.coupon.percent,
                      amount: money(quote.discountCents, quote.currency),
                    })
                  : t("eventRegistration.payment.quoteCodeAmount", {
                      code: quote.coupon.code,
                      amount: money(quote.discountCents, quote.currency),
                    })}
            </p>
          )}
          <p className="font-medium text-foreground">
            {/* PODATEK DOLICZANY dolicza Stripe do kwoty sesji - bez dopisku
                „Do zapłaty" byłoby niższe niż obciążenie karty. */}
            {quote.taxMode === "exclusive"
              ? t("eventRegistration.payment.amountDuePlusTax", {
                  amount: money(quote.totalCents, quote.currency),
                })
              : t("eventRegistration.payment.amountDue", {
                  amount: money(quote.totalCents, quote.currency),
                })}
          </p>
        </div>
      )}
      <div className="flex max-w-md flex-wrap items-end gap-2">
        <label className="block min-w-0 flex-1 space-y-1 text-sm">
          <span className="font-medium">{t("eventRegistration.payment.promoLabel")}</span>
          <input
            value={promo}
            maxLength={64}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setPromo(event.target.value.toUpperCase())}
            placeholder={t("eventRegistration.payment.promoPlaceholder")}
            className="h-10 w-full rounded-[6px] border border-input bg-background px-3 text-sm uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <Button type="button" variant="outline" disabled={busy || !ready} onClick={applyCode}>
          {t("eventRegistration.payment.promoApply")}
        </Button>
      </div>
      <span className="block text-xs text-muted-foreground">
        {t("eventRegistration.payment.promoHint")}
      </span>
      {droppedCode !== null && (
        <p role="status" className="text-sm text-muted-foreground">
          {droppedCode.reason === "revealOnly"
            ? t("eventRegistration.payment.promoRevealOnly", { code: droppedCode.code })
            : t("eventRegistration.payment.promoRememberedDropped", { code: droppedCode.code })}
        </p>
      )}
      {codeRefused && (
        <p role="status" className="text-sm text-destructive">
          {t("eventRegistration.payment.promoError")}
        </p>
      )}
      <Button type="button" disabled={busy || !ready} onClick={() => void pay()}>
        {busy ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <CreditCard className="mr-2 h-4 w-4" aria-hidden="true" />
        )}
        {busy
          ? t("eventRegistration.payment.paying")
          : intent === "resume"
            ? t("eventRegistration.payment.resume")
            : t("eventRegistration.payment.payNow")}
      </Button>
      {shownRefusal !== null && (
        <p role="status" className="text-sm text-destructive">
          {t(admissionQuoteMessageKey(shownRefusal))}
        </p>
      )}
      {/* Kod dostępu nie dotarł z pamięci karty (inna karta, inny kod) albo
          baza go nie przyjęła - kupujący wpisuje go tutaj, bez wracania do
          formularza zapisu. */}
      {shownRefusal === "access_code_invalid" && (
        <div className="flex max-w-md flex-wrap items-end gap-2">
          <label className="block min-w-0 flex-1 space-y-1 text-sm">
            <span className="font-medium">{t("eventRegistration.payment.accessCodeLabel")}</span>
            <input
              value={accessInput}
              maxLength={64}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setAccessInput(event.target.value.toUpperCase())}
              className="h-10 w-full rounded-[6px] border border-input bg-background px-3 text-sm uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <Button type="button" variant="outline" disabled={busy} onClick={applyAccessCode}>
            {t("eventRegistration.payment.accessCodeApply")}
          </Button>
        </div>
      )}
    </div>
  );
}
