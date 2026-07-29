# excel-import-engine

Moteur d'import Excel unifié pour l'application Electron **Suivis Clients**. Conçu comme un module Node.js standalone qui tourne en arrière-plan et peut être invoqué depuis le main process Electron.

## Objectifs

- **Un seul moteur** pour tous les types d'imports Excel (clients, reçus, devis, références).
- **Fiable** : validation détaillée, gestion des erreurs de formule (`#REF!`), transactions SQLite.
- **Idempotent** : ré-importer le même fichier ne crée pas de doublons (upsert par NEM + NOM).
- **Observable** : événements live (progression par feuille), rapports JSON + Excel, audit log SQLite.
- **Intégrable** : API EventEmitter + Promise, zéro dépendance framework, adapteurs de stockage pluggables.

## Architecture

```
excel-import-engine/
├── src/
│   ├── index.js                   # API publique (createEngine, ...)
│   ├── ImportEngine.js            # Orchestrateur principal (EventEmitter + Promise)
│   ├── ImportContext.js           # État d'un run (compteurs, erreurs, warnings)
│   ├── errors.js                  # Hiérarchie d'erreurs métier
│   ├── parsers/
│   │   ├── ExcelParser.js         # Lecture exceljs, normalisation cellules, formules
│   │   └── SheetDetector.js       # Détection auto du schéma par nom + en-têtes
│   ├── schemas/
│   │   ├── index.js               # Registre central
│   │   ├── etatSchema.js          # ETAT 20262027 — élèves/clients (1032 lignes)
│   │   ├── bonSchema.js           # BON — reçus/situations
│   │   ├── devisSchema.js         # Devis — devis clients
│   │   └── refSchema.js           # REF — tables de référence (enseignants, classes, localités)
│   ├── validators/
│   │   ├── RowValidator.js        # Validation par ligne + regroupement monthlyArray
│   │   ├── FieldCoercer.js        # Coercition de type + dispatch des règles
│   │   └── rules/                 # required, phone, email, enum, positiveNumber, minLength
│   ├── storage/
│   │   ├── StorageAdapter.js      # Interface abstraite
│   │   ├── SqliteAdapter.js       # better-sqlite3 (synchrone, transactions WAL)
│   │   ├── JsonAdapter.js         # JSON files (debug, tests)
│   │   └── schema.sql             # DDL SQLite (tables + index + audit)
│   ├── reporters/
│   │   ├── JsonReporter.js        # Rapport JSON machine-readable
│   │   ├── ExcelReporter.js       # Rapport Excel humain (Résumé + Rejets + Warnings)
│   │   └── AuditLogger.js         # Persistance du run dans import_runs + import_errors
│   ├── dedupe/
│   │   └── UpsertMatcher.js       # Extraction clés d'identité (header → field.key)
│   └── utils/
│       ├── logger.js              # Logger niveaux + préfixe de run
│       ├── checksum.js            # SHA-256 fichier + records
│       └── id.js                  # generateRunId, uuid
├── examples/
│   └── electron-integration.js    # Exemple complet main + preload + renderer
├── test/
│   └── sample-import.js           # Démo : importe le fichier Suivis clients
├── package.json
└── README.md
```

## Installation

```bash
cd excel-import-engine
npm install
# better-sqlite3 est recompilé automatiquement (prebuilds pour la plupart des Node.js)
```

## Démarrage rapide

```javascript
const { createEngine } = require('excel-import-engine');

const engine = createEngine({
  storage: 'sqlite',
  dbPath: './data/import.sqlite',
  reportDir: './reports'
});

// Événements pour feedback UI live
engine.on('sheet:progress', ({ sheet, read, total }) => {
  console.log(`${sheet}: ${read}/${total}`);
});
engine.on('sheet:row', ({ sheet, row, action }) => {
  // action = 'insert' | 'update' | 'skip' | 'dry-run'
});
engine.on('done', ({ context, reports }) => {
  console.log(`Importé ${context.stats.rowsImported} lignes en ${context.durationMs}ms`);
  console.log(`Rapport Excel : ${reports.excel}`);
});

(async () => {
  await engine.init();

  // Aperçu avant import
  const sheets = await engine.preview('/path/to/file.xlsx');

  // Import réel
  const ctx = await engine.importFile('/path/to/file.xlsx', {
    dryRun: false,
    source: { user: 'admin' }
  });

  await engine.close();
})();
```

