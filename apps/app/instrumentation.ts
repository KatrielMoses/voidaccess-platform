/**
 * Runs once when the server starts. In production a missing DATABASE_URL, DATABASE_URL_SYSTEM or RLS_CONTEXT_KEY
 * must stop the revision from starting (Cloud Run keeps the previous one), not surface as a 500 on the first
 * request. Creating the Database opens no connection; it only validates the configuration.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  const { getDatabase } = await import("@voidaccess/db");
  getDatabase();
}
