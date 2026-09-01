// Estado global da extensão
let currentProjectId = null;
let authToken = null;
let cookieString = '';
let browserSessionId = null;
let attachedFiles = [];
let isSending = false;

// Inicialização
document.addEventListener('DOMContentLoaded', initialize);

async function initialize() {
    try {
        // Configura viewport para mobile
        setupMobileViewport();
        
        // Carrega o browser session ID do storage ou gera um novo
        browserSessionId = await getOrCreateBrowserSessionId();
        
        // Obtém a aba ativa e extrai o ID do projeto
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
        
        // Configura os event listeners
        setupEventListeners();
        
        showStatus('Pronto para conversar!', 'success');
    } catch (error) {
        console.error('Initialization error:', error);
        showStatus('Erro na inicialização: ' + error.message, 'error');
    }
}

function setupMobileViewport() {
    // Garante que o viewport está correto
    const viewport = document.querySelector('meta[name="viewport"]');
    if (!viewport) {
        const meta = document.createElement('meta');
        meta.name = 'viewport';
        meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
        document.head.appendChild(meta);
    }
    
    // Previne zoom em double-tap
    document.addEventListener('touchend', (event) => {
        const now = Date.now();
        if (now - (document.lastTouch || now) <= 300) {
            event.preventDefault();
        }
        document.lastTouch = now;
    }, { passive: false });
}