## API

### `createEngine(config)`

| Paramètre        | Type                | Description                                             |
|------------------|---------------------|---------------------------------------------------------|
| `storage`        | `'sqlite' \| 'json' \| StorageAdapter` | Adaptateur de stockage                  |
| `dbPath`         | `String`            | Requis si `storage='sqlite'`                            |
| `outputDir`      | `String`            | Requis si `storage='json'`                              |
| `reportDir`      | `String`            | Répertoire des rapports JSON + Excel                    |
| `verbose`        | `Boolean`           | Logs SQL verbeux (debug)                                |

### `engine.importFile(filePath, options)`

Retourne une `Promise<ImportContext>`. Options :

| Option      | Type       | Défaut | Description                                                          |
|-------------|------------|--------|----------------------------------------------------------------------|
| `sheets`    | `String[]` | toutes | Noms exacts de feuilles à importer                                   |
| `schemas`   | `String[]` | toutes | Noms de schémas à traiter (`'etat'`, `'bon'`, `'devis'`, `'ref'`)   |
| `dryRun`    | `Boolean`  | `false` | Valide sans écrire en base                                          |
| `strict`    | `Boolean`  | `false` | Rejette tout le run si une erreur                                   |
| `reportDir` | `String`   | config | Surcharge le répertoire de rapports pour ce run                     |
| `source`    | `Object`   | `{}`   | Métadonnées utilisateur (`{ user, triggeredBy }`)                   |

### Événements

| Événement          | Payload                                            |
|--------------------|----------------------------------------------------|
| `start`            | `{ runId, filePath, fileChecksum }`                |
| `sheet:start`      | `{ sheet, schema }`                                |
| `sheet:progress`   | `{ sheet, read, total }`                           |
| `sheet:row`        | `{ sheet, row, rowIndex, action }`                 |
| `sheet:warn`       | `{ sheet, warning }`                               |
| `sheet:error`      | `{ sheet, error, rowIndex }`                       |
| `sheet:done`       | `{ sheet, result }`                                |
| `done`             | `{ context, reports }`                             |
| `error`            | `{ error, context }`                               |

## Schémas supportés

### ETAT 20262027 (feuille principale)
- **Identité** : `NEM` + `NOM` (upsert)
- **Champs obligatoires** : `NEM`, `NOM`, `niveau`, `CLASSE`, `DEVIS ANNUEL`
- **Types gérés** : téléphone multi (`06xxx/07xxx`), enum niveau (`PRIM/COLG/GS/LYC`), montant annuel, 12 colonnes mensuelles regroupées en `reglements`
- **Tables SQL** : `etat_clients`

### REF (tables de référence)
- Trois tables dédupliquées : `ref_enseignants`, `ref_classes`, `ref_localites`
- Pas d'en-tête — données dès la ligne 1, colonnes A/B/D

### BON (reçus)
- **Identité** : `eleve` + `client`
- Tolérant aux `#REF!` dans les montants (warning, pas erreur)

### Devis
- **Identité** : `client` + `devisNumero`
- Layout type formulaire (un devis par bloc de ~20 lignes)

## Rapports générés

Pour chaque run, sous `reportDir/` :

1. **`import-report-<runId>.json`** — Machine-readable, contient `stats`, `sheetResults`, `errors[]`, `warnings[]`, `options`, `source`, `fileChecksum`.

2. **`import-report-<runId>.xlsx`** — 3 feuilles :
   - `Résumé` : métriques globales + détail par feuille
   - `Lignes rejetées` : une ligne par erreur bloquante avec feuille/ligne/champ/règle/raison
   - `Avertissements` : warnings non bloquants

