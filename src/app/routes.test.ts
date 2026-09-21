import { describe, expect, it } from 'vitest';
import { NAV_ROUTES, canAccessRoute, routeByPath } from './routes';

describe('rutas del perfil Comercial', () => {
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
});
