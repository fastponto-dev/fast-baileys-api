import { isSessionExists, createSession, getSession, deleteSession } from './../whatsapp.js'
import response from './../response.js'

const find = (req, res) => {
    response(res, 200, true, 'Session found.')
}

const status = (req, res) => {
    const session = getSession(res.locals.sessionId)

    const state = session?.user !== undefined
        ? 'authenticated'
        : 'unauthenticated'

    response(res, 200, true, '', { status: state })
}

const add = (req, res) => {
    const { id } = req.body

    if (isSessionExists(id)) {
        return response(res, 409, false, 'Session already exists, please use another id.')
    }

    createSession(id, res)
}

const del = async (req, res) => {
    const { id } = req.params
    const session = getSession(id)

    try {
        await session.logout()
    } catch {
    } finally {
        deleteSession(id, session.isLegacy)
    }

    response(res, 200, true, 'The session has been successfully deleted.')
}

export { find, status, add, del }
