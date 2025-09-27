#!/usr/bin/env python3
import os
import sys
import shutil

def main():
    if len(sys.argv) < 2:
        print('Usage: postinstall.py <install_prefix>')
        sys.exit(1)
    prefix = sys.argv[1]
    wasm_dir = os.path.join(prefix, 'wasm')
    if not os.path.isdir(wasm_dir):
        return
    # Rename libjson-c-side.wasm -> json-c-side.wasm if present
    for name in os.listdir(wasm_dir):
        if name.startswith('libjson-c-side') and name.endswith('.wasm'):
            src = os.path.join(wasm_dir, name)
            dst = os.path.join(wasm_dir, 'json-c-side.wasm')
            if os.path.exists(dst):
                os.remove(dst)
            shutil.move(src, dst)

if __name__ == '__main__':
    main()

