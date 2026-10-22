// Molekuła: jedna linia o oknie porzucenia kasy w karcie biletów wydarzenia
// (I9b, Z-S3-07).
//
// JEDNO OKNO DLA KAŻDEJ KASY. Niezapłacona rezerwacja biletu wygasa razem
// z sesją kasy, a ta sama wartość (`checkout_settings.abandon_after_minutes`)
// liczy porzucenie planu i treści w lejku i w ścieżce porzuconej kasy - decyzja
// właściciela 2026-10-20: jedna definicja porzucenia, a krótsze okno szybciej
// zwalnia martwe rezerwacje biletów. Organizator widzi tu bieżącą wartość,
// a zmienia ją w JEDNYM miejscu - karcie kasy paywalla (link).
//
// Odczyt idzie tym samym `checkoutSettingsQueryOptions` co karta kasy (wspólny
// wpis cache), a liczba - tym samym `effectiveCheckoutAbandonMinutes`, więc
// obie karty pokazują to samo. Linia jest informacyjna: w trakcie wczytywania
// i przy błędzie odczytu jej nie ma (karta biletów działa bez niej).
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useCheckoutSettings } from "@/hooks/useCheckoutSettings";
import { effectiveCheckoutAbandonMinutes } from "@/lib/revenue/limits";

export function EventTicketCheckoutWindowNote() {
  const { t } = useTranslation();
  const settingsQ = useCheckoutSettings();
  if (settingsQ.data === undefined) return null;
  const minutes = effectiveCheckoutAbandonMinutes(settingsQ.data.abandon_after_minutes);
  return (
    <p className="max-w-2xl text-xs text-muted-foreground">
      {t("adminEventRegistration.tickets.checkoutWindow.note", { minutes })}{" "}
      <Link
        to="/admin/paywall"
        search={{ tab: "checkout" }}
        className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
      >
        {t("adminEventRegistration.tickets.checkoutWindow.link")}
      </Link>
    </p>
  );
}
