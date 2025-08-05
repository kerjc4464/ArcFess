# Text Processing Pipeline

## Overview

The text processing pipeline provides a flexible, extensible architecture for processing text through various transformations. It implements a "text extraction → dispatch to different functions" pattern.

## Core Components

### 1. ITextProcessor
- **Purpose**: Abstract interface for all text processors
- **Key Methods**:
  - `process(input, context)`: Main processing method
  - `canProcess(input, context)`: Check if processor can handle input
  - `validateInput(input, context)`: Validate input before processing

### 2. TextPipeline
- **Purpose**: Core pipeline that manages processors and middleware
- **Features**:
  - Processor registration and management
  - Middleware support for cross-cutting concerns
  - Event emission for monitoring
  - Performance tracking and statistics

### 3. ProcessorRegistry
- **Purpose**: Registry for managing processor types and configurations
- **Features**:
  - Built-in processor types (vectorization, rerank, summary)
  - Dynamic processor registration
  - Dependency management
  - Factory pattern for processor creation

### 4. TextDispatcher
- **Purpose**: Routes text to appropriate processors based on task type
- **Features**:
  - Flexible routing rules
  - Pre/post processing hooks
  - Batch processing support
  - Task chaining capabilities

### 5. ProcessingContext
- **Purpose**: Carries information through the processing pipeline
- **Features**:
  - Data storage and retrieval
  - Error and warning tracking
  - Processing metrics
  - Child context creation

## Usage Example

```javascript
// Create pipeline components
const pipeline = new TextPipeline();
const registry = new ProcessorRegistry();
const dispatcher = new TextDispatcher(pipeline, registry);

// Register a processor
pipeline.registerProcessor('vectorization', vectorizationProcessor);

// Add middleware
pipeline.use(async (input, context, next) => {
    console.log('Processing:', input.content.substring(0, 50));
    return next(input);
});

// Dispatch content
const result = await dispatcher.dispatch(
    'Text content to process',
    'vectorization',
    { source: 'chat', settings: {...} },
    new ProcessingContext({ chatId: 'chat123' })
);
```

## Architecture Benefits

1. **Extensibility**: Easy to add new processor types
2. **Flexibility**: Middleware and hooks for customization
3. **Maintainability**: Clear separation of concerns
4. **Testability**: Each component can be tested independently
5. **Backward Compatibility**: Designed to wrap existing functionality

## Integration Strategy

This pipeline is designed to be integrated gradually:

1. **Phase 1**: Create pipeline infrastructure (current)
2. **Phase 2**: Wrap existing adapters as processors
3. **Phase 3**: Create parallel implementation
4. **Phase 4**: Gradual migration with feature flags

## Future Extensions

- **Rerank Processor**: For search result reranking
- **Summary Processor**: For text summarization
- **Auto-vectorization**: Triggered by events
- **Task Export/Import**: Cross-chat task migration