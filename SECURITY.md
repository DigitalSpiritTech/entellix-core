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

Until the first public release, only the current `main` branch is eligible for
security fixes. After release, the latest stable version and any explicitly
listed supported release line receive fixes. Canary versions are for validation
and do not carry a stability or support commitment.

## Release controls

Public releases require production dependency audit, secret review, compiled
package-content verification, legal preflight, and provenance-producing CI.
Credentials and customer data must never be committed or included in release
artifacts.
