"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decryptMessageNode = exports.decodeMessageNode = void 0;
const boom_1 = require("@hapi/boom");
const WAProto_1 = require("../../WAProto");
const WABinary_1 = require("../WABinary");
const generics_1 = require("./generics");
const NO_MESSAGE_FOUND_ERROR_TEXT = 'Message absent from node';
const extractAddressingContext = (stanza) => {
    let senderAlt;
    let recipientAlt;
    const sender = stanza.attrs.participant || stanza.attrs.from;
    const addressingMode = stanza.attrs.addressing_mode || ((sender === null || sender === void 0 ? void 0 : sender.endsWith('lid')) ? 'lid' : 'pn');
    if (addressingMode === 'lid') {
        senderAlt = stanza.attrs.participant_pn || stanza.attrs.sender_pn || stanza.attrs.peer_recipient_pn;
        recipientAlt = stanza.attrs.recipient_pn;
    }
    else {
        senderAlt = stanza.attrs.participant_lid || stanza.attrs.sender_lid || stanza.attrs.peer_recipient_lid;
        recipientAlt = stanza.attrs.recipient_lid;
    }
    return { addressingMode, senderAlt, recipientAlt };
};
const getDecryptionJid = async (sender, repository) => {
    if ((0, WABinary_1.isLidUser)(sender)) {
        return sender;
    }
    const lidMapping = repository === null || repository === void 0 ? void 0 : repository.lidMapping;
    if (lidMapping && typeof lidMapping.getLIDForPN === 'function') {
        const mapped = await lidMapping.getLIDForPN(sender);
        if (mapped) {
            return mapped;
        }
    }
    return sender;
};
/**
 * Decode the received node as a message.
 * @note this will only parse the message, not decrypt it
 */
