# Day 1 Async Serena Voice Redesign

## Goal

Improve the Day 1 async/await video's narration so it sounds like a natural,
sweet young female voice rather than a broadcast-style lesson, while keeping
the existing animation, script, output paths, and reusable GPU workflow.

## Chosen Approach

Use the cached `Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice` model with the `Serena`
speaker. The narration text remains unchanged so the 45-second visual timing
does not drift. The voice instruction should emphasize a light, bright,
smiling conversational delivery and explicitly avoid announcer cadence,
excessive emphasis, and affected cutesiness.

## Data Flow

1. Load the project-local Qwen3-TTS snapshot on `cuda:0` with bfloat16.
2. Read the existing script from `voice/day1_voice_script.txt`.
3. Generate Chinese narration with `Serena` and the sweet conversational
   instruction.
4. Write 16-bit PCM WAV to the existing
   `public/audio/day1-async-zh-female.wav` path.
5. Render both Remotion compositions and mux the WAV as 48 kHz stereo AAC into
   the existing landscape and portrait `*-final.mp4` files.

## Validation

- Generated narration stays within the 45-second composition duration.
- Final files contain H.264 video and 48 kHz stereo AAC audio.
- Silence detection shows speech segments and only expected pauses/trailing
  padding.
- Remotion lint and the root Astro build remain green.

## Compatibility

The model cache, script path, output path, Remotion composition IDs, and
landscape/portrait filenames remain unchanged. Future voice experiments can
select another supported speaker through `DAY1_TTS_SPEAKER` without changing
the folder layout.
