import * as vscode from 'vscode';
import { Anthropic, AuthenticationError } from '@anthropic-ai/sdk';

let anthropicClient: Anthropic | undefined;

/**
 * Retrieves the LLM configuration from the extension settings.
 */
function getLLMConfig() {
    const config = vscode.workspace.getConfiguration('reasonance-copilot');
    return {
        MODEL: config.get<string>('model', 'claude-2'),
        MAX_TOKENS: config.get<number>('maxTokens', 8192),
        COMPLETION_TOKENS: config.get<number>('completionTokens', 8192),
        FUNCTION_TOKENS: config.get<number>('functionTokens', 8192),
        DEFAULT_TEMPERATURE: config.get<number>('defaultTemperature', 0.3),
        TRIGGER_SEQUENCE: config.get<string>('triggerSequence', '...;'),
        CONTEXT_LINES: config.get<number>('contextLines', 10),
        THEME: config.get<string>('theme', 'github.min.css')
    } as const;
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
} as const;

/**
 * Class representing a progress indicator in the status bar.
 */
class StreamingProgress {
    private statusBarItem: vscode.StatusBarItem;
    constructor(text: string = '$(loading~spin) Generating...') {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
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
async function validateApiKey(apiKey: string): Promise<boolean> {
    const LLM_CONFIG = getLLMConfig();
    try {
        const client = new Anthropic({ apiKey });
        await client.messages.create({
            model: LLM_CONFIG.MODEL,
            max_tokens: 10,
            messages: [{ role: 'user', content: 'test' }]
        });
        return true;
    } catch (error) {
        if (error instanceof AuthenticationError) {
            vscode.window.showErrorMessage('Authentication error: Please check your API key and try setting it again with the "Reasonance Copilot: Set Claude API Key" command.');
        } else if (error instanceof Error) {
            console.error('Error validating API key:', error);
            vscode.window.showErrorMessage(`Error validating API key: ${error.message}`);
        } else {
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
async function getAnthropicClient(): Promise<Anthropic | undefined> {
    const config = vscode.workspace.getConfiguration('reasonance-copilot');
    const apiKey = config.get<string>('apiKey');
    if (!apiKey) {
        vscode.window.showWarningMessage('Please set your Claude API key using the "Reasonance Copilot: Set Claude API Key" command');
        return undefined;
    }
    if (!anthropicClient || anthropicClient.apiKey !== apiKey) {
        const isValid = await validateApiKey(apiKey);
        if (!isValid) {
            return undefined;
        }
        anthropicClient = new Anthropic({ apiKey });
    }
    return anthropicClient;
}

/**
 * Retrieves the code context around the current cursor position for code completion.
 * @param document The active text document.
 * @param position The cursor position.
 * @returns A string containing the code context.
 */
function getCompletionContext(document: vscode.TextDocument, position: vscode.Position): string {
    const LLM_CONFIG = getLLMConfig();
    const startLine = Math.max(0, position.line - LLM_CONFIG.CONTEXT_LINES);
    const endLine = Math.min(document.lineCount - 1, position.line + LLM_CONFIG.CONTEXT_LINES);

    let contextLines: string[] = [];

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
function shouldTriggerCompletion(document: vscode.TextDocument, position: vscode.Position): boolean {
    const LLM_CONFIG = getLLMConfig();
    const lineText = document.lineAt(position).text;

    if (position.character >= LLM_CONFIG.TRIGGER_SEQUENCE.length) {
        const lastChars = lineText.substring(position.character - LLM_CONFIG.TRIGGER_SEQUENCE.length, position.character);
        return lastChars === LLM_CONFIG.TRIGGER_SEQUENCE;
    }

    return false;
}

class EnhancedCompletionProvider implements vscode.InlineCompletionItemProvider {
    private lastPosition: vscode.Position | undefined;
    private lastCompletion: string | undefined;
    private cancellationTokenSource: vscode.CancellationTokenSource | null = null;

    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[]> {
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
                return [new vscode.InlineCompletionItem(
                    this.lastCompletion,
                    new vscode.Range(position, position)
                )];
            }
            return [];
        }

        this.lastPosition = position;
        const startPosition = position;

        try {
            const client = await getAnthropicClient();
            if (!client) { return []; }

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
                                const endPosition = new vscode.Position(
                                    startPosition.line + lines.length - 1,
                                    lines.length === 1 ? startPosition.character + lastLineLength : lastLineLength
                                );

                                // Create range from start to current end position
                                const range = new vscode.Range(startPosition, endPosition);

                                resolve([
                                    new vscode.InlineCompletionItem(
                                        completion,
                                        range
                                    )
                                ]);
                            }
                        }
                    } catch (error) {
                        console.error('Error in streaming completion:', error);
                        handleApiError(error, 'completion');
                        resolve([]);
                    } finally {
                        progress.hide();
                    }
                })();
            });
        } catch (error) {
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
function handleApiError(error: unknown, operation: string) {
    console.error(`Error during ${operation}:`, error);
    if (error instanceof AuthenticationError) {
        vscode.window.showErrorMessage(`Authentication error: Please check your API key and try setting it again with the "Reasonance Copilot: Set Claude API Key" command`);
    } else if (error instanceof Error) {
        vscode.window.showErrorMessage(`${operation} error: ${error.message}`);
    } else {
        vscode.window.showErrorMessage(`${operation} error: Unknown error`);
    }
}

/**
 * Returns the base HTML template for the webview content.
 * @param panel The webview panel.
 * @param context The extension context.
 * @returns The complete HTML string.
 */

function getWebviewContent(panel: vscode.WebviewPanel, context: vscode.ExtensionContext, theme: string): string {
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

function getBackgroundColor(theme: string): string {
    const darkThemes = ['github-dark.min.css', 'monokai-sublime.min.css', 'atom-one-dark.min.css'];
    return darkThemes.includes(theme) ? '#1e1e1e' : '#ffffff';
}

function getTextColor(theme: string): string {
    const darkThemes = ['github-dark.min.css', 'monokai-sublime.min.css', 'atom-one-dark.min.css'];
    return darkThemes.includes(theme) ? '#d4d4d4' : '#24292e';
}



/**
 * The main activation function of the extension.
 * @param context The extension context.
 */
export function activate(context: vscode.ExtensionContext) {
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
                    anthropicClient = new Anthropic({ apiKey });
                    vscode.window.showInformationMessage('Reasonance Copilot: API key has been updated successfully.');
                }
            } finally {
                progress.hide();
                progress.dispose();
            }
        }
    });

    const inlineSuggestionProvider = vscode.languages.registerInlineCompletionItemProvider(
        { pattern: '**' }, // Applies to all files
        new EnhancedCompletionProvider()
    );

    const generateFunction = vscode.commands.registerCommand('reasonance-copilot.generateFunction', async () => {
        const client = await getAnthropicClient();
        if (!client) { return; }

        const editor = vscode.window.activeTextEditor;
        if (!editor) { return; }

        const LLM_CONFIG = getLLMConfig();

        const selection = editor.selection;
        const selectionText = editor.document.getText(selection);

        try {
            const description = await vscode.window.showInputBox({
                prompt: 'Describe the function you want to generate'
            });

            if (!description) { return; }

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

        } catch (error) {
            handleApiError(error, 'function generation');
        }
    });

    const explainCodeCommand = vscode.commands.registerCommand('reasonance-copilot.explainCode', async () => {
        await explainCode(context);
    });

    async function explainCode(context: vscode.ExtensionContext) {
        const client = await getAnthropicClient();
        if (!client) { return; }
    
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return; }
    
        const LLM_CONFIG = getLLMConfig();
        const theme = LLM_CONFIG.THEME; // Get the theme from config
    
        const selection = editor.selection;
        const text = editor.document.getText(selection);
    
        try {
            const progress = new StreamingProgress('$(loading~spin) Analyzing code...');
            progress.show();
    
            const panel = vscode.window.createWebviewPanel(
                'reasonanceCopilotExplanation',
                'Reasonance Copilot Explanation',
                vscode.ViewColumn.Beside,
                {
                    enableScripts: true,
                    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
                }
            );
    
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

        } catch (error) {
            handleApiError(error, 'code explanation');
        }
    }

    context.subscriptions.push(
        setApiKey,
        inlineSuggestionProvider,
        generateFunction,
        explainCodeCommand
    );
}

