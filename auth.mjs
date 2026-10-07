// Inicio de sesión con Clerk. La clave pública (pk_) es segura en el navegador;
// la clave secreta (sk_) NUNCA va en esta app.
export const CLERK_PUBLISHABLE_KEY = 'pk_test_ZW5vdWdoLWJveGVyLTY4MjcuY2xlcmsuYWNjb3VudHMuZGV2JA';

export function frontendApi(key) {
  const encoded = String(key || '').split('_')[2] || '';
  try { return atob(encoded).replace(/\$$/, ''); } catch { return ''; }
}

const appearance = {
  variables: { colorPrimary: '#6e655e', colorText: '#2a2830', borderRadius: '12px', fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' },
  elements: {
    rootBox: { width: '100%' }, cardBox: { width: '100%', maxWidth: '100%', boxShadow: 'none', border: '0', borderRadius: '0' },
    card: { boxShadow: 'none', border: '0', padding: '8px 4px 16px' }, header: { display: 'none' }, footer: { background: 'transparent' },
  },
};
// Textos en español para la ventana de Clerk.
const localization = {
  locale: 'es-ES',
  dividerText: 'o',
  formFieldLabel__emailAddress: 'Correo electrónico',
  formFieldLabel__emailAddress_username: 'Correo o usuario',
  formFieldLabel__password: 'Contraseña',
  formFieldLabel__firstName: 'Nombre',
  formFieldLabel__lastName: 'Apellido',
  formFieldInputPlaceholder__emailAddress: 'tu@correo.com',
  formFieldInputPlaceholder__password: 'Tu contraseña',
  formFieldAction__forgotPassword: '¿Olvidaste tu contraseña?',
  formButtonPrimary: 'Continuar',
  backButton: 'Volver',
  socialButtonsBlockButton: 'Continuar con {{provider|titleize}}',
  signIn: {
    start: { title: 'Inicia sesión', subtitle: 'para entrar a Baco Studio', actionText: '¿No tienes cuenta?', actionLink: 'Regístrate' },
    password: { title: 'Escribe tu contraseña', subtitle: 'para continuar', actionLink: 'Usar otro método' },
    emailCode: { title: 'Revisa tu correo', subtitle: 'para continuar', formTitle: 'Código de verificación', resendButton: '¿No te llegó? Reenviar' },
  },
  signUp: {
    start: { title: 'Crea tu cuenta', subtitle: 'para entrar a Baco Studio', actionText: '¿Ya tienes cuenta?', actionLink: 'Inicia sesión' },
    emailCode: { title: 'Verifica tu correo', subtitle: 'escribe el código que te enviamos', formTitle: 'Código de verificación', resendButton: '¿No te llegó? Reenviar' },
  },
  userButton: { action__signOut: 'Cerrar sesión', action__manageAccount: 'Administrar cuenta' },
};

function loadScript(host) {
  return new Promise((resolve, reject) => {
    if (window.Clerk) return resolve();
    const s = document.createElement('script');
    s.src = `https://${host}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`;
    s.async = true; s.crossOrigin = 'anonymous';
    s.dataset.clerkPublishableKey = CLERK_PUBLISHABLE_KEY;
    s.onload = resolve; s.onerror = () => reject(new Error('No se pudo cargar el inicio de sesión. Revisa tu conexión.'));
    document.head.append(s);
  });
}

function showUser(user) {
  const name = user.firstName || user.fullName || user.primaryEmailAddress?.emailAddress || 'Mi cuenta';
  document.querySelectorAll('[data-user-name]').forEach(el => el.textContent = name);
  document.querySelectorAll('[data-user-photo]').forEach(img => { if (user.imageUrl) { img.src = user.imageUrl; img.alt = name; } });
}

export const getToken = async () => window.Clerk?.session ? window.Clerk.session.getToken() : null;
export const currentEmail = () => window.Clerk?.user?.primaryEmailAddress?.emailAddress || '';

export async function initAuth({ onUser } = {}) {
  let lastUser = null;
  const gate = document.getElementById('auth-gate'), box = document.getElementById('clerk-sign-in'), msg = document.getElementById('auth-message');
  const lock = () => { document.body.classList.add('auth-locked'); gate.hidden = false; };
  const unlock = user => { document.body.classList.remove('auth-locked'); gate.hidden = true; showUser(user); if (lastUser !== user.id) { lastUser = user.id; onUser?.(user); } };
  lock();
  try {
    await Promise.race([loadScript(frontendApi(CLERK_PUBLISHABLE_KEY)), new Promise((_, r) => setTimeout(() => r(new Error('El inicio de sesión tardó demasiado. Revisa tu conexión y recarga.')), 15000))]);
    await window.Clerk.load({ appearance, localization });
    msg.hidden = true;
    let mounted = false;
    const sync = () => {
      const user = window.Clerk.user;
      if (user) { if (mounted) { window.Clerk.unmountSignIn(box); mounted = false; } unlock(user); }
      else { lock(); if (!mounted) { window.Clerk.mountSignIn(box, { appearance }); mounted = true; } }
    };
    window.Clerk.addListener(sync); sync();
    document.querySelectorAll('[data-sign-out]').forEach(b => b.onclick = () => window.Clerk.signOut());
  } catch (error) {
    msg.hidden = false; msg.textContent = error.message || 'No se pudo iniciar sesión.';
  }
}
