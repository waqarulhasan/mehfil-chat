# Mehfil Chat

A free, single-room chat. No registration: visitors pick a nickname and chat live. An admin can delete messages, kick, ban and clear the chat.

Plain Node.js, no packages to install.

## Run on your computer
1. Install Node.js 18 or newer.
2. In this folder, run: `node server.js`
3. Open http://localhost:3000 (open it in two browser windows to chat with yourself).

## Put it online (Render, free)
Vercel can't keep live chat connections open, so use Render (or Railway).
1. Upload this folder to a GitHub repo (server.js, package.json and the public folder at the top level).
2. On render.com: New → Web Service → connect the repo.
3. Build command: leave empty (or `npm install`). Start command: `node server.js`.
4. Choose the Free plan and click Deploy.

Free Render services sleep after about 15 minutes without visitors, and the first visit then takes ~30 seconds to wake up. A paid plan keeps it always on.

## Admin
1. Set an environment variable called `ADMIN_PASSWORD` to a strong password.
   - On your computer: `ADMIN_PASSWORD=yourpassword node server.js` (Windows PowerShell: `$env:ADMIN_PASSWORD="yourpassword"; node server.js`)
   - On Render: your service → Environment → Add `ADMIN_PASSWORD`.
2. On the site, click "Admin login" under the Start chatting button, enter a nickname and the password.
3. As admin you can:
   - Delete any message (Delete on each message)
   - Kick someone (they can rejoin)
   - Ban someone for 24 hours (by their internet address and nickname; their messages are deleted)
   - Clear the whole chat
   - Make someone an admin, or remove their admin role (main admin only)
The person who logs in with the password is the main admin. Admins they add can delete, kick, ban and clear, but can't add or remove other admins. Added admins lose the role when they leave. Admins get an ADMIN badge. Normal users can't use names with "admin" or "moderator" in them.
If ADMIN_PASSWORD isn't set, admin login is turned off.

## Moderator accounts (permanent)
The main admin can create moderators who log in with their own nickname and password.
1. Log in as main admin (any nickname + ADMIN_PASSWORD).
2. Click **Moderators** in the chat header.
3. Enter the moderator's nickname and a password, then click **Add moderator**. Send them those details.
4. The moderator opens the site, clicks "Admin / moderator login", types **their nickname** and **their password**.

Moderators can delete messages, kick, ban and clear the chat. Only the main admin can add or remove moderators.
Normal users can't use a moderator's nickname.

Where they're saved: `data/moderators.json` (passwords are hashed).
**Important on Render's free plan:** files are wiped when the server restarts or redeploys, so moderators added in the panel would be lost.
To keep them permanently, either:
- set an environment variable `MODERATORS` like `Sara:password1,Ali:password2` (these always load), or
- add a Render Persistent Disk (paid) mounted at the project's `data` folder.

## Settings (top of server.js)
- `BAD_WORDS`: words to block (replaced with ***)
- `MAX_LEN`: max characters per message
- `RATE`: messages allowed per few seconds
- `HISTORY`: how many recent messages new people see
- `BAN_HOURS`: how long a ban lasts

## Good to know
- Messages are kept in memory only, so they disappear when the server restarts.
- Bans are kept in memory, so they reset when the server restarts.
- To change the name, search for "Mehfil" in public/index.html.

## Adding Google AdSense (landing page only)
1. In `public/index.html`, paste the AdSense `<script async ...>` line from your AdSense account right after `<head>` (there's a comment marking the spot).
2. In AdSense, create **Display ad units** (manual ads) and paste each unit's code into the "AD SPOT 1/2/3" boxes in `public/index.html`.
3. Keep **Auto ads OFF** in AdSense for this site. Auto ads would also place ads inside the chat room, which is risky because you're responsible for every message shown next to ads.
4. The ad spots are hidden automatically while someone is in the chat room.

## SEO (search: "Pakistani chat room")
Already set up:
- Home page title, description and main heading target "Pakistani chat room"
- FAQ section with structured data, plus WebSite structured data
- 5 extra pages: /urdu-chat-room, /karachi-chat-room, /lahore-chat-room, /islamabad-chat-room, /uk-pakistani-chat-room
- robots.txt and sitemap.xml (public/), share image (public/og-image.png), 404 page
If your domain isn't mehfilchat.com, replace "https://mehfilchat.com" in public/index.html, the 5 page folders, robots.txt and sitemap.xml.

After deploying:
1. Add the site to Google Search Console (search.google.com/search-console), verify with a DNS TXT record in Namecheap.
2. Submit https://mehfilchat.com/sitemap.xml under Sitemaps.
3. Use "URL inspection" → "Request indexing" for the home page.

## Private messages
- Tap someone's name in the chat (or "Message" in People online) to start a private chat. It opens as a tab next to "Main room", with an unread count.
- Only the two people see private messages. They are kept in memory only (last 30 per pair, for reports) and are gone when either person leaves or the server restarts.
- **Report** (inside a private chat): sends the recent private messages to all online admins, who can kick or ban from the report.
- **Allow private messages** (People online panel): untick to stop anyone except admins messaging you privately.

## Country flags
Each person's country flag shows next to their nickname, worked out from their IP address with the free country.is service (no key needed, commercial use allowed). If that lookup fails, the browser's time zone is used instead.
Optional: create a free IPinfo account and set `IPINFO_TOKEN` in Render's Environment to use IPinfo Lite instead.
Flag images load from flagcdn.com. People using a VPN will show the VPN's country.
