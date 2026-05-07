/**
 * Clerk-backed auth for the Cloudflare Worker.
 *
 * Verifies a Clerk session token (cookie `__session` for browser flows,
 * `Authorization: Bearer <token>` for API clients) and returns a typed
 * auth context: { userId, clerkUserId, role, email }.
 *
 * The Worker uses this to gate /api/* routes. The verification is done
 * via @clerk/backend's `authenticateRequest`, which is Worker-runtime
 * compatible (Web Crypto, no node deps).
 *
 * When CLERK_SECRET_KEY is unset (current state, pre-Clerk-setup), the
 * helper returns { ok: false, status: 503, reason: "auth_not_configured" }
 * so the rest of the system can short-circuit cleanly without throwing.
 */

import { createClerkClient } from "@clerk/backend";

let _clerk = null;

function getClerk(env) {
  if (!env.CLERK_SECRET_KEY) return null;
  if (!_clerk) {
    _clerk = createClerkClient({
      secretKey: env.CLERK_SECRET_KEY,
      publishableKey: env.CLERK_PUBLISHABLE_KEY,
    });
  }
  return _clerk;
}

/**
 * Authenticate a request. Returns:
 *   { ok: true, userId, clerkUserId, role, email }     on success
 *   { ok: false, status, reason }                       on failure
 */
export async function authenticate(request, env) {
  const clerk = getClerk(env);
  if (!clerk) {
    return { ok: false, status: 503, reason: "auth_not_configured" };
  }

  const requestState = await clerk.authenticateRequest(request, {
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
  });

  if (!requestState.isAuthenticated) {
    return { ok: false, status: 401, reason: requestState.reason || "unauthenticated" };
  }

  const auth = requestState.toAuth();
  const clerkUserId = auth.userId;
  if (!clerkUserId) {
    return { ok: false, status: 401, reason: "no_user" };
  }

  // Pull role + email from Clerk's user object. Role is stored in publicMetadata.
  // App will lazily mirror Clerk users into the local `users` table on first auth;
  // see migrations/0000_init.sql -> users.clerk_user_id.
  const user = await clerk.users.getUser(clerkUserId);
  const role = user.publicMetadata?.role;
  if (role !== "admin" && role !== "doctor" && role !== "patient") {
    return { ok: false, status: 403, reason: "no_role" };
  }

  const email = user.primaryEmailAddress?.emailAddress
    ?? user.emailAddresses?.[0]?.emailAddress
    ?? null;

  return {
    ok: true,
    clerkUserId,
    role,
    email,
    fullName: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
    locale: user.publicMetadata?.locale || "en",
  };
}

/**
 * Convenience: require a specific role(s). Returns auth context on success
 * or a Response (401/403) on failure that the caller can return directly.
 */
export async function requireAuth(request, env, allowedRoles = null) {
  const auth = await authenticate(request, env);
  if (!auth.ok) {
    return jsonError(auth.status, auth.reason);
  }
  if (allowedRoles && !allowedRoles.includes(auth.role)) {
    return jsonError(403, "forbidden_role");
  }
  return auth;
}

function jsonError(status, reason) {
  return new Response(JSON.stringify({ error: reason }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Helper: is the result of authenticate/requireAuth a Response (error path)
 * or an auth context (success path)? Lets the caller short-circuit.
 */
export function isAuthError(x) {
  return x instanceof Response;
}
