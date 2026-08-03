#!/usr/bin/env node
/**
 * Does this repo's copy of the agreement versions still match the marketing site?
 *
 * WHY THIS IS NOT A UNIT TEST
 *
 * Both repos write consent decisions into the same `consent_events` table
 * through the same `set_consent()` function, and each sends its own copy of the
 * document version. If www bumps `marketing_emails` to a new version and this
 * repo does not, the audit log ends up holding two different answers to "which
 * wording did they agree to" — and a contradiction proves we did not know, which
 * is the one thing the version field exists to prevent.
 *
 * A unit test inside this repo cannot detect that, because it can only compare
 * this repo to itself. The previous attempt did exactly that and would have
 * passed through any real drift. So the check has to reach the other repo, which
 * makes it a CI job rather than a test.
 *
 * WHEN IT CANNOT LOOK
 *
 * Both repos are private, and a workflow's default GITHUB_TOKEN is scoped to its
 * own repository. Without a token that can read `batch-label` this script cannot
 * do its job — and it says so, loudly, instead of exiting green. An unchecked
 * invariant reported as unchecked is honest; one reported as passing is how the
 * drift gets in.
 */

const SOURCE_REPO = 'Orchestrate-management/batch-label';
const SOURCE_PATH = 'src/lib/agreements.ts';
const SOURCE_REF = process.env.WWW_REF || 'main';

/** The consents this repo can write. Terms are not withdrawable and not sent. */
const MIRRORED = ['MARKETING_EMAIL_AGREEMENT', 'ADVERTISING_AGREEMENT'];

const token = process.env.WWW_REPO_TOKEN || process.env.GH_TOKEN;

function annotate(level, message) {
  // GitHub Actions turns these into inline annotations; elsewhere they are just
  // readable lines.
  if (process.env.GITHUB_ACTIONS) console.log(`::${level}::${message}`);
  else console.log(`${level.toUpperCase()}: ${message}`);
}

/**
 * Pulls `version: '…'` out of an exported Agreement literal.
 *
 * A regex rather than a parse because the target is one well-known shape in a
 * file this project controls, and adding a TypeScript parser to CI to read two
 * string literals would cost more than it protects.
 */
function readVersions(source) {
  const found = {};
  for (const name of MIRRORED) {
    const block = source.match(
      new RegExp(`export const ${name}\\s*:\\s*Agreement\\s*=\\s*\\{([\\s\\S]*?)\\}`)
    );
    if (!block) continue;
    const version = block[1].match(/version:\s*['"]([^'"]+)['"]/);
    const id = block[1].match(/id:\s*['"]([^'"]+)['"]/);
    if (version) found[name] = { version: version[1], id: id ? id[1] : null };
  }
  return found;
}

async function main() {
  const localSource = await import('node:fs/promises').then((fs) =>
  fs.readFile(new URL('../src/lib/agreements.ts', import.meta.url), 'utf8')
  );
  const local = readVersions(localSource);

  const missingLocally = MIRRORED.filter((name) => !local[name]);
  if (missingLocally.length > 0) {
    annotate('error', `Could not read ${missingLocally.join(', ')} from this repo's agreements.ts.`);
    process.exit(1);
  }

  if (!token) {
    annotate(
      'warning',
      'Agreement versions NOT CHECKED against www: no WWW_REPO_TOKEN. ' +
      'Both repos are private, so the default GITHUB_TOKEN cannot read batch-label. ' +
      'Set a fine-grained token with Contents:read on Orchestrate-management/batch-label ' +
      'as the WWW_REPO_TOKEN secret to switch this on. See docs/INTEGRATION.md.'
    );
    console.log('\nThis repo currently claims:');
    for (const name of MIRRORED) console.log(`  ${name}: ${local[name].version}`);
    // Not a failure: the founder has to create the secret, and a repo that
    // cannot build until they do helps nobody. The warning is the product.
    return;
  }

  const url = `https://api.github.com/repos/${SOURCE_REPO}/contents/${SOURCE_PATH}?ref=${SOURCE_REF}`;
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github.raw',
      'user-agent': 'batchlabel-agreement-version-check'
    }
  });

  if (!response.ok) {
    annotate(
      'error',
      `Could not read ${SOURCE_PATH} from ${SOURCE_REPO}@${SOURCE_REF}: ` +
      `${response.status} ${response.statusText}. The token may lack Contents:read.`
    );
    process.exit(1);
  }

  const remote = readVersions(await response.text());

  const problems = [];
  for (const name of MIRRORED) {
    if (!remote[name]) {
      problems.push(`${name} is missing from ${SOURCE_REPO}. Was it renamed?`);
      continue;
    }
    if (remote[name].version !== local[name].version) {
      problems.push(
        `${name}: www says "${remote[name].version}", this repo says "${local[name].version}". ` +
        'Both write into the same consent_events table, so one of them is recording the wrong ' +
        'wording against real people. Update src/lib/agreements.ts here.'
      );
    }
    if (remote[name].id && remote[name].id !== local[name].id) {
      problems.push(
        `${name}: consent id differs — www "${remote[name].id}", here "${local[name].id}". ` +
        'set_consent whitelists the id, so a mismatch means the write fails outright.'
      );
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) annotate('error', problem);
    process.exit(1);
  }

  console.log(`Agreement versions match ${SOURCE_REPO}@${SOURCE_REF}:`);
  for (const name of MIRRORED) console.log(`  ${name}: ${local[name].version}`);
}

main().catch((error) => {
  annotate('error', `Agreement version check failed: ${error.message}`);
  process.exit(1);
});
