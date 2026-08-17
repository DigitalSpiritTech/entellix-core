import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageDirectories = ["packages/contracts", "packages/core", "packages/instructions"];

const run = (command, args, cwd = repositoryRoot) =>
  execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

const assertPackedManifest = (archive) => {
  const manifest = JSON.parse(run("tar", ["-xOf", archive, "package/package.json"]));
  const serializedExports = JSON.stringify(manifest.exports);
  const serializedDependencies = JSON.stringify(manifest.dependencies ?? {});

  if (serializedExports.includes("/src/") || /(?<!\.d)\.ts"/.test(serializedExports)) {
    throw new Error(`${manifest.name} still exposes TypeScript source in its packed manifest`);
  }
  if (
    serializedDependencies.includes("workspace:") ||
    serializedDependencies.includes("catalog:")
  ) {
    throw new Error(`${manifest.name} contains a workspace-only dependency specifier`);
  }

  const contents = run("tar", ["-tzf", archive]).trim().split("\n");
  const forbidden = contents.find(
    (entry) =>
      entry.includes("/src/") ||
      entry.includes("__specs__") ||
      entry.includes("/test/") ||
      /(^|\/)\.env($|\.)/.test(entry),
  );
  if (forbidden)
    throw new Error(`${manifest.name} includes forbidden release content: ${forbidden}`);
  if (!contents.some((entry) => entry.startsWith("package/dist/"))) {
    throw new Error(`${manifest.name} does not include compiled output`);
  }
};

const verifyConsumerImports = (consumerDirectory) => {
  const source = `
    const checks = [
      ['@entellix/contracts', 'memorySchema'],
      ['@entellix/core', 'createExtractor'],
      ['@entellix/core/retrieval', 'RETRIEVAL_CONFIG_V1'],
      ['@entellix/instructions/mcp', 'ACTIVE_ENTELLIX_SERVER_INSTRUCTIONS'],
    ];
    for (const [specifier, exportName] of checks) {
      const module = await import(specifier);
      if (!(exportName in module)) throw new Error(specifier + ' is missing ' + exportName);
    }
  `;
  run("node", ["--input-type=module", "--eval", source], consumerDirectory);
};

const verifyPublicPackages = async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "entellix-public-packages-"));
  const archiveDirectory = join(temporaryRoot, "archives");

  try {
    for (const directory of packageDirectories) {
      run("pnpm", ["run", "build"], join(repositoryRoot, directory));
      run(
        "pnpm",
        ["pack", "--pack-destination", archiveDirectory],
        join(repositoryRoot, directory),
      );
    }

    const archives = (await readdir(archiveDirectory))
      .filter((entry) => entry.endsWith(".tgz"))
      .map((entry) => join(archiveDirectory, entry));
    if (archives.length !== packageDirectories.length) {
      throw new Error(`expected ${packageDirectories.length} tarballs, found ${archives.length}`);
    }
    archives.forEach(assertPackedManifest);

    await writeFile(
      join(temporaryRoot, "package.json"),
      `${JSON.stringify({ name: "entellix-package-verification", private: true }, null, 2)}\n`,
    );
    await writeFile(join(temporaryRoot, ".npmrc"), "fund=false\naudit=false\n");
    run("npm", ["install", "--ignore-scripts", "--no-package-lock", ...archives], temporaryRoot);

    verifyConsumerImports(temporaryRoot);
    console.log(
      "Public package tarballs install and import successfully from an external consumer.",
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
};

await verifyPublicPackages();
