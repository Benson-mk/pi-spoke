import { platform } from 'node:os';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
if (platform() === 'linux') {
  mkdirSync('dist/sandbox/native', { recursive: true });
  execFileSync('/usr/bin/cc', ['-O2','-Wall','-Wextra','-Werror','-Wl,--build-id=none',
    'src/sandbox/native/deny-network.c','-o','dist/sandbox/native/deny-network'], { stdio: 'inherit' });
}
