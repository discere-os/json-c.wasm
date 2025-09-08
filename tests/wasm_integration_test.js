#!/usr/bin/env node
/**
 * json-c.wasm integration tests
 * Tests C/WASM JSON processing functionality and performance
 */

import { promises as fs } from 'fs';
import { performance } from 'perf_hooks';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.join(__dirname, '..', 'dist');

// Test JSON samples
const TEST_CASES = {
    simple: '{"name": "test", "value": 42, "active": true, "data": null}',
    array: '[1, 2, 3, "four", true, null, {"nested": "object"}]',
    nested: {
        users: [
            { id: 1, name: "Alice", email: "alice@example.com", active: true },
            { id: 2, name: "Bob", email: "bob@example.com", active: false }
        ],
        meta: {
            total: 2,
            page: 1,
            limit: 10
        }
    },
    large: {
        data: Array.from({length: 1000}, (_, i) => ({
            id: i,
            name: `Item ${i}`,
            values: [i * 2, i * 3, i * 4],
            metadata: {
                created: new Date(2020, 0, i + 1).toISOString(),
                tags: [`tag-${i % 10}`, `category-${Math.floor(i / 100)}`]
            }
        }))
    },
    unicode: '{"message": "Hello 世界! 🌍", "emoji": "🚀💻🎉", "utf8": "Ñiño français العربية"}',
    malformed: '{"invalid": json, "missing": quotes, unterminated:',
    empty: '{}',
    emptyArray: '[]'
};

// Convert objects to JSON strings for testing
Object.keys(TEST_CASES).forEach(key => {
    if (typeof TEST_CASES[key] === 'object') {
        TEST_CASES[key] = JSON.stringify(TEST_CASES[key]);
    }
});

// Test configuration
const TEST_CONFIG = {
    timeout: 30000,
    benchmarkIterations: 100
};

// Test results collector
const results = {
    passed: 0,
    failed: 0,
    tests: []
};

// Utility functions
const log = (msg) => console.log(`[TEST] ${msg}`);
const error = (msg) => console.error(`[ERROR] ${msg}`);
const assert = (condition, message) => {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
};

// Test helper to run individual test
async function runTest(name, testFn) {
    log(`Running test: ${name}`);
    const start = performance.now();
    
    try {
        await testFn();
        const duration = Math.round(performance.now() - start);
        log(`✓ ${name} (${duration}ms)`);
        results.passed++;
        results.tests.push({ name, status: 'PASSED', duration });
    } catch (err) {
        const duration = Math.round(performance.now() - start);
        error(`✗ ${name} (${duration}ms): ${err.message}`);
        results.failed++;
        results.tests.push({ name, status: 'FAILED', duration, error: err.message });
    }
}

// Load WASM module for testing
async function loadJsonCModule(useSIMD = false) {
    const moduleName = useSIMD ? 'json-c-simd.js' : 'json-c.js';
    const modulePath = path.join(DIST_DIR, moduleName);
    
    try {
        await fs.access(modulePath);
        const { default: JsonCModule } = await import(modulePath);
        return await JsonCModule();
    } catch (err) {
        throw new Error(`WASM module not found: ${modulePath}. Run ./build-wasm.sh first. Error: ${err.message}`);
    }
}

// Test 1: Basic module loading
async function testModuleLoading() {
    const module = await loadJsonCModule();
    
    // Test basic function availability
    assert(typeof module.json_c_parse_to_string === 'function', 'json_c_parse_to_string should be available');
    assert(typeof module.json_c_validate === 'function', 'json_c_validate should be available');
    assert(typeof module.json_c_pretty_print === 'function', 'json_c_pretty_print should be available');
    assert(typeof module.ccall === 'function', 'ccall should be available');
    assert(typeof module.cwrap === 'function', 'cwrap should be available');
    assert(module.HEAPU8 instanceof Uint8Array, 'HEAPU8 should be available');
}

