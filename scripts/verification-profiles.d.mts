import type { VerificationProfile } from "./verification-environment.mjs";

export const verificationProfiles: Readonly<{
  pure: VerificationProfile;
  "network-install": VerificationProfile;
  "exact-host": VerificationProfile;
  release: VerificationProfile;
}>;
