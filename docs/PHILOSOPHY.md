# pi-spoke — Philosophy

**Version 1.1 · 14 September 2026**

> **Thin policy, reliable runtime, autonomous agents.**

pi-spoke is a small delegation and communication layer between a main agent and independent Pi workers. It is a new implementation, not a wholesale fork of `howznguyen/pi-delegate-mcp`.

Its purpose is to make other agents accessible without deciding how the main agent must work.

## 1. Ownership, not a second planner

The main agent owns the objective, decomposition, delegation, model choice, capability selection, coordination, verification, and integration. Codex is the reference host, not a hard-coded model or a permanent product dependency in the protocol.

A worker owns its local method within the delegated objective and granted capabilities. It may investigate, question assumptions, ask for clarification, decline an irrelevant skill, and propose improvements. It does not acquire authority over other workers or the main agent merely by returning text.

The operator owns credentials, machine access, the maximum capability envelope, retention, and operational limits. The main agent cannot grant authority the operator has not provided.

## 2. Provide capabilities, not workflows

Expose discovery, independent sessions, observation, steering, continuation, cancellation, and worker-to-main communication. Do not implement task classifiers, role-to-model mappings, mandatory planning stages, reviewer pipelines, or automatic model substitution.

There is no obligation to delegate. The host can complete a task itself, use its native agents, or use pi-spoke.

## 3. Suggest expertise; do not prescribe behavior

The main agent may select a small set of candidate skills. The worker initially receives their metadata, not their complete instructions. It chooses whether to read or use any of them.

`suggested_skills` means an initial discovery shortlist. It does not mean a required checklist, and it is not a filesystem security boundary. A worker may request other expertise through the main agent.

Do not automatically import global skills, invoke `/skill:...`, or translate task keywords into skills. Do not rewrite third-party skills to conceal their behavior. An explicitly selected skill may itself contain prescriptive instructions; that is a property of that skill, not a guarantee that pi-spoke can neutralize it.

## 4. Fresh context, clear objective

New workers do not inherit the main conversation. The main agent supplies a self-contained task and necessary context. Explicit continuation preserves an existing worker session.

Fresh conversational context does not imply filesystem isolation. Working directory, project instructions, tool grants, and execution mode must be visible independently.

## 5. Wait on dependencies, not workers

Starting a worker must not block the host until the work completes. The main agent chooses when to observe or wait and whether to continue independent work.

A timeout while observing is not cancellation of the worker. A persisted session is not a promise that a process survives disconnection or reboot.

## 6. Workers provide evidence; the main agent owns the decision

Results, reviews, patches, and improvement proposals are inputs to the main agent's judgment. A completed run means the agent turn ended normally, not that the task is correct or accepted.

Do not automatically merge files, treat claims as verified facts, or force a second model to approve every result.

## 7. Communication through the main agent

Use a hub-and-spoke topology. Workers may report, ask questions, and propose improvements. The main agent coordinates and decides what to share with another worker.

Do not introduce peer-to-peer mailboxes, worker-to-worker authority, or nested delegation tools in the first release. A shell can still invoke an installed program, but that program must remain inside the same filesystem/network authority. Tool absence is not a complete behavioral guarantee.

## 8. Runtime correctness is not optional

The runtime owns stable identities, explicit state transitions, durable receipts, duplicate-request protection, bounded waits, cancellation, cleanup, resource accounting, and honest recovery.

No silent model fallback. No automatic replay after an ambiguous crash. No claim of exactly-once external side effects. A working directory, prompt, tool allowlist, and process boundary are not substitutes for the required OS tool sandbox.

### Authority is separate from tool availability

Granting `bash` grants sandboxed code execution, not an automatic right to modify project files. File-write roots for structured operations and shell-write roots are independent, empty by default, and limited by operator ceilings. Tool networking is denied in v0.1; provider inference is a separate trusted connection.

Reject unauthorized or unenforceable requests. Never silently broaden, partially clamp, retry outside the sandbox, or treat a worker/main-agent message as human approval. Protect configuration, credentials, metadata, and skills from worker mutation. Workers may propose changes to those resources, not silently install them.

Read-only shell source protection is not a promise of no data loss from authorized edits. State the actual boundary: the trusted runtime orchestrates OS-sandboxed tool processes, not an entirely sandboxed MCP/Pi control plane. [SAFETY_SPEC.md](SAFETY_SPEC.md) defines the enforceable contract and honest limitations.

These guarantees belong in code even when a model could describe them correctly.

## 9. Improvement is proposed, evaluated, and deliberately promoted

Workers may improve their current output and suggest reusable lessons. The main agent decides whether further review or a persistent change is warranted, within the user's authorization.

pi-spoke does not automatically modify skills, system prompts, `AGENTS.md`, routing rules, or model weights. A proposal is data, not an instruction to execute a change.

## 10. Small, explicit, replaceable boundaries

Keep transport, lifecycle, Pi integration, and resource selection separate. Use public upstream APIs. Pin dependencies and test the boundaries before upgrading.

Do not add a generic framework for hypothetical future runtimes. Do not maintain a fixed model-name list. Future models should require updated capabilities, not new workflow rules.

## The feature admission test

Ask three questions:

1. Does this expose a capability the agent otherwise cannot reach, or guarantee execution correctness that a prompt cannot guarantee?
2. Can it be implemented without choosing the agent's workflow?
3. Can its behavior be stated and tested without pretending that model judgment is deterministic?

If the first answer is no, it normally belongs in the main agent, an optional skill, or documentation—not the runtime.

**Thin does not mean unguarded. Autonomous does not mean unaccountable. Reliable does not mean prescriptive.**
