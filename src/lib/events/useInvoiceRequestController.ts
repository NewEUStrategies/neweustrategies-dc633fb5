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
//   * NIC NIE JEST POBIERANE, DOPOKI KUPUJACY NIE ZAZNACZY "potrzebuje
//     faktury": krok platnosci bez faktury (wiekszosc zakupow) nie robi
//     ani jednego dodatkowego zapytania.
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
import type { InvoiceRequestTarget, MyInvoiceSourceRow } from "@/lib/events/myEventInvoicesApi";
import { useMyInvoiceSources, useSaveInvoiceRequest } from "@/lib/events/useMyEventInvoices";
import { eventInvoiceErrorKey } from "@/lib/events/eventInvoiceErrors";

export interface InvoiceRequestController {
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
}: {
  target: InvoiceRequestTarget | null;
  enabled: boolean;
}): InvoiceRequestController {
  const [wanted, setWantedState] = useState(false);
  const [buyer, setBuyerState] = useState<InvoiceBuyerDraft>(emptyBuyerDraft);
  const [remember, setRemember] = useState(false);
  // `touched` = kupujacy edytowal pola; od tej chwili podpowiedz milczy.
  const [touched, setTouched] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [failureKey, setFailureKey] = useState<string | null>(null);

  const active = enabled && wanted;
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
    if (!wanted || destination === null || existing?.invoice_number) return true;
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
