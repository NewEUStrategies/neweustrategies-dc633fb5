UPDATE public.pricing_faq_items
SET answer_pl = 'Płatności obsługuje Stripe - nasz operator płatności: karty Visa i Mastercard, popularne metody lokalne oraz portfele cyfrowe. Nie przechowujemy danych Twojej karty na naszych serwerach.',
    answer_en = 'Payments are handled by Stripe, our payment provider: Visa and Mastercard, popular local methods and digital wallets. We never store your card details on our servers.'
WHERE answer_pl ILIKE '%paddle%' OR answer_en ILIKE '%paddle%';

UPDATE public.pricing_faq_items
SET question_pl = replace(replace(question_pl, 'Paddle', 'Stripe'), 'paddle', 'Stripe'),
    question_en = replace(replace(question_en, 'Paddle', 'Stripe'), 'paddle', 'Stripe')
WHERE question_pl ILIKE '%paddle%' OR question_en ILIKE '%paddle%';