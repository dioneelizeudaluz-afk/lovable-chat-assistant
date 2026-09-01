// Estado global da extensão
let currentProjectId = null;
let authToken = null;
let cookieString = '';
let browserSessionId = null;
let attachedFiles = [];
let isSending = false;
let allCookies = [];

// Inicialização
document.addEventListener('DOMContentLoaded', initialize);

async function initialize() {
    try {
        setupMobileViewport();
        browserSessionId = await getOrCreateBrowserSessionId();
        
        // Obtém a aba ativa
        const projectId = await getCurrentProjectId();
        if (projectId) {
            currentProjectId = projectId;
            document.getElementById('projectId').textContent = projectId;
        } else {
            document.getElementById('projectId').textContent = 'Não detectado';
            showStatus('Abra um projeto Lovable.dev para começar', 'info');
        }
        
        // Obtém os cookies de autenticação
        await getAuthCookies();
        
        setupEventListeners();
        showStatus('Pronto para conversar!', 'success');
    } catch (error) {
        console.error('Initialization error:', error);
        showStatus('Erro: ' + error.message, 'error');
    }
}

function setupMobileViewport() {
    const viewport = document.querySelector('meta[name="viewport"]');
    if (!viewport) {
        const meta = document.createElement('meta');
        meta.name = 'viewport';
        meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
        document.head.appendChild(meta);
    }
}

function setupEventListeners() {
    const messageInput = document.getElementById('messageInput');
    const sendButton = document.getElementById('sendButton');
    const attachButton = document.getElementById('attachButton');
    const fileInput = document.getElementById('fileInput');
    
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    messageInput.addEventListener('input', autoResizeTextarea);
    
    sendButton.addEventListener('click', sendMessage);
    sendButton.addEventListener('touchend', (e) => {
        e.preventDefault();
        sendMessage();
    });
    
    attachButton.addEventListener('click', () => {
        fileInput.click();
    });
    attachButton.addEventListener('touchend', (e) => {
        e.preventDefault();
        fileInput.click();
    });
    
    fileInput.addEventListener('change', handleFileSelection);
}

function autoResizeTextarea() {
    const textarea = document.getElementById('messageInput');
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

async function getCurrentProjectId() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url) {
            const url = new URL(tab.url);
            console.log('URL atual:', url.href);
            
            if (url.hostname.includes('lovable.dev')) {
                const pathParts = url.pathname.split('/').filter(Boolean);
                console.log('Path parts:', pathParts);
                
                // Tenta diferentes padrões de URL
                for (let i = 0; i < pathParts.length - 1; i++) {
                    if (pathParts[i] === 'projects' && pathParts[i + 1]) {
                        return pathParts[i + 1];
                    }
                }
                
                // Se não encontrou, tenta pegar do hash ou query
                if (url.hash) {
                    const hashParts = url.hash.replace('#', '').split('/').filter(Boolean);
                    if (hashParts.length > 0) {
                        return hashParts[hashParts.length - 1];
                    }
                }
            }
        }
        return null;
    } catch (error) {
        console.error('Error getting current project:', error);
        return null;
    }
}