/**
 * Deactivates the extension.
 */
export function deactivate() {}





// import * as vscode from 'vscode';
// import { Anthropic, AuthenticationError } from '@anthropic-ai/sdk';

// const LLM_CONFIG = {
//     MODEL: "claude-3-5-sonnet-20241022",
//     MAX_TOKENS: 8192,
//     COMPLETION_TOKENS: 8192,
//     FUNCTION_TOKENS: 8192,
//     DEFAULT_TEMPERATURE: 0.3,
//     TRIGGER_SEQUENCE: "...;",
//     CONTEXT_LINES: 10
// } as const;

// const SYSTEM_PROMPTS = {
//     COMPLETION: `
//         You are an expert code completion assistant just like IntelliSense in Visual Studio Code. Analyze the existing code context, especially variable names, function signatures, and coding patterns. 
//         Then provide contextually relevant, multi-line completions that precisely match the established style. Focus on completing the current logical block or function. 
//         Return only the code completion, as described above, without any explanations or markdown formatting. Your response will be directly streamed to the editor of the VS Code.`,
//     FUNCTION: `
//         You are a top-notch programming code generation assistant. Your requests are sent from an extension of the VS Code and your response will be directly streamed to the editor of the VS Code.
//         Generate clean, efficient, reusable code based on provided user instruction. 
//         Return pure code without \`\`\` or \`\`\`python. All non-code explanations should be formatted and presented as commented lines.`,
//     EXPLANATION: `
//         You are a code generation and explanation assistant. Read the questions (if available) in the provided info and update the code accordingly.
//         Code Display Requirements:
//         1. Never output raw HTML, JavaScript, or any executable code directly
//         2. Always wrap code examples in appropriate code blocks:
//            - Use \`\`\`language-name for each code block
//            - Escape special characters when showing HTML/JS
//            - Prevent script tags and inline JavaScript from executing
//         Format Requirements:
//         1. For HTML content:
//            - Use &lt; and &gt; for angle brackets
//            - Escape quotes and braces
//            - Use <pre> tags with escaped content
//         2. For JavaScript content:
//            - Escape any script tags
//            - Show as plaintext in code blocks
//            - Prevent event handlers from being active
//            - Escape template literals and expressions
//         3. For embedded content (iframes, objects):
//            - Show only the code structure
//            - Prevent automatic loading/execution
//            - Escape all URLs and data URIs
//         The goal is to ensure all code is displayed as text only, with no possibility of execution in the webviewer of the VS Code while maintaining readability and proper documentation.
//         All explanations should be formatted as comments. Provide more efficient and elegant solutions if available. Your response will be directly streamed to the webviewer of the VS Code.`
// } as const;
// type MessageRole = "user" | "assistant";
// interface Message {
//     role: MessageRole;
//     content: string;
// }

