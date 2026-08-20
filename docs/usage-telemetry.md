# Usage telemetry

Usage telemetry is browser-local and contains only normalized numeric samples. It
never writes to the server, pi session files, prompts, transcript text, or tool
content.

## Sampling and retention

- `public/app.js` samples Usage data normally every 10 seconds while the tab is
  visible. Sampling pauses when the tab is hidden and resumes with a new rate
  baseline when it becomes visible again.
- Tool durations pause while a safeguard permission prompt is open and resume
  after the decision is resolved, so waiting for permission is not counted as
  tool runtime. Other tool-owned input waits, such as `ask_user_question`,
  remain measured.
- Each session retains at most 60 minutes and 361 raw samples (the current
  sample plus 360 prior 10-second intervals).
- Sparklines use the raw history for metrics, then downsample the rendered graph
  to at most 100 timestamp-aware buckets. Numeric values in a bucket are
  averaged; a bucket containing missing data remains a visible gap.

## Browser storage

The module writes `localStorage["pi:usage-telemetry:v1"]` after each accepted
sample. The current payload is version 2 and keeps the 12 most recently saved
session histories:

```json
{
  "version": 2,
  "sessions": [
    {
      "sessionKey": "...session file...",
      "samples": [],
      "savedAt": 0
    }
  ]
}
```

Each session entry has its own 60-minute/361-sample bound. Switching sessions
loads the entry whose `sessionKey` matches the active pi session; if none exists,
the UI starts an empty history. A restart follows the same rule, so saved Usage
history switches with the active session instead of being shared across sessions.

The previous v1 single-session payload is still readable and is converted to the
version-2 map on the next successful save. Corrupt, unavailable, or quota-failing
storage falls back to the in-memory history without blocking the UI.

The storage record is intentionally bounded to the 12 most recently saved
sessions. A session that has not been sampled for more than 60 minutes also has
no retained samples when the record is next read or written.
