export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const badRequest = (code: string, message: string) => new HttpError(400, code, message);
export const unauthorized = (message = 'Please sign in again') =>
  new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'Not allowed') => new HttpError(403, 'forbidden', message);
export const notFound = (code: string, message: string) => new HttpError(404, code, message);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);
