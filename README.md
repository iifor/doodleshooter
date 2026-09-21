# Doodle District

A first-person survival shooter drawn in blue ballpoint on lined notebook paper. Grapple across
rooftops and canyons, slice bullets back at the doodles that fired them, lob grenades, and see how
many waves you can survive. Play alone, survive with friends, or fight them.

Everything you see is generated in code with three.js. There are no models, textures or sound
files: the paper, the ink outlines, the hatching, the enemies and the music are all procedural, including the 8-bit themes, one per map (toggle them in settings or with M).

## Running it

It is a static site, so any web server works. Locally:

```bash
python3 serve.py 8910
```

then open http://127.0.0.1:8910. On Vercel (or any static host) just deploy the folder as is.

## Modes

- **Solo**: survive the waves. Bosses every fifth wave, checkpoints unlock at wave 5, 10, 15...
- **Free for all**: up to ten players, first to 20 kills, with a ten minute cap shown on screen that starts once a second player is in. Anyone in the lobby can start. After the death cam a press of any button brings you back with a two second shield; two and a half minutes without input gets you kicked, with a one-click rejoin. Health
  regenerates after a few seconds out of combat (not while sprinting), so only ammo drops in.

Multiplayer is peer-to-peer over WebRTC (PeerJS), so it works from a static host with no game
server. Under PLAY ONLINE you can Quick Play (joins an open public lobby, or opens one for you),
create a public or private lobby, or join a friend's lobby with their five letter code. People can
join a match already in progress. The host's browser keeps score; each player runs their own body.

## Controls

| Action | Mouse + keyboard | PS5 controller |
| --- | --- | --- |
| Move / look / sprint | WASD, mouse, Shift | L stick, R stick, L3 |
| Fire / slash | LMB | R2 |
| Aim / block (katana) | RMB | L2 |
| Jump, wall jump, double jump | Space | ✕ |
| Slide, air dash | C / Ctrl (X, Alt) | ○ |
| Grapple (hold to reel) | Q / E | L1 |
| Quick katana slash | F | R1 |
| Reload | R | □ |
| Grenade (hold to throw further) | G | R3 or d-pad up |
| Katana dash (gauge lit) | both mouse buttons or X | L2 + R2 |
| Weapons | 1-4 / wheel | △, d-pad |
| Scoreboard (online) | Tab | Create |
| Menu | Esc | Options |

On-screen hints follow whichever device you touched last.

### Phones and tablets

Touch controls appear automatically on touch devices (landscape). Left thumb: a floating joystick (push to the
edge to sprint). Right thumb: drag to look; the fire and scope buttons also turn the view while held.
Every action has a button: fire, scope/block, jump, slide, dash, grapple (hold to reel), katana slash, reload,
grenade (hold to throw further), weapon slots 1-4, scoreboard and pause. Look speed starts at 200% and the game asks a few times whether it feels right. In settings, Customize buttons lets you drag
every button and the joystick, and set each one's size and opacity (plus an overall opacity and a fixed-stick option). A
low-quality mode is there too. To try it on a phone on your wifi run
`python3 serve.py 8910 0.0.0.0` and open `http://<your-pc-ip>:8910`. On iPhone use Share > Add to Home Screen for fullscreen.

## Weapons and gear

Rifle, shotgun, sniper (with scope) and a katana. Holding block with the katana parries
some incoming bullets and returns a share of them. Katana kills charge a gauge; when it is lit you
can dash to a marked enemy and execute it (solo only). Grenades bounce, then go off in a thick orange blast that scorches the paper; holding the
button winds up a longer throw and shows the arc. The grapple runs on breath: hanging drains it,
landing refills it, and a slash through someone's rope cuts it. Against other players a raised katana parries
slashes and turns some bullets aside, and the guns use their own damage table; the sniper still erases in one shot.

## Maps

- **Doodle District**: streets, rooftops and fire escapes, with grapple rings on the high spots. Solo
  plays the tight original block. A match opens it up: a ring of empty street, walls, a ribbed dome
  that cannot be hooked, an open field in the middle crossed by a ruler bridge, a few pads hung from
  the dome, and slow paper planes you can hook and ride (the solo planes too).
- **Doodle Mexico**: a sun-baked pueblo. A plaza with a fountain and a giant sombrero floating over it,
  a bandstand where three mariachis never stop playing, a church with a bell tower you can climb and
  a domed second tower, adobe houses with roof stairs, papel picado strung across the square, a
  market of striped stalls and hanging piñatas, a taco cart, cacti and mesas all around. Pots, crates,
  barrels, cacti and piñatas all break under bullets, blades and blasts; piñatas drop tacos, which are
  the health pickups here. The map plays its own mariachi waltz.

Pick the map on the main menu for solo; the host picks it in the lobby for a match, and everyone
starts in a different spot.

## Enemies

Grunts, rushers, bombers, snipers with dodgeable lasers, flyers, heavies and shield bearers. Bosses
rotate: The Doodler, The Eraser and The Inkblot, each with its own moves.

## How the look works

The scene renders to a buffer holding shade, an ink id and view-space normals plus a float depth.
A post pass draws outlines from an inverse-depth Laplacian, adds surface-following hatching, paper
grain, ruled lines and the red margin. Wobble is static so nothing flickers.
