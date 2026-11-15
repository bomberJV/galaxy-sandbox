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

## Scope and limitations

- Tracers do not gravitate; there is no stellar self-gravity, gas, collisions, halo evolution or cosmological expansion.
- The field is spherical, even though the stars start in a thin disk.
- The initial spiral is an arrangement of points. It is not a self-consistent spiral density wave and winds up under differential motion.
- The purple cloud represents the assumed halo. It is not observed dark-matter emission or a particle-density measurement.
- Up to 660 background tracers and six probe paths are rendered in each universe. Tracers outside the current camera frame continue to evolve.
- This model cannot establish or rule out dark matter, explain the SPARC pilot, or infer a real galaxy's mass.

The app links to the separate research report and the [SPARC data](https://astroweb.cwru.edu/SPARC/) for observational context.

## Implementation and verification

- `physics.js`: pure deterministic model, integration, seed generation, cloning, and probe construction.
- `app.js`: canvas projection/rendering, animation lifecycle, comparison experiments, controls, and computed SVG curve.
- `app.css`: local responsive layout and observatory styling.
- `index.html`: semantic controls, model documentation, and accessible fallbacks.

Eight automated tests check the force against the potential gradient, circular balance across presets, long-run orbital/angular-momentum stability, core convergence, repeatability, comparison isolation, the expected outward motion after halo removal, and bounded close-pass probe energy error. These tests cover the numerical model; browser rendering, controls, and device-specific behavior require separate manual checks. They are not a guarantee for every possible orbit.
