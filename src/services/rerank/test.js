/**
 * Simple test suite for Rerank module
 * Run this in browser console after loading the extension
 */

// Test function to verify rerank module
window.testRerankModule = async function() {
    console.log('=== Testing Rerank Module ===');
    
    try {
        // 1. Check if RerankService is available
        console.log('1. Checking RerankService availability...');
        if (typeof window.rerankService === 'undefined') {
            console.error('❌ RerankService not found in global scope');
            return;
        }
        console.log('✅ RerankService is available');
        
        // 2. Check configuration
        console.log('\n2. Checking configuration...');
        const config = window.rerankService.config.getConfig();
        console.log('Current config:', config);
        
        // 3. Validate configuration
        console.log('\n3. Validating configuration...');
        const validation = window.rerankService.config.validateConfig();
        if (validation.valid) {
            console.log('✅ Configuration is valid');
        } else {
            console.log('❌ Configuration errors:', validation.errors);
        }
        
        // 4. Check if enabled
        console.log('\n4. Checking if enabled...');
        const isEnabled = window.rerankService.isEnabled();
        console.log(`Rerank is ${isEnabled ? '✅ ENABLED' : '❌ DISABLED'}`);
        
        // 5. Test with mock data
        if (isEnabled) {
            console.log('\n5. Testing with mock data...');
            const mockResults = [
                { text: "Test document 1", score: 0.8, metadata: { index: 0 } },
                { text: "Test document 2", score: 0.7, metadata: { index: 1 } },
                { text: "Test document 3", score: 0.6, metadata: { index: 2 } }
            ];
            
            console.log('Original results:', mockResults);
            
            try {
                const reranked = await window.rerankService.rerankResults("test query", mockResults);
                console.log('✅ Reranked results:', reranked);
                
                // Check if hybrid scores were added
                const hasHybridScores = reranked.every(r => 'hybrid_score' in r);
                console.log(`Hybrid scores: ${hasHybridScores ? '✅ Added' : '❌ Missing'}`);
                
            } catch (error) {
                console.error('❌ Rerank failed:', error);
            }
        }
        
        console.log('\n=== Test Complete ===');
        
    } catch (error) {
        console.error('Test failed:', error);
    }
};

// Add to global scope for testing
window.inspectRerankService = function() {
    if (window.rerankService) {
        return {
            service: window.rerankService,
            config: window.rerankService.config.getConfig(),
            isEnabled: window.rerankService.isEnabled(),
            validation: window.rerankService.config.validateConfig()
        };
    }
    return null;
};

console.log('Rerank test functions loaded. Run window.testRerankModule() to test.');