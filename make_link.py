#!/usr/bin/env python3
"""Maak een link van een workout-JSON: python3 make_link.py workout.json https://jouw.site/"""
import json, sys, urllib.parse
w = json.load(open(sys.argv[1]))
base = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:8000/"
print(base + "#j=" + urllib.parse.quote(json.dumps(w, ensure_ascii=False, separators=(",", ":"))))
