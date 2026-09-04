import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * `crypto.randomUUID()` only exists in "secure contexts" (HTTPS, or
 * localhost) per the Web Crypto spec — a browser loading AgentOS over plain
 * HTTP from a LAN/Tailscale IP (as opposed to https:// or http://localhost)
 * does not expose it at all, so calling it directly throws
 * "crypto.randomUUID is not a function" and crashes whatever click handler
 * called it (e.g. the workspace creation wizard's "Create workspace"
 * button). This falls back to `crypto.getRandomValues` (available in every
 * context, secure or not) to assemble an equivalent RFC 4122 v4 UUID, and
 * finally to Math.random if even that is missing.
 */
export function randomUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
