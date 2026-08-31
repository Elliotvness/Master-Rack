"""Build the interlake-2026-09 beam catalog FROM THE PSG 2025 CHART.

Deliberately not a copy of RackMaster_Beams_Updated.json. That file happens to
agree with the chart, but adopting it would mean trusting a file with no
provenance. This regenerates every capacity from the chart transcribed out of
PDF page 88, and drops the 42 phantom 40E/40ER F3M rows that page 84 shows are
not published. Descriptive fields (part numbers, codes, deflection, face
height) are carried forward unchanged from 2026-08 -- only capacity is
re-sourced, and only unpublished rows are removed.
"""
import json, pathlib, hashlib, collections

base = pathlib.Path(r'C:\Rack Master')
repo = base / 'rack-master-studio'
old_dir = repo / 'data/catalog/interlake-2026-08'
new_dir = repo / 'data/catalog/interlake-2026-09'

SPANS = [48,54,60,66,72,78,84,92,96,102,108,114,120,126,132,138,144,150,156,162,168]
COLUMNS = ['27E','36E','40E','45E','50E','59E','65E','65Q']
CHART = [
 [5610,8050,9810,11090,12880,16910,17115,27940],
 [5080,7230,8830,9950,11530,15140,17110,24940],
 [4640,6570,8040,9050,10460,13720,15850,22540],
 [4290,6030,7390,8300,9580,12560,14480,20570],
 [3990,5590,6850,7680,8850,11590,13360,18940],
 [3510,5210,6390,7150,8220,10780,12400,17550],
 [3080,4880,6010,6700,7690,10080,11580,16370],
 [2630,4510,5560,6190,7090,9280,10650,15030],
 [2440,4170,5370,5960,6820,8940,10240,14430],
 [2200,3740,4870,5650,6470,8460,9690,13640],
 [1990,3370,4390,5380,6150,8040,9190,12920],
 [1810,3050,3990,5040,5870,7660,8760,12300],
 [1660,2780,3640,4590,5610,7330,8370,11730],
 [1530,2550,3340,4210,5230,7020,8000,11210],
 [1410,2350,3080,3870,4800,6740,7680,10750],
 [1310,2170,2850,3570,4420,6490,7380,10310],
 [1220,2010,2650,3310,4100,6250,7110,9920],
 [1140,1870,2470,3080,3800,5820,6850,9560],
 [1070,1740,2300,2870,3540,5420,6630,9040],
 [1000,1630,2160,2690,3310,5060,6250,8420],
 [940,1530,2030,2520,3100,4740,5840,7870],
]
PLATE = {'27E':'F3M','36E':'F3M','40E':'F4M','45E':'F4M','50E':'F4M',
         '59E':'F5M','65E':'F5M','65Q':'F5M'}

def base_family(f):
    return f[:-1] if f.endswith('R') and f != '65Q' else f

old = json.loads((old_dir / 'beams.json').read_text(encoding='utf-8'))
rows_out, dropped, changed = [], [], 0

for r in old['rows']:
    fam = base_family(r['family'])
    if PLATE[fam] != r['series']:
        dropped.append(r)                       # unpublished end plate for this family
        continue
    cap = CHART[SPANS.index(r['span_in'])][COLUMNS.index(fam)]
    new_row = dict(r)
    if new_row['capacity_lbs'] != cap:
        changed += 1
    new_row['capacity_lbs'] = cap
    rows_out.append(new_row)

rows_out.sort(key=lambda r: (r['family'], r['span_in']))
doc = {'schema_version': 1, 'manufacturer': 'Interlake Mecalux', 'rev': '2026-09',
       'rows': rows_out}
new_dir.mkdir(parents=True, exist_ok=True)
body = json.dumps(doc, indent=1, sort_keys=True, ensure_ascii=False) + '\n'
(new_dir / 'beams.json').write_text(body, encoding='utf-8')

digest = hashlib.sha256(
    json.dumps(rows_out, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

print(f"rows in : {len(old['rows'])}")
print(f"rows out: {len(rows_out)}")
print(f"dropped : {len(dropped)} ({sorted(set((d['family'], d['series']) for d in dropped))})")
print(f"capacities changed: {changed}")
print(f"content_sha256: {digest}")

# Cross-check against the supplied file: must agree on every surviving row.
sup = {r['code_18']: r['capacity_lbs']
       for r in json.loads((base / 'RackMaster_Beams_Updated.json').read_text(encoding='utf-8'))['rows']}
dis = [r['code_18'] for r in rows_out if sup.get(r['code_18']) != r['capacity_lbs']]
print(f"disagreements vs supplied file on surviving rows: {len(dis)}")
pathlib.Path(repo / 'build-report.txt').write_text(
    f"rows_out={len(rows_out)} dropped={len(dropped)} changed={changed}\nsha={digest}\n"
    f"disagreements={len(dis)}\n", encoding='utf-8')
