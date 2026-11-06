"""Download TeX source tarballs and PDFs for a scope. Usage: download.py REFS CONTEXTS SECTION_PREFIX OUT_DIR
Files are saved unextracted: OUT/tex/<id>.tar.gz|.gz, OUT/pdf/<id>.pdf; manifest.json records status."""
import json,sys,os,time,urllib.request
refs_p,ctx_p,pref,out=sys.argv[1:5]
refs={r['key']:r for r in json.load(open(refs_p))}
ids={}
for c in json.load(open(ctx_p)):
    if c['section'].startswith(pref):
        for k in c['keys']:
            if k in refs and refs[k]['arxiv']: ids[refs[k]['arxiv'].replace('/','_')]=(refs[k]['arxiv'],refs[k]['title'])
extra=os.environ.get('EXTRA','').split()
for e in extra: ids[e]=(e,'(review)')
for sub in('tex','pdf'): os.makedirs(f'{out}/{sub}',exist_ok=True)
mf=f'{out}/manifest.json'; man=json.load(open(mf)) if os.path.exists(mf) else {}
def fetch(url,dest):
    for i in range(3):
        try:
            b=urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'kg-rag-corpus-scoping'}),timeout=90).read()
            open(dest,'wb').write(b); return len(b)
        except Exception as e: err=str(e)[:50]; time.sleep(5)
    return 'ERR '+err
n=0
for fid,(aid,title) in sorted(ids.items()):
    m=man.setdefault(fid,dict(arxiv=aid,title=title))
    if not isinstance(m.get('tex'),int): m['tex']=fetch('https://arxiv.org/e-print/'+aid,f'{out}/tex/{fid}.src'); time.sleep(3.2)
    if not isinstance(m.get('pdf'),int): m['pdf']=fetch('https://arxiv.org/pdf/'+aid,f'{out}/pdf/{fid}.pdf'); time.sleep(3.2)
    n+=1; json.dump(man,open(mf,'w'),indent=1); print(n,'of',len(ids),fid,m['tex'],m['pdf'],flush=True)
print('done',flush=True)
