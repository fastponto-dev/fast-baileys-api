import response from './../response.js'

const validate = (req, res, next) => {

    if (!req.headers.authorization) {
        return response(res, 403, false, 'No token sent!')
    }

    if (req.headers.authorization != process.env.TOKEN ?? '2d5819c8-1664-4fd7-903b-3c36f84a824f') {
        return response(res, 401, false, 'Unauthorized')
    }

    next()
}

export default validate