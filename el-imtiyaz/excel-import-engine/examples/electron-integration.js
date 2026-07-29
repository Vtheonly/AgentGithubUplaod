'use strict';

/**
 * Exemple d'intégration du moteur d'import dans le process principal Electron.
 *
 * Le moteur tourne dans le main process (Node.js) car il utilise better-sqlite3
 * (extension native) et exceljs (pas compatible renderer sans bundling).
 * Le renderer communique via ipcRenderer.invoke / ipcMain.handle.
 *
 * --- main.js (Electron main process) ---
 *
 *   const { app, ipcMain, BrowserWindow } = require('electron');
 *   const path = require('path');
 *   const { createEngine } = require('excel-import-engine');
 *
 *   let engine;
 *
 *   app.whenReady().then(async () => {
 *     const userData = app.getPath('userData');
 *     engine = createEngine({
 *       storage: 'sqlite',
 *       dbPath: path.join(userData, 'import.sqlite'),
 *       reportDir: path.join(userData, 'reports')
 *     });
 *     await engine.init();
 *
 *     // IPC : aperçu d'un fichier
 *     ipcMain.handle('import:preview', async (evt, filePath) => {
 *       return engine.preview(filePath);
 *     });
 *
 *     // IPC : lancer un import
 *     // Le renderer peut écouter les événements via un canal webContents.send
 *     ipcMain.handle('import:run', async (evt, filePath, options) => {
 *       const win = BrowserWindow.fromWebContents(evt.sender);
 *
 *       // Forward des événements vers le renderer
 *       const forwards = ['start','sheet:start','sheet:progress','sheet:row',
 *                         'sheet:warn','sheet:error','sheet:done','done','error'];
 *       const handlers = forwards.map(name => {
 *         const h = (payload) => win.webContents.send(`import:event:${name}`, payload);
 *         engine.on(name, h);
 *         return { name, h };
 *       });
 *
 *       try {
 *         const ctx = await engine.importFile(filePath, options);
 *         return { ok: true, summary: ctx.toJSON() };
 *       } catch (e) {
 *         return { ok: false, error: { message: e.message, code: e.code } };
 *       } finally {
 *         handlers.forEach(({ name, h }) => engine.off(name, h));
 *       }
 *     });
 *
 *     // IPC : historique des runs
 *     ipcMain.handle('import:history', async () => {
 *       // Expose une requête directe sur better-sqlite3
 *       return engine.storage.db.prepare(
 *         'SELECT run_id, file_path, started_at, duration_ms, status, errors_count, warnings_count FROM import_runs ORDER BY started_at DESC LIMIT 100'
 *       ).all();
 *     });
 *   });
 *
 *   app.on('before-quit', async () => {
 *     if (engine) await engine.close();
 *   });
 *
 * --- preload.js (bridge safe) ---
 *
 *   const { contextBridge, ipcRenderer } = require('electron');
 *   contextBridge.exposeInMainWorld('importEngine', {
 *     preview: (filePath) => ipcRenderer.invoke('import:preview', filePath),
 *     run: (filePath, options) => ipcRenderer.invoke('import:run', filePath, options),
 *     history: () => ipcRenderer.invoke('import:history'),
 *     on: (event, cb) => {
 *       const listener = (_evt, payload) => cb(payload);
 *       ipcRenderer.on(`import:event:${event}`, listener);
 *       return () => ipcRenderer.removeListener(`import:event:${event}`, listener);
 *     }
 *   });
 *
 * --- renderer (React/Vue/...) ---
 *
 *   // Aperçu avant import
 *   const sheets = await window.importEngine.preview(file.path);
 *
 *   // Lancer l'import avec écoute des événements
 *   const unsub = window.importEngine.on('sheet:progress', ({ sheet, read, total }) => {
 *     setProgress({ sheet, pct: Math.round((read / total) * 100) });
 *   });
 *   const result = await window.importEngine.run(file.path, { dryRun: false });
 *   unsub();
 *
 * Notes :
 *   - better-sqlite3 doit être recompilé pour la version d'Electron utilisée.
 *     Utiliser @electron/rebuild ou electron-builder avec afterPack hook.
 *   - Pour des fichiers > 50 000 lignes, exécuter le moteur dans un worker_thread
 *     pour ne pas figer le main process.
 */

module.exports = {};
