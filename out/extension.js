"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const sdk_1 = require("@anthropic-ai/sdk");
let anthropicClient;
/**
 * Retrieves the LLM configuration from the extension settings.
 */
function getLLMConfig() {
    const config = vscode.workspace.getConfiguration('reasonance-copilot');
    return {
        MODEL: config.get('model', 'claude-2'),
        MAX_TOKENS: config.get('maxTokens', 8192),
        COMPLETION_TOKENS: config.get('completionTokens', 8192),
        FUNCTION_TOKENS: config.get('functionTokens', 8192),
        DEFAULT_TEMPERATURE: config.get('defaultTemperature', 0.3),
        TRIGGER_SEQUENCE: config.get('triggerSequence', '...;'),
        CONTEXT_LINES: config.get('contextLines', 10),
        THEME: config.get('theme', 'github.min.css')
    };
}
const SYSTEM_PROMPTS = {
    COMPLETION: `
        You are an expert code completion assistant just like IntelliSense in Visual Studio Code. Analyze the existing code context, especially variable names, function signatures, and coding patterns. 
        Then provide contextually relevant, multi-line completions that precisely match the established style. Focus on completing the current logical block or function. 
        Return only the code completion, as described above, without any explanations or markdown formatting. Your response will be directly streamed to the editor of the VS Code.`,
    FUNCTION: `
        You are a top-notch programming code generation assistant. Your requests are sent from an extension of the VS Code and your response will be directly streamed to the editor of the VS Code.
        Generate clean, efficient, reusable code based on provided user instruction. 
        Return pure code without \`\`\` or \`\`\`python. All non-code explanations should be formatted and presented as commented lines.`,
    EXPLANATION: `
        You are a code explanation and generation assistant. Read the questions (if available) in the user-provided prompt and act accordingly.
        Code Display and Dormatting Requirements in Your Output:
        1. Never output raw HTML, JavaScript, or any executable code directly
        2. Always wrap code examples in appropriate code blocks:
           - Use \`\`\`language-name for each code block
           - Escape special characters when showing HTML/JS
           - Prevent script tags and inline JavaScript from executing
        Format Requirements:
        1. For HTML content:
           - Use &lt; and &gt; for angle brackets
           - Escape quotes and braces
           - Use &lt;pre&gt; tags with escaped content
        2. For JavaScript content:
           - Escape any script tags
           - Show as plaintext in code blocks
           - Prevent event handlers from being active
           - Escape template literals and expressions
        3. For embedded content (iframes, objects):
           - Show only the code structure
           - Prevent automatic loading/execution
           - Escape all URLs and data URIs
        The goal is to ensure all code is displayed with no possibility of execution in the webviewer of the VS Code while maintaining readability fortmatting and proper documentation.
        Provide more efficient and elegant solution, if available, separately and after your explanation. Your response will be directly streamed to the webviewer of the VS Code.`
};
/**
 * Class representing a progress indicator in the status bar.
 */
class StreamingProgress {
    statusBarItem;
    constructor(text = '$(loading~spin) Generating...') {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.text = text;
    }
    show() {
        this.statusBarItem.show();
    }
    hide() {
        this.statusBarItem.hide();
        this.statusBarItem.dispose();
    }
    dispose() {
        this.statusBarItem.dispose();
    }
}
/**
 * Validates the provided API key by making a test request.
 * @param apiKey The API key to validate.
 * @returns A promise that resolves to true if valid, false otherwise.
 */
async function validateApiKey(apiKey) {
    const LLM_CONFIG = getLLMConfig();
    try {
        const client = new sdk_1.Anthropic({ apiKey });
        await client.messages.create({
            model: LLM_CONFIG.MODEL,
            max_tokens: 10,
            messages: [{ role: 'user', content: 'test' }]
        });
        return true;
    }
    catch (error) {
        if (error instanceof sdk_1.AuthenticationError) {
            vscode.window.showErrorMessage('Authentication error: Please check your API key and try setting it again with the "Reasonance Copilot: Set Claude API Key" command.');
        }
        else if (error instanceof Error) {
            console.error('Error validating API key:', error);
            vscode.window.showErrorMessage(`Error validating API key: ${error.message}`);
        }
        else {
            console.error('Unknown error validating API key:', error);
            vscode.window.showErrorMessage('An unknown error occurred while validating the API key.');
        }
        return false;
    }
}
/**
 * Retrieves or initializes the Anthropic client with the current API key.
 * @returns A promise that resolves to the Anthropic client or undefined if unavailable.
 */
