const escapeRegularExpression = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function extractVerifiedExample(markdown, identifier) {
  const escapedIdentifier = escapeRegularExpression(identifier);
  const pattern = new RegExp(
    `<!--\\s*verify-example:${escapedIdentifier}\\s*-->\\s*\\n` +
      "```(?:js|javascript|mjs)\\s*\\n([\\s\\S]*?)\\n```",
  );
  const match = markdown.match(pattern);
  if (!match?.[1]) throw new Error(`README is missing verified example ${identifier}`);
  return `${match[1].trim()}\n`;
}

export function expectedExportSpecifiers(packageName, exportsMap) {
  return Object.keys(exportsMap).map((entry) =>
    entry === "." ? packageName : `${packageName}/${entry.replace(/^\.\//, "")}`,
  );
}

export function documentedExportSpecifiers(markdown) {
  const match = markdown.match(
    /<!--\s*public-exports:start\s*-->([\s\S]*?)<!--\s*public-exports:end\s*-->/,
  );
  if (!match?.[1]) throw new Error("README is missing its public export inventory markers");

  const specifiers = [...match[1].matchAll(/`(@entellix\/[a-z0-9-]+(?:\/[a-z0-9./-]+)?)`/g)].map(
    (entry) => entry[1],
  );
  return [...new Set(specifiers)];
}
