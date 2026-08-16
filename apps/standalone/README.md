# Entellix Standalone

The single-workspace self-hosted Entellix distribution. It composes the public
memory engine with fixed local actor/workspace identity, bearer-token access,
plain PostgreSQL persistence, an automatic worker, review, retention, export,
and deletion operations.

Mastra transport/session state is stored durably in PostgreSQL under the
`entellix_mastra` schema. The distribution is licensed under Apache-2.0;
Entellix names and branding remain subject to the repository trademark policy.