async function getAuthCookies() {
    try {
        // Busca TODOS os cookies dos domínios relevantes
        const domains = ['.lovable.dev', 'lovable.dev', '.api.lovable.dev', 'api.lovable.dev'];
        allCookies = [];
        
        for (const domain of domains) {
            try {
                const cookies = await chrome.cookies.getAll({ domain });
                allCookies = allCookies.concat(cookies);
            } catch (e) {
                console.log(`Erro ao buscar cookies de ${domain}:`, e);
            }
        }
        
        // Remove duplicatas
        allCookies = allCookies.filter((cookie, index, self) => 
            index === self.findIndex(c => c.name === cookie.name && c.domain === cookie.domain)
        );
        
        console.log('Cookies encontrados:', allCookies.length);
        
        if (allCookies.length === 0) {
            throw new Error('Nenhum cookie encontrado. Faça login no Lovable.dev primeiro.');
        }
        
        // Procura pelo token de autenticação em ordem de prioridade
        const sessionCookie = allCookies.find(c => c.name === 'lovable-session-id-v2');
        const accessTokenCookie = allCookies.find(c => c.name === 'sb-access-token');
        const authCookie = allCookies.find(c => c.name === 'auth-token');
        const supabaseCookie = allCookies.find(c => c.name.includes('supabase') || c.name.includes('sb-'));
        
        // Lista todos os cookies para debug
        console.log('Cookies disponíveis:', allCookies.map(c => c.name));
        
        if (sessionCookie && sessionCookie.value) {
            authToken = sessionCookie.value;
            console.log('Usando lovable-session-id-v2 como token');
        } else if (accessTokenCookie && accessTokenCookie.value) {
            authToken = accessTokenCookie.value;
            console.log('Usando sb-access-token como token');
        } else if (authCookie && authCookie.value) {
            authToken = authCookie.value;
            console.log('Usando auth-token como token');
        } else if (supabaseCookie && supabaseCookie.value) {
            authToken = supabaseCookie.value;
            console.log('Usando cookie supabase como token');
        } else {
            // Tenta encontrar qualquer cookie que pareça um JWT
            const jwtCookie = allCookies.find(c => 
                c.value && c.value.startsWith('eyJ') && c.value.split('.').length === 3
            );
            
            if (jwtCookie) {
                authToken = jwtCookie.value;
                console.log('Usando JWT do cookie:', jwtCookie.name);
            } else {
                console.error('Cookies disponíveis:', allCookies.map(c => ({name: c.name, value: c.value.substring(0, 20) + '...'})));
                throw new Error('Token de autenticação não encontrado. Faça login no Lovable.dev.');
            }
        }
        
        // Constrói a string de cookies completa
        cookieString = allCookies
            .filter(c => c.value && c.value.trim() !== '')
            .map(c => `${c.name}=${c.value}`)
            .join('; ');
        
        console.log('Token obtido com sucesso:', authToken.substring(0, 20) + '...');
        console.log('Cookie string construída:', cookieString.substring(0, 50) + '...');
        
        return { authToken, cookieString };
    } catch (error) {
        console.error('Error getting auth cookies:', error);
        showStatus('Erro de autenticação: ' + error.message, 'error');
        throw error;
    }
}

async function getOrCreateBrowserSessionId() {
    try {
        const result = await chrome.storage.local.get('browserSessionId');
        if (result.browserSessionId) {
            return result.browserSessionId;
        }
        
        const newSessionId = generateUUID();
        await chrome.storage.local.set({ browserSessionId: newSessionId });
        return newSessionId;
    } catch (error) {
        console.error('Error getting browser session ID:', error);
        return generateUUID();
    }
}

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function generateMessageId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 10);
    return {
        userMessageId: `user-${timestamp}-${random}`,
        aiMessageId: `ai-${timestamp}-${random}`
    };
}

