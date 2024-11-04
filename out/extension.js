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
const LLM_CONFIG = {
    MODEL: "claude-3-5-sonnet-20241022",
    MAX_TOKENS: 8192,
    COMPLETION_TOKENS: 8192,
    FUNCTION_TOKENS: 8192,
    DEFAULT_TEMPERATURE: 0.3,
    TRIGGER_SEQUENCE: "...;",
    CONTEXT_LINES: 10
};
const SYSTEM_PROMPTS = {
    COMPLETION: `
        You are an expert code completion assistant. Analyze the existing code context, especially variable names, function signatures, and coding patterns. 
        Then provide contextually relevant, multi-line completions that precisely match the established style. Focus on completing the current logical block or function. 
        Return only the code completion without any explanations or markdown formatting.`,
    FUNCTION: `
        You are a code generation assistant. Generate clean, efficient, reusable code based on descriptions. 
        Return pure code without \`\`\` or \`\`\`python. All non-code explanations should be formatted and presented as commented lines. 
        Start your response with five asterisks as a single comment line before and end your response with the same line. `,
    EXPLANATION: `
        You are a code generation and explanation assistant. Read the questions (if available) in the provided info and update the code accordingly.
        Code Display Requirements:
        1. Never output raw HTML, JavaScript, or any executable code directly
        2. Always wrap code examples in appropriate code blocks:
           - Use \`\`\`language-name for each code block
           - Escape special characters when showing HTML/JS
           - Prevent script tags and inline JavaScript from executing
        Format Requirements:
        1. For HTML content:
           - Use &lt; and &gt; for angle brackets
           - Escape quotes and braces
           - Use <pre> tags with escaped content
        2. For JavaScript content:
           - Escape any script tags
           - Show as plaintext in code blocks
           - Prevent event handlers from being active
           - Escape template literals and expressions
        3. For embedded content (iframes, objects):
           - Show only the code structure
           - Prevent automatic loading/execution
           - Escape all URLs and data URIs
        The goal is to ensure all code is displayed as text only, with no possibility of execution in the webviewer while maintaining readability and proper documentation.
        All explanations should be formatted as comments. Provide more efficient and elegant solutions if available.`
};
let anthropicClient;
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
async function validateApiKey(apiKey) {
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
        else {
            console.error('Error validating API key:', error);
        }
        return false;
    }
}
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
function getCompletionContext(document, position) {
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
function shouldTriggerCompletion(document, position) {
    const lineText = document.lineAt(position).text;
    if (position.character >= LLM_CONFIG.TRIGGER_SEQUENCE.length) {
        const lastChars = lineText.substring(position.character - LLM_CONFIG.TRIGGER_SEQUENCE.length, position.character);
        return lastChars === LLM_CONFIG.TRIGGER_SEQUENCE;
    }
    return false;
}
async function streamingMessage(client, messages, systemPrompt, onProgress, onComplete) {
    try {
        const stream = await client.messages.stream({
            model: LLM_CONFIG.MODEL,
            max_tokens: LLM_CONFIG.MAX_TOKENS,
            temperature: LLM_CONFIG.DEFAULT_TEMPERATURE,
            messages: messages,
            system: systemPrompt,
        });
        for await (const chunk of stream) {
            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                onProgress(chunk.delta.text);
            }
        }
        onComplete();
    }
    catch (error) {
        console.error('Streaming error:', error);
        throw error;
    }
}
class EnhancedCompletionProvider {
    lastPosition;
    lastCompletion;
    async provideInlineCompletionItems(document, position, context) {
        if (context.selectedCompletionInfo || !shouldTriggerCompletion(document, position)) {
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
            let progress;
            progress = new StreamingProgress('$(loading~spin) Generating completion...');
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
                        progress?.hide();
                    }
                    catch (error) {
                        console.error('Error in streaming completion:', error);
                        progress?.hide();
                        handleApiError(error, 'completion');
                        resolve([]);
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
class ExplanationOutput {
    panel;
    content = '';
    constructor() {
        this.panel = vscode.window.createWebviewPanel('codeExplanation', 'Code Explanation', vscode.ViewColumn.Beside, {});
        this.updateContent();
    }
    appendText(text) {
        this.content += text;
        this.updateContent();
    }
    updateContent() {
        this.panel.webview.html = `
            <html>
                <body>
                    <pre>${this.content}</pre>
                </body>
            </html>`;
    }
}
function handleApiError(error, operation) {
    console.error(`Error during ${operation}:`, error);
    if (error instanceof sdk_1.AuthenticationError) {
        vscode.window.showErrorMessage(`Authentication error: Please check your API key and try setting it again with the "Reasonance Copilot: Set Claude API Key" command`);
    }
    else if (error instanceof Error) {
        vscode.window.showErrorMessage(`${operation} error: ${error.message}`);
    }
}
function activate(context) {
    let setApiKey = vscode.commands.registerCommand('reasonance-copilot.apiKey', async () => {
        const apiKey = await vscode.window.showInputBox({
            prompt: 'Enter your Claude API key (should start with "sk-")',
            password: true,
            validateInput: text => {
                if (!text?.startsWith('sk-')) {
                    return 'API key should start with "sk-"';
                }
                return null;
            }
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
    const inlineSuggestionProvider = vscode.languages.registerInlineCompletionItemProvider([
        { scheme: 'file', language: 'python' },
        { scheme: 'file', language: 'javascript' },
        { scheme: 'file', language: 'typescript' },
        { scheme: 'file', language: 'html' },
        { scheme: 'file', language: 'css' },
        { scheme: 'file', language: 'json' }
    ], new EnhancedCompletionProvider());
    let generateFunction = vscode.commands.registerCommand('reasonance-copilot.generateFunction', async () => {
        const client = await getAnthropicClient();
        if (!client) {
            return;
        }
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const selection = editor.selection;
        const startPosition = selection.start;
        const text = editor.document.getText(selection);
        let progress;
        try {
            const description = await vscode.window.showInputBox({
                prompt: 'Describe the function you want to generate'
            });
            if (!description) {
                return;
            }
            progress = new StreamingProgress('$(loading~spin) Generating function...');
            progress.show();
            let generatedCode = '';
            const stream = await client.messages.create({
                model: LLM_CONFIG.MODEL,
                stream: true,
                max_tokens: LLM_CONFIG.FUNCTION_TOKENS,
                messages: [{
                        role: 'user',
                        content: `Strictly follow the system prompt and write a function that ${description}\nContext:\n${text}`
                    }]
            });
            for await (const event of stream) {
                if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                    const newText = event.delta.text;
                    generatedCode += newText;
                    try {
                        // Calculate end position based on total length of generated code
                        const lines = generatedCode.split('\n');
                        const lastLineLength = lines[lines.length - 1].length;
                        const endPosition = new vscode.Position(startPosition.line + lines.length - 1, lines.length === 1 ? startPosition.character + lastLineLength : lastLineLength);
                        // Create range from start to current end position
                        const range = new vscode.Range(startPosition, endPosition);
                        await editor.edit(editBuilder => {
                            editBuilder.replace(range, generatedCode);
                        });
                    }
                    catch (error) {
                        console.error('Error updating editor:', error);
                    }
                }
            }
            progress?.hide();
        }
        catch (error) {
            progress?.hide();
            handleApiError(error, 'function generation');
        }
    });
    // Helper function to escape HTML special characters
    function escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
    // Base HTML template with styles
    const getWebviewContent = (content) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" 
          content="default-src 'none'; 
                   style-src 'unsafe-inline';">
    <style>
        body {
            padding: 16px;
            line-height: 1.5;
            background-color: #dbdbdb;
            color: #030303;
            font-family: Roboto, "Helvetica Neue",Arial,"Noto Sans", ui-serif,Georgia,Cambria,"Times New Roman",Times,serif;
            font-size: var(--vscode-editor-font-size);
        }
        .code-block {
            background-color: #2D2D2D;  /* Slightly lighter than body for code blocks */
            border: 1px solid #404040;  /* Subtle border */
            padding: 12px;
            margin: 8px 0;
            white-space: pre;
            overflow-x: auto;
            color: #D4D4D4;  /* Slightly muted white for code */
            border-radius: 4px;
            font-family: Arial;
        }
        code {
            background-color: black;
            color: white;
            padding: 2px 4px;
            border-radius: 3px;
            font-family: var(--vscode-editor-font-family);
        }
    </style>
</head>
<body>
    ${content}
</body>
</html>
`;
    // Register command for explaining code with streaming support
    let explainCode = vscode.commands.registerCommand('reasonance-copilot.explainCode', async () => {
        const client = await getAnthropicClient();
        if (!client) {
            return;
        }
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const selection = editor.selection;
        const text = editor.document.getText(selection);
        try {
            const progress = new StreamingProgress('$(loading~spin) Analyzing code...');
            progress.show();
            const panel = vscode.window.createWebviewPanel('reasonanceCopilotExplanation', 'Reasonance Copilot Explanation', vscode.ViewColumn.Beside, {
                enableScripts: false // Disable script execution for security
            });
            let explanation = '';
            let currentCodeBlock = '';
            let isInCodeBlock = false;
            let buffer = '';
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
            const processBuffer = () => {
                if (isInCodeBlock) {
                    currentCodeBlock += buffer;
                }
                else {
                    // Process any inline code blocks in the buffer
                    const processedText = buffer.replace(/`([^`]+)`/g, (_, code) => `<code>${escapeHtml(code)}</code>`);
                    explanation += processedText;
                }
                buffer = '';
            };
            for await (const event of stream) {
                if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                    const chunk = event.delta.text;
                    // Process the chunk character by character
                    for (let i = 0; i < chunk.length; i++) {
                        const char = chunk[i];
                        // Detect code block markers
                        if (char === '`' && chunk.slice(i, i + 3) === '```') {
                            processBuffer();
                            if (!isInCodeBlock) {
                                // Starting a code block
                                isInCodeBlock = true;
                                i += 2; // Skip the next two backticks
                                // Skip the language identifier if present
                                while (i + 1 < chunk.length && chunk[i + 1] !== '\n') {
                                    i++;
                                }
                            }
                            else {
                                // Ending a code block
                                isInCodeBlock = false;
                                i += 2; // Skip the next two backticks
                                explanation += `<div class="code-block">${escapeHtml(currentCodeBlock)}</div>`;
                                currentCodeBlock = '';
                            }
                        }
                        else {
                            buffer += char;
                        }
                    }
                    // Process any complete buffer content
                    processBuffer();
                    // Update the webview with the current content
                    panel.webview.html = getWebviewContent(explanation);
                }
            }
            // Process any remaining buffer content
            processBuffer();
            // Final update to the webview
            panel.webview.html = getWebviewContent(explanation);
            progress.hide();
        }
        catch (error) {
            handleApiError(error, 'code explanation');
        }
    });
    // let explainCode = vscode.commands.registerCommand('reasonance-copilot.explainCode', async () => {
    //     const client = await getAnthropicClient();
    //     if (!client) {return;}
    //     const editor = vscode.window.activeTextEditor;
    //     if (!editor) {return;}
    //     const selection = editor.selection;
    //     const text = editor.document.getText(selection);
    //     try {
    //         const progress = new StreamingProgress('$(loading~spin) Analyzing code...');
    //         progress.show();
    //         const panel = vscode.window.createWebviewPanel(
    //             'codeExplanation',
    //             'Code Explanation',
    //             vscode.ViewColumn.Beside,
    //             {}
    //         );
    //         let explanation = '';
    //         const stream = await client.messages.stream({
    //             model: LLM_CONFIG.MODEL,
    //             max_tokens: LLM_CONFIG.MAX_TOKENS,
    //             temperature: LLM_CONFIG.DEFAULT_TEMPERATURE,
    //             stream: true,
    //             messages: [{
    //                 role: 'user',
    //                 content: `Process this info by strictly following the system prompt:\n${text}`
    //             }],
    //             system: SYSTEM_PROMPTS.EXPLANATION
    //         });
    //         for await (const event of stream) {
    //             if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
    //                 explanation += event.delta.text;
    //                 panel.webview.html = `
    //                     <html>
    //                         <body>
    //                             <pre>${explanation}</pre>
    //                         </body>
    //                     </html>`;
    //             }
    //         }
    //         progress.hide();
    //     } catch (error) {
    //         handleApiError(error, 'code explanation');
    //     }
    // });
    context.subscriptions.push(setApiKey, inlineSuggestionProvider, generateFunction, explainCode);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map