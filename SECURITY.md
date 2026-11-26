# Security Policy

## Supported Versions

Security fixes are applied to the latest state of `main` in both **Baryon** (Open Core) and **Baryon-Pro**.

| Branch / Release | Supported |
| --- | --- |
| `main` (latest) | Yes |
| Older snapshots | No |

## Reporting a Vulnerability

**Please do not open public GitHub issues for security vulnerabilities.**

Use GitHub **Private Vulnerability Reporting** on the **Security** tab of `razeenwasif/Baryon` to submit a confidential report. You will receive an acknowledgement as soon as possible with remediation status and disclosure coordination.

## Repository & Supply-Chain Hardening

- **GitHub Actions**: All workflow actions are pinned to immutable 40-character commit SHAs (`sha_pinning_required`), limited to GitHub-owned actions with read-only default `GITHUB_TOKEN` permissions (`permissions: {}` at top level), `persist-credentials: false`, and `--ignore-scripts` on `npm ci`.
- **External Pull Requests**: Fork pull requests from external contributors require explicit maintainer approval before running workflows; `pull_request_target` and `workflow_run` triggers are prohibited.
- **Branch Protection**: `main` rejects deletions and non-fast-forward force pushes and requires CODEOWNERS review for non-admin PRs.
- **Dependabot Cooldown**: Automated npm and GitHub Actions updates wait through a 7-day release cooldown before opening PRs to mitigate zero-day supply-chain worms.
- **Secrets & Desktop Credentials**: API keys are stored encrypted via macOS Keychain (`safeStorage`) on the Body host and are never shipped to renderer processes or committed to git (enforced by Secret Scanning + Push Protection).
