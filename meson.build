project('json-c.wasm', 'c', version: '0.17.0', meson_version: '>=1.3.0',
  default_options: ['buildtype=release'])

fs = import('fs')

if get_option('simd')
  add_project_arguments('-msimd128', language: 'c')
endif

incs = include_directories('.')

# Collect core sources (exclude tests/apps/bench/examples)
core_sources = []
core_sources += fs.glob('*.c', exclude: ['tests/**', 'bench/**', 'benchmarks/**', 'examples/**', 'apps/**'])

core = static_library('jsonc_core', core_sources, include_directories: incs)

install_dir = get_option('bindir')

if get_option('main_module')
  main_link_args = [
    '--no-entry',
    '-sMODULARIZE=1',
    '-sEXPORT_ES6=1',
    '-sALLOW_MEMORY_GROWTH=1',
    '-sENVIRONMENT=web,webview,worker',
    '-sNO_FILESYSTEM=1',
    '-sEXPORTED_RUNTIME_METHODS=["cwrap","ccall","UTF8ToString"]',
    '-sEXPORTED_FUNCTIONS=@' + meson.project_source_root() / get_option('exports'),
  ]
  executable('json-c-main', 'src/jsonc_wasm_module.c',
    link_with: core,
    include_directories: incs,
    install: true,
    link_args: main_link_args)
endif

if get_option('side_module')
  shared_module('json-c-side', 'src/jsonc_wasm_side.c',
    link_whole: core,
    include_directories: incs,
    install: true,
    link_args: ['-sSIDE_MODULE=2', '-fPIC'])
endif

