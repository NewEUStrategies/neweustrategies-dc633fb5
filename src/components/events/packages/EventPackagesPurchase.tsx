// Zakup PAKIETU GRUPOWEGO oczami kupujacego: oferta, wycena, zamowienie,
// rozdanie miejsc.
//
// EKRAN JEST JEDEN, BO DECYZJA JEST JEDNA. Platnik pyta „ile to kosztuje dla
// nas i kogo mogę wpisać" jednym tchem - rozbicie oferty i zamowien na dwie
// strony kazaloby mu pamietac, ktory pakiet oglada.
//
// CENE LICZY BAZA. `event_admission_quote` odpowiada na cztery pytania tego
// ekranu naraz (czy wolno, po ile, ile zostalo, czy kod dziala), a
// `event_package_purchase` przelicza ja u siebie po raz drugi - kwota z
// przegladarki nigdy nie jest przyjmowana na slowo.
//
// TOKEN ZAPROSZENIA POKAZUJEMY RAZ. Baza trzyma tylko jego skrot, wiec
// odnosnik zostaje na ekranie do skopiowania i mowi to wprost.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CheckCircle2, Copy, Loader2, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ensureEventRegistrationI18n } from "@/lib/i18n-event-registration";
import { packageInviteUrl } from "@/lib/events/packagesApi";
import {
  admissionQuoteMessageKey,
  type EventPackageOfferRow,
  type MyPackageOrderRow,
} from "@/lib/events/admissionApi";
import {
  useAdmissionQuote,
  useInviteMyPackageSeat,
  useMyPackageOrders,
  useMyPackageSeats,
  usePackagesOffer,
} from "@/lib/events/useEventPackagePurchase";
import { usePurchasePackage } from "@/lib/events/useEventPackagePurchase";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function money(cents: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}

function localized(pl: string | null, en: string | null, isEnglish: boolean): string {
  const primary = isEnglish ? en : pl;
  return (primary ?? "").trim() !== "" ? (primary as string) : ((isEnglish ? pl : en) ?? "");
}