// Test 2: JSON parsing functionality
async function testJsonParsing() {
    const module = await loadJsonCModule();
    
    const parseJson = module.cwrap('json_c_parse_to_string', 'string', ['string']);
    const validateJson = module.cwrap('json_c_validate', 'number', ['string']);
    
    // Test valid JSON parsing
    Object.entries(TEST_CASES).forEach(([name, json]) => {
        if (name === 'malformed') return; // Skip malformed for valid tests
        
        try {
            const result = parseJson(json);
            assert(result !== null, `Should parse ${name} JSON successfully`);
            
            const isValid = validateJson(json);
            assert(isValid === 1, `${name} JSON should validate as correct`);
            
            // Verify we can re-parse the result with JavaScript
            const jsParseResult = JSON.parse(result);
            assert(jsParseResult !== null, `Parsed result should be valid JSON for ${name}`);
            
        } catch (err) {
            throw new Error(`Failed to parse ${name} JSON: ${err.message}`);
        }
    });
    
    log('✓ All valid JSON cases parsed successfully');
}

// Test 3: Error handling for malformed JSON
async function testErrorHandling() {
    const module = await loadJsonCModule();
    
    const validateJson = module.cwrap('json_c_validate', 'number', ['string']);
    
    // Test malformed JSON
    const isValid = validateJson(TEST_CASES.malformed);
    assert(isValid === 0, 'Malformed JSON should not validate');
    
    // Test null/empty inputs
    const nullResult = validateJson('');
    assert(nullResult === 0, 'Empty string should not validate');
    
    log('✓ Error handling works correctly');
}

// Test 4: Pretty printing functionality
async function testPrettyPrinting() {
    const module = await loadJsonCModule();
    
    const prettyPrint = module.cwrap('json_c_pretty_print', 'string', ['string', 'number']);
    
    const compactJson = '{"a":1,"b":[2,3],"c":{"d":4}}';
    const prettyResult = prettyPrint(compactJson, 2);
    
    assert(prettyResult !== null, 'Pretty print should return result');
    assert(prettyResult.includes('\n'), 'Pretty printed JSON should contain newlines');
    assert(prettyResult.length > compactJson.length, 'Pretty printed JSON should be longer');
    
    // Verify the result is still valid JSON
    const parsed = JSON.parse(prettyResult);
    assert(parsed.a === 1, 'Pretty printed JSON should maintain data integrity');
    
    log('✓ Pretty printing works correctly');
}

// Test 5: Object creation and manipulation
async function testObjectManipulation() {
    const module = await loadJsonCModule();
    
    const createObject = module.cwrap('json_c_object_new', 'number', []);
    const addString = module.cwrap('json_c_object_add_string', 'number', ['number', 'string', 'string']);
    const addInt = module.cwrap('json_c_object_add_int', 'number', ['number', 'string', 'number']);
    const addDouble = module.cwrap('json_c_object_add_double', 'number', ['number', 'string', 'number']);
    const toString = module.cwrap('json_object_to_json_string', 'string', ['number']);
    const putObject = module.cwrap('json_object_put', null, ['number']);
    
    // Create and manipulate object
    const obj = createObject();
    assert(obj !== 0, 'Object creation should return valid pointer');
    
    const stringResult = addString(obj, 'name', 'json-c.wasm');
    assert(stringResult !== 0, 'Adding string should succeed');
    
    const intResult = addInt(obj, 'version', 18);
    assert(intResult !== 0, 'Adding integer should succeed');
    
    const doubleResult = addDouble(obj, 'pi', 3.14159);
    assert(doubleResult !== 0, 'Adding double should succeed');
    
    // Convert to string and verify
    const jsonString = toString(obj);
    assert(jsonString !== null, 'Object to string conversion should succeed');
    
    const parsed = JSON.parse(jsonString);
    assert(parsed.name === 'json-c.wasm', 'String value should be preserved');
    assert(parsed.version === 18, 'Integer value should be preserved');
    assert(Math.abs(parsed.pi - 3.14159) < 0.00001, 'Double value should be preserved');
    
    // Cleanup
    putObject(obj);
    
    log('✓ Object manipulation works correctly');
}

