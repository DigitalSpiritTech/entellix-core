import ts from "typescript";

const FILE_MARKERS = ["Inputs:", "Outputs:", "Errors:"];
const CLASS_MARKERS = ["Inputs:", "Outputs:", "Errors:"];

/**
 * Finds the TSDoc block immediately preceding a syntax node.
 *
 * @param sourceFile - Parsed source file that owns the node.
 * @param sourceText - Original TypeScript source text.
 * @param node - Syntax node whose leading documentation is requested.
 * @returns The adjacent TSDoc block, or undefined when none exists.
 * @throws This function does not throw.
 */
function findLeadingTsdoc(sourceFile, sourceText, node) {
  const ranges = ts.getLeadingCommentRanges(sourceText, node.getFullStart()) ?? [];
  const adjacent = ranges.findLast(
    (range) =>
      range.kind === ts.SyntaxKind.MultiLineCommentTrivia &&
      sourceText.slice(range.pos, range.pos + 3) === "/**" &&
      sourceText.slice(range.end, node.getStart(sourceFile)).trim() === "",
  );

  return adjacent === undefined ? undefined : sourceText.slice(adjacent.pos, adjacent.end);
}

/**
 * Extracts the human-readable description from a TSDoc block.
 *
 * @param doc - TSDoc block to normalize.
 * @returns Description text with tags and contract markers removed.
 * @throws This function does not throw.
 */
function extractDescription(doc) {
  return doc
    .replace(/^\/\*\*|\*\/$/gu, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/u, "").trim())
    .filter((line) => line !== "")
    .filter((line) => !line.startsWith("@"))
    .filter((line) => !/^(Inputs|Outputs|Errors):/u.test(line))
    .join(" ")
    .trim();
}

/**
 * Creates a source-positioned compliance violation.
 *
 * @param sourceFile - Parsed source file used to resolve line numbers.
 * @param filePath - Repository-relative source path.
 * @param node - Node associated with the violation.
 * @param rule - Stable rule identifier.
 * @param message - Human-readable failure explanation.
 * @returns A diagnostic object for reporting or tests.
 * @throws This function does not throw.
 */
function createViolation(sourceFile, filePath, node, rule, message) {
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { filePath, line: line + 1, rule, message };
}

/**
 * Resolves a stable display name for a documented declaration.
 *
 * @param node - Declaration whose name is requested.
 * @returns The declared name or a syntax-kind fallback.
 * @throws This function does not throw.
 */
function declarationName(node) {
  if (node.name !== undefined && ts.isIdentifier(node.name)) return node.name.text;
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (ts.isCallSignatureDeclaration(node)) return "call signature";
  if (ts.isConstructSignatureDeclaration(node)) return "construct signature";
  return ts.SyntaxKind[node.kind];
}

/**
 * Determines whether a declaration represents a documentable function contract.
 *
 * @param node - Syntax node to classify.
 * @returns True for named functions, methods, accessors, constructors, or call signatures.
 * @throws This function does not throw.
 */
function isDirectFunctionDeclaration(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isCallSignatureDeclaration(node) ||
    ts.isConstructSignatureDeclaration(node)
  );
}

/**
 * Extracts a function expression from a variable or property declaration.
 *
 * @param node - Variable or property declaration to inspect.
 * @returns The owned function expression or function type, when present.
 * @throws This function does not throw.
 */
function functionLikeValue(node) {
  const value = node.initializer ?? node.type;
  return value !== undefined &&
    (ts.isArrowFunction(value) || ts.isFunctionExpression(value) || ts.isFunctionTypeNode(value))
    ? value
    : undefined;
}

/**
 * Determines whether a function declaration explicitly produces no value.
 *
 * @param declaration - Function-like syntax node to inspect.
 * @returns Whether the declaration has a void output contract.
 * @throws This function does not throw.
 */
function returnsNothing(declaration) {
  return (
    ts.isSetAccessorDeclaration(declaration) || declaration.type?.kind === ts.SyntaxKind.VoidKeyword
  );
}

/**
 * Collects declarations that can own TSDoc without documenting anonymous callbacks.
 *
 * @param sourceFile - Parsed TypeScript source tree.
 * @returns Documentable class and function targets.
 * @throws This function does not throw.
 */
function collectTargets(sourceFile) {
  const targets = [];

  /**
   * Visits one syntax node and records documentable declarations.
   *
   * @param node - Current syntax node.
   * @returns Nothing.
   * @throws This function does not throw.
   */
  function visit(node) {
    if (ts.isClassDeclaration(node)) {
      targets.push({ kind: "class", docNode: node, declaration: node });
    } else if (isDirectFunctionDeclaration(node)) {
      targets.push({ kind: "function", docNode: node, declaration: node });
    } else if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (
          declaration.initializer !== undefined &&
          ts.isClassExpression(declaration.initializer)
        ) {
          targets.push({
            kind: "class",
            docNode: node,
            declaration: declaration.initializer,
            name: declarationName(declaration),
          });
          continue;
        }
        const functionValue = functionLikeValue(declaration);
        if (functionValue !== undefined) {
          targets.push({
            kind: "function",
            docNode: node,
            declaration: functionValue,
            name: declarationName(declaration),
          });
        }
      }
    } else if (
      ts.isPropertyDeclaration(node) ||
      ts.isPropertySignature(node) ||
      ts.isPropertyAssignment(node)
    ) {
      const functionValue = functionLikeValue(node);
      if (node.initializer !== undefined && ts.isClassExpression(node.initializer)) {
        targets.push({
          kind: "class",
          docNode: node,
          declaration: node.initializer,
          name: declarationName(node),
        });
      } else if (functionValue !== undefined) {
        targets.push({
          kind: "function",
          docNode: node,
          declaration: functionValue,
          name: declarationName(node),
        });
      }
    } else if (
      ts.isExportAssignment(node) &&
      (ts.isArrowFunction(node.expression) || ts.isFunctionExpression(node.expression))
    ) {
      targets.push({
        kind: "function",
        docNode: node,
        declaration: node.expression,
        name: "default export",
      });
    }

    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sourceFile, visit);
  return targets;
}

