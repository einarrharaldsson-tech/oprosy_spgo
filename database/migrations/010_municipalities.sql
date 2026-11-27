-- Multi-municipality isolation
CREATE TABLE IF NOT EXISTS municipalities (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  inn VARCHAR(12) NOT NULL,
  name_full VARCHAR(255) NOT NULL,
  name_short VARCHAR(64) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_municipalities_inn (inn),
  UNIQUE KEY uq_municipalities_short (name_short)
) ENGINE=InnoDB;

-- Seed СПГО (ИНН можно поправить в админке)
INSERT INTO municipalities (inn, name_full, name_short, is_active)
SELECT '5042125664', 'Сергиево - Посадский городской округ', 'СПГО', 1
WHERE NOT EXISTS (SELECT 1 FROM municipalities WHERE name_short = 'СПГО' OR inn = '5042125664');

ALTER TABLE users
  ADD COLUMN municipality_id INT UNSIGNED NULL AFTER role;

ALTER TABLE surveys
  ADD COLUMN municipality_id INT UNSIGNED NULL AFTER created_by;

UPDATE users u
JOIN municipalities m ON m.name_short = 'СПГО'
SET u.municipality_id = m.id
WHERE u.municipality_id IS NULL;

UPDATE surveys s
JOIN municipalities m ON m.name_short = 'СПГО'
SET s.municipality_id = m.id
WHERE s.municipality_id IS NULL;

ALTER TABLE users
  ADD CONSTRAINT fk_users_municipality
  FOREIGN KEY (municipality_id) REFERENCES municipalities(id);

ALTER TABLE surveys
  ADD CONSTRAINT fk_surveys_municipality
  FOREIGN KEY (municipality_id) REFERENCES municipalities(id);
