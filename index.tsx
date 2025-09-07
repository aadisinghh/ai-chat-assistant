/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Fix for non-standard SpeechRecognition APIs on the window object
declare global {
    interface Window {
        SpeechRecognition: any;
        webkitSpeechRecognition: any;
    }
}

import { GoogleGenAI, Chat } from "@google/genai";

// Quick-and-dirty polyfill for SpeechRecognition
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

// Ensure the global 'marked' library is available
declare var marked: {
    parse(markdown: string): string;
};
declare var DOMPurify: {
    sanitize(html: string): string;
};
declare var Prism: {
    highlightElement(element: Element): void;
};

interface ChatMessage {
    role: 'user' | 'model';
    text: string;
    imageData?: { base64: string, mimeType: string };
    videoData?: { url: string, mimeType: string };
}

const CONSTANTS = {
    GEMINI_MODEL: 'gemini-2.5-flash',
    USER_STORAGE_KEY: 'gemini-chat-user',
    HISTORY_STORAGE_PREFIX: 'gemini-chat-history-',
    PRISM_THEME_KEY: 'gemini-chat-prism-theme',
};

class AIChatAssistant {
    private ai: GoogleGenAI;
    private chat: Chat;
    private recognition: any | null;

    // UI Elements
    private appContainer: HTMLElement;
    private loginContainer: HTMLElement;
    private loginForm: HTMLFormElement;
    private emailInput: HTMLInputElement;
    private passwordInput: HTMLInputElement;
    private logoutButton: HTMLButtonElement;
    private settingsButton: HTMLButtonElement;
    private settingsModal: HTMLElement;
    private settingsCloseButton: HTMLButtonElement;
    private themeRadios: NodeListOf<HTMLInputElement>;
    private chatContainer: HTMLElement;
    private messageHistory: HTMLElement;
    private form: HTMLFormElement;
    private input: HTMLTextAreaElement;
    private sendButton: HTMLButtonElement;
    private micButton: HTMLButtonElement;
    private fileInput: HTMLInputElement;
    private imagePreviewContainer: HTMLElement;
    
    // State
    private isRecording: boolean = false;
    private currentImageData: { base64: string, mimeType: string } | null = null;
    private currentSpeech: SpeechSynthesisUtterance | null = null;
    private conversationHistory: ChatMessage[] = [];
    private currentUser: string | null = null;
    

    constructor() {
        if (!process.env.API_KEY) {
            throw new Error("API_KEY environment variable not set");
        }
        this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        this.chat = this.ai.chats.create({ model: CONSTANTS.GEMINI_MODEL });

        this.recognition = SpeechRecognition ? new SpeechRecognition() : null;

        this.cacheDOMElements();
        this.addEventListeners();
        this.setupSpeechRecognition();
        this.checkAuth();
        this.loadPrismTheme();
    }

    private cacheDOMElements() {
        this.appContainer = document.getElementById('app-container') as HTMLElement;
        this.loginContainer = document.getElementById('login-container') as HTMLElement;
        this.loginForm = document.getElementById('login-form') as HTMLFormElement;
        this.emailInput = document.getElementById('email-input') as HTMLInputElement;
        this.passwordInput = document.getElementById('password-input') as HTMLInputElement;
        this.logoutButton = document.getElementById('logout-button') as HTMLButtonElement;
        this.settingsButton = document.getElementById('settings-button') as HTMLButtonElement;
        this.settingsModal = document.getElementById('settings-modal') as HTMLElement;
        this.settingsCloseButton = document.getElementById('settings-close-button') as HTMLButtonElement;
        this.themeRadios = document.querySelectorAll('input[name="prism-theme"]');

        this.chatContainer = document.getElementById('chat-container') as HTMLElement;
        this.messageHistory = document.getElementById('message-history') as HTMLElement;
        this.form = document.getElementById('chat-form') as HTMLFormElement;
        this.input = document.getElementById('prompt-input') as HTMLTextAreaElement;
        this.sendButton = document.getElementById('send-button') as HTMLButtonElement;
        this.micButton = document.getElementById('mic-button') as HTMLButtonElement;
        this.fileInput = document.getElementById('file-upload') as HTMLInputElement;
        this.imagePreviewContainer = document.getElementById('image-preview-container') as HTMLElement;

        if (this.recognition === null) {
            this.micButton.disabled = true;
            this.micButton.setAttribute('data-tooltip', 'Speech recognition not supported');
        }
    }

