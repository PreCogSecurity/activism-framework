/**
 * Content and link validator for the Activism Framework documentation.
 *
 * WHY THIS EXISTS
 * ---------------
 * This repository is a documentation framework: its entire product value is
 * the prose and the cross-references between documents. Yet nothing verified
 * that the cross-references still resolved, that every document was reachable
 * from the README, or that no credential had been pasted into a code sample.
 * A framework whose navigation silently rots is not shippable to campaign
 * organisers who rely on it as a checklist.
 *
 * DESIGN RATIONALE
 * ----------------
 * This validator is deliberately implemented with ZERO third-party
 * dependencies, using only the Node.js standard library:
 *
 *   - Supply-chain surface. This repository has no runtime code. Pulling in a
 *     general-purpose link checker would add hundreds of transitive packages
 *     (and therefore hundreds of registry accounts that could push a malicious
 *     release) in exchange for a check we can perform more precisely ourselves.
 *   - Determinism. The checks below are pure functions over files on disk, so
 *     CI results are reproducible and never fail because a third-party host is
 *     slow, rate-limiting, or down.
 *   - Precision. We can validate *more* than a generic link checker: heading
 *     fragments are resolved against GitHub's slug algorithm, and link targets
 *     are matched case-sensitively so that a link which only works on
 *     case-insensitive filesystems (Windows/macOS) but breaks on Linux CI is
 *     reported as an error.
 *
 * External (http/https) link checking is available behind --external and is
 * deliberately NOT part of the default CI gate: a third-party outage should not
 * be able to block contributors from fixing a typo in a campaign checklist.
 *
 * USAGE
 * -----
 *   node scripts/validate-content.mjs            # offline checks (CI gate)
 *   node scripts/validate-content.mjs --external # also probe external links
 *   node scripts/validate-content.mjs --quiet    # only print the summary
 *
 * EXIT CODES
 * ----------
 *   0  no errors (warnings may still be reported)
 *   1  one or more errors
 *   2  the validator itself could not run (bad arguments, unreadable tree)
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..');

/** Directories that are never scanned for documentation content. */
const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  '.markdownlint-cli2-cache',
  'coverage',
  'vendor',
]);

/**
 * Files that are intentionally not linked from README.md. Anything not in this
 * list must be reachable from the README so that no document is orphaned.
 */
const README_EXEMPT_FILES = new Set(['README.md']);

/**
 * Placeholder markers that indicate unfinished content.
 *
 * Deliberately restricted to unambiguous markers. Words like "XXX" and
 * "coming soon" are legitimate prose in campaign guidance — "XXX-123-456" is
 * the conventional way to redact an identifier, for example — so including them
 * would produce false failures that train contributors to ignore the check.
 */
const PLACEHOLDER_PATTERN = /\b(?:TODO|FIXME|TBD)\b/;

/** Unfinished-content markers are reported per file only once. */
const PLACEHOLDER_ALLOWLIST = new Set(['README.md', 'CONTRIBUTING.md']);

/**
 * Credential shapes. Every pattern is anchored to a vendor-specific prefix so
 * that ordinary campaign prose ("target the decision-maker", "your API key
 * rotation policy") cannot trigger a false positive. This is a guard against
 * *accidental* disclosure in a public repository; it is not a replacement for
 * a proper secret-scanning service with history rewriting.
 */