async function getAnthropicClient() {
    const config = vscode.workspace.getConfiguration('reasonance-copilot');
    const apiKey = config.get('apiKey');
    if (!apiKey) {
        vscode.window.showWarningMessage('Please set your Claude API key using the "Reasonance Copilot: Set Claude API Key" command');
        return undefined;
    }
    if (!anthropicClient || anthropicClient.apiKey !== apiKey) {
        const isValid = await validateApiKey(apiKey);
        if (!isValid) {
            return undefined;
        }
        anthropicClient = new sdk_1.Anthropic({ apiKey });
    }
    return anthropicClient;
}
/**
 * Retrieves the code context around the current cursor position for code completion.
 * @param document The active text document.
 * @param position The cursor position.
 * @returns A string containing the code context.
 */
function getCompletionContext(document, position) {
    const LLM_CONFIG = getLLMConfig();
    const startLine = Math.max(0, position.line - LLM_CONFIG.CONTEXT_LINES);
    const endLine = Math.min(document.lineCount - 1, position.line + LLM_CONFIG.CONTEXT_LINES);
    let contextLines = [];
    for (let i = startLine; i < position.line; i++) {
        contextLines.push(document.lineAt(i).text);
    }
    const currentLine = document.lineAt(position.line);
    contextLines.push(currentLine.text.substring(0, position.character));
    for (let i = position.line + 1; i <= endLine; i++) {
        contextLines.push(document.lineAt(i).text);
    }
    return contextLines.join('\n');
}
/**
 * Determines if the completion should be triggered based on the trigger sequence.
 * @param document The active text document.
 * @param position The cursor position.
 * @returns True if the completion should be triggered, false otherwise.
 */
function shouldTriggerCompletion(document, position) {
    const LLM_CONFIG = getLLMConfig();
    const lineText = document.lineAt(position).text;
    if (position.character >= LLM_CONFIG.TRIGGER_SEQUENCE.length) {
        const lastChars = lineText.substring(position.character - LLM_CONFIG.TRIGGER_SEQUENCE.length, position.character);
        return lastChars === LLM_CONFIG.TRIGGER_SEQUENCE;
    }
    return false;
}
class EnhancedCompletionProvider {
    lastPosition;
    lastCompletion;
    cancellationTokenSource = null;
    async provideInlineCompletionItems(document, position, context, token) {
        const LLM_CONFIG = getLLMConfig();
        if (context.selectedCompletionInfo || !shouldTriggerCompletion(document, position)) {
            return [];
        }
        // Cancel previous request
        this.cancellationTokenSource?.cancel();
        this.cancellationTokenSource = new vscode.CancellationTokenSource();
        const cancellationToken = this.cancellationTokenSource.token;
        if (cancellationToken.isCancellationRequested) {
            return [];
        }
        if (this.lastPosition &&
            position.line === this.lastPosition.line &&
            Math.abs(position.character - this.lastPosition.character) <= 1) {
            if (this.lastCompletion) {
                return [new vscode.InlineCompletionItem(this.lastCompletion, new vscode.Range(position, position))];
            }
            return [];
        }
        this.lastPosition = position;
        const startPosition = position;
        try {
            const client = await getAnthropicClient();
            if (!client) {
                return [];
            }
            const codeContext = getCompletionContext(document, position);
            const progress = new StreamingProgress('$(loading~spin) Generating completion...');
            progress.show();
            let completion = '';
            const stream = await client.messages.create({
                model: LLM_CONFIG.MODEL,
                stream: true,
                max_tokens: LLM_CONFIG.COMPLETION_TOKENS,
                temperature: LLM_CONFIG.DEFAULT_TEMPERATURE,
                messages: [{
                        role: 'user',
                        content: `Complete this code strictly following the system prompt:\n${codeContext}`
                    }],
                system: SYSTEM_PROMPTS.COMPLETION
            });
            return new Promise((resolve) => {
                (async () => {
                    try {
                        for await (const event of stream) {
                            if (token.isCancellationRequested || cancellationToken.isCancellationRequested) {
                                progress.hide();
                                return resolve([]);
                            }
                            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                                const newText = event.delta.text;
                                completion += newText;
                                this.lastCompletion = completion;
                                // Calculate end position based on total length of completion
                                const lines = completion.split('\n');
                                const lastLineLength = lines[lines.length - 1].length;
                                const endPosition = new vscode.Position(startPosition.line + lines.length - 1, lines.length === 1 ? startPosition.character + lastLineLength : lastLineLength);
                                // Create range from start to current end position
                                const range = new vscode.Range(startPosition, endPosition);
                                resolve([
                                    new vscode.InlineCompletionItem(completion, range)
                                ]);
                            }
                        }
                    }
                    catch (error) {
                        console.error('Error in streaming completion:', error);
                        handleApiError(error, 'completion');
                        resolve([]);
                    }
                    finally {
                        progress.hide();
                    }
                })();
            });
        }
        catch (error) {
            console.error('Error in completion provider:', error);
            handleApiError(error, 'completion');
            return [];
        }
    }
}
/**
 * Handles API errors and displays appropriate messages to the user.
 * @param error The error object.
 * @param operation The name of the operation during which the error occurred.
 */
