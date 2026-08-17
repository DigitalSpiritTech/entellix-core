import { access, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

const packageDirectory = process.cwd();
const manifestPath = join(packageDirectory, "package.json");
const distDirectory = join(packageDirectory, "dist");

await access(manifestPath);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

if (typeof manifest.name !== "string" || !manifest.name.startsWith("@entellix/")) {
  throw new Error("Refusing to clean dist outside an @entellix package directory");
}

await rm(distDirectory, { recursive: true, force: true });