// let anthropicClient: Anthropic | undefined;

// class StreamingProgress {
//     private statusBarItem: vscode.StatusBarItem;
//     constructor(text: string = '$(loading~spin) Generating...') {
//         this.statusBarItem = vscode.window.createStatusBarItem(
//             vscode.StatusBarAlignment.Right,
//             100
//         );
//         this.statusBarItem.text = text;
//     }
//     show() {
//         this.statusBarItem.show();
//     }
//     hide() {
//         this.statusBarItem.hide();
//         this.statusBarItem.dispose();
//     }
//     dispose() {
//         this.statusBarItem.dispose();
//     }
// }

// async function validateApiKey(apiKey: string): Promise<boolean> {
//     try {
//         const client = new Anthropic({ apiKey });
//         await client.messages.create({
//             model: LLM_CONFIG.MODEL,
//             max_tokens: 10,
//             messages: [{ role: 'user', content: 'test' }]
//         });
//         return true;
//     } catch (error) {
//         if (error instanceof AuthenticationError) {
//             vscode.window.showErrorMessage('Authentication error: Please check your API key and try setting it again with the "Reasonance Copilot: Set Claude API Key" command.');
//         } else {
//             console.error('Error validating API key:', error);
//         }
//         return false;
//     }
// }

// async function getAnthropicClient(): Promise<Anthropic | undefined> {
//     const config = vscode.workspace.getConfiguration('reasonance-copilot');
//     const apiKey = config.get<string>('apiKey');
//     if (!apiKey) {
//         vscode.window.showWarningMessage('Please set your Claude API key using the "Reasonance Copilot: Set Claude API Key" command');
//         return undefined;
//     }
//     if (!anthropicClient || anthropicClient.apiKey !== apiKey) {
//         const isValid = await validateApiKey(apiKey);
//         if (!isValid) {
//             return undefined;
//         }
//         anthropicClient = new Anthropic({ apiKey });
//     }
//     return anthropicClient;
// }

