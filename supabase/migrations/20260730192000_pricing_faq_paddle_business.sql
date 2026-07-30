-- ============================================================================
-- FAQ cennika: operator płatności + cykle planu Partner Biznesowy.
--
-- Dwie korekty spójności po przejściu na Paddle (MoR) i wprowadzeniu
-- subskrypcji biznesowej (2 tygodnie / miesiąc / kwartał):
--   1) Odpowiedź o metodach płatności wskazywała Stripe - operatorem jest
--      Paddle (Merchant of Record). Tekst na stronie /pricing wprowadzał
--      w błąd i był niespójny z regulaminem oraz polityką prywatności.
--   2) Segment "Dla firm" dostaje pytanie o cykle rozliczeniowe planu
--      Partner Biznesowy (sort 125 - przed pytaniem o faktury).
--
-- Forward-only: redefinicja seed_pricing_faq (nowe tenanty) + idempotentny
-- backfill istniejących tenantów. UPDATE odpowiedzi o metodach płatności jest
-- celowany (question_pl seedu + odpowiedź nadal wspominająca Stripe), więc
-- ręczne edycje adminów pozostają nietknięte.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.seed_pricing_faq(p_tenant uuid)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.pricing_faq_items
    (tenant_id, audience_key, question_pl, question_en, answer_pl, answer_en, sort_order)
  SELECT p_tenant, v.audience_key, v.q_pl, v.q_en, v.a_pl, v.a_en, v.sort_order
    FROM (VALUES
      (NULL,
       'Czy mogę anulować subskrypcję w każdej chwili?',
       'Can I cancel my subscription at any time?',
       'Tak. Subskrypcję anulujesz jednym kliknięciem w panelu profilu - bez okresów wypowiedzenia. Zachowujesz pełny dostęp do końca opłaconego okresu.',
       'Yes. Cancel with one click in your profile panel - no notice periods. You keep full access until the end of the paid period.',
       10),
      (NULL,
       'Jakie metody płatności akceptujecie?',
       'Which payment methods do you accept?',
       'Płatności obsługuje Paddle - nasz Merchant of Record: karty Visa i Mastercard, popularne metody lokalne oraz portfele cyfrowe. Nie przechowujemy danych Twojej karty na naszych serwerach.',
       'Payments are handled by Paddle, our Merchant of Record: Visa and Mastercard, popular local methods and digital wallets. We never store your card details on our servers.',
       20),
      (NULL,
       'Czy otrzymam fakturę VAT?',
       'Will I receive a VAT invoice?',
       'Tak. Fakturę wystawiamy automatycznie na podstawie danych rozliczeniowych z Twojego profilu - NIP lub VAT ID podasz podczas płatności, a podatek naliczy się według Twojego adresu.',
       'Yes. Invoices are issued automatically from the billing details in your profile - add your tax ID at checkout and tax is calculated from your address.',
       30),
      (NULL,
       'Kiedy dostanę dostęp po zakupie?',
       'When do I get access after purchase?',
       'Natychmiast. Konto odblokowuje się automatycznie zaraz po potwierdzeniu płatności przez operatora.',
       'Immediately. Your account unlocks automatically as soon as the payment is confirmed.',
       40),
      (NULL,
       'Czym różni się rozliczenie miesięczne od rocznego?',
       'What is the difference between monthly and annual billing?',
       'Zakres dostępu jest identyczny - różni się tylko cykl płatności. Plan roczny to jedna płatność z góry i niższy koszt w przeliczeniu na miesiąc; dokładną oszczędność pokazujemy przy każdej cenie.',
       'The access is identical - only the billing cycle differs. Annual plans are a single upfront payment at a lower effective monthly cost; the exact saving is shown next to each price.',
       50),
      (NULL,
       'Czy mogę później zmienić plan?',
       'Can I change my plan later?',
       'Tak. Na wyższy plan przechodzisz w dowolnym momencie - poziom dostępu wyznacza najwyższy aktywny plan. Aby przejść niżej, wystarczy anulować obecny plan i wybrać nowy od kolejnego okresu.',
       'Yes. Upgrade at any time - your access level follows your highest active plan. To downgrade, simply cancel the current plan and pick a new one for the next period.',
       60),
      (NULL,
       'Co pozostaje bezpłatne?',
       'What stays free?',
       'Duża część serwisu jest otwarta dla wszystkich. Bezpłatne konto Czytelnika dodaje zakładki, obserwowanie tematów i udział w dyskusjach - bez podawania karty.',
       'A large part of the site is open to everyone. The free Reader account adds bookmarks, topic follows and discussions - no card required.',
       70),
      (NULL,
       'Jak działa okres próbny?',
       'How does the trial work?',
       'Jeśli plan oferuje okres próbny, informacja jest widoczna przy cenie. Pierwszą płatność pobieramy dopiero po jego zakończeniu, a wcześniejsze anulowanie nic nie kosztuje.',
       'If a plan offers a trial, it is shown next to the price. The first payment is taken only after the trial ends, and cancelling earlier costs nothing.',
       80),
      ('academic',
       'Kto może skorzystać z oferty akademickiej?',
       'Who qualifies for the academic offer?',
       'Studenci, uczniowie, doktoranci, wykładowcy i nauczyciele oraz organizacje non-profit. Status potwierdzamy prosto: e-mailem uczelni, legitymacją albo wpisem do rejestru - zwykle w ciągu jednego dnia roboczego.',
       'Students, pupils, doctoral candidates, lecturers, teachers and non-profit organisations. We confirm status simply: a university e-mail, a student ID or a registry entry - usually within one business day.',
       90),
      ('academic',
       'Czy oferta akademicka obejmuje całą grupę lub koło naukowe?',
       'Does the academic offer cover a whole group or student society?',
       'Tak - dla kół naukowych, katedr i programów studiów przygotowujemy dostęp grupowy na warunkach zbliżonych do planu Zespół. Napisz do nas, dopasujemy zakres i wycenę.',
       'Yes - for student societies, faculties and study programmes we arrange group access on terms similar to the Team plan. Write to us and we will tailor the scope and pricing.',
       100),
      ('team',
       'Jak działają miejsca (seats) w planie zespołowym?',
       'How do seats work in the team plan?',
       'Po zakupie zarządzasz miejscami w panelu organizacji: zapraszasz osoby e-mailem, a nieużywane miejsca przenosisz w dowolnym momencie. Każde miejsce to pełny, imienny dostęp.',
       'After purchase you manage seats in the organisation panel: invite people by e-mail and reassign unused seats at any time. Every seat is a full, named account.',
       110),
      ('team',
       'Czy mogę dokupić miejsca w trakcie trwania subskrypcji?',
       'Can I add seats mid-subscription?',
       'Tak. Liczbę miejsc zwiększysz w każdej chwili - napisz do nas, a rozliczenie proporcjonalnie dopasujemy do bieżącego okresu.',
       'Yes. You can increase the number of seats at any time - contact us and we will pro-rate the billing for the current period.',
       120),
      ('business',
       'Jak działa rozliczenie planu Partner Biznesowy?',
       'How does Business Partner billing work?',
       'Plan Partner Biznesowy rozliczasz w cyklu dwutygodniowym, miesięcznym albo kwartalnym - zakres dostępu jest identyczny, różni się tylko częstotliwość płatności. Subskrypcja odnawia się automatycznie, a anulować możesz ją w każdej chwili; dłuższy cykl to niższy koszt w przeliczeniu na miesiąc.',
       'The Business Partner plan bills every two weeks, monthly or quarterly - access is identical, only the payment frequency differs. The subscription renews automatically and can be cancelled at any time; longer cycles cost less per month.',
       125),
      ('business',
       'Czy oferujecie licencje dla całej organizacji i płatność na fakturę?',
       'Do you offer organisation-wide licences and invoice payment?',
       'Tak. Licencja site-wide obejmuje artykuły premium dla wszystkich miejsc w organizacji, a rozliczenie prowadzimy fakturą - także w procedurze zakupowej (zamówienie/PO).',
       'Yes. A site-wide licence covers premium articles for every seat in your organisation, and we bill by invoice - purchase-order procurement included.',
       130),
      ('business',
       'Czym plan korporacyjny różni się od zespołowego?',
       'How does the corporate plan differ from the team plan?',
       'Plan Zespół to samoobsługowy wspólny dostęp do treści i wydarzeń. Oferta korporacyjna dodaje zamknięte briefingi, priorytetowy kontakt z ekspertami i warunki negocjowane pod organizację - w tym partnerstwo strategiczne.',
       'Team is self-serve shared access to content and events. The corporate offer adds closed-door briefings, priority access to our experts and terms negotiated for your organisation - including strategic partnership.',
       140)
    ) AS v(audience_key, q_pl, q_en, a_pl, a_en, sort_order)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.pricing_faq_items f WHERE f.tenant_id = p_tenant
   );
