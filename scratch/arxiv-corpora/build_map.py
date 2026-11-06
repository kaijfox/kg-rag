"""Build the citation map from refs.json + contexts.json. Usage: build_map.py DIR"""
import json,sys,os,collections
d=sys.argv[1]
refs={r['key']:r for r in json.load(open(os.path.join(d,'refs.json')))}
ctx=json.load(open(os.path.join(d,'contexts.json')))
def cls(r):
    if not r['arxiv']: return 'none'
    return 'src' if r.get('tex')=='source' else ('pdf' if r.get('tex')=='pdf-only' else 'unk')
tot=collections.Counter(cls(r) for r in refs.values()); print('overall',dict(tot),'of',len(refs))
# unique keys per (section,subsection)
by=collections.OrderedDict(); sent=collections.defaultdict(list)
for c in ctx:
    k=(c['section'],c['subsection'])
    by.setdefault(k,set()).update(c['keys'])
    usable=[x for x in c['keys'] if x in refs and cls(refs[x]) in('src','pdf','unk')]
    if usable: sent[k].append((c,usable))
rows=[];L=['# Koopman citation map (generated)\n',
 f"References: {len(refs)}; on arXiv with TeX source: {tot['src']}; arXiv, PDF-only: {tot['pdf']}; arXiv, source unknown: {tot['unk']}; not found on arXiv: {tot['none']}.\n",
 '| Section / subsection | cited | on arXiv | TeX source | citing sentences with an arXiv paper |','|---|---|---|---|---|']
for k,keys in by.items():
    keys={x for x in keys if x in refs}
    if not keys: continue
    a=sum(1 for x in keys if cls(refs[x])!='none'); s=sum(1 for x in keys if cls(refs[x])=='src')
    L.append(f"| {k[0]} / {k[1] or '(section text)'} | {len(keys)} | {a} | {s} | {len(sent[k])} |")
open(os.path.join(d,'map.md'),'w').write('\n'.join(L)+'\n'); print('\n'.join(L))
json.dump({'|'.join(map(str,k)):[dict(sentence=c['sentence'],papers=[dict(key=x,title=refs[x]['title'],arxiv=refs[x]['arxiv'],tex=refs[x].get('tex')) for x in u]) for c,u in v] for k,v in sent.items()},open(os.path.join(d,'citing-sentences.json'),'w'),indent=1)
