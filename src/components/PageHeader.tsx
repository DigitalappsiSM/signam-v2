import type { ReactNode } from 'react';

/** Encabezado estándar de página: título, descripción y acciones opcionales. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '1rem',
        flexWrap: 'wrap',
        marginBottom: '1.5rem',
      }}
    >
      <div>
        <h1 style={{ fontSize: '1.5rem' }}>{title}</h1>
        {description && (
          <p className="text-muted" style={{ margin: 0, maxWidth: '60ch' }}>
            {description}
          </p>
        )}
      </div>
      {actions && <div>{actions}</div>}
    </header>
  );
}
