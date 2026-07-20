# Day 1 Async Voice And Hook Redesign

## Goal

Improve the Day 1 async-concurrency animation's opening retention and narration quality without changing its technical explanation or visual system.

The revised video keeps both existing compositions (16:9 and 9:16), remains approximately 45 seconds, and is still local-only. It does not add a player to the Astro blog or upload media.

## Voice Direction

Use Qwen3-TTS `Vivian` with this instruction:

> 甜美、明亮、亲和，像一位耐心的年轻女老师；带微笑感，语速中快，关键词轻微强调；不要播音腔，不要过度撒娇。

The voice should feel approachable and warm while keeping technical terms (`async def`, `await`, `def`, 线程池) crisp. No background music or sound effects are added in this revision, so the explanation remains intelligible in a blog context.

## Opening Hook

The first three seconds use:

> 你以为 FastAPI 需要很多线程？其实，一个线程也能同时接住很多请求。

The hook appears as the first caption and spoken sentence while request tokens A, B, and C enter the frame. It replaces the previous neutral question and creates a clear curiosity gap before the event-loop explanation starts.

## Revised Timing And Script Shape

The 45-second timeline remains a single shared timeline:

| Time | Purpose |
| --- | --- |
| 0-3s | Hook: the many-threads misconception and promise. |
| 3-14s | `async def` runs on the event loop; A reaches `await` and yields. |
| 14-25s | The loop handles B and C, then resumes A after I/O returns. |
| 25-36s | `def` is delegated to a thread-pool worker; the main loop stays available. |
| 36-45s | Rule card: I/O waiting uses `async`; synchronous blocking uses `def` or a thread pool. |

The final script is shorter than the previous version where necessary so Qwen3-TTS can stay within the 45-second video. The generator trims only a sub-second trailing pause if the model output is between 45.0 and 45.5 seconds; longer output remains a hard failure.

## Implementation Changes

- Update `voice/day1_voice_script.txt` with the hook and revised transitions.
- Update `voice/generate_day1_voice.py` with the new `instruct` string while preserving the project-local model snapshot resolution and CUDA device selection.
- Keep the existing shared Remotion scene architecture and only adjust hook copy/caption timing if the spoken opening needs an earlier visual beat.
- Regenerate `public/audio/day1-async-zh-female.wav` with the same Qwen3-TTS model cache.
- Re-render both compositions with `props/with-audio.json`, then re-mux final MP4s with 48kHz AAC and `faststart`.

## Verification

- Inspect the first five seconds of both compositions for readable hook text and non-overlapping request tokens.
- Confirm WAV and MP4 audio have non-zero volume.
- Confirm both final MP4 files are exactly 45 seconds and contain H.264 video plus AAC audio.
- Run Remotion lint and the existing Astro build; no blog page or upload path should change.
