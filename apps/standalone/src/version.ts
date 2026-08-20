/**
 * Exposes standalone release version metadata.
 *
 * Inputs: The version recorded in the standalone package manifest.
 * Outputs: The release version used by runtime protocol metadata.
 * Errors: This module does not intentionally throw.
 *
 * @packageDocumentation
 */

import standaloneManifest from "../package.json" with { type: "json" };

/** Version of the standalone distribution currently being built or executed. */
export const STANDALONE_VERSION = standaloneManifest.version;
