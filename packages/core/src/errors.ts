export type ErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "TENANT_SCOPE_DENIED"
  | "VALIDATION_FAILED"
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "RESOURCE_NOT_FOUND"
  | "PLUGIN_INCOMPATIBLE"
  | "DEPENDENCY_UNAVAILABLE";

export class AsterError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly details: readonly string[];

  public constructor(code: ErrorCode, status: number, message: string, details: readonly string[] = []) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const validationError = (details: readonly string[]): AsterError =>
  new AsterError("VALIDATION_FAILED", 422, "Request validation failed.", details);
