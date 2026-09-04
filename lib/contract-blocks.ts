// Vaste contractblokken: standaard veldensets die de admin met één klik kan
// toevoegen aan een contract of template. Coördinaten worden bij toevoegen
// automatisch onder elkaar geplaatst (zie field-overlay-editor).

import type { ContractFieldType } from '@/lib/contract-ai'

export type BlockField = { label: string; type: ContractFieldType; required?: boolean; placeholder?: string }
export type ContractBlock = { id: string; name: string; fields: BlockField[] }

export const CONTRACT_BLOCKS: ContractBlock[] = [
  {
    id: 'social',
    name: 'Social Media',
    fields: [
      { label: 'Pakket', type: 'text', required: true, placeholder: 'Bv. Pakket 2' },
      { label: 'Looptijd', type: 'text', required: true, placeholder: 'Bv. 12 maanden' },
      { label: 'Prijs', type: 'number', required: true, placeholder: 'Bv. 750' },
    ],
  },
  {
    id: 'website',
    name: 'Website',
    fields: [
      { label: 'Domein', type: 'text', required: true, placeholder: 'voorbeeld.be' },
      { label: 'Hosting', type: 'text', required: false, placeholder: 'Bv. inbegrepen' },
      { label: 'Oplevering', type: 'date', required: true },
    ],
  },
  {
    id: 'branding',
    name: 'Branding',
    fields: [
      { label: 'Deliverables', type: 'text', required: true, placeholder: 'Logo, huisstijl, ...' },
      { label: 'Revisierondes', type: 'number', required: false, placeholder: 'Bv. 2' },
    ],
  },
  {
    id: 'partner',
    name: 'Partner',
    fields: [
      { label: 'Commissie', type: 'text', required: true, placeholder: 'Bv. 10%' },
      { label: 'Duurtijd', type: 'text', required: true, placeholder: 'Bv. 24 maanden' },
    ],
  },
]
