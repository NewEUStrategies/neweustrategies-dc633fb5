// Stan PROSBY O FAKTURE przy zakupie (krok platnosci zapisu, zakup pakietu,
// profil) - jeden hak dla trzech miejsc.
//
// CO ROBI.
//   * Podpowiada dane: najpierw z juz zapisanej prosby tego zamowienia,
//     inaczej z profilu rozliczeniowego (`["my-billing"]`, ten sam klucz co
//     `BillingProfileForm`). Podpowiedz NIE nadpisuje tego, co kupujacy juz
//     wpisal.
//   * "ZAPAMIETAJ WYBOR" = profil rozliczeniowy, nie localStorage: zaznaczone
//     "zapamietaj" zapisuje dane w profilu kupujacego, a przy nastepnym
//     zakupie wlaczenie "potrzebuje faktury" od razu je wstawia. Dane
//     zostaja na koncie kupujacego (jego wlasne dane), bez nowego klucza
//     w magazynie przegladarki i bez pytania o zgode.
//   * BLOK POKAZUJEMY TYLKO, GDY FAKTURA MOZE POWSTAC. Jedno lekkie zapytanie
//     (`event_invoice_public_options`) mowi, czy organizator fakturuje i czy
//     platnosc KARTA moze dostac jego fakture. Organizator bez potwierdzonego
//     wystawcy = bloku nie ma; platnosc karta w trybie operatora albo
//     z fakturami Stripe = zamiast bloku zdanie, ze fakture wystawia operator
//     (kupujacy nie wpisuje danych firmy na prozno i nie czeka na dokument,
//     ktory nie powstanie). Blad zapytania = bloku nie ma (nie obiecujemy).
//   * Profil rozliczeniowy i zapisane prosby pobieramy dopiero, gdy kupujacy
//     zaznaczy "potrzebuje faktury".
//   * `commit()` przed przejsciem do kasy: waliduje, zapisuje prosbe
//     (`event_invoice_request_save`), opcjonalnie profil. Zwraca `false`, gdy
//     kupujacy musi cos poprawic - wolajacy wtedy NIE otwiera kasy.
//
// Prosba jest opcjonalna: wylaczony przelacznik = `commit()` zwraca `true`
// bez zadnego zapisu.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { fetchMyBillingProfile, upsertMyBillingProfile } from "@/lib/billing/queries";
import type { BillingProfile } from "@/lib/billing/types";
import {
  billingProfileFromBuyerDraft,
  buyerDraftFromBillingProfile,
  buyerDraftFromColumns,
  emptyBuyerDraft,
  hasBuyerErrors,
  validateBuyerDraft,
  type InvoiceBuyerDraft,
  type InvoiceBuyerErrors,
} from "@/lib/events/eventInvoiceBuyerDraft";
import type {
  InvoicePublicOptions,
  InvoiceRequestTarget,
  MyInvoiceSourceRow,
} from "@/lib/events/myEventInvoicesApi";
import {
  useInvoicePublicOptions,
  useMyInvoiceSources,
  useSaveInvoiceRequest,
} from "@/lib/events/useMyEventInvoices";
import { eventInvoiceErrorKey } from "@/lib/events/eventInvoiceErrors";

/**
 * Czy kupujacy moze tu poprosic o fakture organizatora:
 * `available` - blok prosby; `operator` - fakture wystawia operator platnosci
 * (tylko zdanie); `unavailable` - nic; `loading` - jeszcze nie wiadomo (nic).
 */
export type InvoiceRequestAvailability = "loading" | "available" | "operator" | "unavailable";

/** Jak zaplaci kupujacy: krok platnosci zapisu = karta, pakiet = przelew. */
export type InvoiceRequestPayment = "card" | "transfer";

export function invoiceRequestAvailability(
  options: InvoicePublicOptions | undefined,
  failed: boolean,
  payment: InvoiceRequestPayment,
): InvoiceRequestAvailability {
  if (options === undefined) return failed ? "unavailable" : "loading";
  if (payment === "transfer") return options.enabled ? "available" : "unavailable";
  if (options.cardInvoiceable) return "available";
  return options.cardOperatorInvoice ? "operator" : "unavailable";
}