    private addEventListeners() {
        this.loginForm.addEventListener('submit', this.handleLogin.bind(this));
        this.logoutButton.addEventListener('click', this.handleLogout.bind(this));
        this.form.addEventListener('submit', this.handleFormSubmit.bind(this));
        this.input.addEventListener('input', this.autoResizeInput.bind(this));
        this.input.addEventListener('keydown', this.handleInputKeydown.bind(this));
        this.micButton.addEventListener('click', this.toggleVoiceRecognition.bind(this));
        this.fileInput.addEventListener('change', this.handleFileUpload.bind(this));
        this.messageHistory.addEventListener('click', this.handleMessageActions.bind(this));

        // Settings Modal Listeners
        this.settingsButton.addEventListener('click', this.openSettings.bind(this));
        this.settingsCloseButton.addEventListener('click', this.closeSettings.bind(this));
        this.settingsModal.addEventListener('click', (e) => {
            if (e.target === this.settingsModal) { // Close on backdrop click
                this.closeSettings();
            }
        });
        this.themeRadios.forEach(radio => {
            radio.addEventListener('change', () => this.setPrismTheme(radio.value));
        });
    }

    private checkAuth() {
        const storedUser = localStorage.getItem(CONSTANTS.USER_STORAGE_KEY);
        if (storedUser) {
            this.currentUser = storedUser;
            this.loginContainer.style.display = 'none';
            this.appContainer.style.display = 'flex';
            this.loadChatHistory();
        } else {
            this.loginContainer.style.display = 'flex';
            this.appContainer.style.display = 'none';
        }
    }
    
    private handleLogin(e: Event) {
        e.preventDefault();
        const email = this.emailInput.value.trim();
        const password = this.passwordInput.value.trim();
        if (email && password) { // Note: This is placeholder auth
            this.currentUser = email;
            localStorage.setItem(CONSTANTS.USER_STORAGE_KEY, email);
            this.checkAuth();
        }
    }

    private handleLogout() {
        localStorage.removeItem(CONSTANTS.USER_STORAGE_KEY);
        this.currentUser = null;
        this.conversationHistory = [];
        window.location.reload();
    }

