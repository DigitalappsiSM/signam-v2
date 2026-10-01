import { useEffect, useRef, type ReactNode } from 'react';
import { Icon, type IconName } from '@/components/Icon';

/**
 * Ventana flotante translúcida del Centro de Control: detalle de tienda,
 * estado, tipo de incidencia o KPI. Cierra con Escape, con el botón o al pulsar
 * fuera, y devuelve el foco a quien la abrió.
 */
export function GlassDialog({
  title,
  subtitle,
  icon,
  tone = 'info',
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: IconName;
  tone?: 'info' | 'success' | 'warning' | 'danger' | 'violet';
  onClose: () => void;
  children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="cc-dialog" onClick={onClose}>
      <div
        className="cc-dialog__card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="cc-dialog__head">
          <span className={`cc-icon cc-icon--${tone}`} aria-hidden="true">
            <Icon name={icon} size={20} />
          </span>
          <div className="cc-dialog__titles">
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            ref={closeRef}
            type="button"
            className="cc-dialog__close"
            aria-label="Cerrar"
            onClick={onClose}
          >
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="cc-dialog__body">{children}</div>
      </div>
    </div>
  );
}