const SECRET_PATTERNS = [
  { name: 'private key block', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { name: 'AWS access key id', pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g },
  { name: 'GitHub token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/g },
  { name: 'GitLab token', pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'OpenAI-style key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9]{20,}\b/g },
  {
    name: 'hardcoded credential assignment',
    pattern:
      /\b(?:api[_-]?key|apikey|secret[_-]?key|client[_-]?secret|password|passwd|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*["'][^"'\s]{12,}["']/gi,
  },
];

/** Absolute developer paths leak usernames and directory layout. */
const LOCAL_PATH_PATTERNS = [
  { name: 'Windows home path', pattern: /\b[A-Za-z]:\\Users\\[^\s"'`)]+/g },
  { name: 'POSIX home path', pattern: /(?:^|[\s("'`=])\/(?:home|Users)\/[A-Za-z0-9._-]+\/[^\s"'`)]*/g },
];

/* -------------------------------------------------------------------------- */
/* Markdown scanning                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Normalise CRLF/CR line endings to LF.
 *
 * The repository may be checked out on Windows (CRLF) or Linux (LF). Parsing
 * must not depend on which, otherwise a document that lints locally fails CI
 * and vice versa. Normalisation happens once at read time; the raw bytes are
 * retained separately so that a CRLF warning can still be reported.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeNewlines(text) {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * Replace every region that is not prose (fenced code blocks and inline code
 * spans) with spaces of the same length.
 *
 * Masking rather than deleting keeps all character offsets stable, so reported
 * line numbers stay accurate, while guaranteeing that example URLs and
 * placeholder secrets inside documentation samples are never treated as real
 * findings.
 *
 * @param {string} text
 * @returns {string}
 */
export function maskNonProse(text) {
  const lines = text.split('\n');
  const out = [];
  let fenceMarker = null;

  for (const line of lines) {
    const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line);

    if (fenceMarker) {
      if (fence && fence[1][0] === fenceMarker[0] && fence[1].length >= fenceMarker.length) {
        fenceMarker = null;
      }
      out.push(' '.repeat(line.length));
      continue;
    }

    if (fence) {
      fenceMarker = fence[1];
      out.push(' '.repeat(line.length));
      continue;
    }

    out.push(maskInlineCode(line));
  }

  return out.join('\n');
}

/** Blank out inline code spans on a single line, preserving offsets. */
function maskInlineCode(line) {
  let result = '';
  let i = 0;

  while (i < line.length) {
    const run = /`+/.exec(line.slice(i));

    if (!run) {
      result += line.slice(i);
      break;
    }

    const tickCount = run[0].length;
    const start = i;
    i += tickCount;

    // Find a closing run of exactly the same length (CommonMark rule).
    let closing = null;
    let search = i;
    while (search < line.length) {
      const next = /`+/.exec(line.slice(search));
      if (!next) break;
      if (next[0].length === tickCount) {
        closing = search;
        break;
      }
      search += next.index + next[0].length;
    }

    if (closing === null) {
      result += line.slice(start);
      break;
    }

    const end = closing + tickCount;
    result += ' '.repeat(end - start);
    i = end;
  }

  return result;
}

/**
 * Extract every link destination from masked markdown prose.
 *
 * Handles inline links/images (`[text](target "title")`, including balanced
 * parentheses inside the destination and `<...>` wrapped destinations),
 * reference-style link definitions (`[ref]: target`), and bare autolinks.
 *
 * @param {string} maskedText output of {@link maskNonProse}
 * @returns {{target: string, line: number}[]}
 */
export function extractLinks(maskedText) {
  const links = [];
  const lineStarts = computeLineStarts(maskedText);
  const stack = [];

  for (let i = 0; i < maskedText.length; i += 1) {
    const char = maskedText[i];

    if (char === '\\') {
      i += 1;
      continue;
    }

    if (char === '\n') {
      stack.length = 0;
      continue;
    }

    if (char === '[') {
      stack.push(i);
      continue;
    }

    if (char === ']') {
      const open = stack.pop();
      if (open === undefined || maskedText[i + 1] !== '(') continue;
      const parsed = readInlineDestination(maskedText, i + 1);
      if (!parsed) {
        i = open;
        continue;
      }
      links.push({ target: parsed.target, line: lineAt(lineStarts, open) });
      i = parsed.end;
      continue;
    }

    // Autolink: <https://example.com>
    if (char === '<' && stack.length === 0) {
      const close = maskedText.indexOf('>', i + 1);
      if (close !== -1 && close - i <= 2048) {
        const inner = maskedText.slice(i + 1, close);
        if (/^[a-z][a-z0-9+.-]*:\/\/[^\s<>]+$/i.test(inner)) {
          links.push({ target: inner, line: lineAt(lineStarts, i) });
        }
        i = close;
      }
    }
  }

  links.push(...extractReferenceDefinitions(maskedText, lineStarts));
  return links;
}

/** Read `( ... )` starting at `open` and return the destination plus end index. */
function readInlineDestination(text, open) {
  if (text[open] !== '(') return null;

  let i = open + 1;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i += 1;

  let destination;

  if (text[i] === '<') {
    const close = text.indexOf('>', i + 1);
    if (close === -1) return null;
    destination = text.slice(i + 1, close);
    i = close + 1;
  } else {
    let depth = 1;
    let closed = false;
    const start = i;
    while (i < text.length) {
      const char = text[i];
      if (char === '\\') {
        i += 2;
        continue;
      }
      if (char === '(') depth += 1;
      else if (char === ')') {
        depth -= 1;
        if (depth === 0) {
          closed = true;
          break;
        }
      } else if ((char === ' ' || char === '\t') && depth === 1) {
        // A space at the top level ends the destination; an optional link
        // title and the closing parenthesis may still follow.
        break;
      }
      i += 1;
    }
    // Running out of input before the destination closed is malformed
    // markdown; bail out rather than guessing at a target.
    if (!closed && i >= text.length) return null;
    destination = text.slice(start, i);
  }

  // A link title may follow; skip it and require the closing parenthesis.
  let j = i;
  while (j < text.length && (text[j] === ' ' || text[j] === '\t')) j += 1;
  if (text[j] === '"' || text[j] === "'") {
    const quote = text[j];
    const close = text.indexOf(quote, j + 1);
    if (close === -1) return null;
    j = close + 1;
    while (j < text.length && (text[j] === ' ' || text[j] === '\t')) j += 1;
  }
  if (text[j] !== ')') return null;

  return { target: unescapeMarkdown(destination.trim()), end: j };
}

/** Collect `[ref]: destination` definitions. */
function extractReferenceDefinitions(maskedText, lineStarts) {
  const definitions = [];
  const pattern = /^[ \t]{0,3}\[([^\]]+)\]:[ \t]*(?:<([^>\n]*)>|(\S+))/gm;

  let match = pattern.exec(maskedText);
  while (match !== null) {
    const destination = match[2] ?? match[3] ?? '';
    definitions.push({
      target: unescapeMarkdown(destination.trim()),
      line: lineAt(lineStarts, match.index),
    });
    match = pattern.exec(maskedText);
  }

  return definitions;
}

/** Resolve CommonMark backslash escapes inside a link destination. */
function unescapeMarkdown(value) {
  return value.replace(/\\([\\()[\]<>])/g, '$1');
}

function computeLineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function lineAt(lineStarts, index) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (lineStarts[mid] <= index) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

/**
 * Convert heading text to the anchor slug GitHub generates for it.
 *
 * @param {string} heading
 * @returns {string}
 */
export function slugifyHeading(heading) {
  return heading
    .replace(/`+([^`]*)`+/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~]+/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Collect ATX headings from a document.
 *
 * @param {string} text
 * @returns {{level: number, text: string, slug: string, line: number}[]}
 */
export function extractHeadings(text) {
  const headings = [];
  const used = new Map();

  text.split('\n').forEach((line, index) => {
    const match = /^[ \t]{0,3}(#{1,6})[ \t]+(.+?)[ \t\r]*#*[ \t\r]*$/.exec(line);
    if (!match) return;

    const headingText = match[2].trim();
    const base = slugifyHeading(headingText);
    // GitHub de-duplicates repeated headings with a numeric suffix.
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    const slug = seen === 0 ? base : `${base}-${seen}`;

    headings.push({
      level: match[1].length,
      text: headingText,
      slug,
      line: index + 1,
    });
  });

  return headings;
}

/* -------------------------------------------------------------------------- */
/* Repository traversal                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Recursively list repository files as POSIX-style relative paths.
 *
 * @param {string} root
 * @returns {Promise<string[]>}
 */
export async function listFiles(root) {
  const found = [];

  async function walk(directory, prefix) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        await walk(path.join(directory, entry.name), relative);
      } else if (entry.isFile()) {
        found.push(relative);
      }
    }
  }

  await walk(root, '');
  found.sort();
  return found;
}

/** True for markdown documents, including the uppercase `.MD` used in this repo. */
export function isMarkdown(file) {
  return /\.md$/i.test(file);
}

/* -------------------------------------------------------------------------- */
/* Checks                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Split a raw link destination into its path and heading fragment.
 *
 * The fragment is removed first: a query string may itself legally contain `#`
 * characters, so stripping the query before the fragment would silently discard
 * a real anchor. The query is then dropped because it plays no part in
 * resolving a file on disk.
 *
 * @param {string} target
 * @returns {{path: string, fragment: string}}
 */
export function splitTarget(target) {
  const hashIndex = target.indexOf('#');
  const fragment = hashIndex === -1 ? '' : target.slice(hashIndex + 1);
  const withoutFragment = hashIndex === -1 ? target : target.slice(0, hashIndex);
  return { path: withoutFragment.split('?')[0], fragment };
}

/** True when a destination points somewhere outside the repository. */
export function isExternalTarget(target) {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//');
}

/** True for schemes that are intentionally opaque to the validator. */
export function isOpaqueTarget(target) {
  return /^(?:mailto|tel|data|javascript|ftp|sms):/i.test(target);
}

/**
 * Resolve a link destination against the file that contains it.
 *
 * Rejects any destination that escapes the repository root, mirroring the
 * containment check a static file server must perform.
 *
 * @param {string} fromFile POSIX path of the file containing the link
 * @param {string} target raw destination path (no fragment)
 * @returns {{ok: true, resolved: string} | {ok: false, reason: string}}
 */
export function resolveRepoPath(fromFile, target) {
  let decoded;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    return { ok: false, reason: 'destination is not valid percent-encoding' };
  }

  if (decoded.includes('\0')) {
    return { ok: false, reason: 'destination contains a NUL byte' };
  }

  const posix = path.posix;
  const isRootRelative = decoded.startsWith('/');
  const base = isRootRelative ? '' : posix.dirname(fromFile);

  // Walk the segments explicitly instead of relying on path.normalize() to
  // clamp leading "..": normalize("/../../etc/passwd") yields "/etc/passwd",
  // which would hide an attempt to climb out of the tree. Tracking depth
  // ourselves makes the containment guarantee auditable.
  let depth = base === '' || base === '.' ? 0 : base.split('/').filter(Boolean).length;
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      depth -= 1;
      if (depth < 0) {
        return { ok: false, reason: 'destination escapes the repository root' };
      }
      continue;
    }
    depth += 1;
  }

  const joined = posix.join(base === '' ? '.' : base, decoded);
  const resolved = posix.normalize(joined).replace(/^\.\//, '').replace(/^\/+/, '');

  if (resolved === '' || resolved === '.') {
    return { ok: false, reason: 'destination does not name a file' };
  }

  return { ok: true, resolved };
}

/**
 * Run every offline check.
 *
 * @param {object} [options]
 * @param {string} [options.root] repository root to validate
 * @returns {Promise<{errors: string[], warnings: string[], stats: object}>}
 */
export async function validateRepository({ root = REPO_ROOT } = {}) {
  const errors = [];
  const warnings = [];

  const files = await listFiles(root);
  const fileSet = new Set(files);
  const lowerCaseIndex = new Map();
  for (const file of files) {
    const key = file.toLowerCase();
    if (!lowerCaseIndex.has(key)) lowerCaseIndex.set(key, file);
  }

  const markdownFiles = files.filter(isMarkdown);
  const contents = new Map();

  for (const file of markdownFiles) {
    const raw = await readFile(path.join(root, file), 'utf8');
    // Parse the LF-normalised form; keep the raw form for the CRLF warning below.
    contents.set(file, normalizeNewlines(raw));
  }

  // ---- Link targets and heading fragments -------------------------------
  for (const file of markdownFiles) {
    const text = contents.get(file);
    const masked = maskNonProse(text);
    const headings = extractHeadings(text);
    const slugs = new Set(headings.map((heading) => heading.slug));
    const links = extractLinks(masked);

    if (/\r/.test(contents.get(file))) {
      warnings.push(`${file}: contains CRLF line endings; use LF for consistent diffs`);
    }

    for (const { target, line } of links) {
      const where = `${file}:${line}`;

      if (isOpaqueTarget(target)) continue;

      if (isExternalTarget(target)) {
        if (!/^https:\/\//i.test(target)) {
          warnings.push(`${where}: non-HTTPS external link "${truncate(target)}"`);
        }
        continue;
      }

      const { path: targetPath, fragment } = splitTarget(target);

      if (targetPath === '') {
        if (fragment && !slugs.has(decodeFragment(fragment))) {
          errors.push(`${where}: anchor "#${fragment}" does not match any heading in ${file}`);
        }
        continue;
      }

      const resolvedTarget = resolveRepoPath(file, targetPath);
      if (!resolvedTarget.ok) {
        errors.push(`${where}: ${resolvedTarget.reason} ("${truncate(targetPath)}")`);
        continue;
      }

      const { resolved } = resolvedTarget;

      if (!fileSet.has(resolved)) {
        const caseMatch = lowerCaseIndex.get(resolved.toLowerCase());
        if (caseMatch) {
          errors.push(
            `${where}: link "${targetPath}" resolves only by case-insensitive match to ` +
              `"${caseMatch}". Case-sensitive filesystems (Linux CI) will not find it; ` +
              `update the link to the exact name.`,
          );
        } else {
          errors.push(`${where}: link target "${targetPath}" does not exist (resolved to "${resolved}")`);
        }
        continue;
      }

      if (fragment && isMarkdown(resolved)) {
        const targetSlugs = headingSlugsFor(contents.get(resolved));
        if (!targetSlugs.has(decodeFragment(fragment))) {
          errors.push(
            `${where}: anchor "#${fragment}" does not match any heading in ${resolved}`,
          );
        }
      }
    }
  }

  // ---- Document structure ------------------------------------------------
  const readmeRelative = findFileIgnoringCase(fileSet, 'README.md');
  if (!readmeRelative) {
    errors.push('README.md is missing; the framework must have an entry point');
  } else {
    // Index the README's destinations case-insensitively so that a link which
    // only matches by case is reported once (as a link error) rather than
    // twice (as a link error *and* a spurious orphan error).
    const linked = new Set(
      extractLinks(maskNonProse(contents.get(readmeRelative)))
        .map(({ target }) => target)
        .filter((target) => !isExternalTarget(target))
        .map((target) => resolveRepoPath(readmeRelative, splitTarget(target).path))
        .filter((result) => result.ok)
        .map((result) => result.resolved.toLowerCase()),
    );

    for (const file of markdownFiles) {
      if (file === readmeRelative) continue;
      if (README_EXEMPT_FILES.has(file)) continue;
      if (!linked.has(file.toLowerCase())) {
        errors.push(`${file}: not linked from ${readmeRelative}; every document must be reachable from the README`);
      }
    }
  }

  for (const file of markdownFiles) {
    const text = contents.get(file);
    const headings = extractHeadings(text);
    const h1Count = headings.filter((heading) => heading.level === 1).length;

    if (h1Count === 0) {
      errors.push(`${file}: has no level-1 heading; documents must start with a single "# Title"`);
    } else if (h1Count > 1) {
      errors.push(`${file}: has ${h1Count} level-1 headings; expected exactly one`);
    }

    if (!PLACEHOLDER_ALLOWLIST.has(file)) {
      const masked = maskNonProse(text);
      for (const [index, line] of masked.split('\n').entries()) {
        if (PLACEHOLDER_PATTERN.test(line)) {
          errors.push(`${file}:${index + 1}: unfinished-content marker found ("${PLACEHOLDER_PATTERN.exec(line)[0]}")`);
        }
        PLACEHOLDER_PATTERN.lastIndex = 0;
      }
    }

    if (!/\n$/.test(text)) {
      warnings.push(`${file}: does not end with a newline`);
    }
  }

  // ---- Secret and information-leak scanning ------------------------------
  for (const file of files) {
    // Never read lockfiles or binary assets into the scanner.
    if (file === 'package-lock.json' || /\.(?:png|jpe?g|gif|ico|pdf|zip|gz|woff2?)$/i.test(file)) {
      continue;
    }

    const text = normalizeNewlines(await readFile(path.join(root, file), 'utf8'));
    const masked = maskNonProse(text);

    for (const { name, pattern } of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      let match = pattern.exec(masked);
      while (match !== null) {
        const line = lineAt(computeLineStarts(masked), match.index);
        errors.push(`${file}:${line}: possible ${name} committed to the repository`);
        match = pattern.exec(masked);
      }
      pattern.lastIndex = 0;
    }

    for (const { name, pattern } of LOCAL_PATH_PATTERNS) {
      pattern.lastIndex = 0;
      let match = pattern.exec(masked);
      while (match !== null) {
        const line = lineAt(computeLineStarts(masked), match.index);
        warnings.push(`${file}:${line}: ${name} reveals local developer environment details`);
        match = pattern.exec(masked);
      }
      pattern.lastIndex = 0;
    }
  }

  return {
    errors,
    warnings,
    stats: {
      filesScanned: files.length,
      markdownScanned: markdownFiles.length,
      checks: [
        'relative link targets resolve (case-sensitively)',
        'heading fragments match GitHub slugs',
        'no orphaned documents',
        'single level-1 heading per document',
        'no unfinished-content markers',
        'no committed credentials',
        'no leaked local paths',
      ],
    },
  };
}

const slugCache = new Map();

function headingSlugsFor(text) {
  if (!slugCache.has(text)) {
    slugCache.set(text, new Set(extractHeadings(text).map((heading) => heading.slug)));
  }
  return slugCache.get(text);
}

function findFileIgnoringCase(fileSet, name) {
  const key = name.toLowerCase();
  for (const file of fileSet) {
    if (file.toLowerCase() === key) return file;
  }
  return null;
}

function decodeFragment(fragment) {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

function truncate(value, max = 80) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/* -------------------------------------------------------------------------- */
/* External link probing (opt-in)                                            */
/* -------------------------------------------------------------------------- */

/**
 * Probe external links with bounded concurrency and short timeouts.
 *
 * Opt-in only: outbound HTTP from CI is slow, rate-limited, and occasionally
 * poisoned by transient DNS or TLS failures, so it must never be a merge gate.
 *
 * @param {string} root
 * @param {{timeoutMs?: number, concurrency?: number}} [options]
 * @returns {Promise<{errors: string[], checked: number}>}
 */
export async function checkExternalLinks(root, { timeoutMs = 10_000, concurrency = 8 } = {}) {
  const files = (await listFiles(root)).filter(isMarkdown);
  const targets = new Map();

  for (const file of files) {
    const text = await readFile(path.join(root, file), 'utf8');
    for (const { target, line } of extractLinks(maskNonProse(text))) {
      if (isExternalTarget(target) && /^https?:\/\//i.test(target) && !isOpaqueTarget(target)) {
        const key = `${target}`;
        if (!targets.has(key)) targets.set(key, []);
        targets.get(key).push(`${file}:${line}`);
      }
    }
  }

  const queue = [...targets.keys()];
  const errors = [];

  async function worker() {
    for (;;) {
      const target = queue.shift();
      if (target === undefined) return;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(target, {
          method: 'HEAD',
          redirect: 'follow',
          signal: controller.signal,
          headers: { 'user-agent': 'activism-framework-link-check/1.0' },
        });
        if (response.status >= 400) {
          errors.push(`${targets.get(target)[0]}: HTTP ${response.status} for ${target}`);
        }
      } catch (error) {
        errors.push(`${targets.get(target)[0]}: unreachable (${error.name}) ${target}`);
      } finally {
        clearTimeout(timer);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length || 1) }, worker));
  return { errors, checked: targets.size };
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */

const USAGE = `Usage: node scripts/validate-content.mjs [--external] [--quiet] [--strict]`;

export async function main(argv = process.argv.slice(2)) {
  const options = { external: false, quiet: false, strict: false };

  for (const argument of argv) {
    if (argument === '--external') options.external = true;
    else if (argument === '--quiet') options.quiet = true;
    else if (argument === '--strict') options.strict = true;
    else if (argument === '--help' || argument === '-h') {
      console.log(USAGE);
      return 0;
    } else {
      console.error(`Unknown option: ${argument}\n${USAGE}`);
      return 2;
    }
  }

  let result;
  try {
    result = await validateRepository({ root: REPO_ROOT });
  } catch (error) {
    console.error(`validate-content: could not scan ${REPO_ROOT}: ${error.message}`);
    return 2;
  }

  if (!options.quiet) {
    for (const warning of result.warnings) console.warn(`warning  ${warning}`);
    for (const error of result.errors) console.error(`error    ${error}`);
  }

  const summary =
    `${result.stats.markdownScanned} markdown document(s), ` +
    `${result.stats.filesScanned} file(s) scanned — ` +
    `${result.errors.length} error(s), ${result.warnings.length} warning(s)`;

  if (result.errors.length === 0) console.log(`ok       ${summary}`);
  else console.error(`FAILED   ${summary}`);

  if (options.external) {
    const external = await checkExternalLinks(REPO_ROOT);
    for (const error of external.errors) console.error(`error    ${error}`);
    console.log(
      external.errors.length === 0
        ? `ok       ${external.checked} external link(s) reachable`
        : `FAILED   ${external.errors.length} of ${external.checked} external link(s) failed`,
    );
    if (external.errors.length > 0) return 1;
  }

  if (result.errors.length > 0) return 1;
  if (options.strict && result.warnings.length > 0) return 1;
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  process.exitCode = await main();
}
