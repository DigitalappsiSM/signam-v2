import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import { AuthProvider } from './app/providers/AuthProvider';
import { initTheme } from './app/theme';
// Fuentes empaquetadas (self-hosted, sin depender de red externa en runtime).
// Inter Variable = cuerpo/UI; Space Grotesk Variable = display/marca.
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import './styles/global.css';

// Aplica el tema (claro/oscuro) antes del render para evitar parpadeo.
initTheme();

const container = document.getElementById('root');
if (!container) {
  throw new Error('No se encontró el elemento raíz #root');
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
