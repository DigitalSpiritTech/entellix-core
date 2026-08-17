import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  /\bnpm_[A-Za-z0-9]{36,}\b/,
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
];

const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  cwd: repositoryRoot,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

const findings = (
  await Promise.all(
    trackedFiles.map(async (file) => {
      const contents = await readFile(resolve(repositoryRoot, file)).catch(() => undefined);
      if (!contents || contents.includes(0)) return undefined;
      const text = contents.toString("utf8");
      return secretPatterns.some((pattern) => pattern.test(text)) ? file : undefined;
    }),
  )
).filter(Boolean);

if (findings.length > 0) {
  console.error("Potential secrets found in tracked files:");
  findings.forEach((file) => console.error(`- ${file}`));
  process.exitCode = 1;
} else {
  console.log("No known credential patterns found in tracked files.");
}
