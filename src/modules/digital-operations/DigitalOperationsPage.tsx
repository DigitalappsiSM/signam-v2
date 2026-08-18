import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/providers/AuthProvider';
import { can } from '@/app/permissions';
import { PageHeader } from '@/components/PageHeader';
import {
  DIGITAL_CHECK_KEYS,
  digitalProgress,
  type DigitalOperationalItem,
  type DigitalOperationalTracking,
} from '@/domain/digital-operations';
import { listDigitalOperationalItems } from '@/services/digitalOperationalItems';
import {
  appendDigitalComment,
  listDigitalTracking,
  setDigitalCheck,
  setDigitalLifecycle,
} from '@/services/digitalOperationalTracking';
import '../digital-import/digital.css';
const labels = {
  downloadLink: 'Link de descarga',
  retailerValidation: 'Validación cadena',
  cmsProgramming: 'Programación CMS',
};
export function DigitalOperationsPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<DigitalOperationalItem[]>([]),
    [tracking, setTracking] = useState<DigitalOperationalTracking[]>([]),
    [query, setQuery] = useState(''),
    [retailer, setRetailer] = useState(''),
    [lifecycle, setLifecycle] = useState('');
  const actor = { uid: user?.uid ?? '', email: user?.email ?? '' },
    editable = !!user && can(user.role, 'digitalOperations.track');
  async function load() {
    setItems(await listDigitalOperationalItems());
    setTracking(await listDigitalTracking());
  }
  useEffect(() => {
    void load();
  }, []);
  const byId = useMemo(
    () => new Map(tracking.map((t) => [t.id, t])),
    [tracking],
  );
  const filtered = useMemo(
    () =>
      items.filter((i) => {
        const t = byId.get(i.id),
          search =
            `${i.campaignNumber} ${i.creativityId} ${i.creativityTitle} ${i.client} ${i.advertiser}`.toLowerCase();
        return (
          (!query || search.includes(query.toLowerCase())) &&
          (!retailer || i.retailerCode === retailer) &&
          (!lifecycle || (t?.lifecycleStatus ?? 'active') === lifecycle)
        );
      }),
    [items, byId, query, retailer, lifecycle],
  );
  async function check(
    item: DigitalOperationalItem,
    key: (typeof DIGITAL_CHECK_KEYS)[number],
    value: boolean,
  ) {
    await setDigitalCheck(item.id, key, value, actor);
    await load();
  }
  async function toggleLifecycle(
    item: DigitalOperationalItem,
    t: DigitalOperationalTracking,
  ) {
    const cancel = t.lifecycleStatus !== 'cancelled';
    const reason = cancel
      ? (window.prompt('Motivo opcional de cancelación') ?? '')
      : '';
    if (
      cancel &&
      !window.confirm(
        '¿Cancelar esta operación? Sus checks y comentarios se conservarán.',
      )
    )
      return;
    await setDigitalLifecycle(item.id, cancel, reason, actor);
    await load();
  }
  async function comment(item: DigitalOperationalItem) {
    const text = window.prompt('Agregar comentario');
    if (text) {
      await appendDigitalComment(item.id, text, actor);
      await load();
    }
  }
  return (
    <section>
      <PageHeader
        title="Operación Digital"
        description="Seguimiento externo de La Comer y Chedraui. Solo tres indicadores; sin testigos ni Admira."
      />
      <div className="digital-filters">
        <input
          aria-label="Buscar"
          placeholder="Campaña o creatividad"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Retailer"
          value={retailer}
          onChange={(e) => setRetailer(e.target.value)}
        >
          <option value="">Todos los retailers</option>
          <option value="LA_COMER">La Comer</option>
          <option value="CHEDRAUI">Chedraui</option>
        </select>
        <select
          aria-label="Estado"
          value={lifecycle}
          onChange={(e) => setLifecycle(e.target.value)}
        >
          <option value="">Activas y canceladas</option>
          <option value="active">Activas</option>
          <option value="cancelled">Canceladas</option>
        </select>
      </div>
      <div className="digital-table-wrap">
        <table className="digital-table">
          <thead>
            <tr>
              <th>Estado</th>
              <th>Retailer</th>
              <th>Campaña</th>
              <th>Cliente / anunciante</th>
              <th>Soporte</th>
              <th>Catorcena</th>
              <th>Fijación / retirada</th>
              <th>Modo</th>
              <th>Creatividad</th>
              <th>Centros / soportes</th>
              <th>Indicadores</th>
              <th>Avance</th>
              <th>Comentarios</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => {
              const t = byId.get(item.id);
              if (!t) return null;
              const cancelled = t.lifecycleStatus === 'cancelled';
              return (
                <tr key={item.id}>
                  <td>
                    <button
                      disabled={!editable}
                      onClick={() => void toggleLifecycle(item, t)}
                    >
                      {cancelled ? 'Cancelada' : 'Activa'}
                    </button>
                  </td>
                  <td>{item.retailerLabel}</td>
                  <td>{item.campaignNumber}</td>
                  <td>
                    {item.client}
                    <br />
                    {item.advertiser}
                  </td>
                  <td>{item.supportLabel}</td>
                  <td>{item.periodLabel}</td>
                  <td>
                    {item.fixationStart}
                    <br />
                    {item.fixationEnd}
                  </td>
                  <td>
                    {item.placementMode === 'fixation'
                      ? 'Fijación'
                      : 'Continua'}
                  </td>
                  <td>
                    {item.creativityId}
                    <br />
                    {item.creativityTitle} · {item.creativityStatus}
                  </td>
                  <td>
                    {item.centers} / {item.supports}
                  </td>
                  <td>
                    {cancelled ? (
                      'No aplica'
                    ) : (
                      <div className="digital-checks">
                        {DIGITAL_CHECK_KEYS.map((key) => (
                          <label key={key} title={labels[key]}>
                            <input
                              aria-label={labels[key]}
                              type="checkbox"
                              disabled={!editable}
                              checked={t.checks[key].completed}
                              onChange={(e) =>
                                void check(item, key, e.target.checked)
                              }
                            />
                            {labels[key]}
                          </label>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>
                    {digitalProgress(t) == null
                      ? 'No aplica'
                      : `${Math.round((digitalProgress(t) ?? 0) * 100)}%`}
                  </td>
                  <td>
                    <button onClick={() => void comment(item)}>
                      Comentarios ({t.comments.length})
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
