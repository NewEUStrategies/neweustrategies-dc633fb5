// Gotowość skanera do pracy bez sieci: powłoka w cache i trwałe przechowywanie.
//
// DWA SYGNAŁY, KTÓRYCH NIE WIDAĆ GOŁYM OKIEM. Operator widzi, że skaner
// „działa" - ale nie widzi, czy aplikacja wstanie po zamknięciu karty w hali
// bez zasięgu (powłoka w cache Service Workera) ani czy przeglądarka nie
// wyczyści kolejki przy braku miejsca (`navigator.storage.persist()`). Karta
// gotowości zamienia oba w zdanie z odpowiedzią.
//
// ROZGRZANIE PO SPAROWANIU. Po pierwszym połączeniu dociągamy oba słowniki
// rdzenia (drugi język ładuje się leniwie) i prosimy workera o zapisanie
// wszystkiego, co strona już pobrała - dopiero wtedy odpowiedź „zapisana"
// jest prawdą także dla pierwszej wizyty.
import { useCallback, useEffect, useState } from "react";

import { ensureCoreLanguage } from "@/lib/i18n";
import {
  requestPersistentStorage,
  requestScannerPrecache,
  storagePersisted,
  type PrecacheReport,
} from "@/lib/events/scannerPwa";

export type ShellReadiness = "checking" | "ready" | "partial" | "missing";

export interface ScannerReadiness {
  shell: ShellReadiness;
  precache: PrecacheReport | null;
  /** `null` = przeglądarka nie zna `navigator.storage`. */
  storagePersisted: boolean | null;
  /** Wynik ostatniej prośby operatora (`null` = jeszcze nie prosił). */
  persistRequest: boolean | null;
  requestPersist: () => void;
}

export function shellReadiness(report: PrecacheReport | null): ShellReadiness {
  if (report === null || report.cached === 0) return "missing";
  return report.cached >= report.total ? "ready" : "partial";
}

export function useScannerReadiness(active: boolean): ScannerReadiness {
  const [precache, setPrecache] = useState<PrecacheReport | null>(null);
  const [checked, setChecked] = useState(false);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [persistRequest, setPersistRequest] = useState<boolean | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void Promise.all([ensureCoreLanguage("pl"), ensureCoreLanguage("en")])
      .catch(() => undefined)
      .then(() => requestScannerPrecache())
      .then((report) => {
        if (cancelled) return;
        setPrecache(report);
        setChecked(true);
      });
    void storagePersisted().then((value) => {
      if (!cancelled) setPersisted(value);
    });
    return () => {
      cancelled = true;
    };
  }, [active]);

  const requestPersist = useCallback(() => {
    void requestPersistentStorage().then((granted) => {
      setPersistRequest(granted === true);
      if (granted === true) setPersisted(true);
    });
  }, []);

  return {
    shell: checked ? shellReadiness(precache) : "checking",
    precache,
    storagePersisted: persisted,
    persistRequest,
    requestPersist,
  };
}
