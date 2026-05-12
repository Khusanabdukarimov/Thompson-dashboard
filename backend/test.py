import requests

# ── paste your token here ─────────────────────────────────────────────────────
PORTAL = "https://mountain.bitrix24.kz/rest/"
TOKEN  = "YOUR_TOKEN_HERE"          # <-- only this needs to change
# ─────────────────────────────────────────────────────────────────────────────

START = "2026-04-30"
END   = "2026-05-12"

JARAYON = {"NEW","IN_PROCESS","PROCESSED","UC_1KPATX","UC_Q2U9EL","UC_KXC3ZW","UC_L28G68"}

def api(method, params=None):
    r = requests.get(f"{PORTAL}{TOKEN}/{method}", params=params or {}, timeout=30)
    return r.json().get("result", [])

def list_leads(f):
    out, start = [], 0
    while True:
        p = {"start": start, **{f"filter[{k}]": v for k, v in f.items()},
             "select[]": ["ID","STATUS_ID","DATE_CREATE","OPPORTUNITY","ASSIGNED_BY_ID"]}
        d = requests.get(f"{PORTAL}{TOKEN}/crm.lead.list", params=p, timeout=30).json()
        out += d.get("result", [])
        if "next" in d: start = d["next"]
        else: break
    return out

def status_names():
    r = requests.get(f"{PORTAL}{TOKEN}/crm.status.list.json",
                     params={"filter[ENTITY_ID]":"STATUS"}, timeout=15).json()
    return {s["STATUS_ID"]: s["NAME"] for s in r.get("result", [])}

# ── fetch ─────────────────────────────────────────────────────────────────────
print(f"\nFetching leads {START} → {END} ...")
names = status_names()
raw   = list_leads({">=DATE_CREATE": START, "<=DATE_CREATE": f"{END}T23:59:59"})

# raw breakdown
raw_bs = {}
for l in raw:
    s = l.get("STATUS_ID","?"); raw_bs[s] = raw_bs.get(s,0)+1

print(f"\n{'='*65}")
print(f" RAW from Bitrix24 (before any filter): {len(raw)} leads")
print(f"{'='*65}")
for sid,cnt in sorted(raw_bs.items(), key=lambda x:-x[1]):
    print(f"  {cnt:>6}   {sid:<22} {names.get(sid,sid)}")

# post-filter: only leads whose DATE_CREATE is inside the window
leads = [l for l in raw if START <= (l.get("DATE_CREATE") or "")[:10] <= END]
removed = len(raw) - len(leads)

bs = {}
for l in leads:
    s = l.get("STATUS_ID","?"); bs[s] = bs.get(s,0)+1

total     = len(leads)
jarayon   = sum(v for k,v in bs.items() if k in JARAYON)
converted = sum(v for k,v in bs.items() if "CONVERT" in k.upper() or k=="CLOSED")
failed    = total - jarayon - converted
conv_rate = round(converted/total*100, 2) if total else 0

tb_id  = next((k for k,n in names.items() if "belgiland" in n.lower()), None)
tbu_id = next((k for k,n in names.items() if "buyur"     in n.lower()), None)
tb     = bs.get(tb_id,  0) if tb_id  else 0
tbu    = bs.get(tbu_id, 0) if tbu_id else converted

print(f"\n{'='*65}")
print(f" AFTER post-filter: {total} leads  (removed {removed} out-of-range)")
print(f"{'='*65}")
print(f"  Barcha lidlar          {total}")
print(f"  Jarayonda              {jarayon}")
print(f"  Muvaffaqiyatsiz        {failed}   (bekor+sifatsiz+sandiq+...)")
print(f"  Sdelkaga (converted)   {converted}")
print(f"  Konversiya             {conv_rate}%")
print(f"  Tashrif belgilandi     {tb}   ({names.get(tb_id,'?')})")
print(f"  Konv→Tashrif belg      {round(tb/total*100,2)  if total else 0}%")
print(f"  Konv→Tashrif buyurdi   {round(tbu/total*100,2) if total else 0}%")
print(f"  Sifatli konversiya     {round(tbu/tb*100,2) if tb else 0}%")
print(f"\n  By status:")
for sid,cnt in sorted(bs.items(), key=lambda x:-x[1]):
    print(f"  {cnt:>6}   {sid:<22} {names.get(sid,sid)}")
print(f"{'='*65}")
print(f"  Check: {jarayon}+{converted}+{failed} = {jarayon+converted+failed} (must == {total})")
