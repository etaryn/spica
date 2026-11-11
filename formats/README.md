# Formats

A reel format is a popular post shape Ethan has reviewed, kept as data: its shots, each with the
clip tags she may play, the framing, and ranges for the camera, length and pan, plus the faces
that fit a find that moved her warmly or weighed on her, the grain and the tone of the caption.
She only picks formats marked `reviewed: true` whose `min_skill` her skill (`posts.skill`) has
reached. Code fills each range, seeded by the find; no model writes the edit.

To add one, copy `reels/drift.json`, change it, render it with `pnpm reels:review <image>`, set
`reviewed: true` and commit it. The file name must match the `name` field. A format asking for a
clip tag, face or framing `assets/reels/clips.json` lacks, or longer than `posts.reel.max_frames`,
is skipped.

Fields: `name` (lowercase letters, digits, hyphens), `medium` (`reel`), `min_skill` (0 to 1),
`shots[]` (`tags`, `framing`, `azimuth` `[low, high]` degrees 0 to 180, `elevation` -30 to 30,
`frames` whole numbers from 1, `pan` 0 to 1), `faces.warm` and `faces.low` (face names),
`grain` (0 to 1), `caption_pattern` (text), `reviewed` (boolean).
