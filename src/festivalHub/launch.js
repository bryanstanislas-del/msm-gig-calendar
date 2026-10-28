// Festival Hub build mode, fixed at build time. The standalone Vite config
// defines import.meta.env.VITE_HUB_LAUNCH ("1" only for launch builds -- see
// scripts/standalone/mode.mjs); every other build, and the tests, get staging.
// Kept as literal comparisons so the bundler can drop disabled code (the demo).
export const LAUNCH_MODE = import.meta.env.VITE_HUB_LAUNCH === "1";
// The fictional demo is staging-only; launch builds never offer or bundle it.
export const DEMO_ENABLED = import.meta.env.VITE_HUB_LAUNCH !== "1";