// Test 6: Array manipulation
async function testArrayManipulation() {
    const module = await loadJsonCModule();
    
    const createArray = module.cwrap('json_c_array_new', 'number', []);
    const addString = module.cwrap('json_c_array_add_string', 'number', ['number', 'string']);
    const addInt = module.cwrap('json_c_array_add_int', 'number', ['number', 'number']);
    const toString = module.cwrap('json_object_to_json_string', 'string', ['number']);
    const putObject = module.cwrap('json_object_put', null, ['number']);
    
    // Create and manipulate array
    const array = createArray();
    assert(array !== 0, 'Array creation should return valid pointer');
    
    const stringResult = addString(array, 'first');
    assert(stringResult !== 0, 'Adding string to array should succeed');
    
    const intResult = addInt(array, 42);
    assert(intResult !== 0, 'Adding integer to array should succeed');
    
    // Convert to string and verify
    const jsonString = toString(array);
    assert(jsonString !== null, 'Array to string conversion should succeed');
    
    const parsed = JSON.parse(jsonString);
    assert(Array.isArray(parsed), 'Result should be an array');
    assert(parsed[0] === 'first', 'First element should be preserved');
    assert(parsed[1] === 42, 'Second element should be preserved');
    
    // Cleanup
    putObject(array);
    
    log('✓ Array manipulation works correctly');
}

// Test 7: Memory management
async function testMemoryManagement() {
    const module = await loadJsonCModule();
    
    const malloc = module.cwrap('json_c_malloc', 'number', ['number']);
    const free = module.cwrap('json_c_free', null, ['number']);
    
    // Test memory allocation/deallocation
    const ptr = malloc(1024);
    assert(ptr !== 0, 'Memory allocation should succeed');
    
    // Write some data to verify memory is accessible
    module.HEAPU8[ptr] = 42;
    assert(module.HEAPU8[ptr] === 42, 'Memory should be writable and readable');
    
    // Free memory
    free(ptr);
    
    log('✓ Memory management works correctly');
}

// Test 8: Performance benchmarking  
async function testPerformanceBenchmarking() {
    const module = await loadJsonCModule();
    
    const benchmark = module.cwrap('json_c_benchmark_parsing', 'number', ['string', 'number']);
    
    // Test different JSON sizes
    const testCases = [
        { name: 'simple', json: TEST_CASES.simple, iterations: 1000 },
        { name: 'nested', json: TEST_CASES.nested, iterations: 500 },
        { name: 'large', json: TEST_CASES.large, iterations: 50 }
    ];
    
    const benchmarkResults = {};
    
    testCases.forEach(({ name, json, iterations }) => {
        const duration = benchmark(json, iterations);
        assert(typeof duration === 'number', `Benchmark should return numeric duration for ${name}`);
        assert(duration >= 0, `Benchmark duration should be non-negative for ${name}`);
        
        const throughput = iterations / (duration / 1000);
        benchmarkResults[name] = { duration, throughput, iterations };
        
        log(`${name} benchmark: ${throughput.toFixed(0)} ops/sec`);
    });
    
    // Store results for comparison
    testPerformanceBenchmarking.results = benchmarkResults;
}

