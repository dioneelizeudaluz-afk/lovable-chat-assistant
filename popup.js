// Estado global
let currentProjectId = null;
let currentTabId = null;
let isSending = false;

document.addEventListener('DOMContentLoaded', initialize);

async function initialize() {
    try {
        // Configura listeners
        setupEventListeners();
        
        // Obtém a aba ativa
        const tab = await getCurrentTab();
        if (!tab) {
            showStatus('Abra o Lovable.dev primeiro', 'error');
            return;
        }
        
        currentTabId = tab.id;
        
        // Extrai o ID do projeto da URL
        currentProjectId = extractProjectId(tab.url);
        
        if (currentProjectId) {
            document.getElementById('projectId').textContent = currentProjectId;
            showStatus('Conectado ao projeto!', 'success');
        } else {
            document.getElementById('projectId').textContent = 'Não detectado';
            showStatus('Abra um projeto no Lovable.dev', 'info');
        }
        
    } catch (error) {
        console.error('Erro:', error);
        showStatus('Erro: ' + error.message, 'error');
    }
}

function setupEventListeners() {
    const messageInput = document.getElementById('messageInput');
    const sendButton = document.getElementById('sendButton');
    
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    sendButton.addEventListener('click', sendButtonHandler);
    sendButton.addEventListener('touchend', (e) => {
        e.preventDefault();
        sendButtonHandler();
    });
}

function sendButtonHandler() {
    if (!isSending) {
        sendMessage();
    }
}

async function getCurrentTab() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab;
    } catch (error) {
        console.error('Erro ao obter aba:', error);
        return null;
    }
}

function extractProjectId(url) {
    if (!url) return null;
    
    try {
        const urlObj = new URL(url);
        if (!urlObj.hostname.includes('lovable.dev')) return null;
        
        // Padrões de URL do Lovable
        // https://lovable.dev/projects/PROJECT_ID
        // https://lovable.dev/projects/PROJECT_ID/...
        
        const parts = urlObj.pathname.split('/').filter(Boolean);
        for (let i = 0; i < parts.length - 1; i++) {
            if (parts[i] === 'projects') {
                return parts[i + 1];
            }
        }
        
        // Tenta do hash
        if (urlObj.hash) {
            const hashParts = urlObj.hash.replace('#', '').split('/').filter(Boolean);
            if (hashParts.length > 0) {
                return hashParts[hashParts.length - 1];
            }
        }
    } catch (e) {
        console.error('Erro ao extrair ID:', e);
    }
    
    return null;
}

async function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    const message = messageInput.value.trim();
    
    if (!message) {
        showStatus('Digite uma mensagem', 'error');
        return;
    }
    
    if (!currentProjectId) {
        showStatus('Nenhum projeto detectado', 'error');
        return;
    }
    
    isSending = true;
    document.getElementById('sendButton').disabled = true;
    
    try {
        // Adiciona mensagem do usuário ao chat
        addMessageToChat('user', message);
        
        // Limpa o input
        messageInput.value = '';
        messageInput.style.height = 'auto';
        
        showStatus('Enviando...', 'info');
        
        // Executa na página do Lovable.dev (contorna CORS e 403)
        const result = await chrome.scripting.executeScript({
            target: { tabId: currentTabId },
            func: sendMessageFromPage,
            args: [currentProjectId, message]
        });
        
        if (result && result[0] && result[0].result) {
            const response = result[0].result;
            
            if (response.success) {
                addMessageToChat('ai', response.message);
                showStatus('Mensagem enviada!', 'success');
            } else {
                throw new Error(response.error || 'Erro desconhecido');
            }
        } else {
            throw new Error('Não foi possível obter resposta');
        }
        
    } catch (error) {
        console.error('Erro ao enviar:', error);
        showStatus('Erro: ' + error.message, 'error');
        
        // Tenta método alternativo
        tryAlternativeMethod(message);
    } finally {
        isSending = false;
        document.getElementById('sendButton').disabled = false;
        messageInput.focus();
    }
}

