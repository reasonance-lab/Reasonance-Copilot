# Reasonance Copilot

An advanced AI-powered code assistant that leverages Claude 3.5 Sonnet for intelligent code completion, function generation, and code explanation. Seamlessly integrates with Visual Studio Code to enhance your coding workflow.

## Features

### 🤖 Intelligent Code Completion
- Context-aware code suggestions with real-time streaming
- Analyzes up to 10 lines of context before and after cursor
- Trigger with "...;" sequence for precise control
- Matches your existing code style and patterns
- Supports multi-line completions
- Debounced suggestions to prevent performance impact

### ⚡ Function Generation
- Generate complete, production-ready functions from natural language descriptions
- Real-time streaming updates as code is generated
- Maintains consistent coding style with your codebase
- Includes detailed comments and documentation
- Context-aware implementation based on selected code

### 📚 Code Explanation
- Get detailed, syntax-highlighted explanations in a dedicated webview
- Multiple theme options for better readability
- Proper escaping of code examples and HTML content
- Support for markdown and code block formatting
- Real-time streaming updates as explanation is generated

### 🌐 Supported Languages
- Python
- JavaScript
- TypeScript
- HTML
- CSS
- JSON

## Requirements

- Visual Studio Code ^1.75.0
- Claude API key from Anthropic

## Installation

1. Install from VS Code Marketplace or download the .vsix file
2. Open VS Code
3. Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (macOS)
4. Type "Install from VSIX" and select the downloaded file

## Configuration

### API Key Setup
1. Get your Claude API key from Anthropic
2. In VS Code:
   - Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS)
   - Type "Reasonance Copilot: Set Claude API Key"
   - Enter your API key when prompted

### Available Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `reasonance-copilot.model` | Claude model to use | claude-3-5-sonnet-20241022 |
| `reasonance-copilot.maxTokens` | Maximum tokens for responses | 8192 |
| `reasonance-copilot.completionTokens` | Token limit for completions | 8192 |
| `reasonance-copilot.functionTokens` | Token limit for function generation | 8192 |
| `reasonance-copilot.defaultTemperature` | Model temperature (creativity) | 0.3 |
| `reasonance-copilot.triggerSequence` | Completion trigger sequence | "...;" |
| `reasonance-copilot.contextLines` | Lines of context to analyze | 10 |
| `reasonance-copilot.theme` | Theme for code explanations | github.min.css |

### Available Themes
- default.min.css
- github.min.css
- github-dark.min.css
- monokai-sublime.min.css
- atom-one-dark.min.css
- atom-one-light.min.css
- googlecode.min.css

## Usage

### Code Completion
1. Type code normally in a supported language file
2. Type "...;" when you want AI assistance
3. The completion will stream in real-time
4. Press Tab to accept or keep typing to ignore

### Function Generation
1. Optional: Select existing code for context
2. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS)
3. Type "Reasonance Copilot: Generate Function"
4. Describe the function you want
5. Watch as the function is generated in real-time

### Code Explanation
1. Select the code you want explained
2. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS)
3. Type "Reasonance Copilot: Explain Code"
4. View the formatted explanation in the side panel

## Technical Details

- Uses Claude 3.5 Sonnet model for optimal performance
- Streaming responses for real-time feedback
- Debounced completion requests for better performance
- Secure API key storage in VS Code settings
- Proper error handling and user feedback
- Clean separation of concerns in codebase
- Extensive type safety with TypeScript

## Release Notes

### 0.1.0
- Initial public release
- Streaming support for all features
- Enhanced completion context analysis
- Multiple theme options for explanations
- Improved error handling and feedback
- Configuration options for fine-tuning
- Support for 6 programming languages

## Privacy & Security

- API keys are stored securely in VS Code settings
- Code snippets are sent to Claude API only for processing
- No data retention or secondary usage
- All communication over secure channels
- No telemetry or usage tracking

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This extension is licensed under the MIT License. See the LICENSE file for details.

## Support

If you encounter any issues or have suggestions:
1. Check the [Known Issues](#known-issues) section
2. Open an issue on the GitHub repository
3. Contact the maintainers

## Known Issues

Currently, no major issues are known. Please report any problems you encounter.
