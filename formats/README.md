# Formats

A format is a popular post shape Ethan has reviewed, kept as data: the aspect, frame, where her
body goes, which poses fit, any overlay text and the tone of the caption. She only picks formats
marked `reviewed: true` whose `min_skill` her craft skill has reached.

To add one, run `pnpm formats:add <image>`, edit the drafted JSON, set `reviewed: true` and
commit it. The file name must match the `name` field.

Fields and allowed values: `name` (lowercase letters, digits, hyphens), `medium` (`still`),
`min_skill` (0 to 1), `aspect` (`1:1`, `4:5`, `9:16`), `frame` (`none`, `polaroid`, `screenshot`,
`border`), `placement.side` (`auto`, `left`, `right`), `placement.scale` (`[low, high]`, each
above 0 and at most 1), `poses` (pose tags), `overlay.kind` (`none`, `caption_in_image`, `label`),
`overlay.position` (`top`, `bottom`), `overlay.style` (`plain`, `handwritten`), `grain` (0 to 1),
`caption_pattern` (text), `reviewed` (boolean).
