// The one place the page reads and writes votes.
//
// Every backend returns the same small object:
//
//   kind      'local' | 'supabase' | ...
//   shared    true when everyone's votes land in one place
//   load()                     -> Promise<Vote[]>
//   setVote(dish, voter, value)-> Promise<void>   value is 1, -1, or 0 (cleared)
//   subscribe(onVotes)         -> unsubscribe()   onVotes(Vote[]) on any change
//
// A Vote is { dish: string, voter: string, value: 1 | -1 | 0 }.
// One vote per voter per dish; setVote replaces that voter's earlier vote.
//
// To plug in a new backend, add a file in ./backends/ that exports
// `create(options)` returning the object above, and name it in config.js.

const VOTER_KEY = 'tg26.voter';

function safeStorage() {
  try {
    const k = '__tg26_probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    return null;
  }
}

function randomId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

// A random id that stays the same on this device, so a person's thumbs-up
// can be changed later instead of counted twice. No names, no sign-in.
export function getVoterId(config) {
  if (config.backend === 'local') {
    // Preview-only hook: ?voter=anna lets one browser act as several people.
    const forced = new URLSearchParams(location.search).get('voter');
    if (forced) return `preview-${forced.slice(0, 32)}`;
  }
  const store = safeStorage();
  let id = store?.getItem(VOTER_KEY);
  if (!id) {
    id = randomId();
    store?.setItem(VOTER_KEY, id);
  }
  return id;
}

// Votes kept in this browser only. Used for previews before a shared
// backend exists; the page shows a notice while this is active.
function createLocal() {
  const KEY = 'tg26.votes';
  const storage = safeStorage();
  let memory = [];
  const read = () => {
    if (!storage) return memory;
    try {
      return JSON.parse(storage.getItem(KEY)) || [];
    } catch {
      return [];
    }
  };
  const write = (votes) => {
    memory = votes;
    storage?.setItem(KEY, JSON.stringify(votes));
  };
  const listeners = new Set();
  return {
    kind: 'local',
    shared: false,
    async load() {
      return read();
    },
    async setVote(dish, voter, value) {
      const votes = read().filter((v) => !(v.dish === dish && v.voter === voter));
      if (value !== 0) votes.push({ dish, voter, value });
      write(votes);
      for (const fn of listeners) fn(read());
    },
    subscribe(onVotes) {
      listeners.add(onVotes);
      const onStorage = (e) => {
        if (e.key === KEY) onVotes(read());
      };
      window.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(onVotes);
        window.removeEventListener('storage', onStorage);
      };
    },
  };
}

export async function openVoteStore(config) {
  if (config.backend === 'local') return createLocal();
  const mod = await import(`./backends/${config.backend}.js?v=76179d85b2`);
  return mod.create(config[config.backend] || {});
}
