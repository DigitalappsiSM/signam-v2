import type { ReactNode } from 'react';
import { LoadingState, type LoadingVariant } from './LoadingState';

/** Pantalla completa centrada para estados globales (cargando, sin config). */
export function StatusScreen({
  title,
  children,
  loadingVariant,
  loadingDescription,
}: {
  title: string;
  children?: ReactNode;
  loadingVariant?: LoadingVariant;
  loadingDescription?: string;
}) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: '440px' }}>
        <div
          style={{
            fontSize: '1.15rem',
            letterSpacing: '0.05em',
            color: 'var(--color-primary)',
            marginBottom: '0.75rem',
          }}
        >
          SIGNAM <strong style={{ color: 'var(--color-text)' }}>V2</strong>
        </div>
        {loadingVariant ? (
          <LoadingState
            variant={loadingVariant}
            title={title}
            description={loadingDescription}
          />
        ) : (
          <>
            <h1 style={{ fontSize: '1.25rem' }}>{title}</h1>
            {children && (
              <p className="text-muted" style={{ margin: 0 }}>
                {children}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
