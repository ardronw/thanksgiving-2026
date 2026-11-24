// Shared votes through Supabase's REST API (PostgREST). No libraries.
// Table columns: dish_id, voter_id, value. See supabase/schema.sql.

export function create({ url, key, table = 'votes', pollMs = 5000 } = {}) {
  if (!url || !key) {
    throw new Error('Supabase backend needs config.supabase.url and config.supabase.key (see site/js/config.js).');
  }
  const endpoint = `${url.replace(/\/+$/, '')}/rest/v1/${encodeURIComponent(table)}`;

  // New publishable keys (sb_publishable_...) are not JWTs: send them on
  // `apikey` only. Legacy anon keys are JWTs (start with eyJ): also send as Bearer.
  const headers = { apikey: key };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;

  async function load() {
    const res = await fetch(`${endpoint}?select=dish_id,voter_id,value`, { headers, cache: 'no-store' });
    if (!res.ok) throw new Error(`Loading votes failed (HTTP ${res.status})`);
    const rows = await res.json();
    return rows.map((r) => ({ dish: r.dish_id, voter: r.voter_id, value: r.value }));
  }

  // Upsert one row per (dish, voter). A cleared vote is stored as value 0.
  async function setVote(dish, voter, value) {
    const res = await fetch(`${endpoint}?on_conflict=dish_id,voter_id`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({ dish_id: dish, voter_id: voter, value }),
    });
    if (!res.ok) throw new Error(`Saving vote failed (HTTP ${res.status})`);
  }

  // Poll while the tab is visible; refresh at once when it comes back.
  function subscribe(onVotes) {
    let timer = null;
    let lastSig = null;
    let warned = false;
    let stopped = false;

    const signature = (votes) =>
      votes.map((v) => `${v.dish}|${v.voter}|${v.value}`).sort().join(';');

    async function refresh() {
      try {
        const votes = await load();
        const sig = signature(votes);
        if (sig !== lastSig) {
          lastSig = sig;
          if (!stopped) onVotes(votes);
        }
      } catch (err) {
        if (!warned) {
          warned = true;
          console.warn('Vote polling failed; will keep trying.', err);
        }
      }
    }

    const start = () => {
      if (timer || stopped) return;
      timer = setInterval(refresh, pollMs);
    };
    const stop = () => {
      clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        refresh();
        start();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    if (!document.hidden) {
      refresh();
      start();
    }
    return () => {
      stopped = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }

  return { kind: 'supabase', shared: true, load, setVote, subscribe };
}
