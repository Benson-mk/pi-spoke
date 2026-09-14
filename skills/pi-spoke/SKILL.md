---
name: pi-spoke
description: Use pi-spoke MCP tools to delegate scoped tasks to independent Pi workers, coordinate active runs, or continue saved worker sessions. Applies when using pi-spoke as a main agent; developing the pi-spoke implementation alone does not require this skill.
---

# Pi Spoke

Use pi-spoke as the main agent. Delegation remains optional and subject to the
host's instructions and the user's scope. Own the objective, coordination,
verification, and integration; give each worker room to choose its local method.

A **session** is a persistent conversation with fixed model, working directory,
tool grant, write authority, and project-context policy. A **run** is one execution
within that session. Use `run_id` for observation, steering, replies, and
cancellation; use `session_id` plus the latest run ID for continuation.

## Prepare a delegation

Find the host's tools named `spoke_catalog`, `spoke_spawn`, `spoke_observe`,
`spoke_send`, `spoke_cancel`, and `spoke_sessions`; a host may add an MCP namespace
prefix. Use the exposed schemas and `structuredContent` results. Large responses
may place only a pointer in the text content.

If these tools are unavailable, report the missing connection. For setup work,
locate the pi-spoke checkout and read its `README.md` and `docs/operations.md` for
the operator configuration and host connection procedure. This skill does not
configure credentials or start a server by itself.

When identifiers or ceilings are unknown, use `spoke_catalog`:

- `kind: "models"`: select an exact `provider` and `id`, respecting an explicit
  user choice. Read each model's `description` and `description_provenance` as
  operator guidance about suitable tasks, alongside its capability metadata.
  See [model descriptions](references/tool-guide.md#model-descriptions) for
  interpretation and search. Catalog entries and configured authentication do not
  prove live access. Omit `thinking` unless a supported value is known; report
  model failures before considering a different model.
- `kind: "tools", cwd`: inspect allowed tools and workspace write ceilings.
  Availability marked `preflight_required` still needs runtime validation.
- `kind: "skills", cwd`: optionally discover `skill_id` values. Suggested skills
  expose metadata and locations, and remain optional. A nonempty shortlist needs
  a granted reader; prefer `read` rather than adding shell solely for skill access.

Follow `next_cursor` when more catalog or session entries are needed. Already
known valid identifiers do not require a fresh discovery sequence.

Write a self-contained task stating the outcome, relevant context and paths,
constraints, and evidence to return. Workers do not inherit the main conversation.
`project_context: "agents"` loads scoped ancestor `AGENTS.md` files; use
`context_files` for additional explicit background. Coordinate disjoint scopes
when workers and the main agent edit the same workspace; pi-spoke does not create
worktrees or merge their changes.

For a read-only task, grant `read`, `grep`, `find`, and `ls` with empty write roots.
For an authorized edit, add `edit` or `write` and only the existing absolute
`file_write_roots` needed within the operator ceiling. Tools and write authority
are independent. Keep `shell_write_roots` empty: project shell-write grants are
unsupported in 0.1.0. Granted `bash` has read-only project source, private writable
scratch, and no tool network; shell runs currently finish `interrupted` with
unconfirmed descendant cleanup. Selected skills and protected metadata remain
unwritable. Authorized file edits persist through failure or cancellation.

## Start and coordinate

Read [tool-guide.md](references/tool-guide.md) when constructing calls, fetching
paged output, continuing a session, or handling an error. Its examples are templates;
replace paths, models, request keys, and returned IDs with actual values.

1. Call `spoke_spawn` with a fresh `request_key`, explicit model and grants, and
   the self-contained task. Retain the exact request and returned IDs. An accepted
   `starting` receipt establishes durable acceptance; check observation for the
   effective configuration and execution result.
2. Continue independent host work, then use `spoke_observe` with a bounded wait
   (at most 25,000 ms). Carry `next_after_seq` into the next `after_seq` to avoid
   rereading events. Drain truncated events as needed. Observation adds no model
   turn, and `timed_out: true` does not cancel the run.
3. Handle the observed state:

   | State | Main-agent action |
   |---|---|
   | `starting`, `running` | Observe progress; steer only a `running` run when direction changes. |
   | `waiting_input` | Read `questions` and reply with the exact `question_id`. Steering cannot unblock a question. |
   | `stopping` | Observe until terminal cleanup status is available. |
   | `completed` | Fetch the needed output and verify the work against the task. |
   | `failed`, `cancelled`, `interrupted` | Inspect reason, cleanup status, events, and any partial output or file changes before deciding a next action. |

Notes and improvement proposals are evidence for the main agent to evaluate.
Replies and steering convey text; they cannot expand a session's capabilities.
An accepted send receipt does not prove delivery or compliance; inspect delivery
events and the worker's result. Worker contact is mediated through the main agent.

## Finish or continue

For a follow-up in the same conversation, use `spoke_sessions` to obtain
`latest_run_id` and check `continuation_eligible`. Send `kind: "continue"` with
`expected_last_run_id` and a new task message only when no run is active and a safe
checkpoint and eligible cleanup exist. Eligibility is preliminary; admission
revalidates resources and policy. A changed model, directory, tool grant, or write
authority requires a new session and a self-contained handoff.

Use `spoke_cancel` when a run should stop, then check the returned state and cleanup
status. Cancellation affects only that run and does not roll back edits.

Reuse a request key only for an identical request to recover its receipt. After an
ambiguous result, inspect existing state before starting more work; a new key can
duplicate effects. Unconfirmed cleanup needs independent operator inspection,
not an automatic retry or recovery attestation.

Finish by checking the worker's evidence and actual changes, performing validation
appropriate to the task, and integrating the result. Report unresolved failures
or uncertainty. A completed run alone is not acceptance of the worker's work.
