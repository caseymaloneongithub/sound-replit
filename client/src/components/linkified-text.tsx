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
    // 2: a web address: with a scheme or www., or a bare domain on a common ending.
    String.raw`((?:https?:\/\/|www\.)[^\s<>"']+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|co|us|biz|info|io|shop|store|site|cafe|coffee|restaurant|wine|beer)\b(?:\/[^\s<>"']*)?)`,
  ].join("|"),
  "gi",
);
const TRAILING = /[.,;:!?)\]}]+$/;

export function LinkifiedText({ text, className }: { text: string; className?: string }) {
  const parts: ReactNode[] = [];
  const tokens = new RegExp(TOKENS.source, TOKENS.flags); // its own lastIndex per render
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = tokens.exec(text)) !== null) {
    const [whole, email, url] = match;
    if (email || !url) continue;
    const start = match.index;
    const trail = url.match(TRAILING)?.[0] ?? "";
    const address = trail ? url.slice(0, -trail.length) : url;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <a
        key={start}
        href={/^https?:\/\//i.test(address) ? address : `https://${address}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-2 hover:no-underline break-all"
        onClick={(e) => e.stopPropagation()}
      >
        {address}
      </a>,
    );
    if (trail) parts.push(trail);
    last = start + whole.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <span className={className}>{parts}</span>;
}