async function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    const message = messageInput.value.trim();
    
    if (!message && attachedFiles.filter(f => f.status === 'success').length === 0) {
        showStatus('Digite uma mensagem ou anexe um arquivo', 'error');
        return;
    }
    
    if (!currentProjectId) {
        showStatus('Nenhum projeto Lovable detectado', 'error');
        return;
    }
    
    if (!authToken) {
        showStatus('Autenticação necessária. Faça login no Lovable.dev.', 'error');
        return;
    }
    
    isSending = true;
    const sendButton = document.getElementById('sendButton');
    sendButton.disabled = true;
    
    try {
        const filesForMessage = attachedFiles
            .filter(f => f.status === 'success' && f.downloadUrl)
            .map(f => f.url);
        
        const ids = generateMessageId();
        
        // Body mais simples e compatível
        const messageBody = {
            id: ids.userMessageId,
            message: message,
            files: filesForMessage,
            selected_elements: [],
            chat_only: false,
            optimisticImageUrls: [],
            intent: "chat",
            message_intent_metadata: {}
        };
        
        addMessageToChat('user', message || 'Arquivos anexados', attachedFiles.filter(f => f.status === 'success'));
        
        messageInput.value = '';
        messageInput.style.height = 'auto';
        attachedFiles = [];
        document.getElementById('filePreviewArea').style.display = 'none';
        document.getElementById('filePreviews').innerHTML = '';
        
        showStatus('Enviando mensagem...', 'info');
        
        console.log('Enviando para:', `https://api.lovable.dev/projects/${currentProjectId}/chat`);
        console.log('Headers:', {
            'Authorization': `Bearer ${authToken.substring(0, 20)}...`,
            'Cookie': cookieString.substring(0, 50) + '...'
        });
        
        // Headers completos para evitar 403
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
            'Cookie': cookieString,
            'Origin': 'https://lovable.dev',
            'Referer': `https://lovable.dev/projects/${currentProjectId}`,
            'User-Agent': navigator.userAgent,
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
            'x-browser-session-id': browserSessionId,
            'x-client-git-sha': '04b3668677038d15039de65e27688c38ab80e9ab',
            'x-lov-platform': '{"platform":"web","version":"96d78a825f60be3df0ab1bd832c8f511eb4b5775"}'
        };
        
        const response = await fetch(
            `https://api.lovable.dev/projects/${currentProjectId}/chat`,
            {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(messageBody),
                credentials: 'include' // Importante para enviar cookies
            }
        );
        
        console.log('Status da resposta:', response.status);
        
        if (response.status === 403) {
            // Tenta novamente com headers diferentes
            console.log('Erro 403, tentando com headers alternativos...');
            
            const alternativeHeaders = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`,
                'Cookie': cookieString,
                'Origin': 'https://lovable.dev',
                'Referer': 'https://lovable.dev/',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
                'Accept': '*/*',
                'x-browser-session-id': browserSessionId
            };
            
            const retryResponse = await fetch(
                `https://api.lovable.dev/projects/${currentProjectId}/chat`,
                {
                    method: 'POST',
                    headers: alternativeHeaders,
                    body: JSON.stringify(messageBody),
                    credentials: 'include'
                }
            );
            
            console.log('Status da segunda tentativa:', retryResponse.status);
            
            if (!retryResponse.ok) {
                const errorText = await retryResponse.text();
                console.error('Resposta de erro:', errorText);
                throw new Error(`Erro ${retryResponse.status}: ${errorText.substring(0, 100)}`);
            }
            
            const retryData = await retryResponse.json();
            const aiResponse = extractAIResponse(retryData);
            if (aiResponse) {
                addMessageToChat('ai', aiResponse);
                showStatus('Mensagem enviada!', 'success');
            }
        } else if (!response.ok) {
            const errorText = await response.text();
            console.error('Resposta de erro:', errorText);
            throw new Error(`Erro ${response.status}: ${errorText.substring(0, 100)}`);
        } else {
            const responseData = await response.json();
            const aiResponse = extractAIResponse(responseData);
            if (aiResponse) {
                addMessageToChat('ai', aiResponse);
                showStatus('Mensagem enviada com sucesso!', 'success');
            } else {
                showStatus('Mensagem enviada!', 'success');
            }
        }
        
    } catch (error) {
        console.error('Error sending message:', error);
        showStatus('Erro: ' + error.message, 'error');
        
        // Sugere soluções
        if (error.message.includes('403')) {
            showStatus('Erro 403: Tente atualizar a página do Lovable.dev e reabrir a extensão', 'error');
        }
    } finally {
        isSending = false;
        sendButton.disabled = false;
        messageInput.focus();
    }
}

function extractAIResponse(responseData) {
    try {
        console.log('Resposta completa:', responseData);
        
        if (responseData.message) {
            return responseData.message;
        }
        if (responseData.response) {
            return responseData.response;
        }
        if (responseData.data && responseData.data.message) {
            return responseData.data.message;
        }
        if (responseData.messages && Array.isArray(responseData.messages)) {
            const lastMessage = responseData.messages[responseData.messages.length - 1];
            if (lastMessage && lastMessage.content) {
                return lastMessage.content;
            }
        }
        if (responseData.answer) {
            return responseData.answer;
        }
        if (responseData.text) {
            return responseData.text;
        }
        if (responseData.content) {
            return responseData.content;
        }
        
        return 'Resposta recebida. Verifique o console para detalhes.';
    } catch (error) {
        console.error('Error extracting AI response:', error);
        return 'Erro ao processar resposta.';
    }
}

