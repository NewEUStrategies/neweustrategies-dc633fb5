
DO $$ BEGIN
  CREATE TYPE public.name_gender AS ENUM ('male', 'female', 'neutral');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.set_updated_at_now()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TABLE IF NOT EXISTS public.name_dictionary (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  gender public.name_gender NOT NULL,
  origin_country TEXT,
  vocative_pl TEXT,
  vocative_en TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name_normalized, origin_country)
);

CREATE INDEX IF NOT EXISTS name_dictionary_normalized_idx ON public.name_dictionary (name_normalized);
CREATE INDEX IF NOT EXISTS name_dictionary_gender_idx ON public.name_dictionary (gender);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.name_dictionary TO authenticated;
GRANT ALL ON public.name_dictionary TO service_role;

ALTER TABLE public.name_dictionary ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read names" ON public.name_dictionary;
CREATE POLICY "Authenticated can read names" ON public.name_dictionary
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Super admins can insert names" ON public.name_dictionary;
CREATE POLICY "Super admins can insert names" ON public.name_dictionary
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Super admins can update names" ON public.name_dictionary;
CREATE POLICY "Super admins can update names" ON public.name_dictionary
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Super admins can delete names" ON public.name_dictionary;
CREATE POLICY "Super admins can delete names" ON public.name_dictionary
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'super_admin'));

DROP TRIGGER IF EXISTS trg_name_dictionary_updated_at ON public.name_dictionary;
CREATE TRIGGER trg_name_dictionary_updated_at
  BEFORE UPDATE ON public.name_dictionary
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();

INSERT INTO public.name_dictionary (name, name_normalized, gender, origin_country, vocative_pl, vocative_en) VALUES
  ('Adam','adam','male','PL','Adamie','Adam'),
  ('Andrzej','andrzej','male','PL','Andrzeju','Andrzej'),
  ('Bartosz','bartosz','male','PL','Bartoszu','Bartosz'),
  ('Dawid','dawid','male','PL','Dawidzie','David'),
  ('Filip','filip','male','PL','Filipie','Philip'),
  ('Grzegorz','grzegorz','male','PL','Grzegorzu','Gregory'),
  ('Jakub','jakub','male','PL','Jakubie','Jacob'),
  ('Jan','jan','male','PL','Janie','John'),
  ('Jerzy','jerzy','male','PL','Jerzy','George'),
  ('Karol','karol','male','PL','Karolu','Charles'),
  ('Krzysztof','krzysztof','male','PL','Krzysztofie','Christopher'),
  ('Łukasz','lukasz','male','PL','Łukaszu','Luke'),
  ('Maciej','maciej','male','PL','Macieju','Matthias'),
  ('Marcin','marcin','male','PL','Marcinie','Martin'),
  ('Marek','marek','male','PL','Marku','Mark'),
  ('Mateusz','mateusz','male','PL','Mateuszu','Matthew'),
  ('Michał','michal','male','PL','Michale','Michael'),
  ('Paweł','pawel','male','PL','Pawle','Paul'),
  ('Piotr','piotr','male','PL','Piotrze','Peter'),
  ('Rafał','rafal','male','PL','Rafale','Raphael'),
  ('Robert','robert','male','PL','Robercie','Robert'),
  ('Stanisław','stanislaw','male','PL','Stanisławie','Stanislaus'),
  ('Szymon','szymon','male','PL','Szymonie','Simon'),
  ('Tomasz','tomasz','male','PL','Tomaszu','Thomas'),
  ('Wojciech','wojciech','male','PL','Wojciechu','Adalbert'),
  ('Zbigniew','zbigniew','male','PL','Zbigniewie','Zbigniew'),
  ('Agnieszka','agnieszka','female','PL','Agnieszko','Agnes'),
  ('Aleksandra','aleksandra','female','PL','Aleksandro','Alexandra'),
  ('Alicja','alicja','female','PL','Alicjo','Alice'),
  ('Anna','anna','female','PL','Anno','Anna'),
  ('Barbara','barbara','female','PL','Barbaro','Barbara'),
  ('Beata','beata','female','PL','Beato','Beatrice'),
  ('Dorota','dorota','female','PL','Doroto','Dorothy'),
  ('Edyta','edyta','female','PL','Edyto','Edith'),
  ('Elżbieta','elzbieta','female','PL','Elżbieto','Elizabeth'),
  ('Ewa','ewa','female','PL','Ewo','Eve'),
  ('Halina','halina','female','PL','Halino','Helen'),
  ('Hanna','hanna','female','PL','Hanno','Hannah'),
  ('Iwona','iwona','female','PL','Iwono','Yvonne'),
  ('Joanna','joanna','female','PL','Joanno','Joan'),
  ('Julia','julia','female','PL','Julio','Julia'),
  ('Justyna','justyna','female','PL','Justyno','Justine'),
  ('Karolina','karolina','female','PL','Karolino','Caroline'),
  ('Katarzyna','katarzyna','female','PL','Katarzyno','Catherine'),
  ('Klaudia','klaudia','female','PL','Klaudio','Claudia'),
  ('Magdalena','magdalena','female','PL','Magdaleno','Madeleine'),
  ('Małgorzata','malgorzata','female','PL','Małgorzato','Margaret'),
  ('Maria','maria','female','PL','Mario','Mary'),
  ('Marta','marta','female','PL','Marto','Martha'),
  ('Martyna','martyna','female','PL','Martyno','Martina'),
  ('Monika','monika','female','PL','Moniko','Monica'),
  ('Natalia','natalia','female','PL','Natalio','Natalie'),
  ('Olga','olga','female','PL','Olgo','Olga'),
  ('Patrycja','patrycja','female','PL','Patrycjo','Patricia'),
  ('Paulina','paulina','female','PL','Paulino','Pauline'),
  ('Renata','renata','female','PL','Renato','Renata'),
  ('Sylwia','sylwia','female','PL','Sylwio','Sylvia'),
  ('Teresa','teresa','female','PL','Tereso','Theresa'),
  ('Urszula','urszula','female','PL','Urszulo','Ursula'),
  ('Weronika','weronika','female','PL','Weroniko','Veronica'),
  ('Wiktoria','wiktoria','female','PL','Wiktorio','Victoria'),
  ('Zofia','zofia','female','PL','Zofio','Sophie'),
  ('Alex','alex','neutral','US','Alex','Alex'),
  ('Sam','sam','neutral','US','Sam','Sam'),
  ('Chris','chris','neutral','US','Chris','Chris'),
  ('Jordan','jordan','neutral','US','Jordan','Jordan'),
  ('Taylor','taylor','neutral','US','Taylor','Taylor'),
  ('Michael','michael','male','US','Michaelu','Michael'),
  ('David','david','male','US','Davidzie','David'),
  ('James','james','male','US','James','James'),
  ('John','john','male','US','Johnie','John'),
  ('Emily','emily','female','US','Emily','Emily'),
  ('Sarah','sarah','female','US','Sarah','Sarah'),
  ('Emma','emma','female','GB','Emmo','Emma'),
  ('Sophie','sophie','female','GB','Sophie','Sophie')
ON CONFLICT (name_normalized, origin_country) DO NOTHING;
