import { Router } from 'express'
import sessionsRoute from './routes/sessionsRoute.js'
import chatsRoute from './routes/chatsRoute.js'
import groupsRoute from './routes/groupsRoute.js'
import response from './response.js'
import tokenValidator from './middlewares/tokenValidator.js'

const router = Router()

router.use(tokenValidator);

router.use('/sessions', sessionsRoute)
router.use('/chats', chatsRoute)
router.use('/groups', groupsRoute)

router.all('*', (req, res) => {
    response(res, 404, false, 'The requested url cannot be found.')
})

export default router
