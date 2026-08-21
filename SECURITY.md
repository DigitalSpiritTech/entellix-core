# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately through
[GitHub Security Advisories](https://github.com/DigitalSpiritTech/entellix-core/security/advisories/new).
Do not open a public issue for a vulnerability or include credentials, customer
data, exploit details, or private environment information in a public report.

Include the affected version or commit, the impacted surface, reproduction
steps, and the practical impact when possible. Maintainers will acknowledge the
report, assess severity and affected releases, and coordinate remediation and
disclosure with the reporter.

## Supported releases

Entellix Core is in early public beta. The latest published `0.x` release is the
supported line. Older `0.x` releases, prereleases, canaries, and the development
state on `main` do not carry a support commitment unless a security advisory
explicitly says otherwise.

Security fixes normally target the latest release and the next release from
`main`; maintainers may publish an exceptional backport when impact warrants it.
See [SUPPORT.md](SUPPORT.md) for compatibility and breaking-change policy.

## Release controls

Public releases require production dependency audit, secret review, compiled
package-content verification, legal preflight, and provenance-producing CI.
Credentials and customer data must never be committed or included in release
artifacts.

The first public packages (`0.1.0`) shipped through npm trusted publishing with
OIDC-generated provenance. Starting with `0.1.1`, the same release workflow also
builds, attests, uploads, and verifies the matching standalone archive. Stable
publishing does not use a long-lived npm token. The `0.1.2` public-beta baseline
proved the complete path from compiled npm entry points through the attested
standalone first-run flow; see the
[public-beta closeout record](ai/implementation/public-beta-0.1.2.md).
