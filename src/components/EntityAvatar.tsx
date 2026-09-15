import './EntityAvatar.css';

/**
 * Cuadro con iniciales o número, coloreado, al estilo de las tablas del mockup.
 * Es solo presentación: cuando `decorative` es true (el texto real está al lado)
 * se oculta a lectores de pantalla; en otro caso el `label` es la información.
 */
export function EntityAvatar({
  label,
  color,
  title,
  decorative = false,
}: {
  label: string;
  color?: string;
  title?: string;
  decorative?: boolean;
}) {
  return (
    <span
      className="entity-avatar"
      style={color ? { background: color } : undefined}
      title={title}
      aria-hidden={decorative || undefined}
    >
      {label}
    </span>
  );
}
