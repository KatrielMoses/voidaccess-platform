/** Input problems the API maps to 400 / 404 / 409 JSON. Anything else is a bug and becomes a 500. */
export class AdminError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}