// function getCompletionContext(document: vscode.TextDocument, position: vscode.Position): string {
//     const startLine = Math.max(0, position.line - LLM_CONFIG.CONTEXT_LINES);
//     const endLine = Math.min(document.lineCount - 1, position.line + LLM_CONFIG.CONTEXT_LINES);
    
//     let contextLines: string[] = [];
    
//     for (let i = startLine; i < position.line; i++) {
//         contextLines.push(document.lineAt(i).text);
//     }
    
//     const currentLine = document.lineAt(position.line);
//     contextLines.push(currentLine.text.substring(0, position.character));
    
//     for (let i = position.line + 1; i <= endLine; i++) {
//         contextLines.push(document.lineAt(i).text);
//     }
    
//     return contextLines.join('\n');
// }

// function shouldTriggerCompletion(document: vscode.TextDocument, position: vscode.Position): boolean {
//     const lineText = document.lineAt(position).text;
    
//     if (position.character >= LLM_CONFIG.TRIGGER_SEQUENCE.length) {
//         const lastChars = lineText.substring(position.character - LLM_CONFIG.TRIGGER_SEQUENCE.length, position.character);
//         return lastChars === LLM_CONFIG.TRIGGER_SEQUENCE;
//     }
    
//     return false;
// }



// class EnhancedCompletionProvider implements vscode.InlineCompletionItemProvider {
//     private lastPosition: vscode.Position | undefined;
//     private lastCompletion: string | undefined;
    
//     async provideInlineCompletionItems(
//         document: vscode.TextDocument,
//         position: vscode.Position,
//         context: vscode.InlineCompletionContext,
//     ): Promise<vscode.InlineCompletionItem[]> {
//         if (context.selectedCompletionInfo || !shouldTriggerCompletion(document, position)) {
//             return [];
//         }

//         if (this.lastPosition && 
//             position.line === this.lastPosition.line && 
//             Math.abs(position.character - this.lastPosition.character) <= 1) {
//             if (this.lastCompletion) {
//                 return [new vscode.InlineCompletionItem(
//                     this.lastCompletion,
//                     new vscode.Range(position, position)
//                 )];
//             }
//             return [];
//         }
        
//         this.lastPosition = position;
//         const startPosition = position;

//         try {
//             const client = await getAnthropicClient();
//             if (!client) {return [];}

//             const codeContext = getCompletionContext(document, position);
//             let progress: StreamingProgress | undefined;
//             progress = new StreamingProgress('$(loading~spin) Generating completion...');
//             progress.show();

//             let completion = '';
//             const stream = await client.messages.create({
//                 model: LLM_CONFIG.MODEL,
//                 stream: true,
//                 max_tokens: LLM_CONFIG.COMPLETION_TOKENS,
//                 temperature: LLM_CONFIG.DEFAULT_TEMPERATURE,
//                 messages: [{
//                     role: 'user',
//                     content: `Complete this code strictly following the system prompt:\n${codeContext}`
//                 }],
//                 system: SYSTEM_PROMPTS.COMPLETION
//             });

