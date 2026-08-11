/**
 * AppError builders — typed error codes for every failure mode the app
 * surfaces to the UI.
 *
 * Every error carries a `userMessage` suitable for display in a toast or
 * ErrorState component. The `message` field is the developer-facing detail
 * and should never be shown directly to end users.
 */
import type { AppError } from "./result";

export const Errors = {
  network(message = "Network request failed"): AppError {
    return { code: "ERR_NETWORK", message, userMessage: "Connexion réseau impossible." };
  },
  timeout(message = "Request timed out"): AppError {
    return { code: "ERR_TIMEOUT", message, userMessage: "La requête a expiré." };
  },
  notFound(entity: string, id: string): AppError {
    return {
      code: "ERR_NOT_FOUND",
      message: `${entity} not found: ${id}`,
      userMessage: `${entity} introuvable.`,
    };
  },
  validation(message: string, userMessage = "Données invalides.", cause?: unknown): AppError {
    return cause === undefined
      ? { code: "ERR_VALIDATION", message, userMessage }
      : { code: "ERR_VALIDATION", message, userMessage, cause };
  },
  unauthorized(message = "Unauthorized"): AppError {
    return { code: "ERR_UNAUTHORIZED", message, userMessage: "Accès non autorisé." };
  },
  forbidden(message = "Forbidden"): AppError {
    return {
      code: "ERR_FORBIDDEN",
      message,
      userMessage: "Vous n'avez pas la permission d'effectuer cette action.",
    };
  },
  conflict(message: string, userMessage = "Conflit détecté."): AppError {
    return { code: "ERR_CONFLICT", message, userMessage };
  },
  server(message = "Server error"): AppError {
    return { code: "ERR_SERVER", message, userMessage: "Erreur interne du serveur." };
  },
  offline(message = "Offline"): AppError {
    return { code: "ERR_OFFLINE", message, userMessage: "Hors ligne." };
  },
  unknown(err: unknown): AppError {
    if (err instanceof Error) {
      return {
        code: "ERR_UNKNOWN",
        message: err.message,
        userMessage: "Une erreur inattendue s'est produite.",
        cause: err,
      };
    }
    if (typeof err === "object" && err !== null) {
      const obj = err as Record<string, unknown>;
      const msg =
        typeof obj.message === "string" && obj.message
          ? obj.message
          : typeof obj.details === "string" && obj.details
          ? obj.details
          : JSON.stringify(err);
      return {
        code: "ERR_UNKNOWN",
        message: msg,
        userMessage: "Une erreur inattendue s'est produite.",
        cause: err,
      };
    }
    return {
      code: "ERR_UNKNOWN",
      message: String(err),
      userMessage: "Une erreur inattendue s'est produite.",
    };
  },
} as const;

export function isNetworkError(e: AppError): boolean {
  return e.code === "ERR_NETWORK" || e.code === "ERR_OFFLINE" || e.code === "ERR_TIMEOUT";
}
