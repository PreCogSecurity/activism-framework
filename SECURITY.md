# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

This repository is public documentation with no runtime service, so the realistic
risks are limited but not zero: a credential committed by accident, a malicious
or defamatory change to campaign guidance, or content that could expose the
identity or safety of a person named in the framework.

Report anything you find by using GitHub's private reporting form:
[Report a vulnerability](https://github.com/PreCogSecurity/activism-framework/security/advisories/new)

Please include the file, what you observed, and how a reader could be harmed. You
can expect an acknowledgement within seven days. Because there is no deployed
service, there is no user data at risk and remediation is normally a revert or a
documentation change.

## What is already protected

* **Committed credentials are blocked by CI.** `npm run validate` fails the build
  when a value matching a known credential format is committed, including inside
  code samples. Automated scanning on public forks is a second line of defence,
  but the pre-merge check is the one that matters.
* **CI runs with no write access.** Every job declares `contents: read`, and the
  GitHub token is not persisted into the checkout, so a compromised step cannot
  push changes.
* **Third-party actions are pinned.** CI references actions by immutable commit
  SHA rather than by a mutable tag, so the code that runs cannot be swapped out
  after review.
* **Installs are reproducible.** `package-lock.json` is committed and CI uses
  `npm ci`, which fails if the lockfile and `package.json` disagree.
* **Untrusted pull requests run untrusted.** CI uses `pull_request`, never
  `pull_request_target`, so a fork cannot execute code with base-branch
  privileges.

## Guidance for campaigners

* Do not commit real credentials, access tokens, private meeting notes, or the
  personal details of people who have not consented to being named.
* The [People / stakeholders](people.md) topic is about planning roles, not about
  recording who attended a meeting.
* If you need to show an example of a secret, build it from fragments in the
  example rather than pasting a literal value.

## Scope

In scope: this repository, its CI workflow, and the tooling in `scripts/` and
`test/`.

Out of scope: vulnerabilities in third-party packages. Report those to their
maintainers, and optionally open an issue here asking for a dependency bump.
