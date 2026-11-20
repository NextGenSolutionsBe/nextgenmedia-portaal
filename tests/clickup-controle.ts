// Leescontrole van de ClickUp-koppeling (social/afspraken) tegen de echte API (geen schrijfacties).
// De facturatie-ClickUp-sync bestaat niet meer; facturen leven volledig in de app.
// Uitvoeren: npx tsx --env-file=.env.local tests/clickup-controle.ts
import { lijstToegang, findMemberId, clickupTest, isTaskGone } from '../lib/clickup'

async function main() {
  console.log('verbinding      ', await clickupTest())
  console.log('lijst weg       ', await lijstToegang('901521850871'), '(verwacht: weg)')
  console.log('lijst ok        ', await lijstToegang('901515744532'), '(verwacht: ok)')
  console.log('lid Bram        ', await findMemberId('Bram Reinquin'), '(verwacht: 200511713)')
  console.log('lid onbekend    ', await findMemberId('Zomaar Iemand'), '(verwacht: null)')
  console.log('taak weg regex  ', isTaskGone(new Error('ClickUp GET /task/x → 401: {"err":"Team not authorized","ECODE":"OAUTH_027"}')), '(verwacht: true)')
}
main().catch((e) => { console.error(e); process.exit(1) })
