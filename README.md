# BALL CRASH

A comic-style 3D tower-drop arcade game by **par777**. Spin the tower to guide a bouncing ball down through the gaps, dodge the red spikes, and fall through 3 gaps in a row to go **FIREBALL** and smash straight through anything.

Open `index.html` in a browser to play. It needs no install or build (three.js is bundled in `vendor/`).

## Modes

- **Levels:** reach the bottom without crashing to pass a level and unlock the next one. Each level has 3 gold stars floating in gaps. Drop through a star or smash its platform with a fireball to collect it. The level select shows a 1–3 star rating for each level.
- **Endless:** one tower that never ends, and you get one life. Every 50 platforms a checkered ring starts a new, harder stage. Your best depth is saved.

## Balls

Tap **BALLS** on the home screen to pick your ball. Your choice is saved.

- **Animals:** Panda, Axolotl, Kitty, Froggy, Chick and Bunny. Each has a kawaii face that smiles "^ ^" when it bounces and goes "> <" in fireball mode, plus 3D ears, gills, frog eyes or a beak.
- **Balls:** Classic (matches the level colours), Football, Basketball, Tennis and Baseball. These spin as they fall.

## Controls

| Action | Input |
| --- | --- |
| Spin the tower | Drag (mouse / touch), or ← → / A D |
| Menu buttons | Click / tap, or Space / Enter |
| Back to home | ⌂ button or Esc |
| Mute | M, or the speaker button |

## Look

Pick an art style in **⚙ SETTINGS** on the home screen. Your choice is saved.

- **Neon Idol** (default): glossy neon platforms with a glowing rim light, a night sky with a moon, sweeping concert spotlights, bokeh and glitter, painted light slashes, lens flares, hearts, film grain and quick music-video glitch flashes.
- **Comic:** cel shading with ink outlines and halftone dots, hand-drawn impact bursts, anime focus lines and comic sound words.

In both styles the ball and camera move smoothly (on ones), while effects move in steps (on twos and threes) for a punchy, drawn feel. Pop-up words appear beside the ball so they never hide it. Screen flashes are limited to about three per second.

Slower devices switch off the heavy effects automatically. Add `?fx=low` or `?fx=high` to the URL to force them off or on.

## Publish on GitHub Pages

1. Merge the game into `main`.
2. In GitHub: **Settings → Pages → Deploy from a branch (`main` / `/ (root)`)**.
3. Add the game to `MoBlockz/website` (`apps/web/lib/games.ts`) to feature it on https://moblockz.com.

## Files

- `index.html`: page, HUD, menus and styles
- `game.js`: game logic, rendering, effects and sound (Web Audio, no sound files)
- `skins.js`: ball skins, drawn in code (patterns, kawaii faces and 3D extras)
- `vendor/three.min.js`: three.js r149 (MIT, see `vendor/THREE-LICENSE.txt`)
- `AGENTS.md` & `CLAUDE.md`: MoBlockz rules for AI coding tools
