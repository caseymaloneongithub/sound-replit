/**
 * Links that take the driver into Google Maps (owner, 2026-09-22: "go straight
 * to Google Maps instead of opening a new tab and asking to open in a
 * different app").
 *
 * On Android the plain https link opens a browser tab first and then asks
 * which app should handle it. An Android intent link names the Google Maps
 * package outright, so the app opens directly, with the https page as the
 * fallback when Maps isn't installed. Everywhere else (iPhone, desktop) the
 * https link is right: on an iPhone with Google Maps installed it opens the
 * app through its universal link; without it, the website.
 */

export type MapsLink = { href: string; external: boolean };

const MAPS_PACKAGE = "com.google.android.apps.maps";

export function isAndroid(userAgent: string = typeof navigator === "undefined" ? "" : navigator.userAgent): boolean {
  return /android/i.test(userAgent);
}

/** The https directions URL for one destination, or a batch with waypoints. */
export function directionsUrl(destination: string, waypoints: string[] = []): string {
  return (
    `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}` +
    (waypoints.length ? `&waypoints=${encodeURIComponent(waypoints.join("|"))}` : "") +
    `&travelmode=driving`
  );
}

/** Wrap an https Maps URL so Android hands it straight to the Google Maps app. */
export function androidIntent(httpsUrl: string): string {
  const withoutScheme = httpsUrl.replace(/^https:\/\//, "");
  return `intent://${withoutScheme}#Intent;scheme=https;package=${MAPS_PACKAGE};S.browser_fallback_url=${encodeURIComponent(httpsUrl)};end`;
}

export function mapsLink(destination: string, waypoints: string[] = [], userAgent?: string): MapsLink {
  const https = directionsUrl(destination, waypoints);
  // An intent must be followed in the current tab for Android to act on it;
  // the https link opens beside the app so the day stays on screen.
  return isAndroid(userAgent) ? { href: androidIntent(https), external: false } : { href: https, external: true };
}
