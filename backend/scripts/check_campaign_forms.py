"""
Check campaign names and their linked instant forms (Lead Gen Forms).

Usage:
    cd backend
    python scripts/check_campaign_forms.py

Set TOKEN and AD_ACCOUNT below, or export them as env vars:
    FB_ACCESS_TOKEN=... FB_AD_ACCOUNT_ID=... python scripts/check_campaign_forms.py
"""
import json
import os
import sys

import requests

TOKEN      = os.environ.get("FB_ACCESS_TOKEN") or os.environ.get("META_USER_TOKEN") or ""
AD_ACCOUNT = os.environ.get("FB_AD_ACCOUNT_ID") or os.environ.get("META_AD_ACCOUNT_ID") or "act_932239158316127"

GRAPH = "https://graph.facebook.com/v19.0"


def _get_all(url, params):
    rows = []
    while url:
        r = requests.get(url, params=params, timeout=20)
        d = r.json()
        if "error" in d:
            print(f"  [API error] {d['error'].get('message', d['error'])}", file=sys.stderr)
            return rows
        rows.extend(d.get("data", []))
        url = d.get("paging", {}).get("next")
        params = {}
    return rows


def _extract_form_id(creative: dict) -> str | None:
    """Extract lead_gen_form_id from ad creative (video_data or link_data CTA)."""
    spec = creative.get("object_story_spec") or {}
    for section in ("video_data", "link_data"):
        cta = (spec.get(section) or {}).get("call_to_action") or {}
        form_id = (cta.get("value") or {}).get("lead_gen_form_id")
        if form_id:
            return form_id
    return None


def main():
    if not TOKEN or not AD_ACCOUNT:
        print("ERROR: set FB_ACCESS_TOKEN and FB_AD_ACCOUNT_ID as env vars.", file=sys.stderr)
        sys.exit(1)

    account = AD_ACCOUNT if AD_ACCOUNT.startswith("act_") else f"act_{AD_ACCOUNT}"

    # OUTCOME_LEADS campaigns store the form ID inside the ad creative (not adset promoted_object)
    # Step 1: fetch ads (basic fields only to avoid "too much data" error)
    print(f"Fetching LEADS ads for {account} ...")
    ads = _get_all(
        f"{GRAPH}/{account}/ads",
        {
            "access_token": TOKEN,
            "fields": "id,name,adset_id,campaign_id,creative{id}",
            "limit": 200,
            "filtering": '[{"field":"campaign.objective","operator":"IN","value":["OUTCOME_LEADS","LEAD_GENERATION"]}]',
        },
    )
    print(f"  Found {len(ads)} LEADS ads total")

    # Step 2: collect creative IDs and fetch object_story_spec separately
    creative_ids = list({(ad.get("creative") or {}).get("id") for ad in ads if (ad.get("creative") or {}).get("id")})
    print(f"  Fetching creatives for {len(creative_ids)} unique creative(s) ...")
    creative_map = {}
    for cid in creative_ids:
        r = requests.get(
            f"{GRAPH}/{cid}",
            params={"access_token": TOKEN, "fields": "id,object_story_spec"},
            timeout=20,
        )
        d = r.json()
        if "id" in d:
            creative_map[cid] = d

    # Step 3: fetch campaign + adset names
    camp_ids = list({ad.get("campaign_id") for ad in ads if ad.get("campaign_id")})
    adset_ids = list({ad.get("adset_id") for ad in ads if ad.get("adset_id")})

    camp_info = {}
    for cid in camp_ids:
        r = requests.get(f"{GRAPH}/{cid}", params={"access_token": TOKEN, "fields": "id,name,objective"}, timeout=20)
        d = r.json()
        if "id" in d:
            camp_info[cid] = d

    adset_info_map = {}
    for aid in adset_ids:
        r = requests.get(f"{GRAPH}/{aid}", params={"access_token": TOKEN, "fields": "id,name,status"}, timeout=20)
        d = r.json()
        if "id" in d:
            adset_info_map[aid] = d

    # Attach resolved data back onto ads
    for ad in ads:
        cid = (ad.get("creative") or {}).get("id")
        if cid:
            ad["_creative"] = creative_map.get(cid, {})
        ad["_campaign"] = camp_info.get(ad.get("campaign_id") or "", {})
        ad["_adset"] = adset_info_map.get(ad.get("adset_id") or "", {})

    # Group by campaign → form
    campaign_map = {}
    for ad in ads:
        form_id = _extract_form_id(ad.get("_creative") or {})
        if not form_id:
            continue
        camp = ad.get("_campaign") or {}
        adset = ad.get("_adset") or {}
        camp_id = camp.get("id") or ad.get("campaign_id", "")
        if camp_id not in campaign_map:
            campaign_map[camp_id] = {
                "campaign_id": camp_id,
                "campaign_name": camp.get("name", ""),
                "objective": camp.get("objective", ""),
                "forms": {},
            }
        campaign_map[camp_id]["forms"].setdefault(form_id, {
            "form_id":     form_id,
            "adset_id":    adset.get("id") or ad.get("adset_id", ""),
            "adset_name":  adset.get("name", ""),
            "adset_status":adset.get("status", ""),
        })

    if not campaign_map:
        print("\nNo instant form campaigns found.")
        return

    # Fetch form details for each unique form ID
    all_form_ids = list({fid for c in campaign_map.values() for fid in c["forms"]})
    print(f"\nFetching details for {len(all_form_ids)} unique form(s) ...")
    form_details = {}
    for form_id in all_form_ids:
        r = requests.get(
            f"{GRAPH}/{form_id}",
            params={"access_token": TOKEN, "fields": "id,name,status,leads_count,created_time"},
            timeout=20,
        )
        d = r.json()
        form_details[form_id] = d if "id" in d else {"id": form_id, "name": f"[{form_id}]", "status": "UNKNOWN"}

    # Print results
    print("\n" + "=" * 70)
    for camp in sorted(campaign_map.values(), key=lambda c: c["campaign_name"]):
        print(f"\nCampaign : {camp['campaign_name']}")
        print(f"ID       : {camp['campaign_id']}")
        print(f"Objective: {camp['objective']}")
        print(f"Forms ({len(camp['forms'])}):")
        for fid, adset_info in camp["forms"].items():
            fd = form_details.get(fid, {})
            leads = fd.get("leads_count", "n/a")
            print(f"  - {fd.get('name', fid)}")
            print(f"      form_id  : {fid}")
            print(f"      status   : {fd.get('status', '?')}")
            print(f"      leads    : {leads}")
            print(f"      created  : {(fd.get('created_time') or '?')[:10]}")
            print(f"      adset    : {adset_info['adset_name']} ({adset_info['adset_status']})")
    print("\n" + "=" * 70)


if __name__ == "__main__":
    main()
