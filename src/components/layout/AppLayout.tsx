import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { groupedNavRoutes } from '@/app/routes';
import { useAuth } from '@/app/providers/AuthProvider';
import { can } from '@/app/permissions';
import { useTheme } from '@/app/theme';
import { signOutCurrentUser } from '@/services/auth';
import type { UserRole } from '@/domain';
import './AppLayout.css';

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  operator: 'Operador',
  viewer: 'Consulta',
};

/** Botón de cambio de tema claro/oscuro. */
function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  return (
    <button
      type="button"
      className="topbar__icon-btn"
      onClick={toggleTheme}
      aria-label={isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
      title={isDark ? 'Tema claro' : 'Tema oscuro'}
    >
      <span aria-hidden="true">{isDark ? '☀️' : '🌙'}</span>
    </button>
  );
}

/** Marco principal de la aplicación: barra lateral de navegación + contenido. */
export function AppLayout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  // Oculta de la navegación las rutas restringidas cuyo permiso no tenga el rol
  // actual (p. ej. "Usuarios y permisos" solo para admins). No es control de
  // seguridad por sí solo: la página también verifica el permiso y el servidor
  // valida cada operación.
  const groups = groupedNavRoutes((route) =>
    route.permission ? (user ? can(user.role, route.permission) : false) : true,
  );

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

        <span className="topbar__status" title="Servicios en línea">
          <span className="topbar__status-dot" aria-hidden="true" />
          En línea
        </span>

        <span className="topbar__spacer" />

        <ThemeToggle />

        {user && (
          <div className="topbar__user-chip" title={user.email ?? undefined}>
            <span className="topbar__avatar" aria-hidden="true">
              {(user.email?.[0] ?? 'U').toUpperCase()}
            </span>
            <span className="topbar__user-meta">
              <span className="topbar__user-email">{user.email}</span>
              <span className="topbar__user-role">
                {ROLE_LABELS[user.role]}
              </span>
            </span>
            <button
              className="topbar__icon-btn topbar__logout"
              onClick={() => void signOutCurrentUser()}
              aria-label="Cerrar sesión"
              title="Cerrar sesión"
            >
              <span aria-hidden="true">⏻</span>
            </button>
          </div>
        )}
      </header>

      <div className="layout__body">
        <nav
          className={`sidebar ${open ? 'sidebar--open' : ''}`}
          aria-label="Navegación principal"
        >
          {groups.map((section) => (
            <div key={section.group} className="sidebar__group">
              <div className="sidebar__title">{section.group}</div>
              <ul className="sidebar__list">
                {section.routes.map((route) => (
                  <li key={route.path}>
                    <NavLink
                      to={route.path}
                      end={route.path === '/'}
                      className={({ isActive }) =>
                        `sidebar__link ${isActive ? 'sidebar__link--active' : ''}`
                      }
                      onClick={() => setOpen(false)}
                    >
                      <span className="sidebar__icon" aria-hidden="true">
                        {route.icon}
                      </span>
                      {route.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
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
