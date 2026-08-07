"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeSocket = void 0;
const boom_1 = require("@hapi/boom");
const crypto_1 = require("crypto");
const url_1 = require("url");
const util_1 = require("util");
const WAProto_1 = require("../../WAProto");
const Defaults_1 = require("../Defaults");
const Types_1 = require("../Types");
const Utils_1 = require("../Utils");
const WABinary_1 = require("../WABinary");
const Client_1 = require("./Client");

const makeSocket = (config) => {
    var _a, _b;
    const { waWebSocketUrl, connectTimeoutMs, logger, keepAliveIntervalMs, browser, auth: authState, printQRInTerminal, defaultQueryTimeoutMs, transactionOpts, qrTimeout, makeSignalRepository, } = config;
    let url = typeof waWebSocketUrl === 'string' ? new url_1.URL(waWebSocketUrl) : waWebSocketUrl;
    config.mobile = config.mobile || url.protocol === 'tcp:';
    if (config.mobile && url.protocol !== 'tcp:') {
        url = new url_1.URL(`tcp://${Defaults_1.MOBILE_ENDPOINT}:${Defaults_1.MOBILE_PORT}`);
    }
    if (!config.mobile && url.protocol === 'wss' && ((_a = authState === null || authState === void 0 ? void 0 : authState.creds) === null || _a === void 0 ? void 0 : _a.routingInfo)) {
        url.searchParams.append('ED', authState.creds.routingInfo.toString('base64url'));
    }
    const ws = config.socket ? config.socket : config.mobile ? new Client_1.MobileSocketClient(url, config) : new Client_1.WebSocketClient(url, config);
    ws.connect();
    const ev = (0, Utils_1.makeEventBuffer)(logger);
    const ephemeralKeyPair = Utils_1.Curve.generateKeyPair();
    const noise = (0, Utils_1.makeNoiseHandler)({
        keyPair: ephemeralKeyPair,
        NOISE_HEADER: config.mobile ? Defaults_1.MOBILE_NOISE_HEADER : Defaults_1.NOISE_WA_HEADER,
        mobile: config.mobile,
        logger,
        routingInfo: (_b = authState === null || authState === void 0 ? void 0 : authState.creds) === null || _b === void 0 ? void 0 : _b.routingInfo
    });
    const { creds } = authState;
    const keys = (0, Utils_1.addTransactionCapability)(authState.keys, logger, transactionOpts);
    const signalRepository = makeSignalRepository({ creds, keys });
    let lastDateRecv;
    let epoch = 1;
    let keepAliveReq;
    let qrTimer;
    let closed = false;
    let pairingCodeRequested = false;
    let connectionAttempts = 0;
    let presenceInterval;
    const uqTagId = (0, Utils_1.generateMdTagPrefix)();
    const generateMessageTag = () => `${uqTagId}${epoch++}`;
    const sendPromise = (0, util_1.promisify)(ws.send);
    
    const sendRawMessage = async (data) => {
        if (!ws.isOpen) {
            throw new boom_1.Boom('Connection Closed', { statusCode: Types_1.DisconnectReason.connectionClosed });
        }
        const bytes = noise.encodeFrame(data);
        await (0, Utils_1.promiseTimeout)(connectTimeoutMs, async (resolve, reject) => {
            try {
                await sendPromise.call(ws, bytes);
                resolve();
            }
            catch (error) {
                reject(error);
            }
        });
    };
    
    const sendNode = (frame) => {
        if (logger.level === 'trace') {
            logger.trace({ xml: (0, WABinary_1.binaryNodeToString)(frame), msg: 'xml send' });
        }
        const buff = (0, WABinary_1.encodeBinaryNode)(frame);
        return sendRawMessage(buff);
    };
    
    const onUnexpectedError = (err, msg) => {
        logger.error({ err }, `unexpected error in '${msg}'`);
    };
    
    const awaitNextMessage = async (sendMsg) => {
        if (!ws.isOpen) {
            throw new boom_1.Boom('Connection Closed', {
                statusCode: Types_1.DisconnectReason.connectionClosed
            });
        }
        let onOpen;
        let onClose;
        const result = (0, Utils_1.promiseTimeout)(connectTimeoutMs, (resolve, reject) => {
            onOpen = resolve;
            onClose = mapWebSocketError(reject);
            ws.on('frame', onOpen);
            ws.on('close', onClose);
            ws.on('error', onClose);
        })
            .finally(() => {
            ws.off('frame', onOpen);
            ws.off('close', onClose);
            ws.off('error', onClose);
        });
        if (sendMsg) {
            sendRawMessage(sendMsg).catch(onClose);
        }
        return result;
    };
    
    const waitForMessage = async (msgId, timeoutMs = defaultQueryTimeoutMs) => {
        let onRecv;
        let onErr;
        try {
            return await (0, Utils_1.promiseTimeout)(timeoutMs, (resolve, reject) => {
                onRecv = resolve;
                onErr = err => {
                    reject(err || new boom_1.Boom('Connection Closed', { statusCode: Types_1.DisconnectReason.connectionClosed }));
                };
                ws.on(`TAG:${msgId}`, onRecv);
                ws.on('close', onErr);
                ws.off('error', onErr);
            });
        }
        finally {
            ws.off(`TAG:${msgId}`, onRecv);
            ws.off('close', onErr);
            ws.off('error', onErr);
        }
    };
    
    const query = async (node, timeoutMs) => {
        if (!node.attrs.id) {
            node.attrs.id = generateMessageTag();
        }
        const msgId = node.attrs.id;
        const wait = waitForMessage(msgId, timeoutMs);
        await sendNode(node);
        const result = await wait;
        if ('tag' in result) {
            (0, WABinary_1.assertNodeErrorFree)(result);
        }
        return result;
    };
    
    const validateConnection = async () => {
        let helloMsg = {
            clientHello: { ephemeral: ephemeralKeyPair.public }
        };
        helloMsg = WAProto_1.proto.HandshakeMessage.fromObject(helloMsg);
        logger.info({ browser, helloMsg }, 'connected to WA');
        const init = WAProto_1.proto.HandshakeMessage.encode(helloMsg).finish();
        const result = await awaitNextMessage(init);
        const handshake = WAProto_1.proto.HandshakeMessage.decode(result);
        logger.trace({ handshake }, 'handshake recv from WA');
        const keyEnc = noise.processHandshake(handshake, creds.noiseKey);
        let node;
        if (config.mobile) {
            node = (0, Utils_1.generateMobileNode)(config);
        }
        else if (!creds.me) {
            node = (0, Utils_1.generateRegistrationNode)(creds, config);
            logger.info({ node }, 'not logged in, attempting registration...');
        }
        else {
            node = (0, Utils_1.generateLoginNode)(creds.me.id, config);
            logger.info({ node }, 'logging in...');
        }
        const payloadEnc = noise.encrypt(WAProto_1.proto.ClientPayload.encode(node).finish());
        await sendRawMessage(WAProto_1.proto.HandshakeMessage.encode({
            clientFinish: {
                static: keyEnc,
                payload: payloadEnc,
            },
        }).finish());
        noise.finishInit();
        startKeepAliveRequest();
    };
    
    const getAvailablePreKeysOnServer = async () => {
        const result = await query({
            tag: 'iq',
            attrs: {
                id: generateMessageTag(),
                xmlns: 'encrypt',
                type: 'get',
                to: WABinary_1.S_WHATSAPP_NET
            },
            content: [
                { tag: 'count', attrs: {} }
            ]
        });
        const countChild = (0, WABinary_1.getBinaryNodeChild)(result, 'count');
        return +countChild.attrs.value;
    };
    
    const uploadPreKeys = async (count = Defaults_1.INITIAL_PREKEY_COUNT) => {
        await keys.transaction(async () => {
            logger.info({ count }, 'uploading pre-keys');
            const { update, node } = await (0, Utils_1.getNextPreKeysNode)({ creds, keys }, count);
            await query(node);
            ev.emit('creds.update', update);
            logger.info({ count }, 'uploaded pre-keys');
        });
    };
    
    const uploadPreKeysToServerIfRequired = async () => {
        const preKeyCount = await getAvailablePreKeysOnServer();
        logger.info(`${preKeyCount} pre-keys found on server`);
        if (preKeyCount <= Defaults_1.MIN_PREKEY_COUNT) {
            await uploadPreKeys();
        }
    };
    
    /** Send presence to keep session alive */
    const sendPresenceUpdate = async (type = 'available') => {
        try {
            if (!ws.isOpen) return;
            await sendNode({
                tag: 'presence',
                attrs: { type }
            });
            logger.trace('presence update sent');
        } catch (err) {
            logger.warn({ err: err.message }, 'error sending presence');
        }
    };
    
    /** Start periodic presence updates to prevent logout */
    const startPresenceUpdates = () => {
        if (presenceInterval) {
            clearInterval(presenceInterval);
        }
        // Send presence every 30 seconds
        presenceInterval = setInterval(() => {
            sendPresenceUpdate('available').catch(() => {});
        }, 30000);
        logger.info('Started presence updates (every 30s)');
    };
    
    /** Stop presence updates */
    const stopPresenceUpdates = () => {
        if (presenceInterval) {
            clearInterval(presenceInterval);
            presenceInterval = undefined;
            logger.info('Stopped presence updates');
        }
    };
    
    const onMessageReceived = (data) => {
        noise.decodeFrame(data, frame => {
            var _a;
            lastDateRecv = new Date();
            let anyTriggered = false;
            anyTriggered = ws.emit('frame', frame);
            if (!(frame instanceof Uint8Array)) {
                const msgId = frame.attrs.id;
                if (logger.level === 'trace') {
                    logger.trace({ xml: (0, WABinary_1.binaryNodeToString)(frame), msg: 'recv xml' });
                }
                anyTriggered = ws.emit(`${Defaults_1.DEF_TAG_PREFIX}${msgId}`, frame) || anyTriggered;
                const l0 = frame.tag;
                const l1 = frame.attrs || {};
                const l2 = Array.isArray(frame.content) ? (_a = frame.content[0]) === null || _a === void 0 ? void 0 : _a.tag : '';
                Object.keys(l1).forEach(key => {
                    anyTriggered = ws.emit(`${Defaults_1.DEF_CALLBACK_PREFIX}${l0},${key}:${l1[key]},${l2}`, frame) || anyTriggered;
                    anyTriggered = ws.emit(`${Defaults_1.DEF_CALLBACK_PREFIX}${l0},${key}:${l1[key]}`, frame) || anyTriggered;
                    anyTriggered = ws.emit(`${Defaults_1.DEF_CALLBACK_PREFIX}${l0},${key}`, frame) || anyTriggered;
                });
                anyTriggered = ws.emit(`${Defaults_1.DEF_CALLBACK_PREFIX}${l0},,${l2}`, frame) || anyTriggered;
                anyTriggered = ws.emit(`${Defaults_1.DEF_CALLBACK_PREFIX}${l0}`, frame) || anyTriggered;
                if (!anyTriggered && logger.level === 'debug') {
                    logger.debug({ unhandled: true, msgId, fromMe: false, frame }, 'communication recv');
                }
            }
        });
    };
    
    const end = (error) => {
        if (closed) {
            logger.trace({ trace: error === null || error === void 0 ? void 0 : error.stack }, 'connection already closed');
            return;
        }
        closed = true;
        stopPresenceUpdates();
        logger.info({ trace: error === null || error === void 0 ? void 0 : error.stack }, error ? 'connection errored' : 'connection closed');
        clearInterval(keepAliveReq);
        clearTimeout(qrTimer);
        ws.removeAllListeners('close');
        ws.removeAllListeners('error');
        ws.removeAllListeners('open');
        ws.removeAllListeners('message');
        if (!ws.isClosed && !ws.isClosing) {
            try {
                ws.close();
            }
            catch (_a) { }
        }
        ev.emit('connection.update', {
            connection: 'close',
            lastDisconnect: {
                error,
                date: new Date()
            }
        });
        ev.removeAllListeners('connection.update');
    };
    
    const waitForSocketOpen = async () => {
        if (ws.isOpen) {
            return;
        }
        if (ws.isClosed || ws.isClosing) {
            throw new boom_1.Boom('Connection Closed', { statusCode: Types_1.DisconnectReason.connectionClosed });
        }
        let onOpen;
        let onClose;
        await new Promise((resolve, reject) => {
            onOpen = () => resolve(undefined);
            onClose = mapWebSocketError(reject);
            ws.on('open', onOpen);
            ws.on('close', onClose);
            ws.on('error', onClose);
        })
            .finally(() => {
            ws.off('open', onOpen);
            ws.off('close', onClose);
            ws.off('error', onClose);
        });
    };
    
    const startKeepAliveRequest = () => (keepAliveReq = setInterval(() => {
        if (!lastDateRecv) {
            lastDateRecv = new Date();
        }
        const diff = Date.now() - lastDateRecv.getTime();
        if (diff > keepAliveIntervalMs + 5000) {
            end(new boom_1.Boom('Connection was lost', { statusCode: Types_1.DisconnectReason.connectionLost }));
        }
        else if (ws.isOpen) {
            query({
                tag: 'iq',
                attrs: {
                    id: generateMessageTag(),
                    to: WABinary_1.S_WHATSAPP_NET,
                    type: 'get',
                    xmlns: 'w:p',
                },
                content: [{ tag: 'ping', attrs: {} }]
            })
                .catch(err => {
                logger.error({ trace: err.stack }, 'error in sending keep alive');
            });
        }
        else {
            logger.warn('keep alive called when WS not open');
        }
    }, keepAliveIntervalMs));
    
    const sendPassiveIq = (tag) => (query({
        tag: 'iq',
        attrs: {
            to: WABinary_1.S_WHATSAPP_NET,
            xmlns: 'passive',
            type: 'set',
        },
        content: [
            { tag, attrs: {} }
        ]
    }));
    
    const logout = async (msg) => {
        var _a;
        stopPresenceUpdates();
        const jid = (_a = authState.creds.me) === null || _a === void 0 ? void 0 : _a.id;
        if (jid) {
            await sendNode({
                tag: 'iq',
                attrs: {
                    to: WABinary_1.S_WHATSAPP_NET,
                    type: 'set',
                    id: generateMessageTag(),
                    xmlns: 'md'
                },
                content: [
                    {
                        tag: 'remove-companion-device',
                        attrs: {
                            jid,
                            reason: 'user_initiated'
                        }
                    }
                ]
            });
        }
        end(new boom_1.Boom(msg || 'Intentional Logout', { statusCode: Types_1.DisconnectReason.loggedOut }));
    };
    
    /**
     * Request pairing code - IMPROVED VERSION
     * - Better timing
     * - Proper error handling
     * - Session stability improvements
     */
    const requestPairingCode = async (phoneNumber, pairKey) => {
        if (!phoneNumber || !/^\d{10,15}$/.test(phoneNumber)) {
            throw new boom_1.Boom('Invalid phone number. Use format: 6281234567890', { statusCode: 400 });
        }

        if (pairingCodeRequested) {
            logger.warn('Pairing already in progress');
            return authState.creds.pairingCode;
        }

        try {
            logger.info('Waiting for socket to be ready...');
            await waitForSocketOpen();
            
            // Wait longer for handshake to complete
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            if (!noise || typeof noise.encrypt !== 'function') {
                throw new boom_1.Boom('Encryption not ready', { statusCode: 500 });
            }

            pairingCodeRequested = true;

            authState.creds.pairingCode = pairKey ? 
                pairKey.toUpperCase() : 
                (0, Utils_1.bytesToCrockford)((0, crypto_1.randomBytes)(5));

            authState.creds.me = {
                id: (0, WABinary_1.jidEncode)(phoneNumber, 's.whatsapp.net'),
                name: '~'
            };

            ev.emit('creds.update', authState.creds);
            
            logger.info({ 
                phone: phoneNumber, 
                code: authState.creds.pairingCode 
            }, 'Sending pairing request');

            const salt = (0, crypto_1.randomBytes)(32);
            const iv = (0, crypto_1.randomBytes)(16);
            const key = (0, Utils_1.derivePairingCodeKey)(authState.creds.pairingCode, salt);
            const encrypted = (0, Utils_1.aesEncryptCTR)(
                authState.creds.pairingEphemeralKeyPair.public, 
                key, 
                iv
            );
            const pairingKey = Buffer.concat([salt, iv, encrypted]);
            
            const response = await query({
                tag: 'iq',
                attrs: {
                    to: WABinary_1.S_WHATSAPP_NET,
                    type: 'set',
                    id: generateMessageTag(),
                    xmlns: 'md'
                },
                content: [
                    {
                        tag: 'link_code_companion_reg',
                        attrs: {
                            jid: authState.creds.me.id,
                            stage: 'companion_hello',
                            should_show_push_notification: 'true'
                        },
                        content: [
                            {
                                tag: 'link_code_pairing_wrapped_companion_ephemeral_pub',
                                attrs: {},
                                content: pairingKey
                            },
                            {
                                tag: 'companion_server_auth_key_pub',
                                attrs: {},
                                content: authState.creds.noiseKey.public
                            },
                            {
                                tag: 'companion_platform_id',
                                attrs: {},
                                content: (0, Utils_1.getPlatformId)(browser[1])
                            },
                            {
                                tag: 'companion_platform_display',
                                attrs: {},
                                content: `${browser[1]} (${browser[0]})`
                            },
                            {
                                tag: 'link_code_pairing_nonce',
                                attrs: {},
                                content: "0"
                            }
                        ]
                    }
                ]
            }, 30000);
            
            logger.info({ response }, 'Pairing request sent successfully');
            return authState.creds.pairingCode;
            
        } catch (error) {
            pairingCodeRequested = false;
            logger.error({ error: error.message, stack: error.stack }, 'Pairing request failed');
            throw error;
        }
    };
    
    const sendWAMBuffer = (wamBuffer) => {
        return query({
            tag: 'iq',
            attrs: {
                to: WABinary_1.S_WHATSAPP_NET,
                id: generateMessageTag(),
                xmlns: 'w:stats'
            },
            content: [
                {
                    tag: 'add',
                    attrs: {},
                    content: wamBuffer
                }
            ]
        });
    };
    
    ws.on('message', onMessageReceived);
    ws.on('open', async () => {
        try {
            connectionAttempts++;
            await validateConnection();
        }
        catch (err) {
            logger.error({ err }, 'error in validating connection');
            end(err);
        }
    });
    ws.on('error', mapWebSocketError(end));
    ws.on('close', () => end(new boom_1.Boom('Connection Terminated', { statusCode: Types_1.DisconnectReason.connectionClosed })));
    ws.on('CB:xmlstreamend', () => end(new boom_1.Boom('Connection Terminated by Server', { statusCode: Types_1.DisconnectReason.connectionClosed })));
    
    ws.on('CB:iq,type:set,pair-device', async (stanza) => {
        const iq = {
            tag: 'iq',
            attrs: {
                to: WABinary_1.S_WHATSAPP_NET,
                type: 'result',
                id: stanza.attrs.id,
            }
        };
        await sendNode(iq);
        const pairDeviceNode = (0, WABinary_1.getBinaryNodeChild)(stanza, 'pair-device');
        const refNodes = (0, WABinary_1.getBinaryNodeChildren)(pairDeviceNode, 'ref');
        const noiseKeyB64 = Buffer.from(creds.noiseKey.public).toString('base64');
        const identityKeyB64 = Buffer.from(creds.signedIdentityKey.public).toString('base64');
        const advB64 = creds.advSecretKey;
        let qrMs = qrTimeout || 60000;
        const genPairQR = () => {
            if (!ws.isOpen) {
                return;
            }
            const refNode = refNodes.shift();
            if (!refNode) {
                end(new boom_1.Boom('QR refs attempts ended', { statusCode: Types_1.DisconnectReason.timedOut }));
                return;
            }
            const ref = refNode.content.toString('utf-8');
            const qr = [ref, noiseKeyB64, identityKeyB64, advB64].join(',');
            ev.emit('connection.update', { qr });
            qrTimer = setTimeout(genPairQR, qrMs);
            qrMs = qrTimeout || 20000;
        };
        genPairQR();
    });
    
    ws.on('CB:iq,,pair-success', async (stanza) => {
        logger.info('✅ Pair success received from WhatsApp');
        try {
            const { reply, creds: updatedCreds } = (0, Utils_1.configureSuccessfulPairing)(stanza, creds);
            logger.info({ 
                me: updatedCreds.me, 
                platform: updatedCreds.platform 
            }, 'Pairing successful! Connection will restart...');
            
            pairingCodeRequested = false;
            connectionAttempts = 0;
            ev.emit('creds.update', updatedCreds);
            ev.emit('connection.update', { isNewLogin: true, qr: undefined });
            await sendNode(reply);
        }
        catch (error) {
            logger.error({ trace: error.stack }, 'Error processing pair-success');
            end(error);
        }
    });
    
    ws.on('CB:success', async (node) => {
        try {
            await uploadPreKeysToServerIfRequired();
            await sendPassiveIq('active');
            
            // Send initial presence
            await sendPresenceUpdate('available');
            
            // Start periodic presence updates
            startPresenceUpdates();
            
            logger.info('✅ Connection opened successfully - presence updates active');
            clearTimeout(qrTimer);
            pairingCodeRequested = false;
            connectionAttempts = 0;
            
            const myPN = authState.creds.me === null || authState.creds.me === void 0 ? void 0 : authState.creds.me.id;
            const myLID = node.attrs.lid;
            if (myPN && myLID) {
                authState.creds.me = { ...authState.creds.me, id: myPN, lid: myLID };
                ev.emit('creds.update', { me: authState.creds.me });
                process.nextTick(async () => {
                    try {
                        if (signalRepository === null || signalRepository === void 0 ? void 0 : signalRepository.lidMapping) {
                            await signalRepository.lidMapping.storeLIDPNMappings([{ lid: myLID, pn: myPN }]);
                        }
                        if (typeof signalRepository === 'object' && typeof signalRepository.migrateSession === 'function') {
                            await signalRepository.migrateSession(myPN, myLID);
                        }
                    }
                    catch (err) {
                        logger.warn({ err, myPN, myLID }, 'Failed to create own LID session mapping');
                    }
                });
            }
            ev.emit('connection.update', { connection: 'open' });
        } catch (err) {
            logger.error({ err }, 'Error in success handler');
        }
    });
    
    ws.on('CB:stream:error', (node) => {
        logger.error({ node }, 'stream error');
        const { reason, statusCode } = (0, Utils_1.getErrorCodeFromStreamError)(node);
        
        // Don't immediately end on certain errors
        if (statusCode === 515 || statusCode === 503) {
            logger.warn('Temporary stream error, will retry');
            return;
        }
        
        end(new boom_1.Boom(`Stream Error (${reason})`, { statusCode, data: node }));
    });
    
    ws.on('CB:failure', (node) => {
        pairingCodeRequested = false;
        const reason = +(node.attrs.reason || 500);
        
        // Handle specific failure reasons
        if (reason === 401 || reason === 403) {
            logger.error('Authentication failed - session may be invalid');
        } else if (reason === 428) {
            logger.error('Connection lost - will reconnect');
            return; // Don't end connection
        }
        
        logger.error({ reason, attrs: node.attrs }, 'Connection failure');
        end(new boom_1.Boom('Connection Failure', { statusCode: reason, data: node.attrs }));
    });
    
    ws.on('CB:ib,,downgrade_webclient', () => {
        end(new boom_1.Boom('Multi-device beta not joined', { statusCode: Types_1.DisconnectReason.multideviceMismatch }));
    });
    
    ws.on('CB:ib,,edge_routing', (node) => {
        const edgeRoutingNode = (0, WABinary_1.getBinaryNodeChild)(node, 'edge_routing');
        const routingInfo = (0, WABinary_1.getBinaryNodeChild)(edgeRoutingNode, 'routing_info');
        if (routingInfo === null || routingInfo === void 0 ? void 0 : routingInfo.content) {
            authState.creds.routingInfo = Buffer.from(routingInfo === null || routingInfo === void 0 ? void 0 : routingInfo.content);
            ev.emit('creds.update', { routingInfo: authState.creds.routingInfo });
        }
    });
    
    let didStartBuffer = false;
    process.nextTick(() => {
        var _a;
        if ((_a = creds.me) === null || _a === void 0 ? void 0 : _a.id) {
            ev.buffer();
            didStartBuffer = true;
        }
        ev.emit('connection.update', { connection: 'connecting', receivedPendingNotifications: false, qr: undefined });
    });
    
    ws.on('CB:ib,,offline', (node) => {
        const child = (0, WABinary_1.getBinaryNodeChild)(node, 'offline');
        const offlineNotifs = +((child === null || child === void 0 ? void 0 : child.attrs.count) || 0);
        logger.info(`Handled ${offlineNotifs} offline messages`);
        if (didStartBuffer) {
            ev.flush();
        }
        ev.emit('connection.update', { receivedPendingNotifications: true });
    });
    
    ev.on('creds.update', update => {
        var _a, _b;
        const name = (_a = update.me) === null || _a === void 0 ? void 0 : _a.name;
        if (((_b = creds.me) === null || _b === void 0 ? void 0 : _b.name) !== name && name) {
            logger.debug({ name }, 'pushName updated');
            sendNode({
                tag: 'presence',
                attrs: { name: name }
            })
                .catch(err => {
                logger.warn({ trace: err.stack }, 'error updating presence');
            });
        }
        Object.assign(creds, update);
    });
    
    if (printQRInTerminal) {
        (0, Utils_1.printQRIfNecessaryListener)(ev, logger);
    }
    
    return {
        type: 'md',
        ws,
        ev,
        authState: { creds, keys },
        signalRepository,
        get user() {
            return authState.creds.me;
        },
        generateMessageTag,
        query,
        waitForMessage,
        waitForSocketOpen,
        sendRawMessage,
        sendNode,
        logout,
        end,
        onUnexpectedError,
        uploadPreKeys,
        uploadPreKeysToServerIfRequired,
        requestPairingCode,
        sendPresenceUpdate,
        waitForConnectionUpdate: (0, Utils_1.bindWaitForConnectionUpdate)(ev),
        sendWAMBuffer,
    };
};
exports.makeSocket = makeSocket;

function mapWebSocketError(handler) {
    return (error) => {
        handler(new boom_1.Boom(`WebSocket Error (${error === null || error === void 0 ? void 0 : error.message})`, { 
            statusCode: (0, Utils_1.getCodeFromWSError)(error), 
            data: error 
        }));
    };
}
