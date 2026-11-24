// Page settings. The only file to edit when the shared vote backend is set up.
//
// backend: 'local'    votes stay in this browser (previews only)
//          'supabase' votes are shared through a Supabase table
//
// The Supabase key here is the project's public "publishable" (anon) key.
// It is meant to sit in a web page; row-level security on the table decides
// what it can do. Never put a secret / service-role key in this file.

export const config = {
  backend: 'supabase',
  threshold: 3, // thumbs-up in total that move a dish onto the menu
  supabase: {
    // Project "thanksgiving-2026" (free plan). Publishable key: safe in a page.
    url: 'https://nqlpuieyyhciatkgonqu.supabase.co',
    key: 'sb_publishable_SDMXFVqz_tp3JjCh2vmJKA_LHNjpMpN',
    table: 'votes',
    pollMs: 5000,
  },
};
