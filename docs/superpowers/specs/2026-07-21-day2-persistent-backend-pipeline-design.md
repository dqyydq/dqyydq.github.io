# Day 2 Persistent Backend Pipeline Design

## Goal

Replace the scene-specific central cards in the Day 2 portrait video with a persistent, beginner-friendly system map.

## Visual Structure

The main body always shows this vertical chain:

`Docker Compose -> PostgreSQL database -> FastAPI Agent backend -> GET /health`

The title and one-sentence explanation occupy the upper safe area. The chain stays visible below them through every teaching scene. The end card remains a separate reusable composition.

## Motion Rules

- In the hook, all nodes are visible but muted so the viewer sees the complete route immediately.
- At the start of each teaching section, its matching node receives the mint focus color before the explanation reaches the key term.
- A mint signal dot moves down the connector after the current node is introduced, visually carrying the system toward the next dependency.
- Past nodes keep a reduced-color completion state. Future nodes remain muted.
- The health-check node ends with an `OK` state to make the successful chain unambiguous.

## Reuse Boundary

`PersistentBackendPipeline` accepts the active module and scene progress. Future backend videos can retain the component and replace only the four node labels and explanatory content.

## Validation

- Render representative Hook, PostgreSQL, FastAPI, health-check, and end-card frames.
- Verify the final portrait MP4 remains 1080x1920, 36 seconds, H.264, and AAC audio.
