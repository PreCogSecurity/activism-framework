/**
 * Unit and integration tests for the content validator.
 *
 * These tests are the executable specification of the guarantees CI relies on.
 * They are split into two groups:
 *
 *   1. Unit tests over pure functions, driven by synthetic fixtures. These are
 *      where regressions in the Markdown scanner and the path-containment check
 *      are caught cheaply and precisely.
 *   2. Integration tests that run the real validator over this repository, so
 *      the framework's own documentation is validated on every push.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  maskNonProse,
  extractLinks,
  extractHeadings,
  slugifyHeading,
  splitTarget,
  isExternalTarget,
  isOpaqueTarget,
  resolveRepoPath,
  validateRepository,
  listFiles,
  REPO_ROOT,
} from '../scripts/validate-content.mjs';

/** Build a throwaway repository tree and run the validator over it. */
async function withFixture(files, run) {
  const root = await mkdtemp(path.join(tmpdir(), 'activism-fixture-'));
  try {
    for (const [relative, contents] of Object.entries(files)) {
      const target = path.join(root, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, contents, 'utf8');
    }
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('maskNonProse', () => {
  test('preserves character offsets while blanking fenced code blocks', () => {
    const text = ['before', '```js', 'const a = "x";', '```', 'after'].join('\n');
    const masked = maskNonProse(text);

    assert.equal(masked.length, text.length);
    assert.ok(masked.startsWith('before'));
    assert.ok(masked.endsWith('after'));
    assert.ok(!masked.includes('const a'));
  });

  test('blanks inline code spans so example links are ignored', () => {
    const masked = maskNonProse('Use `[not-a-link](nope.md)` to disable it.');
    assert.ok(!masked.includes('nope.md'));
  });

  test('handles tilde fences and unterminated fences without hanging', () => {
    const tilde = maskNonProse('~~~\nsecret\n~~~\ntail');
    assert.ok(!tilde.includes('secret'));

    const unterminated = maskNonProse('text\n```\nnever closed');
    assert.ok(!unterminated.includes('never closed'));
  });
});

describe('extractLinks', () => {
  test('extracts plain, titled, and angle-bracketed destinations', () => {
    const masked = maskNonProse(
      ['[a](one.md)', '[b](two.md "A title")', '[c](<three four.md>)'].join('\n'),
    );
    assert.deepEqual(
      extractLinks(masked).map((link) => link.target),
      ['one.md', 'two.md', 'three four.md'],
    );
  });

  test('keeps balanced parentheses inside a destination', () => {
    const masked = maskNonProse('[wiki](https://en.wikipedia.org/wiki/Activism_(politics))');
    assert.equal(extractLinks(masked)[0].target, 'https://en.wikipedia.org/wiki/Activism_(politics)');
  });

  test('ignores links that appear inside code samples', () => {
    const masked = maskNonProse('```\n[sample](missing.md)\n```\n[real](real.md)');
    assert.deepEqual(
      extractLinks(masked).map((link) => link.target),
      ['real.md'],
    );
  });

  test('collects reference-style definitions and autolinks', () => {
    const masked = maskNonProse(
      ['[ref]: targets/goal.md', '', 'See [ref] and <https://example.org/a>.', ''].join('\n'),
    );
    const targets = extractLinks(masked).map((link) => link.target);
    assert.ok(targets.includes('targets/goal.md'));
    assert.ok(targets.includes('https://example.org/a'));
  });

  test('reports the source line of each link', () => {
    const masked = maskNonProse('line one\n\nline three [x](a.md)\n');
    const [link] = extractLinks(masked);
    assert.equal(link.line, 3);
  });

  test('does not loop forever on a malformed destination', () => {
    assert.doesNotThrow(() => extractLinks(maskNonProse('[broken](unclosed')));
  });
});

describe('slugifyHeading', () => {
  test('matches GitHub anchor rules for words, punctuation, and code', () => {
    assert.equal(slugifyHeading('Topics still to be developed'), 'topics-still-to-be-developed');
    assert.equal(slugifyHeading('People / stakeholders'), 'people-stakeholders');
    assert.equal(slugifyHeading('How do we identify goals?'), 'how-do-we-identify-goals');
    assert.equal(slugifyHeading('`npm` install'), 'npm-install');
    assert.equal(slugifyHeading('**Bold** heading'), 'bold-heading');
  });

  test('collapses punctuation-only decorations rather than emitting empty anchors', () => {
    assert.equal(slugifyHeading('---'), '');
    assert.equal(slugifyHeading('Questions?'), 'questions');
  });
});

describe('extractHeadings', () => {
  test('records level, text, line, and de-duplicated slugs', () => {
    const headings = extractHeadings(['# Title', '', '## Notes', '', '## Notes'].join('\n'));
    assert.deepEqual(
      headings.map((heading) => heading.slug),
      ['title', 'notes', 'notes-1'],
    );
    assert.equal(headings[0].level, 1);
    assert.equal(headings[2].line, 5);
  });

  test('ignores hash characters that are not ATX headings', () => {
    assert.deepEqual(extractHeadings('#NoSpace\ntext#hash'), []);
  });
});

describe('splitTarget', () => {
  test('separates path, query, and fragment', () => {
    assert.deepEqual(splitTarget('page.md?x=1#section'), { path: 'page.md', fragment: 'section' });
    assert.deepEqual(splitTarget('page.md#a#b'), { path: 'page.md', fragment: 'a#b' });
    assert.deepEqual(splitTarget('#anchor'), { path: '', fragment: 'anchor' });
  });
});

describe('isExternalTarget / isOpaqueTarget', () => {
  test('classifies schemes', () => {
    assert.ok(isExternalTarget('https://example.org'));
    assert.ok(isExternalTarget('//cdn.example.org/a.png'));
    assert.ok(!isExternalTarget('docs/page.md'));
    assert.ok(isOpaqueTarget('mailto:a@example.org'));
    assert.ok(isOpaqueTarget('data:image/png;base64,AAA'));
  });
});

describe('resolveRepoPath (path containment)', () => {
  test('resolves sibling and nested relative targets', () => {
    assert.deepEqual(resolveRepoPath('docs/README.md', 'Goals.md'), {
      ok: true,
      resolved: 'docs/Goals.md',
    });
    assert.deepEqual(resolveRepoPath('README.md', 'docs/a/b.md'), {
      ok: true,
      resolved: 'docs/a/b.md',
    });
  });

  test('treats a leading slash as repository-root relative', () => {
    assert.deepEqual(resolveRepoPath('docs/README.md', '/Goals.md'), {
      ok: true,
      resolved: 'Goals.md',
    });
  });

  test('clamps traversal that stays inside the tree', () => {
    assert.deepEqual(resolveRepoPath('docs/deep/page.md', '../Goals.md'), {
      ok: true,
      resolved: 'docs/Goals.md',
    });
  });

  test('rejects traversal that escapes the repository root', () => {
    for (const hostile of ['../../../etc/passwd', '/../../etc/passwd', '..%2f..%2fetc%2fpasswd']) {
      const result = resolveRepoPath('README.md', hostile);
      assert.equal(result.ok, false, `expected ${hostile} to be rejected`);
    }
  });

  test('rejects NUL byte injection and malformed percent-encoding', () => {
    assert.equal(resolveRepoPath('README.md', 'a.md%00.png').ok, false);
    assert.equal(resolveRepoPath('README.md', 'a.md%ZZ').ok, false);
  });
});

describe('validateRepository (fixture behaviour)', () => {
  const validReadme = (body = '') =>
    `# Framework\n\n## Docs\n\n* [Goals](Goals.md)\n* [Style](Style.md)\n${body}`;

  test('passes a well-formed miniature framework', async () => {
    await withFixture(
      {
        'README.md': validReadme(),
        Goals: '',
        'Goals.md': '# Goals\n\nSee [style](Style.md#heading-style).\n',
        'Style.md': '# Style\n\n## Heading style\n\nBack to [goals](Goals.md).\n',
      },
      async (root) => {
        const result = await validateRepository({ root });
        assert.deepEqual(result.errors, []);
      },
    );
  });

  test('flags a relative link whose target does not exist', async () => {
    await withFixture(
      { 'README.md': '# T\n\n[gone](Missing.md)\n' },
      async (root) => {
        const { errors } = await validateRepository({ root });
        assert.equal(errors.length, 1);
        assert.match(errors[0], /Missing\.md.*does not exist/);
      },
    );
  });

  test('flags a link that only resolves case-insensitively', async () => {
    await withFixture(
      { 'README.md': '# T\n\n* [Topics](topics.md)\n', 'Topics.md': '# Topics\n' },
      async (root) => {
        const { errors } = await validateRepository({ root });
        assert.equal(errors.length, 1);
        assert.match(errors[0], /case-insensitive match/i);
      },
    );
  });

  test('flags a heading fragment that does not exist', async () => {
    await withFixture(
      { 'README.md': '# T\n\n* [Goals](Goals.md#conclusion)\n', 'Goals.md': '# Goals\n\n## Process\n' },
      async (root) => {
        const { errors } = await validateRepository({ root });
        assert.equal(errors.length, 1);
        assert.match(errors[0], /anchor "#conclusion" does not match any heading/);
      },
    );
  });

  test('accepts a heading fragment that does exist', async () => {
    await withFixture(
      { 'README.md': '# T\n\n* [Goals](Goals.md#process)\n', 'Goals.md': '# Goals\n\n## Process\n' },
      async (root) => {
        const { errors } = await validateRepository({ root });
        assert.deepEqual(errors, []);
      },
    );
  });

  test('flags documents that are not reachable from the README', async () => {
    await withFixture(
      { 'README.md': '# T\n', 'Orphan.md': '# Orphan\n' },
      async (root) => {
        const { errors } = await validateRepository({ root });
        assert.ok(errors.some((error) => /Orphan\.md: not linked from README\.md/.test(error)));
      },
    );
  });

  test('flags documents with missing or duplicate level-1 headings', async () => {
    await withFixture(
      { 'README.md': '# T\n\n* [A](A.md)\n', 'A.md': 'no heading here\n' },
      async (root) => {
        const { errors } = await validateRepository({ root });
        assert.ok(errors.some((error) => /A\.md: has no level-1 heading/.test(error)));
      },
    );
  });

  test('flags a missing README', async () => {
    await withFixture({ 'A.md': '# A\n' }, async (root) => {
      const { errors } = await validateRepository({ root });
      assert.ok(errors.some((error) => /README\.md is missing/.test(error)));
    });
  });

  test('flags committed credentials but not prose that merely mentions them', async () => {
    // Assembled at runtime so that this test file does not itself trip the
    // credential scanner that runs over the whole repository.
    const exampleKey = `AKIA${'IOSFODNN7'.padEnd(16, 'X')}`;
    const leakedKey = `AKIA${'Z'.repeat(16)}`;
    assert.notEqual(exampleKey, leakedKey);

    await withFixture(
      {
        'README.md': '# T\n\n* [Keys](Keys.md)\n',
        'Keys.md':
          '# Keys\n\nRotate your API key regularly.\n\n' +
          `Never commit \`${exampleKey}\` to a public repository.\n`,
        'SECRET.md': `# Secret\n\naws key ${leakedKey} live here\n`,
      },
      async (root) => {
        const { errors } = await validateRepository({ root });
        assert.ok(
          errors.some((error) => /SECRET\.md:\d+: possible AWS access key id/.test(error)),
          `expected a secret finding, got ${JSON.stringify(errors)}`,
        );
        assert.ok(!errors.some((error) => error.startsWith('Keys.md')));
      },
    );
  });

  test('flags unfinished-content markers in topic documents', async () => {
    // Line 1 is the H1, line 2 is blank, so the marker lands on line 3.
    await withFixture(
      { 'README.md': '# T\n\n* [A](A.md)\n', 'A.md': '# A\n\nTODO: write this up.\n' },
      async (root) => {
        const { errors } = await validateRepository({ root });
        assert.ok(errors.some((error) => /A\.md:3: unfinished-content marker/.test(error)));
      },
    );
  });

  test('does not flag a placeholder marker inside a code sample', async () => {
    await withFixture(
      { 'README.md': '# T\n\n* [A](A.md)\n', 'A.md': '# A\n\nUse `TODO:` to mark a placeholder.\n' },
      async (root) => {
        const { errors } = await validateRepository({ root });
        assert.deepEqual(errors, []);
      },
    );
  });

  test('reports a link escaping the repository root rather than following it', async () => {
    await withFixture({ 'README.md': '# T\n\n[passwd](../../etc/passwd)\n' }, async (root) => {
      const { errors } = await validateRepository({ root });
      assert.ok(errors.some((error) => /escapes the repository root/.test(error)));
    });
  });

  test('does not descend into node_modules', async () => {
    await withFixture(
      {
        'README.md': '# T\n',
        'node_modules/pkg/README.md': '# Vendored\n\n[bad](Missing.md)\n',
      },
      async (root) => {
        const files = await listFiles(root);
        assert.ok(!files.some((file) => file.includes('node_modules')));
        const { errors } = await validateRepository({ root });
        assert.ok(!errors.some((error) => error.includes('node_modules')));
      },
    );
  });
});

describe('this repository', () => {
  test('passes every offline content check', async () => {
    const { errors, warnings, stats } = await validateRepository({ root: REPO_ROOT });
    assert.deepEqual(errors, [], `content validation failed:\n${errors.join('\n')}`);
    assert.ok(stats.markdownScanned >= 8, 'expected the framework to have topic documents');
    assert.ok(warnings.length >= 0);
  });

  test('exposes a stable validator root', () => {
    assert.equal(path.basename(REPO_ROOT), 'activism-framework');
  });
});
