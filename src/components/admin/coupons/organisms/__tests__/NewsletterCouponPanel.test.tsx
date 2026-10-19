// Panel kampanii kuponowej w edytorze kampanii newslettera (P04, R-25).
//
// PO CO. Kody rabatowe wysłane do złej listy albo w liczbie mniejszej niż
// odbiorców to incydent, którego nie da się cofnąć. Panel MUSI pokazać przed
// wysyłką: do kogo (segment), ilu odbiorców i ile wolnych kodów - a reguła
// `couponSendBlock` mówi trasie, kiedy wysyłkę zablokować. Edytor kampanii
// ma test sklejenia (`adminNewsletterCampaignRoutes.test.tsx`); tu reguła
// blokady i treść panelu.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { axeViolations, summarize } from "@/test/axe";

const h = vi.hoisted(() => ({
  lists: [{ id: "vip", label_pl: "Lista VIP", label_en: "VIP list" }] as unknown[] | undefined,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-coupons", () => ({ ensureI18n: () => undefined }));
vi.mock("@/hooks/useNewsletterSettings", () => ({
  useNewsletterSettings: () => ({
    data: h.lists === undefined ? undefined : { popup_mailing_lists: h.lists },
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    search,
    children,
    ...rest
  }: {
    to: string;
    search?: Record<string, string>;
    children?: ReactNode;
    className?: string;
    "aria-label"?: string;
  }) => (
    <a href={`${to}?${new URLSearchParams(search).toString()}`} aria-label={rest["aria-label"]}>
      {children}
    </a>
  ),
}));

import { couponSendBlock } from "../../couponSendBlock";
import { NewsletterCouponPanel } from "../NewsletterCouponPanel";

const KUPON = {
  couponCampaignId: "c0c0c0c0-0000-4000-8000-000000000001",
  name: "Jesień VIP",
  codesAvailable: 100,
  codesTotal: 120,
  status: "generated",
};

describe("couponSendBlock - kiedy wysyłka kampanii kuponowej MUSI poczekać", () => {
  it("zwykła kampania (bez kuponów) nigdy nie jest blokowana", () => {
    expect(couponSendBlock({ coupon: null, recipients: undefined, sentCount: 0 })).toBeNull();
  });

  it("dopóki liczba odbiorców jest nieznana - czekamy (R-25: liczba PRZED wysyłką)", () => {
    expect(couponSendBlock({ coupon: KUPON, recipients: undefined, sentCount: 0 })).toBe(
      "counting",
    );
  });

  it("kodów mniej niż odbiorców - blokada", () => {
    expect(couponSendBlock({ coupon: KUPON, recipients: 101, sentCount: 0 })).toBe("short");
  });

  it("kodów dokładnie tyle, ile odbiorców - wysyłka dozwolona", () => {
    expect(couponSendBlock({ coupon: KUPON, recipients: 100, sentCount: 0 })).toBeNull();
  });

  it("wznowienie po części wysyłki NIE jest blokowane licznikiem wolnych kodów", () => {
    // Część kodów jest już przypisana wysłanym odbiorcom - decyduje serwer.
    expect(couponSendBlock({ coupon: KUPON, recipients: 500, sentCount: 10 })).toBeNull();
  });
});

describe("NewsletterCouponPanel", () => {
  it("pokazuje kampanię (z linkiem do niej), segment, odbiorców i wolne kody", () => {
    render(<NewsletterCouponPanel coupon={KUPON} segment="vip" recipients={80} sentCount={0} />);
    const link = screen.getByRole("link", { name: /Jesień VIP/ });
    expect(link.getAttribute("href")).toBe(
      "/admin/coupons/campaigns?id=c0c0c0c0-0000-4000-8000-000000000001",
    );
    expect(screen.getByText("Lista VIP")).toBeInTheDocument();
    expect(screen.getByText("80")).toBeInTheDocument();
    expect(
      screen.getByText("adminCoupons.newsletterCampaign.codesOf(free=100,total=120)"),
    ).toBeInTheDocument();
    expect(screen.getByText("adminCoupons.campaignStatus.generated")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("za mało kodów = alert z liczbami", () => {
    render(<NewsletterCouponPanel coupon={KUPON} segment="vip" recipients={130} sentCount={0} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "adminCoupons.newsletterCampaign.codesShort(available=100,recipients=130)",
    );
  });

  it("w trakcie liczenia odbiorców - komunikat stanu, nie zero", () => {
    render(
      <NewsletterCouponPanel coupon={KUPON} segment="vip" recipients={undefined} sentCount={0} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "adminCoupons.newsletterCampaign.counting",
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("brak segmentu = jawnie „cała lista subskrybentów”", () => {
    render(
      <NewsletterCouponPanel coupon={KUPON} segment={undefined} recipients={5} sentCount={0} />,
    );
    expect(screen.getByText("adminCoupons.segmentField.wholeList")).toBeInTheDocument();
  });

  it("segment spoza list jest NIEZNANY - dopiero gdy ustawienia doszły", () => {
    h.lists = undefined;
    const { unmount } = render(
      <NewsletterCouponPanel coupon={KUPON} segment="stary" recipients={5} sentCount={0} />,
    );
    // Ustawienia w drodze: etykieta jest tekstem „nieznana", ale BEZ wyróżnienia błędu.
    expect(screen.getByText("adminCoupons.segmentField.unknown(id=stary)").className).not.toContain(
      "text-destructive",
    );
    unmount();
    h.lists = [{ id: "vip", label_pl: "Lista VIP", label_en: "VIP list" }];
    render(<NewsletterCouponPanel coupon={KUPON} segment="stary" recipients={5} sentCount={0} />);
    expect(screen.getByText("adminCoupons.segmentField.unknown(id=stary)").className).toContain(
      "text-destructive",
    );
  });

  it("nie ma naruszeń dostępności", async () => {
    const { container } = render(
      <NewsletterCouponPanel coupon={KUPON} segment="vip" recipients={130} sentCount={0} />,
    );
    const naruszenia = await axeViolations(container);
    expect(summarize(naruszenia)).toBe("");
  });
});
