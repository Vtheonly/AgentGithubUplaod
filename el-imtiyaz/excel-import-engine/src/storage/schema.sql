-- ============================================================================
-- Schéma SQLite pour le moteur d'import Excel
-- ============================================================================

-- Table des élèves/clients (feuille ETAT 20262027)
CREATE TABLE IF NOT EXISTS etat_clients (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  infos           TEXT,
  email           TEXT,
  nem             TEXT NOT NULL,         -- numéro(s) téléphone, séparés par ,
  nem_normalized  TEXT,                  -- 1er numéro normalisé (pour index)
  tuteur          TEXT,
  nom             TEXT NOT NULL,
  niveau          TEXT NOT NULL,         -- PRIM | COLG | GS
  classe          TEXT NOT NULL,
  option          TEXT,
  remise          REAL DEFAULT 0,
  justification   TEXT,
  devis_annuel    REAL NOT NULL,
  remboursement   REAL DEFAULT 0,
  dettes          REAL DEFAULT 0,
  reglements_json TEXT,                  -- JSON array des 12 mois
  -- Métadonnées d'import
  first_imported_run_id  TEXT,
  first_imported_at      TEXT,
  last_updated_run_id    TEXT,
  last_updated_at        TEXT,
  checksum               TEXT,           -- checksum du record pour détecter changements
  UNIQUE (nem, nom)
);

CREATE INDEX IF NOT EXISTS idx_etat_clients_nem ON etat_clients(nem_normalized);
CREATE INDEX IF NOT EXISTS idx_etat_clients_nom ON etat_clients(nom);
CREATE INDEX IF NOT EXISTS idx_etat_clients_niveau_classe ON etat_clients(niveau, classe);

-- Table des reçus (feuille BON)
CREATE TABLE IF NOT EXISTS bons (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client        TEXT,
  date          TEXT,
  devis_annuel  REAL,
  eleve         TEXT NOT NULL,
  devis         REAL,
  total_verse   REAL,
  reste_verse   REAL,
  first_imported_run_id  TEXT,
  first_imported_at      TEXT,
  last_updated_run_id    TEXT,
  last_updated_at        TEXT,
  checksum               TEXT,
  UNIQUE (eleve, client)
);

CREATE INDEX IF NOT EXISTS idx_bons_eleve ON bons(eleve);

-- Table des devis (feuille Devis)
CREATE TABLE IF NOT EXISTS devis (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  client              TEXT NOT NULL,
  devis_numero        TEXT NOT NULL,
  date                TEXT,
  prenom_eleve        TEXT NOT NULL,
  classe              TEXT,
  frais_inscription   REAL,
  frais_scolarisation REAL,
  services            REAL,
  total               REAL,
  first_imported_run_id  TEXT,
  first_imported_at      TEXT,
  last_updated_run_id    TEXT,
  last_updated_at        TEXT,
  checksum                   TEXT,
  UNIQUE (client, devis_numero)
);

CREATE INDEX IF NOT EXISTS idx_devis_client ON devis(client);
CREATE INDEX IF NOT EXISTS idx_devis_numero ON devis(devis_numero);

-- Tables de référence (feuille REF)
CREATE TABLE IF NOT EXISTS ref_enseignants (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  nom   TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS ref_classes (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  code  TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS ref_localites (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  nom   TEXT UNIQUE NOT NULL
);

-- ============================================================================
-- Audit log : un row par import run
-- ============================================================================
CREATE TABLE IF NOT EXISTS import_runs (
  run_id          TEXT PRIMARY KEY,
  file_path       TEXT,
  file_checksum   TEXT,
  file_size       INTEGER,
  started_at      TEXT,
  finished_at     TEXT,
  duration_ms     INTEGER,
  options_json    TEXT,
  source_json     TEXT,
  stats_json      TEXT,
  sheet_results_json TEXT,
  errors_count    INTEGER,
  warnings_count  INTEGER,
  status          TEXT  -- 'running' | 'success' | 'partial' | 'failed'
);

CREATE INDEX IF NOT EXISTS idx_import_runs_started ON import_runs(started_at);
CREATE INDEX IF NOT EXISTS idx_import_runs_checksum ON import_runs(file_checksum);

-- ============================================================================
-- Détail des erreurs et avertissements par run
-- ============================================================================
CREATE TABLE IF NOT EXISTS import_errors (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      TEXT NOT NULL,
  sheet       TEXT,
  row_index   INTEGER,
  field       TEXT,
  header      TEXT,
  rule        TEXT,
  message     TEXT,
  severity    TEXT,   -- 'error' | 'warn'
  raw_value   TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (run_id) REFERENCES import_runs(run_id)
);

CREATE INDEX IF NOT EXISTS idx_import_errors_run ON import_errors(run_id);
CREATE INDEX IF NOT EXISTS idx_import_errors_sheet ON import_errors(sheet);