// Test 9: SIMD performance comparison
async function testSIMDPerformance() {
    let moduleRegular, moduleSIMD;
    
    try {
        moduleRegular = await loadJsonCModule(false);
        moduleSIMD = await loadJsonCModule(true);
    } catch (err) {
        log('SIMD module not available, skipping SIMD performance test');
        return;
    }
    
    const benchmarkRegular = moduleRegular.cwrap('json_c_benchmark_parsing', 'number', ['string', 'number']);
    const benchmarkSIMD = moduleSIMD.cwrap('json_c_benchmark_parsing', 'number', ['string', 'number']);
    
    const testJson = TEST_CASES.nested;
    const iterations = 100;
    
    const regularTime = benchmarkRegular(testJson, iterations);
    const simdTime = benchmarkSIMD(testJson, iterations);
    
    const speedup = regularTime / simdTime;
    log(`Performance comparison: Regular ${regularTime.toFixed(2)}ms vs SIMD ${simdTime.toFixed(2)}ms`);
    log(`SIMD speedup: ${speedup.toFixed(2)}x`);
    
    // SIMD should be at least as fast as regular
    assert(simdTime <= regularTime * 1.1, 'SIMD version should not be significantly slower');
}

// Test 10: Unicode and special characters
async function testUnicodeHandling() {
    const module = await loadJsonCModule();
    
    const parseJson = module.cwrap('json_c_parse_to_string', 'string', ['string']);
    const validateJson = module.cwrap('json_c_validate', 'number', ['string']);
    
    // Test Unicode JSON
    const isValid = validateJson(TEST_CASES.unicode);
    assert(isValid === 1, 'Unicode JSON should validate correctly');
    
    const result = parseJson(TEST_CASES.unicode);
    assert(result !== null, 'Unicode JSON should parse correctly');
    
    // Verify Unicode characters are preserved
    const parsed = JSON.parse(result);
    assert(parsed.message.includes('世界'), 'Chinese characters should be preserved');
    assert(parsed.emoji.includes('🌍'), 'Emoji should be preserved');
    
    log('✓ Unicode handling works correctly');
}

// Generate test report
function generateReport() {
    const totalTests = results.passed + results.failed;
    const successRate = totalTests > 0 ? (results.passed / totalTests * 100).toFixed(1) : 0;
    
    console.log('\n' + '='.repeat(60));
    console.log('JSON-C.WASM TEST RESULTS');
    console.log('='.repeat(60));
    console.log(`Total Tests: ${totalTests}`);
    console.log(`Passed: ${results.passed}`);
    console.log(`Failed: ${results.failed}`);
    console.log(`Success Rate: ${successRate}%`);
    console.log('');
    
    if (results.tests.length > 0) {
        console.log('Test Details:');
        results.tests.forEach(test => {
            const status = test.status === 'PASSED' ? '✓' : '✗';
            console.log(`  ${status} ${test.name} (${test.duration}ms)`);
            if (test.error) {
                console.log(`    Error: ${test.error}`);
            }
        });
    }
    
    // Show performance benchmarks if available
    if (testPerformanceBenchmarking.results) {
        console.log('\nPerformance Benchmarks:');
        Object.entries(testPerformanceBenchmarking.results).forEach(([name, result]) => {
            console.log(`  ${name}: ${result.throughput.toFixed(0)} ops/sec (${result.duration.toFixed(2)}ms for ${result.iterations} ops)`);
        });
    }
    
    console.log('='.repeat(60));
    
    return results.failed === 0;
}

// Main test runner
async function main() {
    log('Starting json-c.wasm integration tests...');
    
    try {
        await runTest('Module Loading', testModuleLoading);
        await runTest('JSON Parsing', testJsonParsing);
        await runTest('Error Handling', testErrorHandling);
        await runTest('Pretty Printing', testPrettyPrinting);
        await runTest('Object Manipulation', testObjectManipulation);
        await runTest('Array Manipulation', testArrayManipulation);
        await runTest('Memory Management', testMemoryManagement);
        await runTest('Performance Benchmarking', testPerformanceBenchmarking);
        await runTest('SIMD Performance', testSIMDPerformance);
        await runTest('Unicode Handling', testUnicodeHandling);
        
        const success = generateReport();
        process.exit(success ? 0 : 1);
        
    } catch (err) {
        error(`Test runner failed: ${err.message}`);
        process.exit(1);
    }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(err => {
        error(`Unhandled error: ${err.message}`);
        process.exit(1);
    });
}