(function() {
    const vscode = acquireVsCodeApi();
    let markdownContent = '';

    window.addEventListener('message', event => {
        const message = event.data;
        if (message.command === 'update') {
            markdownContent = message.text;
            renderContent();
        }
    });

    function renderContent() {
        const html = marked.parse(markdownContent, {
            highlight: function(code, lang) {
                return hljs.highlightAuto(code, [lang]).value;
            }
        });
        document.getElementById('content').innerHTML = html;
    }
})();
