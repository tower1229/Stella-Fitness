import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(
  new URL(
    "../knowledge/programs/zhuoshu-12-week/program-spec.v0.2.yaml",
    import.meta.url,
  ),
);
const output = fileURLToPath(
  new URL("../dist/program/fidelity/zhuoshu-v0.2.yaml", import.meta.url),
);

await mkdir(fileURLToPath(new URL("../dist/program/fidelity/", import.meta.url)), {
  recursive: true,
});
await copyFile(source, output);
