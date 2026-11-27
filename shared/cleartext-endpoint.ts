const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1)$/i;

/** True for a plain-http address that is not this computer: the key and the pictures sent there cross the network unencrypted. */
export function isCleartextRemote(value: string | null | undefined): boolean {
  const text = value?.trim();
  if (!text) return false;
  let url: URL;
  try { url = new URL(text); } catch { return false; }
  return url.protocol === "http:" && !LOOPBACK.test(url.hostname);
}
