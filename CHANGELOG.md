# Changelog

All notable changes to this framework are recorded here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html); because the
framework is documentation, a **minor** bump means guidance was added or
clarified, and a **patch** bump means something was corrected.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

Nothing yet. Open a pull request and add your entry here.

## [0.1.0] — 2026-09-27

### Added

- Automated content and link validation (`scripts/validate-content.mjs`) with an
  executable test suite (`test/`). Every relative link, `#anchor`, and heading
  structure is now verified on every push, so the framework's navigation cannot
  silently rot.
- A committed credential scanner. Commits containing keys or tokens that match a
  known credential format now fail CI, which matters for a public repository that
  campaigners routinely paste real configuration into issues and pull requests.
- Cross-platform link checking: a link that only resolves because the developer's
  filesystem is case-insensitive is reported as an error, because it would break
  on Linux CI and on GitHub's renderer.
- `package.json` and `package-lock.json`, pinning the Markdown linting toolchain
  so CI is reproducible. Previously CI ran `npm install -g markdownlint-cli`,
  which resolved whatever the registry served at run time.
- Explicit Markdown lint configuration (`.markdownlint.json`) covering the
  previously-linted gap where `SOCIALMEDIAPLATFORMS.MD` was skipped by the
  case-sensitive file glob.
- `.gitattributes` enforcing LF line endings, so contributors on Windows no
  longer produce whole-file diffs.
- `SECURITY.md` describing how to report a security problem.
- A "Working on this repository" section in the README with the exact commands a
  contributor needs, and a statement of what kind of project this is so that
  automated tooling does not misclassify it.

### Changed

- CI now installs with `npm ci`, pins every action to an immutable commit SHA,
  grants jobs no repository write permission, and stops persisting the GitHub
  token into the checkout. Previously the workflow installed an unpinned global
  package and had broader default permissions.

## [0.0.1] — 2015

- Framework topics established collaboratively at MozFest 2015: the issue, goals,
  decision-making, people, education, organization, and social media platforms.

[Unreleased]: https://github.com/PreCogSecurity/activism-framework/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/PreCogSecurity/activism-framework/releases/tag/v0.1.0
[0.0.1]: https://github.com/PreCogSecurity/activism-framework/releases/tag/v0.0.1
