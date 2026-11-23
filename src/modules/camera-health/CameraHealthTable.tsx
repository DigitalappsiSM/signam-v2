import type { ReactNode } from 'react';

export function CameraHealthTable({ children }: { children: ReactNode }) {
  return (
    <div className="camera-health__table-wrap">
      <table className="camera-health__table">
        <CameraHealthTableHead />
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function CameraHealthTableHead() {
  return (
    <thead>
      <tr>
        <th scope="col">Tienda</th>
        <th scope="col">Soporte</th>
        <th scope="col">Cámara</th>
        <th scope="col">Estado</th>
        <th scope="col">Desde</th>
        <th scope="col">Cobertura 11–22</th>
        <th scope="col">OTS</th>
        <th scope="col">Último día</th>
        <th scope="col">Ticket Odoo</th>
      </tr>
    </thead>
  );
}
