# Manual test plan: self-hiding cards in edit mode

Card under test: `trash_reminder` (hides itself when nothing is due). Run everything on the current Home Assistant version and on one older release. Make sure the script runs and nothing is due, then (step 9) something is due.

| #   | Dashboard / situation                | Steps                                                    | Expected                                                                                                     |
| --- | ------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | Masonry                              | Edit dashboard on                                        | Dashed placeholder (or the card's `getPreview()`), can be dragged, edited, deleted                           |
| 2   | Masonry                              | Edit dashboard off                                       | Card disappears again, no reload                                                                             |
| 3   | Sections                             | Edit on / off                                            | Same as 1 and 2                                                                                              |
| 4   | Panel (single card) view             | Edit on / off                                            | Placeholder in edit mode (probably via `?edit=1` fallback)                                                   |
| 5   | YAML mode (raw configuration editor) | Open the raw editor, return                              | No errors in console, card hidden in normal view                                                             |
| 6   | Picker                               | Add card, search the card                                | Preview shows the demo columns, not empty                                                                    |
| 7   | Mode toggle                          | Toggle edit mode several times, use browser Back/Forward | Placeholder follows the mode every time                                                                      |
| 8   | Language                             | Profile language de, then en                             | Placeholder text matches (only for cards without `getPreview()`)                                             |
| 9   | Something due                        | Make the sensor report trash                             | Real card in and out of edit mode, no placeholder; toast on done/out still plays                             |
| 10  | Other cards                          | A card that never hides itself                           | Unchanged in edit mode and normally                                                                          |
| 11  | Console                              | Throughout                                               | No errors from `jsa-edit` / `__jsa__`                                                                        |
| 12  | Editor preview, `@card dev`          | Open the card preview, toggle the pencil button          | Placeholder / `getPreview()` appears and disappears; a card calling `__jsa__.isEditing(this)` does not throw |