    private setupSpeechRecognition() {
        if (!this.recognition) return;

        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';

        this.recognition.onresult = (event: any) => {
            let interimTranscript = '';
            let finalTranscript = '';
            for (let i = 0; i < event.results.length; ++i) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript;
                } else {
                    interimTranscript += transcript;
                }
            }
            this.input.value = (finalTranscript + interimTranscript).trim();
            this.autoResizeInput();
        };

        this.recognition.onend = () => {
            this.isRecording = false;
            this.micButton.classList.remove('is-recording');
            this.micButton.setAttribute('data-tooltip', 'Use microphone');

            if (this.input.value.trim()) {
                this.form.requestSubmit();
            }
        };
    }

    private autoResizeInput() {
        this.input.style.height = 'auto';
        this.input.style.height = `${this.input.scrollHeight}px`;
    }

    private handleInputKeydown(e: KeyboardEvent) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.form.requestSubmit();
        }
    }

    private parseGenerationPrompt(fullPrompt: string): { mainPrompt: string, params: Record<string, string> } {
        const parts = fullPrompt.split(' --');
        const mainPrompt = parts[0].trim();
        const params: Record<string, string> = {};

        for (let i = 1; i < parts.length; i++) {
            const arg = parts[i];
            const firstSpaceIndex = arg.indexOf(' ');
            if (firstSpaceIndex === -1) {
                continue;
            }
            const key = arg.substring(0, firstSpaceIndex).trim();
            const value = arg.substring(firstSpaceIndex + 1).trim();
            if (key && value) {
                params[key] = value;
            }
        }

        return { mainPrompt, params };
    }

    private async handleFormSubmit(e: Event) {
        e.preventDefault();
        const promptText = this.input.value.trim();
        if (!promptText && !this.currentImageData) return;

        const lowerCasePrompt = promptText.toLowerCase();
        
        if (lowerCasePrompt.startsWith('generate ') || lowerCasePrompt.startsWith('/generate ')) {
            const command = lowerCasePrompt.startsWith('generate ') ? 'generate ' : '/generate ';
            const generationPrompt = promptText.substring(command.length).trim();
            await this.handleGenerationCommand(promptText, generationPrompt);
            return;
        }

        await this.handleStandardChatMessage(promptText);
    }

    private async handleGenerationCommand(fullPrompt: string, generationPrompt: string) {
        if (!generationPrompt) {
            const warningMessage: ChatMessage = {
                role: 'model',
                text: "Please provide a prompt for generation. Usage: `generate a cat` or `generate video of a cat`"
            };
            this.reRenderMessage(warningMessage);
            this.conversationHistory.push(warningMessage);
            this.saveChatHistory();
            this.resetInput();
            return;
        }

        const userMessage: ChatMessage = { role: 'user', text: fullPrompt };
        this.renderMessage('user', userMessage.text);
        this.conversationHistory.push(userMessage);
        
        const { mainPrompt, params } = this.parseGenerationPrompt(generationPrompt);
        
        if (mainPrompt.toLowerCase().startsWith('video')) {
            const videoPrompt = mainPrompt.replace(/^video\s(of\s)?/i, '').trim();
            await this.handleVideoGeneration(videoPrompt, params);
        } else {
            await this.handleImageGeneration(mainPrompt, params);
        }
        
        this.resetInput();
    }
    
    private async handleStandardChatMessage(promptText: string) {
        this.setFormState(true);

        const userMessage: ChatMessage = {
            role: 'user',
            text: promptText,
            imageData: this.currentImageData || undefined
        };
        this.renderMessage('user', userMessage.text, userMessage.imageData);
        this.conversationHistory.push(userMessage);
        
        const aiMessageElement = this.renderMessage('model', '', null, true);
        
        try {
            const parts = [];
            if (this.currentImageData) {
                parts.push({
                    inlineData: {
                        data: this.currentImageData.base64,
                        mimeType: this.currentImageData.mimeType,
                    }
                });
            }
            if (promptText) {
                parts.push({ text: promptText });
            }

            const responseStream = await this.chat.sendMessageStream({ message: parts });

            let fullResponse = '';
            const messageContent = aiMessageElement.querySelector('.message-content p') as HTMLElement;
            messageContent.innerHTML = '';
            
            for await (const chunk of responseStream) {
                fullResponse += chunk.text;
                messageContent.innerHTML = DOMPurify.sanitize(marked.parse(fullResponse));
                this.scrollToBottom();
            }
            
            const aiMessage: ChatMessage = { role: 'model', text: fullResponse };
            this.conversationHistory.push(aiMessage);
            this.saveChatHistory();

            this.addMessageActions(aiMessageElement, fullResponse);
            this.highlightCode(aiMessageElement);

        } catch (error) {
            this.displayError(error, aiMessageElement);
            this.conversationHistory.pop(); // Remove failed user message
        } finally {
            this.setFormState(false);
            this.resetInput();
        }
    }
    
    private async handleImageGeneration(prompt: string, params: Record<string, string>) {
        this.setFormState(true);
        const aiLoadingMessage = this.renderMessage('model', '', null, true);
    
        try {
            const config: any = {
                numberOfImages: 1,
                outputMimeType: 'image/jpeg',
            };
            
            const aspectRatio = params['aspect-ratio'];
            const validAspectRatios = ["1:1", "3:4", "4:3", "9:16", "16:9"];
            if (aspectRatio) {
                if (validAspectRatios.includes(aspectRatio)) {
                    config.aspectRatio = aspectRatio;
                } else {
                    throw new Error(`Invalid aspect ratio "${aspectRatio}". Supported values are: ${validAspectRatios.join(', ')}.`);
                }
            }

            const response = await this.ai.models.generateImages({
                model: 'imagen-4.0-generate-001',
                prompt: prompt,
                config: config,
            });
    
            const generatedImages = response.generatedImages;
            if (!generatedImages || generatedImages.length === 0 || !generatedImages[0]?.image?.imageBytes) {
                throw new Error("The image could not be generated. This often happens if the request violates the safety policy (e.g., generating images of real people). Please try a different prompt.");
            }
    
            const base64ImageBytes = generatedImages[0].image.imageBytes;
            const mimeType = 'image/jpeg';
            
            const aiMessage: ChatMessage = { 
                role: 'model', 
                text: `Here's an image for: "${prompt}"`,
                imageData: { base64: base64ImageBytes, mimeType: mimeType }
            };
            
            aiLoadingMessage.remove(); 
            this.reRenderMessage(aiMessage);
            this.conversationHistory.push(aiMessage);
            this.saveChatHistory();
    
        } catch (error) {
            this.displayError(error, aiLoadingMessage);
            this.conversationHistory.pop(); // Remove failed user message
        } finally {
            this.setFormState(false);
            this.scrollToBottom();
        }
    }

    private async handleVideoGeneration(prompt: string, params: Record<string, string>) {
        this.setFormState(true);
        const aiLoadingMessage = this.renderMessage('model', '', null, true);
        const loadingContent = aiLoadingMessage.querySelector('.message-content p') as HTMLElement;
    
        const updateLoadingMessage = (text: string) => {
            if (loadingContent) {
                loadingContent.innerHTML = `<div class="typing-indicator"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div> <span style="margin-left: 8px;">${DOMPurify.sanitize(text)}</span>`;
            }
        };
    
        try {
            updateLoadingMessage('Starting video generation... (this can take a few minutes)');
            
            const config: any = { numberOfVideos: 1 };
            const duration = params['duration'];
            if (duration) {
                const durationSecs = parseInt(duration, 10);
                if (!isNaN(durationSecs) && durationSecs > 0) {
                    config.durationSecs = durationSecs;
                } else {
                    throw new Error(`Invalid duration "${duration}". Please provide a positive number of seconds (e.g., --duration 5).`);
                }
            }
    
            let operation = await this.ai.models.generateVideos({
                model: 'veo-2.0-generate-001',
                prompt: prompt,
                config: config
            });
    
            const pollMessages = [
                'Processing your request...', 'The model is warming up...', 'Rendering frames...', 'Almost there, adding finishing touches...'
            ];
            let pollCount = 0;
    
            while (!operation.done) {
                updateLoadingMessage(pollMessages[pollCount % pollMessages.length]);
                pollCount++;
                await new Promise(resolve => setTimeout(resolve, 10000));
                operation = await this.ai.operations.getVideosOperation({ operation: operation });
            }
            
            const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
            if (!downloadLink) { throw new Error("API did not return a video link."); }
    
            updateLoadingMessage('Downloading video...');
            
            const videoResponse = await fetch(`${downloadLink}&key=${process.env.API_KEY}`);
            if (!videoResponse.ok) { throw new Error(`Failed to download video: ${videoResponse.statusText}`); }

            const videoBlob = await videoResponse.blob();
            const videoUrl = URL.createObjectURL(videoBlob);
    
            const aiMessage: ChatMessage = { 
                role: 'model', 
                text: `Here's a video for: "${prompt}"`,
                videoData: { url: videoUrl, mimeType: videoBlob.type }
            };
            
            aiLoadingMessage.remove();
            this.reRenderMessage(aiMessage);
            this.conversationHistory.push(aiMessage);
            this.saveChatHistory();
    
        } catch (error) {
            this.displayError(error, aiLoadingMessage);
            this.conversationHistory.pop(); // Remove failed user message
        } finally {
            this.setFormState(false);
            this.scrollToBottom();
        }
    }

    private addMessageActions(messageElement: HTMLElement, textContent: string) {
        const messageContentDiv = messageElement.querySelector('.message-content');
        if (!messageContentDiv) return;

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'message-actions';
        actionsDiv.innerHTML = `
            <button class="action-button speak-button" aria-label="Read aloud" data-tooltip="Read aloud">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
            </button>
            <button class="action-button copy-button" aria-label="Copy text" data-tooltip="Copy text">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </button>
        `;
        messageContentDiv.appendChild(actionsDiv);
        messageElement.dataset.fullText = textContent;
    }

    private highlightCode(element: HTMLElement) {
        element.querySelectorAll('pre').forEach(pre => {
            const code = pre.querySelector('code');
            if (!code) return;
    
            if (!pre.querySelector('.code-header')) {
                const lang = code.className.replace('language-', '');
                const header = document.createElement('div');
                header.className = 'code-header';
                
                const langName = document.createElement('span');
                langName.textContent = lang || 'code';
    
                const copyButton = document.createElement('button');
                copyButton.className = 'code-copy-button';
                copyButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> <span>Copy</span>`;
                
                copyButton.addEventListener('click', () => {
                     const codeToCopy = code.textContent || '';
                     navigator.clipboard.writeText(codeToCopy).then(() => {
                         const copySpan = copyButton.querySelector('span');
                         if(copySpan) {
                            copySpan.textContent = 'Copied!';
                            setTimeout(() => { if (copySpan) copySpan.textContent = 'Copy'; }, 2000);
                         }
                     });
                });
    
                header.appendChild(langName);
                header.appendChild(copyButton);
                pre.prepend(header);
            }

            pre.classList.add('line-numbers');
            Prism.highlightElement(code);
        });
    }

    private handleMessageActions(e: MouseEvent) {
        const target = e.target as HTMLElement;
        const speakButton = target.closest('.speak-button');
        const copyButton = target.closest('.copy-button');

        if (speakButton) {
            const messageElement = speakButton.closest('.model-message') as HTMLElement;
            this.toggleSpeech(messageElement.dataset.fullText || '', speakButton);
        } else if (copyButton) {
            const messageElement = copyButton.closest('.model-message') as HTMLElement;
            this.copyToClipboard(messageElement.dataset.fullText || '', copyButton);
        }
    }

    private toggleSpeech(text: string, button: Element) {
        if (speechSynthesis.speaking && this.currentSpeech) {
            speechSynthesis.cancel();
            this.currentSpeech = null;
            button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;
            return;
        }
        
        this.currentSpeech = new SpeechSynthesisUtterance(text);
        this.currentSpeech.onend = () => {
             button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;
            this.currentSpeech = null;
        };
        speechSynthesis.speak(this.currentSpeech);
        button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`; // Stop icon
    }
    
    private copyToClipboard(text: string, button: Element) {
        navigator.clipboard.writeText(text).then(() => {
            const originalIcon = button.innerHTML;
            button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`; // Checkmark
            setTimeout(() => { button.innerHTML = originalIcon; }, 2000);
        });
    }

    private setFormState(isLoading: boolean) {
        this.input.disabled = isLoading;
        this.sendButton.disabled = isLoading;
        this.micButton.disabled = isLoading;
        this.fileInput.disabled = isLoading;
    }

    private resetInput() {
        this.input.value = '';
        this.autoResizeInput();
        this.currentImageData = null;
        this.imagePreviewContainer.style.display = 'none';
        this.imagePreviewContainer.innerHTML = '';
        this.fileInput.value = ''; // Reset file input
        this.input.focus();
    }

    private renderMessage(
        role: 'user' | 'model', 
        text: string, 
        imageData?: { base64: string, mimeType: string } | null, 
        isLoading: boolean = false,
        videoData?: { url: string, mimeType: string } | null
    ): HTMLElement {
        const messageWrapper = document.createElement('div');
        messageWrapper.className = `message ${role}-message`;

        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';

        if (imageData) {
            const img = document.createElement('img');
            img.src = `data:${imageData.mimeType};base64,${imageData.base64}`;
            img.style.maxWidth = '200px';
            img.style.borderRadius = '8px';
            img.style.marginBottom = text ? '0.5rem' : '0';
            messageContent.appendChild(img);
        }

        if (videoData) {
            const video = document.createElement('video');
            video.src = videoData.url;
            video.controls = true;
            video.autoplay = true;
            video.muted = true; 
            video.loop = true;
            video.style.maxWidth = '300px';
            video.style.borderRadius = '8px';
            video.style.marginBottom = text ? '0.5rem' : '0';
            messageContent.appendChild(video);
        }

        const p = document.createElement('p');
        if (isLoading) {
            p.innerHTML = '<div class="typing-indicator"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>';
        } else {
            p.textContent = text;
        }

        messageContent.appendChild(p);
        messageWrapper.appendChild(messageContent);
        this.messageHistory.appendChild(messageWrapper);
        this.scrollToBottom();
        return messageWrapper;
    }

    private reRenderMessage(message: ChatMessage) {
        if (message.role === 'user') {
            this.renderMessage('user', message.text, message.imageData);
        } else { // model message
            const messageElement = this.renderMessage('model', '', message.imageData, false, message.videoData);
            const p = messageElement.querySelector('p');
    
            if (p) {
                if (message.text) {
                    p.innerHTML = DOMPurify.sanitize(marked.parse(message.text));
                    this.addMessageActions(messageElement, message.text);
                    this.highlightCode(messageElement);
                } else {
                    p.remove();
                }
            }
        }
    }

    private scrollToBottom() {
        this.messageHistory.scrollTop = this.messageHistory.scrollHeight;
    }
    
    private toggleVoiceRecognition() {
        if (!this.recognition) return;
        
        this.isRecording = !this.isRecording;
        if (this.isRecording) {
            this.input.value = ''; 
            this.recognition.start();
            this.micButton.classList.add('is-recording');
            this.micButton.setAttribute('data-tooltip', 'Stop recording');
        } else {
            this.recognition.stop();
            this.micButton.classList.remove('is-recording');
            this.micButton.setAttribute('data-tooltip', 'Use microphone');
        }
    }
    
    private handleFileUpload(e: Event) {
        const target = e.target as HTMLInputElement;
        const file = target.files?.[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            console.error("Invalid file type. Please select an image.");
            return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
            const base64String = (reader.result as string).split(',')[1];
            this.currentImageData = { base64: base64String, mimeType: file.type };
            this.displayImagePreview();
        };
        reader.readAsDataURL(file);
    }
    
    private displayImagePreview() {
        if (!this.currentImageData) return;
        
        this.imagePreviewContainer.style.display = 'block';
        this.imagePreviewContainer.innerHTML = `
            <img src="data:${this.currentImageData.mimeType};base64,${this.currentImageData.base64}" alt="Image preview">
            <button id="remove-image-button" type="button" aria-label="Remove image">&times;</button>
        `;
        document.getElementById('remove-image-button')?.addEventListener('click', () => {
            this.currentImageData = null;
            this.imagePreviewContainer.style.display = 'none';
            this.imagePreviewContainer.innerHTML = '';
            this.fileInput.value = '';
        });
    }

    private displayError(error: unknown, messageElement: HTMLElement) {
        console.error("API Error:", error);
        const messageContent = messageElement.querySelector('.message-content p') as HTMLElement;
        const errorMessage = (error instanceof Error) ? error.message : 'An unknown error occurred. Please check the console.';
        
        messageElement.classList.add('error-message');
        if (messageContent) {
            messageContent.innerHTML = `<strong>Error:</strong> ${DOMPurify.sanitize(errorMessage)}`;
        }
    }

    private getStorageKey(): string | null {
        if (!this.currentUser) return null;
        return `${CONSTANTS.HISTORY_STORAGE_PREFIX}${this.currentUser}`;
    }

    private saveChatHistory() {
        const storageKey = this.getStorageKey();
        if (!storageKey) return;
        
        const historyToSave = this.conversationHistory.map(msg => {
            const { videoData, ...rest } = msg; // Omit non-serializable videoData
            return rest;
        });

        localStorage.setItem(storageKey, JSON.stringify(historyToSave));
    }

    private loadChatHistory() {
        const storageKey = this.getStorageKey();
        if (!storageKey) return;

        const savedHistory = localStorage.getItem(storageKey);
        if (savedHistory) {
            this.conversationHistory = JSON.parse(savedHistory);
            if (this.conversationHistory.length === 0) {
                this.initializeEmptyChat();
                return;
            }
            
            this.messageHistory.innerHTML = '';
            this.conversationHistory.forEach(msg => this.reRenderMessage(msg));

            // Restore AI's memory from the loaded history, including images
            const historyForAI = this.conversationHistory
                .filter(msg => msg.role === 'user' || msg.role === 'model') // Ensure only valid roles
                .map(msg => {
                    const parts: any[] = [];
                    if (msg.imageData) {
                        parts.push({
                            inlineData: {
                                data: msg.imageData.base64,
                                mimeType: msg.imageData.mimeType,
                            }
                        });
                    }
                    // Add text part even if empty, as required by the API
                    parts.push({ text: msg.text || '' }); 
                    
                    return { role: msg.role, parts };
                });

            this.chat = this.ai.chats.create({
                model: CONSTANTS.GEMINI_MODEL,
                history: historyForAI
            });

        } else {
            this.conversationHistory = [];
            this.initializeEmptyChat();
        }
    }

    private initializeEmptyChat() {
         const initialMessage: ChatMessage = {
            role: 'model',
            text: "Hello! I'm your AI assistant. How can I help you today?"
        };
        this.conversationHistory = [initialMessage];
        this.reRenderMessage(initialMessage);
        this.saveChatHistory();
    }

    // --- Settings Modal Methods ---
    private openSettings() {
        this.settingsModal.style.display = 'flex';
    }

    private closeSettings() {
        this.settingsModal.style.display = 'none';
    }

    private setPrismTheme(theme: string) {
        document.body.dataset.prismTheme = theme;
        localStorage.setItem(CONSTANTS.PRISM_THEME_KEY, theme);
    }

    private loadPrismTheme() {
        const savedTheme = localStorage.getItem(CONSTANTS.PRISM_THEME_KEY) || 'tomorrow-night';
        this.setPrismTheme(savedTheme);
        const radio = document.querySelector(`input[name="prism-theme"][value="${savedTheme}"]`) as HTMLInputElement;
        if (radio) {
            radio.checked = true;
        }
    }
}

new AIChatAssistant();