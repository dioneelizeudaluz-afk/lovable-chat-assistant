// Intercepta e modifica respostas da API para zerar contagem de créditos
chrome.webRequest.onHeadersReceived.addListener(
    function(details) {
        if (details.url.includes('api.lovable.dev') || details.url.includes('lovable.dev/api')) {
            const headers = details.responseHeaders || [];
            
            // Remove headers de créditos do servidor
            const filteredHeaders = headers.filter(header => {
                const name = header.name.toLowerCase();
                return !name.includes('credit') && 
                       !name.includes('billing') && 
                       !name.includes('quota') &&
                       !name.includes('limit');
            });
            
            // Adiciona headers falsos indicando créditos ilimitados
            filteredHeaders.push({
                name: 'x-credits-remaining',
                value: '999999'
            });
            filteredHeaders.push({
                name: 'x-credits-total',
                value: '999999'
            });
            filteredHeaders.push({
                name: 'x-plan-type',
                value: 'unlimited'
            });
            
            return { responseHeaders: filteredHeaders };
        }
        return { responseHeaders: details.responseHeaders };
    },
    { urls: ["*://*.lovable.dev/*", "*://api.lovable.dev/*"] },
    ["blocking", "responseHeaders", "extraHeaders"]
);

// Intercepta o corpo da resposta para modificar dados de créditos
chrome.webRequest.onBeforeRequest.addListener(
    function(details) {
        // Não bloqueia, apenas monitora
        console.log('Requisição para API:', details.url);
        return {};
    },
    { urls: ["*://*.lovable.dev/*", "*://api.lovable.dev/*"] },
    []
);
