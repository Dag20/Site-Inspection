export type ErrorCode = 'unauthenticated' | 'forbidden' | 'not_found' | 'invalid_state' | 'validation';

const STATUS: Record<ErrorCode, number> = { unauthenticated: 401, forbidden: 403, not_found: 404, invalid_state: 409, validation: 422 };

/** An error the user can act on. The message is shown to them, so write it in plain words. */
export class AppError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message);
  }
  get status() {
    return STATUS[this.code];
  }
}