$$;

REVOKE EXECUTE ON FUNCTION public.seed_pricing_faq(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_pricing_faq(uuid) TO service_role;

-- Backfill istniejących tenantów (idempotentny).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.tenants LOOP
    -- 1) Metody płatności: tylko wiersze wciąż wskazujące Stripe (seedowy
    --    tekst); odpowiedzi przeredagowane przez admina zostają nietknięte.
    UPDATE public.pricing_faq_items
       SET answer_pl = 'Płatności obsługuje Paddle - nasz Merchant of Record: karty Visa i Mastercard, popularne metody lokalne oraz portfele cyfrowe. Nie przechowujemy danych Twojej karty na naszych serwerach.',
           answer_en = 'Payments are handled by Paddle, our Merchant of Record: Visa and Mastercard, popular local methods and digital wallets. We never store your card details on our servers.'
     WHERE tenant_id = r.id
       AND question_pl = 'Jakie metody płatności akceptujecie?'
       AND (answer_pl LIKE '%Stripe%' OR answer_en LIKE '%Stripe%');

    -- 2) Pytanie o cykle Partnera Biznesowego - raz per tenant.
    INSERT INTO public.pricing_faq_items
      (tenant_id, audience_key, question_pl, question_en, answer_pl, answer_en, sort_order)
    SELECT r.id, 'business',
           'Jak działa rozliczenie planu Partner Biznesowy?',
           'How does Business Partner billing work?',
           'Plan Partner Biznesowy rozliczasz w cyklu dwutygodniowym, miesięcznym albo kwartalnym - zakres dostępu jest identyczny, różni się tylko częstotliwość płatności. Subskrypcja odnawia się automatycznie, a anulować możesz ją w każdej chwili; dłuższy cykl to niższy koszt w przeliczeniu na miesiąc.',
           'The Business Partner plan bills every two weeks, monthly or quarterly - access is identical, only the payment frequency differs. The subscription renews automatically and can be cancelled at any time; longer cycles cost less per month.',
           125
     WHERE NOT EXISTS (
       SELECT 1 FROM public.pricing_faq_items f
        WHERE f.tenant_id = r.id
          AND f.question_pl = 'Jak działa rozliczenie planu Partner Biznesowy?'
     );
  END LOOP;
END;
$$;
