/**
 * Register (or list) the ClickUp webhook that powers the reverse-sync.
 *
 *   npm run setup:webhook -- https://<your-host>/clickup/webhook
 *
 * Defaults the endpoint to ${PUBLIC_URL}/clickup/webhook. Prints the webhook
 * secret — copy it into CLICKUP_WEBHOOK_SECRET and redeploy.
 */
import { config } from '../config.js';

// Derive the origin (scheme+host) so a PUBLIC_URL that includes a path
// (e.g. .../slack/events) still produces the correct webhook endpoint.
function defaultEndpoint(): string {
  try {
    return `${new URL(config.PUBLIC_URL).origin}/clickup/webhook`;
  } catch {
    return `${config.PUBLIC_URL.replace(/\/+$/, '')}/clickup/webhook`;
  }
}

const endpoint = process.argv[2] ?? defaultEndpoint();

async function cu(path: string, init?: RequestInit) {
  const res = await fetch(`https://api.clickup.com/api/v2${path}`, {
    ...init,
    headers: { Authorization: config.CLICKUP_TOKEN, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`ClickUp ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

const teams = (await cu('/team')) as { teams: { id: string; name: string }[] };
const team = teams.teams[0];
if (!team) throw new Error('No ClickUp team found for this token');
console.log(`Using team: ${team.name} (${team.id})`);

const created = (await cu(`/team/${team.id}/webhook`, {
  method: 'POST',
  body: JSON.stringify({ endpoint, events: ['taskStatusUpdated'] }),
})) as { id: string; webhook?: { secret?: string }; secret?: string };

const secret = created.webhook?.secret ?? created.secret;
console.log(`\n✅ Webhook created: ${created.id}`);
console.log(`   endpoint: ${endpoint}`);
console.log(`\nSet this and redeploy:\n   CLICKUP_WEBHOOK_SECRET=${secret}\n`);
process.exit(0);
