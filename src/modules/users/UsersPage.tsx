import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/app/providers/AuthProvider';
import { can } from '@/app/permissions';
import {
  listManagedUsers,
  setUserRole,
  userAdminErrorMessage,
  type ManagedUser,
} from '@/services/users';
import { USER_ROLES, type UserRole } from '@/domain';
import './UsersPage.css';

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  operator: 'Operador',
  viewer: 'Consulta',
};

const ROLE_BADGE: Record<UserRole, string> = {
  admin: 'badge-brand',
  operator: 'badge-info',
  viewer: 'badge-muted',
};

/** Estado de la fila de un usuario mientras se edita/guarda su rol. */
interface RowState {
  /** Rol seleccionado en el desplegable (aún sin guardar). */
  selected: UserRole;
  saving: boolean;
  feedback: { kind: 'ok' | 'error'; text: string } | null;
}

/**
 * Página "Usuarios y permisos" (solo administradores).
 *
 * Lista los usuarios de Firebase Authentication y permite cambiar su rol. El
 * cambio se aplica en el servidor (Cloud Function con Admin SDK): actualiza el
 * custom claim —fuente de verdad del rol— y registra la acción en auditoría.
 * El acceso está protegido en tres capas: la navegación oculta el enlace, esta
 * página verifica el permiso, y cada operación la valida el servidor.
 */
export function UsersPage() {
  const { user } = useAuth();
  const allowed = user ? can(user.role, 'users.manage') : false;

  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listManagedUsers();
      setUsers(list);
      setRows(
        Object.fromEntries(
          list.map((u) => [
            u.uid,
            { selected: u.role, saving: false, feedback: null } as RowState,
          ]),
        ),
      );
    } catch (e) {
      setError(userAdminErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    void reload();
  }, [allowed, reload]);

  const onSelect = useCallback((uid: string, selected: UserRole) => {
    setRows((prev) => {
      const base = prev[uid];
      if (!base) return prev;
      return { ...prev, [uid]: { ...base, selected, feedback: null } };
    });
  }, []);

  const onSave = useCallback(
    async (u: ManagedUser) => {
      const row = rows[u.uid];
      if (!row || row.selected === u.role) return;
      setRows((prev) => {
        const base = prev[u.uid];
        if (!base) return prev;
        return { ...prev, [u.uid]: { ...base, saving: true, feedback: null } };
      });
      try {
        await setUserRole(u.uid, row.selected);
        // Refleja el nuevo rol como rol actual de la fila.
        setUsers((prev) =>
          prev.map((x) =>
            x.uid === u.uid ? { ...x, role: row.selected } : x,
          ),
        );
        setRows((prev) => ({
          ...prev,
          [u.uid]: {
            selected: row.selected,
            saving: false,
            feedback: { kind: 'ok', text: 'Rol actualizado.' },
          },
        }));
      } catch (e) {
        setRows((prev) => {
          const base = prev[u.uid];
          if (!base) return prev;
          return {
            ...prev,
            [u.uid]: {
              ...base,
              saving: false,
              feedback: { kind: 'error', text: userAdminErrorMessage(e) },
            },
          };
        });
      }
    },
    [rows],
  );

  if (!allowed) {
    return (
      <>
        <PageHeader title="Usuarios y permisos" />
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="badge badge-warning">Acceso restringido</span>
            <h2 style={{ fontSize: '1.05rem', margin: 0 }}>
              Solo para administradores
            </h2>
          </div>
          <p className="text-muted" style={{ marginBottom: 0 }}>
            Esta sección permite gestionar usuarios y roles. Tu cuenta no tiene
            el permiso <code>users.manage</code>. Si necesitas acceso, pide a un
            administrador que te asigne el rol correspondiente.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Usuarios y permisos"
        description="Administra los usuarios y su rol. El cambio de rol se aplica de inmediato en el servidor y queda registrado en el historial."
        actions={
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void reload()}
            disabled={loading}
          >
            Recargar
          </button>
        }
      />

      {error && (
        <div className="card users__error" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="card text-muted">Cargando usuarios…</div>
      ) : users.length === 0 && !error ? (
        <div className="card text-muted">
          No hay usuarios para mostrar. Crea usuarios en Firebase Authentication
          e invítalos a la aplicación.
        </div>
      ) : (
        <div className="card users__table-wrap">
          <table className="users__table">
            <thead>
              <tr>
                <th scope="col">Usuario</th>
                <th scope="col">Rol actual</th>
                <th scope="col">Cambiar rol</th>
                <th scope="col" className="users__col-action">
                  <span className="visually-hidden">Acción</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const row = rows[u.uid];
                const isSelf = user?.uid === u.uid;
                const changed = row && row.selected !== u.role;
                return (
                  <tr key={u.uid}>
                    <td>
                      <div className="users__identity">
                        <span className="users__email">
                          {u.email || '(sin correo)'}
                          {isSelf && (
                            <span className="badge badge-info users__you">
                              Tú
                            </span>
                          )}
                          {u.disabled && (
                            <span className="badge badge-warning">
                              Deshabilitado
                            </span>
                          )}
                        </span>
                        {u.displayName && (
                          <span className="users__name text-muted">
                            {u.displayName}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${ROLE_BADGE[u.role]}`}>
                        {ROLE_LABELS[u.role]}
                      </span>
                    </td>
                    <td>
                      <label className="visually-hidden" htmlFor={`role-${u.uid}`}>
                        Rol de {u.email}
                      </label>
                      <select
                        id={`role-${u.uid}`}
                        className="users__select"
                        value={row?.selected ?? u.role}
                        disabled={isSelf || row?.saving}
                        onChange={(e) =>
                          onSelect(u.uid, e.target.value as UserRole)
                        }
                      >
                        {USER_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="users__col-action">
                      {isSelf ? (
                        <span className="text-muted users__self-note">
                          No puedes cambiar tu propio rol
                        </span>
                      ) : (
                        <div className="users__action">
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={!changed || row?.saving}
                            onClick={() => void onSave(u)}
                          >
                            {row?.saving ? 'Guardando…' : 'Guardar'}
                          </button>
                          {row?.feedback && (
                            <span
                              className={
                                row.feedback.kind === 'ok'
                                  ? 'users__ok'
                                  : 'users__err-inline'
                              }
                              role="status"
                            >
                              {row.feedback.text}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
