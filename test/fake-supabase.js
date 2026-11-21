/* A tiny in-memory stand-in for the parts of Supabase the app uses (Auth + the progress table with RLS).
   Used by test/account.js (as a fetch function) and by test/e2e.js (behind the local HTTP server). */
function fakeSupabase(opts) {
  opts = opts || {};
  const KEY = opts.key || 'anon-test-key';
  const users = new Map();      // email -> { id, email, password, confirmed }
  const tokens = new Map();     // access token -> user id
  const refresh = new Map();    // refresh token -> user id
  const rows = new Map();       // user id -> { data, updated_at }
  const homework = new Map();   // homework id -> row of public.homework (supabase/teacher.sql)
  const results = new Map();    // homework id + '|' + student key -> row of public.homework_results
  const log = [];
  let n = 0, clock = Date.parse('2026-01-01T00:00:00Z');
  const state = { autoConfirm: opts.autoConfirm !== false, expiresIn: opts.expiresIn || 3600, mails: [] };

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
    if (p === '/rest/v1/homework') return homeworkTable(method, q, headers, body);
    if (p === '/rest/v1/homework_results') return resultsTable(method, q, headers);
    if (p === '/rpc/submit_homework_result' || p === '/rest/v1/rpc/submit_homework_result') return submit(method, body);
    return [404, { message: 'not found' }];
  }

  /* ---- supabase/teacher.sql: homework and the students' results, with the same row-level security and checks ---- */
  const eq = (q, name) => { const v = q.get(name); return v && v.startsWith('eq.') ? v.slice(3) : null; };
  const LANG = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/, UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const denied = [401, { code: '42501', message: 'permission denied for table' }];
  function homeworkTable(method, q, headers, body) {
    const me = bearer(headers);
    if (!me) return denied;                                   // revoke all on public.homework from anon
    if (method === 'POST') {
      const r = body || {};
      const ok = typeof r.id === 'string' && UUID.test(r.id) && typeof r.title === 'string' && r.title.length >= 1 && r.title.length <= 60
        && LANG.test(r.source) && LANG.test(r.target) && Number.isInteger(r.n) && r.n >= 0 && r.n <= 300
        && (r.due == null || /^\d{4}-\d{2}-\d{2}$/.test(r.due)) && typeof r.link === 'string' && r.link.length <= 9000 && (r.teacher_id === undefined || r.teacher_id === me);
      if (!ok) return [400, { code: '23514', message: 'new row violates check constraint' }];
      if (homework.has(r.id)) return [409, { code: '23505', message: 'duplicate key value violates unique constraint' }];
      clock += 1000;
      homework.set(r.id, { id: r.id, teacher_id: me, title: r.title, source: r.source, target: r.target, n: r.n, due: r.due || null, link: r.link, created_at: new Date(clock).toISOString() });
      return [201, null];
    }
    const mine = [...homework.values()].filter(h => h.teacher_id === me && (eq(q, 'id') === null || h.id === eq(q, 'id')));
    if (method === 'GET') {
      const list = mine.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, Number(q.get('limit')) || 1000);
      return [200, list.map(h => { const { teacher_id, ...pub } = h; return pub; })];
    }
    if (method === 'DELETE') {
      mine.forEach(h => { homework.delete(h.id); [...results.keys()].filter(k => k.startsWith(h.id + '|')).forEach(k => results.delete(k)); }); // on delete cascade
      return [204, null];
    }
    return [404, { message: 'not found' }];
  }
  function resultsTable(method, q, headers) {
    const me = bearer(headers);
    if (!me) return denied;
    if (method !== 'GET' && method !== 'DELETE') return [403, { code: '42501', message: 'permission denied for table homework_results' }]; // writes only through the function
    const hw = eq(q, 'homework_id'), student = eq(q, 'student_key');
    const visible = [...results.values()].filter(r => homework.get(r.homework_id) && homework.get(r.homework_id).teacher_id === me && (hw === null || r.homework_id === hw) && (student === null || r.student_key === student));
    if (method === 'DELETE') { visible.forEach(r => results.delete(r.homework_id + '|' + r.student_key)); return [204, null]; }
    return [200, visible.sort((a, b) => b.last_at.localeCompare(a.last_at)).slice(0, Number(q.get('limit')) || 1000)];
  }
  function submit(method, body) {
    if (method !== 'POST') return [404, { message: 'not found' }];
    const b = body || {}, err = (code, message, status) => [status || 400, { code, message }];
    const name = String(b.p_name == null ? '' : b.p_name).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
    if (!homework.has(b.p_homework)) return err('P0002', 'unknown homework');
    if (typeof b.p_student !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(b.p_student)) return err('22023', 'bad student');
    if (name.length < 1 || name.length > 40) return err('22023', 'bad name');
    if (!Number.isInteger(b.p_answered) || b.p_answered < 1 || b.p_answered > 2000) return err('22023', 'bad answered');
    if (!Number.isInteger(b.p_correct) || b.p_correct < 0 || b.p_correct > b.p_answered) return err('22023', 'bad correct');
    if (!Number.isInteger(b.p_words) || b.p_words < 0 || b.p_words > 300) return err('22023', 'bad words');
    const key = b.p_homework + '|' + b.p_student, old = results.get(key);
    if (!old && [...results.values()].filter(r => r.homework_id === b.p_homework).length >= 500) return err('53400', 'homework is full', 503);
    clock += 1000;
    const at = new Date(clock).toISOString();
    if (!old) results.set(key, { homework_id: b.p_homework, student_key: b.p_student, student_name: name, answered: b.p_answered, correct: b.p_correct, words: b.p_words, attempts: 1, first_at: at, last_at: at });
    else {
      const answered = Math.min(old.answered + b.p_answered, 1000000);
      Object.assign(old, { student_name: name, answered, correct: Math.min(old.correct + b.p_correct, answered), words: Math.max(old.words, b.p_words), attempts: old.attempts + 1, last_at: at });
    }
    return [204, null];
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
  return { handle, fetch: fetchFn, users, rows, homework, results, tokens, log, state, KEY };
}
module.exports = fakeSupabase;
