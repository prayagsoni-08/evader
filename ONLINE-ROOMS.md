# Connect online rooms

This prototype uses Supabase Realtime Broadcast and Presence. Rooms are ephemeral channels; no database table is needed for the first playtest.

1. Create a Supabase project.
2. In the project's **Connect** dialog, copy the Project URL and publishable key into `supabase-config.js`.
3. Serve the game from an HTTP(S) site (for example, its existing Vercel deployment). The Supabase client is loaded from jsDelivr, so players need a network connection.
4. Create a room, share the four-character code, and have the required number of players join. The host starts the match when the room is full.

The browser uses only the publishable key. Never put a secret or service-role key in this folder. This initial version broadcasts game state directly between room members; it is for private playtests and does not have server-side move validation or anti-cheat protection. A later production version should validate turns and moves on a trusted backend and use private, authorized channels.
