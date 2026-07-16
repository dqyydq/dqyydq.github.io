# Blog Series Navigation Design

## Goal

Give related learning notes an automatic previous/next navigation without forcing unrelated articles into the same sequence.

## Content Model

Blog frontmatter gains two optional fields:

```yaml
series: fastapi-postgres-learning
seriesOrder: 1
```

`series` is a stable identifier for a group of related posts. `seriesOrder` is the positive integer position inside that group. Both fields must be provided together or omitted together.

The existing Day 1 through Day 7 notes will use `fastapi-postgres-learning` with positions 1 through 7. The FastAPI interview cheatsheet remains outside the series and will not receive series navigation.

## Page Behavior

On an article page, the site finds posts with the same `series`, sorts them by `seriesOrder`, and renders only adjacent entries:

- The first entry has a next link only.
- A middle entry has previous and next links.
- The last entry has a previous link only.
- An article without series metadata has no series navigation.

The links use each target post's title and route to its existing blog URL. They inherit the site's restrained article-navigation styling and include the existing hover feedback.

## Validation

The content schema rejects a post that supplies only one of the two series fields. The article route validates that no two posts in a series share a `seriesOrder`; a duplicate stops the build with a clear error. This prevents ambiguous production navigation.

## Future Authoring

To append Day 8, add `series: fastapi-postgres-learning` and `seriesOrder: 8` to its frontmatter. To begin an unrelated sequence, choose a new `series` identifier and begin at `seriesOrder: 1`. Standalone articles omit both fields.

## Verification

Build the Astro site and confirm that Day 1, a middle post such as Day 2, Day 7, and the standalone FastAPI interview cheatsheet have the expected navigation states.
