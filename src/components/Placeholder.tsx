import type { ReactNode } from 'react';

/**
 * Bloque para funcionalidad planificada pero aún no implementada en esta
 * entrega. Deja explícito el alcance pendiente en lugar de simularlo.
 */
export function Placeholder({
  title,
  items,
  children,
}: {
  title: string;
  items?: string[];
  children?: ReactNode;
}) {
  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span className="badge badge-muted">Próximamente</span>
        <h2 style={{ fontSize: '1.05rem', margin: 0 }}>{title}</h2>
      </div>
      {children && <p className="text-muted">{children}</p>}
      {items && items.length > 0 && (
        <ul className="text-muted" style={{ marginBottom: 0 }}>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