function addMessageToChat(type, content, files = null) {
    const messagesContainer = document.getElementById('messages');
    
    const welcomeMessage = messagesContainer.querySelector('.welcome-message');
    if (welcomeMessage) {
        welcomeMessage.remove();
    }
    
    const messageElement = document.createElement('div');
    messageElement.className = `message ${type}`;
    
    const contentElement = document.createElement('div');
    contentElement.className = 'message-content';
    contentElement.textContent = content;
    messageElement.appendChild(contentElement);
    
    if (files && files.length > 0) {
        const filesContainer = document.createElement('div');
        filesContainer.className = 'message-files';
        
        files.forEach(file => {
            const fileLink = document.createElement('a');
            fileLink.href = file.downloadUrl || file.url;
            fileLink.target = '_blank';
            fileLink.textContent = `📎 ${file.file?.name || file.name || 'Arquivo'}`;
            filesContainer.appendChild(fileLink);
        });
        
        messageElement.appendChild(filesContainer);
    }
    
    messagesContainer.appendChild(messageElement);
    scrollToBottom();
}

function scrollToBottom() {
    const chatArea = document.getElementById('chatArea');
    setTimeout(() => {
        chatArea.scrollTop = chatArea.scrollHeight;
    }, 100);
}

function showStatus(message, type = 'info') {
    const statusBar = document.getElementById('statusBar');
    statusBar.textContent = message;
    statusBar.className = 'status-bar';
    
    if (type) {
        statusBar.classList.add(type);
    }
    
    if (type !== 'error') {
        clearTimeout(statusBar.timeout);
        statusBar.timeout = setTimeout(() => {
            statusBar.textContent = '';
            statusBar.className = 'status-bar';
        }, 3000);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Função de upload simplificada
async function handleFileSelection(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    
    showStatus('Upload de arquivos ainda em desenvolvimento...', 'info');
    
    // Por enquanto, apenas mostra os arquivos selecionados
    for (const file of files) {
        const fileEntry = {
            id: `file-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
            file: file,
            status: 'success',
            progress: 100,
            downloadUrl: null,
            fileId: null
        };
        
        attachedFiles.push(fileEntry);
        displayFilePreview(fileEntry);
    }
    
    event.target.value = '';
}

function displayFilePreview(fileEntry) {
    const previewArea = document.getElementById('filePreviewArea');
    const previewsContainer = document.getElementById('filePreviews');
    
    previewArea.style.display = 'block';
    
    const previewElement = document.createElement('div');
    previewElement.className = 'file-preview-item';
    previewElement.id = fileEntry.id;
    
    previewElement.innerHTML = `
        <div class="file-preview-info">
            <div class="file-preview-name">${escapeHtml(fileEntry.file.name)}</div>
            <div class="file-preview-size">${formatFileSize(fileEntry.file.size)}</div>
            <div class="file-preview-status success">✓ Anexado</div>
        </div>
        <button class="file-preview-remove" data-file-id="${fileEntry.id}">×</button>
    `;
    
    const removeButton = previewElement.querySelector('.file-preview-remove');
    removeButton.addEventListener('click', () => removeFile(fileEntry.id));
    
    previewsContainer.appendChild(previewElement);
}

function removeFile(fileId) {
    const index = attachedFiles.findIndex(f => f.id === fileId);
    if (index > -1) {
        attachedFiles.splice(index, 1);
    }
    
    const previewElement = document.getElementById(fileId);
    if (previewElement) {
        previewElement.remove();
    }
    
    if (attachedFiles.length === 0) {
        document.getElementById('filePreviewArea').style.display = 'none';
    }
        }
