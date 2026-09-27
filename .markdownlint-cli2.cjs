/**
 * Runner configuration for markdownlint-cli2.
 *
 * Rule configuration deliberately lives in `.markdownlint.json` so that the
 * rules are shared by markdownlint-cli, markdownlint-cli2, editor extensions,
 * and any future static-site tooling. This file only controls *what* is
 * linted and *how* failures are reported.
 *
 * @see https://github.com/DavidAnson/markdownlint-cli2
 */
"use strict";

module.exports = {
  // Only documentation is linted. Both cases are listed explicitly: the glob
  // is case-sensitive, and this repository contains one document with an
  // uppercase ".MD" extension that would otherwise silently escape linting.
  globs: ["**/*.md", "**/*.MD"],

  // node_modules is ignored by default; these are the project-specific extras.
  ignores: ["node_modules/**", ".git/**"],

  // Report every failure rather than stopping at the first file, so a single CI
  // run gives a contributor the complete list of things to fix.
  showFound: true,

  // Never rewrite files in CI; `--fix` is an explicit local action only.
  fix: false,
};