function setupEventListeners() {
    const messageInput = document.getElementById('messageInput');
    const sendButton = document.getElementById('sendButton');
    const attachButton = document.getElementById('attachButton');
    const fileInput = document.getElementById('fileInput');
    
    // Enviar mensagem com Enter (Shift+Enter para nova linha)
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    // Auto-resize do textarea
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
            if (url.hostname.includes('lovable.dev')) {
                // Extrai o ID do projeto da URL
                const pathParts = url.pathname.split('/').filter(Boolean);
                if (pathParts.length >= 2 && pathParts[0] === 'projects') {
                    return pathParts[1];
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
        // Consulta os cookies do domínio lovable.dev
        const cookies = await chrome.cookies.getAll({ domain: '.lovable.dev' });
        
        if (cookies.length === 0) {
            throw new Error('Nenhum cookie encontrado. Faça login no Lovable.dev primeiro.');
        }
        
        // Procura pelos cookies de autenticação específicos
        const sessionCookie = cookies.find(c => c.name === 'lovable-session-id-v2');
        const accessTokenCookie = cookies.find(c => c.name === 'sb-access-token');
        
        if (sessionCookie) {
            authToken = sessionCookie.value;
        } else if (accessTokenCookie) {
            authToken = accessTokenCookie.value;
        } else {
            // Se não encontrar os cookies específicos, tenta usar qualquer cookie que pareça um token
            const possibleTokenCookie = cookies.find(c => 
                c.value && (c.value.startsWith('eyJ') || c.value.length > 100)
            );
            if (possibleTokenCookie) {
                authToken = possibleTokenCookie.value;
            } else {
                throw new Error('Cookie de autenticação não encontrado. Faça login no Lovable.dev.');
            }
        }
        
        // Constrói a string de cookies para enviar nos headers
        cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        
        console.log('Auth cookies obtained successfully');
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
        
        // Gera um novo ID de sessão
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

async function handleFileSelection(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    
    for (const file of files) {
        const fileEntry = {
            id: `file-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
            file: file,
            status: 'uploading',
            progress: 0,
            downloadUrl: null,
            fileId: null
        };
        
        attachedFiles.push(fileEntry);
        displayFilePreview(fileEntry);
        
        try {
            await uploadFile(fileEntry);
        } catch (error) {
            console.error('Error uploading file:', error);
            fileEntry.status = 'error';
            updateFilePreview(fileEntry);
            showStatus(`Erro ao fazer upload de ${file.name}: ${error.message}`, 'error');
        }
    }
    
    // Limpa o input de arquivo
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
            <div class="file-preview-progress">
                <div class="file-preview-progress-bar" style="width: 0%"></div>
            </div>
            <div class="file-preview-status uploading">Enviando...</div>
        </div>
        <button class="file-preview-remove" data-file-id="${fileEntry.id}">×</button>
    `;
    
    // Adiciona event listener para o botão de remover
    const removeButton = previewElement.querySelector('.file-preview-remove');
    removeButton.addEventListener('click', () => removeFile(fileEntry.id));
    removeButton.addEventListener('touchend', (e) => {
        e.preventDefault();
        removeFile(fileEntry.id);
    });
    
    previewsContainer.appendChild(previewElement);
}

function updateFilePreview(fileEntry) {
    const previewElement = document.getElementById(fileEntry.id);
    if (!previewElement) return;
    
    const progressBar = previewElement.querySelector('.file-preview-progress-bar');
    const statusElement = previewElement.querySelector('.file-preview-status');
    
    if (progressBar) {
        progressBar.style.width = `${fileEntry.progress}%`;
    }
    
    if (statusElement) {
        statusElement.className = 'file-preview-status';
        
        switch (fileEntry.status) {
            case 'uploading':
                statusElement.className += ' uploading';
                statusElement.textContent = `Enviando... ${fileEntry.progress}%`;
                break;
            case 'success':
                statusElement.className += ' success';
                statusElement.textContent = '✓ Enviado';
                break;
            case 'error':
                statusElement.className += ' error';
                statusElement.textContent = 'Erro no upload';
                break;
        }
    }
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

async function uploadFile(fileEntry) {
    try {
        // Etapa 1: Gerar URL de upload
        fileEntry.status = 'uploading';
        fileEntry.progress = 10;
        updateFilePreview(fileEntry);
        
        const uploadUrlResponse = await fetch(
            `https://api.lovable.dev/projects/${currentProjectId}/files/generate-upload-url`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
                    'Origin': 'https://lovable.dev',
                    'Referer': 'https://lovable.dev/',
                    'Cookie': cookieString,
                    'x-client-git-sha': '04b3668677038d15039de65e27688c38ab80e9ab',
                    'x-browser-session-id': browserSessionId,
                    'x-lov-platform': '{"platform":"web","version":"96d78a825f60be3df0ab1bd832c8f511eb4b5775"}'
                },
                body: JSON.stringify({
                    original_file_name: fileEntry.file.name,
                    content_type: fileEntry.file.type || 'application/octet-stream',
                    file_size_bytes: fileEntry.file.size,
                    original_file_size_bytes: fileEntry.file.size
                })
            }
        );
        
        if (!uploadUrlResponse.ok) {
            throw new Error(`Erro ao gerar URL de upload: ${uploadUrlResponse.status}`);
        }
        
        const uploadData = await uploadUrlResponse.json();
        
        if (!uploadData.url || !uploadData.file_id) {
            throw new Error('Resposta inválida do servidor ao gerar URL de upload');
        }
        
        fileEntry.fileId = uploadData.file_id;
        fileEntry.progress = 30;
        updateFilePreview(fileEntry);
        
        // Etapa 2: Upload do arquivo para o GCS
        const fileBuffer = await fileEntry.file.arrayBuffer();
        let uploadSuccess = false;
        
        try {
            // Método 1: Tentar com fetch e mode: 'cors'
            const uploadResponse = await fetch(uploadData.url, {
                method: 'PUT',
                mode: 'cors',
                headers: {
                    'Content-Type': fileEntry.file.type,
                    'x-goog-content-length-range': uploadData.headers['x-goog-content-length-range'],
                    'x-goog-meta-user_id': uploadData.headers['x-goog-meta-user_id']
                },
                body: fileBuffer
            });
            
            uploadSuccess = uploadResponse.ok;
            fileEntry.progress = 70;
            updateFilePreview(fileEntry);
        } catch (fetchError) {
            console.log('Fetch failed, trying alternative method:', fetchError);
            
            // Método 2: Usar XMLHttpRequest
            try {
                await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open('PUT', uploadData.url);
                    xhr.setRequestHeader('Content-Type', fileEntry.file.type);
                    xhr.setRequestHeader('x-goog-content-length-range', uploadData.headers['x-goog-content-length-range']);
                    xhr.setRequestHeader('x-goog-meta-user_id', uploadData.headers['x-goog-meta-user_id']);
                    
                    xhr.upload.onprogress = (e) => {
                        if (e.lengthComputable) {
                            fileEntry.progress = 30 + (e.loaded / e.total) * 40;
                            updateFilePreview(fileEntry);
                        }
                    };
                    
                    xhr.onload = () => {
                        if (xhr.status >= 200 && xhr.status < 300) {
                            uploadSuccess = true;
                            resolve();
                        } else {
                            reject(new Error(`XHR upload failed: ${xhr.status}`));
                        }
                    };
                    
                    xhr.onerror = () => reject(new Error('XHR network error'));
                    xhr.send(fileBuffer);
                });
                
                fileEntry.progress = 70;
                updateFilePreview(fileEntry);
            } catch (xhrError) {
                console.log('XHR failed, trying background script:', xhrError);
                
                // Método 3: Usar background script
                try {
                    const result = await new Promise((resolve, reject) => {
                        chrome.runtime.sendMessage({
                            action: 'uploadToStorage',
                            data: {
                                url: uploadData.url,
                                headers: {
                                    'Content-Type': fileEntry.file.type,
                                    'x-goog-content-length-range': uploadData.headers['x-goog-content-length-range'],
                                    'x-goog-meta-user_id': uploadData.headers['x-goog-meta-user_id']
                                },
                                body: Array.from(new Uint8Array(fileBuffer)),
                                fileId: fileEntry.id
                            }
                        }, (response) => {
                            if (chrome.runtime.lastError) {
                                reject(new Error(chrome.runtime.lastError.message));
                            } else if (response.success) {
                                uploadSuccess = true;
                                resolve(response);
                            } else {
                                reject(new Error(response.error));
                            }
                        });
                    });
                    
                    fileEntry.progress = 70;
                    updateFilePreview(fileEntry);
                } catch (bgError) {
                    throw new Error(`Todos os métodos de upload falharam: ${bgError.message}`);
                }
            }
        }
        
        if (!uploadSuccess) {
            throw new Error('Upload falhou');
        }
        
        // Etapa 3: Gerar URL de download
        fileEntry.progress = 85;
        updateFilePreview(fileEntry);
        
        const [dirName, fileName] = uploadData.file_id.split('/');
        
        const downloadUrlResponse = await fetch(
            'https://api.lovable.dev/files/generate-download-url',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`,
                    'Cookie': cookieString,
                    'Origin': 'https://lovable.dev',
                    'Referer': 'https://lovable.dev/'
                },
                body: JSON.stringify({
                    dir_name: dirName,
                    file_name: fileName
                })
            }
        );
        
        if (!downloadUrlResponse.ok) {
            throw new Error(`Erro ao gerar URL de download: ${downloadUrlResponse.status}`);
        }
        
        const downloadData = await downloadUrlResponse.json();
        fileEntry.downloadUrl = downloadData.url || downloadData.download_url;
        fileEntry.status = 'success';
        fileEntry.progress = 100;
        updateFilePreview(fileEntry);
        
        console.log('File uploaded successfully:', fileEntry.downloadUrl);
    } catch (error) {
        console.error('Upload error:', error);
        fileEntry.status = 'error';
        updateFilePreview(fileEntry);
        throw error;
    }
}

async function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    const message = messageInput.value.trim();
    
    if (!message && attachedFiles.filter(f => f.status === 'success').length === 0) {
        showStatus('Digite uma mensagem ou anexe um arquivo', 'error');
        return;
    }
    
    if (!currentProjectId) {
        showStatus('Nenhum projeto Lovable detectado. Abra um projeto primeiro.', 'error');
        return;
    }
    
    if (!authToken) {
        showStatus('Autenticação necessária. Faça login no Lovable.dev.', 'error');
        return;
    }
    
    // Verifica se há arquivos ainda em upload
    const uploadingFiles = attachedFiles.filter(f => f.status === 'uploading');
    if (uploadingFiles.length > 0) {
        showStatus('Aguarde o upload dos arquivos terminar', 'info');
        return;
    }
    
    isSending = true;
    const sendButton = document.getElementById('sendButton');
    sendButton.disabled = true;
    
    try {
        // Prepara os arquivos para a mensagem
        const filesForMessage = attachedFiles
            .filter(f => f.status === 'success' && f.downloadUrl)
            .map(f => ({
                name: f.file.name,
                url: f.downloadUrl,
                type: f.file.type
            }));
        
        // Cria o corpo da mensagem
        const ids = generateMessageId();
        const messageBody = {
            id: ids.userMessageId,
            message: message || 'Arquivos anexados',
            files: filesForMessage.map(f => f.url),
            selected_elements: [],
            chat_only: false,
            optimisticImageUrls: [],
            intent: "fix_error",
            message_intent_metadata: {
                fix_error_metadata: {
                    errors: [{
                        error_type: "build",
                        error_message: message || 'Files attached'
                    }]
                }
            }
        };
        
        // Adiciona a mensagem do usuário ao chat
        addMessageToChat('user', message || 'Arquivos anexados', filesForMessage);
        
        // Limpa o input e os arquivos
        messageInput.value = '';
        messageInput.style.height = 'auto';
        attachedFiles = [];
        document.getElementById('filePreviewArea').style.display = 'none';
        document.getElementById('filePreviews').innerHTML = '';
        
        // Envia a mensagem para a API
        showStatus('Enviando mensagem...', 'info');
        
        const response = await fetch(
            `https://api.lovable.dev/projects/${currentProjectId}/chat`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`,
                    'Origin': 'https://lovable.dev',
                    'Referer': 'https://lovable.dev/',
                    'Cookie': cookieString,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
                },
                body: JSON.stringify(messageBody)
            }
        );
        
        if (!response.ok) {
            throw new Error(`Erro ao enviar mensagem: ${response.status}`);
        }
        
        const responseData = await response.json();
        
        // Extrai e exibe a resposta da IA
        const aiResponse = extractAIResponse(responseData);
        if (aiResponse) {
            addMessageToChat('ai', aiResponse);
            showStatus('Mensagem enviada com sucesso!', 'success');
        } else {
            showStatus('Mensagem enviada, aguardando resposta da IA...', 'info');
        }
        
    } catch (error) {
        console.error('Error sending message:', error);
        showStatus('Erro ao enviar mensagem: ' + error.message, 'error');
    } finally {
        isSending = false;
        sendButton.disabled = false;
        messageInput.focus();
    }
}

function extractAIResponse(responseData) {
    // Tenta extrair a resposta da IA de diferentes formatos de resposta
    try {
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
        return 'Resposta recebida, mas em formato desconhecido. Verifique o console para detalhes.';
    } catch (error) {
        console.error('Error extracting AI response:', error);
        return 'Erro ao processar resposta da IA.';
    }
}

function addMessageToChat(type, content, files = null) {
    const messagesContainer = document.getElementById('messages');
    
    // Remove a mensagem de boas-vindas se existir
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
            fileLink.href = file.url;
            fileLink.target = '_blank';
            fileLink.textContent = `📎 ${file.name}`;
            fileLink.addEventListener('click', (e) => {
                e.preventDefault();
                window.open(file.url, '_blank');
            });
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
    
    // Limpa o status após 3 segundos (exceto para erros)
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
