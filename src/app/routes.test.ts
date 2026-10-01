import { describe, expect, it } from 'vitest';
import {
  NAV_ROUTES,
  canAccessRoute,
  routeByPath,
  groupedNavRoutes,
} from './routes';

describe('rutas del perfil Comercial', () => {
  it('sitúa Odoo al final de Operación para todos los roles autorizados', () => {
    for (const role of ['admin', 'operator', 'viewer'] as const) {
      const operation = groupedNavRoutes((route) =>
        canAccessRoute(role, route),
      ).find((group) => group.group === 'Operación');
      expect(operation?.routes[operation.routes.length - 1]?.path).toBe(
        '/analisis-incidencias-odoo',
      );
    }
  });
  it('limita la navegación a Panel, Campañas y Seguimiento operativo', () => {
    const visible = NAV_ROUTES.filter((route) =>
      canAccessRoute('commercial', route),
    ).map((route) => route.path);

    expect(visible).toEqual(['/', '/seguimiento', '/campanas']);
  });

  it('bloquea rutas directas fuera de su lista permitida', () => {
    const reporting = routeByPath('/reporting');
    const users = routeByPath('/usuarios');
    expect(reporting && canAccessRoute('commercial', reporting)).toBe(false);
    expect(users && canAccessRoute('commercial', users)).toBe(false);
  });

  it('conserva el acceso histórico de los demás roles', () => {
    const reconciliation = routeByPath('/conciliacion');
    expect(reconciliation && canAccessRoute('viewer', reconciliation)).toBe(
      true,
    );
  });

  it('reserva el histórico crudo y la conciliación Quividi para admin', () => {
    const history = routeByPath('/historial-quividi');
    expect(history && canAccessRoute('admin', history)).toBe(true);
    for (const role of ['operator', 'viewer', 'commercial'] as const) {
      expect(history && canAccessRoute(role, history)).toBe(false);
    }
  });
});