export function EventPackagesPurchase({ slug }: { slug: string }) {
  ensureEventRegistrationI18n();
  const { t, i18n } = useTranslation();
  const isEnglish = i18n.language.startsWith("en");
  const locale = isEnglish ? "en" : "pl";

  const offerQ = usePackagesOffer(slug);
  const ordersQ = useMyPackageOrders();
  const purchase = usePurchasePackage();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [coupon, setCoupon] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [invoiceNote, setInvoiceNote] = useState("");
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  const offers = offerQ.data ?? [];
  const selected = useMemo(
    () => offers.find((row) => row.id === selectedId) ?? null,
    [offers, selectedId],
  );

  const quoteQ = useAdmissionQuote(
    selected === null
      ? null
      : {
          packageId: selected.id,
          ...(appliedCoupon === "" ? {} : { couponCode: appliedCoupon }),
        },
  );
  const quote = quoteQ.data ?? null;

  function buy() {
    if (selected === null) return;
    purchase.mutate(
      {
        packageId: selected.id,
        buyerName,
        buyerEmail,
        companyId: null,
        invoiceNote,
        couponCode: appliedCoupon,
      },
      {
        onSuccess: (result) => {
          setSelectedId(null);
          setOpenOrderId(result.orderId);
          toast.success(t("eventPackages.toasts.purchased"));
        },
        onError: (error) => toast.error(purchaseErrorMessage(error, t)),
      },
    );
  }

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{t("eventPackages.heading")}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{t("eventPackages.subheading")}</p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("eventPackages.offerTitle")}</h2>
        {offerQ.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t("eventPackages.loading")}
          </p>
        ) : /* AWARIA NIE UDAJE PUSTKI. Bez tej gałęzi padnięte zapytanie -
               wygasła sesja, brak sieci, odmowa uprawnień - wyglądało
               dokładnie jak wydarzenie bez pakietów: „to wydarzenie nie
               oferuje pakietów grupowych". Kupujący nie miał czego ponowić,
               a organizator dostawał zgłoszenie, że nie sprzedaje pakietów,
               choć sprzedaje. */
        offerQ.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {t("eventPackages.offerFailed")}
          </p>
        ) : offers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("eventPackages.empty")}</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {offers.map((row) => (
              <PackageCard
                key={row.id}
                row={row}
                locale={locale}
                isEnglish={isEnglish}
                selected={row.id === selectedId}
                onSelect={() => {
                  setSelectedId(row.id);
                  setAppliedCoupon("");
                  setCoupon("");
                }}
              />
            ))}
          </ul>
        )}
      </section>

      {selected === null ? null : (
        <section className="space-y-4 rounded-md border border-border bg-card p-4">
          <h2 className="text-lg font-semibold">
            {localized(selected.name_pl, selected.name_en, isEnglish)}
          </h2>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pkg-buyer-name">{t("eventPackages.buyerName")}</Label>
              <Input
                id="pkg-buyer-name"
                value={buyerName}
                onChange={(event) => setBuyerName(event.target.value)}
                autoComplete="organization"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pkg-buyer-email">{t("eventPackages.buyerEmail")}</Label>
              <Input
                id="pkg-buyer-email"
                type="email"
                value={buyerEmail}
                onChange={(event) => setBuyerEmail(event.target.value)}
                autoComplete="email"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pkg-invoice-note">{t("eventPackages.invoiceNote")}</Label>
            <Textarea
              id="pkg-invoice-note"
              rows={2}
              value={invoiceNote}
              onChange={(event) => setInvoiceNote(event.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1 space-y-1.5">
              <Label htmlFor="pkg-coupon">{t("eventPackages.couponLabel")}</Label>
              <Input
                id="pkg-coupon"
                value={coupon}
                onChange={(event) => setCoupon(event.target.value)}
                placeholder={t("eventPackages.couponPlaceholder")}
                autoComplete="off"
              />
            </div>
            <Button type="button" variant="outline" onClick={() => setAppliedCoupon(coupon.trim())}>
              {t("eventPackages.couponApply")}
            </Button>
          </div>

          <QuoteSummary
            quote={quote}
            isLoading={quoteQ.isLoading}
            locale={locale}
            fallbackCurrency={selected.currency}
          />

          <Button
            type="button"
            onClick={buy}
            disabled={purchase.isPending || quote === null || quote.ok !== true}
          >
            {purchase.isPending ? t("eventPackages.buyPending") : t("eventPackages.buyAction")}
          </Button>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("eventPackages.ordersTitle")}</h2>
        {ordersQ.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t("eventPackages.loading")}
          </p>
        ) : ordersQ.isError ? (
          // Ta sama zasada co przy ofercie: „nie masz zamówień" powiedziane
          // komuś, kto ma zamówienie, kończy się drugim zakupem tego samego
          // pakietu.
          <p role="alert" className="text-sm text-destructive">
            {t("eventPackages.ordersFailed")}
          </p>
        ) : (ordersQ.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("eventPackages.ordersEmpty")}</p>
        ) : (
          <ul className="space-y-3">
            {(ordersQ.data ?? []).map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                locale={locale}
                isEnglish={isEnglish}
                open={order.id === openOrderId}
                onToggle={() => setOpenOrderId((prev) => (prev === order.id ? null : order.id))}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function purchaseErrorMessage(error: unknown, t: (key: string) => string): string {
  const message = error instanceof Error ? error.message : String(error);
  const head = message.split(":")[0]?.trim() ?? "";
  const known = [
    "forbidden",
    "no_free_seat",
    "invalid_email",
    "order_cancelled",
    "sold_out",
    "seats_exhausted",
  ];
  return t(`eventPackages.errors.${known.includes(head) ? head : "unknown"}`);
}

function PackageCard({
  row,
  locale,
  isEnglish,
  selected,
  onSelect,
}: {
  row: EventPackageOfferRow;
  locale: string;
  isEnglish: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={`w-full rounded-md border p-4 text-left transition-colors ${
          selected ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/40"
        }`}
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{localized(row.name_pl, row.name_en, isEnglish)}</span>
          <Badge variant="secondary">
            {t(`eventPackages.audiences.${row.audience}`, { defaultValue: row.audience })}
          </Badge>
          {row.requires_verification ? (
            <Badge variant={row.qualifies ? "default" : "outline"} className="gap-1">
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
              {row.qualifies ? t("eventPackages.qualified") : t("eventPackages.notQualified")}
            </Badge>
          ) : null}
        </span>
        <span className="mt-1 block text-sm text-muted-foreground">
          {localized(row.description_pl, row.description_en, isEnglish)}
        </span>
        <span className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          <span className="inline-flex items-center gap-1">
            <Users className="h-4 w-4" aria-hidden="true" />
            {t("eventPackages.seats", { count: row.seats })}
          </span>
          <span className="font-semibold">{money(row.price_cents, row.currency, locale)}</span>
          <span className="text-muted-foreground">
            {row.packages_left === null
              ? t("eventPackages.packagesUnlimited")
              : t("eventPackages.packagesLeft", { count: row.packages_left })}
          </span>
        </span>
      </button>
    </li>
  );
}

function QuoteSummary({
  quote,
  isLoading,
  locale,
  fallbackCurrency,
}: {
  quote: ReturnType<typeof useAdmissionQuote>["data"] | null;
  isLoading: boolean;
  locale: string;
  fallbackCurrency: string;
}) {
  const { t } = useTranslation();
  if (isLoading || quote === null || quote === undefined) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t("eventPackages.loading")}
      </p>
    );
  }
  if (!quote.ok) {
    return (
      <p role="status" className="text-sm text-destructive">
        {t(admissionQuoteMessageKey(quote.reason))}
      </p>
    );
  }
  const currency = quote.currency === "" ? fallbackCurrency : quote.currency;
  return (
    <dl className="grid gap-1 text-sm sm:max-w-xs">
      <div className="flex justify-between gap-4">
        <dt className="text-muted-foreground">{t("eventPackages.priceLabel")}</dt>
        <dd>{money(quote.priceCents, currency, locale)}</dd>
      </div>
      {quote.discountCents > 0 ? (
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">{t("eventPackages.discountLabel")}</dt>
          <dd>-{money(quote.discountCents, currency, locale)}</dd>
        </div>
      ) : null}
      <div className="flex justify-between gap-4 font-semibold">
        <dt>{t("eventPackages.totalLabel")}</dt>
        <dd>{money(quote.totalCents, currency, locale)}</dd>
      </div>
    </dl>
  );
}

