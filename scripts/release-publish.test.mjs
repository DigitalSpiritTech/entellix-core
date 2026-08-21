/**
 * @file Verifies the Changesets 3 publish-output adapter used by GitHub Actions.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { renderChangesetsActionTagLines } from "./release-publish.mjs";

test("renders Changesets 3 git-tag events for changesets/action v1", () => {
  const report = [
    {
      type: "git-tag",
      tag: "@entellix/contracts@0.1.3",
      packageName: "@entellix/contracts",
    },
    {
      type: "git-tag",
      tag: "@entellix/core@0.1.3",
      packageName: "@entellix/core",
    },
    {
      type: "git-tag",
      tag: "@entellix/instructions@0.1.3",
      packageName: "@entellix/instructions",
    },
    {
      type: "git-tag",
      tag: "@entellix/standalone@0.1.3",
      packageName: "@entellix/standalone",
    },
  ]
    .map(JSON.stringify)
    .join("\n");

  assert.equal(
    renderChangesetsActionTagLines(report),
    [
      "New tag: @entellix/contracts@0.1.3",
      "New tag: @entellix/core@0.1.3",
      "New tag: @entellix/instructions@0.1.3",
      "New tag: @entellix/standalone@0.1.3",
    ].join("\n"),
  );
});

test("deduplicates repeated Changesets git-tag events", () => {
  const event = JSON.stringify({
    type: "git-tag",
    tag: "@entellix/core@0.1.3",
    packageName: "@entellix/core",
  });

  assert.equal(
    renderChangesetsActionTagLines(`${event}\n${event}\n`),
    `New tag: @entellix/core@0.1.3`,
  );
});

test("rejects malformed Changesets git-tag events", () => {
  assert.throws(
    () =>
      renderChangesetsActionTagLines(
        JSON.stringify({
          type: "git-tag",
          tag: "@entellix/core@0.1.3",
          packageName: "@entellix/contracts",
        }),
      ),
    /does not match package/,
  );
});
