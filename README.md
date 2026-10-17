<div align="center">

# 🔄 pi-retry

**Automatic retry for every error in [pi](https://github.com/earendil-works/pi-coding-agent)**

_400/413, connection errors, credit errors, stream exhaustion — retry them all._

[![pi extension](https://img.shields.io/badge/pi-extension-blueviolet)](https://github.com/earendil-works/pi-coding-agent)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

</div>

---

---

## Pi 1.0 compatibility (0.10.4)

Tested with Pi **1.0.0**. Host-provided Pi packages and TypeBox are peers (`*`), not bundled runtime dependencies; development uses exact Pi 1.0.0 pins and host-compatible TypeBox where needed.

Verified the actual `AgentSession.bindExtensions` and `_prepareRetry` lifecycle, including child retry ownership, cancellation and native nested tools. No replacement retry dispatcher is introduced.

Run `bun run test:host` for the offline real-host load, native codemode/nested-call, module-identity and reload checks. Set `PI1_HOST_PACKAGE` to an installed Pi package directory to test that host explicitly; add `PI1_HOST_ENTRY=bundle` to check the bundled CLI runtime's constructors.

## Overview

This extension automatically detects and retries **all** errors, forever, until you abort. There is no error blacklist and no failure cap: invalid API keys, missing models, quota/budget exhaustion and context overflow are retried like a socket hiccup.

| Error Type | Retry Behavior | Use Case |
|------------|----------------|----------|
| **Any error** (catch-all) | **Uncapped** exponential retry | Everything, including unknown errors |
| HTTP 400/413 | **Uncapped** with exponential backoff | Transient context overflow that might resolve |
| Credit / payment errors | **Uncapped** with exponential backoff | "Not Enough Credits", insufficient balance, 402 — top up and the retry loop auto-resumes |
| **Quota / session-limit / budget exhaustion** | **Retried** — labelled in `/retry status` | "You've hit your limit", `insufficient_quota`, "out of budget", suspended accounts |
| Invalid API key / unknown model | **Retried** — no exception | The key or model may be fixed mid-loop |
| Context overflow | **Retried** alongside SDK compaction | Oversized payload; either path can recover the turn |
| Connection errors | **Uncapped** with exponential backoff | Network hiccups, connection drops, socket errors, stream exhaustion |
| Max tokens (`stopReason: "length"`) | **Auto-continue** indefinitely with hidden continuation turns | Model hits output token limit mid-generation |
| Empty / think-only stop (`stopReason: "stop"` with no text or tool calls) | **Nudge once** with a hidden continuation, then give up | Model ends its turn with no usable output (Anthropic empty responses with end_turn, thinking-only turns) |

---

## The Problem

By default, pi has built-in retry for some errors (rate limits, 5xx, overloaded), but:

1. **400/413 errors** are treated as context overflow → triggers compaction but NO retry
2. **Connection errors** sometimes get only limited retries before giving up
3. **Credit errors** ("Not Enough Credits") are never retried
4. **Stream exhaustion** ("Max outbound streams") and other provider-specific errors are never retried
5. **Any unknown error** from a new provider is silently ignored

## The Solution

This extension provides automatic retry for all errors with configurable exponential backoff (2s → 4s → 8s → ... → 60s by default) and keeps retrying at the maximum delay forever.

**Philosophy: retry EVERYTHING, forever.** Nothing is excluded — not an invalid API key, not a missing model, not an exhausted quota. Only a user abort (ESC), fresh input, or a session change stops the loop.

**Features:**
- **Catch-all retry** — Any `stopReason: "error"` is retried, regardless of error message
- Automatic detection of 400/413, connection, credit, and stream exhaustion errors
- **Auto-continuation** when the model hits its max output tokens (`stopReason: "length"`) — indefinite, no cap, hidden from the TUI
- **No cutoff** — Keeps retrying at the maximum backoff until success, abort, or session change, with a notification explaining why
- Exponential backoff with configurable base delay, cap, and multiplier
- **Hidden triggers** — provider-valid custom messages use `display: false`, so retries do not add TUI clutter
- Manual controls via unified `/retry` command

---

## Installation

### Option 1: Install via pi package (Recommended)

Install directly from GitHub as a pi package:

```bash
pi install https://github.com/monotykamary/pi-retry
```

Or add to your `settings.json`:

```json
{
  "packages": [
    "https://github.com/monotykamary/pi-retry"
  ]
}
```

### Option 2: Global Installation

Copy the extension to pi's global extensions directory:

```bash
cp retry.ts ~/.pi/agent/extensions/
```

### Option 3: Project-Local Installation

Copy to your project's `.pi/extensions/` directory:

```bash
mkdir -p .pi/extensions
cp retry.ts .pi/extensions/
```

### Option 4: Quick Test

```bash
pi -e ./retry.ts
```

---

## Usage

Once loaded, the extension **automatically** detects and retries all errors.

### Manual Controls

| Command | Description |
|---------|-------------|
| `/retry` | Manually trigger immediate retry (auto-detects: 400/413, credit, connection, max_tokens, or any other error) |
| `/retry status` | Show current retry diagnostics for all error types + continuation state |
| `/retry reset` | Reset all retry counters and state |

---

## Configuration

The extension reads a `piRetry` object from Pi's settings files:

- `~/.pi/agent/settings.json` applies globally.
- `.pi/settings.json` overrides matching global values for the current project.

```json
{
  "piRetry": {
    "baseDelayMs": 10000,
    "maxDelayMs": 3600000,
    "multiplier": 2
  }
}
```

The example above waits 10 seconds before the first retry, doubles each delay, caps the delay at one hour, and keeps retrying at that cap until you abort. Supported values are:

| Setting | Default | Description |
|---------|---------|-------------|
| `baseDelayMs` | `2000` | Delay before the first retry, in milliseconds |
| `maxDelayMs` | `60000` | Maximum delay between retries, in milliseconds |
| `multiplier` | `2` | Exponential backoff multiplier; must be at least `1` |
| `messageFreeRetries` | `false` | Retry errors without a hidden retry message (see below) |

`piRetry` is separate from Pi's built-in `retry` object so the two retry policies do not share ambiguous settings. The extension disables Pi's native retry scheduler while it is loaded, while preserving Pi's compaction handling, so only one retry loop owns the backoff schedule.

Settings are read when the extension starts. Restart pi or use `/reload` after editing them.

### Message-free error retries (opt-in)

By default, each error retry queues a hidden `Retry the previous request.`
message, which stays in the model context and the session file. With
`"messageFreeRetries": true`, an automatic error retry instead waits out the
backoff inside the original prompt, then uses Pi's `agent_before_settle`
boundary to omit the failed response with a `context_edit` entry and continue
the unchanged context. The provider receives the same request again, and the
omission persists when the session is resumed. The failed response stays in
the raw session history.

- Max-token continuations, empty-stop nudges, and manual `/retry` still use
  hidden messages, because they need a new user turn to continue.
- Escape, new input, the backoff schedule, and the retry cap work as before.
  The prompt stays busy during the backoff, so input typed then is steered
  into the run and cancels the pending retry.
- Requires Pi with the `agent_before_settle` boundary (0.87.0 or later). On
  older Pi the extension warns once and keeps hidden retry messages.

---

## How It Works

1. **Listen to `agent_end` event** — Fires after each agent turn completes
2. **Check for any error** — Examine the last assistant message for `stopReason === "error"`
3. **Categorize for messaging** — Classify into 400/413, credit, connection, quota, or other for `/retry status` diagnostics (labelling only; it never gates retrying)
4. **Retry or continue with hidden turns** — Wait with exponential backoff, then trigger a provider-valid custom user turn via `pi.sendMessage()` with `display: false` and `triggerTurn: true` (with `messageFreeRetries`, error retries omit the failed response and continue instead)
5. **Valid provider context** — Hidden retry and continuation messages remain in context so providers never receive a trailing assistant message
6. **Indefinite continuation** — Max_tokens auto-continues are uncapped; repeated `length` stops keep producing continuation turns until the model terminates normally
7. **Empty-stop recovery** — A `stop` turn with no usable output (only thinking, or nothing at all) gets exactly one hidden "nudge" continuation, then gives up. Matches Anthropic's documented "empty responses with `end_turn`" remedy (continuation prompt in a new user message) — retrying an empty response in place doesn't help because the model has already decided it's done.
8. **Lifecycle exposure** — Emits `pi-retry:started`, `pi-retry:completed`, and `pi-retry:cancelled` on Pi's shared extension event bus with a matching `retryId`, allowing status integrations to suppress intermediate completion signals

The pi's built-in `transform-messages` already strips aborted/errored assistant messages from the LLM context, so the model never sees the failed attempts.

---

## Detected Error Patterns

### Catch-All (Any Error)
- **Any** assistant message with `stopReason === "error"` is retried — nothing is excluded
- Unknown provider errors, stream errors, unexpected failures — all handled automatically

### Retried Like Everything Else
These used to be treated as permanent. They are now retried too, because the cause can disappear mid-loop (a key gets refreshed, a quota window rolls over, the context gets compacted):
- Invalid API key / invalid authentication / revoked or missing key
- Model not found / unknown model / unsupported model
- **Quota, session-limit and budget exhaustion** — "You've hit your limit · resets …" (Claude Code, Codex, ChatGPT plans), `insufficient_quota` (OpenAI), "You have exhausted your capacity on this model" (Gemini Code Assist), `free-models-per-day` (OpenRouter), "out of budget" (LiteLLM-style proxies), suspended accounts (Kimi)
- **Context overflow** — "prompt is too long", "exceeds the context window", and friends

These messages are still labelled `quota` in `/retry status`, so an endless retry loop tells you whether you are waiting on billing or on the network.

### Max Tokens (stopReason: "length")
- The model hit its `max_tokens` / output token limit
- The model's response was truncated mid-generation
- Auto-continuation sends a provider-valid custom message hidden from the TUI

### 400/413 Errors
- HTTP 400 Bad Request
- HTTP 413 Payload Too Large
- "bad request" messages
- "payload too large" messages

### Credit / Payment Errors
- "Not Enough Credits"
- "insufficient credits"
- "insufficient balance"
- "out of credits"
- "Payment Required"
- HTTP 402 status code

### Connection Errors
- Connection / network errors
- Fetch failures
- Socket hang up / socket errors
- `ECONNRESET`, `ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`
- DNS lookup failures
- "Request ended without sending any chunks"
- Upstream connect errors
- TLS handshake errors
- Timeouts awaiting response
- Stream exhaustion ("Max outbound streams is 100, 100 open")
- Stream limit errors

---

## Development

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Type check
npm run typecheck

# Dead code detection
npm run lint:dead
```

### Project Structure

```
.
├── retry.ts                   # Main unified extension
├── src/                       # Shared utilities (testable, DRY)
│   ├── config.ts             # Settings-backed retry configuration
│   ├── error-patterns.ts      # Error pattern matching, custom types, hasMaxTokensStop
│   ├── retry-logic.ts         # Retry utilities (calculateDelay, RetryState, ContinuationState, etc.)
│   └── index.ts               # Barrel exports
├── __tests__/                 # Unit tests
│   └── unit/
│       ├── config.test.ts
│       ├── error-patterns.test.ts
│       └── retry-logic.test.ts
├── vitest.config.ts           # Test configuration
└── knip.json                  # Dead code detection config
```

### Code Quality

```bash
# Run all quality checks
npm test              # 224 tests
npm run typecheck     # TypeScript type checking
npm run lint:dead     # Dead code detection with knip
```

---

## Troubleshooting

### Extension not working?

Check that it's loaded in the startup header:
```
Loaded extensions: retry.ts
```

### Retry not triggering?

Use the status command to diagnose:
```
/retry status
```

### Want to see what's happening?

The extensions send notifications on retry attempts. Look at the footer status line for retry status updates, and `/retry status` for the per-category attempt counters and the last error text.

### Too many retries?

Use `/retry reset` to clear the counters, or press `Ctrl+C` to abort the session.

---

## Comparison with @georgebashi/pi-retry

The npm package `@georgebashi/pi-retry` handles "aborted" streaming errors but explicitly excludes "connection error" (assuming pi's built-in retry handles it). This extension:

1. **Handles ALL errors** via a catch-all — no more playing whack-a-mole with new error patterns
2. **Handles connection errors** that pi might not retry sufficiently
3. **Handles 400/413 errors** without compaction
4. **Handles credit errors** and stream exhaustion

They can work together for maximum coverage:

```bash
pi install npm:@georgebashi/pi-retry
# Plus install this extension
```

---

## Limitations

- Pi's native retry scheduler is disabled while this extension is loaded so native and extension retries cannot interleave; Pi's compaction check still runs normally
- Error messages remain in the session history (but are invisible to the LLM)
- Every error class is retried, so a permanent-looking failure (invalid API key, exhausted quota, genuinely oversized context) keeps firing at the maximum backoff until the cause is fixed
- Escape aborts the loop; fresh input or `/new` also stops it
- **Warning**: Retrying 400/413 without reducing context may fail repeatedly if the payload is genuinely too large — run `/compact`

---

## Related

- [Pi Coding Agent Extensions Docs](https://github.com/badlogic/pi/tree/main/packages/coding-agent/docs/extensions.md)
- [@georgebashi/pi-retry](https://github.com/georgebashi/pi-retry) — Handles "aborted" streaming errors
- [Issue #252: Connection error with no retry](https://github.com/badlogic/pi-mono/issues/252)

## License

MIT

## Subagent retry policies

Sessions that should retry with a different policy can be selected by matching
their effective system prompt. This is user configuration: the extension ships
no built-in marker or identity check for any specific subagent tool.

```json
{
  "piRetry": {
    "subagents": {
      "enabled": true,
      "match": {
        "systemPromptRegex": [
          {
            "pattern": "^<active_agent name=\"[^\"\\r\\n]+\"/>$",
            "flags": "m"
          }
        ]
      },
      "baseDelayMs": 1000,
      "maxDelayMs": 10000
    }
  }
}
```

Semantics:

- Sessions whose effective system prompt matches any listed rule use the
  inline child policy; rules combine with OR.
- Omitted child fields inherit from the effective top-level policy, field by
  field. Project matcher lists replace global ones.
- A matching rule with `enabled: false` leaves pi's native retry scheduler
  untouched; a missing, empty, malformed, or nonmatching configuration keeps
  the ordinary `pi-retry` takeover.
- Unmatched sessions in print or JSON mode (`pi -p`, `pi --mode json`, and SDK
  hosts that bind extensions without a mode, such as pi-subagents children)
  retry inline with the top-level policy, inside the original prompt. These
  hosts read the result as soon as `prompt()` settles, so a detached retry
  would arrive too late. A matcher is only needed for a different child policy
  or for `enabled: false`.
- Patterns are compiled when settings resolve. Invalid syntax, unsupported or
  duplicate flags, and malformed groups warn and become no-match instead of
  matching everything.
- The extension must also be loaded in the target session (for pi-subagents
  that means listing it in the child's `subagentOnlyExtensions`), not only in
the parent.

The example pattern above matches the `<active_agent name="…"/>` line that
`pi-subagents` prefixes to native child system prompts; substitute your own
marker if you select child sessions differently. Keep the `m` flag: some
children have a `<sub_agent_context>` block before that line.
