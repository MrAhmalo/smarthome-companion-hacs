#!/usr/bin/env python3
"""
strip_version_queries.py
Strips hardcoded query parameters (e.g. ?v=2.8.23) from all ES module import/export statements
across the smarthome_companion frontend.
"""
import os
import re

FRONTEND_DIR = os.path.dirname(os.path.abspath(__file__))

# Matches from './path.js?v=2.8.23' or import './path.js?v=2.8.23'
PATTERN = re.compile(r"""((?:from|import)\s+['"][^'"]*?)(\?v=[^'"]+)(['"])""")

def clean_files():
    modified = 0
    total_matches = 0
    for root, dirs, files in os.walk(FRONTEND_DIR):
        if "dev" in root or "dist" in root:
            continue
        for f in files:
            if not f.endswith(".js"):
                continue
            path = os.path.join(root, f)
            with open(path, "r", encoding="utf-8") as fp:
                content = fp.read()

            new_content, count = PATTERN.subn(r"\1\3", content)
            if count > 0:
                with open(path, "w", encoding="utf-8") as fp:
                    fp.write(new_content)
                rel = os.path.relpath(path, FRONTEND_DIR)
                print(f"Cleaned {count} import(s) in: {rel}")
                modified += 1
                total_matches += count

    print(f"\nDone! Cleaned {total_matches} import(s) in {modified} file(s).")

if __name__ == "__main__":
    clean_files()
