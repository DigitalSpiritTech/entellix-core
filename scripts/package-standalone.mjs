import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const standaloneRoot = join(repositoryRoot, "apps/standalone");
const verifyOnly = process.argv.includes("--verify");

const run = (command, args, cwd = repositoryRoot) =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  });

const exists = async (path) =>
  stat(path).then(
    () => true,
    () => false,
  );

export const buildStandaloneWorkspace = (runBuild, root) =>
  runBuild("pnpm", ["run", "build"], root);

const archiveRequirements = (distributionName) => ({
  exact: [
    `${distributionName}/server/index.mjs`,
    `${distributionName}/migrations/0001_single_workspace.sql`,
    `${distributionName}/scripts/migrate.mjs`,
    `${distributionName}/THIRD_PARTY_LICENSES.json`,
  ],
  suffixes: [
    "/node_modules/@entellix/contracts/dist/reconciler.js",
    "/node_modules/@entellix/core/dist/reconciler.js",
    "/node_modules/@entellix/instructions/dist/mcp.js",
  ],
});

export const findMissingStandaloneArchiveRequirement = (entries, distributionName) => {
  const requirements = archiveRequirements(distributionName);
  return (
    requirements.exact.find((required) => !entries.includes(required)) ??
    requirements.suffixes.find((required) => !entries.some((entry) => entry.endsWith(required))) ??
    null
  );
};

const packageStandalone = async () => {
  const manifest = JSON.parse(await readFile(join(standaloneRoot, "package.json"), "utf8"));
  const temporaryRoot = await mkdtemp(join(tmpdir(), "entellix-standalone-"));
  const distributionName = `entellix-standalone-${manifest.version}`;
  const distributionRoot = join(temporaryRoot, distributionName);
  const outputDirectory = verifyOnly ? temporaryRoot : join(repositoryRoot, "artifacts");
  const archive = join(outputDirectory, `${distributionName}.tgz`);

  try {
    buildStandaloneWorkspace(run, repositoryRoot);
    await mkdir(distributionRoot, { recursive: true });
    await cp(join(standaloneRoot, ".mastra/output"), join(distributionRoot, "server"), {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
    });
    await cp(join(standaloneRoot, "migrations"), join(distributionRoot, "migrations"), {
      recursive: true,
    });
    await mkdir(join(distributionRoot, "scripts"), { recursive: true });
    await cp(
      join(standaloneRoot, "scripts/migrate-distribution.mjs"),
      join(distributionRoot, "scripts/migrate.mjs"),
    );
    await cp(join(standaloneRoot, ".env.example"), join(distributionRoot, ".env.example"));
    await cp(join(standaloneRoot, "README.md"), join(distributionRoot, "README.md"));

    const rootLicense = join(repositoryRoot, "LICENSE");
    if (await exists(rootLicense)) {
      await cp(rootLicense, join(distributionRoot, "LICENSE"));
    } else {
      await writeFile(
        join(distributionRoot, "UNLICENSED.txt"),
        "This verification artifact is not licensed for public distribution.\n",
      );
    }

    const licenses = run("pnpm", ["licenses", "list", "--prod", "--json"]);
    await writeFile(join(distributionRoot, "THIRD_PARTY_LICENSES.json"), licenses);
    await writeFile(
      join(distributionRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "@entellix/standalone-distribution",
          version: manifest.version,
          private: true,
          type: "module",
          engines: { node: ">=24" },
          scripts: {
            migrate: "node --env-file=.env scripts/migrate.mjs",
            start: "node --env-file=.env server/index.mjs",
          },
        },
        null,
        2,
      )}\n`,
    );

    await mkdir(dirname(archive), { recursive: true });
    run("tar", ["-czf", archive, "-C", temporaryRoot, distributionName]);
    const archiveEntries = run("tar", ["-tzf", archive]).trim().split("\n");
    const missingRequirement = findMissingStandaloneArchiveRequirement(
      archiveEntries,
      distributionName,
    );
    if (missingRequirement) {
      throw new Error(`standalone artifact is missing ${missingRequirement}`);
    }
    console.log(
      verifyOnly
        ? "Standalone release artifact assembled and verified successfully."
        : `Created ${basename(archive)}`,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await packageStandalone();
}
