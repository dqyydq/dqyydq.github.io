# Day 1 Async Concurrency Animation Design

## Goal

Create a 45-second narrated teaching animation based on the Day 1 topic “FastAPI `async def` vs `def`: event loop and thread pool”. The animation will ship as two Remotion compositions: a 16:9 landscape version for the blog and a 9:16 portrait version for mobile viewing.

The animation must make the difference visible rather than relying on code alone:

- `async def` stays on the event loop and uses `await` to yield while I/O is pending.
- `def` is delegated by FastAPI to a worker thread pool, so synchronous blocking work does not block the main event loop.
- `await` is cooperative yielding, not the creation of a new thread.

## Storyboard

The narration and motion use one shared 45-second timeline:

| Time | Scene | Visual message |
| --- | --- | --- |
| 0-5s | Hook | Requests A, B, and C arrive together; ask how one thread can handle many requests. |
| 5-16s | Async handoff | A reaches `await` while waiting for the database and visibly yields control. |
| 16-26s | Event-loop relay | The event loop handles B and C, then resumes A when the database result returns. |
| 26-36s | Thread-pool contrast | A synchronous `def` request moves into separate worker slots; only its worker waits. |
| 36-45s | Rule card | I/O waits use `async`; synchronous blocking code uses `def` or a thread pool. |

The spoken script is concise enough for the 45-second target and is rendered together with synchronized Chinese captions. The final voice direction is a neutral, restrained young female voice with clear diction, slightly slower technical narration, and no character voice effects.

## Visual System

The visual language is an editorial technical diagram:

- Paper background: `#F2F0E9`.
- Ink and diagram lines: `#151515`.
- Signal red for requests, `await`, active states, and key terms: `#DF3D2F`.
- White cards for code and labels: `#FFFFFF`.
- System sans-serif for titles and labels; monospace for code tokens.
- Requests enter with short ease-out motion, pause at `await`, and resume when I/O completes.
- No CSS transitions or animation classes; every animated value is derived from the Remotion frame with `interpolate()`.

Landscape uses a wide title and horizontal event lane. Portrait moves the title upward, converts the event lane to a vertical stack, and reserves a bottom safe area for captions. Both compositions share scene timing, colors, copy, and state transitions.

## Audio and Asset Organization

The primary local TTS model is `Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice`, selected for Chinese quality and built-in speaker support. The model is expected to run in BF16 on the user's 16GB GPU. `CosyVoice2-0.5B` remains a documented fallback, and Kokoro is only a fast-preview fallback.

Audio files are organized so downloaded model weights never become Remotion assets:

```text
remotion/day1-async/
  public/audio/day1-async-zh-female.wav
  voice/README.md
  voice/generate_day1_voice.py
  voice/outputs/
```

Model caches are kept outside `public/` and ignored by Git. The generation script validates the model path, writes a raw output into `voice/outputs/`, normalizes the final WAV, and reports its duration. Remotion refuses to render the narrated composition when the required audio file is missing.

## Remotion Architecture

The new Remotion project is isolated under `remotion/day1-async/` so the Astro site's existing package and build remain unchanged:

```text
remotion/day1-async/
  package.json
  src/
    Root.tsx
    Day1Async.tsx
    timing.ts
    theme.ts
    scenes/
      Hook.tsx
      AsyncLoop.tsx
      ThreadPool.tsx
      RuleCard.tsx
  public/audio/
```

`Root.tsx` registers `Day1AsyncLandscape` at 1920x1080 and `Day1AsyncPortrait` at 1080x1920, both at 30fps and 1350 frames. `Day1Async.tsx` owns the shared sequence and chooses layout-specific geometry. Scene components receive the current frame and timing data rather than maintaining independent clocks.

## Failure Handling

- TTS generation fails fast when the selected model or required runtime is unavailable; it never creates a silent fallback file while claiming success.
- Audio duration is checked against the 45-second composition duration before rendering.
- Missing audio, invalid model paths, and unsupported GPU dtypes produce actionable command-line errors.
- The animation remains deterministic: all scene timing is frame-based and no runtime network request is needed by Remotion.

## Verification

The implementation will be verified with:

1. A Remotion still render from the hook, async handoff, thread-pool, and final rule-card frames for both compositions.
2. A full render of each composition with the generated WAV.
3. Image inspection for blank frames, text overflow, clipped diagrams, and caption overlap.
4. A build of the existing Astro project to confirm the new video project does not alter the blog build.

## Scope Boundaries

This animation does not add a video player to the Astro site, implement voice cloning, or explain database schema/transactions from other Day 1 sections. The deliverable is the two editable Remotion compositions, the local TTS generation path, the generated narration asset when the model is available, and the verification commands.
