import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { getOrCreateSalesOrg } from '@/lib/sales/service'
import {
  ANALYSE_PROMPT, analyseHeeftInhoud, saneerAnalyse, type ScriptAnalyse,
} from '@/lib/sales/script-analyse'

/**
 * Belscripts: opslag en AI-analyse.
 *
 * Een script hoort bij één setter (eigenaar_auth_id) of is algemeen (NULL), en
 * geldt voor één merk (pipeline_id) of voor alle. Focus Mode kiest het meest
 * specifieke script dat past — zie kiesScript.
 */

const MIST = /sales_scripts|does not exist|schema cache/i
export const SCRIPTS_HINT = 'De tabel voor belscripts bestaat nog niet. Draai supabase/migrations/99999999_SYNC_ALL.sql.'

export type ScriptRij = {
  id: string
  naam: string
  eigenaar_auth_id: string | null
  pipeline_id: string | null
  ruwe_tekst: string
  bron_bestand: string | null
  analyse: ScriptAnalyse | null
  analyse_model: string | null
  geanalyseerd_op: string | null
  actief: boolean
  created_at: string
  updated_at: string
}

export async function lijstScripts(): Promise<{ scripts: ScriptRij[]; hint?: string }> {
  const admin = createAdminSupabaseClient()
  const org = await getOrCreateSalesOrg()
  const { data, error } = await admin
    .from('sales_scripts').select('*')
    .eq('sales_client_id', org.id)
    .order('created_at', { ascending: false })
  if (error) {
    if (MIST.test(error.message)) return { scripts: [], hint: SCRIPTS_HINT }
    throw new Error(error.message)
  }
  return { scripts: (data ?? []) as ScriptRij[] }
}

/**
 * De AI-analyse draaien. Gooit bij een AI-fout een leesbare fout — een leeg
 * resultaat stilletjes opslaan zou eruitzien alsof het script leeg was.
 */
export async function analyseerScript(ruweTekst: string): Promise<{ analyse: ScriptAnalyse; model: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('AI niet geconfigureerd: ANTHROPIC_API_KEY ontbreekt in deze omgeving.')
  const model = process.env.BLOG_AI_MODEL || 'claude-sonnet-5'

  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: 8000,
        messages: [{
          role: 'user',
          content: `${ANALYSE_PROMPT}\n\nHET SCRIPT:\n\n${ruweTekst.slice(0, 60_000)}`,
        }],
      }),
    })
  } catch (e) {
    throw new Error(`Kan de AI-dienst niet bereiken: ${e instanceof Error ? e.message : 'netwerkfout'}`)
  }

  const json = await res.json().catch(() => null) as { content?: { text?: string }[]; error?: { message?: string } } | null
  if (!res.ok) throw new Error(`AI-fout (model ${model}): ${json?.error?.message || `HTTP ${res.status}`}`)

  const text = (json?.content ?? []).map((b) => b.text ?? '').join('')
  const start = text.indexOf('{'), end = text.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('De AI gaf geen bruikbaar antwoord terug.')

  let parsed: unknown
  try { parsed = JSON.parse(text.slice(start, end + 1)) } catch {
    throw new Error('Het AI-antwoord kon niet als JSON gelezen worden. Probeer opnieuw.')
  }

  const analyse = saneerAnalyse(parsed)
  if (!analyseHeeftInhoud(analyse)) {
    throw new Error('De analyse kwam leeg terug. Controleer of het bestand echt het script bevat.')
  }
  return { analyse, model }
}
