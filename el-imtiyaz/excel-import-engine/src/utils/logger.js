'use strict';

/**
 * Logger léger avec niveaux et préfixe de run.
 * Sortie vers stderr afin de ne pas polluer stdout (utilisé pour les rapports JSON).
 * Dans Electron, le renderer/main peut écouter via les événements du moteur
 * plutôt que via stdout ; ce logger reste un filet de sécurité.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

class Logger {
  constructor(prefix = 'import-engine', level = 'info') {
    this.prefix = prefix;
    this.level = LEVELS[level] ?? LEVELS.info;
  }

  _format(level, msg, meta) {
    const ts = new Date().toISOString();
    const base = `[${ts}] [${level.toUpperCase()}] [${this.prefix}] ${msg}`;
    if (meta && Object.keys(meta).length > 0) {
      return `${base} ${JSON.stringify(meta)}`;
    }
    return base;
  }

  _emit(level, msg, meta) {
    if (LEVELS[level] < this.level) return;
    const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
    stream.write(this._format(level, msg, meta) + '\n');
  }

  debug(msg, meta = {}) { this._emit('debug', msg, meta); }
  info(msg, meta = {}) { this._emit('info', msg, meta); }
  warn(msg, meta = {}) { this._emit('warn', msg, meta); }
  error(msg, meta = {}) { this._emit('error', msg, meta); }

  child(prefix) {
    return new Logger(`${this.prefix}:${prefix}`, Object.keys(LEVELS).find(k => LEVELS[k] === this.level));
  }
}

module.exports = { Logger, defaultLogger: new Logger() };
