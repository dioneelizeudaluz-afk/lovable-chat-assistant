// Service worker para interceptar requisições e bloquear consumo de créditos

// Intercepta requisições para a API do Lovable
chrome.webRequest.onBeforeSendHeaders.addListener(
    function(details) {
        // Verifica se é uma requisição para a API do Lovable
        if (details.url.includes('api.lovable.dev') || details.url.includes('lovable.dev/api')) {
            console.log('Interceptando requisição:', details.url);
            
            // Modifica os headers para evitar consumo de créditos
            const headers = details.requestHeaders || [];
            
            // Remove headers que podem indicar consumo de créditos
            const blockedHeaders = [
                'x-credit-consumption',
                'x-credits-required',
                'x-billing-enabled'
            ];
            
            const filteredHeaders = headers.filter(header => 
                !blockedHeaders.includes(header.name.toLowerCase())
            );
            
            // Adiciona headers para indicar que não deve consumir créditos
            filteredHeaders.push({
                name: 'x-credits-mode',
                value: 'free'
            });
            
            filteredHeaders.push({
                name: 'x-no-credit-charge',
                value: 'true'
            });
            
            filteredHeaders.push({
                name: 'x-bypass-billing',
                value: 'true'
            });
            
            return { requestHeaders: filteredHeaders };
        }
        
        return { requestHeaders: details.requestHeaders };
    },
    { urls: ["*://*.lovable.dev/*", "*://api.lovable.dev/*"] },
    ["blocking", "requestHeaders", "extraHeaders"]
);

// Intercepta respostas para modificar dados de créditos
chrome.webRequest.onHeadersReceived.addListener(
    function(details) {
        if (details.url.includes('api.lovable.dev') || details.url.includes('lovable.dev/api')) {
            console.log('Interceptando resposta:', details.url);
            
            const headers = details.responseHeaders || [];
            
            // Remove headers de consumo de créditos
            const filteredHeaders = headers.filter(header => 
                !header.name.toLowerCase().includes('credit') &&
                !header.name.toLowerCase().includes('billing')
            );
            
            // Adiciona header indicando que não consumiu créditos
            filteredHeaders.push({
                name: 'x-credits-consumed',
                value: '0'
            });
            
            return { responseHeaders: filteredHeaders };
        }
        
        return { responseHeaders: details.responseHeaders };
    },
    { urls: ["*://*.lovable.dev/*", "*://api.lovable.dev/*"] },
    ["blocking", "responseHeaders"]
);

// Listener para mensagens
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getStatus') {
        sendResponse({ 
            success: true, 
            creditBlocking: true,
            message: 'Bloqueio de créditos ativo'
        });
        return true;
    }
    
    if (request.action === 'toggleCreditBlocking') {
        // Implementar toggle se necessário
        chrome.storage.local.set({ creditBlocking: request.enabled });
        sendResponse({ success: true });
        return true;
    }
});
