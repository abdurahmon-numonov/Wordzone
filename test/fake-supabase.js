/* A tiny in-memory stand-in for the parts of Supabase the app uses (Auth + the progress table with RLS).
   Used by test/account.js (as a fetch function) and by test/e2e.js (behind the local HTTP server).
   v2.56: also supabase/teacher.sql — homework (own rows only), homework_results (the teacher of the homework
   reads them) and rpc/submit_homework_result (anyone, only into existing homework). state.teacherTables = false
   answers 404 as if the script was never run. */
function fakeSupabase(opts) {
  opts = opts || {};
  const KEY = opts.key || 'anon-test-key';
  const users = new Map();      // email -> { id, email, password, confirmed }
  const tokens = new Map();     // access token -> user id
  const refresh = new Map();    // refresh token -> user id
  const rows = new Map();       // user id -> { data, updated_at }
  const log = [];
  let n = 0, clock = Date.parse('2026-01-01T00:00:00Z');
  const homework = new Map();   // id -> row (+ teacher_id)
  const results = new Map();    // homework id + '|' + student key -> row
  const state = { teacherTables: true, autoConfirm: opts.autoConfirm !== false, expiresIn: opts.expiresIn || 3600, mails: [] };

  const byId = id => [...users.values()].find(u => u.id === id);
  function session(u) {
    const access = 'at-' + u.id + '-' + (++n), r = 'rt-' + u.id + '-' + n;
    tokens.set(access, u.id); refresh.set(r, u.id);
    return { access_token: access, refresh_token: r, expires_in: state.expiresIn, token_type: 'bearer', user: { id: u.id, email: u.email } };
  }
  function bearer(headers) { const t = String(headers.authorization || '').replace(/^Bearer\s+/i, ''); return tokens.get(t) || null; }

  function handle(method, url, headers, body) {
    const u = new URL(url, 'http://x'), p = u.pathname, q = u.searchParams;
    log.push(method + ' ' + p + (u.search || ''));
    if (headers.apikey !== KEY) return [401, { message: 'Invalid API key' }];
    if (headers.authorization && !bearer(headers) && !/^\/auth\/v1\/logout/.test(u.pathname)) return [401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT: unable to parse or verify signature' }];
    if (p === '/auth/v1/signup' && method === 'POST') {
      if (users.has(body.email)) return [200, { id: 'obfuscated', email: body.email, identities: [] }];
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email || '')) return [400, { error_code: 'email_address_invalid', msg: 'Unable to validate email address: invalid format' }];
      if (String(body.password || '').length < 6) return [422, { error_code: 'weak_password', msg: 'Password should be at least 6 characters.' }];
      const user = { id: 'u' + (++n), email: body.email, password: body.password, confirmed: state.autoConfirm };
      users.set(body.email, user);
      if (state.autoConfirm) return [200, session(user)];
      state.mails.push({ to: body.email, kind: 'signup', redirect: q.get('redirect_to'), link: '#' + new URLSearchParams(Object.assign({ type: 'signup' }, Object.fromEntries(Object.entries(session(user)).filter(([k]) => k !== 'user' && k !== 'token_type').map(([k, v]) => [k, String(v)])))) });
      return [200, { id: user.id, email: user.email }];
    }
    if (p === '/auth/v1/token' && method === 'POST') {
      if (q.get('grant_type') === 'password') {
        const user = users.get(body.email);
        if (!user || user.password !== body.password) return [400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }];
        if (!user.confirmed) return [400, { code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' }];
        return [200, session(user)];
      }
      if (q.get('grant_type') === 'refresh_token') {
        const id = refresh.get(body.refresh_token);
        if (!id) return [400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' }];
        refresh.delete(body.refresh_token);
        return [200, session(byId(id))];
      }
    }
    if (p === '/auth/v1/user') {
      const id = bearer(headers);
      if (!id) return [401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' }];
      const user = byId(id);
      if (method === 'PUT') { if (String(body.password || '').length < 6) return [422, { error_code: 'weak_password', msg: 'Password should be at least 6 characters.' }]; user.password = body.password; }
      user.confirmed = true;
      return [200, { id: user.id, email: user.email }];
    }
    if (p === '/auth/v1/logout' && method === 'POST') { const t = String(headers.authorization || '').replace(/^Bearer\s+/i, ''); tokens.delete(t); return [204, null]; }
    if (p === '/auth/v1/recover' && method === 'POST') {
      const user = users.get(body.email);
      if (user) state.mails.push({ to: body.email, kind: 'recovery', redirect: q.get('redirect_to'), link: '#' + new URLSearchParams({ type: 'recovery', access_token: session(user).access_token, refresh_token: 'rt-' + user.id + '-' + n, expires_in: '3600' }) });
      return [200, {}];
    }
    if (p === '/rest/v1/progress') {
      const id = bearer(headers);
      if (!id) return [401, { code: 'PGRST301', message: 'JWT expired' }];
      const target = (q.get('user_id') || '').replace(/^eq\./, '') || (body && body.user_id);
      if (target !== id) return method === 'GET' ? [200, []] : [403, { code: '42501', message: 'new row violates row-level security policy' }];
      if (method === 'GET') return [200, rows.has(id) ? [Object.assign({}, rows.get(id))] : []];
      if (method === 'POST') {
        clock += 1000;
        rows.set(id, { data: JSON.parse(JSON.stringify(body.data)), updated_at: new Date(clock).toISOString() });
        return [201, [Object.assign({ user_id: id }, rows.get(id))]];
      }
      if (method === 'DELETE') { rows.delete(id); return [204, null]; }
    }
    if (/^\/rest\/v1\/(homework|homework_results|rpc\/submit_homework_result)$/.test(p) && !state.teacherTables)
      return [404, { code: 'PGRST205', message: "Could not find the table in the schema cache" }];
    if (p === '/rest/v1/homework') {
      const id = bearer(headers);
      if (!id) return method === 'GET' ? [200, []] : [401, { code: '42501', message: 'permission denied for table homework' }];
      if (method === 'POST') {
        if (!body || !/^[0-9a-f-]{36}$/.test(body.id) || homework.has(body.id)) return [409, { code: '23505', message: 'duplicate key' }];
        homework.set(body.id, Object.assign({}, body, { teacher_id: id, created_at: new Date().toISOString() }));
        return [201, null];
      }
      const mine = [...homework.values()].filter(h => h.teacher_id === id);
      if (method === 'GET') return [200, mine.sort((a, b) => b.created_at < a.created_at ? -1 : 1).map(h => {
        const out = { id: h.id, title: h.title, source: h.source, target: h.target, n: h.n, due: h.due, link: h.link, created_at: h.created_at };
        if (/homework_results\(count\)/.test(q.get('select') || '')) out.homework_results = [{ count: [...results.values()].filter(r => r.homework_id === h.id).length }];
        return out;
      })];
      if (method === 'DELETE') {
        const hid = (q.get('id') || '').replace(/^eq\./, ''), h = homework.get(hid);
        if (h && h.teacher_id === id) { homework.delete(hid); for (const [k, r] of results) if (r.homework_id === hid) results.delete(k); }
        return [204, null];
      }
    }
    if (p === '/rest/v1/homework_results' && method === 'GET') {
      const id = bearer(headers), hid = (q.get('homework_id') || '').replace(/^eq\./, ''), h = homework.get(hid);
      if (!id || !h || h.teacher_id !== id) return [200, []];
      return [200, [...results.values()].filter(r => r.homework_id === hid).sort((a, b) => b.last_at < a.last_at ? -1 : 1)];
    }
    if (p === '/rest/v1/rpc/submit_homework_result' && method === 'POST') {
      const b = body || {};
      if (!homework.has(b.p_homework)) return [404, { code: 'P0002', message: 'unknown homework' }];
      const name = String(b.p_name || '').trim();
      if (!/^[A-Za-z0-9-]{8,64}$/.test(b.p_student || '') || !name || name.length > 40 || !(b.p_answered >= 1 && b.p_answered <= 2000) || !(b.p_correct >= 0 && b.p_correct <= b.p_answered))
        return [400, { code: '22023', message: 'bad input' }];
      const k = b.p_homework + '|' + b.p_student, now = new Date().toISOString(), old = results.get(k);
      results.set(k, old ? Object.assign(old, { student_name: name, answered: old.answered + b.p_answered, correct: old.correct + b.p_correct, words: Math.max(old.words, b.p_words), attempts: old.attempts + 1, last_at: now })
        : { homework_id: b.p_homework, student_key: b.p_student, student_name: name, answered: b.p_answered, correct: b.p_correct, words: b.p_words, attempts: 1, first_at: now, last_at: now });
      return [204, null];
    }
    return [404, { message: 'not found' }];
  }

  // fetch-compatible wrapper for Node tests
  async function fetchFn(url, o) {
    o = o || {};
    const headers = Object.fromEntries(Object.entries(o.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    if (state.offline) throw new TypeError('Failed to fetch');
    const [status, json] = handle(o.method || 'GET', url, headers, o.body ? JSON.parse(o.body) : null);
    const text = json == null ? '' : JSON.stringify(json);
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  }
  return { handle, fetch: fetchFn, users, rows, tokens, log, state, KEY, homework, results };
}
module.exports = fakeSupabase;
