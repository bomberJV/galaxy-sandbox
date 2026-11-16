# Galaxy Sandbox

A visual, browser-local experiment in fixed gravitational fields. Rotate a three-dimensional star field, change its halo, launch orbit tracers, and compare two possible evolutions from exactly the same particle state.

This is an educational simulation, not a cosmological solver or a rerun of the SPARC research. No measured galaxy data is loaded. No external libraries, network services, accounts, or API keys are required.

## Run

Serve the extracted project root with `python3 -m http.server 8000`, then open `http://localhost:8000/gravity/`. Use HTTP because the app uses ES modules. The source collection includes shared base styling one directory above this app.

With Node.js 22 or newer, run the dedicated physics checks from the project root:

```sh
node --test tests/gravity.test.mjs
```

## Experiments

- **Invisible halo:** the central component plus a broad logarithmic halo. Outer stars start near their local circular speeds.
- **Stars alone:** the same central potential without a halo. A new scenario initializes its own appropriate circular speeds.
- **Compact core:** a more concentrated, more massive central component with a weaker halo.
- **Split the universe:** clones current positions and velocities, then changes only the comparison halo. The original universe continues. No interaction occurs between panels.
- **Remove / add halo:** changes the current force instantly while preserving velocities. In split mode it starts a fresh comparison from that instant.
- **Tracers:** circular, 35% faster than circular, inward plunge, or fixed-velocity flyby. Up to six colored paths; a new one replaces the oldest. In split mode, both receive the same launch state.

The three experiment cards make the important comparisons directly. Simulations use a repeatable seed, so Restart reproduces the same starting stars.

## Controls

Drag the galaxy to rotate; tap to place a tracer. Buttons provide launch, pause, reset, split view, speed, camera orientation, and zoom. With canvas focus:

| Key | Action |
| --- | --- |
| Arrow keys | Rotate camera |
| `+`, `-` | Zoom |
| Space | Pause / play |
| L | Launch tracer at the default location |
| R | Restart current scenario and camera |

Reduced-motion preference starts the model paused. Hidden and offscreen canvases do not keep advancing. Paused graphics redraw only when an interaction or resize needs it. Mobile split view stacks the universes vertically so each remains usable.

## The model

All quantities are dimensionless. Let `s = sqrt(x² + y² + z² + ε²)` with `ε = 0.06`.

```text
Potential:    Φ = -M/(s + a) + (H/2) log(s² + 4)
Acceleration: a⃗ = -r⃗ [M/(s(s+a)²) + H/(s²+4)]
Circular:     v_c(r) = sqrt(-r × a_x(r,0,0))
```

| Scenario | M | a | H |
| --- | ---: | ---: | ---: |
| Invisible halo | 1 | 1 | 1 |
| Stars alone | 1 | 1 | 0 |
| Compact core | 2 | 0.35 | 0.45 |

The central potential is softened to keep radial close approaches finite. The displayed rotation curve is calculated from this same force, rather than being an unrelated illustration. The halo is logarithmic and extends indefinitely, so the app deliberately does not label particles “escaped.”

A kick–drift–kick leapfrog advances star tracers at a fixed `0.02` time step. Orbit probes use eight `0.0025` substeps to resolve close passes more accurately. A capped accumulator keeps browser frame-rate fluctuations from turning into huge integration steps. When a device cannot keep up, simulated time slows rather than skipping physics. One real second at 1× corresponds to one simulated time unit when the device keeps up.

Trails sample every `0.1` units and retain 420 samples, covering the most recent 42 units. Radius and speed readouts are model diagnostics, not observations. Energy changes intentionally when a mass component is toggled. Numerical trajectories remain approximate.

## Four modes

The page has four tabs. The first, **Halo lab**, is the original fixed-field sandbox described above. The other three were added in November 2026. Links like `gravity/#collapse` open a tab directly.

### Let it collapse (self-gravity)

Every star pulls on every other star through a Barnes–Hut octree (quadrupole moments, θ = 1.0, softening 0.05) in a module worker (`nbody-worker.js`). Units: G = 1, disk mass 1, exponential scale length 1; time is reported in turns of the disk at 2.2 scale lengths (`tRot`). Disks are built from Toomre Q with asymmetric-drift correction (`ics.js`). Halos here are rigid Hernquist potentials, as in Ostriker & Peebles (1973):

