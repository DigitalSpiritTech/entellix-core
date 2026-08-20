# Entellix Core public beta `0.1.2` closeout

Status: Complete
Released: 2026-08-20
Release commit: `0284d114f490f25c315b362034d02b18c08b3a5f`

## Shipped outcome

The `0.1.2` release completed the public-beta readiness plan. Pull request
[#6](https://github.com/DigitalSpiritTech/entellix-core/pull/6) merged the
public-surface, standalone quickstart, clean-room verification, and governance
work. Pull request
[#7](https://github.com/DigitalSpiritTech/entellix-core/pull/7) merged the
generated version changes and produced all four release units from one commit.

| Release unit                   | Public location                                                                                                  | Provenance or attestation                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `@entellix/contracts@0.1.2`    | [npm](https://www.npmjs.com/package/@entellix/contracts/v/0.1.2)                                                 | [npm provenance](https://registry.npmjs.org/-/npm/v1/attestations/@entellix%2fcontracts@0.1.2)    |
| `@entellix/core@0.1.2`         | [npm](https://www.npmjs.com/package/@entellix/core/v/0.1.2)                                                      | [npm provenance](https://registry.npmjs.org/-/npm/v1/attestations/@entellix%2fcore@0.1.2)         |
| `@entellix/instructions@0.1.2` | [npm](https://www.npmjs.com/package/@entellix/instructions/v/0.1.2)                                              | [npm provenance](https://registry.npmjs.org/-/npm/v1/attestations/@entellix%2finstructions@0.1.2) |
| `@entellix/standalone@0.1.2`   | [GitHub release](https://github.com/DigitalSpiritTech/entellix-core/releases/tag/%40entellix/standalone%400.1.2) | GitHub artifact attestation on the release asset                                                  |

All four annotated tags resolve to the release commit. The published
`@entellix/core` manifest pins `@entellix/contracts` exactly to `0.1.2`; the
standalone archive contains the matching compiled workspace packages.

## Independent verification

The successful [release workflow](https://github.com/DigitalSpiritTech/entellix-core/actions/runs/32408261123)
published the npm packages, built the standalone archive, generated its
attestation, uploaded it, and verified the public asset. The corresponding
[checks workflow](https://github.com/DigitalSpiritTech/entellix-core/actions/runs/32408261297)
passed on the same release commit.

The public artifacts were independently rechecked on 2026-08-20:

- A disposable npm consumer installed the three exact registry versions and
  imported all 35 documented compiled entry points.
- npm reported SLSA provenance attestations for every public package.
- Every `0.1.2` GitHub tag has generated release notes describing its package or
  standalone changes and exact internal dependency updates.
- The downloaded `entellix-standalone-0.1.2.tgz` SHA-256 digest was
  `2d7e2cc8c4373f102e41a5eceeb07ee9975ac94e1177dbcefe4f8c7b1f8f9327`, matching
  the GitHub release asset metadata.
- `gh attestation verify` accepted the downloaded archive for
  `DigitalSpiritTech/entellix-core`.
- On macOS with Node 24.10.0, Docker 28.5.1, and a disposable PostgreSQL 16
  container, the public archive completed migration twice, startup, health,
  bearer-auth rejection and acceptance, MCP initialization and tool discovery,
  operator review/retention/export checks, and confirmed workspace deletion.
- The provider-backed release smoke also completed save, extraction,
  classification, review approval, canonical commit, and list retrieval with
  embeddings enabled. Credentials, provider responses, and database contents
  were not retained.

## Acceptance decision

- All public release units share `0.1.2` and one release commit.
- The public npm packages install independently and expose only documented
  compiled entry points.
- The standalone public asset completes the documented first-run path.
- npm provenance and the GitHub artifact attestation are independently visible.
- CI, high-severity dependency audit, secret, legal, package-content,
  documentation, and clean-room gates passed on the released commit.

The public beta is therefore shipped and proven. The temporary readiness plan
was retired after this record captured its durable outcome.
