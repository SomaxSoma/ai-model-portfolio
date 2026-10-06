import type { FieldErrors } from '@pf/domain';

/** An error with a user-facing message that maps to an HTTP status. */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly errors?: FieldErrors,
  ) {
    super(message);
  }
}

export const badRequest = (errors: FieldErrors, message = 'Some fields need attention.') => new HttpError(400, message, errors);
export const unprocessable = (errors: FieldErrors, message = 'This portfolio can’t be saved yet.') => new HttpError(422, message, errors);
export const unauthorized = (message = 'Please log in to continue.') => new HttpError(401, message);
export const forbidden = (message = 'You don’t have access to that.') => new HttpError(403, message);
export const notFound = (what = 'That item') => new HttpError(404, `${what} could not be found.`);
export const conflict = (errors: FieldErrors, message: string) => new HttpError(409, message, errors);

/** Turn a zod issue list into { field: message }. */
export function zodFieldErrors(issues: { path: PropertyKey[]; message: string }[]): FieldErrors {
  const out: FieldErrors = {};
  for (const i of issues) {
    const key = i.path.map(String).join('.') || 'body';
    out[key] ??= i.message;
  }
  return out;
}
