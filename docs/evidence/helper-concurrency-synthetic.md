# Synthetic fixed-helper concurrency diagnosis

Run `npm run build`, then `node scripts/helper-concurrency-fixture.mjs` with the
qualified Node 24.15.0 runtime on the pinned macOS host. The fixture uses only
synthetic files in a disposable directory and the real fixed read/find/grep
helpers through the actual SRT Seatbelt launcher. It makes no provider call.
It executes three serial and three concurrent schedules, one read, one find,
and one grep per schedule. A concurrent iteration must contain two helper
lifetimes overlapping before the earliest settlement. The script has a
two-minute deadline and cancels active invocations before removing its fixture.

PASS means all 18 valid reads/finds/searches returned their literal expected
synthetic text, each launched and settled with trusted launcher/helper lifecycle
records, and each fixed-helper process group was absent at settlement. It also
requires a symlink to an out-of-root target to return `UNSAFE_PATH` and an
unqualified missing runtime to return `SANDBOX_UNAVAILABLE`. Those negative
cases preserve the actual sandbox requirement. A failure prints the exact
assertion and recorded process identity/stage evidence; uncertain cleanup is
reported without replaying work.

Observed on 2026-09-24, macOS Darwin 24.6.0 arm64, Node v24.15.0, SRT 0.0.76:
18/18 valid operations settled, 3/3 concurrent iterations overlapped, zero
uncertain helper outcomes. The negative categories were `UNSAFE_PATH` and
`SANDBOX_UNAVAILABLE`. The binary SHA-256 was
`cbd6ab1e5a359afe9ed93b33dc65b5cd7544d364ed284542878505671ae7f83e`;
the installed SRT compiler SHA-256 was
`e21d4fc6cc0f0c86c77e2de5cd09064895aee4ef3c308b4759979393b7d23fcb`;
the lockfile SHA-256 was
`27101405527f2152175bf4c3eb42d31d23527b7beb490372a01f5d05367ee16f`.
The script prints the full current toolchain identity and per-invocation
lifecycles on every run so drift or a later failure can be compared directly.

No valid-read failure reproduced under these bounded conditions. The historical
interruption's cause remains unresolved: this result neither proves that it
was a concurrency race nor rules out a different host, policy, schedule, or
setup path. The next useful evidence is the affected invocation's trusted
launcher/helper stage and process identity via `doctor --run`, alongside its
policy and qualification identities. Keep any uncertain cleanup under operator
inspection; do not replay that invocation automatically or relax the sandbox.

During this lifecycle implementation, a separate absent-PID fault injection
found a new regression: calling `child.kill('SIGTERM')` after a failed launcher
spawn signaled the calling process. A detached 20-second reproducer recorded
`SANDBOX_SETUP_FAILED` followed by the isolated child's SIGTERM in
`/private/tmp/ps-launch-failure.log`. Guarding termination by a valid child PID
made the same reproducer exit normally; the bounded isolated integration test
retains this check. This newly introduced and repaired fault does not explain
the earlier fixed-helper interruption report.
