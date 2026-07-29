import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { NAV_ROUTES } from '@/app/routes';
import { useAuth } from '@/app/providers/AuthProvider';
import { signOutCurrentUser } from '@/services/auth';
import type { UserRole } from '@/domain';
import './AppLayout.css';

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  operator: 'Operador',
  viewer: 'Consulta',
};

/** Marco principal de la aplicación: barra lateral de navegación + contenido. */
export function AppLayout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();

  return (
    <div className="layout">
      <header className="topbar">
        <button
          className="topbar__toggle"
          aria-label="Abrir navegación"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          ☰
        </button>
        <span className="topbar__brand">
          SIGNAM <strong>V2</strong>
        </span>
        <span className="topbar__spacer" />
        {user && (
          <>
            <span className="topbar__user text-muted">{user.email}</span>
            <span className="badge badge-info">{ROLE_LABELS[user.role]}</span>
            <button
              className="btn btn-secondary topbar__logout"
              onClick={() => void signOutCurrentUser()}
            >
              Cerrar sesión
            </button>
          </>
        )}
      </header>

      <div className="layout__body">
        <nav
          className={`sidebar ${open ? 'sidebar--open' : ''}`}
          aria-label="Navegación principal"
        >
          <div className="sidebar__title">Módulos</div>
          <ul className="sidebar__list">
            {NAV_ROUTES.map((route) => (
              <li key={route.path}>
                <NavLink
                  to={route.path}
                  end={route.path === '/'}
                  className={({ isActive }) =>
                    `sidebar__link ${isActive ? 'sidebar__link--active' : ''}`
                  }
                  onClick={() => setOpen(false)}
                >
                  <span aria-hidden="true">{route.icon}</span>
                  {route.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {open && (
          <div
            className="sidebar__backdrop"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
        )}

        <main className="content">{children}</main>
      </div>
    </div>
  );
}
