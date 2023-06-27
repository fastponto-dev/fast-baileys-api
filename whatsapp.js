import { rmSync, readdir } from 'fs';
import { join } from 'path';
import pino from 'pino';
import makeWASocket, {
    useMultiFileAuthState,
    makeInMemoryStore,
    DisconnectReason,
    delay,
} from '@whiskeysockets/baileys';
import axios from 'axios';
import { toDataURL } from 'qrcode'
import __dirname from './dirname.js'
import response from './response.js'
import downloadMessage from './helper/downloadMessage.js';

const sessions = new Map()
const retries = new Map()

const sessionsDir = (sessionId = '') => {
    return join(__dirname, 'sessions', sessionId ? sessionId : '')
}

const isSessionExists = (sessionId) => {
    return sessions.has(sessionId)
}

const shouldReconnect = (sessionId) => {
    let maxRetries = parseInt(process.env.MAX_RETRIES ?? 0)
    let attempts = retries.get(sessionId) ?? 0

    maxRetries = maxRetries < 1 ? 1 : maxRetries

    if (attempts < maxRetries) {
        ++attempts

        console.log('Reconnecting...', { attempts, sessionId })
        retries.set(sessionId, attempts)

        return true
    }

    return false
}

const createSession = async (sessionId, res = null) => {
    const sessionFile = 'md_' + sessionId;

    const logger = pino({ level: 'warn' })
    const store = makeInMemoryStore({ logger })

    let state, saveState

    ;({ state, saveCreds: saveState } = await useMultiFileAuthState(sessionsDir(sessionFile)))

    /**
     * @type {import('@whiskeysockets/baileys').UserFacingSocketConfig}
     */
    const waConfig = {
        auth: state,
        printQRInTerminal: true,
        logger,
        browser: ["FASTZAP", "Chrome", "1.0"]
    }

    const wa = makeWASocket.default({
        ...waConfig,
        // browser: Browsers.macOS('Desktop'),
        // syncFullHistory: true
    })

    sessions.set(sessionId, {...wa, store})

    wa.ev.on('creds.update', saveState)

    wa.ev.on('chats.set', ({ chats }) => {
    });

    wa.ev.on('messages.upsert', (m) => {

        if (m.type !== 'notify') return

        m.messages.map(async (msg) => {
            if (!msg.message) return

            const messageType = Object.keys(msg.message)[0]
            if (
                [
                    'protocolMessage',
                    'senderKeyDistributionMessage',
                ].includes(messageType)
            )
                return

            const webhookData = {
                instance: sessionId,
                ...msg,
            }

            if (messageType === 'conversation') {
                webhookData['text'] = m
            }

            switch (messageType) {
                case 'imageMessage':
                    webhookData['msgContent'] = await downloadMessage(
                        msg.message.imageMessage,
                        'image'
                    )
                    break
                case 'videoMessage':
                    webhookData['msgContent'] = await downloadMessage(
                        msg.message.videoMessage,
                        'video'
                    )
                    break
                case 'audioMessage':
                    webhookData['msgContent'] = await downloadMessage(
                        msg.message.audioMessage,
                        'audio'
                    )
                    break
                default:
                    webhookData['msgContent'] = ''
                    break
            }

            await sendWebhook(webhookData);
        })
    });

    wa.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update
        const statusCode = lastDisconnect?.error?.output?.statusCode

        if (connection === 'open') {
            retries.delete(sessionId)
        }

        if (connection === 'close') {
            if (statusCode === DisconnectReason.loggedOut || !shouldReconnect(sessionId)) {
                if (res && !res.headersSent) {
                    response(res, 500, false, 'Unable to create session.')
                }

                return deleteSession(sessionId)
            }

            setTimeout(
                () => {
                    createSession(sessionId, res)
                },
                statusCode === DisconnectReason.restartRequired ? 0 : parseInt(process.env.RECONNECT_INTERVAL ?? 0)
            )
        }

        if (update.qr) {
            if (res && !res.headersSent) {
                try {
                    const qr = await toDataURL(update.qr)

                    response(res, 200, true, 'QR code received, please scan the QR code.', { qr })

                    return
                } catch {
                    response(res, 500, false, 'Unable to create QR code.')
                }
            }

            try {
                await wa.logout()
            } catch {
            } finally {
                deleteSession(sessionId)
            }
        }
    });
}

const sendWebhook = (data) => {
    let tries = 3;

    axios.post(process.env.WEBHOOK_URL, data)
    .catch(async function (error) {
        if(tries > 0){
            await sendWebhook(data);
            tries = tries - 1;
        }
    });
}

/**
 * @returns {(import('@whiskeysockets/baileys').AnyWASocket|null)}
 */
const getSession = (sessionId) => {
    return sessions.get(sessionId) ?? null
}

const deleteSession = (sessionId) => {
    const sessionFile = 'md_' + sessionId;
    const storeFile = `${sessionId}_store.json`
    const rmOptions = { force: true, recursive: true }

    rmSync(sessionsDir(sessionFile), rmOptions)
    rmSync(sessionsDir(storeFile), rmOptions)

    sessions.delete(sessionId)
    retries.delete(sessionId)
}

const getChatList = (sessionId, isGroup = false) => {
    const filter = isGroup ? '@g.us' : '@s.whatsapp.net'

    return getSession(sessionId).store.chats.filter((chat) => {
        return chat.id.endsWith(filter)
    })
}

/**
 * @param {import('@whiskeysockets/baileys').AnyWASocket} session
 */
const isExists = async (session, jid, isGroup = false) => {
    try {
        let result

        if (isGroup) {
            result = await session.groupMetadata(jid)
            return Boolean(result.id)
        }

        [result] = await session.onWhatsApp(jid);

        return result.exists
    } catch {
        return false
    }
}

/**
 * @param {import('@whiskeysockets/baileys').AnyWASocket} session
 */
const sendMessage = async (session, receiver, message, messageId = undefined) => {
    try {
        
        const delayMs = (Math.floor(Math.random() * 4) + 1) * 1000;
        await delay(parseInt(delayMs));

        return session.sendMessage(receiver, message);
    } catch {
        return Promise.reject(null) // eslint-disable-line prefer-promise-reject-errors
    }
}

const formatPhone = (phone) => {
    if (phone.endsWith('@s.whatsapp.net')) {
        return phone
    }

    let formatted = phone.replace(/\D/g, '')

    return (formatted += '@s.whatsapp.net')
}

const formatGroup = (group) => {
    if (group.endsWith('@g.us')) {
        return group
    }

    let formatted = group.replace(/[^\d-]/g, '')

    return (formatted += '@g.us')
}

const cleanup = () => {
    console.log('Running cleanup before exit.')
}

const init = () => {
    readdir(sessionsDir(), (err, files) => {
        if (err) {
            throw err
        }

        for (const file of files) {
            if (!file.startsWith('md_') || file.endsWith('_store')) {
                continue
            }

            const filename = file.replace('.json', '')
            const sessionId = filename.substring(3)

            createSession(sessionId)
        }
    })
}

export {
    isSessionExists,
    createSession,
    getSession,
    deleteSession,
    getChatList,
    isExists,
    sendMessage,
    formatPhone,
    formatGroup,
    cleanup,
    init,
}