//             return new Promise((resolve) => {
//                 (async () => {
//                     try {
//                         for await (const event of stream) {
//                             if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
//                                 const newText = event.delta.text;
//                                 completion += newText;
//                                 this.lastCompletion = completion;

//                                 // Calculate end position based on total length of completion
//                                 const lines = completion.split('\n');
//                                 const lastLineLength = lines[lines.length - 1].length;
//                                 const endPosition = new vscode.Position(
//                                     startPosition.line + lines.length - 1,
//                                     lines.length === 1 ? startPosition.character + lastLineLength : lastLineLength
//                                 );

//                                 // Create range from start to current end position
//                                 const range = new vscode.Range(startPosition, endPosition);

//                                 resolve([
//                                     new vscode.InlineCompletionItem(
//                                         completion,
//                                         range
//                                     )
//                                 ]);
//                             }
//                         }
//                         progress?.hide();
//                     } catch (error) {
//                         console.error('Error in streaming completion:', error);
//                         progress?.hide();
//                         handleApiError(error, 'completion');
//                         resolve([]);
//                     }
//                 })();
//             });
//         } catch (error) {
//             console.error('Error in completion provider:', error);
//             handleApiError(error, 'completion');
//             return [];
//         }
//     }
// }

// class ExplanationOutput {
//     private panel: vscode.WebviewPanel;
//     private content: string = '';

//     constructor() {
//         this.panel = vscode.window.createWebviewPanel(
//             'codeExplanation',
//             'Code Explanation',
//             vscode.ViewColumn.Beside,
//             {}
//         );
//         this.updateContent();
//     }

//     appendText(text: string) {
//         this.content += text;
//         this.updateContent();
//     }

//     private updateContent() {
//         this.panel.webview.html = `
//             <html>
//                 <body>
//                     <pre>${this.content}</pre>
//                 </body>
//             </html>`;
//     }
// }

// function handleApiError(error: unknown, operation: string) {
//     console.error(`Error during ${operation}:`, error);
//     if (error instanceof AuthenticationError) {
//         vscode.window.showErrorMessage(`Authentication error: Please check your API key and try setting it again with the "Reasonance Copilot: Set Claude API Key" command`);
//     } else if (error instanceof Error) {
//         vscode.window.showErrorMessage(`${operation} error: ${error.message}`);
//     }
// }


// export function activate(context: vscode.ExtensionContext) {
//     let setApiKey = vscode.commands.registerCommand('reasonance-copilot.apiKey', async () => {
//         const apiKey = await vscode.window.showInputBox({
//             prompt: 'Enter your Claude API key (should start with "sk-")',
//             password: true,
//             validateInput: text => {
//                 if (!text?.startsWith('sk-')) {
//                     return 'API key should start with "sk-"';
//                 }
//                 return null;
//             }
//         });
        
//         if (apiKey) {
//             const progress = new StreamingProgress();
//             progress.show();
            
//             try {
//                 const isValid = await validateApiKey(apiKey);
//                 if (isValid) {
//                     const config = vscode.workspace.getConfiguration('reasonance-copilot');
//                     await config.update('apiKey', apiKey, true);
//                     anthropicClient = new Anthropic({ apiKey });
//                     vscode.window.showInformationMessage('Reasonance Copilot: API key has been updated successfully.');
//                 }
//             } finally {
//                 progress.hide();
//                 progress.dispose();
//             }
//         }
//     });

//     const inlineSuggestionProvider = vscode.languages.registerInlineCompletionItemProvider(
//         [
//             { scheme: 'file', language: 'python' },
//             { scheme: 'file', language: 'javascript' },
//             { scheme: 'file', language: 'typescript' },
//             { scheme: 'file', language: 'html' },
//             { scheme: 'file', language: 'css' },
//             { scheme: 'file', language: 'json' }
//         ],
//         new EnhancedCompletionProvider()
//     );


// let generateFunction = vscode.commands.registerCommand('reasonance-copilot.generateFunction', async () => {
//     const client = await getAnthropicClient();
//     if (!client) {return;}