export interface InvoiceRequestController {
  availability: InvoiceRequestAvailability;
  wanted: boolean;
  setWanted: (value: boolean) => void;
  buyer: InvoiceBuyerDraft;
  setBuyer: (value: InvoiceBuyerDraft) => void;
  remember: boolean;
  setRemember: (value: boolean) => void;
  errors: InvoiceBuyerErrors;
  showErrors: boolean;
  /** Zamowienie ma juz wystawiona fakture - prosby nie wysylamy. */
  invoicedNumber: string | null;
  /** Zapisana wczesniej prosba (dane wczytane do formularza). */
  hasExistingRequest: boolean;
  profile: BillingProfile | null;
  prefillFromProfile: (profile: BillingProfile) => void;
  saving: boolean;
  /** Klucz i18n odmowy ostatniego zapisu. */
  failureKey: string | null;
  validate: () => boolean;
  commit: (override?: InvoiceRequestTarget) => Promise<boolean>;
}

function matches(row: MyInvoiceSourceRow, target: InvoiceRequestTarget): boolean {
  return "registrationId" in target
    ? row.source_kind === "registration" && row.source_id === target.registrationId
    : row.source_kind === "package_order" && row.source_id === target.packageOrderId;
}

export function useInvoiceRequestController({
  target,
  enabled,
  payment,
}: {
  target: InvoiceRequestTarget | null;
  enabled: boolean;
  payment: InvoiceRequestPayment;
}): InvoiceRequestController {
  const [wanted, setWantedState] = useState(false);
  const [buyer, setBuyerState] = useState<InvoiceBuyerDraft>(emptyBuyerDraft);
  const [remember, setRemember] = useState(false);
  // `touched` = kupujacy edytowal pola; od tej chwili podpowiedz milczy.
  const [touched, setTouched] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [failureKey, setFailureKey] = useState<string | null>(null);

  const optionsQ = useInvoicePublicOptions(enabled);
  const availability = invoiceRequestAvailability(optionsQ.data, optionsQ.isError, payment);
  const active = enabled && wanted && availability === "available";
  const profileQ = useQuery({
    queryKey: ["my-billing"],
    queryFn: fetchMyBillingProfile,
    enabled: active,
  });
  const sourcesQ = useMyInvoiceSources(active && target !== null);
  const save = useSaveInvoiceRequest();

  const profile = profileQ.data ?? null;
  const existing =
    target === null ? null : ((sourcesQ.data ?? []).find((row) => matches(row, target)) ?? null);
  const requestId = existing?.request_id ?? null;

  // Podpowiedz: zapisana prosba > profil rozliczeniowy; nigdy po edycji.
  useEffect(() => {
    if (touched) return;
    if (existing !== null && requestId !== null) {
      setBuyerState(buyerDraftFromColumns(existing));
    } else if (profile !== null) {
      setBuyerState(buyerDraftFromBillingProfile(profile));
    }
  }, [existing, requestId, profile, touched]);

  const errors = validateBuyerDraft(buyer);

  function validate(): boolean {
    setShowErrors(true);
    return !hasBuyerErrors(errors);
  }

  async function commit(override?: InvoiceRequestTarget): Promise<boolean> {
    const destination = override ?? target;
    // Bez bloku (organizator nie fakturuje, fakture wystawia operator) nie ma
    // czego zapisac - zakup idzie dalej bez prosby.
    if (!active || destination === null || existing?.invoice_number) return true;
    if (!validate()) return false;
    setFailureKey(null);
    try {
      await save.mutateAsync({ target: destination, buyer });
    } catch (error: unknown) {
      setFailureKey(eventInvoiceErrorKey(error));
      return false;
    }
    if (remember) {
      try {
        await upsertMyBillingProfile(billingProfileFromBuyerDraft(buyer, profile));
      } catch {
        // Profil to wygoda, nie warunek prosby - prosba juz jest zapisana.
      }
    }
    return true;
  }

  return {
    availability,
    wanted,
    setWanted: setWantedState,
    buyer,
    setBuyer: (value) => {
      setTouched(true);
      setBuyerState(value);
    },
    remember,
    setRemember,
    errors,
    showErrors,
    invoicedNumber: existing?.invoice_number ?? null,
    hasExistingRequest: requestId !== null,
    profile,
    prefillFromProfile: (source) => {
      setTouched(true);
      setBuyerState(buyerDraftFromBillingProfile(source));
    },
    saving: save.isPending,
    failureKey,
    validate,
    commit,
  };
}
