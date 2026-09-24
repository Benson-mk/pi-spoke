import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
/** A missing birth identity stays unknown; a PID by itself cannot establish ownership later. */
export async function processIdentity(pid: number): Promise<{ pid: number; birth: string | null; group: number | null }> {
  try {
    const { stdout } = await exec('/bin/ps', ['-o', 'lstart=', '-o', 'pgid=', '-p', String(pid)], { timeout: 1500 });
    const match = stdout.trim().match(/^(.*?)\s+(\d+)$/);
    if (match && match[1] && Number.isSafeInteger(Number(match[2]))) return { pid, birth: match[1], group: Number(match[2]) };
  } catch { /* A short-lived process may have gone before inspection. */ }
  return { pid, birth: null, group: null };
}
