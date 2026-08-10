import { useState, type FormEvent } from 'react';
import { signInWithEmail, authErrorMessage } from '@/services/auth';
import { BrandLogo } from '@/components/BrandLogo';
import './LoginPage.css';

/**
 * Pantalla de inicio de sesión (correo/contraseña).
 *
 * Al autenticarse correctamente, el observador de `AuthProvider` actualiza el
 * usuario y la app muestra el contenido protegido; por eso aquí no se navega
 * manualmente.
 */
export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signInWithEmail(email, password);
      // No se restablece `submitting`: al iniciar sesión, la app reemplaza esta
      // pantalla por el contenido protegido.
    } catch (err) {
      setError(authErrorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="login">
      <div className="login__panel" aria-hidden="true">
        <div className="login__panel-brand">
          <BrandLogo variant="white" height={40} />
          <span className="login__panel-product">SIGNAM V2</span>
        </div>
        <p className="login__panel-tagline">
          Plataforma de gestión de señalización digital en punto de venta.
        </p>
      </div>

      <form className="login__card" onSubmit={handleSubmit} noValidate>
        <div className="login__brand">
          <BrandLogo variant="brand" height={34} />
          <span className="login__brand-product">SIGNAM V2</span>
        </div>
        <h1 className="login__title">Iniciar sesión</h1>
        <p className="login__subtitle">
          Accede con tu correo y contraseña para administrar el catálogo,
          importar calendarios y generar los CSV de Admira.
        </p>

        {error && (
          <div className="login__error" role="alert">
            {error}
          </div>
        )}

        <label className="login__field">
          <span>Correo electrónico</span>
          <input
            type="email"
            name="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={submitting}
          />
        </label>

        <label className="login__field">
          <span>Contraseña</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={submitting}
          />
        </label>

        <button
          type="submit"
          className="btn btn-primary login__submit"
          disabled={submitting || email === '' || password === ''}
        >
          {submitting ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
    </div>
  );
}
