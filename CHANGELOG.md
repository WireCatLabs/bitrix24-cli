# Changelog

Notable changes to `@wirecat/bitrix24-cli`. One section per version, newest first.

## Unreleased

### Added

- Started from `@wirecat/cli-template` 0.14.0.
- The client for Bitrix24's REST API over an incoming webhook: REST 3.0 for deals, leads, contacts and companies,
  REST 2 for the rest; the portal's rate limits paced and waited out; a write repeated only with an
  `Idempotency-Key`; the webhook's secret kept out of every error and run record.
- `session start | status | end` per profile and `session list`: the webhook address read hidden or from stdin,
  checked against the portal, kept in the keyring under `bitrix24-cli`; `session status --check` says whose rights
  the webhook carries.