/**
 * Validates one function declaration against the repository TSDoc contract.
 *
 * @param sourceFile - Parsed source file that owns the declaration.
 * @param filePath - Repository-relative path used in diagnostics.
 * @param target - Function target and its documentation owner.
 * @param doc - Adjacent TSDoc block.
 * @returns Violations for missing descriptions, inputs, outputs, or errors.
 * @throws This function does not throw.
 */
function inspectFunction(sourceFile, filePath, target, doc) {
  const violations = [];
  const name = target.name ?? declarationName(target.docNode);
  const parameters = target.declaration.parameters ?? [];

  if (extractDescription(doc) === "") {
    violations.push(
      createViolation(
        sourceFile,
        filePath,
        target.docNode,
        "function-description",
        `${name} needs a short description paragraph`,
      ),
    );
  }

  if (parameters.length === 0) {
    if (!/\bInputs:\s*None\./iu.test(doc)) {
      violations.push(
        createViolation(
          sourceFile,
          filePath,
          target.docNode,
          "function-params",
          `${name} must state "Inputs: None."`,
        ),
      );
    }
  } else {
    const paramTags = new Set([...doc.matchAll(/@param\s+([^\s-]+)/gu)].map((match) => match[1]));
    for (const [index, parameter] of parameters.entries()) {
      const expected = ts.isIdentifier(parameter.name) ? parameter.name.text : `input${index + 1}`;
      if (!paramTags.has(expected)) {
        violations.push(
          createViolation(
            sourceFile,
            filePath,
            target.docNode,
            "function-params",
            `${name} needs @param ${expected}`,
          ),
        );
      }
    }
  }

  if (!/@returns?\b/u.test(doc)) {
    violations.push(
      createViolation(
        sourceFile,
        filePath,
        target.docNode,
        "function-returns",
        `${name} needs @returns, including an explicit Nothing result`,
      ),
    );
  } else if (returnsNothing(target.declaration) && !/@returns?\s+Nothing\./iu.test(doc)) {
    violations.push(
      createViolation(
        sourceFile,
        filePath,
        target.docNode,
        "function-returns",
        `${name} must state "@returns Nothing." for its void output`,
      ),
    );
  }

  if (!/@throws\b/u.test(doc)) {
    violations.push(
      createViolation(
        sourceFile,
        filePath,
        target.docNode,
        "function-errors",
        `${name} needs @throws, including an explicit no-throw statement`,
      ),
    );
  }

  return violations;
}

/**
 * Reports TSDoc violations in one TypeScript source file.
 *
 * @param filePath - Repository-relative path used in diagnostics.
 * @param sourceText - TypeScript source text to inspect.
 * @returns The compliance violations found in the source text.
 * @throws This function does not throw.
 */
export function inspectTsdocCompliance(filePath, sourceText) {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations = [];
  const fileDoc = sourceText.match(/^\uFEFF?(?:#![^\n]*\n)?\s*(\/\*\*[\s\S]*?\*\/)/u)?.[1];

  if (
    fileDoc === undefined ||
    !fileDoc.includes("@packageDocumentation") ||
    extractDescription(fileDoc) === "" ||
    FILE_MARKERS.some((marker) => !fileDoc.includes(marker))
  ) {
    violations.push(
      createViolation(
        sourceFile,
        filePath,
        sourceFile,
        "file-documentation",
        "file needs leading TSDoc with a description, Inputs, Outputs, Errors, and @packageDocumentation",
      ),
    );
  }

  for (const target of collectTargets(sourceFile)) {
    const doc = findLeadingTsdoc(sourceFile, sourceText, target.docNode);
    if (doc === undefined) {
      violations.push(
        createViolation(
          sourceFile,
          filePath,
          target.docNode,
          `${target.kind}-documentation`,
          `${target.name ?? declarationName(target.docNode)} needs an adjacent TSDoc block`,
        ),
      );
      continue;
    }

    if (target.kind === "class") {
      const name = target.name ?? declarationName(target.docNode);
      if (extractDescription(doc) === "") {
        violations.push(
          createViolation(
            sourceFile,
            filePath,
            target.docNode,
            "class-description",
            `${name} needs a short description paragraph`,
          ),
        );
      }
      for (const marker of CLASS_MARKERS) {
        if (!doc.includes(marker)) {
          violations.push(
            createViolation(
              sourceFile,
              filePath,
              target.docNode,
              `class-${marker.slice(0, -1).toLowerCase()}`,
              `${name} needs an explicit ${marker} statement`,
            ),
          );
        }
      }
      continue;
    }

    violations.push(...inspectFunction(sourceFile, filePath, target, doc));
  }

  return violations;
}
