# Reasonance Copilot

Reasonance Copilot is an AI-powered code assistant that provides intelligent code completion, function generation, and code explanation using the Claude API.

## Features

- **Intelligent Code Completion**: Get context-aware code suggestions as you type
- **Function Generation**: Generate complete functions based on natural language descriptions
- **Code Explanation**: Get detailed explanations of selected code segments
- **Multi-Language Support**: Works with Python, JavaScript, TypeScript, HTML, CSS, and JSON

## Requirements

- Visual Studio Code version 1.95.0 or higher
- Claude API key from Anthropic

## Installation

1. Install the extension by downloading the .vsix file
2. In VS Code, open Extensions (Ctrl+Shift+X)
3. Click ... (More Actions)
4. Select "Install from VSIX..."
5. Choose the downloaded .vsix file

## Setup

1. Get your Claude API key from Anthropic
2. In VS Code:
   - Press `Ctrl+Shift+P` (Command Palette)
   - Type "Reasonance Copilot: Set Claude API Key"
   - Enter your API key when prompted

## Usage

### Code Completion
- Type code as normal
- Use the trigger sequence "...;" to activate AI completion
- Press Tab to accept suggestions

### Function Generation
1. Select context code (optional)
2. Press `Ctrl+Shift+P`
3. Type "Reasonance Copilot: Generate Function"
4. Describe the function you want to create

### Code Explanation
1. Select the code you want to understand
2. Press `Ctrl+Shift+P`
3. Type "Reasonance Copilot: Explain Code"
4. View explanation in the side panel

## Features in Detail

### Intelligent Code Completion
- Context-aware suggestions based on your current code
- Learns from your codebase patterns
- Supports multiple programming languages
- Real-time streaming suggestions

### Function Generation
- Creates complete, working functions
- Follows your project's coding style
- Includes proper error handling
- Adds relevant comments and documentation

### Code Explanation
- Detailed breakdown of code functionality
- Explanation of design patterns used
- Performance considerations
- Potential improvements

## Extension Settings

* `reasonance-copilot.apiKey`: Your Claude API key (stored securely)

## Known Issues

- None at this time

## Release Notes

### 0.0.1

Initial release of Reasonance Copilot:
- Basic code completion functionality
- Function generation
- Code explanation feature
- Multi-language support

## License

This extension is licensed under the MIT License.

## Privacy

This extension sends code snippets to Claude API for processing. No data is stored or used for any other purpose.