3. **Audit SQLite** : tables `import_runs` (un row par run) et `import_errors` (toutes les erreurs/warnings détaillés, indexés par `run_id`).

## Intégration Electron

Voir `examples/electron-integration.js` pour un exemple complet (main process + preload + renderer). Le pattern résumé :

```javascript
// main.js
const { createEngine } = require('excel-import-engine');
let engine;

app.whenReady().then(async () => {
  engine = createEngine({
    storage: 'sqlite',
    dbPath: path.join(app.getPath('userData'), 'import.sqlite'),
    reportDir: path.join(app.getPath('userData'), 'reports')
  });
  await engine.init();

  ipcMain.handle('import:run', async (evt, filePath, options) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    // Forward des événements vers le renderer
    ['sheet:progress','sheet:row','done','error'].forEach(name => {
      engine.on(name, (payload) => win.webContents.send(`import:event:${name}`, payload));
    });
    return engine.importFile(filePath, options);
  });
});
```

```javascript
// preload.js
contextBridge.exposeInMainWorld('importEngine', {
  run: (filePath, options) => ipcRenderer.invoke('import:run', filePath, options),
  on: (event, cb) => ipcRenderer.on(`import:event:${event}`, (_e, p) => cb(p))
});
```

### Recompilation pour Electron

`better-sqlite3` doit être recompilé pour la version d'Electron :

```bash
npx electron-rebuild -f -w better-sqlite3
# ou avec electron-builder :
# "afterPack": "./build/rebuild-sqlite.js"
```

## Performance

Sur le fichier de démonstration (1032 lignes × 54 colonnes, 4 feuilles) :

| Métrique              | Valeur |
|-----------------------|--------|
| Durée 1er import      | ~250ms |
| Durée re-import       | ~400ms (checksums comparés) |
| Lignes insérées       | 355    |
| Lignes rejetées       | 891 (qualité données) |
| Avertissements        | 288    |

Pour des volumes > 50 000 lignes, exécuter le moteur dans un `worker_thread` pour ne pas figer le main process Electron.

## Étendre

### Ajouter un nouveau schéma

```javascript
// src/schemas/monSchema.js
const MON_SCHEMA = {
  name: 'mon',
  sheetMatchers: [/^MA_FEUILLE$/i],
  headerRow: 1,
  requiredHeaders: ['ID', 'NOM'],
  identity: { fields: ['ID'], strategy: 'upsert' },
  fields: [
    { key: 'id', header: 'ID', type: 'string', required: true },
    { key: 'nom', header: 'NOM', type: 'string', required: true, minLength: 2 }
  ]
};
module.exports = MON_SCHEMA;
```

Puis l'ajouter au registre dans `src/schemas/index.js`.

### Ajouter un nouvel adaptateur de stockage

Implémenter l'interface `StorageAdapter` :

```javascript
const { StorageAdapter } = require('excel-import-engine');
class PostgresAdapter extends StorageAdapter {
  async init() { /* ... */ }
  async upsertRecord(schema, record, identityKeys, runId) { /* ... */ }
  async saveAuditRun(context) { /* ... */ }
  // ...
}
```

Puis le passer directement à `createEngine({ storage: new PostgresAdapter(...) })`.

## Dépannage

| Symptôme                                    | Cause probable                                              |
|---------------------------------------------|-------------------------------------------------------------|
| `0 lignes insérées, 0 rejetées`             | Schéma non détecté — vérifier `sheetMatchers`              |
| `Champ obligatoire manquant` sur toutes lignes | Header mapping cassé — vérifier `field.header` vs en-tête réel |
| `SQLITE_ERROR: no such column`              | Adapter SQL non synchronisé avec le schéma — vérifier `schema.sql` |
| `better_sqlite3.node: undefined symbol`     | Recompilation Electron manquante — `npx electron-rebuild`  |
| Import lent (>5s pour 1000 lignes)          | Logger verbose activé, ou JSON adapter sur gros volume      |

## Licence

MIT
