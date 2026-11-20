/** Privacy: MagicBot sends no usage analytics. An event the app names goes nowhere: nothing is loaded, stored or sent. */
export function track(_event: string, _props?: Record<string, unknown>): void {}

const GATE_KEY = "omb-email-gate";
export function emailGateDone(): boolean {
  return Boolean(localStorage.getItem(GATE_KEY));
}
export function setEmailGateDone(status: "submitted" | "skipped") {
  localStorage.setItem(GATE_KEY, status);
}
