/**
 * backup-locations.ts — T-505 (BKUP-511): the last-used backup locations,
 * remembered between application sessions (the owner's task 4: "Remember
 * the last-used backup source and destination between application
 * sessions, while still allowing me to change them at any time").
 *
 * TWO slots, both persisted in localStorage (the per-desktop-local store —
 * ADR-032's convention for machine-local preferences):
 *   - the SOURCE directory (where the owner last picked a backup FILE from)
 *   - the DESTINATION directory (where the owner last SAVED an export)
 *
 * The Electron dialogs receive them as the `defaultPath` so the native
 * picker opens where the owner left off — never a hardcoded directory.
 * Clearing a slot is always allowed (the settings surface exposes it); an
 * absent/invalid value simply means the dialog opens at the OS default.
 */

const LAST_SOURCE_KEY = "el-imtiyaz:backup-last-source-dir";
const LAST_DESTINATION_KEY = "el-imtiyaz:backup-last-destination-dir";

function readSlot(key: string): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(key);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

function writeSlot(key: string, value: string | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (value && value.length > 0) {
      localStorage.setItem(key, value);
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    /* best-effort persistence — the in-session value still works. */
  }
}

/** The last directory a backup FILE was loaded from (the restore picker's opener). */
export function getLastBackupSourceDir(): string | null {
  return readSlot(LAST_SOURCE_KEY);
}

/** Remember the restore picker's directory (called after every successful pick). */
export function setLastBackupSourceDir(dir: string | null): void {
  writeSlot(LAST_SOURCE_KEY, dir);
}

/** The last directory an export was SAVED to (the save dialog's opener). */
export function getLastBackupDestinationDir(): string | null {
  return readSlot(LAST_DESTINATION_KEY);
}

/** Remember the save destination (called after every successful save). */
export function setLastBackupDestinationDir(dir: string | null): void {
  writeSlot(LAST_DESTINATION_KEY, dir);
}

/** Derive the directory part of a saved-file path (null when not derivable). */
export function parentDirectoryOf(filePath: string): string | null {
  // Handles both separators — the Electron paths are OS-native.
  const idx = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  if (idx <= 0) return null;
  return filePath.slice(0, idx);
}