function OrderCard({
  order,
  locale,
  isEnglish,
  open,
  onToggle,
}: {
  order: MyPackageOrderRow;
  locale: string;
  isEnglish: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const seatsQ = useMyPackageSeats(open ? order.id : null);
  const invite = useInviteMyPackageSeat();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [days, setDays] = useState("14");
  const [issued, setIssued] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function send() {
    if (!EMAIL_PATTERN.test(email.trim())) {
      setError(t("eventPackages.errors.invalid_email"));
      return;
    }
    setError(null);
    invite.mutate(
      {
        orderId: order.id,
        email,
        name,
        expiresInDays: Number.parseInt(days, 10) || 14,
      },
      {
        onSuccess: (result) => {
          setEmail("");
          setName("");
          setIssued(
            packageInviteUrl(
              typeof window === "undefined" ? "" : window.location.origin,
              result.inviteToken,
            ),
          );
          toast.success(t("eventPackages.toasts.invited"));
        },
        onError: (failure) => setError(purchaseErrorMessage(failure, t)),
      },
    );
  }

  return (
    <li className="rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="font-medium">
            {localized(order.package_name_pl, order.package_name_en, isEnglish)}
          </p>
          <p className="text-sm text-muted-foreground">
            {order.event_title} · {money(order.amount_cents, order.currency, locale)}
          </p>
          <p className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">
              {t(`eventPackages.orderStatus.${order.status}`, {
                defaultValue: order.status,
              })}
            </Badge>
            <span>{t("eventPackages.seatsFree", { count: order.seats_free })}</span>
            <span>{t("eventPackages.seatsInvited", { count: order.seats_invited })}</span>
            <span>{t("eventPackages.seatsAssigned", { count: order.seats_assigned })}</span>
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onToggle}>
          {t("eventPackages.manageSeats")}
        </Button>
      </div>

      {!open ? null : (
        <div className="mt-4 space-y-3 border-t border-border pt-3">
          <h3 className="text-sm font-semibold">{t("eventPackages.seatsTitle")}</h3>
          <ul className="space-y-1 text-sm">
            {(seatsQ.data ?? []).map((seat) => (
              <li key={seat.id} className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  {t(`eventPackages.seatState.${seat.state}`, { defaultValue: seat.state })}
                </Badge>
                <span>{seat.attendee_name ?? seat.invite_name ?? seat.invite_email ?? "-"}</span>
              </li>
            ))}
          </ul>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor={`invite-email-${order.id}`}>{t("eventPackages.inviteEmail")}</Label>
              <Input
                id={`invite-email-${order.id}`}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`invite-name-${order.id}`}>{t("eventPackages.inviteName")}</Label>
              <Input
                id={`invite-name-${order.id}`}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`invite-days-${order.id}`}>{t("eventPackages.inviteDays")}</Label>
              <Input
                id={`invite-days-${order.id}`}
                type="number"
                min={1}
                max={90}
                value={days}
                onChange={(event) => setDays(event.target.value)}
              />
            </div>
          </div>

          {error === null ? null : (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <Button type="button" onClick={send} disabled={invite.isPending}>
            {t("eventPackages.inviteAction")}
          </Button>

          {issued === null ? null : (
            <div className="space-y-2 rounded-md border border-dashed border-border p-3">
              <p className="text-sm font-medium">{t("eventPackages.inviteLinkTitle")}</p>
              <p className="break-all text-xs text-muted-foreground">{issued}</p>
              <p className="text-xs text-muted-foreground">{t("eventPackages.inviteLinkHint")}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => {
                  void navigator.clipboard.writeText(issued);
                  toast.success(t("eventPackages.toasts.copied"));
                }}
              >
                <Copy className="h-4 w-4" aria-hidden="true" />
                {t("eventPackages.copyAction")}
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
