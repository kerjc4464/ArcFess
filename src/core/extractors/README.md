# Content Extractors ✅

This directory contains content extractors that implement the `IContentExtractor` interface. These extractors are responsible for gathering content from various sources for vectorization.

**Status**: Phase 5 completed - All extractors implemented and fully integrated

## Available Extractors

### IContentExtractor.js
The base interface that all extractors must implement. Defines the contract for content extraction.

### ChatExtractor.js
Extracts content from chat messages.
- Supports filtering by message types (user/assistant)
- Handles hidden/system messages
- Applies tag extraction rules to non-user messages
- Supports message range selection

### FileExtractor.js
Extracts content from file attachments.
- Fetches file content via SillyTavern's API
- Supports batch processing of multiple files
- Returns Content entities with file metadata
- Handles errors gracefully

### WorldInfoExtractor.js
Extracts content from world information entries.
- Fetches entries from SillyTavern's world info system
- Filters by world and entry selection
- Skips disabled entries
- Includes comprehensive metadata (world, uid, keys, comments)

## Usage Pattern

All extractors follow the same pattern:

```javascript
const extractor = new SomeExtractor();
const items = await extractor.extract(source);
```

Where `source` is a configuration object specific to each extractor type.

## Return Format

Extractors return an array of objects. The exact format depends on the extractor:
- ChatExtractor: Returns VectorItem objects
- FileExtractor: Returns Content objects
- WorldInfoExtractor: Returns VectorItem objects

## Adding New Extractors

To add a new extractor:
1. Create a new class that implements `IContentExtractor`
2. Implement the `extract(source)` method
3. Follow the existing patterns for error handling and logging
4. Update this README with the new extractor's documentation