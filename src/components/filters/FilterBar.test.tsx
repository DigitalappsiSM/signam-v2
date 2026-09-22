import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  FilterBar,
  FilterSearch,
  FilterSelect,
  compactChips,
  formatFilterSearch,
} from './index';

function Harness() {
  const [search, setSearch] = useState('');
  const [res, setRes] = useState('');
  const chips = compactChips([
    search.trim() !== '' && {
      key: 'search',
      label: 'Búsqueda',
      value: formatFilterSearch(search),
      onRemove: () => setSearch(''),
    },
    res !== '' && {
      key: 'res',
      label: 'Resolución',
      value: res,
      onRemove: () => setRes(''),
    },
  ]);
  return (
    <FilterBar
      label="Filtros de prueba"
      chips={chips}
      onClear={() => {
        setSearch('');
        setRes('');
      }}
    >
      <FilterSearch label="Buscar" value={search} onChange={setSearch} />
      <FilterSelect label="Resolución" value={res} onChange={setRes}>
        <option value="">Todas</option>
        <option value="1080x1920">1080x1920</option>
      </FilterSelect>
    </FilterBar>
  );
}

describe('FilterBar', () => {
  it('sin filtros no muestra contador, chips ni «Limpiar filtros»', () => {
    render(<Harness />);
    expect(
      screen.getByRole('group', { name: 'Filtros de prueba' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('filtros activos')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Limpiar filtros/ }),
    ).not.toBeInTheDocument();
  });

  it('muestra un chip por filtro, marca el campo y permite quitarlo', async () => {
    render(<Harness />);
    const select = screen.getByLabelText('Resolución');
    await userEvent.selectOptions(select, '1080x1920');
    await userEvent.type(screen.getByLabelText('Buscar'), 'nike');

    expect(screen.getByText('filtros activos')).toBeInTheDocument();
    expect(select.closest('.fb-control')).toHaveClass('is-set');
    expect(screen.getByText('“nike”')).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'Quitar filtro Resolución' }),
    );
    expect(select).toHaveValue('');
    expect(screen.getByText('filtro activo')).toBeInTheDocument();
  });

  it('«Limpiar filtros» restablece todo', async () => {
    render(<Harness />);
    await userEvent.type(screen.getByLabelText('Buscar'), 'nike');
    await userEvent.click(
      screen.getByRole('button', { name: /Limpiar filtros/ }),
    );
    expect(screen.getByLabelText('Buscar')).toHaveValue('');
    expect(
      screen.queryByRole('button', { name: /Quitar filtro/ }),
    ).not.toBeInTheDocument();
  });

  it('la búsqueda se borra con su botón ✕', async () => {
    render(<Harness />);
    await userEvent.type(screen.getByLabelText('Buscar'), 'x');
    await userEvent.click(
      screen.getByRole('button', { name: 'Borrar «Buscar»' }),
    );
    expect(screen.getByLabelText('Buscar')).toHaveValue('');
  });
});
