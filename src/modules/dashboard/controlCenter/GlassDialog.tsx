import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '@/components/Icon';
import './ControlCenter.css';

/**
 * Ventana flotante translúcida del Panel: detalle de tienda, estado, tipo de
 * incidencia, KPI, tarjeta del semáforo o barra de la carga. Se monta en
 * `document.body` (el desenfoque cubre toda la página y no abre espacio en el
 * flujo), cierra con Escape, con el botón o al pulsar fuera, y devuelve el foco
 * a quien la abrió.
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
  subtitle?: ReactNode;
  icon: IconName;
  tone?: 'info' | 'success' | 'warning' | 'danger' | 'violet';
  onClose: () => void;
  children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  // `onClose` suele ser una función nueva en cada render: se lee por ref para
  // que un recálculo (p. ej. un filtro) no vuelva a robar el foco.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, []);

  return createPortal(
    <div className="cc-dialog" onClick={() => onCloseRef.current()}>
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
            onClick={() => onCloseRef.current()}
          >
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="cc-dialog__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
