import { execFileSync } from 'node:child_process';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  createSnapshotLock,
  gitCommitPattern,
  noticeFiles,
  readExport,
  snapshotFiles,
  validateLockedSnapshot,
} from '../src/snapshot.js';

function main() {
  const [checkout, commit, output] = process.argv.slice(2);
  if (process.argv.length !== 5 || !checkout || !commit || !gitCommitPattern.test(commit) || !output) {
    throw new Error('Usage: npm run import:snapshot -- <sproutsite-checkout> <full-git-commit> <new-data-directory>');
  }

  const root = resolve(checkout);
  const destination = resolve(output);
  const git = (...args: string[]) => execFileSync('git', ['--no-optional-locks', '-C', root, ...args]);

  if (git('rev-parse', 'HEAD').toString().trim() !== commit) {
    throw new Error('The Sproutsite checkout HEAD must match the requested full Git commit.');
  }
  if (git('status', '--porcelain', '--untracked-files=all').length > 0) {
    throw new Error('The Sproutsite source checkout must be clean.');
  }

  const manifest = JSON.parse(git('show', `${commit}:package.json`).toString('utf8'));
  const sproutsiteVersion = git('show', `${commit}:VERSION`).toString('utf8').trim();
  if (manifest.name !== 'sproutsite' || manifest.version !== sproutsiteVersion) {
    throw new Error('The source commit must contain the Sproutsite package and matching VERSION file.');
  }
  const repository = manifest.repository.url.replace(/\.git$/, '');
  const contents = readExport(join(root, 'artifacts', 'mcp'));
  for (const file of noticeFiles) {
    if (!contents[file].equals(git('show', `${commit}:${file}`))) {
      throw new Error(`Export file ${file} differs from the source Git commit.`);
    }
  }
  const lock = createSnapshotLock(contents, { repository, commit, sproutsiteVersion });

  mkdirSync(dirname(destination), { recursive: true });
  // Claim a new directory. An existing release is never replaced.
  mkdirSync(destination);
  try {
    const bundle = join(destination, 'snapshot');
    mkdirSync(bundle);
    for (const file of snapshotFiles) {
      writeFileSync(join(bundle, file), contents[file], { flag: 'wx' });
    }
    validateLockedSnapshot(readExport(bundle), lock);

    // A prepared directory becomes usable when its validated lock appears.
    const temporaryLock = join(destination, 'snapshot-lock.json.tmp');
    writeFileSync(temporaryLock, JSON.stringify(lock, null, 2) + '\n', { flag: 'wx' });
    renameSync(temporaryLock, join(destination, 'snapshot-lock.json'));
  } catch (error) {
    rmSync(destination, { recursive: true, force: true });
    throw error;
  }
  console.log(`Prepared Sproutsite ${sproutsiteVersion} from ${commit} at ${destination}`);
}

try {
  main();
} catch (error) {
  console.error(`import:snapshot: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
