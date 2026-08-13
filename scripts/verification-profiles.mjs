const npmRun = (name, requirements = []) => ({
  name,
  command: "npm",
  args: ["run", name],
  requirements,
});

const pureSteps = [
  npmRun("typecheck"),
  npmRun("test:deterministic"),
  npmRun("build"),
  npmRun("verify:package"),
];

const networkInstallSteps = [
  npmRun("build"),
  npmRun("verify:network-install", ["network-install"]),
];

const exactHostSteps = [
  npmRun("build"),
  npmRun("verify:clean-install", ["network-install", "loopback", "exact-host"]),
];

export const verificationProfiles = Object.freeze({
  pure: {
    requirements: [],
    steps: pureSteps,
  },
  "network-install": {
    requirements: ["network-install"],
    steps: networkInstallSteps,
  },
  "exact-host": {
    requirements: ["network-install", "loopback", "exact-host"],
    steps: exactHostSteps,
  },
  release: {
    requirements: [
      "network-install",
      "loopback",
      "exact-host",
      "external-platform",
    ],
    steps: [
      ...pureSteps,
      ...networkInstallSteps,
      ...exactHostSteps,
      npmRun("verify:clawhub", ["network-install", "external-platform"]),
      {
        name: "release-gates",
        command: process.execPath,
        args: ["scripts/verify-release.mjs"],
        requirements: ["external-platform"],
      },
    ],
  },
});