function handleApiError(error, operation) {
    console.error(`Error during ${operation}:`, error);
    if (error instanceof sdk_1.AuthenticationError) {
        vscode.window.showErrorMessage(`Authentication error: Please check your API key and try setting it again with the "Reasonance Copilot: Set Claude API Key" command`);
    }
    else if (error instanceof Error) {
        vscode.window.showErrorMessage(`${operation} error: ${error.message}`);
    }
    else {
        vscode.window.showErrorMessage(`${operation} error: Unknown error`);
    }
}
/**
 * Returns the base HTML template for the webview content.
 * @param panel The webview panel.
 * @param context The extension context.
 * @returns The complete HTML string.
 */
function getWebviewContent(panel, context, theme) {
    const mediaPath = vscode.Uri.joinPath(context.extensionUri, 'media');
    const stylesPath = vscode.Uri.joinPath(mediaPath, 'styles');
    // Available themes
    const availableThemes = [
        'default.min.css',
        'github.min.css',
        'github-dark.min.css',
        'monokai-sublime.min.css',
        'atom-one-dark.min.css',
        'atom-one-light.min.css',
        'googlecode.min.css'
    ];
    // Validate the theme
    if (!availableThemes.includes(theme)) {
        theme = 'github.min.css';
    }
    const markedUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaPath, 'marked.min.js'));
    const highlightUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaPath, 'highlight.min.js'));
    const highlightCssUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(stylesPath, theme));
    const mainScriptUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaPath, 'main.js'));
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <!-- Meta tags and styles -->
        <meta charset="UTF-8">
        <meta
            http-equiv="Content-Security-Policy"
            content="default-src 'none'; style-src ${panel.webview.cspSource} 'unsafe-inline'; script-src ${panel.webview.cspSource};"
        >
        <link href="${highlightCssUri}" rel="stylesheet">
        <!-- Inline styles -->
        <style>
            body {
                padding: 16px;
                line-height: 1.5;
                background-color: ${getBackgroundColor(theme)};
                color: ${getTextColor(theme)};
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
                font-size: 16px;
            }
            .processing {
                font-style: italic;
                color: #888;
            }
        </style>
    </head>
    <body>
        <!-- Content -->
        <div id="content" class="processing">Processing... Please wait.</div>

        <!-- Scripts -->
        <script src="${markedUri}"></script>
        <script src="${highlightUri}"></script>
        <script src="${mainScriptUri}"></script>
    </body>
    </html>
    `;
}
function getBackgroundColor(theme) {
    const darkThemes = ['github-dark.min.css', 'monokai-sublime.min.css', 'atom-one-dark.min.css'];
    return darkThemes.includes(theme) ? '#1e1e1e' : '#ffffff';
}
function getTextColor(theme) {
    const darkThemes = ['github-dark.min.css', 'monokai-sublime.min.css', 'atom-one-dark.min.css'];
    return darkThemes.includes(theme) ? '#d4d4d4' : '#24292e';
}
/**
 * The main activation function of the extension.
 * @param context The extension context.
 */
function activate(context) {
    const setApiKey = vscode.commands.registerCommand('reasonance-copilot.apiKey', async () => {
        const apiKey = await vscode.window.showInputBox({
            prompt: 'Enter your Claude API key',
            password: true,
            // Validation removed as per your request
        });
        if (apiKey) {
            const progress = new StreamingProgress();
            progress.show();
            try {
                const isValid = await validateApiKey(apiKey);
                if (isValid) {
                    const config = vscode.workspace.getConfiguration('reasonance-copilot');
                    await config.update('apiKey', apiKey, true);
                    anthropicClient = new sdk_1.Anthropic({ apiKey });
                    vscode.window.showInformationMessage('Reasonance Copilot: API key has been updated successfully.');
                }
            }
            finally {
                progress.hide();
                progress.dispose();
            }
        }
    });
    const inlineSuggestionProvider = vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, // Applies to all files
    new EnhancedCompletionProvider());
    const generateFunction = vscode.commands.registerCommand('reasonance-copilot.generateFunction', async () => {
        const client = await getAnthropicClient();
        if (!client) {
            return;
        }
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const LLM_CONFIG = getLLMConfig();
        const selection = editor.selection;
        const selectionText = editor.document.getText(selection);
        try {
            const description = await vscode.window.showInputBox({
                prompt: 'Describe the function you want to generate'
            });
            if (!description) {
                return;
            }
            const progress = new StreamingProgress('$(loading~spin) Generating function...');
            progress.show();
            let generatedCode = '';
            const stream = await client.messages.create({
                model: LLM_CONFIG.MODEL,
                stream: true,
                max_tokens: LLM_CONFIG.FUNCTION_TOKENS,
                temperature: LLM_CONFIG.DEFAULT_TEMPERATURE,
                messages: [{
                        role: 'user',
                        content: `Strictly follow the system prompt and implement the following: ${description}.\nContext:\n${selectionText}`
                    }],
                system: SYSTEM_PROMPTS.FUNCTION
            });
            for await (const event of stream) {
                if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                    const newText = event.delta.text;
                    generatedCode += newText;
                    // Update the editor content
                    await editor.edit(editBuilder => {
                        editBuilder.replace(selection, generatedCode);
                    }, {
                        undoStopBefore: false,
                        undoStopAfter: false
                    });
                }
            }
            // Finalize the edit with undo stop
            await editor.edit(editBuilder => {
                editBuilder.replace(selection, generatedCode);
            }, {
                undoStopBefore: true,
                undoStopAfter: true
            });
            progress.hide();
        }
        catch (error) {
            handleApiError(error, 'function generation');
        }
    });
    const explainCodeCommand = vscode.commands.registerCommand('reasonance-copilot.explainCode', async () => {
        await explainCode(context);
    });
    async function explainCode(context) {
        const client = await getAnthropicClient();
        if (!client) {
            return;
        }
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const LLM_CONFIG = getLLMConfig();
        const theme = LLM_CONFIG.THEME; // Get the theme from config
        const selection = editor.selection;
        const text = editor.document.getText(selection);
        try {
            const progress = new StreamingProgress('$(loading~spin) Analyzing code...');
            progress.show();
            const panel = vscode.window.createWebviewPanel('reasonanceCopilotExplanation', 'Reasonance Copilot Explanation', vscode.ViewColumn.Beside, {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
            });
            panel.webview.html = getWebviewContent(panel, context, theme);
            let markdownContent = '';
            const stream = await client.messages.stream({
                model: LLM_CONFIG.MODEL,
                max_tokens: LLM_CONFIG.MAX_TOKENS,
                temperature: LLM_CONFIG.DEFAULT_TEMPERATURE,
                stream: true,
                messages: [{
                        role: 'user',
                        content: `Process the following text by strictly following the system prompt:\n${text}`
                    }],
                system: SYSTEM_PROMPTS.EXPLANATION
            });
            let lastUpdateTime = Date.now();
            const updateInterval = 500; // in milliseconds
            for await (const event of stream) {
                if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                    const chunk = event.delta.text;
                    markdownContent += chunk;
                    const currentTime = Date.now();
                    if (currentTime - lastUpdateTime > updateInterval) {
                        panel.webview.postMessage({ command: 'update', text: markdownContent });
                        lastUpdateTime = currentTime;
                    }
                }
            }
            // Send the final content
            panel.webview.postMessage({ command: 'update', text: markdownContent });
            progress.hide();
        }
        catch (error) {
            handleApiError(error, 'code explanation');
        }
    }
    context.subscriptions.push(setApiKey, inlineSuggestionProvider, generateFunction, explainCodeCommand);
}
/**
 * Deactivates the extension.
 */
function deactivate() { }
//# sourceMappingURL=extension.js.map