| Preset | Halo | Outcome in the tests (4,000 particles, three seeds) |
| --- | --- | --- |
| No halo | none | bar forms; peak bar strength A2 0.27–0.31 between 2 and 3.5 turns |
| Light halo | Hernquist M = 2, a = 3 | bar still forms (A2 ≈ 0.34 for seed 7) |
| Heavy halo | Hernquist M = 8, a = 2 | stays round; A2 0.06–0.07 |

Bar strength is the m = 2 Fourier amplitude of the disk inside 1.5 scale lengths. Desktops run 4,000 particles per disk, phones 2,500; below about 3,000 particles noise heats the disk and the bar is weaker.

### Collide

Two disk galaxies with bulges and live (particle) dark-matter halos on a bound orbit. With halos, dynamical friction drains the orbit and the galaxies merge in about four to five turns; the same starting orbit without halos flies apart (test: final separation 0.1 against 59 disk scale lengths). Options: halos on, off or side by side; prograde, retrograde or tilted encounter; equal or 3 : 1 mass; close or wide pericentre. 4,000 particles total on desktops, 2,500 on phones.

### Real galaxies

All 175 SPARC galaxies (Lelli, McGaugh & Schombert 2016, AJ 152, 157), compiled by `tools/build_sparc.py` into `sparc-data.json`. Test-particle stars and gas start at the measured speeds; the field can be the one the measured curve implies, stars and gas only, or your own halo model. The fitting panel offers NFW, Burkert and pseudo-isothermal halos with a stellar mass-to-light slider (bulge M/L = 1.4 × disk). Fits use the dark-matter working paper's method (5 km/s error floor, log ρ and log r_s within [3, 11] × [−1.5, 2.5]) and reproduce all 200 of its NFW and Burkert χ² values. Challenge mode asks you to fit ten chosen galaxies to three stars (χ² per point ≤ 1.5) and keeps progress in browser storage.

## Scope and limitations

- **Halo lab:** tracers do not gravitate; the field is spherical; the initial spiral is an arrangement of points that winds up; the purple cloud represents the assumed halo, not observed emission.
- **Let it collapse and Collide:** a few thousand particles, far below research simulations; outcomes vary with the random seed in detail. No gas, star formation or cosmological setting. Rigid halos in the bar experiment cannot respond to the bar.
- **Real galaxies:** the star field is a set of test particles in the chosen field, not a model of the galaxy's formation. Fits assume dark matter; a rotation curve alone cannot decide between dark matter and modified gravity. Distances and mass-to-light ratios are taken as given; changing M/L changes the verdict for some large spirals (for example NGC 5055, NGC 7331).
- None of these modes is new evidence for or against dark matter.

## Implementation and verification

- `physics.js`: pure deterministic model, integration, seed generation, cloning, and probe construction.
- `app.js`: canvas projection/rendering, animation lifecycle, comparison experiments, controls, and computed SVG curve.
- `app.css`: local responsive layout and observatory styling.
- `index.html`: semantic controls, model documentation, and accessible fallbacks.
- `modes.js`, `modes.css`: tab switching and the Let it collapse / Collide controllers.
- `nbody.js`, `ics.js`, `nbody-worker.js`: tree code, initial conditions and worker protocol.
- `nbody-view.js`: shared renderer and worker driver for the N-body modes.
- `sparc.js`, `sparc-data.json`, `real-view.js`: SPARC data, mass models, fitting, scoring and the Real galaxies view.

Eight automated tests check the force against the potential gradient, circular balance across presets, long-run orbital/angular-momentum stability, core convergence, repeatability, comparison isolation, the expected outward motion after halo removal, and bounded close-pass probe energy error. The N-body tests check tree forces against direct summation, energy and momentum conservation, bar formation without a halo and its absence with a heavy halo, merging with live halos against escape without them, and the worker protocol. The SPARC tests check the data against the raw files, reproduce the working paper's halo fits, and confirm every challenge is solvable. These tests cover the numerical model; browser rendering, controls, and device-specific behavior require separate manual checks. They are not a guarantee for every possible orbit.
