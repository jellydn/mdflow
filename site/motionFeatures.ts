// Loaded async by LazyMotion (see index.tsx) so framer-motion's animation
// runtime stays out of the critical bundle. Keep this the ONLY module that
// references domAnimation — a static import anywhere would pull the whole
// feature set back into the eager graph. If a component ever needs layout
// animations or drag, swap this export for domMax.
export { domAnimation as default } from 'framer-motion';
