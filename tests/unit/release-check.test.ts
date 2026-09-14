import { execFileSync, spawnSync } from 'node:child_process';
import { test, expect } from 'vitest';

test('release check keeps Linux gates separate from macOS qualification and rejects unknown platforms', () => {
  const macos = JSON.parse(execFileSync(process.execPath, ['scripts/check-release.mjs', '--platform', 'darwin'], { encoding: 'utf8' }));
  expect(macos.platform).toBe('darwin');
  expect(macos.release_ready).toBe(true);
  const linux = spawnSync(process.execPath, ['scripts/check-release.mjs', '--platform', 'linux'], { encoding: 'utf8' });
  const report = JSON.parse(linux.stdout);
  expect(report.platform).toBe('linux');
  expect(linux.status).toBe(report.release_ready ? 0 : 1);
  expect(report.release_ready).toBe(report.remaining.length === 0);
  const native = spawnSync(process.execPath, ['scripts/check-release.mjs'], { encoding: 'utf8' });
  expect(JSON.parse(native.stdout).platform).toBe(process.platform);
  for (const args of [['--platform', 'win32'], ['--platform'], ['--unknown', 'linux']]) {
    expect(spawnSync(process.execPath, ['scripts/check-release.mjs', ...args]).status).not.toBe(0);
  }
});
