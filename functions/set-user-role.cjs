/**
 * Utilidad de administración: cambia el ROL de un usuario SIN Cloud Functions
 * (por tanto, sin necesidad del plan Blaze).
 *
 * El rol "real" vive en los *custom claims* del token (`role`), que solo se
 * pueden fijar con el Admin SDK y credenciales de administrador. Este script
 * hace lo mismo que la función `setUserRole`:
 *   1) fija el custom claim `role` (fuente de verdad),
 *   2) refleja el rol en `users/{uid}` (espejo legible),
 *   3) revoca los tokens de refresco para que el nuevo rol aplique pronto.
 *
 * Requisitos:
 *   - Dependencias de `functions/` instaladas:  npm --prefix functions install
 *   - Una clave de cuenta de servicio del proyecto (JSON). Se obtiene en:
 *     Firebase Console → ⚙ Configuración del proyecto → Cuentas de servicio →
 *     "Generar nueva clave privada". Guárdala en un lugar seguro y NO la subas
 *     al repo.
 *
 * Uso (desde la raíz del repo o desde functions/):
 *   GOOGLE_APPLICATION_CREDENTIALS=/ruta/serviceAccount.json \
 *     node functions/set-user-role.cjs <email-o-uid> <admin|operator|viewer>
 *
 * Ejemplos:
 *   node functions/set-user-role.cjs esteban@empresa.com admin
 *   node functions/set-user-role.cjs Xk29...uid operator
 *
 * Para SOLO consultar el rol actual, omite el rol:
 *   node functions/set-user-role.cjs esteban@empresa.com
 */

const admin = require('firebase-admin');

const ROLES = ['admin', 'operator', 'viewer'];

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

async function main() {
  const [target, role] = process.argv.slice(2);

  if (!target) {
    fail(
      'Falta el usuario.\n' +
        'Uso: node functions/set-user-role.cjs <email-o-uid> [admin|operator|viewer]',
    );
  }
  if (role && !ROLES.includes(role)) {
    fail(`Rol inválido "${role}". Debe ser uno de: ${ROLES.join(', ')}.`);
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    fail(
      'No hay credenciales. Exporta GOOGLE_APPLICATION_CREDENTIALS con la ruta\n' +
        'al JSON de la cuenta de servicio antes de ejecutar el script.',
    );
  }

  // applicationDefault() usa GOOGLE_APPLICATION_CREDENTIALS.
  admin.initializeApp({ credential: admin.credential.applicationDefault() });

  const auth = admin.auth();
  const db = admin.firestore();

  // Resuelve el usuario por email o por uid.
  const user = target.includes('@')
    ? await auth.getUserByEmail(target).catch(() => null)
    : await auth.getUser(target).catch(() => null);

  if (!user) fail(`No se encontró ningún usuario con "${target}".`);

  const currentRole = user.customClaims?.role ?? 'viewer';

  // Solo consulta.
  if (!role) {
    console.log(
      `\n${user.email ?? user.uid}\n  uid:  ${user.uid}\n  rol:  ${currentRole}\n`,
    );
    process.exit(0);
  }

  if (currentRole === role) {
    console.log(`\n= Sin cambios: ${user.email ?? user.uid} ya es "${role}".\n`);
    // Aun así reconciliamos el espejo por si quedó atrás.
  } else {
    await auth.setCustomUserClaims(user.uid, {
      ...(user.customClaims ?? {}),
      role,
    });
  }

  // Espejo legible en users/{uid} (misma colección que lee la pantalla admin).
  await db.collection('users').doc(user.uid).set(
    {
      uid: user.uid,
      email: user.email ?? '',
      displayName: user.displayName ?? '',
      role,
      updatedAt: Date.now(),
      updatedBy: 'set-user-role.cjs',
    },
    { merge: true },
  );

  // Revoca tokens: el usuario deberá refrescar su sesión para tomar el rol.
  await auth.revokeRefreshTokens(user.uid);

  console.log(
    `\n✔ ${user.email ?? user.uid}: rol "${currentRole}" → "${role}".\n` +
      '  El usuario debe cerrar y volver a iniciar sesión (o recargar) para que\n' +
      '  el nuevo rol tome efecto.\n',
  );
  process.exit(0);
}

main().catch((e) => fail(e?.message ?? String(e)));
