
import { getContext } from '../../../../../../extensions.js';

export function updateChatSettings() {
    const context = getContext();
    const chat_len = context.chat.length;
    $('#vectors_enhanced_chat_start').attr('max', chat_len);
    $('#vectors_enhanced_chat_end').attr('max', chat_len);
}
