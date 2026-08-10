import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { NAV_ROUTES, groupedNavRoutes } from '@/app/routes';
import { useAuth } from '@/app/providers/AuthProvider';
import { can } from '@/app/permissions';
import { useTheme } from '@/app/theme';
import { signOutCurrentUser } from '@/services/auth';
import { Icon } from '@/components/Icon';
import { BrandLogo } from '@/components/BrandLogo';
import type { UserRole } from '@/domain';
import './AppLayout.css';

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  operator: 'Operador',
  viewer: 'Consulta',
};

/** Botón de cambio de tema claro/oscuro con icono de sol/luna. */
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
      <Icon name={isDark ? 'sun' : 'moon'} />
    </button>
  );
}

/** Título/contexto de la página actual a partir de la ruta activa. */
function usePageTitle(): {
  label: string;
  icon: (typeof NAV_ROUTES)[number]['icon'];
} {
  const { pathname } = useLocation();
  const exact = NAV_ROUTES.find((r) => r.path === pathname);
  if (exact) return { label: exact.label, icon: exact.icon };
  // Coincidencia por prefijo para rutas de detalle (la más específica gana).
  const prefix = NAV_ROUTES.filter(
    (r) => r.path !== '/' && pathname.startsWith(r.path),
  ).sort((a, b) => b.path.length - a.path.length)[0];
  if (prefix) return { label: prefix.label, icon: prefix.icon };
  return { label: 'SIGNAM V2', icon: 'dashboard' };
}

/** Marco principal de la aplicación: barra lateral de navegación + contenido. */
export function AppLayout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const page = usePageTitle();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);

  // Oculta de la navegación las rutas restringidas cuyo permiso no tenga el rol
  // actual (p. ej. "Usuarios y permisos" solo para admins). No es control de
  // seguridad por sí solo: la página también verifica el permiso y el servidor
  // valida cada operación.
  const groups = groupedNavRoutes((route) =>
    route.permission ? (user ? can(user.role, route.permission) : false) : true,
  );

  // En móvil el menú es un cajón: se cierra con Escape y devuelve el foco al
  // botón que lo abrió (gestión de foco accesible). Al abrir, enfoca el menú.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    sidebarRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="layout">
      <nav
        id="app-sidebar"
        ref={sidebarRef}
        tabIndex={-1}
        className={`sidebar ${open ? 'sidebar--open' : ''}`}
        aria-label="Navegación principal"
      >
        <div className="sidebar__brand">
          <BrandLogo variant="white" height={30} className="sidebar__logo" />
          <span className="sidebar__product">SIGNAM V2</span>
        </div>

        <div className="sidebar__nav">
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
                        <Icon name={route.icon} />
                      </span>
                      {route.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      {open && (
        <div
          className="sidebar__backdrop"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <div className="layout__main">
        <header className="topbar">
          <button
            ref={toggleRef}
            className="topbar__toggle"
            aria-label={open ? 'Cerrar navegación' : 'Abrir navegación'}
            aria-expanded={open}
            aria-controls="app-sidebar"
            onClick={() => setOpen((v) => !v)}
          >
            <Icon name={open ? 'close' : 'menu'} size={22} />
          </button>

          <span className="topbar__page">
            <span className="topbar__page-icon" aria-hidden="true">
              <Icon name={page.icon} />
            </span>
            <span className="topbar__page-title">{page.label}</span>
          </span>

          <span className="topbar__spacer" />

          <span className="topbar__status" title="Servicios en línea">
            <span className="topbar__status-dot" aria-hidden="true" />
            En línea
          </span>

          <span className="topbar__divider" aria-hidden="true" />

          <ThemeToggle />

          {user && (
            <>
              <span className="topbar__divider" aria-hidden="true" />
              <div
                className="topbar__user-chip"
                title={user.email ?? undefined}
              >
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
                  <Icon name="power" size={18} />
                </button>
              </div>
            </>
          )}
        </header>

        <main className="content">{children}</main>
      </div>
    </div>
  );
}
