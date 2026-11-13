import { OAuth2Client } from 'google-auth-library';

const FRESH_AUTH_WINDOW_SECONDS = 5 * 60;

const fail = (message, code = 'FRESH_AUTH_INVALID', status = 401) => ({
  ok: false,
  status,
  code,
  message
});

/**
 * Verify a fresh re-authentication proof for a sensitive warranty correction.
 *
 * The backend verifies the proof itself. A frontend boolean is never trusted.
 *
 * - Google: verifies the ID token audience, signature, email, linked Google
 *   account, and token issue time (must be within the last five minutes).
 * - Password accounts: verifies the supplied password against the stored hash.
 *
 * @param {Object} options
 * @param {Object} options.user - authenticated Mongoose user (password selected)
 * @param {string} [options.googleCredential]
 * @param {string} [options.password]
 * @returns {Promise<{ok: boolean, method?: string, status?: number, code?: string, message?: string}>}
 */
export const verifyFreshAuthentication = async ({ user, googleCredential, password }) => {
  if (!user) {
    return fail('Authenticated user is required', 'UNAUTHENTICATED', 401);
  }

  if (googleCredential) {
    // Test-only deterministic token support. Never enabled outside NODE_ENV=test.
    if (
      process.env.NODE_ENV === 'test' &&
      String(googleCredential).startsWith('simulated_google_token_')
    ) {
      const email = String(googleCredential).replace('simulated_google_token_', '');
      if (email.toLowerCase() !== String(user.email).toLowerCase()) {
        return fail('Fresh Google authentication belongs to a different account.');
      }
      return { ok: true, method: 'google' };
    }

    if (!process.env.GOOGLE_CLIENT_ID) {
      return fail(
        'Google re-authentication is not configured on the server.',
        'GOOGLE_NOT_CONFIGURED',
        500
      );
    }

    try {
      const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
      const ticket = await client.verifyIdToken({
        idToken: googleCredential,
        audience: process.env.GOOGLE_CLIENT_ID
      });
      const payload = ticket.getPayload();

      if (!payload || !payload.email || !payload.email_verified) {
        return fail('Google account email is not verified.');
      }

      if (payload.email.toLowerCase() !== String(user.email).toLowerCase()) {
        return fail('Fresh Google authentication belongs to a different account.');
      }

      if (!user.googleId || payload.sub !== user.googleId) {
        return fail(
          'This Google account is not linked to the warranty owner. Sign in with the linked account or confirm with your password.'
        );
      }

      const nowSeconds = Math.floor(Date.now() / 1000);
      const issuedAt = Number(payload.iat);
      if (!Number.isFinite(issuedAt)) {
        return fail('Google re-authentication token has no issue time.');
      }
      if (issuedAt > nowSeconds + 60 || nowSeconds - issuedAt > FRESH_AUTH_WINDOW_SECONDS) {
        return fail(
          'Google re-authentication is stale. Please confirm your identity again.'
        );
      }

      return { ok: true, method: 'google' };
    } catch (error) {
      return fail('Fresh Google authentication failed. Please try again.');
    }
  }

  if (password) {
    if (!user.password) {
      return fail(
        'This account does not use a password. Please re-authenticate with Google.'
      );
    }

    try {
      const matches = await user.matchPassword(password);
      if (!matches) {
        return fail('The password you entered is incorrect.');
      }
      return { ok: true, method: 'password' };
    } catch {
      return fail('Unable to verify password. Please try again.');
    }
  }

  return fail(
    'Fresh authentication is required for this correction.',
    'FRESH_AUTH_REQUIRED',
    401
  );
};
