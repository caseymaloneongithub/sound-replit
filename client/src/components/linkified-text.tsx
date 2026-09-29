import type { ReactNode } from "react";

/*
 * Text with its web addresses as links (owner, 2026-09-29: "I want the website
 * urls to be clickable"). Lead notes hold a business's site as
 * "https://www.berrymuch.net", "www.example.com" or a bare "example.com"; each
 * becomes a link that opens in a new tab. Email addresses stay text, so
 * "orders@example.com" isn't read as the site example.com. Trailing
 * punctuation ("…see example.com.") stays outside the link, and a click on a
 * link doesn't reach the table row behind it.
 */
const TOKENS = new RegExp(
  [
    // 1: an email address, left as text.
    String.raw`([^\s@<>()"']+@[^\s@<>()"']+\.[a-z]{2,})`,
    // 2: an address with a scheme or www.: linked whole.
    String.raw`((?:https?:\/\/|www\.)[^\s<>"']+)`,
    // 3: a bare hostname, matched whole ("shop.example.com.au"), with any path.
    String.raw`\b((?:[a-z0-9-]+\.)+[a-z0-9-]+(?:\/[^\s<>"']*)?)`,
  ].join("|"),
  "gi",
);
// A bare hostname is a link only when its LAST part is one of these, so a
// version number, "e.g." or a file name stays text. One that ends otherwise is
// left whole as text, never cut back to a shorter domain it starts with:
// "example.co.uk" used to link to example.co (review, 2026-09-29).
const BARE_ENDINGS = new Set([
  "com", "net", "org", "co", "us", "biz", "info", "io", "app", "me", "tv",
  "shop", "store", "site", "cafe", "coffee", "restaurant", "wine", "beer",
  "uk", "ca", "au", "nz", "ie", "de", "fr", "eu",
]);
const TRAILING = /[.,;:!?)\]}]+$/;

// The web addresses in the text, in order: where each starts, the address as
// written (without trailing punctuation) and the href a link to it opens.
function webAddresses(text: string): { start: number; address: string; href: string }[] {
  const found: { start: number; address: string; href: string }[] = [];
  const tokens = new RegExp(TOKENS.source, TOKENS.flags); // its own lastIndex per call
  let match: RegExpExecArray | null;
  while ((match = tokens.exec(text)) !== null) {
    const [, email, withScheme, bare] = match;
    const url = withScheme ?? bare;
    if (email || !url) continue;
    const trail = url.match(TRAILING)?.[0] ?? "";
    const address = trail ? url.slice(0, -trail.length) : url;
    if (bare) {
      const host = address.split("/")[0];
      if (!BARE_ENDINGS.has(host.slice(host.lastIndexOf(".") + 1).toLowerCase())) continue;
    }
    found.push({ start: match.index, address, href: /^https?:\/\//i.test(address) ? address : `https://${address}` });
  }
  return found;
}

// The first web address in the text, for a Website column: the href and the
// host to show ("https://www.berrymuch.net/menu" shows as berrymuch.net).
export function firstWebAddress(text: string | null | undefined): { href: string; host: string } | null {
  const first = text ? webAddresses(text)[0] : undefined;
  if (!first) return null;
  const host = first.href.replace(/^https?:\/\//i, "").split(/[/?#]/)[0].replace(/^www\./i, "");
  return { href: first.href, host };
}

export function LinkifiedText({ text, className }: { text: string; className?: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  webAddresses(text).forEach(({ start, address, href }) => {
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <a
        key={start}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-2 hover:no-underline break-all"
        onClick={(e) => e.stopPropagation()}
      >
        {address}
      </a>,
    );
    last = start + address.length; // trailing punctuation goes out with the text after
  });
  if (last < text.length) parts.push(text.slice(last));
  return <span className={className}>{parts}</span>;
}
