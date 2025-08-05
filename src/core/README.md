# Core Module

The core module contains the business logic and domain models for the Vectors Enhanced extension.

## Structure

### entities/
Contains the domain entities that represent the core data structures:
- **Content.js**: Represents a piece of content to be vectorized
- **Vector.js**: Represents a vectorized content with embeddings
- **Task.js**: Represents a vectorization task (supports both legacy and new formats)

### extractors/
Contains content extractors that gather data from various sources:
- **IContentExtractor.js**: The base interface for all extractors
- **ChatExtractor.js**: Extracts content from chat messages
- **FileExtractor.js**: Extracts content from file attachments
- **WorldInfoExtractor.js**: Extracts content from world information entries

## Design Principles

1. **Separation of Concerns**: Each module has a single, well-defined responsibility
2. **Interface-based Design**: Extractors implement a common interface for consistency
3. **Backward Compatibility**: New entities support legacy formats for smooth migration
4. **Error Resilience**: All modules handle errors gracefully without breaking the system

## Usage

The core module is used by the main application to:
- Extract content from various sources
- Create and manage domain entities
- Provide a clean abstraction over complex data structures

## Future Enhancements

- Add more extractors for new content sources
- Implement entity validation
- Add unit tests for all core components
- Implement caching for frequently accessed data