function decodeMessageNode(stanza, meId, meLid) {
    var _a, _b;
    let msgType;
    let chatId;
    let author;
    let fromMe = false;
    const msgId = stanza.attrs.id;
    const from = stanza.attrs.from;
    const participant = stanza.attrs.participant;
    const recipient = stanza.attrs.recipient;
    const isMe = (jid) => (0, WABinary_1.areJidsSameUser)(jid, meId);
    const isMeLid = (jid) => (0, WABinary_1.areJidsSameUser)(jid, meLid);
    const addressingContext = extractAddressingContext(stanza);
    if ((0, WABinary_1.isJidUser)(from) || (0, WABinary_1.isLidUser)(from)) {
        if (recipient) {
            if (!isMe(from) && !isMeLid(from)) {
                throw new boom_1.Boom('receipient present, but msg not from me', { data: stanza });
            }
            fromMe = isMe(from) || isMeLid(from);
            chatId = recipient;
        }
        else {
            fromMe = isMe(from) || isMeLid(from);
            chatId = from;
        }
        msgType = 'chat';
        author = from;
    }
    else if ((0, WABinary_1.isJidGroup)(from)) {
        if (!participant) {
            throw new boom_1.Boom('No participant in group message');
        }
        fromMe = isMe(participant) || isMeLid(participant);
        msgType = 'group';
        author = participant;
        chatId = from;
    }
    else if ((0, WABinary_1.isJidBroadcast)(from)) {
        if (!participant) {
            throw new boom_1.Boom('No participant in group message');
        }
        const isParticipantMe = isMe(participant) || isMeLid(participant);
        if ((0, WABinary_1.isJidStatusBroadcast)(from)) {
            msgType = isParticipantMe ? 'direct_peer_status' : 'other_status';
        }
        else {
            msgType = isParticipantMe ? 'peer_broadcast' : 'other_broadcast';
        }
        fromMe = isParticipantMe;
        chatId = from;
        author = participant;
    }
    else if ((0, WABinary_1.isJidNewsLetter)(from)) {
        msgType = 'newsletter';
        author = from;
        chatId = from;
        fromMe = isMe(from) || isMeLid(from) || !!((_a = stanza.attrs) === null || _a === void 0 ? void 0 : _a.is_sender);
    }
    else {
        throw new boom_1.Boom('Unknown message type', { data: stanza });
    }
    const pushname = stanza.attrs.notify;
    const key = {
        remoteJid: chatId,
        remoteJidAlt: !((0, WABinary_1.isJidGroup)(chatId)) ? addressingContext.senderAlt : undefined,
        fromMe,
        id: msgId,
        participant,
        participantAlt: ((0, WABinary_1.isJidGroup)(chatId)) ? addressingContext.senderAlt : undefined
    };
    const fullMessage = {
        key,
        messageTimestamp: +stanza.attrs.t,
        pushName: pushname,
        broadcast: (0, WABinary_1.isJidBroadcast)(from)
    };
    if (msgType === 'newsletter') {
        fullMessage.newsletterServerId = +((_b = stanza.attrs) === null || _b === void 0 ? void 0 : _b.server_id);
    }
    if (key.fromMe) {
        fullMessage.status = WAProto_1.proto.WebMessageInfo.Status.SERVER_ACK;
    }
    return {
        fullMessage,
        author,
        sender: msgType === 'chat' ? author : chatId
    };
}
exports.decodeMessageNode = decodeMessageNode;
const decryptMessageNode = (stanza, meId, meLid, repository, logger) => {
    const { fullMessage, author, sender } = decodeMessageNode(stanza, meId, meLid);
    return {
        fullMessage,
        category: stanza.attrs.category,
        author,
        async decrypt() {
            var _a;
            let decryptables = 0;
            async function processSenderKeyDistribution(msg) {
                if (msg.senderKeyDistributionMessage) {
                    try {
                        await repository.processSenderKeyDistributionMessage({
                            authorJid: author,
                            item: msg.senderKeyDistributionMessage
                        });
                    }
                    catch (err) {
                        logger.error({ key: fullMessage.key, err }, 'failed to process senderKeyDistribution');
                    }
                }
            }
            if ((0, WABinary_1.isJidNewsLetter)(fullMessage.key.remoteJid)) {
                const node = (0, WABinary_1.getBinaryNodeChild)(stanza, 'plaintext');
                const msg = WAProto_1.proto.Message.decode(node === null || node === void 0 ? void 0 : node.content);
                await processSenderKeyDistribution(msg);
                fullMessage.message = msg;
                decryptables += 1;
            }
            else if (Array.isArray(stanza.content)) {
                const decryptionJid = await getDecryptionJid(author, repository);
                const { senderAlt } = extractAddressingContext(stanza);
                if (senderAlt && (0, WABinary_1.isLidUser)(senderAlt) && (0, WABinary_1.isJidUser)(author) && decryptionJid === author) {
                    try {
                        if (repository === null || repository === void 0 ? void 0 : repository.lidMapping) {
                            await repository.lidMapping.storeLIDPNMappings([{ lid: senderAlt, pn: author }]);
                        }
                        if (typeof repository === 'object' && typeof repository.migrateSession === 'function') {
                            await repository.migrateSession(author, senderAlt);
                        }
                    }
                    catch (err) {
                        logger.warn({ sender: author, senderAlt, err }, 'failed to store LID mapping from envelope');
                    }
                }
                for (const { tag, attrs, content } of stanza.content) {
                    if (tag === 'verified_name' && content instanceof Uint8Array) {
                        const cert = WAProto_1.proto.VerifiedNameCertificate.decode(content);
                        const details = WAProto_1.proto.VerifiedNameCertificate.Details.decode(cert.details);
                        fullMessage.verifiedBizName = details.verifiedName;
                    }
                    if (tag !== 'enc') {
                        continue;
                    }
                    if (!(content instanceof Uint8Array)) {
                        continue;
                    }
                    decryptables += 1;
                    let msgBuffer;
                    try {
                        const e2eType = attrs.type;
                        switch (e2eType) {
                            case 'skmsg':
                                msgBuffer = await repository.decryptGroupMessage({
                                    group: sender,
                                    authorJid: author,
                                    msg: content
                                });
                                break;
                            case 'pkmsg':
                            case 'msg':
                                const user = (0, WABinary_1.isJidUser)(sender) ? sender : author;
                                msgBuffer = await repository.decryptMessage({
                                    jid: decryptionJid || user,
                                    type: e2eType,
                                    ciphertext: content
                                });
                                break;
                            default:
                                throw new Error(`Unknown e2e type: ${e2eType}`);
                        }
                        let msg = WAProto_1.proto.Message.decode((0, generics_1.unpadRandomMax16)(msgBuffer));
                        msg = ((_a = msg.deviceSentMessage) === null || _a === void 0 ? void 0 : _a.message) || msg;
                        await processSenderKeyDistribution(msg);
                        if (fullMessage.message) {
                            Object.assign(fullMessage.message, msg);
                        }
                        else {
                            fullMessage.message = msg;
                        }
                    }
                    catch (err) {
                        logger.error({ key: fullMessage.key, err }, 'failed to decrypt message');
                        fullMessage.messageStubType = WAProto_1.proto.WebMessageInfo.StubType.CIPHERTEXT;
                        fullMessage.messageStubParameters = [err.message];
                    }
                }
            }
            // if nothing was found to decrypt
            if (!decryptables) {
                fullMessage.messageStubType = WAProto_1.proto.WebMessageInfo.StubType.CIPHERTEXT;
                fullMessage.messageStubParameters = [NO_MESSAGE_FOUND_ERROR_TEXT, JSON.stringify(stanza, generics_1.BufferJSON.replacer)];
            }
        }
    };
};
exports.decryptMessageNode = decryptMessageNode;
