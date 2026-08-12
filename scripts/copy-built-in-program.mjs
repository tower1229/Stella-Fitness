import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const programSource = fileURLToPath(
  new URL(
    "../knowledge/programs/zhuoshu-12-week/program-spec.v0.2.yaml",
    import.meta.url,
  ),
);
const programOutput = fileURLToPath(
  new URL("../dist/program/fidelity/zhuoshu-v0.2.yaml", import.meta.url),
);
const workbookSource = fileURLToPath(
  new URL("../sources/originals/zhuoshu-workout-log.xlsx", import.meta.url),
);
const workbookOutput = fileURLToPath(
  new URL("../dist/assets/zhuoshu-workout-log.xlsx", import.meta.url),
);

await Promise.all([
  mkdir(fileURLToPath(new URL("../dist/program/fidelity/", import.meta.url)), {
    recursive: true,
  }),
  mkdir(fileURLToPath(new URL("../dist/assets/", import.meta.url)), {
    recursive: true,
  }),
]);
await Promise.all([
  copyFile(programSource, programOutput),
  copyFile(workbookSource, workbookOutput),
]);
