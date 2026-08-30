/**
 * One phone format everywhere: "(206) 555-1234".
 *
 * Normalizes any 10-digit US number (with or without +1, dots, dashes, spaces).
 * Anything that isn't recognizably a US number is returned trimmed but untouched —
 * better an odd-looking foreign number than a mangled one.
 */
export function formatPhoneNumber(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  const d = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (d.length !== 10) return raw.trim();
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
