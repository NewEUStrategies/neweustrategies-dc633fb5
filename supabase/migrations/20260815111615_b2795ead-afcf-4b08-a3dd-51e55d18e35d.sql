CREATE OR REPLACE FUNCTION public.nes_polish_tsquery(_q text)
RETURNS tsquery
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_terms text;
BEGIN
  SELECT string_agg(quote_literal(t.lexeme) || ':*', ' & ' ORDER BY t.lexeme)
    INTO v_terms
    FROM unnest(to_tsvector('public.nes_polish', btrim(coalesce(_q, '')))) AS t
   WHERE t.lexeme <> '';
  IF v_terms IS NULL OR v_terms = '' THEN RETURN NULL; END IF;
  RETURN to_tsquery('public.nes_polish', v_terms);
EXCEPTION WHEN others THEN
  RETURN plainto_tsquery('public.nes_polish', coalesce(_q, ''));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.nes_polish_tsquery(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nes_polish_tsquery(text) TO anon, authenticated, service_role;