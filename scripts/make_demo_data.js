// Generates SYNTHETIC records.json for layout testing only (meta.demo = true).
// Real data: run R/01_fetch_openalex.R then R/02_build_records.R.
// Usage: node scripts/make_demo_data.js
const fs = require('fs');
let seed = 42;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (arr, w) => { let r = rnd() * w.reduce((a, b) => a + b, 0); for (let i = 0; i < arr.length; i++) { r -= w[i]; if (r <= 0) return arr[i]; } return arr[arr.length - 1]; };

const years = []; for (let y = 2016; y <= 2026; y++) years.push(y);
const perYear = { 2016: 60, 2017: 70, 2018: 85, 2019: 100, 2020: 120, 2021: 150, 2022: 185, 2023: 230, 2024: 270, 2025: 310, 2026: 200 };
const taxa = ['insects', 'chelicerates', 'myriapods', 'crustaceans', 'cephalopods', 'gastropods', 'general'];
const taxaW = [0.5, 0.08, 0.01, 0.22, 0.12, 0.04, 0.1];
const themes = ['sentience', 'emotion', 'affect', 'consciousness', 'pain', 'welfare'];
const contexts = ['farming', 'research', 'pest', 'wild', 'waste', 'captivity', 'medical'];
const journals = [
  ['Animal Welfare', 'welfare'], ['Applied Animal Behaviour Science', 'welfare'], ['Animal Sentience', 'welfare'],
  ['Journal of Insect Physiology', 'entomology'], ['Insects', 'entomology'], ['Journal of Insects as Food and Feed', 'entomology'],
  ['Nature', 'multidisciplinary'], ['Science', 'multidisciplinary'], ['Proceedings of the National Academy of Sciences', 'multidisciplinary'],
  ['Animals', 'other'], ['Proceedings of the Royal Society B', 'other'], ['PLoS ONE', 'other'], ['Frontiers in Veterinary Science', 'other'],
  ['Scientific Reports', 'other'], ['Aquaculture', 'other'], ['Animal Behaviour', 'other'], [null, 'unknown']];
const jW = [6, 5, 4, 3, 7, 4, 0.6, 0.5, 1.2, 14, 5, 6, 4, 5, 6, 4, 2];
const countries = ['US', 'GB', 'BR', 'CA', 'AU', 'DE', 'FR', 'IT', 'NL', 'CN', 'ES', 'MX', 'AR', 'JP', 'NO', 'CL'];
const cW = [30, 18, 6, 6, 7, 5, 4, 5, 3, 6, 4, 2, 2, 3, 2, 1];
const words = ['Welfare', 'indicators', 'in', 'farmed', 'black soldier fly', 'larvae', 'Evidence of', 'pain', 'in', 'decapod crustaceans',
  'Affective states', 'in bumblebees', 'Octopus', 'sentience', 'and', 'policy', 'Stunning', 'methods for', 'shrimp', 'Nociception and',
  'motivational trade-offs', 'in', 'crickets', 'Cognitive bias', 'in', 'honeybees', 'Tarantula', 'husbandry', 'welfare'];

const records = []; let id = 1;
for (const y of years) {
  for (let k = 0; k < perYear[y]; k++) {
    const tx = [pick(taxa, taxaW)]; if (rnd() < 0.12) { const t2 = pick(taxa, taxaW); if (!tx.includes(t2)) tx.push(t2); }
    const th = themes.filter((t, i) => rnd() < [0.18, 0.12, 0.1, 0.08, 0.35, 0.55][i]);
    if (!th.length) th.push('welfare');
    const cx = contexts.filter((c, i) => rnd() < [0.3, 0.25, 0.1, 0.2, 0.05, 0.06, 0.03][i]);
    const [j, jg] = pick(journals, jW);
    const co = [pick(countries, cW)]; if (rnd() < 0.4) co.push(pick(countries, cW));
    const start = Math.floor(rnd() * (words.length - 6));
    records.push({
      i: 'W' + (9000000000 + id++), d: null, t: words.slice(start, start + 6).join(' ') + ' (demo)',
      y, j, jg, ty: rnd() < 0.18 ? 'review' : 'article', c: Math.floor(Math.pow(rnd(), 3) * 300 * (2027 - y) / 5),
      oa: pick(['gold', 'green', 'hybrid', 'bronze', 'closed'], [3, 2, 1, 1, 3]), l: 'en', tp: null,
      co: [...new Set(co)].sort(), ins: [], tx, th, cx,
      n: th.length === 1 && th[0] === 'pain' && rnd() < 0.5, uf: co[0] === 'US'
    });
  }
}
const baseline = years.map((y, i) => ({ year: y, all_works: y === 2026 ? 6800000 : 7600000 + i * 250000 }));
const lab = o => o;
const meta = {
  demo: true, title: 'Invertebrate Welfare Science Dashboard', retrieved_at: 'DEMO — synthetic data', n_records: records.length,
  years: { from: 2016, to: 2026 },
  provenance: {
    config_version: 'demo', config_md5: 'demo', filter: 'publication_year:2016-2026,type:article|review,is_retracted:false',
    queries: { insects: '(insect* OR bee OR bees OR drosophila) AND (sentien* OR welfare OR pain)', crustaceans: '(crustacea* OR decapod* OR shrimp*) AND (sentien* OR welfare OR pain)' },
    group_counts: { insects: 900, crustaceans: 400 }, state_terms: []
  },
  labels: {
    taxa: lab({ insects: 'Insects', chelicerates: 'Arachnids & horseshoe crabs', myriapods: 'Myriapods', crustaceans: 'Crustaceans', cephalopods: 'Cephalopods', gastropods: 'Gastropods', general: 'Invertebrates (general/other)' }),
    themes: { sentience: 'Sentience', emotion: 'Emotion', affect: 'Affect', consciousness: 'Consciousness', pain: 'Pain / nociception', welfare: 'Welfare' },
    contexts: { farming: 'Farming (food, feed, aquaculture)', research: 'Research & laboratory', pest: 'Pest management & invasives', wild: 'Wild populations & conservation', waste: 'Waste management', captivity: 'Zoos, pets & education', medical: 'Medical uses' },
    jgroups: { welfare: 'Animal welfare journals', entomology: 'Entomology journals', multidisciplinary: 'High-impact multidisciplinary', other: 'Other journals', unknown: 'No source' }
  },
  focal_journals: ['Animal Welfare', 'Applied Animal Behaviour Science', 'Journal of Insect Physiology', 'Nature', 'Science', 'Proceedings of the National Academy of Sciences'],
  baseline,
  validation: null,
  manual: {
    talks: Object.fromEntries(years.map(y => [y, Math.max(0, Math.round((y - 2017) * 1.6))])),
    sessions: Object.fromEntries(years.map(y => [y, y >= 2022 ? (y - 2021) : 0])),
    events: null, theses_phd: null, theses_ms: null,
    theses_openalex: Object.fromEntries(years.map(y => [y, Math.round((y - 2015) * 0.8)])),
    grants_n: null, grants_usd: null, media: null
  }
};
fs.writeFileSync(__dirname + '/../dashboard/app/data/records.json', JSON.stringify({ meta, records }));
console.log('demo records:', records.length);
