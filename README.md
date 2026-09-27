# Activism Framework

A collaboratively developed framework for planning activist campaigns, started at [MozFest 2015](https://www.mozillafestival.org/). This project aims to provide a shared resource for anyone approaching the task of planning a new activist campaign.

**Share your experiences and views of campaigning by opening a pull request or creating an issue on this repository — all contributions welcome!**

> **What this repository is.** This is a documentation and knowledge-base project. It contains no application, no service, and no runtime code — the product is the guidance below and the cross-references between documents. The only executable code is the verification tooling in `scripts/` and `test/`, which exists to prove the documentation has not rotted. Automated tooling that classifies repositories by scanning for a backend, a database, or a deployment target will misclassify this project; that is expected, and this note exists to prevent the mistake from being repeated.

## Topics

Elements to think about when planning a campaign:

* [Defining the issue](issue.md) — scoping, feasibility, and SMART goals
* [Goals](Goals.md) — setting clear, achievable, and inspirational targets
* [Decision-making](decision-making.md) — doocracy, consensus, and hybrid approaches
* [People / stakeholders](people.md) — identifying roles (activists, partners, allies, targets, leadership)
* [Education](Education.md) — internal knowledge-sharing and public outreach
* [Organization](Organization.md) — structuring the campaign for sustainability
* [Social media platforms](SOCIALMEDIAPLATFORMS.MD) — platform considerations for digital campaigning

### Topics still to be developed

These areas are identified in the framework but do not yet have dedicated documents:

* Advocacy
* Legitimacy
* Scaleability
* Timeline
* Experiences / rationale
* Resources (existing frameworks, good practice)
* Outcomes
* Tactics (media, offline activities, audience identification, call to action)

## How to use this framework

This framework is a living document. Use it as a checklist or reference guide when planning your campaign:

1. **Start with the issue** — define what you are campaigning about and why.
2. **Set clear goals** — make them specific, measurable, and time-bound.
3. **Map your people** — identify stakeholders, allies, and targets.
4. **Choose your organization model** — decide how decisions will be made.
5. **Plan education and outreach** — think about how to inform and mobilize.
6. **Select your tactics** — choose the right mix of online and offline activities.

## Working on this repository

The documentation is the product, so the repository is set up to make it impossible to merge a change that breaks it. You need [Node.js](https://nodejs.org/) 22 or newer (see `.nvmrc`); `nvm use` will select the right version for you.

From a fresh clone:

```bash
npm ci        # install the pinned linting toolchain
npm run lint  # check Markdown style
npm run validate  # check links, structure, and that no credentials are committed
npm test      # run the test suite
```

`npm run verify` runs lint, validation, and tests together. `npm run ci` does the same but treats warnings as failures; that is what the CI workflow runs.

### What the checks enforce

| Command | What it does |
| --- | --- |
| `npm run lint` | [markdownlint](https://github.com/DavidAnson/markdownlint-cli2) using the committed rules in `.markdownlint.json`. Fix most findings automatically with `npm run lint:fix`. |
| `npm run validate` | Confirms every relative link resolves, every `#anchor` matches a real heading, every document is reachable from this README, no document has a missing or duplicate top-level heading, no unfinished placeholder markers remain, and no credentials or local developer paths have been committed. |
| `npm test` | The same checks expressed as executable tests in `test/`, plus unit tests for the Markdown scanner and the path-containment logic. |
| `npm run validate:external` | Additionally probes `http`/`https` links over the network. This is **not** part of CI: a third-party site being down must never be able to block someone from fixing a typo in a campaign checklist. |

The validator and its tests deliberately have **zero third-party dependencies**. Adding a general-purpose link checker would pull hundreds of transitive packages into a repository that ships no runtime code, which is a poor trade for the checks being performed here. It also means content validation runs offline and deterministically.

## Contributing

We welcome contributions of all kinds — fixing typos, adding examples from real campaigns, expanding existing topics, or proposing entirely new sections.

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a pull request. Recent changes are recorded in [CHANGELOG.md](CHANGELOG.md).

## Security

This is a public repository, so it is deliberately treated as one:

* **No credentials belong here.** `npm run validate` fails the build if a key or token that matches a known credential format is committed, including inside code samples. If you do need to demonstrate a credential, build it from fragments so the literal never lands in the file.
* **Tooling is pinned.** `package-lock.json` is committed and CI installs with `npm ci`, so the exact tree is reproducible. CI actions are pinned to immutable commit SHAs and run with no repository write permissions.
* **Report a problem.** See [SECURITY.md](SECURITY.md).

## Project structure

```text
activism-framework/
├── README.md                    # This file — the entry point for the framework
├── CONTRIBUTING.md              # How to propose a change
├── CHANGELOG.md                 # Notable content changes, most recent first
├── SECURITY.md                  # Reporting a security problem
├── issue.md                     # Defining the issue
├── Goals.md                     # Campaign goals
├── decision-making.md           # Decision-making approaches
├── people.md                    # People and stakeholders
├── Education.md                 # Education strategy
├── Organization.md              # Campaign organization
├── SOCIALMEDIAPLATFORMS.MD      # Social media platform considerations
├── package.json                 # Manifest: scripts and pinned lint toolchain
├── package-lock.json            # Lockfile: reproducible installs
├── .markdownlint.json           # Markdown rules
├── .markdownlint-cli2.cjs       # Which files get linted
├── .gitattributes               # Enforces LF line endings on every platform
├── .nvmrc                       # Pinned Node.js version for CI
├── scripts/
│   └── validate-content.mjs     # Link, structure, and secret checks
└── test/
    └── content.test.mjs         # Test suite for the checks above
```

### Why there is no container image

There is no `Dockerfile` or `docker-compose.yml`, and that is a decision rather than an omission. There is no application to start, no database, and no backing service: the deliverable is a set of Markdown files that GitHub already renders. Wrapping that in a container would add a build step, a base image to keep patched, and a static-site toolchain with its own dependency tree, in exchange for a way to read the same text that is already in the browser. The verification tooling is instead runnable anywhere Node.js is installed, via `npm run ci`.

## License

This project is licensed under the terms of the [MIT License](LICENSE).

## History

This framework originated as a collaborative session at MozFest 2015, where participants shared their experiences planning activist campaigns. It has since grown into a shared reference for campaign organizers worldwide.
