# Design a pet that looks like it’s working

[简体中文](design.md) · **English**

The default character uses the terminal symbol `>_` as its mouth. While a task is running, the pet leans forward, its spiral eyes spin, and its paws take turns hammering the keyboard. Sweat drops and keycaps fly. When the task finishes, the pet leans back and closes its eyes.

## Start with a still drawing

Use [pet.svg](../art/pet.svg) as your canvas. The default `viewBox="0 0 148 94"` leaves room near the bottom for the desk and keyboard, and room above for spiky hair, steam, and sweat drops.

1. Start with the silhouette. Draw an animal, a robot, or any character you like. Shrink it to the size it’ll appear beside the composer and check that you can still recognize it at a glance.
2. Separate the body, eyes, paws, and keyboard so each part can move on its own timing.
3. Keep the SVG class names in the table below. For example, wrap multiple paths in `<g class="pet-body">`. After exporting, check that your editor kept those names.
4. Adjust each part’s `transform-origin` in [pet.css](../art/pet.css). The paws should hit the keyboard, and the face and ears should lean forward with the body.

| SVG class | What to draw | Existing motion |
| --- | --- | --- |
| `pet-body` | The body or head group | Breathes when idle, leans into work, and bounces back when done |
| `idle-face` | The resting eyes | Blinks while idle |
| `effort` | The strained expression and work effects | Appears while working |
| `paw left` and `paw right` | Two paws or hands | Hit the keys half a cycle apart |
| `keyboard` | A keyboard or other tool | Shakes slightly with each hit |
| `tail`, `sweat`, `speed-lines`, `key-sparks` | Optional tail, sweat drops, speed lines, and sparks | Emphasize direction and rhythm |
| `spiral-eye`, `steam`, `flying-key` | Optional spiral eyes, steam, and flying keycaps | Make the character look overwhelmed by the work |
| `rest-face` and `relief` | The relaxed face and a visible breath | Appear briefly when the task finishes |

Change `fill` and `stroke` to recolor the SVG. When several pets appear above the composer, the default stylesheet shifts their hues to distinguish them. Remove `hue-rotate(...)` from the CSS if you want all pets to keep their original colors. Each pet gets a copy of the SVG, and the renderer gives IDs and references such as gradients distinct names.

## Make the effort visible

Start with the forward lean and alternating paws. Check that you can read the motion even at a small size. Then line up the keyboard shake with the moment the paws hit, and add the sweat and speed lines last. The default `workshop-whack` loop lasts about 0.28 seconds, with the right paw half a beat behind. Slow it down to check the contact points, then bring the pace back up. Give the finish a distinct pose, such as stopping suddenly, leaning back, and breathing out with eyes closed.

Run `npm run preview` to check the idle, working, and finished animations and how the pets look side by side. Then send a real task in Codex Desktop to check when the pet starts hammering the keys and when it settles down. The SVG and CSS are local assets. Use artwork you created or have permission to distribute.
