import React from 'react';
import ReactDOM from 'react-dom/client';
import { LazyMotion } from 'framer-motion';
import App from './App';
import './styles.css';

// Animation features load async (LazyMotion + m components render their
// initial styles immediately; animations attach when the chunk lands).
// `strict` makes any stray full-fat <motion.*> usage throw in dev so the
// slim bundle can't silently regress.
const loadMotionFeatures = () => import('./motionFeatures').then(mod => mod.default);

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <LazyMotion features={loadMotionFeatures} strict>
      <App />
    </LazyMotion>
  </React.StrictMode>
);
