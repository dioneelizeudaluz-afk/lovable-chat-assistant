// Service worker para lidar com uploads que podem falhar devido a CORS
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'uploadToStorage') {
        handleUploadToStorage(request.data)
            .then(result => sendResponse({ success: true, result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Mantém o canal de mensagem aberto
    }
    
    if (request.action === 'getCookies') {
        getCookiesForDomain(request.domain)
            .then(cookies => sendResponse({ success: true, cookies }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
});

async function handleUploadToStorage(data) {
    try {
        const { url, headers, body } = data;
        
        // Converte o array de volta para Uint8Array
        const uint8Array = new Uint8Array(body);
        
        const response = await fetch(url, {
            method: 'PUT',
            headers: headers,
            body: uint8Array
        });
        
        if (!response.ok) {
            throw new Error(`Upload failed with status: ${response.status}`);
        }
        
        return { status: response.status };
    } catch (error) {
        console.error('Background upload error:', error);
        throw error;
    }
}

async function getCookiesForDomain(domain) {
    try {
        const cookies = await chrome.cookies.getAll({ domain });
        return cookies;
    } catch (error) {
        console.error('Error getting cookies:', error);
        throw error;
    }
}
