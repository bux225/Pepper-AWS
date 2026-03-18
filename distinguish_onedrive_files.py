"""
List 5 owned and 5 shared files from the user's OneDrive using Microsoft Graph API search endpoint.
Distinguishes ownership using remoteItem, driveId, and createdBy.user.id.
Uses the auth helpers from ms_graph_auth_snippet.py.
"""

import time
from ms_graph_auth_snippet import get_access_token, GRAPH_API_ENDPOINT
import requests

ONEDRIVE_SCOPES = [
    "https://graph.microsoft.com/Files.Read.All",
]


def get_my_drive_id(token):
    headers = {"Authorization": f"Bearer {token}"}
    url = f"{GRAPH_API_ENDPOINT}/me/drive"
    resp = requests.get(url, headers=headers)
    if resp.status_code == 200:
        return resp.json().get("id")
    print(f"Could not get driveId: {resp.status_code} {resp.text[:200]}")
    return None


def get_my_user_id(token):
    headers = {"Authorization": f"Bearer {token}"}
    url = f"{GRAPH_API_ENDPOINT}/me"
    resp = requests.get(url, headers=headers)
    if resp.status_code == 200:
        return resp.json().get("id")
    print(f"Could not get userId: {resp.status_code} {resp.text[:200]}")
    return None


def search_onedrive_files(token, top=100):
    headers = {"Authorization": f"Bearer {token}"}
    params = {"$top": str(top), "$select": "name,webUrl,remoteItem,parentReference,createdBy"}
    url = f"{GRAPH_API_ENDPOINT}/me/drive/root/search(q='')"
    resp = requests.get(url, headers=headers, params=params)
    if resp.status_code == 429:
        retry_after = int(resp.headers.get("Retry-After", 5))
        print(f"  Throttled — waiting {retry_after}s")
        time.sleep(retry_after)
        resp = requests.get(url, headers=headers, params=params)
    if resp.status_code != 200:
        print(f"  API error {resp.status_code}: {resp.text[:200]}")
        return []
    return resp.json().get("value", [])


def classify_files(files, my_drive_id, my_user_id):
    owned = []
    shared = []
    for item in files:
        # 1. remoteItem facet: if present, it's shared
        if "remoteItem" in item:
            shared.append(item)
            continue
        # 2. driveId: if not my drive, it's shared
        parent = item.get("parentReference", {})
        if parent.get("driveId") and parent["driveId"] != my_drive_id:
            shared.append(item)
            continue
        # 3. createdBy.user.id: if not me, treat as shared (fallback)
        creator = item.get("createdBy", {}).get("user", {}).get("id")
        if creator and creator != my_user_id:
            shared.append(item)
            continue
        # Otherwise, owned
        owned.append(item)
    return owned, shared


def main():
    token = get_access_token(scopes=ONEDRIVE_SCOPES)
    my_drive_id = get_my_drive_id(token)
    my_user_id = get_my_user_id(token)
    if not my_drive_id or not my_user_id:
        print("Could not determine drive or user id.")
        return
    files = search_onedrive_files(token, top=100)
    owned, shared = classify_files(files, my_drive_id, my_user_id)
    print("Your files (up to 5):")
    for i, item in enumerate(owned[:5], 1):
        print(f"{i}. {item.get('name')}  →  {item.get('webUrl')}")
    print("\nShared with you (up to 5):")
    for i, item in enumerate(shared[:5], 1):
        print(f"{i}. {item.get('name')}  →  {item.get('webUrl')}")


if __name__ == "__main__":
    main()
