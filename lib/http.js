/**
 * Helper respons JSON untuk Pages Functions.
 */

/**
 * @param {unknown} body
 * @param {{ status?: number, cacheSeconds?: number }} [options]
 */
export function json(body, { status = 200, cacheSeconds = 0 } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/**
 * Respons error yang seragam: { ok: false, error: "<pesan>" }
 */
export function fail(status, message) {
  return json({ ok: false, error: message }, { status });
}
