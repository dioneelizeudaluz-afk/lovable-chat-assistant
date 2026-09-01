// Estado global
let currentProjectId = null;
let currentTabId = null;
let isSending = false;

document.addEventListener('DOMContentLoaded', initialize);

async function initialize() {
    try {
        setupEventListeners();
        
        const tab = await getCurrentTab();
        if (!tab) {
            showStatus('Abra o Lovable.dev primeiro', 'error');
            return;
        }
        
        currentTabId = tab.id;
        currentProjectId = extractProjectId(tab.url);
        
        if (currentProjectId) {
            document.getElementById('projectId').textContent = currentProjectId;
            showStatus('Conectado! Modo ilimitado ativo 🔓', 'success');
            
            // Injeta script para bloquear créditos
            await injectCreditBlocker();
        } else {
            document.getElementById('projectId').textContent = 'Não detectado';
            showStatus('Abra um projeto no Lovable.dev', 'info');
        }
        
    } catch (error) {
        console.error('Erro:', error);
        showStatus('Erro: ' + error.message, 'error');
    }
}

// Injeta script que bloqueia consumo de créditos
async function injectCreditBlocker() {
    try {
        await chrome.scripting.executeScript({
            target: { tabId: currentTabId },
            func: blockCredits
        });
        console.log('Bloqueador de créditos injetado');
    } catch (error) {
        console.error('Erro ao injetar bloqueador:', error);
    }
}

// Função que executa na página para bloquear créditos
function blockCredits() {
    // Salva o fetch original
    const originalFetch = window.fetch;
    
    // Intercepta todas as respostas
    window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);
        
        // Verifica se é uma chamada de chat
        const url = typeof args[0] === 'string' ? args[0] : args[0].url;
        
        if (url && url.includes('/chat')) {
            console.log('🔒 Interceptando chamada de chat');
            
            // Clona a resposta para modificá-la
            const clonedResponse = response.clone();
            
            try {
                const data = await clonedResponse.json();
                
                // Modifica os campos de créditos
                if (data.credits_consumed !== undefined) {
                    data.credits_consumed = 0;
                }
                if (data.credits_used !== undefined) {
                    data.credits_used = 0;
                }
                if (data.credits_remaining !== undefined) {
                    data.credits_remaining = 999999;
                }
                if (data.credits !== undefined) {
                    data.credits = 999999;
                }
                if (data.quota !== undefined) {
                    data.quota = 999999;
                }
                
                // Cria nova resposta modificada
                const modifiedResponse = new Response(JSON.stringify(data), {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers
                });
                
                return modifiedResponse;
            } catch (e) {
                // Se não conseguir parsear JSON, retorna original
                return response;
            }
        }
        
        return response;
    };
    
    // Também intercepta XMLHttpRequest
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;
    
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this._url = url;
        return originalXHROpen.call(this, method, url, ...rest);
    };
    
    XMLHttpRequest.prototype.send = function(...args) {
        this.addEventListener('load', function() {
            if (this._url && this._url.includes('/chat')) {
                console.log('🔒 Interceptando resposta XHR');
                
                try {
                    const data = JSON.parse(this.responseText);
                    
                    // Zera créditos consumidos
                    if (data.credits_consumed !== undefined) {
                        data.credits_consumed = 0;
                    }
                    if (data.credits_used !== undefined) {
                        data.credits_used = 0;
                    }
                    
                    // Define créditos como ilimitados
                    if (data.credits_remaining !== undefined) {
                        data.credits_remaining = 999999;
                    }
                    
                    // Sobrescreve a resposta
                    Object.defineProperty(this, 'responseText', {
                        value: JSON.stringify(data)
                    });
                } catch (e) {
                    console.log('Não foi possível modificar resposta');
                }
            }
        });
        
        return originalXHRSend.apply(this, args);
    };
    
    console.log('🔒 Bloqueador de créditos ativado!');
    return true;
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
    
    messageInput.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
    });
    
    sendButton.addEventListener('click', () => {
        if (!isSending) sendMessage();
    });
    
    sendButton.addEventListener('touchend', (e) => {
        e.preventDefault();
        if (!isSending) sendMessage();
    });
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
        
        showStatus('Enviando mensagem... 🔒', 'info');
        
        // Re-injeta o bloqueador antes de enviar
        await injectCreditBlocker();
        
        // Envia mensagem diretamente na página
        const result = await chrome.scripting.executeScript({
            target: { tabId: currentTabId },
            func: sendMessageInPage,
            args: [message]
        });
        
        if (result && result[0] && result[0].result) {
            const response = result[0].result;
            
            if (response.success) {
                addMessageToChat('ai', response.message);
                showStatus('Mensagem enviada! Créditos preservados 🔒', 'success');
            } else {
                throw new Error(response.error || 'Erro desconhecido');
            }
        }
        
    } catch (error) {
        console.error('Erro:', error);
        showStatus('Erro: ' + error.message, 'error');
    } finally {
        isSending = false;
        document.getElementById('sendButton').disabled = false;
        messageInput.focus();
    }
}

// Envia mensagem usando o chat da própria página
function sendMessageInPage(message) {
    return new Promise((resolve) => {
        try {
            // Procura o campo de chat
            const selectors = [
                'textarea[placeholder*="chat" i]',
                'textarea[placeholder*="message" i]',
                'textarea[placeholder*="mensagem" i]',
                'textarea[placeholder*="Ask" i]',
                'textarea[placeholder*="ask" i]',
                'div[contenteditable="true"][role="textbox"]',
                'input[type="text"][placeholder*="ask" i]'
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
                resolve({ success: false, error: 'Campo de chat não encontrado' });
                return;
            }
            
            // Insere a mensagem
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype, 'value'
            ).set;
            
            if (chatInput.tagName === 'TEXTAREA') {
                nativeInputValueSetter.call(chatInput, message);
            } else if (chatInput.tagName === 'INPUT') {
                nativeInputValueSetter.call(chatInput, message);
            } else {
                chatInput.textContent = message;
            }
            
            chatInput.dispatchEvent(new Event('input', { bubbles: true }));
            chatInput.dispatchEvent(new Event('change', { bubbles: true }));
            
            // Aguarda um pouco e clica em enviar
            setTimeout(() => {
                // Procura o botão de enviar
                const sendButton = document.querySelector(
                    'button[type="submit"], ' +
                    'button[aria-label*="send" i], ' +
                    'button[aria-label*="enviar" i], ' +
                    'button[class*="send" i], ' +
                    'button[class*="submit" i]'
                );
                
                if (sendButton && !sendButton.disabled) {
                    sendButton.click();
                    resolve({ success: true, message: 'Mensagem enviada! Verifique a resposta no chat.' });
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
                    resolve({ success: true, message: 'Mensagem enviada! Verifique a resposta no chat.' });
                }
            }, 200);
            
        } catch (error) {
            resolve({ success: false, error: error.message });
        }
    });
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
