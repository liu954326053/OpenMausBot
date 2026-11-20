import { track } from "@/lib/analytics";

const SIGN_IN_GATE = ["signed_out", "session_ended", "team_left", "service_trust"] as const;
export type SignInGate = (typeof SIGN_IN_GATE)[number];

export function signInGateShown(reason: SignInGate): void {
  track("sign_in_gate", { reason: SIGN_IN_GATE.includes(reason) ? reason : "other" });
}
