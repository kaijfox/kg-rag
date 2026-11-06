"""Resolve a review's bibliography to arXiv ids, check TeX source availability,
and extract citing sentences per section. Usage: resolve.py MAIN_TEX OUT_DIR
Stages cache into OUT_DIR so reruns resume. Network: OpenAlex, arXiv API/e-print."""
import re,sys,json,os,time,difflib,urllib.request,urllib.parse
main,out=sys.argv[1],sys.argv[2]; os.makedirs(out,exist_ok=True)
T=open(main,errors='ignore').read()
body,bib=T.split('\\begin{thebibliography}')
def norm(s): return re.sub(r'[^a-z0-9]','',re.sub(r'\\[a-zA-Z]+','',s).lower())
def get(url,rng=None,tries=3):
    for i in range(tries):
        try:
            r=urllib.request.Request(url,headers={'User-Agent':'kg-rag-corpus-scoping'}|({'Range':rng} if rng else {}))
            return urllib.request.urlopen(r,timeout=40)
        except Exception as e: last=e; time.sleep(4)
    raise last
# ---- bib
refs=[]
for it in re.split(r'\\bibitem(?:\[[^\]]*\])?\{',bib)[1:]:
    key=it.split('}')[0]
    m=re.search(r'\{\\em\s+(.*?)\}\s*,',it,re.S)
    title=re.sub(r'\s+',' ',re.sub(r'[{}]','',m.group(1))).strip() if m else None
    yr=re.search(r'\((\d{4})\)',it); ax=re.search(r'arXiv[: ]*([a-z\-]*/?\d{4}\.\d{4,5}|[a-z\-]+/\d{7})',it,re.I)
    refs.append(dict(key=key,title=title,year=yr.group(1) if yr else None,arxiv=ax.group(1) if ax else None,how='bib' if ax else None))
cache=os.path.join(out,'refs.json')
if os.path.exists(cache): refs=json.load(open(cache))
def save(): json.dump(refs,open(cache,'w'),indent=1)
def ok(a,b): return difflib.SequenceMatcher(None,norm(a),norm(b)).ratio()>=0.93
# ---- stage 1 OpenAlex (skipped when SKIP_OA=1; anonymous daily budget can be exhausted)
for r in refs:
    if os.environ.get('SKIP_OA') or r['arxiv'] or r.get('oa_done') or not r['title']: continue
    try:
        d=json.load(get('https://api.openalex.org/works?per-page=3&search='+urllib.parse.quote(r['title'])))
        for w in d['results']:
            if not w.get('title') or not ok(r['title'],w['title']): continue
            r['oa_title']=w['title']; r['doi']=w.get('doi')
            for loc in (w.get('locations') or []):
                u=(loc.get('landing_page_url') or '')+' '+(loc.get('pdf_url') or '')
                m=re.search(r'arxiv\.org/(?:abs|pdf)/([a-z\-]*/?\d{4}\.\d{4,5}|[a-z\-]+/\d{7})',u)
                if m: r['arxiv']=m.group(1); r['how']='openalex'; break
            if not r['arxiv'] and w.get('doi') and '10.48550/arxiv.' in w['doi'].lower():
                r['arxiv']=w['doi'].lower().split('10.48550/arxiv.')[1]; r['how']='openalex-doi'
            break
    except Exception as e: r['oa_err']=str(e)[:60]
    r['oa_done']=True; time.sleep(0.15)
save(); print('stage1 done',sum(1 for r in refs if r['arxiv']),flush=True)
# ---- stage 2 arXiv API for misses
for r in refs:
    if r['arxiv'] or r.get('ax_done') or not r['title']: continue
    try:
        q=urllib.parse.quote('ti:"%s"'%re.sub(r'[^A-Za-z0-9 ]',' ',r['title']))
        x=get('http://export.arxiv.org/api/query?max_results=3&search_query='+q).read().decode()
        for e in re.findall(r'<entry>(.*?)</entry>',x,re.S):
            t=re.search(r'<title>(.*?)</title>',e,re.S).group(1); i=re.search(r'/abs/(.*?)</id>',e).group(1)
            if ok(r['title'],t): r['arxiv']=re.sub(r'v\d+$','',i); r['how']='arxiv-api'; break
    except Exception as e: r['ax_err']=str(e)[:60]
    r['ax_done']=True; time.sleep(3.2)
    n=sum(1 for q in refs if q.get('ax_done'))
    if n%25==0: save(); print('stage2',n,'of',len(refs),'resolved',sum(1 for q in refs if q['arxiv']),'errors',sum(1 for q in refs if q.get('ax_err')),flush=True)
save(); print('stage2 done',sum(1 for r in refs if r['arxiv']),flush=True)
# ---- stage 3 source availability
for r in refs:
    if not r['arxiv'] or 'tex' in r: continue
    a=re.sub(r'v\d+$','',r['arxiv'])
    try:
        resp=get('https://arxiv.org/e-print/'+a,rng='bytes=0-511'); b=resp.read(512)
        r['tex']='pdf-only' if b[:4]==b'%PDF' else ('source' if b[:2]==b'\x1f\x8b' or b[:5]!=b'<!DOC' else 'unknown')
    except Exception as e: r['tex']='err '+str(e)[:40]
    time.sleep(3.2)
    n=sum(1 for q in refs if 'tex' in q)
    if n%25==0: save(); print('stage3',n,'of',sum(1 for q in refs if q['arxiv']),flush=True)
save(); print('stage3 done',flush=True)
# ---- contexts
sec=sub=None; ctx=[]; buf=''
lines=body.split('\n')
def flush():
    global buf
    txt=re.sub(r'(?<!\\)%.*','',buf)
    for s in re.split(r'(?<=[.?!])\s+(?=[A-Z\\$])',re.sub(r'\s+',' ',txt)):
        ks=[k.strip() for g in re.findall(r'\\cite[a-z]*(?:\[[^\]]*\])*\{([^}]*)\}',s) for k in g.split(',')]
        if ks: ctx.append(dict(section=sec,subsection=sub,keys=ks,sentence=s[:600]))
    buf=''
for l in lines:
    m=re.match(r'\\(sub)?section\*?\{(.*?)\}',l)
    if m:
        flush()
        if m.group(1): sub=m.group(2)
        else: sec=m.group(2); sub=None
    buf+=l+'\n'
flush(); json.dump(ctx,open(os.path.join(out,'contexts.json'),'w'),indent=1)
print('contexts',len(ctx),flush=True)
