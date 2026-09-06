import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';

import { App } from './app.js';
import './theme/tokens.css';
import './studio.css';

const host = document.getElementById('root');
if (host === null) {
  // Refuse rather than create the node. A missing mount point means the shipped
  // index.html is not the one this bundle was built for, and silently inventing
  // a root hides that until something subtler breaks.
  throw new Error('#root is missing from the document; the shell cannot mount.');
}

createRoot(host).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
