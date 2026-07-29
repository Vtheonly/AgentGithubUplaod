'use strict';

/**
 * Hiérarchie d'erreurs du moteur d'import.
 * Toutes les erreurs métier héritent de ImportEngineError afin que
 * l'application Electron puisse les attraper génériquement.
 */

class ImportEngineError extends Error {
  constructor(message, code = 'IMPORT_ENGINE_ERROR', details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
  }
}

class FileNotFoundError extends ImportEngineError {
  constructor(filePath) {
    super(`Fichier introuvable : ${filePath}`, 'FILE_NOT_FOUND', { filePath });
  }
}

class UnsupportedFormatError extends ImportEngineError {
  constructor(filePath, reason) {
    super(
      `Format de fichier non supporté : ${filePath}. Raison : ${reason}`,
      'UNSUPPORTED_FORMAT',
      { filePath, reason }
    );
  }
}

class SheetNotFoundError extends ImportEngineError {
  constructor(sheetName, availableSheets) {
    super(
      `Feuille « ${sheetName} » introuvable. Feuilles disponibles : ${availableSheets.join(', ')}`,
      'SHEET_NOT_FOUND',
      { sheetName, availableSheets }
    );
  }
}

class SchemaError extends ImportEngineError {
  constructor(message, details = {}) {
    super(message, 'SCHEMA_ERROR', details);
  }
}

class StorageError extends ImportEngineError {
  constructor(message, details = {}) {
    super(message, 'STORAGE_ERROR', details);
  }
}

class ValidationError extends ImportEngineError {
  constructor(message, details = {}) {
    super(message, 'VALIDATION_ERROR', details);
  }
}

class ConfigurationError extends ImportEngineError {
  constructor(message, details = {}) {
    super(message, 'CONFIGURATION_ERROR', details);
  }
}

/**
 * Erreur agrégée — utilisée lorsque plusieurs lignes échouent mais que
 * l'import continue (mode permissif). Contient un résumé et la liste détaillée.
 */
class AggregatedImportError extends ImportEngineError {
  constructor(summary, failures = []) {
    super(summary, 'AGGREGATED_IMPORT_ERRORS', { failures });
    this.failures = failures;
  }
}

module.exports = {
  ImportEngineError,
  FileNotFoundError,
  UnsupportedFormatError,
  SheetNotFoundError,
  SchemaError,
  StorageError,
  ValidationError,
  ConfigurationError,
  AggregatedImportError
};
