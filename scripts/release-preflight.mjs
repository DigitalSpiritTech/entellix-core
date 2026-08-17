import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const registryPackages = ["packages/contracts", "packages/core", "packages/instructions"];
const releaseUnits = [...registryPackages, "apps/standalone"];

const exists = async (path) =>
  stat(path).then(
    () => true,
    () => false,
  );

const collectReleaseBlockers = async () => {
  const blockers = [];
  const rootLicensePath = resolve(repositoryRoot, "LICENSE");
  const hasRootLicense = await exists(rootLicensePath);
  const rootLicense = hasRootLicense ? await readFile(rootLicensePath, "utf8") : undefined;
  if (!hasRootLicense) {
    blockers.push("LICENSE is missing; the repository owner must approve the public license");
  }

  const unitBlockers = await Promise.all(
    releaseUnits.map(async (directory) => {
      const found = [];
      const manifest = JSON.parse(
        await readFile(resolve(repositoryRoot, directory, "package.json")),
      );
      if (registryPackages.includes(directory) && manifest.private) {
        found.push(`${manifest.name} is still marked private`);
      }
      if (!manifest.license || manifest.license === "UNLICENSED") {
        found.push(`${manifest.name} does not have an approved SPDX license`);
      }
      if (registryPackages.includes(directory) && manifest.publishConfig?.access !== "public") {
        found.push(`${manifest.name} is not configured for public registry access`);
      }
      if (hasRootLicense && registryPackages.includes(directory)) {
        const packageLicensePath = resolve(repositoryRoot, directory, "LICENSE");
        if (!(await exists(packageLicensePath))) {
          found.push(`${manifest.name} does not include a package-level LICENSE`);
        } else if ((await readFile(packageLicensePath, "utf8")) !== rootLicense) {
          found.push(`${manifest.name} LICENSE does not match the repository LICENSE`);
        }
      }
      return found;
    }),
  );
  blockers.push(...unitBlockers.flat());
  return blockers;
};

const blockers = await collectReleaseBlockers();
if (blockers.length > 0) {
  console.error("Release is intentionally blocked:");
  blockers.forEach((blocker) => console.error(`- ${blocker}`));
  process.exitCode = 1;
} else {
  console.log("Legal and package metadata preflight passed.");
}
