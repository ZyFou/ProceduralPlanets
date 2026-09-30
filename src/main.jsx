import React from 'react';
import { createRoot } from 'react-dom/client';
import Root from './Root.jsx';
import { AuthProvider } from './auth/AuthContext.jsx';
import { PopupProvider } from './components/ui/PopupProvider.jsx';
import './cursors.css';
import './styles.css';

// modules are in: the loading screen moves on to the engine (App.jsx)
window.__ppLoader?.progress(0.1, 'Starting engine', 0.14);
performance.mark('pp:modules-loaded');
createRoot(document.getElementById('root')).render(
  <PopupProvider>
    <AuthProvider>
      <Root />
    </AuthProvider>
  </PopupProvider>,
);
