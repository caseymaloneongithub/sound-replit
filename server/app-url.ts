/** The site's public origin, for links in emails and Stripe's redirects back. */
export function getBaseUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "");
  if (process.env.REPLIT_DOMAINS) return `https://${process.env.REPLIT_DOMAINS.split(',')[0]}`;
  if (process.env.NODE_ENV !== "development") {
    console.warn("[CONFIG] APP_URL is not set — payment redirects will point at localhost.");
  }
  return "http://localhost:5000";
}
