

export class BaseAdapter {
    constructor(platformName) {
        if (this.constructor === BaseAdapter) {
            throw new Error('BaseAdapter is an abstract class and cannot be instantiated directly');
        }
        this.platformName = platformName;
    }

    parseWebhook(req) {
        throw new Error(`Method 'parseWebhook()' must be implemented in ${this.constructor.name}`);
    }

    sendMessage(userId, conversationId, message) {
        throw new Error('sendMessage method must be implemented by subclass');
    }

    sendTypingIndicator(conversationId, isTyping) {
        throw new Error('sendTypingIndicator method must be implemented by subclass');
    }
}