# Codex Workshop Pets

[简体中文](README.md) · **English**

After I give Codex a task, I often catch myself staring at the little spinner in the chat list. It spins and spins, the screen barely changes, and I start wondering what’s taking so long. Meanwhile, Codex might be reading files, editing code, or running tests. The spinner gives me no sense of how busy it is.

So I put a row of tiny workstations above the composer. As soon as Codex gets to work, a pet dives for the keyboard and types so hard its fur stands on end, sweat flies, and keycaps pop off. When the task is done, it finally takes its paws off the keys, closes its eyes, and lets out a breath.

![Pets pick up tasks from left to right and settle back into place when finished](media/pet-preview.gif)

The width of the composer determines how many pets fit. New tasks go to the leftmost free pet, and extra tasks are skipped when all slots are busy. Each working pet shares a colored shape with its chat. Hover over the pet to highlight its chat in the sidebar, or click it to jump there.

## Use it in Codex

You need macOS, the ChatGPT desktop app installed in Applications, and Node.js 22 or later. Open or create a local chat in Codex, then run:

```sh
git clone https://github.com/normalpeople553/codex-workshop-pets.git
cd codex-workshop-pets
./Launch.command
```

You can also double-click `Launch.command` in Finder. When the launcher asks you to quit ChatGPT, switch to the app and press **⌘Q**. The launcher reopens it. Return to any local Codex chat and leave the launcher’s Terminal window open. Send Codex a task to see a pet start working. Start tasks in two local chats to see the two leftmost pets work independently.

Press **Ctrl+C** in the launcher’s Terminal window to hide the pets. To exit demo mode, quit ChatGPT with **⌘Q**, then reopen it from the Dock.

## Design your own pet

1. Open [art/pet.svg](art/pet.svg) and draw your character’s body, expressions, paws, and props. Figma, Inkscape, or a text editor will work.
2. Adjust motion, timing, and colors in [art/pet.css](art/pet.css). Keep the SVG animation class names so the existing animations can find the right parts of your artwork.
3. Run `npm run preview` and open the local address printed in Terminal. Try the idle, working, and finished states, or start two sample tasks together. Refresh the page after editing the artwork.
4. If the desktop demo is running, saving the SVG or CSS updates the pets without restarting the app.

[Design and animate a pet from scratch](docs/design.en.md)

## How it works and what it supports

The bridge reads Codex Desktop chat events and titles locally. Each task takes a clickable pet slot. The pet plays a short finishing animation and returns to idle when the task completes. Canceling a task frees its slot immediately. The current implementation supports local desktop chats. It relies on the local Codex event format and composer layout, so app updates may require changes to event parsing or UI selectors.

The launcher opens a temporary debug port on the loopback interface to draw the pets inside the window. The bridge leaves the app bundle intact and keeps chat content on your machine. The preview uses artwork from this repository and sample task states.

The code and included assets are available under the [GNU General Public License, version 3](LICENSE). If you distribute a modified version, make the corresponding source available to recipients under GPL-3.0. In-window rendering was inspired by [Codex Styler](https://github.com/xuhuanstudio/codex-styler). See [NOTICE](NOTICE) for upstream attribution and licensing. This is an unofficial project and is not affiliated with OpenAI.
