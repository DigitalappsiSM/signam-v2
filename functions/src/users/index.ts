import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { recordAuditEvent } from '../audit/recordAuditEvent';

/**
 * Administración de usuarios y roles de SIGNAM V2.
 *
 * El rol efectivo de cada usuario vive en los *custom claims* del token
 * (`request.auth.token.role`): es lo que leen el frontend (`AuthProvider`) y
 * las reglas de Firestore/Storage. Los custom claims SOLO se pueden establecer
 * con credenciales de administrador (Admin SDK), por lo que estas operaciones
 * viven en Cloud Functions y no en el cliente.
 *
 * Ambas funciones exigen que quien las invoque sea `admin`. La colección
 * `users/{uid}` se mantiene como espejo legible del rol (para el historial y
 * para las reglas que lo consultan), pero la fuente de verdad es el claim.
 */

/** Roles válidos. Espejo de `USER_ROLES` en `src/domain/constants.ts`. */
const ROLES = ['admin', 'operator', 'viewer'] as const;
type Role = (typeof ROLES)[number];

function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** Rol del token, con `viewer` como valor por defecto (igual que el cliente). */
function roleFromClaims(claims: Record<string, unknown> | undefined): Role {
  const role = claims?.role;
  return isRole(role) ? role : 'viewer';
}

/** Verifica que quien invoca esté autenticado y sea administrador. */
function assertAdmin(request: CallableRequest): { uid: string; email: string } {
  const auth = request.auth;
  if (!auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  if (roleFromClaims(auth.token) !== 'admin') {
    throw new HttpsError(
      'permission-denied',
      'Solo un administrador puede gestionar usuarios.',
    );
  }
  return { uid: auth.uid, email: (auth.token.email as string | undefined) ?? '' };
}

export interface ManagedUser {
  uid: string;
  email: string;
  displayName: string;
  role: Role;
  disabled: boolean;
  /** Alta en Firebase Auth (epoch ms), si está disponible. */
  createdAt: number | null;
}

/**
 * Lista los usuarios de Firebase Authentication con su rol resuelto desde los
 * custom claims. Solo para administradores.
 */
export const listUsers = onCall(async (request): Promise<{ users: ManagedUser[] }> => {
  assertAdmin(request);

  const users: ManagedUser[] = [];
  let pageToken: string | undefined;
  do {
    const page = await getAuth().listUsers(1000, pageToken);
    for (const u of page.users) {
      users.push({
        uid: u.uid,
        email: u.email ?? '',
        displayName: u.displayName ?? '',
        role: roleFromClaims(u.customClaims),
        disabled: u.disabled,
        createdAt: u.metadata.creationTime
          ? new Date(u.metadata.creationTime).getTime()
          : null,
      });
    }
    pageToken = page.pageToken;
  } while (pageToken);

  users.sort((a, b) => a.email.localeCompare(b.email, 'es'));
  return { users };
});

export interface SetUserRoleData {
  uid: string;
  role: Role;
}

/**
 * Cambia el rol de un usuario: actualiza el custom claim (fuente de verdad),
 * refleja el rol en `users/{uid}`, registra la acción en auditoría y revoca los
 * tokens de refresco para que el nuevo rol aplique cuanto antes.
 *
 * Un administrador NO puede cambiar su propio rol: evita el auto-bloqueo (que
 * el único admin se degrade y nadie pueda volver a asignar roles).
 */
export const setUserRole = onCall(async (request): Promise<{ ok: true; role: Role }> => {
  const actor = assertAdmin(request);

  const data = request.data as Partial<SetUserRoleData> | undefined;
  const uid = data?.uid;
  const role = data?.role;

  if (typeof uid !== 'string' || uid.length === 0) {
    throw new HttpsError('invalid-argument', 'Falta el identificador del usuario.');
  }
  if (!isRole(role)) {
    throw new HttpsError(
      'invalid-argument',
      `Rol inválido. Debe ser uno de: ${ROLES.join(', ')}.`,
    );
  }
  if (uid === actor.uid) {
    throw new HttpsError(
      'failed-precondition',
      'No puedes cambiar tu propio rol.',
    );
  }

  const target = await getAuth()
    .getUser(uid)
    .catch(() => {
      throw new HttpsError('not-found', 'El usuario no existe.');
    });

  const previousRole = roleFromClaims(target.customClaims);
  if (previousRole === role) {
    return { ok: true, role };
  }

  // Fuente de verdad: custom claim. Se conservan otros claims existentes.
  await getAuth().setCustomUserClaims(uid, {
    ...(target.customClaims ?? {}),
    role,
  });

  // Espejo legible del rol para historial y reglas que lo consultan.
  const now = Date.now();
  await getFirestore()
    .collection('users')
    .doc(uid)
    .set(
      {
        uid,
        email: target.email ?? '',
        displayName: target.displayName ?? '',
        role,
        updatedAt: now,
        updatedByUid: actor.uid,
        updatedByEmail: actor.email,
      },
      { merge: true },
    );

  await recordAuditEvent({
    action: 'user.role.update',
    entity: 'users',
    entityId: uid,
    actorUid: actor.uid,
    actorEmail: actor.email,
    before: { role: previousRole },
    after: { role },
  });

  // Invalida los tokens de refresco para que el claim nuevo se propague pronto.
  await getAuth().revokeRefreshTokens(uid);

  return { ok: true, role };
});
