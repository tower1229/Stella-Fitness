process.stderr.write(
  [
    "Live-model gate blocked:",
    "- GitHub Issue #3 still requires real filled workout-log photos and human ground truth",
    "- No fixed-layout numeric accuracy or cropped-image abstention claim is available",
    "- Deterministic fixture tests run separately via npm run test:deterministic",
  ].join("\n") + "\n",
);
process.exitCode = 1;
