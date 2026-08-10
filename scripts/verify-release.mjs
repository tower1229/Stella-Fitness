import { readFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const blockers = [];

if (packageJson.private === true) {
  blockers.push("package.json is intentionally private during internal implementation");
}
if (process.env.STELLA_RELEASE_RIGHTS_APPROVED !== "1") {
  blockers.push("derived-program release rights are not approved");
}
if (process.env.STELLA_CLAWHUB_PERMISSION_VERIFIED !== "1") {
  blockers.push("live ClawHub publication permission is not verified");
}
blockers.push(
  "automated ClawHub evidence and clean-environment recording-flow verification are not implemented",
);

if (blockers.length > 0) {
  process.stderr.write(
    `Public release blocked:\n${blockers.map((blocker) => `- ${blocker}`).join("\n")}\n`,
  );
  process.exitCode = 1;
}