//     const editor = vscode.window.activeTextEditor;
//     if (!editor) {return;}

//     const selection = editor.selection;
//     const selectionText = editor.document.getText(selection);
//     const insertionPoint = selection.start;
//     let progress: StreamingProgress | undefined;

//     try {
//         const description = await vscode.window.showInputBox({
//             prompt: 'Describe the function you want to generate'
//         });

//         if (!description) {return;}

//         progress = new StreamingProgress('$(loading~spin) Generating function...');
//         progress.show();

//         let generatedCode = '';
//         let lastLineCount = 0;
//         let lastEditRange: vscode.Range | undefined;

//         const stream = await client.messages.create({
//             model: LLM_CONFIG.MODEL,
//             stream: true,
//             max_tokens: LLM_CONFIG.FUNCTION_TOKENS,
//             system: SYSTEM_PROMPTS.FUNCTION,
//             messages: [{
//                 role: 'user',
//                 content: `Strictly follow the system prompt and implement the following: ${description}.\nContext:\n${selectionText}`
//             }]
//         });

//         for await (const event of stream) {
//             if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
//                 const newText = event.delta.text;
//                 generatedCode += newText;
                
//                 try {
//                     // Split the generated code into lines and count them
//                     const lines = generatedCode.split('\n');
//                     const currentLineCount = lines.length;
                    
//                     // Calculate positions for the edit
//                     const lastLineLength = lines[lines.length - 1].length;
//                     const endLine = insertionPoint.line + currentLineCount - 1;
//                     const endPosition = new vscode.Position(
//                         endLine,
//                         lines.length === 1 ? insertionPoint.character + lastLineLength : lastLineLength
//                     );

//                     // Create range for the current edit
//                     const currentEditRange = new vscode.Range(insertionPoint, lastEditRange ? lastEditRange.end : selection.end);
//                     lastEditRange = new vscode.Range(insertionPoint, endPosition);

//                     // If we have new lines, insert line breaks
//                     if (currentLineCount > lastLineCount) {
//                         const linesToAdd = currentLineCount - lastLineCount;
//                         await editor.edit(editBuilder => {
//                             // First, insert new lines at the end of the selection
//                             const lineBreakPosition = new vscode.Position(selection.end.line, editor.document.lineAt(selection.end.line).text.length);
//                             editBuilder.insert(lineBreakPosition, '\n'.repeat(linesToAdd));
//                         }, {
//                             undoStopBefore: false,
//                             undoStopAfter: false
//                         });
//                         lastLineCount = currentLineCount;
//                     }

//                     // Now update the generated code
//                     await editor.edit(editBuilder => {
//                         editBuilder.replace(currentEditRange, generatedCode);
//                     }, {
//                         undoStopBefore: false,
//                         undoStopAfter: false
//                     });
//                 } catch (error) {
//                     console.error('Error updating editor:', error);
//                 }
//             }
//         }

//         // Final edit with undo stop
//         if (lastEditRange) {
//             await editor.edit(editBuilder => {
//                 editBuilder.replace(lastEditRange!, generatedCode);
//             }, {
//                 undoStopBefore: true,
//                 undoStopAfter: true
//             });
//         }

//         progress?.hide();
//     } catch (error) {
//         progress?.hide();
//         handleApiError(error, 'function generation');
//     }
// });

// // Helper function to escape HTML special characters
// function escapeHtml(unsafe: string): string {
//     return unsafe
//         .replace(/&/g, "&amp;")
//         .replace(/</g, "&lt;")
//         .replace(/>/g, "&gt;")
//         .replace(/"/g, "&quot;")
//         .replace(/'/g, "&#039;");
// }

