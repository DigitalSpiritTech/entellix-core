import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const standaloneRoot = join(repositoryRoot, "apps/standalone");
const verifyOnly = process.argv.includes("--verify");

const run = (command, args, cwd = repositoryRoot) =>
  execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

const exists = async (path) =>
  stat(path).then(
    () => true,
    () => false,
  );

const packageStandalone = async () => {
  const manifest = JSON.parse(await readFile(join(standaloneRoot, "package.json"), "utf8"));
  const temporaryRoot = await mkdtemp(join(tmpdir(), "entellix-standalone-"));
  const distributionName = `entellix-standalone-${manifest.version}`;
  const distributionRoot = join(temporaryRoot, distributionName);
  const outputDirectory = verifyOnly ? temporaryRoot : join(repositoryRoot, "artifacts");
  const archive = join(outputDirectory, `${distributionName}.tgz`);

  try {
    run("pnpm", ["run", "build"], standaloneRoot);
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
    for (const required of [
      `${distributionName}/server/index.mjs`,
      `${distributionName}/migrations/0001_single_workspace.sql`,
      `${distributionName}/scripts/migrate.mjs`,
      `${distributionName}/THIRD_PARTY_LICENSES.json`,
    ]) {
      const entry = run("tar", ["-tzf", archive, required]).trim();
      if (entry !== required) throw new Error(`standalone artifact is missing ${required}`);
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

await packageStandalone();
