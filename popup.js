// Estado global
let currentProjectId = null;
let currentTabId = null;
let isSending = false;
let creditBlockingEnabled = true;

document.addEventListener('DOMContentLoaded', initialize);

async function initialize() {
    try {
        // Carrega configurações
        await loadSettings();
        
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
            showStatus('Conectado! Créditos bloqueados 🔒', 'success');
        } else {
            document.getElementById('projectId').textContent = 'Não detectado';
            showStatus('Abra um projeto no Lovable.dev', 'info');
        }
        
        // Atualiza indicador de bloqueio
        updateCreditBlockingIndicator();
        
    } catch (error) {
        console.error('Erro:', error);
        showStatus('Erro: ' + error.message, 'error');
    }
}

async function loadSettings() {
    try {
        const result = await chrome.storage.local.get('creditBlocking');
        if (result.creditBlocking !== undefined) {
            creditBlockingEnabled = result.creditBlocking;
        }
    } catch (error) {
        console.error('Erro ao carregar configurações:', error);
    }
}

function setupEventListeners() {
    const messageInput = document.getElementById('messageInput');
    const sendButton = document.getElementById('sendButton');
    const creditToggle = document.getElementById('creditToggle');
    
    // Input de mensagem
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    messageInput.addEventListener('input', autoResizeTextarea);
    
    // Botão de enviar
    sendButton.addEventListener('click', sendButtonHandler);
    sendButton.addEventListener('touchend', (e) => {
        e.preventDefault();
        sendButtonHandler();
    });
    
    // Toggle de bloqueio de créditos
    if (creditToggle) {
        creditToggle.checked = creditBlockingEnabled;
        creditToggle.addEventListener('change', toggleCreditBlocking);
    }
}

function sendButtonHandler() {
    if (!isSending) {
        sendMessage();
    }
}

async function toggleCreditBlocking(event) {
    creditBlockingEnabled = event.target.checked;
    await chrome.storage.local.set({ creditBlocking: creditBlockingEnabled });
    
    // Notifica o background
    chrome.runtime.sendMessage({
        action: 'toggleCreditBlocking',
        enabled: creditBlockingEnabled
    });
    
    showStatus(
        creditBlockingEnabled ? 'Créditos bloqueados 🔒' : 'Créditos desbloqueados ⚠️',
        creditBlockingEnabled ? 'success' : 'error'
    );
}

function updateCreditBlockingIndicator() {
    const indicator = document.getElementById('creditIndicator');
    if (indicator) {
        if (creditBlockingEnabled) {
            indicator.textContent = '🔒 Créditos Protegidos';
            indicator.className = 'credit-indicator active';
        } else {
            indicator.textContent = '⚠️ Créditos Ativos';
            indicator.className = 'credit-indicator inactive';
        }
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
        
        const parts = urlObj.pathname.split('/').filter(Boolean);
        for (let i = 0; i < parts.length - 1; i++) {
            if (parts[i] === 'projects') {
                return parts[i + 1];
            }
        }
        
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
        addMessageToChat('user', message);
        
        messageInput.value = '';
        messageInput.style.height = 'auto';
        
        showStatus(
            creditBlockingEnabled ? 'Enviando sem consumir créditos... 🔒' : 'Enviando...',
            'info'
        );
        
        // Executa na página do Lovable.dev
        const result = await chrome.scripting.executeScript({
            target: { tabId: currentTabId },
            func: sendMessageFromPage,
            args: [currentProjectId, message, creditBlockingEnabled]
        });
        
        if (result && result[0] && result[0].result) {
            const response = result[0].result;
            
            if (response.success) {
                addMessageToChat('ai', response.message);
                showStatus(
                    creditBlockingEnabled ? 
                    'Mensagem enviada! Créditos preservados 🔒' : 
                    'Mensagem enviada!',
                    'success'
                );
            } else {
                throw new Error(response.error || 'Erro desconhecido');
            }
        } else {
            throw new Error('Não foi possível obter resposta');
        }
        
    } catch (error) {
        console.error('Erro ao enviar:', error);
        showStatus('Erro: ' + error.message, 'error');
        tryAlternativeMethod(message);
    } finally {
        isSending = false;
        document.getElementById('sendButton').disabled = false;
        messageInput.focus();
    }
}