// // Base HTML template with styles
// const getWebviewContent = (content: string) => `
// <!DOCTYPE html>
// <html lang="en">
// <head>
//     <meta charset="UTF-8">
//     <meta name="viewport" content="width=device-width, initial-scale=1.0">
//     <meta http-equiv="Content-Security-Policy" 
//           content="default-src 'none'; 
//                    style-src 'unsafe-inline';">
//     <style>
//         body {
//             padding: 16px;
//             line-height: 1.5;
//             background-color: #dbdbdb;
//             color: #030303;
//             font-family: Roboto, "Helvetica Neue",Arial,"Noto Sans", ui-serif,Georgia,Cambria,"Times New Roman",Times,serif;
//             font-size: var(--vscode-editor-font-size);
//         }
//         .code-block {
//             background-color: #2D2D2D;  /* Slightly lighter than body for code blocks */
//             border: 1px solid #404040;  /* Subtle border */
//             padding: 12px;
//             margin: 8px 0;
//             white-space: pre;
//             overflow-x: auto;
//             color: #D4D4D4;  /* Slightly muted white for code */
//             border-radius: 4px;
//             font-family: Arial;
//         }
//         code {
//             background-color: black;
//             color: white;
//             padding: 2px 4px;
//             border-radius: 3px;
//             font-family: var(--vscode-editor-font-family);
//         }
//     </style>
// </head>
// <body>
//     ${content}
// </body>
// </html>
// `;

// // Register command for explaining code with streaming support
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
//             'reasonanceCopilotExplanation',
//             'Reasonance Copilot Explanation',
//             vscode.ViewColumn.Beside,
//             {
//                 enableScripts: false // Disable script execution for security
//             }
//         );

//         let explanation = '';
//         let currentCodeBlock = '';
//         let isInCodeBlock = false;
//         let buffer = '';

//         const stream = await client.messages.stream({
//             model: LLM_CONFIG.MODEL,
//             max_tokens: LLM_CONFIG.MAX_TOKENS,
//             temperature: LLM_CONFIG.DEFAULT_TEMPERATURE,
//             stream: true,
//             messages: [{
//                 role: 'user',
//                 content: `Process the following text by strictly following the system prompt:\n${text}`
//             }],
//             system: SYSTEM_PROMPTS.EXPLANATION
//         });

//         const processBuffer = () => {
//             if (isInCodeBlock) {
//                 currentCodeBlock += buffer;
//             } else {
//                 // Process any inline code blocks in the buffer
//                 const processedText = buffer.replace(
//                     /`([^`]+)`/g,
//                     (_, code) => `<code>${escapeHtml(code)}</code>`
//                 );
//                 explanation += processedText;
//             }
//             buffer = '';
//         };

//         for await (const event of stream) {
//             if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
//                 const chunk = event.delta.text;
                
//                 // Process the chunk character by character
//                 for (let i = 0; i < chunk.length; i++) {
//                     const char = chunk[i];
                    
//                     // Detect code block markers
//                     if (char === '`' && chunk.slice(i, i + 3) === '```') {
//                         processBuffer();
                        
//                         if (!isInCodeBlock) {
//                             // Starting a code block
//                             isInCodeBlock = true;
//                             i += 2; // Skip the next two backticks
                            
//                             // Skip the language identifier if present
//                             while (i + 1 < chunk.length && chunk[i + 1] !== '\n') {
//                                 i++;
//                             }
//                         } else {
//                             // Ending a code block
//                             isInCodeBlock = false;
//                             i += 2; // Skip the next two backticks
//                             explanation += `<div class="code-block">${escapeHtml(currentCodeBlock)}</div>`;
//                             currentCodeBlock = '';
//                         }
//                     } else {
//                         buffer += char;
//                     }
//                 }
                
//                 // Process any complete buffer content
//                 processBuffer();
                
//                 // Update the webview with the current content
//                 panel.webview.html = getWebviewContent(explanation);
//             }
//         }

//         // Process any remaining buffer content
//         processBuffer();
        
//         // Final update to the webview
//         panel.webview.html = getWebviewContent(explanation);
        
//         progress.hide();
//     } catch (error) {
//         handleApiError(error, 'code explanation');
//     }
// });

//     context.subscriptions.push(
//         setApiKey,
//         inlineSuggestionProvider,
//         generateFunction,
//         explainCode
//     );
// }

// export function deactivate() {}