// Função que executa DENTRO da página do Lovable.dev
async function sendMessageFromPage(projectId, message) {
    try {
        // Usa o fetch da própria página (cookies funcionam)
        const response = await fetch(`/api/projects/${projectId}/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify({
                message: message,
                files: [],
                selected_elements: [],
                chat_only: false,
                optimisticImageUrls: [],
                intent: "chat"
            }),
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        // Extrai a mensagem da resposta
        let aiMessage = '';
        if (data.message) {
            aiMessage = data.message;
        } else if (data.response) {
            aiMessage = data.response;
        } else if (data.messages && data.messages.length > 0) {
            const last = data.messages[data.messages.length - 1];
            aiMessage = last.content || last.message || 'Resposta recebida';
        } else {
            aiMessage = JSON.stringify(data);
        }
        
        return {
            success: true,
            message: aiMessage
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

// Método alternativo: usar o chat da própria página
async function tryAlternativeMethod(message) {
    try {
        showStatus('Tentando método alternativo...', 'info');
        
        // Injeta script que encontra o campo de chat na página
        const result = await chrome.scripting.executeScript({
            target: { tabId: currentTabId },
            func: (msg) => {
                try {
                    // Procura pelo textarea ou input de chat
                    const selectors = [
                        'textarea[placeholder*="chat" i]',
                        'textarea[placeholder*="message" i]',
                        'textarea[placeholder*="mensagem" i]',
                        'textarea[placeholder*="Ask" i]',
                        'textarea[placeholder*="ask" i]',
                        'div[contenteditable="true"]',
                        'input[type="text"]'
                    ];
                    
                    let chatInput = null;
                    for (const selector of selectors) {
                        const elements = document.querySelectorAll(selector);
                        if (elements.length > 0) {
                            // Pega o último elemento (geralmente é o chat)
                            chatInput = elements[elements.length - 1];
                            break;
                        }
                    }
                    
                    if (!chatInput) {
                        return { success: false, error: 'Campo de chat não encontrado na página' };
                    }
                    
                    // Insere a mensagem
                    if (chatInput.tagName === 'TEXTAREA' || chatInput.tagName === 'INPUT') {
                        chatInput.value = msg;
                        chatInput.dispatchEvent(new Event('input', { bubbles: true }));
                        chatInput.dispatchEvent(new Event('change', { bubbles: true }));
                    } else {
                        chatInput.textContent = msg;
                        chatInput.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    
                    // Procura e clica no botão de enviar
                    setTimeout(() => {
                        const sendButton = document.querySelector(
                            'button[type="submit"], button[aria-label*="send" i], button[aria-label*="enviar" i], button[class*="send" i]'
                        );
                        
                        if (sendButton) {
                            sendButton.click();
                        } else {
                            // Tenta enviar com Enter
                            const enterEvent = new KeyboardEvent('keydown', {
                                key: 'Enter',
                                code: 'Enter',
                                keyCode: 13,
                                which: 13,
                                bubbles: true
                            });
                            chatInput.dispatchEvent(enterEvent);
                        }
                    }, 100);
                    
                    return { 
                        success: true, 
                        message: 'Mensagem enviada pela interface web. Verifique a página do Lovable.' 
                    };
                } catch (error) {
                    return { success: false, error: error.message };
                }
            },
            args: [message]
        });
        
        if (result && result[0] && result[0].result && result[0].result.success) {
            showStatus('Mensagem enviada pela interface web!', 'success');
        }
    } catch (error) {
        console.error('Método alternativo falhou:', error);
        showStatus('Abra o chat do Lovable.dev diretamente na página', 'info');
    }
}

function addMessageToChat(type, content) {
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
    
    messagesContainer.appendChild(messageElement);
    
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

function autoResizeTextarea() {
    const textarea = document.getElementById('messageInput');
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
            }
