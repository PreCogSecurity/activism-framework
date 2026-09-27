# Contributing to Activism Framework

Thank you for your interest in contributing to this framework! This project is a collaborative resource for anyone planning activist campaigns, and we value contributions of all kinds.

## Ways to contribute

- **Add a new topic** — Propose a section for an area of campaign planning not yet covered.
- **Expand an existing topic** — Add detail, examples, or clarifications to current sections.
- **Share your experience** — Document what has worked (or not worked) in real campaigns.
- **Fix errors** — Correct typos, broken links, or outdated information.
- **Improve structure** — Suggest ways to make the framework easier to navigate and use.

## How to submit a change

1. **Fork** this repository.
2. **Create a branch** for your changes (`git checkout -b improve-goals-section`).
3. **Make your changes** following the guidelines below.
4. **Verify your changes** — see [Verifying your change](#verifying-your-change).
5. **Commit** with a clear message describing your change, and add an entry to
   [CHANGELOG.md](CHANGELOG.md).
6. **Open a pull request** against the `master` branch.

## Verifying your change

Every pull request runs the same checks that CI runs, so running them locally
first means you will not be asked to fix a red build. You need Node.js 22 or
newer; if you use `nvm`, run `nvm use` to pick up the pinned version.

From a fresh clone:

```bash
npm ci
npm run ci
```

`npm run ci` runs all three checks below and treats warnings as failures. During
iteration you will probably prefer `npm run verify`, which reports warnings
without failing.

| Command | What it checks |
| --- | --- |
| `npm run lint` | Markdown style, using the rules in `.markdownlint.json`. Most problems are fixed automatically by `npm run lint:fix`. |
| `npm run validate` | Broken links, `#anchors` that match no heading, documents not reachable from the README, missing or duplicate top-level headings, leftover placeholder markers, and committed credentials. |
| `npm test` | The checks above, expressed as tests, plus unit tests for the Markdown scanner and the path-containment logic. |

Two things worth knowing before you open a pull request:

- **Every document must be linked from `README.md`.** If you add a new topic
  document, add it to the Topics list, otherwise validation fails with a "not
  linked from README.md" error.
- **Links are checked case-sensitively.** `socialmediaplatforms.md` does not
  match `SOCIALMEDIAPLATFORMS.MD` on Linux, even though it resolves on macOS and
  Windows. Match the file name exactly.

If you have changed a link to an external site and want to confirm it is live,
run `npm run validate:external`. It is kept out of CI on purpose so that someone
else's outage cannot block your fix.

## Style guidelines

- Use **sentence case** for headings (e.g., `# Decision-making` not `#Decision-making`).
- Keep a **space after heading markers** (`#` not `#Heading`).
- Use **Markdown links** to cross-reference other documents in the repository.
- Do not end a heading with a full stop, comma, colon, or exclamation mark.
- Wrap code samples in fenced blocks and give the fence a language, so that
  linters and editors can read it.
- Write in clear, accessible language that is inclusive and welcoming.
- Use bullet points to break up long lists of ideas.
- Never commit a real credential, access token, or a person's private details.
  See [SECURITY.md](SECURITY.md).
- Use LF line endings. `.gitattributes` enforces this, so do not fight it.
- Keep each pull request focused on one topic. Mixed "typo fix + rewrite + new
  section" changes are hard to review, and reviewers are more likely to approve a
  small change than a large one.

## Code of conduct

Be respectful and constructive. This framework exists to help people organize for positive change. All contributions should reflect that goal.

## Questions?

If you are unsure about anything, open an issue to discuss your idea before investing time in a pull request. We are happy to help.