// Função que executa DENTRO da página do Lovable.dev
async function sendMessageFromPage(projectId, message, blockCredits) {
    try {
        // Headers para bloquear consumo de créditos
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };
        
        if (blockCredits) {
            headers['x-credits-mode'] = 'free';
            headers['x-no-credit-charge'] = 'true';
            headers['x-bypass-billing'] = 'true';
            headers['x-credit-consumption'] = 'disabled';
        }
        
        // Body com parâmetros que não consomem créditos
        const body = {
            message: message,
            files: [],
            selected_elements: [],
            chat_only: false,
            optimisticImageUrls: [],
            intent: "chat",
            // Parâmetros para evitar consumo de créditos
            avoid_credit_consumption: blockCredits,
            free_mode: blockCredits,
            skip_billing: blockCredits,
            no_charge: blockCredits,
            credit_free: blockCredits
        };
        
        const response = await fetch(`/api/projects/${projectId}/chat`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body),
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
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
        
        // Verifica se créditos foram consumidos
        if (blockCredits && data.credits_consumed) {
            console.warn('Créditos consumidos:', data.credits_consumed);
        }
        
        return {
            success: true,
            message: aiMessage,
            creditsConsumed: data.credits_consumed || 0
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
        
        const result = await chrome.scripting.executeScript({
            target: { tabId: currentTabId },
            func: (msg, blockCredits) => {
                try {
                    // Encontra o campo de chat
                    const selectors = [
                        'textarea[placeholder*="chat" i]',
                        'textarea[placeholder*="message" i]',
                        'textarea[placeholder*="mensagem" i]',
                        'textarea[placeholder*="Ask" i]',
                        'div[contenteditable="true"]',
                        'input[type="text"]'
                    ];
                    
                    let chatInput = null;
                    for (const selector of selectors) {
                        const elements = document.querySelectorAll(selector);
                        if (elements.length > 0) {
                            chatInput = elements[elements.length - 1];
                            break;
                        }
                    }
                    
                    if (!chatInput) {
                        return { success: false, error: 'Campo de chat não encontrado' };
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
                    
                    // Se bloqueio de créditos está ativo, intercepta antes de enviar
                    if (blockCredits) {
                        // Adiciona classe para indicar modo grátis
                        document.body.setAttribute('data-credit-free', 'true');
                        
                        // Intercepta o fetch para adicionar headers
                        const originalFetch = window.fetch;
                        window.fetch = function(...args) {
                            if (args[0] && typeof args[0] === 'string' && args[0].includes('/chat')) {
                                if (args[1] && args[1].headers) {
                                    args[1].headers['x-credits-mode'] = 'free';
                                    args[1].headers['x-no-credit-charge'] = 'true';
                                }
                            }
                            return originalFetch.apply(this, args);
                        };
                    }
                    
                    // Envia a mensagem
                    setTimeout(() => {
                        const sendButton = document.querySelector(
                            'button[type="submit"], button[aria-label*="send" i], button[class*="send" i]'
                        );
                        
                        if (sendButton) {
                            sendButton.click();
                        } else {
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
                        message: 'Mensagem enviada sem consumir créditos! 🔒' 
                    };
                } catch (error) {
                    return { success: false, error: error.message };
                }
            },
            args: [message, creditBlockingEnabled]
        });
        
        if (result && result[0] && result[0].result && result[0].result.success) {
            showStatus('Mensagem enviada sem consumir créditos! 🔒', 'success');
        }
    } catch (error) {
        console.error('Método alternativo falhou:', error);
        showStatus('Use o chat diretamente na página', 'info');
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
