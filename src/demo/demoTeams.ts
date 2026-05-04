/**
 * Demo-Beispieldaten fuer den DLRG Bezirk Tuebingen.
 * Diese Daten werden NUR im Demo-Modus genutzt und sind reine Vorfuehrungs-/Beispieldaten.
 * Sie duerfen NICHT in echte teams-Tabellen geschrieben werden.
 * Beim Aktivieren des Demo-Modus wird daraus eine frische temporaere Demo-Teamliste
 * erzeugt; beim Verlassen verworfen.
 */

export interface DemoTeamTemplate {
  name: string
  short_name: string
  billing_address: string
  email: string
  phone: string
  contact_person: string
  payment_terms_days: number
  active: boolean
  is_demo: true
}

export const DEMO_TEAM_TEMPLATES: ReadonlyArray<DemoTeamTemplate> = [
  {
    name: 'DLRG Bezirk Tübingen',
    short_name: 'Bezirk Tübingen',
    billing_address: 'DLRG Bezirk Tübingen\nMühlbachstr. 8\n72411 Bodelshausen',
    email: 'info@bez-tuebingen.dlrg.de',
    phone: '',
    contact_person: '',
    payment_terms_days: 14,
    active: true,
    is_demo: true,
  },
  {
    name: 'DLRG Ortsgruppe Tübingen',
    short_name: 'Tübingen',
    billing_address: 'DLRG Ortsgruppe Tübingen\nKarlstr. 2/1\n72072 Tübingen',
    email: 'info@tuebingen.dlrg.de',
    phone: '+49 711 9539500',
    contact_person: '',
    payment_terms_days: 14,
    active: true,
    is_demo: true,
  },
  {
    name: 'DLRG Ortsgruppe Mössingen',
    short_name: 'Mössingen',
    billing_address: 'DLRG Ortsgruppe Mössingen\nAlbblickstraße 35\n72116 Mössingen',
    email: 'info@moessingen.dlrg.de',
    phone: '+49 711 9539500',
    contact_person: '',
    payment_terms_days: 14,
    active: true,
    is_demo: true,
  },
  {
    name: 'DLRG Ortsgruppe Rottenburg',
    short_name: 'Rottenburg',
    billing_address: 'DLRG Ortsgruppe Rottenburg\nSülchenstr. 24\n72108 Rottenburg',
    email: '',
    phone: '07472/3022554',
    contact_person: '',
    payment_terms_days: 14,
    active: true,
    is_demo: true,
  },
  {
    name: 'DLRG Ortsgruppe Kirchentellinsfurt',
    short_name: 'Kirchentellinsfurt',
    billing_address: 'DLRG Ortsgruppe Kirchentellinsfurt\nNeue Steige 25\n72138 Kirchentellinsfurt',
    email: 'info@kirchentellinsfurt.dlrg.de',
    phone: '+49 711 9539500',
    contact_person: '',
    payment_terms_days: 14,
    active: true,
    is_demo: true,
  },
  {
    name: 'DLRG Ortsgruppe Dettenhausen',
    short_name: 'Dettenhausen',
    billing_address: 'DLRG Ortsgruppe Dettenhausen\nBirkenwaldstr. 8\n72135 Dettenhausen',
    email: 'info@dettenhausen.dlrg.de',
    phone: '',
    contact_person: '',
    payment_terms_days: 14,
    active: true,
    is_demo: true,
  },
]
