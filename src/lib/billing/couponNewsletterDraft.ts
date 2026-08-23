// Szkic kampanii newslettera tworzonej z kampanii kuponowej.
//
// PO CO OSOBNO. To sześć literałów, które trafiają DO BAZY i stamtąd do skrzynek
// subskrybentów - a mieszkały w ciele mutacji React Query
// (`admin.coupons.campaigns.tsx`, dawne 158-175), gdzie nie widziała ich żadna
// bramka i18n i nie dotykał żaden test.
//
// PRZENIESIONE ZNAK W ZNAK, RAZEM Z WADAMI:
//   * `name` jest ZAWSZE po polsku („Kupony: …"), niezależnie od języka operatora;
//   * data ważności wchodzi do treści maila w SUROWYM ISO (albo słowem
//     „bezterminowo"/„unlimited"), bez formatowania przez `uiLocale`;
//   * brak segmentu daje `audience_filter: {}`, czyli WYSYŁKĘ DO WSZYSTKICH,
//     a nie do nikogo - to decyzja o zasięgu rabatu, nie szczegół techniczny.
// Wszystkie trzy są zgłoszone w `couponNewsletterDraft.test.ts`; naprawa
// (przeniesienie treści do szablonu i słownika) jest osobnym zadaniem.

/** Pola kampanii kuponowej, z których powstaje szkic newslettera. */
export interface NewsletterDraftSource {
  readonly name: string;
  readonly valid_until: string | null;
  readonly newsletter_segment: string | null;
}

/** Wiersz wstawiany do `newsletter_campaigns`. */
export interface NewsletterDraft {
  readonly name: string;
  readonly subject_pl: string;
  readonly subject_en: string;
  readonly html_pl: string;
  readonly html_en: string;
  readonly audience_filter: Record<string, string>;
}

export function buildNewsletterDraft(campaign: NewsletterDraftSource): NewsletterDraft {
  return {
    name: `Kupony: ${campaign.name}`,
    subject_pl: `Twój kod rabatowy - ${campaign.name}`,
    subject_en: `Your discount code - ${campaign.name}`,
    html_pl: `<p>Twój kod: <strong>{{coupon_code}}</strong></p><p>Ważny do: ${
      campaign.valid_until ?? "bezterminowo"
    }.</p>`,
    html_en: `<p>Your code: <strong>{{coupon_code}}</strong></p><p>Valid until: ${
      campaign.valid_until ?? "unlimited"
    }.</p>`,
    audience_filter: campaign.newsletter_segment ? { segment: campaign.newsletter_segment } : {},
  };
}
