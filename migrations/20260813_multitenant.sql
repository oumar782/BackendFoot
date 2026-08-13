BEGIN;

ALTER TABLE terrains ADD COLUMN IF NOT EXISTS manager_id integer;
ALTER TABLE terrains ADD COLUMN IF NOT EXISTS ville text;
ALTER TABLE terrains ADD COLUMN IF NOT EXISTS quartier text;
ALTER TABLE creneaux ADD COLUMN IF NOT EXISTS ville text;
ALTER TABLE creneaux ADD COLUMN IF NOT EXISTS quartier text;
ALTER TABLE reservation ADD COLUMN IF NOT EXISTS numeroterrain integer;
ALTER TABLE reservation ADD COLUMN IF NOT EXISTS creneau_id integer;
ALTER TABLE reservation ADD COLUMN IF NOT EXISTS ville text;
ALTER TABLE reservation ADD COLUMN IF NOT EXISTS quartier text;
ALTER TABLE calendriers ADD COLUMN IF NOT EXISTS numeroterrain integer;

-- idclient was the only historical ownership candidate. It is copied only where
-- it identifies an existing manager account; remaining rows stay unassigned.
UPDATE terrains t
SET manager_id = t.idclient
FROM users u
WHERE t.manager_id IS NULL AND t.idclient = u.iduser AND lower(u.typeuser) IN ('gestionnaire', 'manager');

UPDATE creneaux c SET ville = t.ville, quartier = t.quartier
FROM terrains t WHERE c.numeroterrain = t.numeroterrain AND (c.ville IS NULL OR c.quartier IS NULL);
UPDATE reservation r SET ville = t.ville, quartier = t.quartier
FROM terrains t WHERE r.numeroterrain = t.numeroterrain AND (r.ville IS NULL OR r.quartier IS NULL);
UPDATE calendriers c SET numeroterrain = t.numeroterrain
FROM terrains t WHERE c.numeroterrain IS NULL AND c.nom_terrain = t.nomterrain;

DO $$ BEGIN
  ALTER TABLE terrains ADD CONSTRAINT terrains_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES users(iduser) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE reservation ADD CONSTRAINT reservation_numeroterrain_fkey FOREIGN KEY (numeroterrain) REFERENCES terrains(numeroterrain) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE reservation ADD CONSTRAINT reservation_creneau_id_fkey FOREIGN KEY (creneau_id) REFERENCES creneaux(idcreneaux) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE calendriers ADD CONSTRAINT calendriers_numeroterrain_fkey FOREIGN KEY (numeroterrain) REFERENCES terrains(numeroterrain) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS terrains_manager_id_idx ON terrains(manager_id);
CREATE INDEX IF NOT EXISTS creneaux_numeroterrain_idx ON creneaux(numeroterrain);
CREATE INDEX IF NOT EXISTS reservation_numeroterrain_idx ON reservation(numeroterrain);
CREATE INDEX IF NOT EXISTS reservation_creneau_id_idx ON reservation(creneau_id);
CREATE INDEX IF NOT EXISTS calendriers_numeroterrain_idx ON calendriers(numeroterrain);
COMMIT;
